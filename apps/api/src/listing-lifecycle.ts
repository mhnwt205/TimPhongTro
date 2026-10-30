import {Hono} from 'hono';
import {type ApiEnv,type ApiContext,requireUser,requireAdmin,requirePermission,readBody,limit} from './security';
import {text} from './responses';
import {can} from './permissions';
import {reviewedCopy} from './listing-status';
import type {Listing} from './listings';
const router=new Hono<ApiEnv>();
const validVersion=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;
async function changeState(c:ApiContext,cms:boolean){
 const data=await readBody(c),actor=c.get('user'),id=c.req.param('id'),action=text(data.action),note=text(data.note);
 if(!validVersion(data.version))return c.json({error:'Tin đã thay đổi. Tải lại trang để lấy trạng thái mới nhất trước khi thao tác.'},409);
 if(!['hide','unavailable','reopen','confirm','block','unblock'].includes(action))return c.json({error:'Chọn thao tác hợp lệ cho tin đăng rồi thử lại.'},400);
 if(note.length>1000)return c.json({error:'Ghi chú tối đa 1.000 ký tự. Rút gọn ghi chú rồi thử lại.'},400);
 if(['block','unblock'].includes(action)&&(!cms||!can(actor,'listings.review')))return c.json({error:'Chỉ người có quyền duyệt CMS được gỡ hoặc mở gỡ tin.'},403);
 if(cms&&!['block','unblock'].includes(action)&&!can(actor,'listings.update'))return c.json({error:'Bạn chưa có quyền cập nhật tin.'},403);
 const item=await c.env.DB.prepare(`SELECT * FROM listing_drafts WHERE id=? AND deleted_at IS NULL${cms?'':' AND owner_id=? AND (created_by_admin=0 OR published_at IS NOT NULL)'}`).bind(id,...(cms?[]:[actor.id])).first<Listing>();
 if(!item)return c.json({error:'Không tìm thấy tin phòng.'},404);
 const denied=await limit(c,'listing-state',actor.id,120,3600);if(denied)return denied;
 if(item.version!==data.version)return c.json({error:'Tin đã thay đổi. Tải lại trang trước khi thao tác.'},409);
 if(item.published_at==null||!item.public_data)return c.json({error:'Tin cần được xuất bản trước khi quản lý trạng thái hiển thị.'},409);
 if(action==='block'&&note.length<5)return c.json({error:'Nhập lý do gỡ tin từ 5 ký tự.'},400);
 if(item.moderation_hidden&&!['block','unblock'].includes(action))return c.json({error:'Tin đang được ẩn để quản trị viên kiểm tra. Liên hệ bộ phận hỗ trợ nếu cần biết thêm.'},409);
 const now=Math.floor(Date.now()/1000);
 if(action==='reopen'||action==='confirm'){
  const approved=await c.env.DB.prepare(`SELECT u.id FROM users u JOIN seller_profiles p ON p.user_id=u.id WHERE u.id=? AND u.is_locked=0 AND u.deleted_at IS NULL AND p.status='approved'`).bind(item.owner_id).first();
  if(!approved||!reviewedCopy(item)||!item.expires_at||item.expires_at<=now)return c.json({error:'Chỉ mở lại/xác nhận tin đã duyệt, còn hạn và người đăng đang hoạt động. Bản sửa chưa duyệt cần được xử lý trước.'},409);
 }
 if(action==='confirm'&&item.display_state!=='available')return c.json({error:'Mở lại tin trước khi xác nhận phòng vẫn còn.'},409);
 const state=action==='hide'?'hidden':action==='unavailable'?'unavailable':action==='reopen'?'available':item.display_state;
 const blocked=action==='block'?1:action==='unblock'?0:item.moderation_hidden;
 if(action!=='confirm'&&state===item.display_state&&blocked===item.moderation_hidden)return c.json({ok:true,unchanged:true,version:item.version});
 const stamp=crypto.randomUUID();
 const results=await c.env.DB.batch([
  c.env.DB.prepare('UPDATE listing_drafts SET display_state=?,moderation_hidden=?,availability_confirmed_at=?,version=version+1,change_token=?,updated_at=unixepoch() WHERE id=? AND version=? AND deleted_at IS NULL').bind(state,blocked,['confirm','reopen'].includes(action)?now:item.availability_confirmed_at,stamp,id,data.version),
  c.env.DB.prepare('INSERT INTO listing_events(id,listing_id,actor_id,action,note) SELECT ?,id,?,?,? FROM listing_drafts WHERE id=? AND change_token=?').bind(crypto.randomUUID(),actor.id,action,note,id,stamp),
  c.env.DB.prepare("INSERT INTO admin_audit(id,actor_id,action,target_id,note) SELECT ?,?,?,id,? FROM listing_drafts WHERE id=? AND change_token=?").bind(crypto.randomUUID(),actor.id,'listing.'+action,note,id,stamp),
 ]);
 return results[0].meta.changes===1?c.json({ok:true,version:item.version+1}):c.json({error:'Tin đã thay đổi. Tải lại trang để kiểm tra.'},409);
}
router.post('/account/listings/:id/state',requireUser,c=>changeState(c,false));
router.post('/cms/listing-submissions/:id/state',requireUser,requireAdmin,c=>changeState(c,true));
export default router;
