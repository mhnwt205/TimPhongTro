import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createTestHarness} from 'wrangler';
const server=createTestHarness({root:fileURLToPath(new URL('../',import.meta.url)),workers:[{configPath:'apps/api/wrangler.test.jsonc',vars:{SEPAY_ENV:'sandbox',SEPAY_MERCHANT_ID:'SP-TEST-HM955656'},secrets:{SEPAY_SECRET_KEY:'wallet-test-sepay-secret'}}]});
let origin,DB,seq=0,admin;const password='Thu-nghiem-so-du-2026';
const req=(path,{method='GET',body,cookie,headers={}}={})=>server.fetch(new URL(path,origin),{method,headers:{...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'}),'CF-Connecting-IP':`198.51.100.${++seq%240+1}`,...(cookie?{Cookie:cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
const cms=(path,options={})=>req('/api/cms/'+path,{cookie:admin.cookie,...options});
async function user(approved=true){const r=await req('/api/auth/register',{method:'POST',body:{name:'Người đăng thử ví',email:`wallet-${++seq}@example.test`,password,balance_vnd:999999,free_posts_used:-1}});assert.equal(r.status,201,await r.clone().text());const u={...(await r.json()).user,cookie:r.headers.get('set-cookie').split(';')[0]};if(approved){await DB.prepare("INSERT INTO seller_profiles(user_id,display_name,seller_type,phone,zalo_phone,status,change_token) VALUES(?,'Chủ trọ thử','owner','0901234567','0901234567','approved','fixture')").bind(u.id).run();}return u;}
async function configure(enabled=true){const old=(await (await cms('payments')).json()).settings;const r=await cms('payments',{method:'POST',body:{version:old.version,accepting_topups:enabled}});assert.equal(r.status,200,await r.clone().text());}
async function requestTopup(u,vnd=50000,key=randomUUID()){const r=await req('/api/account/topups',{method:'POST',cookie:u.cookie,body:{amount_vnd:vnd,request_key:key}});assert.equal(r.status,201,await r.clone().text());return (await r.json()).topup;}
async function legacyBank(number='000123456789',holder='TAI KHOAN KIEM THU'){const id='legacy-test-'+number;await DB.prepare("INSERT INTO receiving_bank_accounts(id,bank_code,bank_name,account_number,account_holder) VALUES(?,'VCB','Ngân hàng thử local',?,?) ON CONFLICT(id) DO NOTHING").bind(id,number,holder).run();return await DB.prepare('SELECT id,bank_code,bank_name,account_number,account_holder FROM receiving_bank_accounts WHERE id=?').bind(id).first();}
async function create(u,vnd=50000,key=randomUUID(),bankOverride=null){
 const id=randomUUID(),alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',code='NAP'+Array.from({length:12},()=>alphabet[Math.floor(Math.random()*alphabet.length)]).join('');
 const bank=bankOverride??await legacyBank();assert.ok(bank);
 const statements=[DB.prepare("INSERT INTO topup_requests(id,code,user_id,request_key,requested_vnd,bank_account_id,bank_code,bank_name,account_number,account_holder,payment_provider) VALUES(?,?,?,?,?,?,?,?,?,?,'manual')").bind(id,code,u.id,key,vnd,bank.id,bank.bank_code,bank.bank_name,bank.account_number,bank.account_holder),DB.prepare("INSERT INTO topup_events(id,topup_id,actor_id,action,note) VALUES(?,?,?,'created','Fixture for legacy reconciliation test')").bind(randomUUID(),id,u.id)];
 await DB.batch(statements);return await DB.prepare('SELECT * FROM topup_requests WHERE id=?').bind(id).first();
}
const wallet=async(u)=>(await (await req('/api/account/wallet',{cookie:u.cookie})).json());
const reconcile=(t,overrides={})=>cms('topups/'+t.id+'/reconcile',{method:'POST',body:{version:t.version,actual_vnd:t.requested_vnd,bank_account_id:t.bank_account_id,bank_reference:'BANKTX'+(++seq),verified:true,exception_confirmed:false,note:'',...overrides}});
async function role(u,permissions){const id=randomUUID();await DB.prepare('INSERT INTO cms_roles(id,name) VALUES(?,?)').bind(id,'Finance test '+id).run();for(const permission of permissions)await DB.prepare('INSERT INTO cms_role_permissions(role_id,permission) VALUES(?,?)').bind(id,permission).run();await DB.prepare('INSERT INTO cms_user_roles(user_id,role_id) VALUES(?,?)').bind(u.id,id).run();}
before(async()=>{origin=(await server.listen()).url.origin;await server.getWorker().applyD1Migrations('DB');({DB}=await server.getWorker().getEnv());admin=await user(false);await DB.prepare("UPDATE users SET role='admin',is_super_admin=1 WHERE id=?").bind(admin.id).run();});
after(async()=>{await server.close();});
test('starts with no bank and topups disabled; balance and three promotions cannot be injected',async()=>{
 const u=await user(),data=await wallet(u);assert.equal(data.balance_vnd,0);assert.equal(data.free_posts_remaining,3);assert.equal(data.can_topup,false);assert.equal(data.bank,null);assert.equal(data.payments_enabled,false);
 assert.equal((await req('/api/account/topups',{method:'POST',cookie:u.cookie,body:{amount_vnd:50000,request_key:randomUUID()}})).status,503);
 const config=(await (await cms('payments')).json()).settings;assert.equal(config.bank,null);assert.equal(config.accepting_topups,0);
 const enabled=await cms('payments',{method:'POST',body:{version:config.version,accepting_topups:true}});assert.equal(enabled.status,200,await enabled.clone().text());
 const topup=await requestTopup(u);assert.equal(topup.bank_account_id,'system-sepay-gateway');assert.equal(topup.bank_code,'SEPAY');await configure(false);
});
test('CMS only toggles SePay, rejects duplicate bank details, and preserves stale-write protection',async()=>{
 await configure();const u=await user(false);
 assert.equal((await req('/api/account/topups',{method:'POST',cookie:u.cookie,body:{amount_vnd:50000,request_key:randomUUID()}})).status,403);
 const old=(await (await cms('payments')).json()).settings;
 assert.equal((await cms('payments',{method:'POST',body:{version:old.version,accepting_topups:true,bank_code:'VCB',account_number:'000123456789'}})).status,400);
 await configure(false);
 assert.equal((await cms('payments',{method:'POST',body:{version:old.version,accepting_topups:true}})).status,409);
 assert.equal((await (await cms('payments')).json()).settings.accepting_topups,0);
 await configure(true);
});
test('creates unpredictable per-user codes idempotently, validates amounts and caps pending requests',async()=>{
 const u=await user(),key=randomUUID();
 for(const value of [0,-1,4999,5000.5,1000001,'50000'])assert.equal((await req('/api/account/topups',{method:'POST',cookie:u.cookie,body:{amount_vnd:value,request_key:randomUUID()}})).status,400);
 const first=await requestTopup(u,50000,key);assert.match(first.code,/^NAP[A-HJ-NP-Z2-9]{12}$/);assert.equal(first.status,'pending');assert.equal(first.payment_provider,'sepay_pg');
 const replay=await req('/api/account/topups',{method:'POST',cookie:u.cookie,body:{amount_vnd:50000,request_key:key}});assert.equal(replay.status,200);assert.equal((await replay.json()).topup.id,first.id);
 assert.equal((await req('/api/account/topups',{method:'POST',cookie:u.cookie,body:{amount_vnd:10000,request_key:key}})).status,409);
 await create(u);await create(u);
 assert.equal((await req('/api/account/topups',{method:'POST',cookie:u.cookie,body:{amount_vnd:50000,request_key:randomUUID()}})).status,409);
});
test('ownership and reporting/cancellation never credit money or expose another request',async()=>{
 const a=await user(),b=await user(),t=await create(a);
 assert.equal((await req('/api/account/topups/'+t.code,{cookie:b.cookie})).status,404);
 assert.equal((await req('/api/account/topups/'+t.code+'/report',{method:'POST',cookie:b.cookie,body:{version:t.version}})).status,409);
 assert.equal((await req('/api/account/topups/'+t.code+'/report',{method:'POST',cookie:a.cookie,body:{version:t.version,note:'Tôi đã chuyển.'}})).status,200);
 assert.equal((await wallet(a)).balance_vnd,0);
 assert.equal((await req('/api/account/topups/'+t.code+'/cancel',{method:'POST',cookie:a.cookie,body:{version:2}})).status,409);
 const second=await create(a);assert.equal((await req('/api/account/topups/'+second.code+'/cancel',{method:'POST',cookie:a.cookie,body:{version:1}})).status,200);assert.equal((await wallet(a)).balance_vnd,0);
});
test('receipt, ledger, wallet, status and history commit atomically; retries cannot double credit',async()=>{
 const u=await user(),t=await create(u);const fields={bank_reference:'FT ATOMIC 001'};
 assert.equal((await reconcile(t,fields)).status,200);assert.equal((await wallet(u)).balance_vnd,50000);
 assert.equal((await reconcile(t,fields)).status,200);assert.equal((await wallet(u)).balance_vnd,50000);
 assert.equal((await DB.prepare('SELECT count(*) AS n FROM wallet_entries WHERE topup_id=?').bind(t.id).first()).n,1);
 assert.equal((await DB.prepare('SELECT count(*) AS n FROM bank_receipts WHERE topup_id=?').bind(t.id).first()).n,1);
 const updated=(await (await cms('topups/'+t.id)).json()).topup;assert.equal(updated.status,'credited');assert.equal(updated.credited_vnd,50000);
 assert.equal((await DB.prepare("SELECT count(*) AS n FROM topup_events WHERE topup_id=? AND action='credited'").bind(t.id).first()).n,1);
 assert.equal((await reconcile(t,{bank_reference:'DIFFERENT'})).status,409);
});
test('same normalized bank transaction cannot credit two requests, including concurrent requests',async()=>{
 const a=await user(),b=await user(),first=await create(a),second=await create(b);
 const result=await Promise.all([reconcile(first,{bank_reference:'ftDUP0001'}),reconcile(second,{bank_reference:'FT DUP-0001'})]);assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);
 assert.equal((await wallet(a)).balance_vnd+(await wallet(b)).balance_vnd,50000);
 const u=await user(),t=await create(u),ref='SAME-REQ'+seq;
 const same=await Promise.all([reconcile(t,{bank_reference:ref}),reconcile(t,{bank_reference:ref})]);assert.ok(same.every(r=>[200,409].includes(r.status)));assert.equal((await wallet(u)).balance_vnd,50000);
});
test('amount mismatch and late payment after cancellation require explicit exception review',async()=>{
 const u=await user(),t=await create(u);
 assert.equal((await reconcile(t,{actual_vnd:45000})).status,409);assert.equal((await wallet(u)).balance_vnd,0);
 assert.equal((await reconcile(t,{actual_vnd:45000,exception_confirmed:true,note:'Đã xác minh người gửi chuyển thiếu 5.000đ.'})).status,200);assert.equal((await wallet(u)).balance_vnd,45000);
 const cancelled=await create(u);await req('/api/account/topups/'+cancelled.code+'/cancel',{method:'POST',cookie:u.cookie,body:{version:1}});
 assert.equal((await cms('topups/'+cancelled.id+'/review',{method:'POST',body:{version:2,action:'needs_review',note:'Ngân hàng nhận tiền sau khi hủy.'}})).status,200);
 const latest=(await (await cms('topups/'+cancelled.id)).json()).topup;
 assert.equal((await reconcile(latest)).status,409);
 assert.equal((await reconcile(latest,{exception_confirmed:true,note:'Khoản tiền đến sau khi yêu cầu đã hủy, đã đối chiếu.'})).status,200);
});
test('legacy transfer instructions remain fixed when another CMS bank record exists',async()=>{
 const u=await user(),old=await legacyBank(),t=await create(u,50000,randomUUID(),old);
 const newBank=await legacyBank('000987654321','CHU TAI KHOAN MOI');
 const detail=(await (await req('/api/account/topups/'+t.code,{cookie:u.cookie})).json()).topup;
 assert.equal(detail.account_number,'000123456789');assert.equal(detail.bank_account_id,old.id);
 assert.equal((await reconcile(t,{bank_account_id:newBank.id})).status,409);
});
test('database rejects editing financial history or directly changing balance',async()=>{
 const u=await user(),t=await create(u);assert.equal((await reconcile(t)).status,200);
 for(const sql of ['UPDATE wallet_entries SET amount_vnd=1 WHERE user_id=?','DELETE FROM wallet_entries WHERE user_id=?','UPDATE wallet_accounts SET balance_vnd=12345 WHERE user_id=?','DELETE FROM wallet_accounts WHERE user_id=?'])await assert.rejects(DB.prepare(sql).bind(u.id).run());
 for(const sql of ['DELETE FROM bank_receipts WHERE topup_id=?','UPDATE bank_receipts SET actual_vnd=1 WHERE topup_id=?','DELETE FROM topup_requests WHERE id=?','UPDATE topup_requests SET status=\'pending\' WHERE id=?','DELETE FROM topup_events WHERE topup_id=?'])await assert.rejects(DB.prepare(sql).bind(t.id).run());
 assert.equal((await wallet(u)).balance_vnd,50000);
});
test('a later failure in the D1 batch rolls back receipt, ledger, balance and audit',async()=>{
 const u=await user(),t=await create(u);const auditBefore=(await DB.prepare('SELECT count(*) AS n FROM admin_audit').first()).n;
 await assert.rejects(DB.batch([
  DB.prepare('INSERT INTO bank_receipts(id,topup_id,bank_account_id,bank_reference,actual_vnd,reviewed_by,expected_version,exception_confirmed,note) VALUES(?,?,?,?,?,?,1,0,?)').bind(randomUUID(),t.id,t.bank_account_id,'ROLLBACK'+seq,50000,admin.id,''),
  DB.prepare("INSERT INTO listing_plans(id,name,price_vnd,duration_days) VALUES('invalid-finance-test','invalid',-1,7)")
 ]));
 assert.equal((await wallet(u)).balance_vnd,0);assert.equal((await DB.prepare('SELECT count(*) AS n FROM bank_receipts WHERE topup_id=?').bind(t.id).first()).n,0);
 assert.equal((await DB.prepare('SELECT count(*) AS n FROM wallet_entries WHERE user_id=?').bind(u.id).first()).n,0);
 assert.equal((await DB.prepare('SELECT count(*) AS n FROM admin_audit').first()).n,auditBefore);
 assert.equal((await (await cms('topups/'+t.id)).json()).topup.status,'pending');
});
test('adjustments are append-only, idempotent and cannot overdraw under concurrency',async()=>{
 const u=await user(),t=await create(u);assert.equal((await reconcile(t)).status,200);
 const adjust=(value,key=randomUUID(),note='Điều chỉnh kiểm tra số dư chính xác.')=>cms('wallets/'+u.id+'/adjust',{method:'POST',body:{amount_vnd:value,request_key:key,note,confirmed:true}});
 const key=randomUUID();assert.equal((await adjust(10000,key)).status,200);assert.equal((await adjust(10000,key)).status,200);assert.equal((await wallet(u)).balance_vnd,60000);
 assert.equal((await adjust(20000,key)).status,409);
 const debit=await Promise.all([adjust(-40000),adjust(-40000)]);assert.deepEqual(debit.map(r=>r.status).sort(),[200,409]);assert.equal((await wallet(u)).balance_vnd,20000);
 assert.equal((await adjust(-20001)).status,409);
 const sum=await DB.prepare('SELECT sum(amount_vnd) AS n FROM wallet_entries WHERE user_id=?').bind(u.id).first();assert.equal(sum.n,20000);
 assert.equal((await cms('wallets/'+admin.id+'/adjust',{method:'POST',body:{amount_vnd:10000,request_key:randomUUID(),note:'Không được tự điều chỉnh tài khoản.',confirmed:true}})).status,403);
});
test('finance permissions remain separate and cross-origin confirmation is rejected',async()=>{
 const reader=await user(false);await role(reader,['topups.read']);
 assert.equal((await req('/api/cms/topups',{cookie:reader.cookie})).status,200);
 for(const route of ['payments','wallets'])assert.equal((await req('/api/cms/'+route,{cookie:reader.cookie})).status,403);
 const u=await user(),t=await create(u);
 assert.equal((await req('/api/cms/topups/'+t.id+'/reconcile',{cookie:reader.cookie,method:'POST',body:{}})).status,403);
 assert.equal((await cms('topups/'+t.id+'/reconcile',{method:'POST',headers:{Origin:'https://untrusted.test'},body:{}})).status,403);
 const roleHolder=await user(false);await role(roleHolder,['wallets.read']);
 assert.equal((await req('/api/cms/wallets/'+u.id,{cookie:roleHolder.cookie})).status,200);
 assert.equal((await req('/api/cms/wallets/'+u.id+'/adjust',{method:'POST',cookie:roleHolder.cookie,body:{}})).status,403);
});

test('locked sellers cannot create new requests, while already received money can still be accounted for',async()=>{
 const u=await user(),t=await create(u);
 await DB.prepare('UPDATE users SET is_locked=1 WHERE id=?').bind(u.id).run();
 assert.equal((await req('/api/account/topups',{method:'POST',cookie:u.cookie,body:{amount_vnd:10000,request_key:randomUUID()}})).status,401);
 assert.equal((await reconcile(t)).status,200);
 const row=await DB.prepare('SELECT balance_vnd FROM wallet_accounts WHERE user_id=?').bind(u.id).first();assert.equal(row.balance_vnd,50000);
});
test('financial queue counts and bank details are scoped separately by permission',async()=>{
 const seller=await user(),t=await create(seller);
 await req('/api/account/topups/'+t.code+'/report',{method:'POST',cookie:seller.cookie,body:{version:1}});
 const viewer=await user(false);await role(viewer,['topups.read']);
 const response=await req('/api/cms/notifications',{cookie:viewer.cookie});const data=await response.json();assert.ok(data.counts.topups>=1);assert.equal(data.counts.sellers,0);assert.equal(data.items[0].id,'pending-topups');
 const onlyWallet=await user(false);await role(onlyWallet,['wallets.read']);
 const walletData=await (await req('/api/cms/wallets/'+seller.id,{cookie:onlyWallet.cookie})).json();assert.equal(walletData.bank,null);
 const scoped=await (await req('/api/cms/notifications',{cookie:onlyWallet.cookie})).json();assert.equal(scoped.counts.topups,0);assert.deepEqual(scoped.items,[]);
});
