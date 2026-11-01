import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { ApiContext, ApiEnv, User } from './security';
import { clearSession, clientIp, hydrateUser, limit, publicUser, randomToken, readBody, requireUser, SESSION_COOKIE, SESSION_SECONDS, sha256 } from './security';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password';
import { respond, text } from './responses';
import {emailShell,sendResend} from './email';

const router = new Hono<ApiEnv>();
const cookieOptions = (c: ApiContext) => ({ httpOnly: true, secure: new URL(c.req.url).protocol === 'https:', sameSite: 'Lax' as const, path: '/', maxAge: SESSION_SECONDS });
const tokenInput=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
async function issueEmailToken(c:ApiContext,userId:string,purpose:'verify_email'|'password_reset',seconds:number){
 const token=randomToken(),hash=await sha256(token);await c.env.DB.batch([
  c.env.DB.prepare("UPDATE account_email_tokens SET consumed_at=unixepoch(),consumed_reason=CASE WHEN expires_at<=unixepoch() THEN 'expired' ELSE 'superseded' END WHERE user_id=? AND purpose=? AND consumed_at IS NULL").bind(userId,purpose),
  c.env.DB.prepare("UPDATE account_email_tokens SET consumed_at=unixepoch(),consumed_reason='expired' WHERE expires_at<=unixepoch() AND consumed_at IS NULL"),
  c.env.DB.prepare('INSERT INTO account_email_tokens(token_hash,user_id,purpose,expires_at) VALUES(?,?,?,unixepoch()+?)').bind(hash,userId,purpose,seconds),
 ]);return {token,hash};
}
export async function sendVerificationEmail(c:ApiContext,userId:string,email:string){
 const issued=await issueEmailToken(c,userId,'verify_email',86400),url=new URL('/xac-minh-email?token='+encodeURIComponent(issued.token),c.req.url).toString();
 c.executionCtx.waitUntil(sendResend(c.env,{to:email,subject:'Xác minh email Trọ Tốt TP.HCM',html:emailShell('Xác minh địa chỉ email',['Xác minh email trong 24 giờ để hoàn tất hồ sơ người đăng.'],url,'Xác minh email'),text:'Xác minh email trong 24 giờ: '+url,key:'verify:'+userId+':'+issued.hash}));
}

router.post('/register', async (c) => {
  const denied = await limit(c, 'register-ip', clientIp(c), 5, 3600);
  if (denied) return denied;
  const body = await readBody(c), name = text(body.name), email = text(body.email).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  if (name.length < 2 || name.length > 100 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || password.length < 12 || password.length > 128 || ['123456789012', 'password1234', 'qwertyuiop12'].includes(password.toLowerCase())) {
    return respond(c, { error: 'Hãy nhập tên 2–100 ký tự, email hợp lệ và mật khẩu từ 12–128 ký tự, tránh mật khẩu dễ đoán.' }, 400, '/dang-ky');
  }
  if (body.password_confirmation !== undefined && body.password_confirmation !== password) {
    return respond(c, { error: 'Hai mật khẩu chưa khớp.' }, 400, '/dang-ky');
  }
  const verificationRequired=c.env.EMAIL_VERIFICATION_REQUIRED==='true';
  if(verificationRequired&&(!c.env.RESEND_API_KEY||!c.env.EMAIL_FROM))return c.json({error:'Tạm thời chưa thể tạo tài khoản mới. Hệ thống email chưa sẵn sàng.'},503);
  const id = crypto.randomUUID(), token = randomToken(), tokenHash = await sha256(token);
  const passwordHash = await hashPassword(password);
  const statements = [
    c.env.DB.prepare('INSERT INTO users(id,email,name,password_hash,email_verified_at) VALUES(?,?,?,?,CASE WHEN ?=1 THEN NULL ELSE unixepoch() END) ON CONFLICT(email) DO NOTHING').bind(id, email, name, passwordHash,verificationRequired?1:0),
    c.env.DB.prepare('INSERT INTO posting_promotions(user_id,free_posts_total) SELECT id,COALESCE((SELECT free_posts_new_account FROM website_settings WHERE id=1),3) FROM users WHERE id=? ON CONFLICT(user_id) DO NOTHING').bind(id),
  ];
  if (!verificationRequired) statements.splice(1, 0,
    c.env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) SELECT ?,id,unixepoch()+? FROM users WHERE id=?').bind(tokenHash, SESSION_SECONDS, id));
  const results = await c.env.DB.batch(statements);
  if (results[0].meta.changes !== 1) return respond(c, { error: 'Không thể tạo tài khoản với email này. Nếu đã đăng ký, hãy đăng nhập.' }, 409, '/dang-ky');
  if(verificationRequired){
    await sendVerificationEmail(c,id,email);
    return respond(c, { ok: true, message: 'Nếu địa chỉ email hợp lệ, hướng dẫn xác minh đã được gửi.' }, 201, '/xac-minh-email?sent=1');
  }
  await clearSession(c);
  setCookie(c, SESSION_COOKIE, token, cookieOptions(c));
  return respond(c, { user: { id, email, name, role: 'user' } }, 201, '/tai-khoan/ho-so');
});

