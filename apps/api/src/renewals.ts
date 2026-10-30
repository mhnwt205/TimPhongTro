import {Hono} from 'hono';
import {requireUser,requireAdmin,requirePermission,readBody,limit,type ApiEnv,type ApiContext} from './security';
import {text} from './responses';
import type {Listing} from './listings';
import {emailShell} from './email';
import {sendNotificationEmail} from './notifications';
export type Renewal={id:string;listing_id:string;owner_id:string;plan_id:string;plan_name:string;price_vnd:number;duration_days:number;is_priority:number;status:'pending'|'approved'|'rejected'|'cancelled';version:number;review_note:string;created_at:number;reviewed_at:number|null;starts_at:number|null;expires_at:number|null};
const router=new Hono<ApiEnv>();
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
const version=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;
const fields='r.id,r.listing_id,r.owner_id,r.plan_id,r.plan_name,r.price_vnd,r.duration_days,r.is_priority,r.status,r.version,r.review_note,r.created_at,r.reviewed_at,a.starts_at,a.expires_at';
const own=(c:ApiContext)=>c.env.DB.prepare('SELECT * FROM listing_drafts WHERE id=? AND owner_id=? AND deleted_at IS NULL AND published_at IS NOT NULL AND public_data IS NOT NULL').bind(c.req.param('id'),c.get('user').id).first<Listing>();
router.get('/account/listings/:id/renewals',requireUser,async c=>{
 const item=await own(c);if(!item)return c.json({error:'Không tìm thấy tin đã xuất bản của bạn.'},404);
 const [plans,wallet,requests,events]=await Promise.all([
  c.env.DB.prepare('SELECT id,name,price_vnd,duration_days,is_priority FROM listing_plans WHERE is_active=1 AND deleted_at IS NULL AND price_vnd<=1000000 ORDER BY price_vnd').all(),
  c.env.DB.prepare('SELECT balance_vnd FROM wallet_accounts WHERE user_id=?').bind(item.owner_id).first<{balance_vnd:number}>(),
  c.env.DB.prepare(`SELECT ${fields} FROM listing_renewals r LEFT JOIN listing_renewal_approvals a ON a.renewal_id=r.id WHERE r.listing_id=? ORDER BY r.created_at DESC,r.rowid DESC LIMIT 50`).bind(item.id).all(),
  c.env.DB.prepare('SELECT action,note,created_at FROM listing_events WHERE listing_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30').bind(item.id).all(),
 ]);
 return c.json({item,plans:plans.results,balance_vnd:wallet?.balance_vnd??0,requests:requests.results,events:events.results});
});
router.post('/account/listings/:id/renewals',requireUser,async c=>{
 const b=await readBody(c),key=b.request_key,planId=text(b.plan_id),item=await own(c);
 if(!item)return c.json({error:'Không tìm thấy tin đã xuất bản của bạn.'},404);
 if(!uuid(key)||b.confirmed!==true)return c.json({error:'Chọn gói và xác nhận phí gia hạn trước khi gửi.'},400);
 const prior=await c.env.DB.prepare('SELECT id,listing_id,plan_id,status FROM listing_renewals WHERE owner_id=? AND request_key=?').bind(item.owner_id,key).first<{id:string;listing_id:string;plan_id:string;status:string}>();
 if(prior)return prior.listing_id===item.id&&prior.plan_id===planId?c.json({ok:true,id:prior.id,replayed:true}):c.json({error:'Mã yêu cầu đã được dùng với nội dung khác.'},409);
 const denied=await limit(c,'renewal-create',item.owner_id,10,3600);if(denied)return denied;
 const active=await c.env.DB.prepare("SELECT user_id FROM seller_profiles WHERE user_id=? AND status='approved'").bind(item.owner_id).first();
 if(!active||item.moderation_hidden)return c.json({error:'Tài khoản và hồ sơ người đăng cần đang hoạt động, hồ sơ đã được duyệt và tin không bị ẩn để kiểm tra thì mới có thể gia hạn.'},409);
 const plan=await c.env.DB.prepare('SELECT id,name,price_vnd,duration_days,is_priority FROM listing_plans WHERE id=? AND is_active=1 AND deleted_at IS NULL AND price_vnd<=1000000').bind(planId).first<{id:string;name:string;price_vnd:number;duration_days:number;is_priority:number}>();
 if(!plan)return c.json({error:'Chọn gói đang hoạt động.'},400);
 const id=crypto.randomUUID();
 try{
  await c.env.DB.prepare('INSERT INTO listing_renewals(id,listing_id,owner_id,request_key,plan_id,plan_name,price_vnd,duration_days,is_priority,last_actor_id,change_token) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,item.id,item.owner_id,key,plan.id,plan.name,plan.price_vnd,plan.duration_days,plan.is_priority,item.owner_id,id).run();
  return c.json({ok:true,id},201);
 }catch(error){if(/UNIQUE/.test(String(error)))return c.json({error:'Tin đã có yêu cầu gia hạn chờ duyệt. Tải lại để xem hoặc hủy yêu cầu cũ.'},409);throw error;}
});
router.post('/account/renewals/:id/cancel',requireUser,async c=>{
 const b=await readBody(c);if(!version(b.version))return c.json({error:'Hãy tải lại yêu cầu.'},400);
 const stamp=crypto.randomUUID(),r=await c.env.DB.prepare("UPDATE listing_renewals SET status='cancelled',last_actor_id=?,version=version+1,reviewed_at=unixepoch(),change_token=? WHERE id=? AND owner_id=? AND status='pending' AND version=? RETURNING id").bind(c.get('user').id,stamp,c.req.param('id'),c.get('user').id,b.version).first<{id:string}>();
 return r?c.json({ok:true}):c.json({error:'Yêu cầu đã thay đổi hoặc không thuộc tài khoản của bạn.'},409);
});
router.get('/cms/renewals',requireUser,requireAdmin,requirePermission('renewals.read'),async c=>{
 const status=c.req.query('status')??'pending',page=Number(c.req.query('page')??1);
 if(!['all','pending','approved','rejected','cancelled'].includes(status)||!Number.isSafeInteger(page)||page<1||page>10000)return c.json({error:'Trạng thái hoặc số trang không hợp lệ. Chọn lại bộ lọc rồi tải danh sách.'},400);
 const where=status==='all'?'1=1':'r.status=?',args=status==='all'?[]:[status];
 const [rows,count]=await c.env.DB.batch([
  c.env.DB.prepare(`SELECT ${fields},u.name AS owner_name,u.email AS owner_email,json_extract(l.public_data,'$.title') AS title,l.version AS listing_version,l.expires_at AS listing_expires_at,l.display_state,l.moderation_hidden,l.deleted_at FROM listing_renewals r JOIN listing_drafts l ON l.id=r.listing_id JOIN users u ON u.id=r.owner_id LEFT JOIN listing_renewal_approvals a ON a.renewal_id=r.id WHERE ${where} ORDER BY r.created_at DESC,r.rowid DESC LIMIT 20 OFFSET ?`).bind(...args,(page-1)*20),
  c.env.DB.prepare(`SELECT count(*) AS total FROM listing_renewals r WHERE ${where}`).bind(...args),
 ]);
 return c.json({items:rows.results,total:Number((count.results[0] as {total:number})?.total??0),page,page_size:20});
});
router.post('/cms/renewals/:id/review',requireUser,requireAdmin,requirePermission('renewals.review'),async c=>{
 const b=await readBody(c),decision=text(b.decision),note=text(b.note),actor=c.get('user');
 if(!version(b.version)||!['approved','rejected'].includes(decision)||note.length>1000||decision==='rejected'&&note.length<5)return c.json({error:'Chọn kết quả, nhập lý do từ 5 ký tự khi từ chối.'},400);
 const current=await c.env.DB.prepare('SELECT * FROM listing_renewals WHERE id=?').bind(c.req.param('id')).first<Renewal>();
 if(!current)return c.json({error:'Không tìm thấy yêu cầu gia hạn.'},404);
 if(current.owner_id===actor.id)return c.json({error:'Không được tự duyệt yêu cầu gia hạn của mình.'},403);
 if(current.status===decision)return c.json({ok:true,replayed:true});
 if(current.status!=='pending'||current.version!==b.version)return c.json({error:'Yêu cầu đã thay đổi. Tải lại trước khi xử lý.'},409);
 if(decision==='rejected'){
  const r=await c.env.DB.prepare("UPDATE listing_renewals SET status='rejected',review_note=?,last_actor_id=?,version=version+1,reviewed_at=unixepoch(),change_token=? WHERE id=? AND status='pending' AND version=? RETURNING id").bind(note,actor.id,crypto.randomUUID(),current.id,b.version).first<{id:string}>();
  if(!r)return c.json({error:'Yêu cầu đã được xử lý.'},409);
  const account=await c.env.DB.prepare(`SELECT u.email,r.listing_id FROM listing_renewals r JOIN users u ON u.id=r.owner_id WHERE r.id=?`).bind(current.id).first<{email:string;listing_id:string}>();
  if(account){const body='Yêu cầu gia hạn bị từ chối. Mở lịch sử gia hạn để xem phản hồi của quản trị viên.';const href='/tai-khoan/tin-dang/'+account.listing_id+'/gia-han';sendNotificationEmail(c,{to:account.email,subject:'Yêu cầu gia hạn cần cập nhật',html:emailShell('Yêu cầu gia hạn bị từ chối',[body],new URL(href,c.req.url).toString(),'Xem yêu cầu'),text:body,key:`renewal-review:${current.id}:${b.version}:rejected`});}
  return c.json({ok:true});
 }
 if(b.confirmed!==true||!version(b.listing_version))return c.json({error:'Xác nhận đúng phí gia hạn và tải lại thông tin tin phòng.'},400);
 try{
  await c.env.DB.prepare(`INSERT INTO listing_renewal_approvals(id,renewal_id,listing_id,actor_id,expected_request_version,expected_listing_version,price_vnd,is_priority,previous_expires_at,starts_at,expires_at)
   SELECT ?,r.id,l.id,?,?,?,r.price_vnd,r.is_priority,l.expires_at,max(l.expires_at,unixepoch()),max(l.expires_at,unixepoch())+r.duration_days*86400 FROM listing_renewals r JOIN listing_drafts l ON l.id=r.listing_id WHERE r.id=?`).bind(crypto.randomUUID(),actor.id,b.version,b.listing_version,current.id).run();
  const account=await c.env.DB.prepare(`SELECT u.email,r.listing_id,json_extract(l.public_data,'$.title') AS title FROM listing_renewals r JOIN users u ON u.id=r.owner_id JOIN listing_drafts l ON l.id=r.listing_id WHERE r.id=?`).bind(current.id).first<{email:string;listing_id:string;title:string}>();
  if(account){const body='Tin “'+account.title+'” đã được gia hạn. Phí đã trừ từ số dư.';const href='/tai-khoan/tin-dang/'+account.listing_id+'/gia-han';sendNotificationEmail(c,{to:account.email,subject:'Tin đăng đã được gia hạn',html:emailShell('Yêu cầu gia hạn đã được duyệt',[body],new URL(href,c.req.url).toString(),'Xem kỳ gia hạn'),text:body,key:`renewal-review:${current.id}:${b.version}:approved`});}
  return c.json({ok:true});
 }catch(error){
  const message=String(error);
  if(/renewal_insufficient_balance|balance_after_vnd/.test(message))return c.json({error:'Người đăng chưa đủ số dư. Yêu cầu vẫn chờ duyệt, chưa trừ tiền hoặc cộng thời hạn.'},409);
  if(/renewal_quote_changed/.test(message))return c.json({error:'Gói đã thay đổi giá, thời hạn hoặc mức ưu tiên. Khách cần hủy và tạo yêu cầu mới để xác nhận mức phí mới.'},409);
  if(/UNIQUE|renewal_not_ready|renewal_invalid_period|renewal_stale/.test(message))return c.json({error:'Yêu cầu/tin đã thay đổi, bị khóa hoặc đã được xử lý. Tải lại trước khi thao tác.'},409);
  throw error;
 }
});
export default router;
