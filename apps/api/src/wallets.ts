import {Hono} from 'hono';
import type {ApiContext,ApiEnv} from './security';
import {readBody,requireUser,requireAdmin,requirePermission,limit,sha256,clientIp} from './security';
import {text} from './responses';
import {topupQrPayload,topupQrSvg} from './topup-qr';
import {emailShell} from './email';
import {notifyAccount,sendNotificationEmail} from './notifications';
import {checkoutEndpoint,createCheckoutFields,fetchSepayOrder,sepayPgConfig,verifyIpnAuthorization,verifyIpnSignature} from './sepay-pg';

export type BankAccount={id:string;bank_code:string;bank_name:string;account_number:string;account_holder:string};
export type PaymentSettings={accepting_topups:number;bank_account_id:string|null;version:number;updated_at:number;bank:BankAccount|null};
export type Topup={id:string;code:string;user_id:string;requested_vnd:number;bank_account_id:string;bank_code:string;bank_name:string;account_number:string;account_holder:string;payment_provider:'manual'|'sepay_pg';status:'pending'|'reported'|'needs_review'|'credited'|'cancelled';customer_note:string;review_note:string;version:number;created_at:number;updated_at:number;reported_at:number|null;cancelled_at:number|null;credited_at:number|null;credited_vnd:number|null};
export type WalletEntry={id:string;sequence:number;kind:'topup'|'adjustment'|'withdrawal_hold'|'withdrawal_release'|'listing_fee'|'renewal_fee';amount_vnd:number;balance_before_vnd:number;balance_after_vnd:number;description:string;created_at:number;actor_name?:string;topup_code?:string|null};
export type WalletSummary={balance_vnd:number;held_vnd:number;free_posts_remaining:number;free_posts_total:number;profile_status:string|null;can_topup:boolean;payments_enabled:boolean;sepay_configured:boolean;sepay_environment:'sandbox'|'production'|null;bank:BankAccount|null};
const router=new Hono<ApiEnv>();
router.use('/account/*',requireUser);
router.use('/cms/*',requireUser,requireAdmin);
router.on(['GET','POST'],'/payments/sepay/ipn',processSepayIpn);
const uid=()=>crypto.randomUUID();
const sepayLedgerAccountId='system-sepay-gateway';
const fail=(c:ApiContext,error:string,status:400|403|404|409|503=400)=>c.json({error},status);
const version=(v:unknown)=>Number.isSafeInteger(Number(v))&&Number(v)>=1;
const isUuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const amount=(value:unknown,min=1,max=1000000)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max;
const reference=(value:unknown)=>text(value).normalize('NFKC').toUpperCase().replace(/[\s._/\-]+/g,'');
const topupFields='t.id,t.code,t.user_id,t.requested_vnd,t.bank_account_id,t.bank_code,t.bank_name,t.account_number,t.account_holder,t.payment_provider,t.status,t.customer_note,t.review_note,t.version,t.created_at,t.updated_at,t.reported_at,t.cancelled_at,t.credited_at,t.credited_vnd';
const stale=(c:ApiContext)=>fail(c,'Yêu cầu đã thay đổi hoặc được xử lý. Tải lại trang trước khi thao tác.',409);
function pager(c:ApiContext){const page=Number(c.req.query('page')??1);return Number.isSafeInteger(page)&&page>=1&&page<=10000?page:null;}
async function settings(db:D1Database):Promise<PaymentSettings>{
 const row=await db.prepare('SELECT accepting_topups,bank_account_id,version,updated_at FROM payment_settings WHERE id=1').first<Omit<PaymentSettings,'bank'>>();
 if(!row)throw new Error('Payment settings unavailable');
 const bank=row.bank_account_id?await db.prepare('SELECT id,bank_code,bank_name,account_number,account_holder FROM receiving_bank_accounts WHERE id=?').bind(row.bank_account_id).first<BankAccount>():null;
 return {...row,bank};
}
async function summary(c:ApiContext,id:string):Promise<WalletSummary>{
 const [wallet,promo,profile,config,held]=await Promise.all([
  c.env.DB.prepare('SELECT balance_vnd FROM wallet_accounts WHERE user_id=?').bind(id).first<{balance_vnd:number}>(),
  c.env.DB.prepare('SELECT free_posts_total,free_posts_used FROM posting_promotions WHERE user_id=?').bind(id).first<{free_posts_total:number;free_posts_used:number}>(),
  c.env.DB.prepare('SELECT status FROM seller_profiles WHERE user_id=?').bind(id).first<{status:string}>(),settings(c.env.DB),
  c.env.DB.prepare("SELECT COALESCE(sum(amount_vnd),0) AS held_vnd FROM withdrawal_requests WHERE user_id=? AND status IN('pending','approved')").bind(id).first<{held_vnd:number}>()
 ]);
 const approved=profile?.status==='approved',sepay=sepayPgConfig(c.env),enabled=Boolean(config.accepting_topups&&sepay);
 return {balance_vnd:wallet?.balance_vnd??0,held_vnd:held?.held_vnd??0,free_posts_total:promo?.free_posts_total??3,free_posts_remaining:(promo?.free_posts_total??3)-(promo?.free_posts_used??0),profile_status:profile?.status??null,can_topup:approved&&enabled,payments_enabled:enabled,sepay_configured:Boolean(sepay),sepay_environment:sepay?.environment??null,bank:null};
}
async function ledger(c:ApiContext,userId:string,page:number){
 const [rows,count]=await c.env.DB.batch<Record<string,unknown>>([
  c.env.DB.prepare(`SELECT e.id,e.sequence,CASE WHEN e.idempotency_key LIKE 'withdrawal:hold:%' THEN 'withdrawal_hold' WHEN e.idempotency_key LIKE 'withdrawal:release:%' THEN 'withdrawal_release' WHEN e.idempotency_key LIKE 'listing:%' THEN 'listing_fee' WHEN e.idempotency_key LIKE 'renewal:%' THEN 'renewal_fee' ELSE e.kind END AS kind,e.amount_vnd,e.balance_before_vnd,e.balance_after_vnd,e.description,e.created_at,u.name AS actor_name,t.code AS topup_code FROM wallet_entries e JOIN users u ON u.id=e.actor_id LEFT JOIN topup_requests t ON t.id=e.topup_id WHERE e.user_id=? ORDER BY e.sequence DESC LIMIT 20 OFFSET ?`).bind(userId,(page-1)*20),
  c.env.DB.prepare('SELECT count(*) AS total FROM wallet_entries WHERE user_id=?').bind(userId)
 ]);
 return {items:rows.results,total:Number(count.results[0]?.total??0),page,page_size:20};
}
async function events(c:ApiContext,id:string){return (await c.env.DB.prepare(`SELECT e.id,e.action,e.note,e.created_at,u.name AS actor_name FROM topup_events e JOIN users u ON u.id=e.actor_id WHERE e.topup_id=? ORDER BY e.created_at,e.rowid`).bind(id).all()).results;}
function code(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return 'NAP'+Array.from(crypto.getRandomValues(new Uint8Array(12)),n=>alphabet[n&31]).join('');}
async function knownError(c:ApiContext,error:unknown){
 const message=String(error);
 if(/UNIQUE constraint failed: bank_receipts.bank_account_id/i.test(message))return fail(c,'Mã giao dịch ngân hàng này đã được ghi nhận cho tài khoản nhận đó. Không cộng tiền lần nữa.',409);
 if(/UNIQUE constraint failed|topup_stale|wallet_stale_balance/i.test(message))return stale(c);
 if(/topup_exception_required/i.test(message))return fail(c,'Khoản nhận có chênh lệch hoặc yêu cầu từng bị hủy. Xác nhận ngoại lệ và nhập lý do ít nhất 10 ký tự.',409);
 if(/CHECK constraint failed:.*balance|wallet_requires_ledger/i.test(message))return fail(c,'Số dư không đủ cho khoản giảm hoặc vượt giới hạn cho phép.',409);
 if(/no_self_reconciliation/i.test(message))return fail(c,'Không được tự đối soát yêu cầu nạp của mình.',403);
 throw error;
}