router.post('/login', async (c) => {
  const ipDenied = await limit(c, 'login-ip', clientIp(c), 30, 900);
  if (ipDenied) return ipDenied;
  const body = await readBody(c), email = text(body.email).toLowerCase();
  const loginPath = body.context==='cms'?'/quan-tri/dang-nhap':'/dang-nhap';
  const password = typeof body.password === 'string' ? body.password : '';
  if (email.length > 254 || password.length > 128 || password.length < 1) {
    return respond(c, { error: 'Email hoặc mật khẩu không đúng, hoặc tài khoản không khả dụng.' }, 401, loginPath);
  }
  const pairDenied = await limit(c, 'login-pair', `${clientIp(c)}:${email}`, 10, 900);
  if (pairDenied) return pairDenied;
  const user = await c.env.DB.prepare('SELECT id,email,name,password_hash,role,is_locked,version,is_super_admin,email_verified_at,deleted_at FROM users WHERE email=?')
    .bind(email).first<User & { password_hash: string | null; deleted_at:number|null }>();
  const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !valid || user.is_locked || user.deleted_at) return respond(c, { error: 'Email hoặc mật khẩu không đúng, hoặc tài khoản không khả dụng.' }, 401, loginPath);
  if (c.env.EMAIL_VERIFICATION_REQUIRED === 'true' && user.email_verified_at == null) {
    return respond(c, { error: 'Email của bạn chưa được xác minh. Mở liên kết trong email hoặc yêu cầu gửi lại tại trang xác minh email.' }, 403, loginPath);
  }
  await hydrateUser(user,c.env.DB);
  if(body.context==='cms'&&!user.cms_access)return respond(c,{error:'Tài khoản này chưa được cấp quyền vào khu vực quản trị. Liên hệ quản trị viên nếu bạn cần quyền truy cập.'},403,loginPath);
  const token = randomToken();
  const result = await c.env.DB.prepare(`INSERT INTO sessions(token_hash,user_id,expires_at)
    SELECT ?,id,unixepoch()+? FROM users WHERE id=? AND password_hash=? AND is_locked=0 AND deleted_at IS NULL
      AND (?=0 OR email_verified_at IS NOT NULL)`)
    .bind(await sha256(token), SESSION_SECONDS, user.id, user.password_hash,c.env.EMAIL_VERIFICATION_REQUIRED==='true'?1:0).run();
  if (result.meta.changes !== 1) return respond(c, { error: 'Tài khoản đã thay đổi. Hãy đăng nhập lại.' }, 401, '/dang-nhap');
  await clearSession(c);
  await c.env.DB.prepare('DELETE FROM sessions WHERE expires_at<=unixepoch()').run();
  setCookie(c, SESSION_COOKIE, token, cookieOptions(c));
  return respond(c, { user: publicUser(user) }, 200, user.cms_access ? '/quan-tri' : '/tai-khoan/ho-so');
});

router.get('/me', requireUser, (c) => c.json({ user: publicUser(c.get('user')) }));

