import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const base = new URL(process.env.PRODUCTION_BASE_URL ?? 'https://trotothcm.id.vn').origin;
const basePattern = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const productionConfig = JSON.parse(await readFile(new URL('../apps/web/wrangler.production.jsonc', import.meta.url), 'utf8'));
const emailVerificationRequired = productionConfig.vars?.EMAIL_VERIFICATION_REQUIRED === 'true';
const database = '53bbfe5b-25d6-419a-b89e-f450d795027c';
const email = `deployment-check-${randomUUID()}@example.test`;
const password = randomBytes(24).toString('base64url');
let registrationAttempted = false;

async function request(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(base + path, {
    method, redirect: 'manual', signal: AbortSignal.timeout(30000),
    headers: { ...(method !== 'GET' ? { Origin: base, 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const content = await response.text();
  let data;
  try { data = JSON.parse(content); } catch { data = null; }
  return { response, data, html: content, cpuLimit: /1102|exceeded.*cpu/i.test(content) };
}

async function cleanup() {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error('Missing cleanup credentials');
  const tables = ['seller_reviews', 'admin_audit', 'seller_profiles', 'sessions', 'users'];
  for (const table of tables) {
    const sql = table === 'users' ? 'DELETE FROM users WHERE email=?'
      : `DELETE FROM ${table} WHERE ${table === 'admin_audit' ? 'target_id' : 'user_id'} IN (SELECT id FROM users WHERE email=?)`;
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`, {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params: [email] }),
    });
    const body = await response.json();
    if (!response.ok || !body.success) throw new Error('Cleanup request failed');
  }
}

try {
  const www = await fetch('https://www.trotothcm.id.vn/', { redirect: 'manual', signal: AbortSignal.timeout(30000) });
  assert.equal(www.status, 308, `www redirect HTTP ${www.status}`);
  assert.equal(www.headers.get('location'), 'https://trotothcm.id.vn/');
  const home = await request('/');
  assert.equal(home.response.status, 200, `Home HTTP ${home.response.status}`);
  assert.ok(home.html.includes('Trọ Tốt TP.HCM'));
  assert.match(home.html, /<meta name="robots" content="index, follow"/);
  assert.match(home.html, new RegExp(`<link rel="canonical" href="${basePattern}/"`));
  assert.match(home.html, new RegExp(`property="og:image" content="${basePattern}/brand/share-card\\.png"`));
  const [robots, sitemap, listingPage, filteredPage, shareCard] = await Promise.all([
    request('/robots.txt'), request('/sitemap.xml'), request('/tim-phong'),
    request('/tim-phong?area=binh-thanh'), request('/brand/share-card.png'),
  ]);
  assert.equal(robots.response.status, 200);
  assert.match(robots.html, new RegExp(`Sitemap: ${basePattern}/sitemap\\.xml`));
  assert.match(robots.html, /Disallow: \/quan-tri\//);
  assert.equal(sitemap.response.status, 200);
  assert.match(sitemap.html, /<urlset[^>]+sitemaps\.org/);
  assert.doesNotMatch(sitemap.html, /\/(?:quan-tri|tai-khoan|api)\//);
  assert.equal(listingPage.response.status, 200);
  assert.match(listingPage.html, /<meta name="robots" content="index, follow"/);
  assert.match(filteredPage.html, /<meta name="robots" content="noindex, follow"/);
  assert.match(filteredPage.html, new RegExp(`<link rel="canonical" href="${basePattern}/tim-phong"`));
  assert.equal(shareCard.response.status, 200);
  assert.match(shareCard.response.headers.get('content-type') ?? '', /image\/png/);
  const roomId = listingPage.html.match(/href="\/phong\/([a-f0-9-]{36})"/i)?.[1];
  assert.ok(roomId, 'Danh sách công khai cần có ít nhất một tin phòng đã xuất bản.');
  assert.match(sitemap.html, new RegExp(`<loc>${basePattern}/phong/${roomId}</loc>`));
  const room = await request('/phong/' + roomId);
  assert.equal(room.response.status, 200);
  assert.match(room.html, /<meta name="robots" content="index, follow"/);
  assert.match(room.html, new RegExp(`<meta property="og:title" content="[^\\"]+`));
  assert.match(room.response.headers.get('content-security-policy') ?? '', /frame-src https:\/\/maps\.google\.com https:\/\/www\.google\.com/);
  assert.match(room.html, /<iframe[^>]+src="https:\/\/maps\.google\.com\/maps\?/);
  const roomImageId = room.html.match(/\/api\/listing-images\/([a-f0-9-]{36})/i)?.[1];
  if (roomImageId) {
    const image = await request('/api/listing-images/' + roomImageId);
    assert.equal(image.response.status, 200);
    assert.match(image.response.headers.get('cache-control') ?? '', /public/);
  }
  for (const path of ['/dang-ky', '/dang-nhap']) assert.equal((await request(path)).response.status, 200);
  const privatePage = await request('/tai-khoan/ho-so');
  assert.equal(privatePage.response.status, 302);
  assert.match(privatePage.response.headers.get('x-robots-tag') ?? '', /noindex/i);
  const health = await request('/api/health');
  assert.equal(health.response.status, 200); assert.equal(health.data?.database, 'ready');
  const plans = await request('/api/plans');
  assert.ok(Array.isArray(plans.data?.items) && plans.data.items.length > 0);
  assert.ok(plans.data.items.every((p) => Number.isSafeInteger(p.price_vnd) && p.price_vnd >= 0 && Number.isSafeInteger(p.duration_days) && p.duration_days > 0));
  console.log('Public HTTPS, SEO/sitemap, tin và ảnh chia sẻ, trang tài khoản, health và gói D1: OK');

  if (emailVerificationRequired) {
    console.log('Bỏ qua fixture đăng ký production: cần xác minh email và token xác minh là lịch sử bất biến.');
  } else {
    registrationAttempted = true;
    const started = Date.now();
    const registered = await request('/api/auth/register', { method: 'POST', body: { name: 'Kiểm tra triển khai', email, password } });
    assert.equal(registered.response.status, 201, `Register HTTP ${registered.response.status}; cpu_limit_marker=${registered.cpuLimit}`);
    const cookieHeader = registered.response.headers.get('set-cookie') ?? '';
    assert.match(cookieHeader, /Secure/i); assert.match(cookieHeader, /HttpOnly/i); assert.match(cookieHeader, /SameSite=Lax/i);
    let cookie = cookieHeader.split(';')[0];
    assert.equal((await request('/api/auth/me', { cookie })).data?.user?.role, 'user');
    console.log(`Đăng ký và cookie HTTPS: OK; wall time ${Date.now() - started}ms (không phải CPU time)`);

    const login = await request('/api/auth/login', { method: 'POST', cookie, body: { email, password } });
    assert.equal(login.response.status, 200, `Login HTTP ${login.response.status}; cpu_limit_marker=${login.cpuLimit}`);
    const previousCookie = cookie;
    cookie = login.response.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie && cookie !== previousCookie);
    assert.equal((await request('/api/auth/me', { cookie: previousCookie })).response.status, 401);
    assert.equal((await request('/api/account/profile', { method: 'POST', cookie, body: {
      version: 0, display_name: 'Kiểm tra triển khai', seller_type: 'owner', phone: '0901234567', zalo_phone: '', introduction: 'Tài khoản thử sẽ được dọn sau kiểm tra.',
    } })).response.status, 200);
    assert.equal((await request('/api/account/profile', { cookie })).data?.profile?.status, 'pending');
    assert.equal((await request('/api/admin/sellers', { cookie })).response.status, 403);
    assert.equal((await request('/api/auth/logout', { method: 'POST', cookie, body: {} })).response.status, 200);
    assert.equal((await request('/api/auth/me', { cookie })).response.status, 401);
    console.log('Đăng nhập, quay vòng phiên, gửi hồ sơ, phân quyền và đăng xuất: OK');
  }
} catch (error) {
  console.error(error instanceof assert.AssertionError ? error.message : 'Không hoàn thành được kiểm tra public. Kiểm tra allowlist/proxy hoặc runtime; không in credential.');
  process.exitCode = 1;
} finally {
  if (registrationAttempted) {
    try { await cleanup(); console.log('Đã dọn đúng fixture vừa tạo trên D1 dự án.'); }
    catch { console.error(`Cần dọn fixture kiểm thử: ${email}`); process.exitCode = 1; }
  }
}
