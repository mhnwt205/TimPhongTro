import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHmac} from 'node:crypto';
import {createTestHarness} from 'wrangler';

const server=createTestHarness({root:fileURLToPath(new URL('../',import.meta.url)),workers:[{configPath:'apps/api/wrangler.test.jsonc',vars:{SEPAY_ENV:'sandbox',SEPAY_MERCHANT_ID:'SP-TEST-HM955656'},secrets:{SEPAY_SECRET_KEY:'sepay-test-secret'}}]});
let origin,DB,seq=0,admin;
const bankId='system-sepay-gateway';
const password='Thu-nghiem-sepay-2026';
const request=(path,{method='GET',body,cookie,headers={}}={})=>server.fetch(new URL(path,origin),{method,headers:{...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'}),'CF-Connecting-IP':`203.0.113.${++seq%240+1}`,...(cookie?{Cookie:cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
const cms=(path,options={})=>request('/api/cms/'+path,{cookie:admin.cookie,...options});
async function account(approved=true){
 const response=await request('/api/auth/register',{method:'POST',body:{name:'Người đăng thử SePay',email:`sepay-${++seq}@example.test`,password}});assert.equal(response.status,201,await response.clone().text());
 const user={...(await response.json()).user,cookie:response.headers.get('set-cookie').split(';')[0]};
 if(approved)await DB.prepare("INSERT INTO seller_profiles(user_id,display_name,seller_type,phone,zalo_phone,status,change_token) VALUES(?,'Chủ trọ SePay','owner','0901234567','0901234567','approved','fixture')").bind(user.id).run();
 return user;
}
async function configure(){
 const current=await (await cms('payments')).json();
 const response=await cms('payments',{method:'POST',body:{version:current.settings.version,accepting_topups:true}});
 assert.equal(response.status,200,await response.clone().text());
}
async function topup(user,amount=50000){
 const response=await request('/api/account/topups',{method:'POST',cookie:user.cookie,body:{amount_vnd:amount,request_key:randomUUID()}});assert.equal(response.status,201,await response.clone().text());return (await response.json()).topup;
}
async function ipn(fields,authorization,ip){
 const headers={'Content-Type':'application/json'};if(authorization)headers.Authorization=authorization;if(ip)headers['CF-Connecting-IP']=ip;
 return server.fetch(new URL('/api/payments/sepay/ipn',origin),{method:'POST',headers,body:JSON.stringify(fields)});
}
async function withOrder(order,callback){
 const original=globalThis.fetch;
 globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  if(url.hostname==='pgapi-sandbox.sepay.vn'&&url.pathname.startsWith('/v1/order/detail/')){
   assert.equal(new Headers(init?.headers).get('authorization'),'Basic '+Buffer.from('SP-TEST-HM955656:sepay-test-secret').toString('base64'));
   return new Response(JSON.stringify({data:order}),{status:200,headers:{'Content-Type':'application/json'}});
  }
  return original(input,init);
 };
 try{return await callback();}finally{globalThis.fetch=original;}
}
async function userWallet(user){return (await (await request('/api/account/wallet',{cookie:user.cookie})).json()).balance_vnd;}

before(async()=>{
 origin=(await server.listen()).url.origin;await server.getWorker().applyD1Migrations('DB');({DB}=await server.getWorker().getEnv());
 admin=await account(false);await DB.prepare("UPDATE users SET role='admin',is_super_admin=1 WHERE id=?").bind(admin.id).run();await configure();
});
after(async()=>{await server.close();});

test('new topups create a server-signed sandbox checkout and are credited once by a verified SePay order',async()=>{
 const user=await account(),item=await topup(user,25000);
 assert.equal(item.bank_account_id,bankId);assert.equal(item.bank_code,'SEPAY');
 const response=await request('/api/account/topups/'+item.code+'/checkout',{method:'POST',cookie:user.cookie,body:{}});assert.equal(response.status,200,await response.clone().text());
 const checkout=await response.json();assert.equal(checkout.checkout_url,'https://pay-sandbox.sepay.vn/v1/checkout/init');
 assert.equal(checkout.fields.order_invoice_number,item.code);assert.equal(checkout.fields.order_amount,25000);assert.equal(checkout.fields.merchant,'SP-TEST-HM955656');
 const fields={...checkout.fields};delete fields.signature;
 const message=Object.entries(fields).map(([key,value])=>`${key}=${value}`).join(',');
 assert.equal(checkout.fields.signature,createHmac('sha256','sepay-test-secret').update(message).digest('base64'));
 const cmsUsers=await (await cms('users')).json();assert.ok(!cmsUsers.items.some(row=>row.id==='sepay-ipn-system'));
 const order={order_invoice_number:item.code,order_amount:25000,currency:'VND',order_status:'PAID',transaction_id:'sp-tx-paid-1'};
 const first=await withOrder(order,()=>ipn({order_invoice_number:item.code}));assert.equal(first.status,200,await first.clone().text());const firstBody=await first.json();const debug={firstBody,topup:await DB.prepare('SELECT status,version FROM topup_requests WHERE id=?').bind(item.id).first(),events:await DB.prepare('SELECT provider_reference,outcome FROM sepay_payment_events WHERE order_invoice_number=?').bind(item.code).all(),receipt:await DB.prepare('SELECT provider,provider_transaction_id,bank_reference FROM bank_receipts WHERE topup_id=?').bind(item.id).first()};assert.equal(firstBody.credited,true,JSON.stringify(debug));
 const replay=await withOrder(order,()=>ipn({order_invoice_number:item.code}));assert.equal(replay.status,200);assert.equal((await replay.json()).replayed,true);
 assert.equal(await userWallet(user),25000);
 assert.equal((await DB.prepare('SELECT count(*) AS n FROM wallet_entries WHERE topup_id=?').bind(item.id).first()).n,1);
 const detail=await (await cms('topups/'+item.id)).json();assert.equal(detail.receipt.provider,'sepay_pg');assert.equal(detail.receipt.provider_transaction_id,'sp-tx-paid-1');
});

test('successful checkout return verifies the order with SePay when no IPN was recorded',async()=>{
 const user=await account(),item=await topup(user,5000),order={order_invoice_number:item.code,order_amount:5000,currency:'VND',order_status:'PAID',transaction_id:'sp-tx-return-verification-1'};
 const response=await withOrder(order,()=>request('/api/account/topups/'+item.code+'/verify',{method:'POST',cookie:user.cookie,body:{}}));assert.equal(response.status,200,await response.clone().text());
 assert.deepEqual(await response.json(),{success:true,credited:true,pending:false});assert.equal(await userWallet(user),5000);
 assert.equal((await DB.prepare('SELECT count(*) AS n FROM sepay_payment_events WHERE order_invoice_number=?').bind(item.code).first()).n,1);
 assert.equal((await DB.prepare('SELECT count(*) AS n FROM wallet_entries WHERE topup_id=?').bind(item.id).first()).n,1);
});

test('checkout-return verification is owner-only and never credits an unpaid order',async()=>{
 const user=await account(),other=await account(),item=await topup(user,5000),order={order_invoice_number:item.code,order_amount:5000,currency:'VND',order_status:'PENDING',transaction_id:'sp-tx-return-pending-1'};
 const denied=await request('/api/account/topups/'+item.code+'/verify',{method:'POST',cookie:other.cookie,body:{}});assert.equal(denied.status,404);
 const response=await withOrder(order,()=>request('/api/account/topups/'+item.code+'/verify',{method:'POST',cookie:user.cookie,body:{}}));assert.equal(response.status,200,await response.clone().text());assert.deepEqual(await response.json(),{success:true,pending:true});
 assert.equal(await userWallet(user),0);assert.equal((await DB.prepare('SELECT status FROM topup_requests WHERE id=?').bind(item.id).first()).status,'pending');
 assert.equal((await DB.prepare('SELECT count(*) AS n FROM wallet_entries WHERE topup_id=?').bind(item.id).first()).n,0);
});

test('notification failure after the ledger commit still acknowledges the credited IPN',async()=>{
 const user=await account(),item=await topup(user),order={order_invoice_number:item.code,order_amount:50000,currency:'VND',order_status:'PAID',transaction_id:'sp-tx-notification-failure-1'};
 await DB.prepare("CREATE TRIGGER fail_test_topup_notification BEFORE INSERT ON user_notifications WHEN NEW.event_key LIKE 'topup-credited:%' BEGIN SELECT RAISE(ABORT,'notification unavailable'); END").run();
 try{
  const response=await withOrder(order,()=>ipn({order_invoice_number:item.code}));assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).credited,true);
  assert.equal(await userWallet(user),50000);assert.equal((await DB.prepare('SELECT count(*) AS n FROM wallet_entries WHERE topup_id=?').bind(item.id).first()).n,1);
 }finally{await DB.prepare('DROP TRIGGER fail_test_topup_notification').run();}
});

