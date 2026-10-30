// Read-only checks. Never print credentials or raw Cloudflare responses.
const names = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];
if (names.some((name) => !process.env[name])) {
  for (const name of names) console.log(`${name}: ${process.env[name] ? 'đã có' : 'chưa được cung cấp'}`);
  process.exitCode = 1;
} else if (!/^[a-f0-9]{32}$/i.test(process.env.CLOUDFLARE_ACCOUNT_ID)) {
  console.error('Account ID cần gồm 32 ký tự hex. Giá trị không được in ra.');
  process.exitCode = 1;
} else {
  try {
    const headers = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` };
    const account = process.env.CLOUDFLARE_ACCOUNT_ID;
    // Account tokens need not have User token verification permission.
    const checks = [
      ['account', `accounts/${account}`],
      ['workers-read', `accounts/${account}/workers/scripts`],
      ['d1-read', `accounts/${account}/d1/database?per_page=1`],
      ['r2-read', `accounts/${account}/r2/buckets?per_page=1`],
      ['turnstile-read', `accounts/${account}/challenges/widgets?per_page=1`],
      ['zones-read', `zones?account.id=${account}&per_page=1`],
    ];
    let failed = false;
    for (const [name, path] of checks) {
      try {
        const response = await fetch(`https://api.cloudflare.com/client/v4/${path}`, {
          headers, signal: AbortSignal.timeout(15000),
        });
        const body = await response.json().catch(() => null);
        const ok = response.ok && body?.success === true;
        console.log(`${name}: ${ok ? `OK (HTTP ${response.status})` : `không thành công (HTTP ${response.status})`}`);
        if (ok && name === 'zones-read' && Array.isArray(body.result) && body.result.length === 0) {
          console.log('zones: chưa thấy tên miền nào trong phạm vi token/tài khoản.');
        }
        failed ||= !ok;
      } catch {
        console.error(`${name}: lỗi kết nối. Kiểm tra quyền truy cập mạng/proxy; thông tin xác thực không được in ra.`);
        failed = true;
      }
    }
    if (!failed) console.log('Đọc Cloudflare thành công. Chưa tạo tài nguyên, chưa xác minh quyền ghi hoặc triển khai.');
    process.exitCode = failed ? 1 : 0;
  } catch {
    console.error('Không kiểm tra được Cloudflare. Kiểm tra kết nối và cấu hình môi trường; thông tin xác thực không được in ra.');
    process.exitCode = 1;
  }
}
