import { Hono } from 'hono';
import type { ApiContext, ApiEnv, User } from './security';
import { readBody, requireUser, requireAdmin, requirePermission, limit } from './security';
import { allPermissions, permissionGroups, can } from './permissions';
import { hashPassword } from './password';
import { text } from './responses';
import { loadDashboard,loadNotifications } from './dashboard';
import { websiteTextFields, type WebsiteSettings } from './website-settings';
import {sendVerificationEmail} from './auth';

const router = new Hono<ApiEnv>();
router.use('*', requireUser, requireAdmin);
router.use('*', async(c,next)=>{ if(!['GET','HEAD'].includes(c.req.method)){const denied=await limit(c,'cms-write',c.get('user').id,120,3600);if(denied)return denied;} await next(); });
const uid=()=>crypto.randomUUID();
const validVersion=(v:unknown)=>Number.isSafeInteger(Number(v))&&Number(v)>=1;
const fail=(c:ApiContext,error:string,status:400|403|404|409|503=400)=>c.json({error},status);
const stale=(c:ApiContext)=>fail(c,'Bản ghi đã được thay đổi, xóa hoặc khôi phục kể từ lần tải gần nhất. Tải lại danh sách để lấy dữ liệu mới rồi thử lại.',409);
const audit=(c:ApiContext,table:string,id:string,stamp:string,action:string,note='')=>c.env.DB.prepare(`INSERT INTO admin_audit(id,actor_id,action,target_id,note) SELECT ?,?,?,id,? FROM ${table} WHERE id=? AND change_token=?`).bind(uid(),c.get('user').id,action,note,id,stamp);
async function mutate(c:ApiContext,statements:D1PreparedStatement[]){
 try{return (await c.env.DB.batch<Record<string,any>>(statements))[0].meta.changes===1;}
 catch(error){if(/UNIQUE constraint failed/i.test(String(error)))return false;throw error;}
}
const fields='id,email,name,role,is_locked,is_super_admin,version,deleted_at,created_at,updated_at';
// Recheck hierarchy within the write statement, including concurrent role edits.
const permittedSql=(c:ApiContext)=>c.get('user').permissions.filter(p=>allPermissions.includes(p)).map(p=>"'"+p+"'").join(',')||"''";
const userScope=(c:ApiContext)=>c.get('user').is_super_admin?'1=1':`NOT EXISTS(SELECT 1 FROM cms_user_roles ur JOIN cms_roles r ON r.id=ur.role_id JOIN cms_role_permissions p ON p.role_id=r.id WHERE ur.user_id=users.id AND r.deleted_at IS NULL AND p.permission NOT IN (${permittedSql(c)}))`;
async function manageable(c:ApiContext,id:string){
 const target=await c.env.DB.prepare(`SELECT ${fields} FROM users WHERE id=?`).bind(id).first<User & {deleted_at:number|null}>();
 if(!target)return null;
 if(target.is_super_admin && target.id!==c.get('user').id)return c.get('user').is_super_admin?target:null;
 if(!c.get('user').is_super_admin){
  if(target.is_super_admin)return null;
  const held=(await c.env.DB.prepare(`SELECT p.permission FROM cms_user_roles ur JOIN cms_roles r ON r.id=ur.role_id JOIN cms_role_permissions p ON p.role_id=r.id WHERE ur.user_id=? AND r.deleted_at IS NULL`).bind(id).all<{permission:string}>()).results;
  if(held.some(p=>!can(c.get('user'),p.permission)))return null;
 }
 return target;
}
router.get('/permissions',(c)=>c.json({groups:permissionGroups}));
router.get('/summary',async(c)=>{
 const days=Number(c.req.query('days')??7);
 if(days!==7&&days!==30)return fail(c,'Chọn khoảng 7 hoặc 30 ngày.');
 return c.json(await loadDashboard(c.env.DB,c.get('user'),days));
});
router.get('/notifications',async(c)=>c.json(await loadNotifications(c.env.DB,c.get('user'))));
router.get('/site-content',requirePermission('site_content.read'),async(c)=>c.json({settings:await c.env.DB.prepare('SELECT * FROM website_settings WHERE id=1').first<WebsiteSettings>()}));
router.patch('/site-content',requirePermission('site_content.update'),async(c)=>{
 const data=await readBody(c),version=Number(data.version),freePosts=Number(data.free_posts_new_account);
 if(!Number.isSafeInteger(version)||version<1||!Number.isSafeInteger(freePosts)||freePosts<0||freePosts>100)return fail(c,'Kiểm tra phiên bản và số tin miễn phí (0–100).');
 const values:string[]=[];
 for(const field of websiteTextFields){
  const value=text(data[field]);
  if(value.length>2000)return fail(c,'Mỗi nội dung tối đa 2.000 ký tự.');
  values.push(value);
 }
 if(!String(data.free_posts_title??'').includes('{{free_posts}}')||!String(data.free_posts_body??'').includes('{{free_posts}}')||!String(data.seller_cta_body??'').includes('{{free_posts}}'))return fail(c,'Giữ nguyên mã {{free_posts}} trong nội dung ưu đãi để số lượt miễn phí luôn khớp.');
 if(!String(data.disclaimer_before_report??'').includes('{{title}}'))return fail(c,'Giữ nguyên mã {{title}} trong lưu ý tin đăng để tự hiển thị tiêu đề tin.');
 const stamp=uid(),columns=[...websiteTextFields,'free_posts_new_account'];
 const update=c.env.DB.prepare(`UPDATE website_settings SET ${columns.map(field=>field+'=?').join(',')},version=version+1,updated_at=unixepoch() WHERE id=1 AND version=?`).bind(...values,freePosts,version);
 const audit=c.env.DB.prepare(`INSERT INTO admin_audit(id,actor_id,action,target_id,note) SELECT ?,?,'site_content.update','website_settings','Updated public website copy and new-account promotion' WHERE EXISTS(SELECT 1 FROM website_settings WHERE id=1 AND version=?)`).bind(uid(),c.get('user').id,version+1);
 const results=await c.env.DB.batch([update,audit]);
 return results[0].meta.changes===1?c.json({ok:true}):stale(c);
});
router.get('/options',async(c)=>{
 const user=c.get('user'); const result:Record<string,unknown>={};
 if(can(user,'users.assign_roles')) {
  const roles=(await c.env.DB.prepare(`SELECT r.id,r.name,COALESCE((SELECT json_group_array(permission) FROM cms_role_permissions WHERE role_id=r.id),'[]') AS permissions FROM cms_roles r WHERE deleted_at IS NULL ORDER BY name LIMIT 200`).all<{id:string;name:string;permissions:string}>()).results;
  result.roles=roles.filter(r=>(JSON.parse(r.permissions) as string[]).every(p=>can(user,p))).map(({id,name})=>({id,name}));
 }
 if(['listings.read','listings.create','listings.update'].some(p=>can(user,p))){
  const [locations,owners,plans]=await Promise.all([
   c.env.DB.prepare('SELECT id,name FROM locations WHERE deleted_at IS NULL AND is_active=1 ORDER BY name LIMIT 200').all(),
   c.env.DB.prepare(`SELECT u.id,COALESCE(p.display_name,u.name) AS name FROM users u JOIN seller_profiles p ON p.user_id=u.id WHERE u.deleted_at IS NULL AND u.is_locked=0 AND p.status='approved' ORDER BY name LIMIT 200`).all(),
   c.env.DB.prepare('SELECT id,name,price_vnd,duration_days,is_priority FROM listing_plans WHERE deleted_at IS NULL AND is_active=1 ORDER BY price_vnd LIMIT 100').all(),
  ]);
  result.locations=locations.results;
  result.owners=owners.results;
  result.plans=plans.results;
 }
 return c.json(result);
});
router.get('/users',requirePermission('users.read'),async(c)=>{
 const page=Number(c.req.query('page')??1),q=(c.req.query('q')??'').slice(0,100),state=c.req.query('state')??'active';
 if(!Number.isSafeInteger(page)||page<1||page>10000||!['active','deleted','all','locked'].includes(state))return fail(c,'Trạng thái hoặc số trang không hợp lệ. Chọn lại bộ lọc rồi tải danh sách.');
 const where=`WHERE id!='sepay-ipn-system' AND (instr(lower(name),lower(?))>0 OR instr(lower(email),lower(?))>0) AND ${state==='deleted'?'deleted_at IS NOT NULL':state==='all'?'1=1':state==='locked'?'deleted_at IS NULL AND is_locked=1':'deleted_at IS NULL'}`;
 const [items,total]=await c.env.DB.batch<Record<string,any>>([
  c.env.DB.prepare(`SELECT ${fields},COALESCE((SELECT json_group_array(role_id) FROM cms_user_roles WHERE user_id=users.id),'[]') AS role_ids FROM users ${where} ORDER BY created_at DESC,id LIMIT 20 OFFSET ?`).bind(q,q,(page-1)*20),
  c.env.DB.prepare(`SELECT count(*) AS total FROM users ${where}`).bind(q,q)
 ]);
 return c.json({items:items.results.map(r=>({...r,role_ids:JSON.parse(String(r.role_ids))})),total:Number(total.results[0]?.total??0),page,page_size:20});
});
router.post('/users',requirePermission('users.create'),async(c)=>{
 const data=await readBody(c),name=text(data.name),email=text(data.email).toLowerCase(),password=typeof data.password==='string'?data.password:'';
 if(name.length<2||name.length>100||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<12||password.length>128)return fail(c,'Tên cần từ 2–100 ký tự, email phải đúng định dạng và mật khẩu cần từ 12–128 ký tự.');
 const verify=c.env.EMAIL_VERIFICATION_REQUIRED==='true';if(verify&&(!c.env.RESEND_API_KEY||!c.env.EMAIL_FROM))return fail(c,'Email xác minh chưa sẵn sàng.',503);
 const id=uid(),stamp=uid(),digest=await hashPassword(password);
 const ok=await mutate(c,[c.env.DB.prepare(`INSERT INTO users(id,email,name,password_hash,email_verified_at,change_token) VALUES(?,?,?,?,CASE WHEN ?=1 THEN NULL ELSE unixepoch() END,?) ON CONFLICT(email) DO NOTHING`).bind(id,email,name,digest,verify?1:0,stamp),audit(c,'users',id,stamp,'user.create'),c.env.DB.prepare('INSERT INTO posting_promotions(user_id,free_posts_total) SELECT id,COALESCE((SELECT free_posts_new_account FROM website_settings WHERE id=1),3) FROM users WHERE id=? AND change_token=? ON CONFLICT(user_id) DO NOTHING').bind(id,stamp)]);
 if(ok&&verify)await sendVerificationEmail(c,id,email);
 return ok?c.json({id},201):fail(c,'Email đã được sử dụng, kể cả tài khoản trong thùng rác.',409);
});
router.patch('/users/:id',requirePermission('users.update'),async(c)=>{
 const id=(c.req.param('id')??''),target=await manageable(c,id),data=await readBody(c),name=text(data.name),email=text(data.email).toLowerCase();
 if(!target||target.deleted_at)return fail(c,'Không tìm thấy tài khoản có thể quản lý.',404);
 if(!validVersion(data.version))return stale(c);
 if(name.length<2||name.length>100||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return fail(c,'Tên cần từ 2–100 ký tự và email phải đúng định dạng.');
 const verify=c.env.EMAIL_VERIFICATION_REQUIRED==='true',emailChanged=email!==target.email;if(verify&&emailChanged&&(!c.env.RESEND_API_KEY||!c.env.EMAIL_FROM))return fail(c,'Email xác minh chưa sẵn sàng.',503);
 const stamp=uid();const ok=await mutate(c,[c.env.DB.prepare(`UPDATE users SET name=?,email=?,email_verified_at=CASE WHEN email=? THEN email_verified_at WHEN ?=1 THEN NULL ELSE unixepoch() END,version=version+1,change_token=?,updated_at=unixepoch() WHERE id=? AND version=? AND deleted_at IS NULL AND ${userScope(c)}`).bind(name,email,email,verify?1:0,stamp,id,Number(data.version)),audit(c,'users',id,stamp,'user.update')]);
 if(ok&&verify&&emailChanged)await sendVerificationEmail(c,id,email);
 return ok?c.json({ok:true}):stale(c);
});
router.post('/users/:id/lock',requirePermission('users.update'),async(c)=>{
 const id=(c.req.param('id')??''),target=await manageable(c,id),data=await readBody(c),note=text(data.note);
 if(!target||target.is_super_admin||id===c.get('user').id)return fail(c,'Không thể khóa tài khoản này.',403);
 if(!validVersion(data.version)||typeof data.locked!=='boolean'||note.length<5||note.length>500)return fail(c,'Nhập lý do 5–500 ký tự và trạng thái hợp lệ.');
 const stamp=uid(); const ok=await mutate(c,[c.env.DB.prepare(`UPDATE users SET is_locked=?,version=version+1,change_token=?,updated_at=unixepoch() WHERE id=? AND version=? AND deleted_at IS NULL AND is_super_admin=0 AND ${userScope(c)}`).bind(data.locked?1:0,stamp,id,Number(data.version)),c.env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND change_token=?)').bind(id,id,stamp),audit(c,'users',id,stamp,data.locked?'user.lock':'user.unlock',note)]);
 return ok?c.json({ok:true}):stale(c);
});
router.post('/users/:id/roles',requirePermission('users.assign_roles'),async(c)=>{
 const id=(c.req.param('id')??''),target=await manageable(c,id),data=await readBody(c);
 if(!target||target.is_super_admin||target.deleted_at||id===c.get('user').id)return fail(c,'Không thể đổi vai trò của tài khoản này.',403);
 if(!validVersion(data.version))return stale(c);
 if(!Array.isArray(data.role_ids)||data.role_ids.length>20||data.role_ids.some(x=>typeof x!=='string'))return fail(c,'Chọn tối đa 20 vai trò hợp lệ cho tài khoản.');
 const ids=[...new Set(data.role_ids as string[])];
 const selected=[];
 for(const roleId of ids){
  const role=await c.env.DB.prepare(`SELECT id FROM cms_roles WHERE id=? AND deleted_at IS NULL`).bind(roleId).first();
  const permissions=(await c.env.DB.prepare('SELECT permission FROM cms_role_permissions WHERE role_id=?').bind(roleId).all<{permission:string}>()).results;
  if(!role||permissions.some(p=>!can(c.get('user'),p.permission)))return fail(c,'Bạn không thể cấp quyền vượt quá quyền đang có.',403);
  selected.push(roleId);
 }
 const stamp=uid(),guard='EXISTS(SELECT 1 FROM users WHERE id=? AND change_token=?)';
 const roleScope=selected.map(()=>`EXISTS(SELECT 1 FROM cms_roles r WHERE r.id=? AND r.deleted_at IS NULL ${c.get('user').is_super_admin?'':`AND NOT EXISTS(SELECT 1 FROM cms_role_permissions p WHERE p.role_id=r.id AND p.permission NOT IN (${permittedSql(c)}))`})`).join(' AND ')||'1=1';
 const ok=await mutate(c,[c.env.DB.prepare(`UPDATE users SET version=version+1,change_token=?,updated_at=unixepoch() WHERE id=? AND version=? AND deleted_at IS NULL AND is_super_admin=0 AND ${userScope(c)} AND ${roleScope}`).bind(stamp,id,Number(data.version),...selected),c.env.DB.prepare(`DELETE FROM cms_user_roles WHERE user_id=? AND ${guard}`).bind(id,id,stamp),...selected.map(r=>c.env.DB.prepare(`INSERT INTO cms_user_roles(user_id,role_id) SELECT ?,? WHERE ${guard}`).bind(id,r,id,stamp)),c.env.DB.prepare(`DELETE FROM sessions WHERE user_id=? AND ${guard}`).bind(id,id,stamp),audit(c,'users',id,stamp,'user.roles',selected.join(', '))]);
 return ok?c.json({ok:true}):stale(c);
});
for(const restore of [false,true])router.on(restore?'POST':'DELETE',restore?'/users/:id/restore':'/users/:id',requirePermission('users.delete'),async(c)=>{
 const id=(c.req.param('id')??''),target=await manageable(c,id),data=await readBody(c);
 if(!target||target.is_super_admin||id===c.get('user').id)return fail(c,'Không thể xóa/khôi phục tài khoản này.',403);
 if(!validVersion(data.version)||text(data.note).length<5||text(data.note).length>500)return fail(c,'Nhập lý do 5–500 ký tự.');
 const stamp=uid();const ok=await mutate(c,[c.env.DB.prepare(`UPDATE users SET deleted_at=${restore?'NULL':'unixepoch()'},is_locked=1,version=version+1,change_token=?,updated_at=unixepoch() WHERE id=? AND version=? AND is_super_admin=0 AND deleted_at IS ${restore?'NOT NULL':'NULL'} AND ${userScope(c)}`).bind(stamp,id,Number(data.version)),c.env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND change_token=?)').bind(id,id,stamp),audit(c,'users',id,stamp,restore?'user.restore':'user.delete',text(data.note))]);
 return ok?c.json({ok:true}):stale(c);
});

// Fixed descriptors keep SQL identifiers out of user input. Every resource has CAS and soft deletion.
const resources={
 roles:{table:'cms_roles',permission:'roles',columns:['name','description'],search:'name'},
 plans:{table:'listing_plans',permission:'plans',columns:['name','price_vnd','duration_days','description','is_priority','is_active'],search:'name'},
 locations:{table:'locations',permission:'locations',columns:['name','description','is_active'],search:'name'},
 content:{table:'content_pages',permission:'content',columns:['slug','title','body','is_active'],search:'title'},
 listings:{table:'listing_drafts',permission:'listings',columns:['title','owner_id','location_id','room_type','price_vnd','area_m2','description'],search:'title'},
} as const;
const uniqueFields:Record<string,{table:string;field:string;label:string;collation?:string}>={
 roles:{table:'cms_roles',field:'name',label:'Tên vai trò',collation:' COLLATE NOCASE'},
 locations:{table:'locations',field:'name',label:'Tên khu vực',collation:' COLLATE NOCASE'},
 content:{table:'content_pages',field:'slug',label:'Mã đường dẫn'},
};
const resourceConflict=async(c:ApiContext,key:string,value:string,id?:string)=>{
 const rule=uniqueFields[key];if(!rule)return null;
 const query=`SELECT deleted_at FROM ${rule.table} WHERE ${rule.field}=?${rule.collation??''}${id?' AND id<>?':''} LIMIT 1`;
 const existing=await c.env.DB.prepare(query).bind(...(id?[value,id]:[value])).first<{deleted_at:number|null}>();
 if(!existing)return null;
 const where=existing.deleted_at===null?(key==='locations'?'đã tồn tại':'đã được sử dụng'):'đang nằm trong thùng rác';
 const action=existing.deleted_at===null?'Nhập tên khác hoặc mở bản ghi hiện có để sửa.':'Khôi phục bản ghi đó hoặc nhập tên khác.';
 return fail(c,`${rule.label} này ${where}. ${action}`,409);
};
for(const [key,def] of Object.entries(resources)){
 const {table,permission,columns,search}=def;
 router.get('/'+key,requirePermission(permission+'.read'),async(c)=>{
  const page=Number(c.req.query('page')??1),q=(c.req.query('q')??'').slice(0,100),state=c.req.query('state')??'active';
  if(!Number.isSafeInteger(page)||page<1||page>10000||!['active','deleted','all'].includes(state))return fail(c,'Trạng thái hoặc số trang không hợp lệ. Chọn lại bộ lọc rồi tải danh sách.');
  const where=`WHERE instr(lower(${search}),lower(?))>0 AND ${state==='deleted'?'deleted_at IS NOT NULL':state==='all'?'1=1':'deleted_at IS NULL'}`;
  const [items,count]=await c.env.DB.batch<Record<string,any>>([c.env.DB.prepare(`SELECT * FROM ${table} ${where} ORDER BY created_at DESC,id LIMIT 20 OFFSET ?`).bind(q,(page-1)*20),c.env.DB.prepare(`SELECT count(*) AS total FROM ${table} ${where}`).bind(q)]);
  const result=items.results.map(({change_token,...r})=>r);
  if(key==='roles')for(const role of result)(role as Record<string,unknown>).permissions=(await c.env.DB.prepare('SELECT permission FROM cms_role_permissions WHERE role_id=? ORDER BY permission').bind(role.id).all<{permission:string}>()).results.map(p=>p.permission);
  return c.json({items:result,total:Number(count.results[0]?.total??0),page,page_size:20});
 });
 const validate=async(c:ApiContext,data:Record<string,unknown>)=>{
  const values:Record<string,string|number>={};
  for(const field of columns){
   if(['price_vnd','duration_days','area_m2'].includes(field)){const value=Number(data[field]); if(!Number.isFinite(value)||value<=0||value>(field==='duration_days'?365:field==='area_m2'?10000:1000000000)||field!=='area_m2'&&!Number.isSafeInteger(value))return null;values[field]=value;}
   else if(field==='is_active'||field==='is_priority'){if(![0,1,true,false].includes(data[field] as number))return null;values[field]=data[field]?1:0;}
   else values[field]=text(data[field]);
  }
  if('name'in values&&(String(values.name).length<2||String(values.name).length>(key==='roles'?80:100)))return null;
  if('title'in values&&(String(values.title).length<(key==='listings'?5:2)||String(values.title).length>150))return null;
  if('description'in values&&String(values.description).length>(key==='listings'?4000:500))return null;
  if(key==='content'&&(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(values.slug))||String(values.slug).length>100||String(values.body).length>6000))return null;
  if(key==='listings'){
   if(!['room','studio'].includes(String(values.room_type)))return null;
   const owner=await c.env.DB.prepare(`SELECT u.id FROM users u LEFT JOIN seller_profiles p ON p.user_id=u.id WHERE u.id=? AND u.deleted_at IS NULL AND u.is_locked=0 AND (u.id=? OR p.status='approved')`).bind(values.owner_id,c.get('user').id).first();
   const location=await c.env.DB.prepare('SELECT id FROM locations WHERE id=? AND deleted_at IS NULL AND is_active=1').bind(values.location_id).first();
   if(!owner||!location)return null;
  }
  return values;
 };
 const rolePermissions=async(c:ApiContext,data:Record<string,unknown>,id?:string)=>{
  if(!Array.isArray(data.permissions)||data.permissions.length>allPermissions.length||data.permissions.some(p=>typeof p!=='string'||!allPermissions.includes(p)||!can(c.get('user'),p)))return false;
  if(id&&!c.get('user').is_super_admin){
   if(await c.env.DB.prepare('SELECT user_id FROM cms_user_roles WHERE role_id=? AND user_id=?').bind(id,c.get('user').id).first())return false;
   const old=(await c.env.DB.prepare('SELECT permission FROM cms_role_permissions WHERE role_id=?').bind(id).all<{permission:string}>()).results;
   if(old.some(p=>!can(c.get('user'),p.permission)))return false;
  }
  return true;
 };
 const validationMessage=(resource:string)=>{
  if(resource==='roles')return 'Kiểm tra tên vai trò (2–80 ký tự), mô tả (tối đa 500 ký tự) và danh sách quyền.';
  if(resource==='plans')return 'Kiểm tra tên gói (2–100 ký tự), giá nguyên dương tối đa 1 tỷ đồng, thời hạn 1–365 ngày và mô tả tối đa 500 ký tự.';
  if(resource==='locations')return 'Tên khu vực cần từ 2–100 ký tự; mô tả tối đa 500 ký tự.';
  if(resource==='content')return 'Tiêu đề cần từ 2–150 ký tự; mã đường dẫn chỉ dùng chữ thường, số và dấu gạch nối; nội dung tối đa 6.000 ký tự.';
  return 'Kiểm tra lại các trường bắt buộc và giới hạn nhập.';
 };
 const save=async(c:ApiContext,id?:string)=>{
  if(key==='listings')return fail(c,'Hãy dùng biểu mẫu đăng tin đầy đủ trong mục Tin phòng.',409);
  const data=await readBody(c),values=await validate(c,data);
  if(key==='content'&&(data.is_active===1||data.is_active===true||data.is_active==='1')&&!text(data.body).trim())return fail(c,'Thêm nội dung trang trước khi bật hiển thị công khai.');
  if(id&&!validVersion(data.version))return stale(c);
  if(!values)return fail(c,validationMessage(key));
  const uniqueField=uniqueFields[key];
  if(uniqueField){const conflict=await resourceConflict(c,key,String(values[uniqueField.field]),id);if(conflict)return conflict;}
  if(key==='listings'&&id){const old=await c.env.DB.prepare('SELECT owner_id FROM listing_drafts WHERE id=?').bind(id).first<{owner_id:string}>();if(old&&old.owner_id!==values.owner_id)return fail(c,'Không thể đổi chủ sở hữu tin đã tạo.',400);}
  if(key==='roles'&&!await rolePermissions(c,data,id))return fail(c,'Không thể sửa vai trò của chính mình hoặc cấp quyền vượt quá quyền đang có.',403);
  const entityId=id??uid(),stamp=uid();
  const statement=id?c.env.DB.prepare(`UPDATE ${table} SET ${columns.map(f=>f+'=?').join(',')},${key==='listings'?"status='draft',review_note='',":''}version=version+1,change_token=?,updated_at=unixepoch() WHERE id=? AND version=? AND deleted_at IS NULL`).bind(...columns.map(f=>values[f]),stamp,id,Number(data.version)):
   c.env.DB.prepare(`INSERT INTO ${table}(id,${columns.join(',')},change_token) VALUES(?,${columns.map(()=>'?').join(',')},?) ON CONFLICT DO NOTHING`).bind(entityId,...columns.map(f=>values[f]),stamp);
  const stmts=[statement];
  if(key==='roles'){
   stmts.push(c.env.DB.prepare('DELETE FROM cms_role_permissions WHERE role_id=? AND EXISTS(SELECT 1 FROM cms_roles WHERE id=? AND change_token=?)').bind(entityId,entityId,stamp));
   for(const p of [...new Set(data.permissions as string[])])stmts.push(c.env.DB.prepare('INSERT INTO cms_role_permissions(role_id,permission) SELECT ?,? WHERE EXISTS(SELECT 1 FROM cms_roles WHERE id=? AND change_token=?)').bind(entityId,p,entityId,stamp));
  }
  stmts.push(audit(c,table,entityId,stamp,`${key}.${id?'update':'create'}`));
  const ok=await mutate(c,stmts);
  if(!ok&&uniqueField){const conflict=await resourceConflict(c,key,String(values[uniqueField.field]),id);if(conflict)return conflict;}
  return ok?c.json({id:entityId,ok:true},id?200:201):stale(c);
 };
 router.post('/'+key,requirePermission(permission+'.create'),c=>save(c));
 router.patch('/'+key+'/:id',requirePermission(permission+'.update'),c=>save(c,(c.req.param('id')??'')));
 for(const restore of [false,true])router.on(restore?'POST':'DELETE',restore?'/'+key+'/:id/restore':'/'+key+'/:id',requirePermission(permission+'.delete'),async(c)=>{
  const id=(c.req.param('id')??''),data=await readBody(c);
  if(!validVersion(data.version))return stale(c);
  if(text(data.note).length<5||text(data.note).length>500)return fail(c,'Nhập lý do thao tác từ 5–500 ký tự.');
  if(key==='roles'){
   // Check existing grants on delete/restore, even when role was archived.
   const perms=(await c.env.DB.prepare('SELECT permission FROM cms_role_permissions WHERE role_id=?').bind(id).all<{permission:string}>()).results.map(p=>p.permission);
   if(!await rolePermissions(c,{permissions:perms},id))return fail(c,'Không thể quản lý vai trò này.',403);
  }
  const stamp=uid();const ok=await mutate(c,[c.env.DB.prepare(`UPDATE ${table} SET deleted_at=${restore?'NULL':'unixepoch()'},${'is_active'in Object.fromEntries(columns.map(f=>[f,1]))?'is_active=0,':''}version=version+1,change_token=?,updated_at=unixepoch() WHERE id=? AND version=? AND deleted_at IS ${restore?'NOT NULL':'NULL'}`).bind(stamp,id,Number(data.version)),audit(c,table,id,stamp,`${key}.${restore?'restore':'delete'}`,text(data.note))]);
  return ok?c.json({ok:true}):stale(c);
 });
}
router.get('/audit',requirePermission('audit.read'),async(c)=>{
 const page=Number(c.req.query('page')??1),q=(c.req.query('q')??'').slice(0,100);
 if(!Number.isSafeInteger(page)||page<1||page>10000)return fail(c,'Số trang không hợp lệ. Quay lại danh sách và chọn lại trang.');
 const where='WHERE instr(a.action,?)>0 OR instr(a.target_id,?)>0';
 const [items,total]=await c.env.DB.batch<Record<string,any>>([c.env.DB.prepare(`SELECT a.id,a.action,a.target_id,a.note,a.created_at,u.name AS actor_name FROM admin_audit a LEFT JOIN users u ON u.id=a.actor_id ${where} ORDER BY a.created_at DESC,a.rowid DESC LIMIT 20 OFFSET ?`).bind(q,q,(page-1)*20),c.env.DB.prepare(`SELECT count(*) AS total FROM admin_audit a ${where}`).bind(q,q)]);
 return c.json({items:items.results,total:Number(total.results[0]?.total??0),page,page_size:20});
});
export default router;
