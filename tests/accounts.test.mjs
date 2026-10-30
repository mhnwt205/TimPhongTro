import assert from 'node:assert/strict';
import { before, after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';

const server = createTestHarness({ root: fileURLToPath(new URL('../', import.meta.url)), workers: [{ configPath: 'apps/api/wrangler.test.jsonc' }] });
let origin, DB, sequence = 0;
const password = 'Mot-can-phong-am-ap-2026';
const request = (path, { method = 'GET', body, cookie, ip, headers = {}, form = false } = {}) => server.fetch(new URL(path, origin), {
  method, redirect: 'manual',
  headers: { ...(method === 'GET' ? {} : { Origin: origin, 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' }),
    'CF-Connecting-IP': ip ?? `192.0.2.${++sequence % 250 + 1}`, ...(cookie ? { Cookie: cookie } : {}), ...headers },
  ...(body !== undefined ? { body: form ? new URLSearchParams(body).toString() : JSON.stringify(body) } : {}),
});
const sessionCookie = (response) => response.headers.get('set-cookie')?.split(';')[0];
async function register(overrides = {}) {
  const email = `account-${++sequence}@example.test`;
  const response = await request('/api/auth/register', { method: 'POST', body: { name: 'Người đăng thử', email, password, ...overrides } });
  assert.equal(response.status, 201, await response.clone().text());
  return { ...(await response.json()).user, cookie: sessionCookie(response), response };
}
async function admin() {
  const account = await register();
  await DB.prepare("UPDATE users SET role='admin',is_super_admin=1 WHERE id=?").bind(account.id).run();
  return account;
}
const profile = (version = 0) => ({ display_name: 'Chủ trọ thử nghiệm', seller_type: 'owner', phone: '+84 901 234 567', zalo_phone: '', introduction: 'Phòng tại TP.HCM.', version });
async function submit(account, version = 0, overrides = {}) {
  return request('/api/account/profile', { method: 'POST', cookie: account.cookie, body: { ...profile(version), ...overrides } });
}
async function getProfile(account) {
  const response = await request('/api/account/profile', { cookie: account.cookie });
  assert.equal(response.status, 200);
  return response.json();
}
const review = (operator, account, version, decision = 'approved', note = '') => request(`/api/admin/sellers/${account.id}/review`, {
  method: 'POST', cookie: operator.cookie, body: { version, decision, note },
});

before(async () => {
  origin = (await server.listen()).url.origin;
  await server.getWorker().applyD1Migrations('DB');
  ({ DB } = await server.getWorker().getEnv());
});
after(async () => { await server.close(); });

describe('Authentication and session boundaries', () => {
  test('requires authentication and rejects cross-origin or missing-origin mutations', async () => {
    assert.equal((await request('/api/auth/me')).status, 401);
    assert.equal((await request('/api/auth/me', { cookie: 'tpt_session=' + '0'.repeat(64) })).status, 401);
    for (const value of ['', 'null', 'https://untrusted.example']) {
      const response = await request('/api/auth/register', { method: 'POST', headers: { Origin: value }, body: { name: 'Invalid', email: 'invalid@example.test', password } });
      assert.equal(response.status, 403);
    }
    assert.equal((await request('/api/auth/login', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' }, body: {} })).status, 403);
  });

  test('validates password and body size before registration', async () => {
    assert.equal((await request('/api/auth/register', { method: 'POST', body: { name: 'Alice', email: 'alice@example.test', password: 'short' } })).status, 400);
    assert.equal((await request('/api/auth/register', { method: 'POST', body: { name: 'Alice', email: 'alice@example.test', password, password_confirmation: 'mismatch' } })).status, 400);
    assert.equal((await request('/api/auth/register', { method: 'POST', body: { name: 'x'.repeat(9000) } })).status, 413);
  });

  test('registers without accepting role injection, hashes passwords and stores only session hashes', async () => {
    const user = await register({ role: 'admin', is_locked: 0 });
    assert.equal(user.role, 'user');
    assert.match(user.response.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(user.response.headers.get('set-cookie'), /SameSite=Lax/i);
    const row = await DB.prepare('SELECT password_hash,role FROM users WHERE id=?').bind(user.id).first();
    assert.match(row.password_hash, /^scrypt\$32768\$8\$3\$/);
    assert.ok(!row.password_hash.includes(password));
    const stored = await DB.prepare('SELECT token_hash FROM sessions WHERE user_id=?').bind(user.id).first();
    assert.notEqual(stored.token_hash, user.cookie.split('=')[1]);
    assert.equal((await request('/api/auth/me', { cookie: user.cookie })).status, 200);
    const duplicate = await request('/api/auth/register', { method: 'POST', body: { name: 'Other', email: user.email.toUpperCase(), password } });
    assert.equal(duplicate.status, 409);
    assert.equal((await DB.prepare('SELECT count(*) AS n FROM users WHERE email=?').bind(user.email).first()).n, 1);
  });

  test('returns the same error for unknown email and incorrect password', async () => {
    const user = await register();
    const first = await request('/api/auth/login', { method: 'POST', body: { email: user.email, password: 'incorrect-password' } });
    const second = await request('/api/auth/login', { method: 'POST', body: { email: 'missing@example.test', password: 'incorrect-password' } });
    assert.equal(first.status, 401); assert.equal(second.status, 401);
    assert.deepEqual(await first.json(), await second.json());
  });

  test('rotates session at login and revokes it on logout', async () => {
    const user = await register();
    const login = await request('/api/auth/login', { method: 'POST', cookie: user.cookie, body: { email: user.email, password } });
    assert.equal(login.status, 200);
    const next = sessionCookie(login);
    assert.notEqual(next, user.cookie);
    assert.equal((await request('/api/auth/me', { cookie: user.cookie })).status, 401);
    assert.equal((await request('/api/auth/me', { cookie: next })).status, 200);
    assert.equal((await request('/api/auth/logout', { method: 'POST', cookie: next, body: {} })).status, 200);
    assert.equal((await request('/api/auth/me', { cookie: next })).status, 401);
  });

  test('rejects expired sessions', async () => {
    const user = await register();
    await DB.prepare('UPDATE sessions SET created_at=unixepoch()-1000,expires_at=unixepoch()-10 WHERE user_id=?').bind(user.id).run();
    assert.equal((await request('/api/auth/me', { cookie: user.cookie })).status, 401);
  });

  test('supports browser form redirects without putting credentials in the URL', async () => {
    const email = `form-${++sequence}@example.test`;
    const response = await request('/api/auth/register', { method: 'POST', form: true, body: { name: 'Form User', email, password, password_confirmation: password } });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/tai-khoan/ho-so');
    assert.ok(sessionCookie(response));
    const wrong = await request('/api/auth/login', { method: 'POST', form: true, body: { email, password: 'invalid-password' } });
    assert.equal(wrong.status, 303);
    assert.ok(wrong.headers.get('location').startsWith('/dang-nhap?error='));
    assert.ok(!wrong.headers.get('location').includes(email));
    assert.ok(!wrong.headers.get('location').includes('invalid-password'));
  });

  test('limits password guesses before doing unbounded expensive work', async () => {
    for (let i = 0; i < 10; i++) {
      assert.equal((await request('/api/auth/login', { method: 'POST', ip: '198.51.100.245', body: { email: 'rate-limit@example.test', password: 'incorrect-password' } })).status, 401);
    }
    const response = await request('/api/auth/login', { method: 'POST', ip: '198.51.100.245', body: { email: 'rate-limit@example.test', password: 'incorrect-password' } });
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get('retry-after')) > 0);
    const formResponse = await request('/api/auth/login', { method: 'POST', ip: '198.51.100.245', form: true, body: { email: 'rate-limit@example.test', password: 'incorrect-password' } });
    assert.equal(formResponse.status, 303);
    assert.ok(formResponse.headers.get('location').startsWith('/dang-nhap?error='));
  });
});

describe('Seller application and moderation', () => {
  test('keeps profile ownership on server, validates input and rejects stale submissions', async () => {
    const user = await register();
    assert.equal((await getProfile(user)).can_post, false);
    assert.equal((await submit(user, 0, { phone: 'invalid' })).status, 400);
    assert.equal((await submit(user, 0, { user_id: 'someone-else', role: 'admin', status: 'approved' })).status, 200);
    const data = await getProfile(user);
    assert.equal(data.profile.user_id, user.id);
    assert.equal(data.profile.phone, '0901234567');
    assert.equal(data.profile.zalo_phone, '0901234567');
    assert.equal(data.profile.status, 'pending');
    assert.equal(data.can_post, false);
    assert.equal((await submit(user, 0)).status, 409);
  });

  test('protects admin endpoints and does not expose another account profile', async () => {
    const first = await register(), second = await register();
    await submit(first);
    assert.equal((await request('/api/admin/sellers')).status, 401);
    assert.equal((await request('/api/admin/sellers', { cookie: first.cookie })).status, 403);
    assert.equal((await review(first, first, 1)).status, 403);
    assert.equal((await getProfile(second)).profile, null);
  });

  test('requires rejection reasons, preserves history and reviews new versions', async () => {
    const operator = await admin(), user = await register();
    await submit(user);
    assert.equal((await review(operator, user, 1, 'rejected')).status, 400);
    assert.equal((await review(operator, user, 1, 'rejected', 'Bổ sung số liên hệ đúng.')).status, 200);
    let data = await getProfile(user);
    assert.equal(data.profile.status, 'rejected'); assert.equal(data.reviews.length, 1);
    assert.equal(data.reviews[0].note, 'Bổ sung số liên hệ đúng.');
    assert.equal((await submit(user, data.profile.version)).status, 200);
    assert.equal((await review(operator, user, 1)).status, 409);
    data = await getProfile(user);
    assert.equal((await review(operator, user, data.profile.version)).status, 200);
    data = await getProfile(user);
    assert.equal(data.profile.status, 'approved'); assert.equal(data.can_post, true); assert.equal(data.reviews.length, 2);
    assert.equal((await submit(user, data.profile.version, { display_name: 'Tên vừa cập nhật' })).status, 200);
    assert.equal((await getProfile(user)).can_post, false);
  });

  test('allows only one decision for concurrent reviews, with one audit entry', async () => {
    const operator = await admin(), user = await register();
    await submit(user);
    const responses = await Promise.all([review(operator, user, 1), review(operator, user, 1, 'rejected', 'Cần kiểm tra lại thông tin.')]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await DB.prepare('SELECT count(*) AS n FROM seller_reviews WHERE user_id=?').bind(user.id).first()).n, 1);
    assert.equal((await DB.prepare('SELECT count(*) AS n FROM admin_audit WHERE target_id=?').bind(user.id).first()).n, 1);
  });

  test('prevents administrators approving their own profile', async () => {
    const operator = await admin();
    await submit(operator);
    assert.equal((await review(operator, operator, 1)).status, 403);
    assert.equal((await getProfile(operator)).profile.status, 'pending');
  });

  test('revokes sessions on lock, blocks login and safely handles stale lock requests', async () => {
    const operator = await admin(), user = await register();
    await submit(user); await review(operator, user, 1);
    const lock = (locked, version) => request(`/api/admin/sellers/${user.id}/lock`, { method: 'POST', cookie: operator.cookie, body: { locked, version, note: 'Kiểm tra thao tác khóa.' } });
    assert.equal((await lock(true, 1)).status, 200);
    assert.equal((await request('/api/auth/me', { cookie: user.cookie })).status, 401);
    assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: user.email, password } })).status, 401);
    assert.equal((await lock(true, 1)).status, 409);
    assert.equal((await DB.prepare("SELECT count(*) AS n FROM admin_audit WHERE target_id=? AND action='user.lock'").bind(user.id).first()).n, 1);
    assert.equal((await lock(false, 2)).status, 200);
    assert.equal((await request('/api/auth/me', { cookie: user.cookie })).status, 401);
    assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: user.email, password } })).status, 200);
    assert.equal((await request(`/api/admin/sellers/${operator.id}/lock`, { method: 'POST', cookie: operator.cookie, body: { locked: true, version: 1, note: 'Không tự khóa tài khoản.' } })).status, 403);
  });

  test('paginates and filters admin data without exposing password or session hashes', async () => {
    const operator = await admin();
    const response = await request('/api/admin/sellers?status=all&page=1', { cookie: operator.cookie });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.items.length <= 20 && body.total >= body.items.length);
    assert.ok(!JSON.stringify(body).includes('password_hash'));
    assert.ok(!JSON.stringify(body).includes('token_hash'));
    assert.equal((await request('/api/admin/sellers?status=invalid', { cookie: operator.cookie })).status, 400);
    assert.equal((await request('/api/admin/sellers?page=-1', { cookie: operator.cookie })).status, 400);
  });
});