test('SePay connectivity pings without an invoice are acknowledged without credentials or financial writes',async()=>{
 const before=await DB.prepare('SELECT (SELECT count(*) FROM wallet_entries) AS entries,(SELECT count(*) FROM sepay_payment_events) AS events').first();
 const response=await ipn({signature:'invalid-test-signature',merchant:'not-a-payment'},'Bearer test-ping');
 assert.equal(response.status,200,await response.clone().text());assert.deepEqual(await response.json(),{success:true});
 const after=await DB.prepare('SELECT (SELECT count(*) FROM wallet_entries) AS entries,(SELECT count(*) FROM sepay_payment_events) AS events').first();
 assert.deepEqual(after,before);
});

test('unsigned IPN order lookups are rate-limited by source IP',async()=>{
 const user=await account(),item=await topup(user,5000),order={order_invoice_number:item.code,order_amount:5000,currency:'VND',order_status:'PENDING',transaction_id:'sp-tx-rate-limit-1'};
 let lookups=0;const original=globalThis.fetch;
 globalThis.fetch=async(input,init)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(url.hostname==='pgapi-sandbox.sepay.vn'&&url.pathname.startsWith('/v1/order/detail/')){lookups++;return new Response(JSON.stringify({data:order}),{status:200,headers:{'Content-Type':'application/json'}});}return original(input,init);};
 try{
  for(let i=0;i<60;i++){const response=await ipn({order_invoice_number:item.code},undefined,'198.51.100.222');assert.equal(response.status,503);}
  const limited=await ipn({order_invoice_number:item.code},undefined,'198.51.100.222');assert.equal(limited.status,429);assert.equal(lookups,60);
 }finally{globalThis.fetch=original;}
 assert.equal(await userWallet(user),0);
});