type SepayNotification=Record<string,unknown>;
function plainObject(value:unknown):value is Record<string,unknown>{return Boolean(value&&typeof value==='object'&&!Array.isArray(value));}
async function readSepayNotification(c:ApiContext):Promise<SepayNotification|null>{
 if(c.req.method==='GET')return Object.fromEntries(new URL(c.req.url).searchParams.entries());
 const raw=await c.req.raw.text();if(raw.length>16000)return null;
 const contentType=(c.req.header('Content-Type')??'').split(';')[0].trim().toLowerCase();
 if(contentType==='application/json'||raw.trimStart().startsWith('{')){
  try{
   const parsed:unknown=JSON.parse(raw);if(!plainObject(parsed))return null;
   const nested=plainObject(parsed.data)?parsed.data:plainObject(parsed.order)?parsed.order:null;
   return nested?{...nested,...parsed}:parsed;
  }catch{return null;}
 }
 if(contentType==='application/x-www-form-urlencoded'||contentType===''){
  const entries=[...new URLSearchParams(raw).entries()];if(!entries.length)return {};
  if(new Set(entries.map(([key])=>key)).size!==entries.length)return null;
  return Object.fromEntries(entries);
 }
 return null;
}
const valueString=(value:unknown)=>typeof value==='string'?value.trim():typeof value==='number'&&Number.isFinite(value)?String(value):'';
function inputAmount(fields:SepayNotification){
 for(const key of ['order_amount','amount','transferAmount','paid_amount']){
  const value=fields[key];
  if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)return value;
  if(typeof value==='string'&&/^\d+(?:\.0+)?$/.test(value.trim())){const n=Number(value);if(Number.isSafeInteger(n)&&n>=0)return n;}
 }
 return 0;
}
function inputInvoice(fields:SepayNotification){return valueString(fields.order_invoice_number??fields.invoice_number??fields.invoice??fields.invoiceNumber);}
function providerReference(value:string,invoice:string){return (value||invoice).replace(/[\u0000-\u001f\u007f]/g,'').slice(0,200)||invoice;}
async function recordSepayException(c:ApiContext,input:{reference:string;invoice:string;topup:Topup|null;amountVnd:number;currency:string;outcome:'unmatched'|'amount_mismatch'|'cancelled_request'|'legacy_request'|'already_credited'|'request_not_pending';note:string}){
 const id=uid(),stamp=uid(),note=input.note.slice(0,1000),topup=input.topup;
 const event=c.env.DB.prepare(`INSERT INTO sepay_payment_events(id,provider_reference,order_invoice_number,topup_id,amount_vnd,currency,outcome,note)
  VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(provider_reference) DO NOTHING`).bind(id,input.reference,input.invoice,topup?.id??null,input.amountVnd,input.currency||'UNKNOWN',input.outcome,note);
 const statements=[event];
 if(topup)statements.push(
  c.env.DB.prepare(`UPDATE topup_requests SET status='needs_review',review_note=?,version=version+1,change_token=?,updated_at=unixepoch() WHERE id=? AND status!='credited' AND EXISTS(SELECT 1 FROM sepay_payment_events WHERE id=? AND outcome!='credited')`).bind(note,stamp,topup.id,id),
  c.env.DB.prepare(`INSERT INTO topup_events(id,topup_id,actor_id,action,note) SELECT ?,id,'sepay-ipn-system','needs_review',? FROM topup_requests WHERE id=? AND change_token=?`).bind(uid(),note,topup.id,stamp),
  c.env.DB.prepare(`INSERT INTO admin_audit(id,actor_id,action,target_id,note) SELECT ?,'sepay-ipn-system','topup.sepay_exception',id,? FROM topup_requests WHERE id=? AND change_token=?`).bind(uid(),note,topup.id,stamp)
 );
 await c.env.DB.batch(statements);
}
async function processSepayOrder(c:ApiContext,config:NonNullable<ReturnType<typeof sepayPgConfig>>,invoice:string,callbackRef:string,signatureValid:boolean,reportedAmount:number,reportedCurrency:string,source:'ipn'|'return'):Promise<Response>{
 const topup=await c.env.DB.prepare(`SELECT ${topupFields} FROM topup_requests t WHERE t.code=?`).bind(invoice).first<Topup>();
 let order:Awaited<ReturnType<typeof fetchSepayOrder>>;
 try{order=await fetchSepayOrder(config,invoice);}
 catch(error){
  const status=Number((error as {status?:unknown})?.status??0);
  console.error('sepay_order_lookup_failed',{status:status||'network',source});
  return source==='return'?c.json({success:true,pending:true}):c.json({success:false,error:'Chưa xác minh được đơn hàng với SePay. SePay có thể thử gửi lại thông báo.'},503);
 }
 if(!order){
  if(signatureValid){
   await recordSepayException(c,{reference:providerReference(callbackRef,invoice),invoice,topup,amountVnd:reportedAmount,currency:reportedCurrency||'UNKNOWN',outcome:topup?'request_not_pending':'unmatched',note:'SePay xác thực thông báo nhưng không tìm thấy đơn hàng tương ứng qua API.'});
   return c.json({success:true,exception:true,pending:false});
  }
  console.warn('sepay_order_not_found',{source});
  return source==='return'?c.json({success:true,pending:true}):c.json({success:false,error:'SePay chưa trả được thông tin đơn hàng đã xác minh. Sẽ thử lại khi có thể xác nhận.'},503);
 }
 if(order.invoice!==invoice){console.warn('sepay_order_invoice_mismatch',{source});return c.json({success:false,error:'Mã đơn từ SePay không khớp.'},409);}
 if(!order.paid){
  console.info('sepay_order_not_paid',{source,status:order.status});
  if(source==='return')return c.json({success:true,pending:true});
  if(['CANCELLED','FAILED','ERROR','EXPIRED','VOIDED','UNPAID','REFUNDED'].includes(order.status))return c.json({success:true,ignored:true});
  return c.json({success:false,error:'Đơn hàng chưa có trạng thái thanh toán cuối cùng. SePay có thể gửi lại thông báo.'},503);
 }
 const reference=providerReference(order.providerReference||callbackRef,invoice);
 const priorEvent=await c.env.DB.prepare('SELECT outcome FROM sepay_payment_events WHERE provider_reference=?').bind(reference).first<{outcome:string}>();
 if(priorEvent)return c.json({success:true,replayed:true,pending:priorEvent.outcome!=='credited'});
 const priorReceipt=await c.env.DB.prepare(`SELECT r.provider_transaction_id,r.provider,r.actual_vnd,t.id FROM bank_receipts r JOIN topup_requests t ON t.id=r.topup_id WHERE t.code=?`).bind(invoice).first<{provider_transaction_id:string|null;provider:string;actual_vnd:number;id:string}>();
 if(priorReceipt){
  if(priorReceipt.provider==='sepay_pg'&&priorReceipt.provider_transaction_id===reference&&priorReceipt.actual_vnd===order.amountVnd)return c.json({success:true,replayed:true,pending:false});
  if(topup)await recordSepayException(c,{reference,invoice,topup,amountVnd:order.amountVnd,currency:order.currency,outcome:'already_credited',note:'SePay xác nhận đơn đã thanh toán nhưng yêu cầu đã được ghi nhận trước đó bằng một giao dịch khác.'});
  return c.json({success:true,exception:true,pending:false});
 }
 if(!topup){
  await recordSepayException(c,{reference,invoice,topup:null,amountVnd:order.amountVnd,currency:order.currency,outcome:'unmatched',note:'SePay xác nhận đã thanh toán nhưng không có yêu cầu nạp mang mã này.'});
  return c.json({success:true,exception:true,pending:false});
 }
 if(topup.payment_provider!=='sepay_pg'){
  await recordSepayException(c,{reference,invoice,topup,amountVnd:order.amountVnd,currency:order.currency,outcome:'legacy_request',note:'Giao dịch SePay đến cho yêu cầu nạp được tạo trước khi chuyển sang SePay.'});
  return c.json({success:true,exception:true,pending:false});
 }
 if(order.currency!=='VND'||order.amountVnd!==topup.requested_vnd){
  await recordSepayException(c,{reference,invoice,topup,amountVnd:order.amountVnd,currency:order.currency,outcome:'amount_mismatch',note:`Số tiền hoặc loại tiền SePay xác nhận không khớp yêu cầu ${topup.requested_vnd} VND.`});
  return c.json({success:true,exception:true,pending:false});
 }
 if(topup.status==='credited'){
  await recordSepayException(c,{reference,invoice,topup,amountVnd:order.amountVnd,currency:order.currency,outcome:'already_credited',note:'SePay xác nhận một thanh toán khác cho yêu cầu đã được cộng số dư.'});
  return c.json({success:true,exception:true,pending:false});
 }
 if(topup.status!=='pending'){
  const outcome=topup.status==='cancelled'?'cancelled_request':'request_not_pending';
  await recordSepayException(c,{reference,invoice,topup,amountVnd:order.amountVnd,currency:order.currency,outcome,note:'SePay xác nhận đã thanh toán sau khi yêu cầu không còn ở trạng thái chờ thanh toán.'});
  return c.json({success:true,exception:true,pending:false});
 }
 const receiptId=uid(),eventId=uid(),receiptRef='SEPAY'+(await sha256(reference)).slice(0,60).toUpperCase(),note=`SePay xác nhận thanh toán đơn ${invoice}`;
 try{
  await c.env.DB.batch([
   c.env.DB.prepare(`INSERT INTO sepay_payment_events(id,provider_reference,order_invoice_number,topup_id,amount_vnd,currency,outcome,note)
    SELECT ?,?,?,?,?,?,'credited',? FROM topup_requests WHERE id=? AND payment_provider='sepay_pg' AND status='pending' AND requested_vnd=? ON CONFLICT(provider_reference) DO NOTHING`).bind(eventId,reference,invoice,topup.id,order.amountVnd,order.currency,'Đã xác minh đơn đã thanh toán với SePay.',topup.id,order.amountVnd),
   c.env.DB.prepare(`INSERT INTO bank_receipts(id,topup_id,bank_account_id,bank_reference,actual_vnd,reviewed_by,expected_version,exception_confirmed,note,provider,provider_transaction_id)
    SELECT ?,t.id,t.bank_account_id,?,?, 'sepay-ipn-system',t.version,0,?,'sepay_pg',? FROM topup_requests t
    WHERE t.id=? AND t.payment_provider='sepay_pg' AND t.status='pending' AND t.requested_vnd=?
    AND EXISTS(SELECT 1 FROM sepay_payment_events e WHERE e.id=? AND e.outcome='credited')
    AND NOT EXISTS(SELECT 1 FROM bank_receipts r WHERE r.topup_id=t.id)`).bind(receiptId,receiptRef,order.amountVnd,note,reference,topup.id,order.amountVnd,eventId)
  ]);
  const creditedReceipt=await c.env.DB.prepare(`SELECT provider,provider_transaction_id,actual_vnd FROM bank_receipts WHERE topup_id=?`).bind(topup.id).first<{provider:string;provider_transaction_id:string|null;actual_vnd:number}>();
  if(creditedReceipt?.provider==='sepay_pg'&&creditedReceipt.provider_transaction_id===reference&&creditedReceipt.actual_vnd===order.amountVnd){
   try{
    const account=await c.env.DB.prepare('SELECT u.id,u.email,t.code FROM topup_requests t JOIN users u ON u.id=t.user_id WHERE t.id=?').bind(topup.id).first<{id:string;email:string;code:string}>();
    if(account){
     const body=`Khoản nạp ${order.amountVnd}đ đã được SePay xác nhận và cộng vào số dư.`;
     await notifyAccount(c,{userId:account.id,eventKey:`topup-credited:${topup.id}`,kind:'topup',title:'Đã cộng tiền vào số dư',body,href:'/tai-khoan/nap-tien/'+account.code,email:{to:account.email,subject:'Khoản nạp tiền đã được ghi nhận',html:emailShell('Đã ghi nhận khoản nạp',[body],new URL('/tai-khoan/nap-tien/'+account.code,c.req.url).toString(),'Xem số dư'),text:body,key:`topup-credited:${topup.id}`}});
    }
   }catch{
    console.error('sepay_credit_notification_failed',{code:'NOTIFICATION_UNAVAILABLE'});
   }
   return c.json({success:true,credited:true,pending:false});
  }
  if(creditedReceipt){
   await recordSepayException(c,{reference,invoice,topup,amountVnd:order.amountVnd,currency:order.currency,outcome:'already_credited',note:'SePay xác nhận một giao dịch khác cho yêu cầu đã được cộng số dư.'});
   return c.json({success:true,exception:true,pending:false});
  }
  const prior=await c.env.DB.prepare('SELECT outcome FROM sepay_payment_events WHERE provider_reference=?').bind(reference).first<{outcome:string}>();
  return c.json({success:true,replayed:Boolean(prior),pending:Boolean(prior)});
 }catch(error){
  if(/UNIQUE constraint failed|topup_stale|wallet_stale_balance|wallet_requires_ledger|topup_exception_required/i.test(String(error))){
   console.error('sepay_credit_conflict',{code:'FINANCIAL_WRITE_REJECTED'});
   return c.json({success:false,error:'Giao dịch cần được kiểm tra trước khi cộng số dư.'},503);
  }
  throw error;
 }
}
async function processSepayIpn(c:ApiContext):Promise<Response>{
 const config=sepayPgConfig(c.env);if(!config)return c.json({success:false,error:'SePay chưa được cấu hình.'},503);
 const fields=await readSepayNotification(c);if(!fields){console.warn('sepay_ipn_rejected',{reason:'invalid_payload'});return c.json({success:false,error:'Dữ liệu IPN không hợp lệ.'},400);}
 const invoice=inputInvoice(fields);
 if(!invoice){console.info('sepay_ipn_ping_received',{method:c.req.method});return c.json({success:true});}
 const authResult=verifyIpnAuthorization(c.req.header('Authorization')??null,config);if(authResult===false){console.warn('sepay_ipn_rejected',{reason:'authorization'});return c.json({success:false,error:'SePay xác thực không hợp lệ.'},401);}
 const signature=valueString(fields.signature)||c.req.header('X-SePay-Signature')||'';
 const signatureValid=signature?await verifyIpnSignature(fields,signature,config.secretKey):false;
 if(signature&&!signatureValid){console.warn('sepay_ipn_rejected',{reason:'signature'});return c.json({success:false,error:'Chữ ký IPN không hợp lệ.'},401);}
 const merchant=valueString(fields.merchant??fields.merchant_id);
 if(merchant&&merchant!==config.merchantId){console.warn('sepay_ipn_rejected',{reason:'merchant'});return c.json({success:false,error:'Mã merchant không hợp lệ.'},401);}
 if(invoice.length>100){console.warn('sepay_ipn_rejected',{reason:'invoice_length'});return c.json({success:false,error:'Mã đơn hàng không hợp lệ.'},400);}
 // Some SePay notifications may omit credentials. They still cannot credit without
 // an authenticated server-side order lookup, and are rate-limited to prevent
 // arbitrary invoices from amplifying requests to SePay's API.
 if(authResult===null&&!signatureValid){const denied=await limit(c,'sepay-ipn-unverified',clientIp(c),60,60);if(denied)return denied;}
 const callbackRef=valueString(fields.transaction_id??fields.payment_id??fields.order_id??fields.id);
 return processSepayOrder(c,config,invoice,callbackRef,signatureValid,inputAmount(fields),valueString(fields.currency).toUpperCase(),'ipn');
}

