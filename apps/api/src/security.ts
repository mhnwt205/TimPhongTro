import { getCookie } from 'hono/cookie';
import type { Context, MiddlewareHandler } from 'hono';
import { allPermissions, can } from './permissions';

export type Bindings = { DB: D1Database; LISTING_IMAGES: R2Bucket; RESEND_API_KEY?: string; EMAIL_FROM?: string; EMAIL_VERIFICATION_REQUIRED?: string; EMAIL_TEST_CAPTURE?: string; SEPAY_ENV?: string; SEPAY_MERCHANT_ID?: string; SEPAY_SECRET_KEY?: string };
export type User = { id: string; email: string; name: string; role: 'user' | 'admin'; is_locked: number; version: number; is_super_admin: number; email_verified_at: number|null; permissions: string[]; cms_access: boolean };
export type ApiEnv = { Bindings: Bindings; Variables: { user: User } };
export type ApiContext = Context<ApiEnv>;
export const SESSION_COOKIE = 'tpt_session';
export const SESSION_SECONDS = 7 * 24 * 60 * 60;

export const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const randomToken = (): string => Array.from(crypto.getRandomValues(new Uint8Array(32)),
  (byte) => byte.toString(16).padStart(2, '0')).join('');

export async function resolveUser(request: Request, db: D1Database): Promise<User | null> {
  const token = request.headers.get('cookie')?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(SESSION_COOKIE + '='))?.slice(SESSION_COOKIE.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const user = await db.prepare(`SELECT u.id,u.email,u.name,u.role,u.is_locked,u.version,u.is_super_admin,u.email_verified_at
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>unixepoch() AND u.is_locked=0 AND u.deleted_at IS NULL`)
    .bind(await sha256(token)).first<User>();
  if (!user) return null;
  return hydrateUser(user,db);
}

export async function hydrateUser(user:User,db:D1Database):Promise<User> {
  const grants = user.is_super_admin ? [] : (await db.prepare(`SELECT DISTINCT p.permission FROM cms_user_roles ur
    JOIN cms_roles r ON r.id=ur.role_id JOIN cms_role_permissions p ON p.role_id=r.id
    WHERE ur.user_id=? AND r.deleted_at IS NULL`).bind(user.id).all<{permission:string}>()).results;
  user.permissions = user.is_super_admin ? [...allPermissions] : grants.map(g=>g.permission).filter(p=>allPermissions.includes(p));
  user.cms_access = Boolean(user.is_super_admin || user.permissions.length);
  return user;
}

export const requireUser: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const user = await resolveUser(c.req.raw, c.env.DB);
  if (!user) return c.json({ error: 'Vui lòng đăng nhập để tiếp tục.' }, 401);
  c.set('user', user);
  await next();
};

export const requireAdmin: MiddlewareHandler<ApiEnv> = async (c, next) => {
  if (!c.get('user').cms_access) return c.json({ error: 'Bạn không có quyền quản trị.' }, 403);
  await next();
};

export const requirePermission = (permission: string): MiddlewareHandler<ApiEnv> => async (c,next) => {
  if (!can(c.get('user'),permission)) return c.json({error:'Bạn không có quyền thực hiện thao tác này.'},403);
  await next();
};

export function publicUser(user: User) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, is_super_admin:user.is_super_admin, email_verified:user.email_verified_at!=null, permissions:user.permissions, cms_access:user.cms_access };
}

// Strict Origin checking applies to every mutation, including login/register.
export const sameOrigin: MiddlewareHandler<ApiEnv> = async (c, next) => {
  // SePay sends server-to-server payment notifications without the browser's Origin header.
  // The IPN handler authenticates against SePay's signed/order API before it can write a receipt.
  if (c.req.path === '/api/payments/sepay/ipn') return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next();
  if (c.req.header('Origin') !== new URL(c.req.url).origin || c.req.header('Sec-Fetch-Site') === 'cross-site') {
    return c.json({ error: 'Yêu cầu không hợp lệ. Hãy tải lại trang và thử lại.' }, 403);
  }
  const contentType = c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (!['application/json', 'application/x-www-form-urlencoded'].includes(contentType ?? '')) {
    return c.json({ error: 'Định dạng yêu cầu không hợp lệ.' }, 415);
  }
  await next();
};

export async function readBody(c: ApiContext): Promise<Record<string, unknown>> {
  try {
    if (c.req.header('Content-Type')?.startsWith('application/x-www-form-urlencoded')) {
      return Object.fromEntries(await c.req.raw.formData());
    }
    const value: unknown = await c.req.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

export async function limit(c: ApiContext, group: string, subject: string, max: number, seconds: number) {
  const now = Math.floor(Date.now() / 1000), bucket = Math.floor(now / seconds);
  const key = await sha256(`${group}:${subject}`);
  const row = await c.env.DB.prepare(`INSERT INTO auth_rate_limits(key,bucket,attempts,expires_at)
    VALUES(?,?,1,?) ON CONFLICT(key,bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts`)
    .bind(key, bucket, (bucket + 1) * seconds).first<{ attempts: number }>();
  await c.env.DB.prepare(`DELETE FROM auth_rate_limits WHERE rowid IN
    (SELECT rowid FROM auth_rate_limits WHERE expires_at<? LIMIT 100)`).bind(now).run();
  if (!row || row.attempts > max) {
    const waitSeconds=Math.max(1,(bucket+1)*seconds-now);
    c.header('Retry-After', String(waitSeconds));
    const message=`Bạn vừa gửi quá nhiều yêu cầu. Đợi khoảng ${waitSeconds} giây rồi thử lại.`;
    if (c.req.header('Content-Type')?.startsWith('application/x-www-form-urlencoded')) {
      const path = c.req.path.endsWith('/register') ? '/dang-ky' : c.req.path.endsWith('/login') ? '/dang-nhap' : '/tai-khoan/ho-so';
      return c.redirect(`${path}?error=${encodeURIComponent(message)}`, 303);
    }
    return c.json({ error: message }, 429);
  }
  return null;
}

export const clientIp = (c: ApiContext) => c.req.header('CF-Connecting-IP') ?? 'local';

export async function clearSession(c: ApiContext) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run();
  }
}
