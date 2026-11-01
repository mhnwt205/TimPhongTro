import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {createTestHarness} from 'wrangler';
const server=createTestHarness({root:fileURLToPath(new URL('../',import.meta.url)),workers:[{configPath:'apps/api/wrangler.test.jsonc'}]});
let origin,DB,seq=0,root;
const password='Mat-khau-thu-CMS-2026';
const req=(path,{method='GET',body,cookie,headers={}}={})=>server.fetch(new URL(path,origin),{method,headers:{...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'}),'CF-Connecting-IP':`192.0.2.${++seq%240+1}`,...(cookie?{cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
const api=(path,options={})=>req('/api/cms/'+path,{cookie:root.cookie,...options});
async function register(){const email=`cms-${++seq}@example.test`;const r=await req('/api/auth/register',{method:'POST',body:{name:'Tài khoản CMS thử',email,password}});assert.equal(r.status,201);return {...(await r.json()).user,cookie:r.headers.get('set-cookie').split(';')[0]};}
async function role(permissions){const r=await api('roles',{method:'POST',body:{name:'Vai trò '+(++seq),description:'Thử phân quyền',permissions}});assert.equal(r.status,201,await r.clone().text());return (await r.json()).id;}
async function grant(user,ids){const row=await DB.prepare('SELECT version FROM users WHERE id=?').bind(user.id).first();const r=await api('users/'+user.id+'/roles',{method:'POST',body:{version:row.version,role_ids:ids}});assert.equal(r.status,200,await r.clone().text());const login=await req('/api/auth/login',{method:'POST',body:{email:user.email,password}});assert.equal(login.status,200);user.cookie=login.headers.get('set-cookie').split(';')[0];}
async function row(key,id){const r=await api(key+'?state=all');assert.equal(r.status,200);return (await r.json()).items.find(x=>x.id===id);}
before(async()=>{origin=(await server.listen()).url.origin;await server.getWorker().applyD1Migrations('DB');({DB}=await server.getWorker().getEnv());root=await register();await DB.prepare("UPDATE users SET role='admin',is_super_admin=1 WHERE id=?").bind(root.id).run();});
after(async()=>{await server.close();});
test('CMS requires authentication and grants, including legacy seller routes',async()=>{
 const user=await register();
 assert.equal((await req('/api/cms/users')).status,401);
 for(const key of ['users','roles','plans','locations','content','site-content','listings','audit','summary'])assert.equal((await req('/api/cms/'+key,{cookie:user.cookie})).status,403);
 assert.equal((await req('/api/auth/login',{method:'POST',body:{email:user.email,password,context:'cms'}})).status,403);
 assert.equal((await req('/api/admin/sellers',{cookie:user.cookie})).status,403);
 const readRole=await role(['users.read']);await grant(user,[readRole]);
 assert.equal((await req('/api/cms/users',{cookie:user.cookie})).status,200);
 assert.equal((await req('/api/cms/users',{method:'POST',cookie:user.cookie,body:{}})).status,403);
 assert.equal((await req('/api/admin/sellers',{cookie:user.cookie})).status,403);
 const summary=await (await req('/api/cms/summary',{cookie:user.cookie})).json();assert.deepEqual(Object.keys(summary.metrics),['users']);
});
test('user CRUD ignores privilege injection, detects stale edits and preserves audit on trash/restore',async()=>{
 const email=`created-${++seq}@example.test`;
 const r=await api('users',{method:'POST',body:{name:'Tạo từ CMS',email,password,is_super_admin:1,role:'admin'}});assert.equal(r.status,201);const id=(await r.json()).id;
 let item=await row('users',id);assert.equal(item.is_super_admin,0);assert.equal(item.role,'user');
 const serialized=JSON.stringify(item);assert.ok(!serialized.includes('password_hash')&&!serialized.includes('token_hash'));
 const results=await Promise.all(['A','B'].map(n=>api('users/'+id,{method:'PATCH',body:{version:item.version,name:'Tên mới '+n,email}})));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);item=await row('users',id);
 assert.equal((await api('users/'+id,{method:'DELETE',body:{version:item.version,note:'Xóa tài khoản thử.'}})).status,200);
 assert.equal((await req('/api/auth/login',{method:'POST',body:{email,password}})).status,401);
 item=await row('users',id);assert.ok(item.deleted_at);assert.equal(item.is_locked,1);
 assert.equal((await api('users/'+id+'/restore',{method:'POST',body:{version:item.version,note:'Khôi phục để kiểm tra.'}})).status,200);
 item=await row('users',id);assert.equal(item.deleted_at,null);assert.equal(item.is_locked,1);
 const audit=(await DB.prepare('SELECT action FROM admin_audit WHERE target_id=?').bind(id).all()).results.map(x=>x.action);
 for(const action of ['user.create','user.update','user.delete','user.restore'])assert.ok(audit.includes(action));
});
test('cannot self lock/delete/change grants or remove a super administrator',async()=>{
 const normal=await register();const super2=await register();await DB.prepare('UPDATE users SET is_super_admin=1 WHERE id=?').bind(super2.id).run();
 for(const target of [root,super2]){
  const current=await row('users',target.id);
  for(const [suffix,method,extra] of [['','DELETE',{}],['/lock','POST',{locked:true}],['/roles','POST',{role_ids:[]}]])assert.equal((await api('users/'+target.id+suffix,{method,body:{version:current.version,note:'Thử bảo vệ quản trị.',...extra}})).status,403);
 }
 const r=await role(['users.update','users.assign_roles','users.read']);await grant(normal,[r]);
 assert.equal((await req('/api/cms/users/'+root.id,{method:'PATCH',cookie:normal.cookie,body:{version:1,name:'Không được sửa',email:'bad@example.test'}})).status,404);
});
test('permissions are bounded on role creation, editing, assignment, deletion and restoration',async()=>{
 const staff=await register(),low=await register();
 const manager=await role(['roles.read','roles.create','roles.update','roles.delete','users.assign_roles','users.read']);await grant(staff,[manager]);
 const options={cookie:staff.cookie,method:'POST'};
 assert.equal((await req('/api/cms/roles',{...options,body:{name:'Vượt quyền',description:'',permissions:['plans.delete']}})).status,403);
 let r=await req('/api/cms/roles',{...options,body:{name:'Quyền xem thôi',description:'',permissions:['users.read']}});assert.equal(r.status,201);const limitedId=(await r.json()).id;
 let managerRow=await row('roles',manager);
 assert.equal((await req('/api/cms/roles/'+manager,{cookie:staff.cookie,method:'PATCH',body:{version:managerRow.version,name:'Tự sửa vai trò',description:'',permissions:[]}})).status,403);
 const high=await role(['plans.delete']);const target=await row('users',low.id);
 assert.equal((await req('/api/cms/users/'+low.id+'/roles',{...options,body:{version:target.version,role_ids:[high]}})).status,403);
 assert.equal((await req('/api/cms/users/'+low.id+'/roles',{...options,body:{version:target.version,role_ids:[limitedId]}})).status,200);
 const highRow=await row('roles',high);
 assert.equal((await req('/api/cms/roles/'+high,{cookie:staff.cookie,method:'DELETE',body:{version:highRow.version,note:'Không được xóa vai trò cao.'}})).status,403);
});
test('role changes and trash revoke rights for an existing session immediately',async()=>{
 const staff=await register();const id=await role(['plans.read']);await grant(staff,[id]);
 assert.equal((await req('/api/cms/plans',{cookie:staff.cookie})).status,200);
 const item=await row('roles',id);
 assert.equal((await api('roles/'+id,{method:'DELETE',body:{version:item.version,note:'Thu hồi quyền đọc gói.'}})).status,200);
 assert.equal((await req('/api/cms/plans',{cookie:staff.cookie})).status,403);
 const removed=await row('roles',id);
 assert.equal((await api('roles/'+id+'/restore',{method:'POST',body:{version:removed.version,note:'Khôi phục quyền đọc gói.'}})).status,200);
 assert.equal((await req('/api/cms/plans',{cookie:staff.cookie})).status,200);
});
test('seller read grants cannot review or lock through the older API',async()=>{
 const staff=await register();const id=await role(['sellers.read']);await grant(staff,[id]);
 assert.equal((await req('/api/admin/sellers',{cookie:staff.cookie})).status,200);
 assert.equal((await req('/api/admin/sellers/'+root.id+'/review',{method:'POST',cookie:staff.cookie,body:{version:1,decision:'approved'}})).status,403);
 assert.equal((await req('/api/admin/sellers/'+root.id+'/lock',{method:'POST',cookie:staff.cookie,body:{version:1,locked:true,note:'Không được khóa.'}})).status,403);
});
test('support and policy pages contain customer-facing copy but remain hidden drafts',async()=>{
 const response=await api('content');assert.equal(response.status,200);
 const rows=(await response.json()).items.filter(item=>String(item.id).startsWith('support-draft-'));
 assert.equal(rows.length,5);
 assert.ok(rows.every(row=>row.is_active===0&&row.body.trim().length>0));
 assert.ok(rows.every(row=>!row.body.includes('Tìm Phòng Trọ')));
 assert.match(rows.find(row=>row.slug==='quy-dinh-dang-tin').body,/Trọ Tốt TP\.HCM kết nối/);
 assert.ok(rows.every(row=>!/(?:\bCMS\b|\bD1\b|\bR2\b|\bWorker\b|migration)/i.test(row.body)));
 assert.match(rows.find(row=>row.slug==='quy-dinh-dang-tin').body,/Người đăng chịu trách nhiệm/);
 assert.match(rows.find(row=>row.slug==='phi-dang-tin-va-gia-han').body,/Tin nháp, tin đang chờ/);
 assert.match(rows.find(row=>row.slug==='nap-rut-va-hoan-tien').body,/Website không nhận tiền thuê phòng/);
 const empty=await api('content',{method:'POST',body:{title:'Trang chưa sẵn sàng',slug:'trang-chua-san-sang',body:'',is_active:1}});
 assert.equal(empty.status,400);
});
test('plans, locations, pages and draft listings have real CRUD, CAS and reversible deletion',async()=>{
 const cases=[['plans',{name:'Gói thử riêng',price_vnd:7000,duration_days:10,description:'Mô tả do quản trị viên nhập cho gói thử.',is_priority:0,is_active:1}],['locations',{name:'Khu vực thử riêng',description:'Khu vực test',is_active:1}],['content',{title:'Trang thử riêng',slug:'trang-thu-rieng',body:'Nội dung <script> giữ dạng văn bản',is_active:1}]];
 for(const [key,data] of cases){
  const created=await api(key,{method:'POST',body:data});assert.equal(created.status,201,await created.clone().text());const id=(await created.json()).id;
  if(key==='locations'){
   assert.equal((await DB.prepare('SELECT name_key FROM locations WHERE id=?').bind(id).first()).name_key,'khu vuc thu rieng');
   for(const name of [data.name.toLowerCase(),'KHU VỰC THỬ RIÊNG','Khu vuc thu rieng',' Khu   vực thử riêng ']){const duplicate=await api(key,{method:'POST',body:{...data,name}});assert.equal(duplicate.status,409,`Expected ${JSON.stringify(name)} to conflict`);assert.match((await duplicate.json()).error,/Tên khu vực này đã tồn tại/);}
  }
  let item=await row(key,id);assert.ok(item);if(key==='plans'){assert.equal(item.description,data.description);const publicPlan=(await (await req('/api/plans')).json()).items.find(p=>p.id===id);assert.equal(publicPlan.description,data.description);}const updates=await Promise.all([1,2].map(()=>api(key+'/'+id,{method:'PATCH',body:{...data,version:item.version}})));assert.deepEqual(updates.map(x=>x.status).sort(),key==='listings'?[409,409]:[200,409]);
  const writes=await DB.prepare('SELECT count(*) AS n FROM admin_audit WHERE target_id=? AND action=?').bind(id,key+'.update').first();assert.equal(writes.n,key==='listings'?0:1);
  item=await row(key,id);assert.equal((await api(key+'/'+id,{method:'DELETE',body:{version:item.version,note:'Dọn bản ghi thử nghiệm.'}})).status,200);
  assert.ok((await row(key,id)).deleted_at);
  if(key==='locations'){const trashed=await api(key,{method:'POST',body:{...data,name:'KHU VUC THU RIENG'}});assert.equal(trashed.status,409);assert.match((await trashed.json()).error,/thùng rác/);}
  if(key==='plans')assert.ok(!(await (await req('/api/plans')).json()).items.some(p=>p.id===id));
  item=await row(key,id);assert.equal((await api(key+'/'+id+'/restore',{method:'POST',body:{version:item.version,note:'Khôi phục bản ghi thử.'}})).status,200);
  item=await row(key,id);assert.equal(item.deleted_at,null);if('is_active'in item)assert.equal(item.is_active,0);
 }
 assert.equal((await api('listings',{method:'POST',body:{title:'Tin thiếu thông tin chi tiết',owner_id:root.id,location_id:'thu-duc',room_type:'room',price_vnd:3000000,area_m2:22,description:'Mô tả đầy đủ.'}})).status,409);
});
test('rejects invalid numeric values, owners and CMS CSRF; exposes no draft public route',async()=>{
 for(const price of [0,-1,1.5,'bad'])assert.equal((await api('plans',{method:'POST',body:{name:'Gói sai',price_vnd:price,duration_days:7,is_active:1}})).status,400);
 assert.equal((await api('roles',{method:'POST',body:{name:'Quyền lạ',permissions:['unknown.execute']}})).status,403);
 assert.equal((await api('plans',{method:'POST',headers:{Origin:'https://evil.test'},body:{}})).status,403);
 assert.equal((await api('listings',{method:'POST',body:{title:'Phòng không hợp lệ',owner_id:'missing',location_id:'thu-duc',room_type:'room',price_vnd:3000000,area_m2:20}})).status,409);
 assert.equal((await req('/api/listings')).status,404);
});
test('duplicate CMS names and invalid fields explain what to change',async()=>{
 const roleName='Vai trò trùng thử';
 assert.equal((await api('roles',{method:'POST',body:{name:roleName,description:'',permissions:[]}})).status,201);
 const duplicateRole=await api('roles',{method:'POST',body:{name:roleName.toLowerCase(),description:'',permissions:[]}});
 assert.equal(duplicateRole.status,409);assert.match((await duplicateRole.json()).error,/Tên vai trò này đã được sử dụng/);
 const slug='trang-trung-thu';
 assert.equal((await api('content',{method:'POST',body:{title:'Trang trùng thử',slug,body:'Nội dung trang thử',is_active:0}})).status,201);
 const duplicatePage=await api('content',{method:'POST',body:{title:'Trang khác',slug,body:'Nội dung trang thử',is_active:0}});
 assert.equal(duplicatePage.status,409);assert.match((await duplicatePage.json()).error,/Mã đường dẫn này đã được sử dụng/);
 const invalidLocation=await api('locations',{method:'POST',body:{name:'X',description:'',is_active:1}});
 assert.equal(invalidLocation.status,400);assert.match((await invalidLocation.json()).error,/Tên khu vực cần từ 2–100 ký tự/);
 const concurrentLocations=await Promise.all(['Khu vực đồng thời','Khu vuc dong thoi'].map(name=>api('locations',{method:'POST',body:{name,description:'Thử tạo cùng lúc',is_active:1}})));
 assert.deepEqual(concurrentLocations.map(response=>response.status).sort(),[201,409]);
});
test('locking revokes sessions and permissions; password change verifies old secret and revokes all sessions',async()=>{
 const user=await register();const id=await role(['content.read']);await grant(user,[id]);
 let item=await row('users',user.id);
 assert.equal((await api('users/'+user.id+'/lock',{method:'POST',body:{version:item.version,locked:true,note:'Kiểm tra thu hồi phiên.'}})).status,200);
 assert.equal((await req('/api/auth/me',{cookie:user.cookie})).status,401);
 item=await row('users',user.id);assert.equal((await api('users/'+user.id+'/lock',{method:'POST',body:{version:item.version,locked:false,note:'Mở khóa tài khoản thử.'}})).status,200);
 const login=await req('/api/auth/login',{method:'POST',body:{email:user.email,password}});user.cookie=login.headers.get('set-cookie').split(';')[0];
 const next='Mat-khau-moi-khac-2026';
 assert.equal((await req('/api/auth/password',{method:'POST',cookie:user.cookie,body:{current_password:'sai-mat-khau',password:next,password_confirmation:next}})).status,400);
 assert.equal((await req('/api/auth/password',{method:'POST',cookie:user.cookie,body:{current_password:password,password:next,password_confirmation:next}})).status,200);
 assert.equal((await req('/api/auth/me',{cookie:user.cookie})).status,401);
 assert.equal((await req('/api/auth/login',{method:'POST',body:{email:user.email,password}})).status,401);
 assert.equal((await req('/api/auth/login',{method:'POST',body:{email:user.email,password:next}})).status,200);
});

test('dashboard buckets activity by Vietnam day, validates 7/30 days and filters series by grants',async()=>{
 const now=Date.now(),today=new Date(now+7*3600000).toISOString().slice(0,10),start=new Date(today+'T00:00:00Z');start.setUTCDate(start.getUTCDate()-6);
 const boundary=Math.floor(start.getTime()/1000)-7*3600;
 const a=await register(),b=await register(),outside=await register();
 await DB.prepare('UPDATE users SET created_at=? WHERE id=?').bind(boundary+86399,a.id).run();
 await DB.prepare('UPDATE users SET created_at=? WHERE id=?').bind(boundary+86400,b.id).run();
 await DB.prepare('UPDATE users SET created_at=? WHERE id=?').bind(boundary-1,outside.id).run();
 const summary=await (await api('summary?days=7')).json();
 assert.equal(summary.activity.length,7);assert.equal(summary.activity[0].users,1);assert.equal(summary.activity[1].users,1);
 assert.equal(summary.activity[0].day,start.toISOString().slice(0,10));
 assert.equal((await (await api('summary?days=30')).json()).activity.length,30);
 assert.equal((await api('summary?days=365')).status,400);
 const staff=await register(),read=await role(['users.read']);await grant(staff,[read]);
 const limited=await (await req('/api/cms/summary',{cookie:staff.cookie})).json();
 assert.deepEqual(Object.keys(limited.metrics),['users']);assert.ok(limited.activity.every(p=>p.users!==undefined&&p.listings===undefined&&p.content===undefined));
 assert.deepEqual(limited.notifications.items,[]);assert.deepEqual(limited.notifications.activity,[]);assert.deepEqual(limited.pending_sellers,[]);
 const normal=await register();assert.equal((await req('/api/cms/notifications',{cookie:normal.cookie})).status,403);
});
test('notification work counts follow live pending profiles and exclude locked accounts',async()=>{
 const a=await register(),locked=await register();
 for(const user of [a,locked])assert.equal((await req('/api/account/profile',{method:'POST',cookie:user.cookie,body:{version:0,display_name:'Hồ sơ chờ kiểm tra',seller_type:'owner',phone:'0901234567',zalo_phone:'',introduction:''}})).status,200);
 await DB.prepare('UPDATE users SET is_locked=1 WHERE id=?').bind(locked.id).run();
 const summary=await (await api('summary')).json();assert.equal(summary.metrics.sellers,1);assert.equal(summary.notifications.pending,1);assert.equal(summary.pending_sellers.length,1);
 assert.equal(summary.distribution.items.find(i=>i.label==='Chờ duyệt').value,1);
 const reader=await register(),read=await role(['sellers.read']);await grant(reader,[read]);
 const notifications=await (await req('/api/cms/notifications',{cookie:reader.cookie})).json();assert.equal(notifications.pending,1);assert.equal(notifications.items[0].href,'/quan-tri/nguoi-dang?status=pending');assert.deepEqual(notifications.activity,[]);
 assert.equal((await req('/api/admin/sellers/'+a.id+'/review',{method:'POST',cookie:root.cookie,body:{version:1,decision:'approved',note:''}})).status,200);
 const updated=await (await api('notifications')).json();assert.equal(updated.pending,0);assert.deepEqual(updated.items,[]);
});
test('notification activity uses safe labels and does not disclose raw audit notes',async()=>{
 const marker='sensitive-note-not-for-notifications';
 await DB.prepare("INSERT INTO admin_audit(id,actor_id,action,target_id,note) VALUES(?,?,'user.roles',?,?)").bind(crypto.randomUUID(),root.id,root.id,marker).run();
 const response=await api('notifications');assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
 const body=await response.json();assert.ok(body.activity.length<=5);assert.equal(body.activity[0].label,'Thay đổi vai trò tài khoản');assert.ok(!JSON.stringify(body).includes(marker));
});

test('website content is editable and changed free-post defaults affect only new accounts',async()=>{
 const existing=await register();
 const existingQuota=await DB.prepare('SELECT free_posts_total FROM posting_promotions WHERE user_id=?').bind(existing.id).first();
 assert.equal(existingQuota.free_posts_total,3);
 const response=await api('site-content');assert.equal(response.status,200);const settings=(await response.json()).settings;
 assert.match(settings.free_posts_body,/\{\{free_posts\}\}/);
 assert.ok(settings.disclaimer_before_report.includes('Trọ Tốt TP.HCM'));
 assert.ok(!settings.disclaimer_before_report.includes('Tìm Phòng Trọ'));
 const update=await api('site-content',{method:'PATCH',body:{...settings,free_posts_new_account:5}});assert.equal(update.status,200,await update.clone().text());
 const created=await register();const newQuota=await DB.prepare('SELECT free_posts_total FROM posting_promotions WHERE user_id=?').bind(created.id).first();
 assert.equal(newQuota.free_posts_total,5);assert.equal((await DB.prepare('SELECT free_posts_total FROM posting_promotions WHERE user_id=?').bind(existing.id).first()).free_posts_total,3);
 const audit=await DB.prepare("SELECT count(*) AS n FROM admin_audit WHERE action='site_content.update'").first();assert.equal(audit.n,1);
});
