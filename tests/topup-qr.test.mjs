import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createTestHarness} from 'wrangler';
import sharp from 'sharp';
import jsQR from 'jsqr';
const server=createTestHarness({root:fileURLToPath(new URL('../',import.meta.url)),workers:[{configPath:'apps/api/wrangler.test.jsonc'}]});
let origin,DB,admin,seq=0,legacyBank;const password='Topup-QR-test-password-2026';
const req=(path,{method='GET',body,cookie}={})=>server.fetch(new URL('/api/'+path,origin),{method,headers:{...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'}),'CF-Connecting-IP':`198.51.100.${++seq%240+1}`,...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
const cms=(path,body)=>req('cms/'+path,{cookie:admin.cookie,...(body?{method:'POST',body}:{})});
async function user(){const r=await req('auth/register',{method:'POST',body:{name:'Người thử VietQR',email:`qr-${++seq}@example.test`,password}});assert.equal(r.status,201);const u={...(await r.json()).user,cookie:r.headers.get('set-cookie').split(';')[0]};await DB.prepare("INSERT INTO seller_profiles(user_id,display_name,seller_type,phone,zalo_phone,status,change_token) VALUES(?,'Kiểm thử QR','owner','0901234567','0901234567','approved','fixture')").bind(u.id).run();return u;}
async function configure(code='TPB',number='000123456789'){const names={TPB:'TPBank',STB:'Sacombank',VCB:'Vietcombank'},id='legacy-qr-'+code+'-'+number;await DB.prepare('INSERT INTO receiving_bank_accounts(id,bank_code,bank_name,account_number,account_holder) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,code,names[code],number,'KIEM THU QR LOCAL').run();legacyBank=await DB.prepare('SELECT id,bank_code,bank_name,account_number,account_holder FROM receiving_bank_accounts WHERE id=?').bind(id).first();return legacyBank;}
async function create(u,value=50000){
 const id=randomUUID(),alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',code='NAP'+Array.from({length:12},()=>alphabet[Math.floor(Math.random()*alphabet.length)]).join('');
 const bank=legacyBank;assert.ok(bank);
 await DB.batch([DB.prepare("INSERT INTO topup_requests(id,code,user_id,request_key,requested_vnd,bank_account_id,bank_code,bank_name,account_number,account_holder,payment_provider) VALUES(?,?,?,?,?,?,?,?,?,?,'manual')").bind(id,code,u.id,randomUUID(),value,bank.id,bank.bank_code,bank.bank_name,bank.account_number,bank.account_holder),DB.prepare("INSERT INTO topup_events(id,topup_id,actor_id,action,note) VALUES(?,?,?,'created','Fixture for legacy QR tests')").bind(randomUUID(),id,u.id)]);
 return await DB.prepare('SELECT * FROM topup_requests WHERE id=?').bind(id).first();
}
const qr=(u,t,suffix='')=>req('account/topups/'+t.code+'/qr'+suffix,{cookie:u.cookie});
function tlv(s){const map={};for(let i=0;i<s.length;){const id=s.slice(i,i+2),n=Number(s.slice(i+2,i+4));assert.ok(/^\d{2}$/.test(id)&&Number.isInteger(n)&&n>0&&i+4+n<=s.length);assert.ok(!(id in map));map[id]=s.slice(i+4,i+4+n);i+=4+n;}return map;}
function crc(s){let n=0xffff;for(const b of Buffer.from(s)){n^=b<<8;for(let i=0;i<8;i++)n=(n&0x8000)?((n<<1)^0x1021)&0xffff:(n<<1)&0xffff;}return n.toString(16).toUpperCase().padStart(4,'0');}
async function decode(response,size=360){assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/image\/svg\+xml/);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(response.headers.get('cross-origin-resource-policy'),'same-origin');const svg=await response.text();assert.doesNotMatch(svg,/<script|<image|<foreignObject|href=/i);const {data,info}=await sharp(Buffer.from(svg)).resize(size,size).ensureAlpha().raw().toBuffer({resolveWithObject:true});const result=jsQR(new Uint8ClampedArray(data),info.width,info.height);assert.ok(result,'QR image must decode independently');return result.data;}
function check(payload,t,bin){const root=tlv(payload),merchant=tlv(root['38']),consumer=tlv(merchant['01']);assert.equal(root['00'],'01');assert.equal(root['01'],'12');assert.equal(merchant['00'],'A000000727');assert.equal(merchant['02'],'QRIBFTTA');assert.equal(consumer['00'],bin);assert.equal(consumer['01'],t.account_number);assert.equal(root['53'],'704');assert.equal(root['54'],String(t.requested_vnd));assert.equal(root['58'],'VN');assert.equal(tlv(root['62'])['08'],t.code);assert.equal(root['63'],crc(payload.slice(0,-4)));}
before(async()=>{origin=(await server.listen()).url.origin;await server.getWorker().applyD1Migrations('DB');({DB}=await server.getWorker().getEnv());admin=await user();await DB.prepare("UPDATE users SET role='admin',is_super_admin=1 WHERE id=?").bind(admin.id).run();});
after(async()=>await server.close());
test('VietQR images for TPBank, Sacombank and Vietcombank decode into exact bank/account/amount/code with valid CRC',async()=>{
 const published='00020101021238530010A0000007270123000697041601092576788590208QRIBFTTA53037045405100005802VN62150811Chuyen tien630453E6';assert.equal(crc(published.slice(0,-4)),published.slice(-4));
 for(const [bank,bin,size,value] of [['TPB','970423',280,50000],['STB','970403',360,10000],['VCB','970436',900,1000000]]){await configure(bank);const u=await user(),t=await create(u,value);check(await decode(await qr(u,t),size),t,bin);assert.equal((await (await req('account/topups/'+t.code,{cookie:u.cookie})).json()).qr_available,true);}
});
test('QR uses immutable legacy request snapshot, ignores supplied query bank/amount and never credits money',async()=>{
 await configure('STB');const u=await user(),t=await create(u);const first=await decode(await qr(u,t));await configure('TPB','999987654321');const second=await decode(await qr(u,t,'?bank_code=TPB&amount_vnd=1&account_number=999987654321'));assert.equal(second,first);check(second,t,'970403');
 const w=await (await req('account/wallet',{cookie:u.cookie})).json();assert.equal(w.balance_vnd,0);assert.equal(w.ledger.total,0);
});
test('QR owner access is enforced; anonymous and other accounts cannot fetch the financial image',async()=>{
 await configure();const a=await user(),b=await user(),t=await create(a);assert.equal((await qr(b,t)).status,404);
 assert.equal((await req('account/topups/'+t.code+'/qr')).status,401);assert.equal((await req('account/topups/NAPAAAAAAAAAAAA/qr',{cookie:a.cookie})).status,404);
});
test('reported and cancelled requests no longer serve a QR to discourage accidental duplicate transfers',async()=>{
 await configure();const u=await user();for(const action of ['report','cancel']){const t=await create(u);assert.equal((await qr(u,t)).status,200);const r=await req('account/topups/'+t.code+'/'+action,{method:'POST',cookie:u.cookie,body:{version:t.version}});assert.equal(r.status,200);assert.equal((await qr(u,t)).status,409);assert.equal((await (await req('account/topups/'+t.code,{cookie:u.cookie})).json()).qr_available,false);}
});
test('credited legacy requests never expose a reusable payment QR and preserve accounting',async()=>{
 await configure('STB');const u=await user(),t=await create(u);assert.equal((await cms('topups/'+t.id+'/reconcile',{version:t.version,actual_vnd:t.requested_vnd,bank_account_id:t.bank_account_id,bank_reference:'QRCREDIT'+seq,verified:true})).status,200);assert.equal((await qr(u,t)).status,409);assert.equal((await (await req('account/topups/'+t.code,{cookie:u.cookie})).json()).qr_available,false);assert.equal((await (await req('account/wallet',{cookie:u.cookie})).json()).balance_vnd,t.requested_vnd);
});
