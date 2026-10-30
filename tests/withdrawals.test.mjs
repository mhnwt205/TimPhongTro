import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createTestHarness} from 'wrangler';
const server=createTestHarness({root:fileURLToPath(new URL('../',import.meta.url)),workers:[{configPath:'apps/api/wrangler.test.jsonc'}]});
let origin,DB,seq=0,admin;const password='Withdrawal-test-password-2026';
const req=(path,{method='GET',body,cookie,headers={}}={})=>server.fetch(new URL('/api/'+path,origin),{method,headers:{...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'}),'CF-Connecting-IP':`198.51.100.${++seq%240+1}`,...(cookie?{Cookie:cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
const cms=(path,body,cookie=admin.cookie)=>req('cms/'+path,{cookie,...(body?{method:'POST',body}:{})});
async function user(){const r=await req('auth/register',{method:'POST',body:{name:'Người dùng thử rút',email:`withdraw-${++seq}@example.test`,password}});assert.equal(r.status,201,await r.clone().text());return {...(await r.json()).user,cookie:r.headers.get('set-cookie').split(';')[0]};}
async function seed(u,amount=50000){const r=await cms('wallets/'+u.id+'/adjust',{amount_vnd:amount,request_key:randomUUID(),note:'Cấp số dư nội bộ cho kiểm thử cô lập.',confirmed:true});assert.equal(r.status,200,await r.clone().text());}
const payload=(amount=10000,extra={})=>({amount_vnd:amount,bank_code:'VCB',account_number:'000123456789',account_holder:'NGUOI DUNG KIEM THU',note:'',request_key:randomUUID(),current_password:password,confirmed:true,...extra});
const send=(u,data)=>req('account/withdrawals',{cookie:u.cookie,method:'POST',body:data});
async function create(u,amount=10000,extra={}){const r=await send(u,payload(amount,extra));assert.equal(r.status,201,await r.clone().text());return (await r.json()).withdrawal;}
const wallet=async(u)=>(await (await req('account/wallet',{cookie:u.cookie})).json());
const get=async(r)=>(await (await cms('withdrawals/'+r.id)).json()).withdrawal;
const review=(r,action='approved',extra={},cookie)=>cms('withdrawals/'+r.id+'/review',{version:r.version,action,confirmed:true,...extra},cookie);
const claim=(r,extra={},cookie)=>cms('withdrawals/'+r.id+'/claim',{version:r.version,confirmed:true,...extra},cookie);
const pay=(r,extra={},cookie)=>cms('withdrawals/'+r.id+'/pay',{version:r.version,amount_vnd:r.amount_vnd,sender_bank_code:'MB',sender_account_number:'000987654321',bank_reference:'OUT'+(++seq),verified:true,...extra},cookie);
const cancel=(u,r)=>req('account/withdrawals/'+r.code+'/cancel',{cookie:u.cookie,method:'POST',body:{version:r.version,confirmed:true}});
async function ready(u,amount=10000){let r=await create(u,amount);assert.equal((await review(r)).status,200);r=await get(r);assert.equal((await claim(r)).status,200);return get(r);}
async function role(u,permissions){const id=randomUUID();await DB.prepare('INSERT INTO cms_roles(id,name) VALUES(?,?)').bind(id,'Withdrawal role '+id).run();for(const p of permissions)await DB.prepare('INSERT INTO cms_role_permissions(role_id,permission) VALUES(?,?)').bind(id,p).run();await DB.prepare('INSERT INTO cms_user_roles(user_id,role_id) VALUES(?,?)').bind(u.id,id).run();}
before(async()=>{origin=(await server.listen()).url.origin;await server.getWorker().applyD1Migrations('DB');({DB}=await server.getWorker().getEnv());admin=await user();await DB.prepare("UPDATE users SET role='admin',is_super_admin=1 WHERE id=?").bind(admin.id).run();});
after(async()=>{await server.close();});
test('withdrawal does not need the receiving bank/topup switch; validates money, destination and password',async()=>{
 const u=await user();await seed(u);
 for(const amount of [0,-1,4999,5000.5,1000001,'10000'])assert.equal((await send(u,payload(amount))).status,400);
 assert.equal((await send(u,payload(10000,{bank_code:'FAKE'}))).status,400);
 assert.equal((await send(u,payload(10000,{account_number:'abc'}))).status,400);
 assert.equal((await send(u,payload(10000,{current_password:'wrong'}))).status,400);
 assert.equal((await send(u,payload(10000,{confirmed:false}))).status,400);
 const settings=(await (await cms('payments')).json()).settings;assert.equal(settings.accepting_topups,0);assert.equal(settings.bank,null);
 const r=await create(u);assert.match(r.code,/^RUT[A-HJ-NP-Z2-9]{12}$/);assert.equal(r.bank_name,'Vietcombank');assert.equal(r.status,'pending');
});
test('request atomically reserves only cash and idempotent retries never reserve twice',async()=>{
 const u=await user();await seed(u);const data=payload(20000),r=await send(u,data);assert.equal(r.status,201);const first=(await r.json()).withdrawal;
 const replay=await send(u,data);assert.equal(replay.status,200);assert.equal((await replay.json()).withdrawal.id,first.id);
 assert.equal((await send(u,{...data,account_number:'999123456789'})).status,409);
 const w=await wallet(u);assert.equal(w.balance_vnd,30000);assert.equal(w.held_vnd,20000);assert.equal(w.free_posts_remaining,3);assert.equal(w.ledger.total,2);assert.equal(w.ledger.items[0].kind,'withdrawal_hold');
 assert.equal((await DB.prepare('SELECT count(*) AS n FROM withdrawal_events WHERE withdrawal_id=?').bind(first.id).first()).n,1);
});
test('insufficient balance, including concurrent requests, cannot overdraw or leave partial requests',async()=>{
 const u=await user();await seed(u);const responses=await Promise.all([send(u,payload(30000)),send(u,payload(30000))]);assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
 const w=await wallet(u);assert.equal(w.balance_vnd,20000);assert.equal(w.held_vnd,30000);assert.equal(w.ledger.total,2);
 assert.equal((await DB.prepare('SELECT count(*) AS n FROM withdrawal_requests WHERE user_id=?').bind(u.id).first()).n,1);
 assert.equal((await send(u,payload(20001))).status,409);
});
test('concurrent identical create uses the same reservation and caps open requests',async()=>{
 const u=await user();await seed(u);const data=payload();const result=await Promise.all([send(u,data),send(u,data)]);assert.ok(result.every(r=>[200,201].includes(r.status)));assert.equal((await wallet(u)).held_vnd,10000);
 await create(u);await create(u);assert.equal((await send(u,payload())).status,409);assert.equal((await wallet(u)).held_vnd,30000);
});
test('ownership boundaries, user cancellation and cancellation retries refund at most once',async()=>{
 const u=await user(),other=await user();await seed(u);const r=await create(u);
 assert.equal((await req('account/withdrawals/'+r.code,{cookie:other.cookie})).status,404);assert.equal((await cancel(other,r)).status,409);
 assert.equal((await cancel(u,r)).status,200);assert.equal((await cancel(u,r)).status,409);
 const w=await wallet(u);assert.equal(w.balance_vnd,50000);assert.equal(w.held_vnd,0);assert.equal(w.ledger.items[0].kind,'withdrawal_release');assert.equal(w.ledger.total,3);
 assert.equal((await review(await get(r))).status,409);
});
test('reviewing reserves cash without transferring; approved requests cannot be cancelled by the owner',async()=>{
 const u=await user();await seed(u);const r=await create(u);assert.equal((await review(r)).status,200);const latest=await get(r);assert.equal(latest.status,'approved');assert.equal((await cancel(u,latest)).status,409);
 const w=await wallet(u);assert.equal(w.balance_vnd,40000);assert.equal(w.held_vnd,10000);
 assert.equal((await DB.prepare('SELECT count(*) AS n FROM withdrawal_payouts WHERE withdrawal_id=?').bind(r.id).first()).n,0);
});
test('rejection needs reason and not-transferred confirmation; returns the reservation exactly once',async()=>{
 const u=await user();await seed(u);let r=await create(u);assert.equal((await review(r,'rejected')).status,400);
 assert.equal((await review(r,'rejected',{not_transferred:true,note:'Sai tài khoản nhận, cần gửi yêu cầu khác.'})).status,200);assert.equal((await wallet(u)).balance_vnd,50000);
 assert.equal((await review(r,'rejected',{not_transferred:true,note:'Sai tài khoản nhận, cần gửi yêu cầu khác.'})).status,409);
 r=await ready(u);assert.equal((await review(r,'rejected',{not_transferred:true,note:'Chưa chuyển tiền, hủy theo đề nghị người dùng.'})).status,200);assert.equal((await wallet(u)).balance_vnd,50000);assert.equal((await wallet(u)).held_vnd,0);
});
test('one processor at a time: other operators cannot pay, refund or steal an assigned request',async()=>{
 const u=await user(),operator=await user();await role(operator,['withdrawals.read','withdrawals.review','withdrawals.pay']);await seed(u);
 let r=await create(u);assert.equal((await review(r)).status,200);r=await get(r);
 const claims=await Promise.all([claim(r),claim(r,{},operator.cookie)]);assert.deepEqual(claims.map(r=>r.status).sort(),[200,409]);r=await get(r);
 const ownerCookie=r.processor_id===admin.id?admin.cookie:operator.cookie,otherCookie=r.processor_id===admin.id?operator.cookie:admin.cookie;
 assert.equal((await pay(r,{},otherCookie)).status,409);assert.equal((await review(r,'rejected',{not_transferred:true,note:'Không được hoàn tiền khi người khác đang chuyển.'},otherCookie)).status,409);
 assert.equal((await claim(r,{release:true,not_transferred:true,note:'Chưa chuyển tiền, bàn giao người xử lý khác.'},ownerCookie)).status,200);r=await get(r);assert.equal(r.processor_id,null);
 assert.equal((await claim(r,{},otherCookie)).status,200);
});
test('pay requires approved request, claim, exact amount and successful-transfer verification',async()=>{
 const u=await user();await seed(u);let r=await create(u);assert.equal((await pay(r)).status,409);
 assert.equal((await review(r)).status,200);r=await get(r);assert.equal((await pay(r)).status,409);
 assert.equal((await claim(r)).status,200);r=await get(r);
 assert.equal((await pay(r,{verified:false})).status,400);assert.equal((await pay(r,{amount_vnd:9000})).status,409);
 assert.equal((await pay(r)).status,200);const w=await wallet(u);assert.equal(w.balance_vnd,40000);assert.equal(w.held_vnd,0);assert.equal(w.ledger.total,2);assert.equal((await get(r)).status,'paid');
 const publicDetail=await (await req('account/withdrawals/'+r.code,{cookie:u.cookie})).json();assert.equal(publicDetail.payout.sender_account_number,undefined);
});
test('repeated confirmation and duplicate normalized bank reference cannot produce duplicate payouts',async()=>{
 const u=await user();await seed(u);const r=await ready(u),ref='OUT-ONCE'+seq;
 assert.equal((await pay(r,{bank_reference:ref})).status,200);assert.equal((await pay(r,{bank_reference:ref})).status,200);assert.equal((await pay(r,{bank_reference:'OTHER'})).status,409);
 const second=await ready(u);assert.equal((await pay(second,{bank_reference:ref.toLowerCase().replace('-',' ')})).status,409);assert.equal((await get(second)).status,'approved');assert.equal((await wallet(u)).held_vnd,10000);
 assert.equal((await DB.prepare('SELECT count(*) AS n FROM withdrawal_payouts WHERE withdrawal_id=?').bind(r.id).first()).n,1);
});
test('race between approval and cancellation, and payout and rejection, preserves money',async()=>{
 const u=await user();await seed(u);let r=await create(u);const race=await Promise.all([review(r),cancel(u,r)]);assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);r=await get(r);
 if(r.status==='approved'){assert.equal((await claim(r)).status,200);r=await get(r);}else r=await ready(u);
 const second=await Promise.all([pay(r),review(r,'rejected',{not_transferred:true,note:'Chưa chuyển tiền, yêu cầu bị từ chối kiểm thử.'})]);assert.deepEqual(second.map(x=>x.status).sort(),[200,409]);r=await get(r);const w=await wallet(u);assert.equal(w.held_vnd,0);assert.equal(w.balance_vnd,r.status==='paid'?40000:50000);
});
test('financial history is immutable and any later batch failure rolls back reservations/events/balances',async()=>{
 const u=await user();await seed(u);const r=await ready(u);assert.equal((await pay(r)).status,200);
 for(const sql of ["UPDATE withdrawal_requests SET amount_vnd=1 WHERE id=?","DELETE FROM withdrawal_requests WHERE id=?","UPDATE withdrawal_requests SET status='rejected',version=version+1 WHERE id=?","DELETE FROM withdrawal_events WHERE withdrawal_id=?","UPDATE withdrawal_payouts SET bank_reference='CHANGED' WHERE withdrawal_id=?","DELETE FROM withdrawal_payouts WHERE withdrawal_id=?"])await assert.rejects(DB.prepare(sql).bind(r.id).run());
 const before=await wallet(u),id=randomUUID();await assert.rejects(DB.batch([
  DB.prepare("INSERT INTO withdrawal_requests(id,code,user_id,request_key,amount_vnd,bank_code,bank_name,account_number,account_holder,last_actor_id,change_token) VALUES(?,?,?,?,10000,'VCB','Vietcombank','000123456789','THU NGHIEM',?,?)").bind(id,'RUTABCDEFGHIJKL',u.id,randomUUID(),u.id,randomUUID()),
  DB.prepare("INSERT INTO listing_plans(id,name,price_vnd,duration_days) VALUES('invalid-withdraw','invalid',-1,7)")
 ]));assert.equal((await wallet(u)).balance_vnd,before.balance_vnd);assert.equal((await wallet(u)).ledger.total,before.ledger.total);assert.equal((await DB.prepare('SELECT count(*) AS n FROM withdrawal_requests WHERE id=?').bind(id).first()).n,0);
});
test('separate read/review/pay privileges, self-review block, origin protection and scoped work counts',async()=>{
 const u=await user(),reader=await user();await seed(u);const r=await create(u);await role(reader,['withdrawals.read']);
 assert.equal((await cms('withdrawals',undefined,reader.cookie)).status,200);assert.equal((await review(r,'approved',{},reader.cookie)).status,403);assert.equal((await claim(r,{},reader.cookie)).status,403);assert.equal((await pay(r,{},reader.cookie)).status,403);
 const notifications=await (await cms('notifications',undefined,reader.cookie)).json();assert.ok(notifications.counts.withdrawals>0);assert.equal(notifications.counts.topups,0);assert.equal(notifications.items[0].id,'pending-withdrawals');
 await role(u,['withdrawals.read','withdrawals.review','withdrawals.pay']);assert.equal((await review(r,'approved',{},u.cookie)).status,409);assert.equal((await pay(r,{},u.cookie)).status,403);
 assert.equal((await req('cms/withdrawals/'+r.id+'/review',{cookie:admin.cookie,method:'POST',body:{version:r.version,action:'approved',confirmed:true},headers:{Origin:'https://evil.test'}})).status,403);
});
test('locked/deleted owners cannot create or be newly approved, while existing processing funds remain accountable',async()=>{
 const u=await user();await seed(u);const pending=await create(u),processing=await ready(u);await DB.prepare('UPDATE users SET is_locked=1,deleted_at=unixepoch() WHERE id=?').bind(u.id).run();
 assert.equal((await send(u,payload())).status,401);assert.equal((await review(pending)).status,409);
 assert.equal((await pay(processing)).status,200);assert.equal((await review(pending,'rejected',{not_transferred:true,note:'Tài khoản khóa, chưa chuyển tiền, hoàn khoản giữ.'})).status,200);
 assert.equal((await DB.prepare('SELECT balance_vnd FROM wallet_accounts WHERE user_id=?').bind(u.id).first()).balance_vnd,40000);
});