router.get('/account/wallet',async(c):Promise<Response>=>{const page=pager(c);if(!page)return fail(c,'Số trang không hợp lệ. Quay lại danh sách và chọn lại trang.');return c.json({...await summary(c,c.get('user').id),ledger:await ledger(c,c.get('user').id,page)});});
router.get('/account/topups',async(c):Promise<Response>=>{
 const page=pager(c);if(!page)return fail(c,'Số trang không hợp lệ. Quay lại danh sách và chọn lại trang.');
 const id=c.get('user').id;
 const [rows,count]=await c.env.DB.batch<Record<string,unknown>>([c.env.DB.prepare(`SELECT ${topupFields} FROM topup_requests t WHERE t.user_id=? ORDER BY t.created_at DESC,t.rowid DESC LIMIT 20 OFFSET ?`).bind(id,(page-1)*20),c.env.DB.prepare('SELECT count(*) AS total FROM topup_requests WHERE user_id=?').bind(id)]);
 return c.json({items:rows.results,total:Number(count.results[0]?.total??0),page,page_size:20});
});
router.post('/account/topups',async(c):Promise<Response>=>{
 const user=c.get('user'),data=await readBody(c);
 if(!amount(data.amount_vnd,5000)||!isUuid(data.request_key))return fail(c,'Nhập số tiền nguyên từ 5.000đ đến 1.000.000đ và tải lại biểu mẫu nếu cần.');
 const old=await c.env.DB.prepare(`SELECT ${topupFields} FROM topup_requests t WHERE user_id=? AND request_key=?`).bind(user.id,data.request_key).first<Topup>();
 if(old)return old.requested_vnd===data.amount_vnd?c.json({topup:old,replayed:true}):fail(c,'Mã gửi yêu cầu đã được sử dụng với số tiền khác.',409);
 const denied=await limit(c,'create-topup',user.id,5,3600);if(denied)return denied;
 const config=await settings(c.env.DB);
 if(!sepayPgConfig(c.env))return fail(c,'Thanh toán SePay chưa được cấu hình đầy đủ. Vui lòng thử lại sau.',503);
 if(!config.accepting_topups)return fail(c,'Chức năng nạp tiền đang tạm đóng. Website chưa nhận thanh toán.',503);
 const profile=await c.env.DB.prepare("SELECT user_id FROM seller_profiles WHERE user_id=? AND status='approved'").bind(user.id).first();
 if(!profile)return fail(c,'Hồ sơ người đăng cần được duyệt trước khi tạo yêu cầu nạp.',403);
 const id=uid(),requestCode=code(),stamp=uid();
 try{
  const results=await c.env.DB.batch([
   c.env.DB.prepare(`INSERT INTO topup_requests(id,code,user_id,request_key,requested_vnd,bank_account_id,bank_code,bank_name,account_number,account_holder,change_token,payment_provider)
    SELECT ?,?,u.id,?,?,b.id,b.bank_code,b.bank_name,b.account_number,b.account_holder,?,'sepay_pg' FROM users u JOIN seller_profiles p ON p.user_id=u.id JOIN payment_settings s ON s.id=1 JOIN receiving_bank_accounts b ON b.id=?
    WHERE u.id=? AND u.is_locked=0 AND u.deleted_at IS NULL AND p.status='approved' AND s.accepting_topups=1
    AND (SELECT count(*) FROM topup_requests WHERE user_id=u.id AND status IN('pending','reported','needs_review'))<3
    ON CONFLICT(user_id,request_key) DO NOTHING`).bind(id,requestCode,data.request_key,data.amount_vnd,stamp,sepayLedgerAccountId,user.id),
   c.env.DB.prepare("INSERT INTO topup_events(id,topup_id,actor_id,action) SELECT ?,id,user_id,'created' FROM topup_requests WHERE id=? AND change_token=?").bind(uid(),id,stamp)
  ]);
  if(results[0].meta.changes!==1){
   const existing=await c.env.DB.prepare(`SELECT ${topupFields} FROM topup_requests t WHERE user_id=? AND request_key=?`).bind(user.id,data.request_key).first<Topup>();
   if(existing)return existing.requested_vnd===data.amount_vnd?c.json({topup:existing,replayed:true}):fail(c,'Mã gửi yêu cầu đã được sử dụng với số tiền khác.',409);
   return fail(c,'Chưa tạo được yêu cầu nạp. Hồ sơ cần được duyệt, website phải đang nhận tiền và bạn chỉ được có tối đa 3 yêu cầu đang chờ. Tải lại trang để kiểm tra trạng thái hiện tại.',409);
  }
  return c.json({topup:await c.env.DB.prepare(`SELECT ${topupFields} FROM topup_requests t WHERE id=?`).bind(id).first()},201);
 }catch(e){return knownError(c,e);}
});
router.post('/account/topups/:code/checkout',async(c):Promise<Response>=>{
 const user=c.get('user'),config=sepayPgConfig(c.env);if(!config)return fail(c,'Thanh toán SePay chưa sẵn sàng. Vui lòng thử lại sau.',503);
 const denied=await limit(c,'sepay-checkout',user.id,20,3600);if(denied)return denied;
 const topup=await c.env.DB.prepare(`SELECT ${topupFields} FROM topup_requests t WHERE t.code=? AND t.user_id=?`).bind(c.req.param('code'),user.id).first<Topup>();
 if(!topup)return fail(c,'Không tìm thấy yêu cầu nạp.',404);
 if(topup.payment_provider!=='sepay_pg')return fail(c,'Yêu cầu này được tạo trước khi chuyển sang thanh toán SePay.',409);
 if(topup.status!=='pending')return fail(c,'Yêu cầu này không còn chờ thanh toán. Tải lại để xem trạng thái mới nhất.',409);
 const origin=new URL(c.req.url).origin,detail=`/tai-khoan/nap-tien/${encodeURIComponent(topup.code)}`;
 const fields=await createCheckoutFields(config,{invoice:topup.code,amountVnd:topup.requested_vnd,successUrl:new URL(detail+'?payment=success',origin).toString(),errorUrl:new URL(detail+'?payment=error',origin).toString(),cancelUrl:new URL(detail+'?payment=cancel',origin).toString()});
 return c.json({checkout_url:checkoutEndpoint(config.environment),fields});
});
router.post('/account/topups/:code/verify',async(c):Promise<Response>=>{
 const user=c.get('user'),code=c.req.param('code');
 const topup=await c.env.DB.prepare('SELECT id,code,payment_provider,status FROM topup_requests WHERE code=? AND user_id=?').bind(code,user.id).first<{id:string;code:string;payment_provider:string;status:string}>();
 if(!topup)return fail(c,'Không tìm thấy yêu cầu nạp.',404);
 if(topup.payment_provider!=='sepay_pg')return fail(c,'Yêu cầu này không sử dụng thanh toán SePay.',409);
 if(topup.status==='credited')return c.json({success:true,credited:true,pending:false,replayed:true});
 if(topup.status==='needs_review')return c.json({success:true,exception:true,pending:false});
 if(topup.status!=='pending')return c.json({success:true,pending:false,status:topup.status});
 const config=sepayPgConfig(c.env);if(!config)return fail(c,'Thanh toán SePay chưa sẵn sàng. Vui lòng thử lại sau.',503);
 const denied=await limit(c,'sepay-return-verify',user.id,20,60);if(denied)return denied;
 // A browser return is only a prompt to check. Credit still requires an authenticated
 // server-side SePay order lookup and the same amount/currency checks as the IPN.
 return processSepayOrder(c,config,topup.code,'',false,0,'','return');
});
router.get('/account/topups/:code',async(c):Promise<Response>=>{
 const topup=await c.env.DB.prepare(`SELECT ${topupFields} FROM topup_requests t WHERE t.code=? AND t.user_id=?`).bind(c.req.param('code'),c.get('user').id).first<Topup>();
 if(!topup)return fail(c,'Không tìm thấy yêu cầu nạp.',404);
 return c.json({topup,events:await events(c,topup.id),qr_available:topup.payment_provider==='manual'&&Boolean(topupQrPayload(topup))});
});
router.get('/account/topups/:code/qr',async(c):Promise<Response>=>{
 const topup=await c.env.DB.prepare(`SELECT ${topupFields} FROM topup_requests t WHERE t.code=? AND t.user_id=?`).bind(c.req.param('code'),c.get('user').id).first<Topup>();
 if(!topup)return fail(c,'Không tìm thấy yêu cầu nạp.',404);
 const payload=topupQrPayload(topup);
 if(!payload)return fail(c,'QR chỉ hiển thị cho yêu cầu chưa báo chuyển, chưa hủy và ngân hàng được hỗ trợ. Kiểm tra lại trạng thái yêu cầu.',409);
 return c.body(topupQrSvg(payload),200,{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'private, no-store','Cross-Origin-Resource-Policy':'same-origin','X-Robots-Tag':'noindex'});
});
for(const action of ['report','cancel'] as const)router.post('/account/topups/:code/'+action,async(c):Promise<Response>=>{
 const data=await readBody(c),user=c.get('user');if(!version(data.version))return fail(c,'Yêu cầu đã thay đổi. Tải lại trang để lấy thông tin mới nhất rồi thử lại.',409);if(text(data.note).length>500)return fail(c,'Ghi chú tối đa 500 ký tự. Rút gọn ghi chú rồi thử lại.');
 if(action==='report'){
  const request=await c.env.DB.prepare('SELECT payment_provider FROM topup_requests WHERE code=? AND user_id=?').bind(c.req.param('code'),user.id).first<{payment_provider:string}>();
  if(request?.payment_provider==='sepay_pg')return fail(c,'Thanh toán SePay được xác nhận tự động. Bạn không cần báo đã chuyển khoản.',409);
 }
 const denied=await limit(c,'topup-action',user.id,30,3600);if(denied)return denied;
 const stamp=uid(),status=action==='report'?'reported':'cancelled';
 const results=await c.env.DB.batch([
  c.env.DB.prepare(`UPDATE topup_requests SET status=?,customer_note=?,version=version+1,change_token=?,updated_at=unixepoch(),${action==='report'?'reported_at':'cancelled_at'}=unixepoch() WHERE code=? AND user_id=? AND version=? AND status='pending' AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_locked=0 AND deleted_at IS NULL)`).bind(status,text(data.note),stamp,c.req.param('code'),user.id,Number(data.version),user.id),
  c.env.DB.prepare('INSERT INTO topup_events(id,topup_id,actor_id,action,note) SELECT ?,id,?,?,? FROM topup_requests WHERE code=? AND user_id=? AND change_token=?').bind(uid(),user.id,status,text(data.note),c.req.param('code'),user.id,stamp)
 ]);
 return results[0].meta.changes===1?c.json({ok:true}):stale(c);
});

