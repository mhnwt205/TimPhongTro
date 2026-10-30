import {Hono} from 'hono';
import type {ApiContext,ApiEnv} from './security';
import {readBody,requireUser,requireAdmin,requirePermission,limit} from './security';
import {verifyPassword} from './password';
import {canonicalBankName} from './banks';
import {text} from './responses';
import {can} from './permissions';
import {withdrawalQrPayload} from './withdrawal-qr';
import {topupQrSvg} from './topup-qr';
import {emailShell} from './email';
import {sendNotificationEmail} from './notifications';
export type Withdrawal={id:string;code:string;user_id:string;amount_vnd:number;bank_code:string;bank_name:string;account_number:string;account_holder:string;status:'pending'|'approved'|'paid'|'rejected'|'cancelled';customer_note:string;review_note:string;version:number;created_at:number;updated_at:number;processor_id:string|null;processor_name?:string;user_name?:string;user_email?:string;is_locked?:number;user_deleted_at?:number|null};
export type WithdrawalPayout={sender_bank_code:string;sender_account_number:string;bank_reference:string;amount_vnd:number;note:string;created_at:number;actor_name:string};
const router=new Hono<ApiEnv>();
router.use('/account/*',requireUser);
router.use('/cms/*',requireUser,requireAdmin);
const uid=()=>crypto.randomUUID();
const fields='r.id,r.code,r.user_id,r.amount_vnd,r.bank_code,r.bank_name,r.account_number,r.account_holder,r.status,r.customer_note,r.review_note,r.version,r.created_at,r.updated_at,r.processor_id';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const validVersion=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
const fail=(c:ApiContext,error:string,status:400|403|404|409=400)=>c.json({error},status);
const stale=(c:ApiContext)=>fail(c,'Yêu cầu đã được xử lý hoặc thay đổi. Tải lại trang để kiểm tra.',409);
const pager=(c:ApiContext)=>{const n=Number(c.req.query('page')??1);return Number.isSafeInteger(n)&&n>=1&&n<=10000?n:null;};
function code(){const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return 'RUT'+Array.from(crypto.getRandomValues(new Uint8Array(12)),n=>a[n&31]).join('');}
function knownError(c:ApiContext,error:unknown){
 const message=String(error);
 if(/withdrawal_claimed/.test(message))return fail(c,'Yêu cầu đang do quản trị viên khác xử lý. Không chuyển khoản hoặc hoàn khoản giữ.',409);
 if(/withdrawal_self_review/.test(message))return fail(c,'Không được tự xét duyệt yêu cầu rút của mình.',403);
 if(/UNIQUE constraint failed: withdrawal_payouts.sender/.test(message))return fail(c,'Mã giao dịch này đã được dùng cho một khoản chuyển từ tài khoản đó. Kiểm tra trước khi xác nhận.',409);
 if(/CHECK constraint failed:.*balance|wallet_stale_balance|wallet_requires_ledger/.test(message))return fail(c,'Số dư khả dụng không đủ hoặc đã thay đổi. Tải lại để kiểm tra.',409);
 if(/UNIQUE constraint failed|withdrawal_stale/.test(message))return stale(c);
 throw error;
}
async function detail(c:ApiContext,r:Withdrawal,cms=false){
 const events=(await c.env.DB.prepare('SELECT e.id,e.action,e.note,e.created_at,u.name AS actor_name FROM withdrawal_events e JOIN users u ON u.id=e.actor_id WHERE withdrawal_id=? ORDER BY e.created_at,e.rowid').bind(r.id).all()).results;
 const p=await c.env.DB.prepare('SELECT p.sender_bank_code,p.sender_account_number,p.bank_reference,p.amount_vnd,p.note,p.created_at,u.name AS actor_name FROM withdrawal_payouts p JOIN users u ON u.id=p.actor_id WHERE withdrawal_id=?').bind(r.id).first<WithdrawalPayout>();
 // The sender account is only needed by authorized finance operators.
 const payout=p&&(!cms?{bank_reference:p.bank_reference,amount_vnd:p.amount_vnd,note:p.note,created_at:p.created_at}:p);
 if(cms&&r.processor_id){const actor=await c.env.DB.prepare('SELECT name FROM users WHERE id=?').bind(r.processor_id).first<{name:string}>();r.processor_name=actor?.name;}
 const actor=c.get('user');
 const qr_available=cms&&r.user_id!==actor.id&&r.processor_id===actor.id&&can(actor,'withdrawals.pay')&&Boolean(withdrawalQrPayload(r));
 return {withdrawal:r,events,payout,...(cms?{qr_available}:{})};
}
router.get('/account/withdrawals',async(c):Promise<Response>=>{
 const page=pager(c);if(!page)return fail(c,'Số trang không hợp lệ. Quay lại danh sách và chọn lại trang.');
 const [items,count]=await c.env.DB.batch<Record<string,unknown>>([
  c.env.DB.prepare(`SELECT ${fields} FROM withdrawal_requests r WHERE user_id=? ORDER BY created_at DESC,r.rowid DESC LIMIT 20 OFFSET ?`).bind(c.get('user').id,(page-1)*20),
  c.env.DB.prepare('SELECT count(*) AS total FROM withdrawal_requests WHERE user_id=?').bind(c.get('user').id)]);
 return c.json({items:items.results,total:Number(count.results[0]?.total??0),page,page_size:20});
});
router.post('/account/withdrawals',async(c):Promise<Response>=>{
 const user=c.get('user'),data=await readBody(c),bankCode=text(data.bank_code).toUpperCase(),bankName=canonicalBankName(bankCode),number=text(data.account_number).replace(/\s/g,''),holder=text(data.account_holder).replace(/\s+/g,' '),note=text(data.note);
 if(typeof data.amount_vnd!=='number'||!Number.isSafeInteger(data.amount_vnd)||data.amount_vnd<5000||data.amount_vnd>1000000||!uuid(data.request_key)||!bankName||!/^\d{6,24}$/.test(number)||holder.length<2||holder.length>100||note.length>500||data.confirmed!==true)return fail(c,'Nhập số tiền nguyên 5.000–1.000.000đ, ngân hàng, số tài khoản 6–24 chữ số, tên chủ tài khoản và xác nhận thông tin.');
 const prior=await c.env.DB.prepare(`SELECT ${fields} FROM withdrawal_requests r WHERE user_id=? AND request_key=?`).bind(user.id,data.request_key).first<Withdrawal>();
 const replay=(r:Withdrawal)=>r.amount_vnd===data.amount_vnd&&r.bank_code===bankCode&&r.account_number===number&&r.account_holder===holder&&r.customer_note===note?c.json({withdrawal:r,replayed:true}):fail(c,'Mã gửi yêu cầu đã dùng cho thông tin khác.',409);
 if(prior)return replay(prior);
 const denied=await limit(c,'withdrawal-create',user.id,5,900);if(denied)return denied;
 const password=typeof data.current_password==='string'?data.current_password:'';
 if(password.length<1||password.length>128)return fail(c,'Nhập mật khẩu hiện tại để xác nhận yêu cầu rút.');
 const credentials=await c.env.DB.prepare('SELECT password_hash FROM users WHERE id=?').bind(user.id).first<{password_hash:string}>();
 if(!credentials||!await verifyPassword(password,credentials.password_hash))return fail(c,'Mật khẩu hiện tại chưa đúng.');
 const id=uid();
 try{
  const result=await c.env.DB.prepare(`INSERT INTO withdrawal_requests(id,code,user_id,request_key,amount_vnd,bank_code,bank_name,account_number,account_holder,customer_note,last_actor_id,change_token)
   SELECT ?,?,id,?,?,?,?,?,?,?,id,? FROM users WHERE id=? AND is_locked=0 AND deleted_at IS NULL AND password_hash=?
   AND (SELECT count(*) FROM withdrawal_requests WHERE user_id=users.id AND status IN('pending','approved'))<3
   ON CONFLICT(user_id,request_key) DO NOTHING`).bind(id,code(),data.request_key,data.amount_vnd,bankCode,bankName,number,holder,note,uid(),user.id,credentials.password_hash).run();
  const created=await c.env.DB.prepare(`SELECT ${fields} FROM withdrawal_requests r WHERE user_id=? AND request_key=?`).bind(user.id,data.request_key).first<Withdrawal>();
  if(!created)return fail(c,'Chưa tạo được yêu cầu: tối đa 3 yêu cầu đang chờ, hoặc tài khoản vừa thay đổi.',409);
  return created.id===id&&result.meta.changes>=1?c.json({withdrawal:created},201):replay(created);
 }catch(e){return knownError(c,e);}
});
router.get('/account/withdrawals/:code',async(c):Promise<Response>=>{
 const r=await c.env.DB.prepare(`SELECT ${fields} FROM withdrawal_requests r WHERE code=? AND user_id=?`).bind(c.req.param('code'),c.get('user').id).first<Withdrawal>();
 return r?c.json(await detail(c,r)):fail(c,'Không tìm thấy yêu cầu rút.',404);
});
router.post('/account/withdrawals/:code/cancel',async(c):Promise<Response>=>{
 const data=await readBody(c);if(!validVersion(data.version)||data.confirmed!==true)return fail(c,'Xác nhận hủy và tải lại phiên bản yêu cầu.');
 const denied=await limit(c,'withdrawal-cancel',c.get('user').id,30,3600);if(denied)return denied;
 try{
  const result=await c.env.DB.prepare("UPDATE withdrawal_requests SET status='cancelled',last_actor_id=?,review_note='Người dùng hủy trước khi được duyệt.',version=version+1,updated_at=unixepoch(),change_token=? WHERE code=? AND user_id=? AND version=? AND status='pending'").bind(c.get('user').id,uid(),c.req.param('code'),c.get('user').id,data.version).run();
  return result.meta.changes>=1?c.json({ok:true}):stale(c);
 }catch(e){return knownError(c,e);}
});
router.get('/cms/withdrawals',requirePermission('withdrawals.read'),async(c):Promise<Response>=>{
 const page=pager(c),status=c.req.query('status')??'waiting',q=(c.req.query('q')??'').trim().slice(0,100);
 if(!page||!['waiting','all','pending','approved','paid','rejected','cancelled'].includes(status))return fail(c,'Trạng thái hoặc số trang không hợp lệ. Chọn lại bộ lọc rồi tải danh sách.');
 const where=`WHERE (instr(r.code,upper(?))>0 OR instr(lower(u.name),lower(?))>0 OR instr(lower(u.email),lower(?))>0)${status==='all'?'':status==='waiting'?" AND r.status IN('pending','approved')":" AND r.status=?"}`;
 const args=['waiting','all'].includes(status)?[q,q,q]:[q,q,q,status];
 const [items,count]=await c.env.DB.batch<Record<string,unknown>>([
  c.env.DB.prepare(`SELECT ${fields},u.name AS user_name,u.email AS user_email,u.is_locked,u.deleted_at AS user_deleted_at FROM withdrawal_requests r JOIN users u ON u.id=r.user_id ${where} ORDER BY r.created_at,r.rowid LIMIT 20 OFFSET ?`).bind(...args,(page-1)*20),
  c.env.DB.prepare(`SELECT count(*) AS total FROM withdrawal_requests r JOIN users u ON u.id=r.user_id ${where}`).bind(...args)]);
 return c.json({items:items.results,total:Number(count.results[0]?.total??0),page,page_size:20});
});
router.get('/cms/withdrawals/:id',requirePermission('withdrawals.read'),async(c):Promise<Response>=>{
 const r=await c.env.DB.prepare(`SELECT ${fields},u.name AS user_name,u.email AS user_email,u.is_locked,u.deleted_at AS user_deleted_at FROM withdrawal_requests r JOIN users u ON u.id=r.user_id WHERE r.id=?`).bind(c.req.param('id')).first<Withdrawal>();
 return r?c.json(await detail(c,r,true)):fail(c,'Không tìm thấy yêu cầu rút.',404);
});
router.get('/cms/withdrawals/:id/qr',requirePermission('withdrawals.read'),requirePermission('withdrawals.pay'),async(c):Promise<Response>=>{
 const r=await c.env.DB.prepare(`SELECT ${fields} FROM withdrawal_requests r WHERE r.id=?`).bind(c.req.param('id')).first<Withdrawal>();
 if(!r)return fail(c,'Không tìm thấy yêu cầu rút.',404);
 const actor=c.get('user');
 if(r.user_id===actor.id)return fail(c,'Không được tự xử lý yêu cầu rút của mình.',403);
 const version=Number(c.req.query('version'));
 if(!Number.isSafeInteger(version)||version<1)return fail(c,'Tải lại trang để lấy mã QR của yêu cầu hiện tại.');
 if(r.status!=='approved'||r.processor_id!==actor.id||r.version!==version)return fail(c,'Yêu cầu đã thay đổi hoặc không do bạn xử lý. Tải lại trang trước khi chuyển tiền.',409);
 const payload=withdrawalQrPayload(r);
 if(!payload)return fail(c,'Chưa tạo được QR cho ngân hàng này. Chuyển khoản theo thông tin nhận tiền của yêu cầu.',409);
 return c.body(topupQrSvg(payload),200,{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'private, no-store','Cross-Origin-Resource-Policy':'same-origin','X-Robots-Tag':'noindex'});
});
router.post('/cms/withdrawals/:id/review',requirePermission('withdrawals.review'),async(c):Promise<Response>=>{
 const data=await readBody(c),note=text(data.note),action=text(data.action),actor=c.get('user');
 if(!validVersion(data.version)||!['approved','rejected'].includes(action)||note.length>1000||data.confirmed!==true)return fail(c,'Chọn thao tác và xác nhận thông tin yêu cầu.');
 if(action==='rejected'&&(note.length<10||data.not_transferred!==true))return fail(c,'Từ chối cần lý do ít nhất 10 ký tự và xác nhận chưa chuyển tiền.');
 const denied=await limit(c,'withdrawal-review',actor.id,60,3600);if(denied)return denied;
 try{
  const result=await c.env.DB.prepare(`UPDATE withdrawal_requests SET status=?,last_actor_id=?,review_note=?,version=version+1,updated_at=unixepoch(),change_token=? WHERE id=? AND version=? AND user_id!=? AND ${action==='approved'?"status='pending' AND EXISTS(SELECT 1 FROM users u WHERE u.id=withdrawal_requests.user_id AND u.is_locked=0 AND u.deleted_at IS NULL)":"status IN('pending','approved')"}`).bind(action,actor.id,note,uid(),c.req.param('id'),data.version,actor.id).run();
  if(result.meta.changes<1)return stale(c);
  const account=await c.env.DB.prepare('SELECT u.email,r.code,r.amount_vnd FROM withdrawal_requests r JOIN users u ON u.id=r.user_id WHERE r.id=?').bind(c.req.param('id')).first<{email:string;code:string;amount_vnd:number}>();
  if(account){const body=action==='approved'?'Yêu cầu rút '+account.amount_vnd+'đ đã được duyệt và đang chờ chuyển khoản.':'Yêu cầu rút tiền đã bị từ chối; khoản giữ được hoàn theo quy trình.';sendNotificationEmail(c,{to:account.email,subject:action==='approved'?'Yêu cầu rút tiền đã được duyệt':'Cập nhật yêu cầu rút tiền',html:emailShell('Cập nhật yêu cầu rút',[body],new URL('/tai-khoan/rut-tien/'+account.code,c.req.url).toString(),'Xem yêu cầu'),text:body,key:`withdrawal-review:${c.req.param('id')}:${data.version}:${action}`});}
  return c.json({ok:true});
 }catch(e){return knownError(c,e);}
});
router.post('/cms/withdrawals/:id/claim',requirePermission('withdrawals.pay'),async(c):Promise<Response>=>{
 const data=await readBody(c),actor=c.get('user'),release=data.release===true,note=text(data.note);
 if(!validVersion(data.version)||data.confirmed!==true||release&&(data.not_transferred!==true||note.length<10||note.length>1000))return fail(c,'Xác nhận nhận xử lý; nếu nhả xử lý cần chắc chắn chưa chuyển tiền và ghi lý do ít nhất 10 ký tự.');
 const denied=await limit(c,'withdrawal-claim',actor.id,60,3600);if(denied)return denied;
 try{
  const result=await c.env.DB.prepare(`UPDATE withdrawal_requests SET processor_id=?,last_actor_id=?,review_note=?,version=version+1,updated_at=unixepoch(),change_token=? WHERE id=? AND status='approved' AND version=? AND user_id!=? AND ${release?'processor_id=?':'processor_id IS NULL'}`).bind(release?null:actor.id,actor.id,release?note:'Quản trị viên đã nhận xử lý chuyển khoản.',uid(),c.req.param('id'),data.version,actor.id,...(release?[actor.id]:[])).run();
  return result.meta.changes>=1?c.json({ok:true}):stale(c);
 }catch(e){return knownError(c,e);}
});
router.post('/cms/withdrawals/:id/pay',requirePermission('withdrawals.pay'),async(c):Promise<Response>=>{
 const data=await readBody(c),id=c.req.param('id'),actor=c.get('user'),note=text(data.note),senderBank=text(data.sender_bank_code).toUpperCase(),senderNumber=text(data.sender_account_number).replace(/\s/g,''),ref=text(data.bank_reference).normalize('NFKC').toUpperCase().replace(/[\s._/\-]+/g,'');
 if(!validVersion(data.version)||!canonicalBankName(senderBank)||!/^\d{6,24}$/.test(senderNumber)||!/^[A-Z0-9]{4,100}$/.test(ref)||typeof data.amount_vnd!=='number'||!Number.isSafeInteger(data.amount_vnd)||note.length>1000||data.verified!==true)return fail(c,'Điền tài khoản chuyển, mã giao dịch, đúng số tiền và xác nhận chuyển khoản thành công.');
 const denied=await limit(c,'withdrawal-pay',actor.id,60,3600);if(denied)return denied;
 const r=await c.env.DB.prepare('SELECT user_id FROM withdrawal_requests WHERE id=?').bind(id).first<{user_id:string}>();
 if(!r)return fail(c,'Không tìm thấy yêu cầu.',404);if(r.user_id===actor.id)return fail(c,'Không được tự xác nhận yêu cầu rút của mình.',403);
 const old=await c.env.DB.prepare('SELECT sender_bank_code,sender_account_number,bank_reference,amount_vnd FROM withdrawal_payouts WHERE withdrawal_id=?').bind(id).first<WithdrawalPayout>();
 if(old)return old.sender_bank_code===senderBank&&old.sender_account_number===senderNumber&&old.bank_reference===ref&&old.amount_vnd===data.amount_vnd?c.json({ok:true,replayed:true}):fail(c,'Yêu cầu đã được xác nhận chuyển với thông tin khác. Kiểm tra lịch sử.',409);
 try{
  await c.env.DB.prepare('INSERT INTO withdrawal_payouts(id,withdrawal_id,sender_bank_code,sender_account_number,bank_reference,amount_vnd,actor_id,expected_version,note) VALUES(?,?,?,?,?,?,?,?,?)').bind(uid(),id,senderBank,senderNumber,ref,data.amount_vnd,actor.id,data.version,note).run();
  const account=await c.env.DB.prepare('SELECT u.email,r.code,r.amount_vnd FROM withdrawal_requests r JOIN users u ON u.id=r.user_id WHERE r.id=?').bind(id).first<{email:string;code:string;amount_vnd:number}>();
  if(account){const body='Khoản rút '+account.amount_vnd+'đ đã được xác nhận chuyển khoản.';sendNotificationEmail(c,{to:account.email,subject:'Đã chuyển khoản yêu cầu rút',html:emailShell('Đã xác nhận chuyển khoản',[body],new URL('/tai-khoan/rut-tien/'+account.code,c.req.url).toString(),'Xem yêu cầu'),text:body,key:`withdrawal-paid:${id}`});}
  return c.json({ok:true});
 }catch(e){return knownError(c,e);}
});
export default router;
