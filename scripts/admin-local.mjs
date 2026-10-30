import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--email' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args[1]) || args[1].length > 254) {
  console.error('Cách dùng: npm run admin:local -- --email email-da-dang-ky@example.com');
  process.exitCode = 1;
} else {
  const email = args[1].toLowerCase().replaceAll("'", "''");
  const file = resolve('.cache', `admin-${randomUUID()}.sql`);
  await mkdir(resolve('.cache'), { recursive: true });
  await writeFile(file, `UPDATE users SET role='admin',is_super_admin=1,version=version+1,updated_at=unixepoch() WHERE email='${email}' AND is_super_admin=0 AND is_locked=0;
SELECT count(*) AS matching_admin FROM users WHERE email='${email}' AND is_super_admin=1 AND is_locked=0;`, { mode: 0o600 });
  try {
    const code = await new Promise((done) => {
      const child = spawn('npm', ['exec', '--workspace=@timphongtro/web', '--', 'wrangler', 'd1', 'execute', 'timphongtro-local', '--local', '--config', resolve('apps/web/wrangler.jsonc'), '--file', file], { stdio: 'inherit' });
      child.on('error', () => done(1));
      child.on('exit', (status) => done(status ?? 1));
    });
    process.exitCode = code;
    if (!code) console.log('Kiểm tra matching_admin phải bằng 1. Lệnh chỉ áp dụng D1 local; không tạo tài khoản hoặc đặt mật khẩu mặc định.');
  } finally { await unlink(file).catch(() => {}); }
}