router.get('/cms/payments',requirePermission('payments.read'),async(c):Promise<Response>=>{
 const sepay=sepayPgConfig(c.env);
 return c.json({settings:await settings(c.env.DB),sepay:{configured:Boolean(sepay),environment:sepay?.environment??null}});
});
router.post('/cms/payments',requirePermission('payments.update'),async(c):Promise<Response>=>{
 const data=await readBody(c);if(!version(data.version)||typeof data.accepting_topups!=='boolean')return fail(c,'Thông tin cấu hình chưa hợp lệ.');
 if(['bank_code','bank_name','account_number','account_holder'].some(key=>text(data[key])))return fail(c,'Thông tin ngân hàng và QR được quản lý tại SePay. CMS chỉ bật hoặc tắt yêu cầu nạp.');
 if(data.accepting_topups&&!sepayPgConfig(c.env))return fail(c,'Chưa thể mở nhận nạp vì SePay chưa được cấu hình đầy đủ.',503);
 const denied=await limit(c,'payment-config',c.get('user').id,20,3600);if(denied)return denied;
 const stamp=uid();
 const statements=[c.env.DB.prepare('UPDATE payment_settings SET version=version+1,change_token=?,updated_at=unixepoch(),accepting_topups=? WHERE id=1 AND version=?').bind(stamp,data.accepting_topups?1:0,Number(data.version))];
 statements.push(c.env.DB.prepare("INSERT INTO admin_audit(id,actor_id,action,target_id,note) SELECT ?,?,'payments.update','payment-settings','Cập nhật cấu hình nhận tiền; chi tiết theo quyền tài chính.' WHERE EXISTS(SELECT 1 FROM payment_settings WHERE id=1 AND change_token=?)").bind(uid(),c.get('user').id,stamp));
 const results=await c.env.DB.batch(statements);return results[0].meta.changes===1?c.json({ok:true}):stale(c);
});
router.get('/cms/topups',requirePermission('topups.read'),async(c):Promise<Response>=>{
 const page=pager(c),status=c.req.query('status')??'waiting',q=(c.req.query('q')??'').trim().slice(0,100);
 if(!page||!['all','waiting','pending','reported','needs_review','credited','cancelled'].includes(status))return fail(c,'Trạng thái hoặc số trang không hợp lệ. Chọn lại bộ lọc rồi tải danh sách.');
 const where=`WHERE (instr(t.code,upper(?))>0 OR instr(lower(u.name),lower(?))>0 OR instr(lower(u.email),lower(?))>0)${status==='all'?'':status==='waiting'?" AND t.status IN('reported','needs_review') AND NOT (t.payment_provider='sepay_pg' AND EXISTS(SELECT 1 FROM sepay_payment_events e WHERE e.topup_id=t.id AND e.outcome!='credited' AND e.reviewed_at IS NULL))":" AND t.status=?"}`;
 const args=['all','waiting'].includes(status)?[q,q,q]:[q,q,q,status];
 const [items,count]=await c.env.DB.batch<Record<string,unknown>>([
  c.env.DB.prepare(`SELECT ${topupFields},u.name AS user_name,u.email AS user_email,u.is_locked,u.deleted_at AS user_deleted_at FROM topup_requests t JOIN users u ON u.id=t.user_id ${where} ORDER BY t.created_at,t.rowid LIMIT 20 OFFSET ?`).bind(...args,(page-1)*20),c.env.DB.prepare(`SELECT count(*) AS total FROM topup_requests t JOIN users u ON u.id=t.user_id ${where}`).bind(...args)
 ]);
 return c.json({items:items.results,total:Number(count.results[0]?.total??0),page,page_size:20});
});
router.get('/cms/sepay-exceptions',requirePermission('topups.read'),async(c):Promise<Response>=>{
 const items=(await c.env.DB.prepare(`SELECT e.id,e.provider_reference,e.order_invoice_number,e.amount_vnd,e.currency,e.outcome,e.note,e.received_at,e.reviewed_at,e.review_note,t.id AS topup_id,t.code AS topup_code,t.status AS topup_status,u.name AS user_name,u.email AS user_email
  FROM sepay_payment_events e LEFT JOIN topup_requests t ON t.id=e.topup_id LEFT JOIN users u ON u.id=t.user_id
  WHERE e.outcome!='credited' AND e.reviewed_at IS NULL ORDER BY e.received_at DESC,e.id DESC LIMIT 100`).all()).results;
 return c.json({items});
});
router.post('/cms/sepay-exceptions/:id/review',requirePermission('topups.reconcile'),async(c):Promise<Response>=>{
 const actor=c.get('user'),data=await readBody(c),note=text(data.note);
 if(note.length<5||note.length>1000)return fail(c,'Nhập ghi chú xử lý ngoại lệ từ 5 đến 1.000 ký tự.');
 const id=c.req.param('id');
 const exception=await c.env.DB.prepare('SELECT topup_id,outcome FROM sepay_payment_events WHERE id=?').bind(id).first<{topup_id:string|null;outcome:string}>();
 if(!exception)return fail(c,'Không tìm thấy giao dịch ngoại lệ.',404);
 if(exception.topup_id&&exception.outcome!=='already_credited')return fail(c,'Mở yêu cầu liên quan để xác minh khoản tiền và ghi nhận hoặc xử lý giao dịch. Không thể đóng ngoại lệ đang gắn với yêu cầu chưa xử lý.',409);
 const result=await c.env.DB.batch([
  c.env.DB.prepare("UPDATE sepay_payment_events SET reviewed_at=unixepoch(),reviewed_by=?,review_note=? WHERE id=? AND outcome!='credited' AND reviewed_at IS NULL").bind(actor.id,note,id),
  c.env.DB.prepare(`INSERT INTO admin_audit(id,actor_id,action,target_id,note) SELECT ?,?,'payment.sepay_exception_review',id,? FROM sepay_payment_events WHERE id=? AND reviewed_by=? AND review_note=?`).bind(uid(),actor.id,note,id,actor.id,note)
 ]);
 return result[0].meta.changes===1?c.json({ok:true}):fail(c,'Ngoại lệ không tồn tại hoặc đã được ghi nhận là đã kiểm tra.',409);
});
router.get('/cms/topups/:id',requirePermission('topups.read'),async(c):Promise<Response>=>{
 const topup=await c.env.DB.prepare(`SELECT ${topupFields},u.name AS user_name,u.email AS user_email,u.is_locked,u.deleted_at AS user_deleted_at FROM topup_requests t JOIN users u ON u.id=t.user_id WHERE t.id=?`).bind(c.req.param('id')).first<Topup>();
 if(!topup)return fail(c,'Không tìm thấy yêu cầu.',404);
 const receipt=await c.env.DB.prepare(`SELECT r.actual_vnd,r.bank_reference,r.note,r.created_at,r.provider,r.provider_transaction_id,u.name AS reviewer_name,b.bank_name,b.account_number,b.account_holder FROM bank_receipts r JOIN users u ON u.id=r.reviewed_by LEFT JOIN receiving_bank_accounts b ON b.id=r.bank_account_id WHERE r.topup_id=?`).bind(topup.id).first();
 const sepay_exception=await c.env.DB.prepare(`SELECT id,provider_reference,amount_vnd,currency,outcome,note,received_at FROM sepay_payment_events WHERE topup_id=? AND outcome!='credited' AND reviewed_at IS NULL ORDER BY received_at DESC LIMIT 1`).bind(topup.id).first();
 return c.json({topup,receipt,sepay_exception,events:await events(c,topup.id),accounts:(await c.env.DB.prepare('SELECT id,bank_name,account_number,account_holder FROM receiving_bank_accounts WHERE id!=? ORDER BY created_at DESC').bind(sepayLedgerAccountId).all()).results});
});
router.post('/cms/topups/:id/review',requirePermission('topups.reconcile'),async(c):Promise<Response>=>{
 const data=await readBody(c),action=text(data.action),note=text(data.note),actor=c.get('user');
 if(!version(data.version)||!['needs_review','cancelled'].includes(action)||note.length<5||note.length>1000)return fail(c,'Chọn trạng thái và nhập lý do 5–1000 ký tự.');
 const denied=await limit(c,'financial-review',actor.id,60,3600);if(denied)return denied;
 const stamp=uid();
 const result=await c.env.DB.batch([
  c.env.DB.prepare(`UPDATE topup_requests SET status=?,review_note=?,version=version+1,updated_at=unixepoch(),change_token=?${action==='cancelled'?',cancelled_at=unixepoch()':''} WHERE id=? AND version=? AND status!='credited' AND status!=? AND user_id!=?`).bind(action,note,stamp,c.req.param('id'),Number(data.version),action,actor.id),
  c.env.DB.prepare('INSERT INTO topup_events(id,topup_id,actor_id,action,note) SELECT ?,id,?,?,? FROM topup_requests WHERE id=? AND change_token=?').bind(uid(),actor.id,action,note,c.req.param('id'),stamp),
  c.env.DB.prepare(`INSERT INTO admin_audit(id,actor_id,action,target_id,note) SELECT ?,?,?,id,'Chi tiết trong yêu cầu nạp theo quyền tài chính.' FROM topup_requests WHERE id=? AND change_token=?`).bind(uid(),actor.id,'topup.'+action,c.req.param('id'),stamp)
 ]);
 if(result[0].meta.changes!==1)return stale(c);
 const account=await c.env.DB.prepare('SELECT u.email,t.code FROM topup_requests t JOIN users u ON u.id=t.user_id WHERE t.id=?').bind(c.req.param('id')).first<{email:string;code:string}>();
 if(account){const body=action==='cancelled'?'Yêu cầu nạp tiền đã được hủy.':'Yêu cầu nạp tiền cần được kiểm tra thêm. Mở chi tiết để xem trạng thái.';sendNotificationEmail(c,{to:account.email,subject:action==='cancelled'?'Yêu cầu nạp tiền đã hủy':'Cập nhật yêu cầu nạp tiền',html:emailShell(action==='cancelled'?'Yêu cầu nạp đã hủy':'Yêu cầu nạp cần kiểm tra',[body],new URL('/tai-khoan/nap-tien/'+account.code,c.req.url).toString(),'Xem yêu cầu'),text:body,key:`topup-review:${c.req.param('id')}:${data.version}:${action}`});}
 return c.json({ok:true});
});
router.post('/cms/topups/:id/reconcile',requirePermission('topups.reconcile'),async(c):Promise<Response>=>{
 const data=await readBody(c),actor=c.get('user'),note=text(data.note),id=c.req.param('id');
 if(!version(data.version)||!amount(data.actual_vnd)||typeof data.bank_account_id!=='string'||note.length>1000||data.verified!==true)return fail(c,'Nhập số tiền thực nhận, tài khoản nhận và xác nhận đã kiểm tra giao dịch.');
 const denied=await limit(c,'financial-reconcile',actor.id,60,3600);if(denied)return denied;
 const topup=await c.env.DB.prepare('SELECT id,code,payment_provider,bank_account_id,status,version,requested_vnd FROM topup_requests WHERE id=?').bind(id).first<{id:string;code:string;payment_provider:string;bank_account_id:string;status:string;version:number;requested_vnd:number}>();
 if(!topup)return fail(c,'Không tìm thấy yêu cầu nạp.',404);
 let bankRef=reference(data.bank_reference),provider='manual',providerTransactionId:string|null=null,exceptionId:string|null=null,expectedBankId=topup.bank_account_id;
 if(topup.payment_provider==='sepay_pg'||text(data.provider_transaction_id)){
  const exception=await c.env.DB.prepare(`SELECT id,provider_reference,amount_vnd,currency,outcome FROM sepay_payment_events WHERE topup_id=? AND outcome!='credited' AND reviewed_at IS NULL AND provider_reference=?`).bind(id,text(data.provider_transaction_id)).first<{id:string;provider_reference:string;amount_vnd:number;currency:string;outcome:string}>();
  if(!exception)return fail(c,'Không tìm thấy giao dịch SePay đang chờ xử lý cho yêu cầu này.',409);
  if(exception.currency!=='VND'||exception.amount_vnd!==data.actual_vnd)return fail(c,'Số tiền nhập không khớp khoản SePay đã xác minh. Không thể cộng số dư tự động.',409);
  if(data.bank_account_id!==topup.bank_account_id)return fail(c,'Tài khoản nhận không khớp với yêu cầu nạp ban đầu.',409);
  if(exception.outcome==='amount_mismatch'||exception.outcome==='cancelled_request'||exception.outcome==='legacy_request'||exception.outcome==='request_not_pending'){
   if(data.exception_confirmed!==true||note.length<10)return fail(c,'Xác nhận ngoại lệ và nhập lý do ít nhất 10 ký tự.');
  }
  provider='sepay_pg';providerTransactionId=exception.provider_reference;exceptionId=exception.id;
  bankRef='SEPAY'+(await sha256(exception.provider_reference)).slice(0,60).toUpperCase();
 }else{
  if(data.bank_account_id!==topup.bank_account_id)return fail(c,'Tài khoản nhận không khớp với yêu cầu nạp ban đầu.',409);
  if(!/^[A-Z0-9]{4,100}$/.test(bankRef))return fail(c,'Nhập mã giao dịch ngân hàng gồm 4–100 ký tự chữ hoặc số.');
 }
 const prior=await c.env.DB.prepare('SELECT bank_account_id,bank_reference,actual_vnd,provider,provider_transaction_id FROM bank_receipts WHERE topup_id=?').bind(id).first<{bank_account_id:string;bank_reference:string;actual_vnd:number;provider:string;provider_transaction_id:string|null}>();
 if(prior)return prior.bank_account_id===data.bank_account_id&&prior.actual_vnd===data.actual_vnd&&(provider==='sepay_pg'?prior.provider_transaction_id===providerTransactionId:prior.bank_reference===bankRef)?c.json({ok:true,replayed:true}):fail(c,'Yêu cầu đã được ghi nhận với thông tin khác. Dùng bút toán điều chỉnh nếu cần sửa sai.',409);
 if(!await c.env.DB.prepare('SELECT id FROM receiving_bank_accounts WHERE id=?').bind(data.bank_account_id).first())return fail(c,'Tài khoản nhận tiền không hợp lệ.');
 try{
  const receiptId=uid();
  const receiptSql=exceptionId
   ?`INSERT INTO bank_receipts(id,topup_id,bank_account_id,bank_reference,actual_vnd,reviewed_by,expected_version,exception_confirmed,note,provider,provider_transaction_id) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND is_locked=0 AND deleted_at IS NULL) AND EXISTS(SELECT 1 FROM sepay_payment_events WHERE id=? AND reviewed_at IS NULL)`
   :`INSERT INTO bank_receipts(id,topup_id,bank_account_id,bank_reference,actual_vnd,reviewed_by,expected_version,exception_confirmed,note,provider,provider_transaction_id) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND is_locked=0 AND deleted_at IS NULL)`;
  const receiptStatement=exceptionId
   ?c.env.DB.prepare(receiptSql).bind(receiptId,id,expectedBankId,bankRef,data.actual_vnd,actor.id,Number(data.version),data.exception_confirmed===true?1:0,note,provider,providerTransactionId,actor.id,exceptionId)
   :c.env.DB.prepare(receiptSql).bind(receiptId,id,expectedBankId,bankRef,data.actual_vnd,actor.id,Number(data.version),data.exception_confirmed===true?1:0,note,provider,providerTransactionId,actor.id);
  const statements=[receiptStatement];
  if(exceptionId)statements.push(
   c.env.DB.prepare("UPDATE sepay_payment_events SET reviewed_at=unixepoch(),reviewed_by=?,review_note=? WHERE id=? AND reviewed_at IS NULL").bind(actor.id,note,exceptionId),
   c.env.DB.prepare("INSERT INTO admin_audit(id,actor_id,action,target_id,note) SELECT ?,?,'payment.sepay_exception_review',id,? FROM sepay_payment_events WHERE id=? AND reviewed_by=? AND review_note=?").bind(uid(),actor.id,note,exceptionId,actor.id,note)
  );
  const result=await c.env.DB.batch(statements);if(result[0].meta.changes<1)return stale(c);
  const account=await c.env.DB.prepare('SELECT u.email,t.code,t.requested_vnd FROM topup_requests t JOIN users u ON u.id=t.user_id WHERE t.id=?').bind(id).first<{email:string;code:string;requested_vnd:number}>();
  if(account){const body='Khoản nạp '+data.actual_vnd+'đ đã được ghi nhận vào số dư.';sendNotificationEmail(c,{to:account.email,subject:'Khoản nạp tiền đã được ghi nhận',html:emailShell('Đã ghi nhận khoản nạp',[body],new URL('/tai-khoan/nap-tien/'+account.code,c.req.url).toString(),'Xem số dư'),text:body,key:`topup-credited:${id}`});}
  return c.json({ok:true});
 }catch(e){return knownError(c,e);}
});
router.get('/cms/wallets',requirePermission('wallets.read'),async(c):Promise<Response>=>{
 const page=pager(c),q=(c.req.query('q')??'').slice(0,100);if(!page)return fail(c,'Số trang không hợp lệ. Quay lại danh sách và chọn lại trang.');
 const where='WHERE (instr(lower(u.name),lower(?))>0 OR instr(lower(u.email),lower(?))>0)';
 const [items,count]=await c.env.DB.batch<Record<string,unknown>>([
  c.env.DB.prepare(`SELECT u.id,u.name,u.email,u.is_locked,u.deleted_at,COALESCE(w.balance_vnd,0) AS balance_vnd,COALESCE((SELECT sum(r.amount_vnd) FROM withdrawal_requests r WHERE r.user_id=u.id AND r.status IN('pending','approved')),0) AS held_vnd,COALESCE(p.free_posts_total-p.free_posts_used,3) AS free_posts_remaining FROM users u LEFT JOIN wallet_accounts w ON w.user_id=u.id LEFT JOIN posting_promotions p ON p.user_id=u.id ${where} AND u.id!='sepay-ipn-system' ORDER BY COALESCE(w.balance_vnd,0) DESC,u.created_at DESC,u.id LIMIT 20 OFFSET ?`).bind(q,q,(page-1)*20),
  c.env.DB.prepare(`SELECT count(*) AS total FROM users u ${where} AND u.id!='sepay-ipn-system'`).bind(q,q)
 ]);
 return c.json({items:items.results,total:Number(count.results[0]?.total??0),page,page_size:20});
});
router.get('/cms/wallets/:id',requirePermission('wallets.read'),async(c):Promise<Response>=>{
 const page=pager(c);if(!page)return fail(c,'Số trang không hợp lệ. Quay lại danh sách và chọn lại trang.');const id=c.req.param('id');
 const user=await c.env.DB.prepare("SELECT id,name,email,is_locked,deleted_at FROM users WHERE id=? AND id!='sepay-ipn-system'").bind(id).first();if(!user)return fail(c,'Không tìm thấy tài khoản.',404);
 return c.json({user,...await summary(c,id),ledger:await ledger(c,id,page)});
});
router.post('/cms/wallets/:id/adjust',requirePermission('wallets.adjust'),async(c):Promise<Response>=>{
 const data=await readBody(c),actor=c.get('user'),id=c.req.param('id'),note=text(data.note);
 if(!amount(data.amount_vnd,-1000000,1000000)||data.amount_vnd===0||note.length<10||note.length>1000||!isUuid(data.request_key)||data.confirmed!==true)return fail(c,'Nhập mức điều chỉnh khác 0 (tối đa ±1.000.000đ), lý do 10–1000 ký tự và xác nhận.');
 if(id===actor.id)return fail(c,'Không được tự điều chỉnh số dư của mình.',403);
 const key='adjust:'+actor.id+':'+data.request_key;
 const old=await c.env.DB.prepare('SELECT user_id,amount_vnd,description FROM wallet_entries WHERE idempotency_key=?').bind(key).first<{user_id:string;amount_vnd:number;description:string}>();
 if(old)return old.user_id===id&&old.amount_vnd===data.amount_vnd&&old.description===note?c.json({ok:true,replayed:true}):fail(c,'Mã thao tác đã được dùng cho nội dung khác.',409);
 const denied=await limit(c,'financial-adjust',actor.id,30,3600);if(denied)return denied;
 if(!await c.env.DB.prepare('SELECT id FROM users WHERE id=?').bind(id).first())return fail(c,'Không tìm thấy tài khoản.',404);
 try{
  const result=await c.env.DB.prepare(`INSERT INTO wallet_entries(id,user_id,actor_id,kind,amount_vnd,balance_before_vnd,balance_after_vnd,idempotency_key,description) SELECT ?,u.id,?,'adjustment',?,COALESCE(w.balance_vnd,0),COALESCE(w.balance_vnd,0)+?,?,? FROM users u LEFT JOIN wallet_accounts w ON w.user_id=u.id WHERE u.id=? AND EXISTS(SELECT 1 FROM users a WHERE a.id=? AND a.is_locked=0 AND a.deleted_at IS NULL)`).bind(uid(),actor.id,data.amount_vnd,data.amount_vnd,key,note,id,actor.id).run();
  return result.meta.changes>=1?c.json({ok:true}):stale(c);
 }catch(e){return knownError(c,e);}
});
export default router;