test('oversized SePay order responses are rejected without writing wallet data',async()=>{
 const user=await account(),item=await topup(user),original=globalThis.fetch;
 globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  if(url.hostname==='pgapi-sandbox.sepay.vn'&&url.pathname.startsWith('/v1/order/detail/')){
   assert.equal(init?.redirect,'error');
   return new Response(' '.repeat(65537),{status:200,headers:{'Content-Type':'application/json'}});
  }
  return original(input,init);
 };
 try{
  const response=await ipn({order_invoice_number:item.code});
  assert.equal(response.status,503);
  assert.equal(await userWallet(user),0);
  assert.equal((await DB.prepare('SELECT status FROM topup_requests WHERE id=?').bind(item.id).first()).status,'pending');
  assert.equal((await DB.prepare('SELECT count(*) AS n FROM sepay_payment_events WHERE order_invoice_number=?').bind(item.code).first()).n,0);
 }finally{globalThis.fetch=original;}
});

test('paid order with the wrong amount goes to the CMS exception queue and is credited only after explicit review',async()=>{
 const user=await account(),item=await topup(user,50000),order={order_invoice_number:item.code,order_amount:55000,currency:'VND',order_status:'SUCCESS',transaction_id:'sp-tx-mismatch-1'};
 const response=await withOrder(order,()=>ipn({order_invoice_number:item.code}));assert.equal(response.status,200);assert.equal((await response.json()).exception,true);assert.equal(await userWallet(user),0);
 const detail=await (await cms('topups/'+item.id)).json();assert.equal(detail.topup.status,'needs_review');assert.equal(detail.sepay_exception.outcome,'amount_mismatch');
 const exceptions=await (await cms('sepay-exceptions')).json();assert.ok(exceptions.items.some(row=>row.provider_reference==='sp-tx-mismatch-1'));
 assert.equal((await cms('topups?status=waiting')).status,200);
 const waiting=await (await cms('topups?status=waiting')).json();assert.ok(!waiting.items.some(row=>row.id===item.id));
 const prematureClose=await cms('sepay-exceptions/'+detail.sepay_exception.id+'/review',{method:'POST',body:{note:'Chưa xử lý khoản tiền còn đang chờ.'}});assert.equal(prematureClose.status,409);
 const reconcile=await cms('topups/'+item.id+'/reconcile',{method:'POST',body:{version:detail.topup.version,actual_vnd:55000,bank_account_id:bankId,bank_reference:'sp-tx-mismatch-1',provider_transaction_id:'sp-tx-mismatch-1',exception_confirmed:true,verified:true,note:'Đã kiểm tra khoản SePay nhận lệch với yêu cầu.'}});
 assert.equal(reconcile.status,200,await reconcile.clone().text());assert.equal(await userWallet(user),55000);
 const after=await (await cms('topups/'+item.id)).json();assert.equal(after.receipt.provider,'sepay_pg');assert.equal(after.sepay_exception,null);
});

test('unpaid orders and untrusted IPN authorization cannot credit the wallet',async()=>{
 const user=await account(),item=await topup(user);
 const rejected=await ipn({order_invoice_number:item.code},'Apikey invalid');assert.equal(rejected.status,401);
 const invalidSignature=await ipn({order_invoice_number:item.code,signature:'invalid'});assert.equal(invalidSignature.status,401);
 const response=await withOrder({order_invoice_number:item.code,order_amount:50000,currency:'VND',order_status:'PENDING',transaction_id:'sp-tx-unpaid-1'},()=>ipn({order_invoice_number:item.code}));
 assert.equal(response.status,503);assert.equal((await response.json()).success,false);assert.equal(await userWallet(user),0);
});

test('paid SePay orders without a matching request are visible as reviewable CMS exceptions',async()=>{
 const invoice='NAPABCDEFGHJKLM',order={order_invoice_number:invoice,order_amount:12000,currency:'VND',order_status:'PAID',transaction_id:'sp-tx-unmatched-1'};
 const response=await withOrder(order,()=>ipn({order_invoice_number:invoice}));assert.equal(response.status,200);assert.equal((await response.json()).exception,true);
 const exceptions=await (await cms('sepay-exceptions')).json(),row=exceptions.items.find(item=>item.provider_reference==='sp-tx-unmatched-1');assert.ok(row);assert.equal(row.topup_id,null);
 const review=await cms('sepay-exceptions/'+row.id+'/review',{method:'POST',body:{note:'Đã kiểm tra, không có yêu cầu nạp tương ứng.'}});assert.equal(review.status,200,await review.clone().text());
 const after=await (await cms('sepay-exceptions')).json();assert.ok(!after.items.some(item=>item.id===row.id));
});
