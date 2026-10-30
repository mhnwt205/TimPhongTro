import { Hono } from 'hono';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import auth from './auth';
import sellers from './sellers';
import cms from './cms';
import wallets from './wallets';
import withdrawals from './withdrawals';
import reports from './reports';
import listings from './listings';
import listingLifecycle from './listing-lifecycle';
import renewals from './renewals';
import notifications from './notifications';
export type {UserNotification} from './notifications';
import geocoding from './geocoding';
import { getWebsiteSettings } from './website-settings';
export {publicRooms} from './listings';
export {inactiveListing,displayLabel,reviewedCopy,publicListingIds} from './listing-status';
export type {InactiveListing} from './listing-status';
export type {Listing,ListingDetails} from './listings';
export type {Renewal} from './renewals';
import { sameOrigin, type ApiEnv } from './security';

export type { Bindings, User } from './security';
export type { SellerProfile } from './sellers';
export { resolveUser } from './security';
export { can, permissionGroups, actionLabels } from './permissions';
export {receivingBanks,bankDirectory} from './banks';
export {activityLabel} from './dashboard';
export type {CmsDashboard,CmsNotifications,ActivityDay} from './dashboard';
export type {Withdrawal,WithdrawalPayout} from './withdrawals';
export type {Topup,WalletEntry,WalletSummary,PaymentSettings,BankAccount} from './wallets';
export {reportReasons} from './reports';
export type {ListingReport} from './reports';
export {getWebsiteSettings} from './website-settings';
export type {WebsiteSettings} from './website-settings';
export type ListingPlan = { id: string; name: string; price_vnd: number; duration_days: number; description: string; is_priority: number };

const app = new Hono<ApiEnv>();

app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Cross-Origin-Resource-Policy', 'same-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header('X-Permitted-Cross-Domain-Policies', 'none');
  if (new URL(c.req.url).protocol === 'https:') c.header('Strict-Transport-Security', 'max-age=31536000');
  await next();
});

app.use('/api/*', sameOrigin);
const tooLarge=(c:Context<ApiEnv>)=>c.json({error:c.req.path.includes('images')?'Ảnh sau khi thu gọn vượt giới hạn tải lên 600 KB. Chọn ảnh gốc dưới 2 MB hoặc giảm độ phân giải rồi thử lại.':'Nội dung biểu mẫu vượt quá dung lượng cho phép. Rút gọn phần mô tả hoặc dữ liệu dài rồi thử lại.'},413);
app.use('/api/auth/*', bodyLimit({ maxSize: 8192, onError: tooLarge }));
app.use('/api/account/*', (c,next)=>bodyLimit({ maxSize:c.req.path.startsWith('/api/account/listings')?32768:8192, onError: tooLarge })(c,next));
app.use('/api/payments/sepay/*', bodyLimit({ maxSize: 16384, onError: tooLarge }));
app.use('/api/admin/*', bodyLimit({ maxSize: 8192, onError: tooLarge }));
app.use('/api/cms/*', (c,next)=>bodyLimit({ maxSize:c.req.path.endsWith('/images')||c.req.path==='/api/cms/listing-images'?840000:32768, onError: tooLarge })(c,next));
app.route('/api/auth', auth);
app.route('/api', sellers);
app.route('/api/cms', cms);
app.route('/api',wallets);
app.route('/api',withdrawals);
app.route('/api',reports);
app.route('/api',listings);
app.route('/api',listingLifecycle);
app.route('/api',renewals);
app.route('/api',notifications);
app.route('/api',geocoding);

app.get('/api/health', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT count(*) AS total FROM listing_plans',
    ).all();
    if (!results.length) return c.json({ status: 'unavailable' }, 503);
    return c.json({ status: 'ok', service: 'timphongtro', database: 'ready' });
  } catch {
    return c.json({ status: 'unavailable' }, 503);
  }
});

app.get('/api/plans', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, price_vnd, duration_days, description, is_priority FROM listing_plans WHERE is_active = 1 AND deleted_at IS NULL ORDER BY price_vnd, id',
  ).all<ListingPlan>();
  return c.json({ items: results });
});

app.get('/api/site-content', async (c) => c.json(await getWebsiteSettings(c.env.DB)));

app.notFound((c) => c.json({ error: 'Trang hoặc chức năng này không tồn tại. Kiểm tra lại đường dẫn hoặc quay về trang trước.' }, 404));
app.onError((error, c) => {
  const passwordUnavailable = /scrypt/i.test(error.message);
  // Controlled categories only: no request bodies, cookies, SQL or raw exceptions in logs.
  console.error('api_error', { code: passwordUnavailable ? 'PASSWORD_HASH_UNAVAILABLE' : 'REQUEST_FAILED' });
  return c.json({ error: passwordUnavailable ? 'Tính năng đăng nhập bằng mật khẩu tạm thời chưa khả dụng. Vui lòng thử lại sau.' : 'Hệ thống đang gặp sự cố khi xử lý yêu cầu. Tải lại trang để kiểm tra kết quả trước khi gửi lại.' }, passwordUnavailable ? 503 : 500);
});

export default app;

