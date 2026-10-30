import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const mode = process.argv[2];
const allowed = ['build', 'migrate', 'deploy', 'dry-run'];
if (!allowed.includes(mode)) throw new Error('Chọn build, migrate, deploy hoặc dry-run.');

const configPath = resolve('apps/web/wrangler.production.jsonc');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const expectedDatabase = '53bbfe5b-25d6-419a-b89e-f450d795027c';
const expectedDomains = ['trotothcm.id.vn', 'www.trotothcm.id.vn'];
if (config.name !== 'timphongtro' || config.d1_databases?.length !== 1 || config.d1_databases[0].database_id !== expectedDatabase
    || config.d1_databases[0].database_name !== 'timphongtro-db'
    || JSON.stringify(config.routes?.filter((route) => route.custom_domain === true).map((route) => route.pattern).sort()) !== JSON.stringify(expectedDomains)) throw new Error('Sai đích Worker/D1/domain production. Dừng để kiểm tra.');

async function run(args, env = {}) {
  const code = await new Promise((resolveStatus) => {
    const child = spawn('npm', args, { stdio: 'inherit', env: { ...process.env, ...env } });
    child.on('error', () => resolveStatus(1));
    child.on('exit', (status) => resolveStatus(status ?? 1));
  });
  if (code) process.exit(code);
}

if (mode === 'migrate') {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error('Thiếu thông tin Cloudflare trong môi trường.');
  await run(['exec', '--workspace=@timphongtro/web', '--', 'wrangler', 'd1', 'migrations', 'apply', 'timphongtro-db', '--remote', '--config', configPath]);
} else {
  await run(['run', 'build', '--workspace=@timphongtro/web'], { TPT_DEPLOY_ENV: 'production' });
  const builtPath = resolve('apps/web/dist/server/wrangler.json');
  const built = JSON.parse(await readFile(builtPath, 'utf8'));
  const builtVars = built.vars ?? {};
  if (built.name !== config.name || built.d1_databases?.[0]?.database_id !== expectedDatabase
      || JSON.stringify(built.routes?.filter((route) => route.custom_domain === true).map((route) => route.pattern).sort()) !== JSON.stringify(expectedDomains)
      || built.kv_namespaces?.length || built.r2_buckets?.length !== 1 || built.r2_buckets[0].binding !== 'LISTING_IMAGES' || built.r2_buckets[0].bucket_name !== 'timphongtro-images' || built.images
      || Object.keys(builtVars).length !== 1 || builtVars.EMAIL_VERIFICATION_REQUIRED !== 'true') {
    throw new Error('Build sinh ra sai binding hoặc thêm dịch vụ ngoài phạm vi. Dừng triển khai.');
  }
  if (mode !== 'build') {
    await run(['exec', '--workspace=@timphongtro/web', '--', 'wrangler', 'deploy', '--config', builtPath, '--keep-vars', ...(mode === 'dry-run' ? ['--dry-run'] : [])]);
  }
}
