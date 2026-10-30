import { Hono } from 'hono';
import type { ApiContext, ApiEnv } from './security';
import { limit, readBody, requireAdmin, requireUser, requirePermission } from './security';
import { can } from './permissions';
import { respond, text } from './responses';
import {emailShell} from './email';
import {sendNotificationEmail} from './notifications';

export type SellerProfile = {
  user_id: string; display_name: string; seller_type: 'owner' | 'broker'; phone: string; zalo_phone: string;
  introduction: string; status: 'pending' | 'approved' | 'rejected'; review_note: string;
  version: number; submitted_at: number; updated_at: number;
};
const router = new Hono<ApiEnv>();
router.use('/account/*', requireUser);
router.use('/admin/*', requireUser, requireAdmin);
const profileQuery = 'SELECT user_id,display_name,seller_type,phone,zalo_phone,introduction,status,review_note,version,submitted_at,updated_at FROM seller_profiles WHERE user_id=?';
const phone = (value: unknown) => text(value).replace(/[\s().-]/g, '').replace(/^\+84/, '0');
const version = (value: unknown) => typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
const fieldVersion = (value: unknown) => Number.isSafeInteger(version(value)) && version(value) >= 0;

router.get('/account/profile', async (c) => {
  const user = c.get('user');
  const profile = await c.env.DB.prepare(profileQuery).bind(user.id).first<SellerProfile>();
  const { results } = await c.env.DB.prepare(`SELECT decision,note,profile_version,created_at FROM seller_reviews
    WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 20`).bind(user.id).all();
  return c.json({ profile, reviews: results, can_post: profile?.status === 'approved' });
});

router.post('/account/profile', async (c) => {
  const user = c.get('user');
  const denied = await limit(c, 'profile-user', user.id, 15, 3600);
  if (denied) return denied;
  const data = await readBody(c), displayName = text(data.display_name), sellerType = text(data.seller_type);
  const contact = phone(data.phone), zalo = phone(data.zalo_phone) || contact, intro = text(data.introduction);
  if (displayName.length < 2 || displayName.length > 100 || !['owner', 'broker'].includes(sellerType)
      || !/^0[35789]\d{8}$/.test(contact) || !/^0[35789]\d{8}$/.test(zalo) || intro.length > 600 || !fieldVersion(data.version)) {
    return respond(c, { error: 'Hãy nhập tên 2–100 ký tự, chọn loại người đăng và số di động Việt Nam hợp lệ. Giới thiệu tối đa 600 ký tự.' }, 400, '/tai-khoan/ho-so');
  }
  const oldVersion = version(data.version), stamp = crypto.randomUUID();
  if(oldVersion>0){
    const current=await c.env.DB.prepare(profileQuery).bind(user.id).first<SellerProfile>();
    if(!current||current.version!==oldVersion)return respond(c,{error:'Hồ sơ đã thay đổi. Hãy tải lại trang trước khi gửi.'},409,'/tai-khoan/ho-so');
    if(current.status!=='rejected'&&current.display_name===displayName&&current.seller_type===sellerType&&current.phone===contact&&current.zalo_phone===zalo&&current.introduction===intro)return respond(c,{ok:true,status:current.status,unchanged:true},200,'/tai-khoan/ho-so');
  }
  const result = oldVersion === 0
    ? await c.env.DB.prepare(`INSERT INTO seller_profiles(user_id,display_name,seller_type,phone,zalo_phone,introduction,change_token)
        SELECT id,?,?,?,?,?,? FROM users WHERE id=? AND is_locked=0 ON CONFLICT(user_id) DO NOTHING`)
      .bind(displayName, sellerType, contact, zalo, intro, stamp, user.id).run()
    : await c.env.DB.prepare(`UPDATE seller_profiles SET display_name=?,seller_type=?,phone=?,zalo_phone=?,introduction=?,
        status='pending',review_note='',version=version+1,change_token=?,submitted_at=unixepoch(),updated_at=unixepoch()
        WHERE user_id=? AND version=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_locked=0)`)
      .bind(displayName, sellerType, contact, zalo, intro, stamp, user.id, oldVersion, user.id).run();
  if (result.meta.changes !== 1) return respond(c, { error: 'Hồ sơ đã thay đổi. Hãy tải lại trang trước khi gửi.' }, 409, '/tai-khoan/ho-so');
  return respond(c, { ok: true, status: 'pending' }, 200, '/tai-khoan/ho-so');
});