router.post('/password-reset/request',async c=>{
 const data=await readBody(c),email=text(data.email).toLowerCase();
 if(email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
  const denied=await limit(c,'password-reset-ip',clientIp(c),5,3600);if(denied)return c.json({message:'Nếu tài khoản phù hợp, bạn sẽ nhận được email hướng dẫn đặt lại mật khẩu.'});
  const address=await sha256(email),emailDenied=await limit(c,'password-reset-email',address,3,3600);if(emailDenied)return c.json({message:'Nếu tài khoản phù hợp, bạn sẽ nhận được email hướng dẫn đặt lại mật khẩu.'});
  const row=await c.env.DB.prepare('SELECT id,email FROM users WHERE email=? AND is_locked=0 AND deleted_at IS NULL').bind(email).first<{id:string;email:string}>();
  if(row&&c.env.RESEND_API_KEY&&c.env.EMAIL_FROM){
   const issued=await issueEmailToken(c,row.id,'password_reset',3600),url=new URL('/dat-lai-mat-khau?token='+encodeURIComponent(issued.token),c.req.url).toString();
   c.executionCtx.waitUntil(sendResend(c.env,{to:row.email,subject:'Đặt lại mật khẩu Trọ Tốt TP.HCM',html:emailShell('Đặt lại mật khẩu',['Bạn vừa yêu cầu đặt lại mật khẩu. Liên kết dùng một lần và hết hạn sau 60 phút.'],url,'Đặt mật khẩu mới'),text:'Đặt lại mật khẩu trong 60 phút: '+url,key:'reset:'+row.id+':'+issued.hash}));
  }
 }
 return c.json({message:'Nếu tài khoản phù hợp, bạn sẽ nhận được email hướng dẫn đặt lại mật khẩu.'},202);
});

router.post('/email-verification/resend',requireUser,async c=>{
 const user=c.get('user');if(user.email_verified_at!=null)return c.json({ok:true,verified:true});
 const denied=await limit(c,'email-verify-user',user.id,3,3600);if(denied)return denied;
 if(!c.env.RESEND_API_KEY||!c.env.EMAIL_FROM)return c.json({error:'Hiện chưa thể gửi email xác minh. Vui lòng thử lại sau hoặc liên hệ bộ phận hỗ trợ.'},503);
 await sendVerificationEmail(c,user.id,user.email);
 return c.json({ok:true,message:'Đã gửi email xác minh nếu địa chỉ này có thể nhận thư.'});
});

router.post('/email-verification/request',async c=>{
 const data=await readBody(c),email=text(data.email).toLowerCase();
 const generic={message:'Nếu tài khoản cần xác minh, hướng dẫn sẽ được gửi đến địa chỉ email đã nhập.'};
 const ipDenied=await limit(c,'email-verify-request-ip',clientIp(c),10,3600);if(ipDenied)return ipDenied;
 if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return c.json(generic,202);
 const emailDenied=await limit(c,'email-verify-request-email',await sha256(email),3,3600);if(emailDenied)return emailDenied;
 if(!c.env.RESEND_API_KEY||!c.env.EMAIL_FROM)return c.json({error:'Hiện chưa thể gửi email xác minh. Vui lòng thử lại sau.'},503);
 const row=await c.env.DB.prepare('SELECT id,email FROM users WHERE email=? AND email_verified_at IS NULL AND is_locked=0 AND deleted_at IS NULL').bind(email).first<{id:string;email:string}>();
 if(row)await sendVerificationEmail(c,row.id,row.email);
 return c.json(generic,202);
});

router.post('/email-verification/confirm',async c=>{
 const data=await readBody(c);if(!tokenInput(data.token))return c.json({error:'Liên kết xác minh không hợp lệ hoặc đã hết hạn.'},400);
 const token=String(data.token),hash=await sha256(token),stamp=crypto.randomUUID();
 const results=await c.env.DB.batch([
  c.env.DB.prepare(`UPDATE users SET email_verified_at=unixepoch(),version=version+1,change_token=?,updated_at=unixepoch()
   WHERE id=(SELECT user_id FROM account_email_tokens WHERE token_hash=? AND purpose='verify_email' AND consumed_at IS NULL AND expires_at>unixepoch()) AND email_verified_at IS NULL AND is_locked=0 AND deleted_at IS NULL`).bind(stamp,hash),
  c.env.DB.prepare("UPDATE account_email_tokens SET consumed_at=unixepoch(),consumed_reason='used' WHERE token_hash=? AND purpose='verify_email' AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=account_email_tokens.user_id AND change_token=?)").bind(hash,stamp),
 ]);
 if(results[0].meta.changes!==1)return c.json({error:'Liên kết xác minh không hợp lệ, đã dùng hoặc đã hết hạn.'},400);
 return c.json({ok:true});
});

