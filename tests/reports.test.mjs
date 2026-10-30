import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createTestHarness} from 'wrangler';
const server=createTestHarness({root:fileURLToPath(new URL('../',import.meta.url)),workers:[{configPath:'apps/api/wrangler.test.jsonc'}]});
let origin,DB,seq=0,admin,owner;
const listingId=randomUUID(),listingTitle='Phòng thật kiểm thử báo cáo tại Bình Thạnh';
const req=(path,{body,cookie,method='GET',headers={}}={})=>server.fetch(new URL('/api/'+path,origin),{method,headers:{...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'}),'CF-Connecting-IP':`198.51.100.${++seq%240+1}`,...(cookie?{Cookie:cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
const post=(body,extra={})=>req('listing-reports',{method:'POST',body,...extra});
const payload=(extra={})=>({listing_id:listingId,listing_title:'INJECTED TITLE',is_sample:1,reason:'incorrect',details:'Thông tin giá thuê trong tin cần được kiểm tra lại.',contact_email:'',request_key:randomUUID(),...extra});
const cms=(path,body,cookie=admin.cookie)=>req('cms/'+path,{cookie,...(body?{method:'POST',body}:{})});
async function user(){const r=await req('auth/register',{method:'POST',body:{name:'Người kiểm thử báo cáo',email:`reports-${++seq}@example.test`,password:'Report-test-password-2026'}});assert.equal(r.status,201);return {...(await r.json()).user,cookie:r.headers.get('set-cookie').split(';')[0]};}
before(async()=>{
 origin=(await server.listen()).url.origin;await server.getWorker().applyD1Migrations('DB');({DB}=await server.getWorker().getEnv());
 admin=await user();await DB.prepare("UPDATE users SET role='admin',is_super_admin=1 WHERE id=?").bind(admin.id).run();owner=await user();
 await DB.prepare("INSERT INTO seller_profiles(user_id,display_name,seller_type,phone,zalo_phone,status,change_token) VALUES(?,'Chủ trọ kiểm thử báo cáo','owner','0901234567','0901234567','approved','fixture')").bind(owner.id).run();
 const publicData=JSON.stringify({id:listingId,title:listingTitle,area:'binh-thanh',areaLabel:'Bình Thạnh',type:'room',rent:3000000,size:25,street:'Khu vực Bình Thạnh',people:2,photo:0,images:[],amenities:[],deposit:3000000,electricity:4000,water:100000,water_unit:'per_person',service:0,parking:0,description:'Tin thật dùng để kiểm thử gửi báo cáo.',seller:{name:'Chủ trọ kiểm thử báo cáo',phone:'0901234567',zalo:'0901234567'}});
 await DB.prepare("INSERT INTO listing_drafts(id,title,owner_id,location_id,room_type,price_vnd,area_m2,description,details,plan_id,status,published_at,expires_at,public_data) VALUES(?,?,?,?,?,?,?,?,?,?,'published',unixepoch(),unixepoch()+86400,?)").bind(listingId,listingTitle,owner.id,'binh-thanh','room',3000000,25,'Tin thật dùng để kiểm thử gửi báo cáo.','{}','basic-7d',publicData).run();
});
after(async()=>await server.close());
test('anonymous report validates fields, derives listing title/sample flag on server and exposes only reference code',async()=>{
 for(const data of [payload({listing_id:'does-not-exist'}),payload({listing_id:'studio-ban-cong-binh-thanh'}),payload({reason:'fake'}),payload({details:'short'}),payload({contact_email:'invalid'}),payload({website:'spam'}),payload({details:'a'.repeat(2001)})])assert.equal((await post(data)).status,400);
 const data=payload({contact_email:'private-contact@example.test'}),r=await post(data);assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);const result=await r.json();assert.match(result.code,/^BAO[A-HJ-NP-Z2-9]{12}$/);assert.equal(result.details,undefined);assert.equal(result.contact_email,undefined);
 const row=await DB.prepare('SELECT * FROM listing_reports WHERE code=?').bind(result.code).first();assert.equal(row.listing_title,listingTitle);assert.equal(row.is_sample,0);assert.equal(row.status,'open');
 assert.equal((await req('listing-reports')).status,404);assert.equal((await cms('reports',undefined,'')).status,401);
});
test('same request key returns one report and changed content conflicts, including concurrent retries',async()=>{
 const data=payload(),responses=await Promise.all([post(data),post(data)]);assert.ok(responses.every(r=>r.status===200));const codes=await Promise.all(responses.map(r=>r.json()));assert.equal(codes[0].code,codes[1].code);assert.equal((await DB.prepare('SELECT count(*) AS n FROM listing_reports WHERE request_key=?').bind(data.request_key).first()).n,1);
 assert.equal((await post({...data,details:'Nội dung khác dùng cùng mã đã gửi.'})).status,409);
});
test('origin/size controls and IP rate limit apply to reports',async()=>{
 assert.equal((await post(payload(),{headers:{Origin:'https://evil.test'}})).status,403);
 assert.equal((await post(payload({details:'a'.repeat(9000)}))).status,413);
 for(let i=0;i<5;i++)assert.equal((await post(payload(),{headers:{'CF-Connecting-IP':'203.0.113.245'}})).status,200);
 assert.equal((await post(payload(),{headers:{'CF-Connecting-IP':'203.0.113.245'}})).status,429);
});
test('reports are permission scoped; read only operator sees queue but cannot review',async()=>{
 const u=await user(),role=randomUUID();await DB.prepare('INSERT INTO cms_roles(id,name) VALUES(?,?)').bind(role,'Report reader '+role).run();await DB.prepare("INSERT INTO cms_role_permissions(role_id,permission) VALUES(?,'reports.read')").bind(role).run();await DB.prepare('INSERT INTO cms_user_roles(user_id,role_id) VALUES(?,?)').bind(u.id,role).run();
 const r=await cms('reports',undefined,u.cookie);assert.equal(r.status,200);const rows=await r.json();assert.ok(rows.total>0);assert.equal(rows.items[0].request_key,undefined);
 assert.equal((await cms('reports/'+rows.items[0].id+'/review',{version:1,status:'resolved',note:'Kiểm thử quyền chỉ đọc.'},u.cookie)).status,403);
 const n=await (await cms('notifications',undefined,u.cookie)).json();assert.ok(n.counts.reports>0);assert.equal(n.counts.topups,0);assert.equal(n.items[0].id,'pending-reports');
});
test('review CAS prevents conflicting decisions, preserves report content and records restricted audit',async()=>{
 const sent=await (await post(payload())).json(),row=await DB.prepare('SELECT * FROM listing_reports WHERE code=?').bind(sent.code).first();
 const body={version:row.version,status:'reviewing',note:'Đang kiểm tra nội dung được phản ánh.'};assert.equal((await cms('reports/'+row.id+'/review',body)).status,200);
 assert.equal((await cms('reports/'+row.id+'/review',{...body,status:'resolved'})).status,409);
 const after=await DB.prepare('SELECT * FROM listing_reports WHERE id=?').bind(row.id).first();assert.equal(after.version,2);assert.equal(after.details,row.details);assert.equal((await DB.prepare('SELECT count(*) AS n FROM listing_report_events WHERE report_id=?').bind(row.id).first()).n,1);
 for(const statement of ['DELETE FROM listing_reports WHERE id=?','UPDATE listing_reports SET listing_title=\'changed\' WHERE id=?'])await assert.rejects(DB.prepare(statement).bind(row.id).run());
 assert.equal((await cms('reports/'+row.id+'/review',{version:2,status:'reviewing',note:'Bổ sung ghi chú khi vẫn đang kiểm tra.'})).status,200);
 const audit=await DB.prepare("SELECT note FROM admin_audit WHERE target_id=? AND action='report.review'").bind(row.id).first();assert.doesNotMatch(audit.note,/Đang kiểm tra|email|@/);
 assert.equal((await cms('reports?status=invalid')).status,400);
});
