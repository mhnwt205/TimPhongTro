import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
// Keep tool preferences/logs writable in cloud workspaces without changing HOME.
process.env.XDG_CONFIG_HOME ??= join(root, '.cache', 'config');
process.env.WRANGLER_LOG_PATH ??= join(root, '.cache', 'logs', 'wrangler.log');
process.env.WRANGLER_SEND_METRICS ??= 'false';
process.env.ASTRO_TELEMETRY_DISABLED ??= '1';
process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= 'false';
mkdirSync(process.env.XDG_CONFIG_HOME, { recursive: true });
mkdirSync(dirname(process.env.WRANGLER_LOG_PATH), { recursive: true });

const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error('Missing tool command');
const child = spawn(command, args, { cwd: root, env: process.env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('Không khởi động được công cụ.'); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