router.post('/password-reset/complete',async c=>{
 const data=await readBody(c),password=typeof data.password==='string'?data.password:'',confirmation=typeof data.password_confirmation==='string'?data.password_confirmation:'';
 if(!tokenInput(data.token))return c.json({error:'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Hãy yêu cầu gửi liên kết mới.'},400);
 if(password.length<12||password.length>128||['123456789012','password1234','qwertyuiop12'].includes(password.toLowerCase()))return c.json({error:'Mật khẩu mới cần từ 12–128 ký tự và không được là mật khẩu dễ đoán.'},400);
 if(password!==confirmation)return c.json({error:'Hai lần nhập mật khẩu mới chưa khớp.'},400);
 const hash=await sha256(String(data.token)),digest=await hashPassword(password),stamp=crypto.randomUUID();
 const results=await c.env.DB.batch([
  c.env.DB.prepare(`UPDATE users SET password_hash=?,version=version+1,change_token=?,updated_at=unixepoch()
   WHERE id=(SELECT user_id FROM account_email_tokens WHERE token_hash=? AND purpose='password_reset' AND consumed_at IS NULL AND expires_at>unixepoch()) AND is_locked=0 AND deleted_at IS NULL`).bind(digest,stamp,hash),
  c.env.DB.prepare("UPDATE account_email_tokens SET consumed_at=unixepoch(),consumed_reason='used' WHERE token_hash=? AND purpose='password_reset' AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=account_email_tokens.user_id AND change_token=?)").bind(hash,stamp),
  c.env.DB.prepare('DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE change_token=?)').bind(stamp),
 ]);
 if(results[0].meta.changes!==1)return c.json({error:'Liên kết đặt lại không hợp lệ, đã dùng hoặc đã hết hạn.'},400);
 const user=await c.env.DB.prepare('SELECT id,email FROM users WHERE change_token=?').bind(stamp).first<{id:string;email:string}>();
 if(user){
  c.executionCtx.waitUntil(sendResend(c.env,{to:user.email,subject:'Mật khẩu Trọ Tốt TP.HCM đã thay đổi',html:emailShell('Mật khẩu đã được cập nhật',['Mật khẩu tài khoản vừa được đặt lại. Tất cả phiên đăng nhập trước đó đã kết thúc.'],new URL('/dang-nhap',c.req.url).toString(),'Đăng nhập'),text:'Mật khẩu đã được thay đổi. Nếu không phải bạn, hãy liên hệ hỗ trợ.',key:'password-reset-success:'+hash}));
 }
 return c.json({ok:true});
});
router.post('/logout', async (c) => {
  const body=await readBody(c);
  await clearSession(c);
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: new URL(c.req.url).protocol === 'https:', httpOnly: true, sameSite: 'Lax' });
  return respond(c, { ok: true }, 200, body.context==='cms'?'/quan-tri/dang-nhap':'/dang-nhap');
});

router.post('/password',requireUser,async(c)=>{
  const user=c.get('user'),data=await readBody(c);
  const denied=await limit(c,'password-user',user.id,5,900); if(denied)return denied;
  const current=typeof data.current_password==='string'?data.current_password:'',password=typeof data.password==='string'?data.password:'';
  if(current.length>128||password.length<12||password.length>128||password!==data.password_confirmation||current===password)return c.json({error:'Mật khẩu mới cần 12–128 ký tự, khác mật khẩu cũ và khớp xác nhận.'},400);
  const row=await c.env.DB.prepare('SELECT password_hash FROM users WHERE id=?').bind(user.id).first<{password_hash:string}>();
  if(!row||!await verifyPassword(current,row.password_hash))return c.json({error:'Mật khẩu hiện tại chưa đúng.'},400);
  const digest=await hashPassword(password),stamp=crypto.randomUUID();
  const results=await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash=?,version=version+1,change_token=?,updated_at=unixepoch() WHERE id=? AND password_hash=? AND is_locked=0 AND deleted_at IS NULL').bind(digest,stamp,user.id,row.password_hash),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND change_token=?)').bind(user.id,user.id,stamp),
    c.env.DB.prepare("INSERT INTO admin_audit(id,actor_id,action,target_id) SELECT ?,id,'account.password',id FROM users WHERE id=? AND change_token=?").bind(crypto.randomUUID(),user.id,stamp)
  ]);
  if(results[0].meta.changes!==1)return c.json({error:'Tài khoản đã thay đổi. Hãy đăng nhập lại.'},409);
  deleteCookie(c,SESSION_COOKIE,{path:'/',httpOnly:true,sameSite:'Lax',secure:new URL(c.req.url).protocol==='https:'});
  return c.json({ok:true,redirect:user.cms_access?'/quan-tri/dang-nhap':'/dang-nhap'});
});

export default router;