router.get('/admin/sellers', requirePermission('sellers.read'), async (c) => {
  const status = c.req.query('status') ?? 'pending';
  const page = Number(c.req.query('page') ?? 1);
  if (!['all', 'pending', 'approved', 'rejected', 'locked'].includes(status) || !Number.isSafeInteger(page) || page < 1 || page > 10000) {
    return c.json({ error: 'Trạng thái hoặc số trang không hợp lệ. Chọn lại bộ lọc rồi tải danh sách.' }, 400);
  }
  const where = status === 'all' ? '1=1' : status === 'locked' ? 'u.is_locked=1' : 'p.status=? AND u.is_locked=0';
  const params = ['all', 'locked'].includes(status) ? [] : [status];
  const { results } = await c.env.DB.prepare(`SELECT p.user_id,p.display_name,p.seller_type,p.phone,p.zalo_phone,p.introduction,p.status,
    p.review_note,p.version,p.submitted_at,u.email,u.is_locked,u.version AS user_version FROM seller_profiles p JOIN users u ON u.id=p.user_id
    WHERE ${where} ORDER BY p.submitted_at DESC,p.user_id LIMIT 20 OFFSET ?`).bind(...params, (page - 1) * 20).all();
  const count = await c.env.DB.prepare(`SELECT count(*) AS total FROM seller_profiles p JOIN users u ON u.id=p.user_id WHERE ${where}`).bind(...params).first<{ total: number }>();
  return c.json({ items: results, page, total: count?.total ?? 0, page_size: 20 });
});

