import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createTestHarness } from 'wrangler';
import { emailShell, escapeHtml } from '../apps/api/src/email.ts';

const server = createTestHarness({ root: fileURLToPath(new URL('../', import.meta.url)), workers: [{ configPath: 'tests/wrangler.email.jsonc' }] });
let origin, DB, sequence = 0;
const password = 'MotMatKhau-an-toan-2026';
const request = (path, { method, body, cookie, headers = {}, form = false } = {}) => server.fetch(new URL(path, origin), {
  method: method ?? (body === undefined ? 'GET' : 'POST'),
  redirect: 'manual',
  headers: { ...((method ?? (body === undefined ? 'GET' : 'POST')) === 'GET' ? {} : { Origin: origin, 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' }), 'CF-Connecting-IP': `198.51.100.${++sequence % 240 + 1}`, ...(cookie ? { Cookie: cookie } : {}), ...headers },
  ...(body !== undefined ? { body: form ? new URLSearchParams(body).toString() : JSON.stringify(body) } : {}),
});
const hash = token => createHash('sha256').update(token).digest('hex');
const cookieOf = response => response.headers.get('set-cookie')?.split(';')[0];
async function register(email = `email-${++sequence}@example.test`, { verify = true } = {}) {
  const response = await request('/api/auth/register', { method: 'POST', body: { name: 'Người đăng thử', email, password, password_confirmation: password } });
  assert.equal(response.status, 201, await response.clone().text());
  assert.equal(cookieOf(response), undefined, 'unverified registration must not create a login session');
  const row=await DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
  assert.ok(row?.id);
  const user={id:row.id,email,cookie:undefined};
  if(verify){
    const token=randomBytes(32).toString('hex');
    await DB.prepare("INSERT INTO account_email_tokens(token_hash,user_id,purpose,expires_at) VALUES(?,?,'verify_email',unixepoch()+3600)").bind(hash(token),user.id).run();
    const confirmed=await request('/api/auth/email-verification/confirm',{body:{token}});
    assert.equal(confirmed.status,200,await confirmed.clone().text());
    const login=await request('/api/auth/login',{body:{email,password}});
    assert.equal(login.status,200,await login.clone().text());
    user.cookie=cookieOf(login);
  }
  return user;
}

before(async () => {
  origin = (await server.listen()).url.origin;
  await server.getWorker().applyD1Migrations('DB');
  ({ DB } = await server.getWorker().getEnv());
});
after(async () => { await server.close(); });

test('new registrations cannot log in until a one-time email confirmation', async () => {
  const user = await register(undefined, {verify:false});
  const row = await DB.prepare('SELECT email_verified_at FROM users WHERE id=?').bind(user.id).first();
  assert.equal(row.email_verified_at, null);
  assert.equal((await DB.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').bind(user.id).first()).n,0);
  assert.equal((await request('/api/auth/me')).status,401);
  const blockedLogin=await request('/api/auth/login',{body:{email:user.email,password}});
  assert.equal(blockedLogin.status,403);
  assert.match((await blockedLogin.json()).error,/chưa được xác minh/i);
  assert.equal(cookieOf(blockedLogin),undefined);
  assert.equal((await request('/api/account/listings',{body:{submit:true}})).status,401);

  const oldToken = randomBytes(32).toString('hex');
  await DB.prepare("INSERT INTO account_email_tokens(token_hash,user_id,purpose,expires_at) VALUES(?,?,'verify_email',unixepoch()+3600)").bind(hash(oldToken), user.id).run();
  const resend=await request('/api/auth/email-verification/request',{body:{email:user.email}});
  assert.equal(resend.status,202);
  const generic={message:'Nếu tài khoản cần xác minh, hướng dẫn sẽ được gửi đến địa chỉ email đã nhập.'};
  assert.deepEqual(await resend.json(),generic);
  assert.equal((await DB.prepare('SELECT consumed_reason FROM account_email_tokens WHERE token_hash=?').bind(hash(oldToken)).first()).consumed_reason, 'superseded');
  const unknown=await request('/api/auth/email-verification/request',{body:{email:'missing-verify@example.test'}});
  assert.equal(unknown.status,202);assert.deepEqual(await unknown.json(),generic);
  const formEmail=`form-${++sequence}@example.test`;
  const formResponse=await request('/api/auth/register',{method:'POST',form:true,body:{name:'Form User',email:formEmail,password,password_confirmation:password}});
  assert.equal(formResponse.status,303);assert.equal(formResponse.headers.get('location'),'/xac-minh-email?sent=1');assert.equal(cookieOf(formResponse),undefined);
  assert.equal((await DB.prepare('SELECT count(*) AS n FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.email=?').bind(formEmail).first()).n,0);
  assert.equal((await DB.prepare("SELECT count(*) AS n FROM user_notifications WHERE user_id=? AND title='Email đã được xác minh'").bind(user.id).first()).n, 0);
  const token = randomBytes(32).toString('hex');
  await DB.prepare("INSERT INTO account_email_tokens(token_hash,user_id,purpose,expires_at) VALUES(?,?,'verify_email',unixepoch()+3600)").bind(hash(token), user.id).run();
  assert.equal((await request('/api/auth/email-verification/confirm', { body: { token } })).status, 200);
  assert.equal((await request('/api/auth/email-verification/confirm', { body: { token } })).status, 400);
  assert.ok((await DB.prepare('SELECT email_verified_at FROM users WHERE id=?').bind(user.id).first()).email_verified_at);
  assert.equal((await request('/api/auth/me')).status,401,'verification must not implicitly log the user in');
  const login=await request('/api/auth/login',{body:{email:user.email,password}});assert.equal(login.status,200);user.cookie=cookieOf(login);
  assert.equal((await (await request('/api/auth/me', { cookie: user.cookie })).json()).user.email_verified, true);
  const notices = await request('/api/account/notifications', { cookie: user.cookie });
  assert.equal(notices.status, 200);
  assert.equal((await notices.json()).items[0].title, 'Email đã được xác minh');
});

test('password reset is non-enumerating, one-time, expires, and revokes every session', async () => {
  const user = await register();
  const oldToken = randomBytes(32).toString('hex');
  await DB.prepare("INSERT INTO account_email_tokens(token_hash,user_id,purpose,expires_at) VALUES(?,?,'password_reset',unixepoch()+3600)").bind(hash(oldToken), user.id).run();
  for (const email of [user.email, 'missing@example.test']) {
    const response = await request('/api/auth/password-reset/request', { body: { email } });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { message: 'Nếu tài khoản phù hợp, bạn sẽ nhận được email hướng dẫn đặt lại mật khẩu.' });
  }
  assert.equal((await DB.prepare('SELECT consumed_reason FROM account_email_tokens WHERE token_hash=?').bind(hash(oldToken)).first()).consumed_reason, 'superseded');
  assert.equal((await DB.prepare("SELECT count(*) AS n FROM user_notifications WHERE user_id=? AND title='Mật khẩu đã được cập nhật'").bind(user.id).first()).n, 0);
  const secondToken = randomBytes(32).toString('hex');
  await DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,unixepoch()+3600)").bind(hash(randomBytes(32).toString('hex')), user.id).run();
  await DB.prepare("INSERT INTO account_email_tokens(token_hash,user_id,purpose,expires_at) VALUES(?,?,'password_reset',unixepoch()+3600)").bind(hash(secondToken), user.id).run();
  const replacement = 'MatKhau-moi-an-toan-2026';
  const reset = await request('/api/auth/password-reset/complete', { body: { token: secondToken, password: replacement, password_confirmation: replacement } });
  assert.equal(reset.status, 200, await reset.clone().text());
  assert.equal((await request('/api/auth/password-reset/complete', { body: { token: secondToken, password: replacement, password_confirmation: replacement } })).status, 400);
  assert.equal((await request('/api/auth/me', { cookie: user.cookie })).status, 401);
  assert.equal((await DB.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').bind(user.id).first()).n, 0);
  assert.equal((await DB.prepare("SELECT count(*) AS n FROM user_notifications WHERE user_id=? AND kind='security' AND title='Mật khẩu đã được cập nhật'").bind(user.id).first()).n, 1);
  assert.equal((await request('/api/auth/login', { body: { email: user.email, password: replacement } })).status, 200);
  assert.equal((await request('/api/account/notifications', { cookie: user.cookie })).status, 401);
  const stale = randomBytes(32).toString('hex');
  await DB.prepare("INSERT INTO account_email_tokens(token_hash,user_id,purpose,created_at,expires_at) VALUES(?,?,'password_reset',unixepoch()-7200,unixepoch()-1)").bind(hash(stale), user.id).run();
  assert.equal((await request('/api/auth/password-reset/complete', { body: { token: stale, password: replacement, password_confirmation: replacement } })).status, 400);
});

test('notifications are scoped to the signed-in account and read state cannot be used cross-account', async () => {
  const first = await register(), second = await register();
  const noticeId = randomUUID();
  await DB.prepare("INSERT INTO user_notifications(id,user_id,event_key,kind,title,body,href) VALUES(?,?,'fixture-notice','security','Thông báo thử','Nội dung thử','/tai-khoan/ho-so')").bind(noticeId, first.id).run();
  const otherNotices=(await (await request('/api/account/notifications', { cookie: second.cookie })).json()).items;
  assert.ok(!otherNotices.some(item=>item.id===noticeId));
  assert.equal((await request(`/api/account/notifications/${noticeId}/read`, { cookie: second.cookie, body: {} })).status, 404);
  assert.equal((await request(`/api/account/notifications/${noticeId}/read`, { cookie: first.cookie, body: {} })).status, 200);
  assert.ok((await DB.prepare('SELECT read_at FROM user_notifications WHERE id=?').bind(noticeId).first()).read_at);
});

test('existing accounts are marked verified by the migration and email templates escape untrusted text', async () => {
  const id = randomUUID();
  await DB.prepare('INSERT INTO users(id,email,name,password_hash) VALUES(?,?,?,?)').bind(id, id + '@example.test', 'Tài khoản cũ', 'legacy').run();
  const migration = await readFile(new URL('../apps/api/migrations/0015_account_email_notifications.sql', import.meta.url), 'utf8');
  const backfill = migration.match(/UPDATE users SET email_verified_at=created_at WHERE email_verified_at IS NULL;/)?.[0];
  assert.ok(backfill);
  await DB.exec(backfill);
  assert.ok((await DB.prepare('SELECT email_verified_at FROM users WHERE id=?').bind(id).first()).email_verified_at);
  assert.equal(escapeHtml('<script>&"\''), '&lt;script&gt;&amp;&quot;&#39;');
  const html = emailShell('<Tin xấu>', ['Nội dung & thử'], 'https://workers.dev/x?a="x"', 'Tiếp tục');
  assert.match(html,/TRỌ TỐT TP\.HCM/);
  assert.ok(!html.includes('<h1><Tin xấu></h1>'));
  assert.match(html, /Nội dung &amp; thử/);
});