router.post('/admin/sellers/:id/review', requirePermission('sellers.review'), async (c) => {
  const actor = c.get('user'), userId = c.req.param('id'), data = await readBody(c);
  const decision = text(data.decision), note = text(data.note);
  if (!['approved', 'rejected'].includes(decision) || !fieldVersion(data.version) || version(data.version) < 1
      || note.length > 1000 || (decision === 'rejected' && note.length < 5)) {
    return respond(c, { error: 'Chọn quyết định hợp lệ; lý do từ chối cần từ 5–1000 ký tự.' }, 400, '/quan-tri/nguoi-dang');
  }
  if (userId === actor.id) return respond(c, { error: 'Bạn không thể tự xét duyệt hồ sơ của mình.' }, 403, '/quan-tri/nguoi-dang');
  const stamp = crypto.randomUUID(), oldVersion = version(data.version);
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE seller_profiles SET status=?,review_note=?,version=version+1,change_token=?,updated_at=unixepoch()
      WHERE user_id=? AND version=? AND status='pending' AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_locked=0)
      AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_locked=0 AND deleted_at IS NULL)`)
      .bind(decision, note, stamp, userId, oldVersion, userId, actor.id),
    c.env.DB.prepare(`INSERT INTO seller_reviews(id,user_id,reviewer_id,decision,note,profile_version)
      SELECT ?,user_id,?,?,?,? FROM seller_profiles WHERE user_id=? AND change_token=?`)
      .bind(crypto.randomUUID(), actor.id, decision, note, oldVersion, userId, stamp),
    c.env.DB.prepare(`INSERT INTO admin_audit(id,actor_id,action,target_id,note)
      SELECT ?,?,?,user_id,? FROM seller_profiles WHERE user_id=? AND change_token=?`)
      .bind(crypto.randomUUID(), actor.id, `seller.${decision}`, note, userId, stamp),
  ]);
  if (results[0].meta.changes !== 1) return respond(c, { error: 'Hồ sơ đã được xử lý hoặc thay đổi. Hãy tải lại trang.' }, 409, '/quan-tri/nguoi-dang');
  const account=await c.env.DB.prepare('SELECT email FROM users WHERE id=?').bind(userId).first<{email:string}>();
  if(account){const body=decision==='approved'?'Hồ sơ người đăng của bạn đã được duyệt.':'Hồ sơ người đăng cần bổ sung. Mở hồ sơ để xem hướng dẫn.';sendNotificationEmail(c,{to:account.email,subject:decision==='approved'?'Hồ sơ người đăng đã được duyệt':'Hồ sơ người đăng cần bổ sung',html:emailShell(decision==='approved'?'Hồ sơ đã được duyệt':'Hồ sơ cần bổ sung',[body],new URL('/tai-khoan/ho-so',c.req.url).toString(),'Mở hồ sơ'),text:body,key:`seller-review:${userId}:${oldVersion}:${decision}`});}
  return respond(c, { ok: true }, 200, '/quan-tri/nguoi-dang');
});

router.post('/admin/sellers/:id/lock', requirePermission('users.update'), async (c) => {
  const actor = c.get('user'), userId = c.req.param('id'), data = await readBody(c);
  const locked = data.locked === true || data.locked === 'true';
  if (![true, false, 'true', 'false'].includes(data.locked as boolean | string) || !fieldVersion(data.version) || version(data.version) < 1
      || text(data.note).length < 5 || text(data.note).length > 1000) {
    return respond(c, { error: 'Hãy nhập lý do thao tác từ 5–1000 ký tự và tải lại nếu hồ sơ đã thay đổi.' }, 400, '/quan-tri/nguoi-dang');
  }
  if (userId === actor.id) return respond(c, { error: 'Bạn không thể khóa chính mình.' }, 403, '/quan-tri/nguoi-dang');
  const grants=(await c.env.DB.prepare(`SELECT p.permission FROM cms_user_roles ur JOIN cms_roles r ON r.id=ur.role_id JOIN cms_role_permissions p ON p.role_id=r.id WHERE ur.user_id=? AND r.deleted_at IS NULL`).bind(userId).all<{permission:string}>()).results;
  if(grants.some(p=>!can(actor,p.permission)))return respond(c,{error:'Bạn không có quyền quản lý tài khoản này.'},403,'/quan-tri/nguoi-dang');
  const oldVersion = version(data.version), stamp = crypto.randomUUID();
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET is_locked=?,version=version+1,change_token=?,updated_at=unixepoch()
      WHERE id=? AND role='user' AND is_super_admin=0 AND deleted_at IS NULL AND version=? AND is_locked!=?
      AND EXISTS(SELECT 1 FROM users a WHERE a.id=? AND a.is_locked=0 AND a.deleted_at IS NULL)`)
      .bind(locked ? 1 : 0, stamp, userId, oldVersion, locked ? 1 : 0, actor.id),
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id=? AND EXISTS
      (SELECT 1 FROM users WHERE id=? AND change_token=?)`).bind(userId, userId, stamp),
    c.env.DB.prepare(`INSERT INTO admin_audit(id,actor_id,action,target_id,note)
      SELECT ?,?,?,id,? FROM users WHERE id=? AND change_token=?`)
      .bind(crypto.randomUUID(), actor.id, locked ? 'user.lock' : 'user.unlock', text(data.note), userId, stamp),
  ]);
  if (results[0].meta.changes !== 1) return respond(c, { error: 'Tài khoản đã thay đổi hoặc không thể thao tác. Hãy tải lại trang.' }, 409, '/quan-tri/nguoi-dang');
  return respond(c, { ok: true }, 200, '/quan-tri/nguoi-dang');
});

export default router;
