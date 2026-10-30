import { scrypt, timingSafeEqual } from 'node:crypto';

// OWASP scrypt profile: 32 MiB, three passes. Never weaken to fit a CPU quota.
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const hex = (value: Uint8Array) => Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
const bytes = (value: string) => Uint8Array.from(value.match(/../g) ?? [], (pair) => parseInt(pair, 16));
const derive = (password: string, salt: Uint8Array) => new Promise<Uint8Array>((resolve, reject) => {
  scrypt(password, salt, 32, options, (error, result) => error ? reject(error) : resolve(new Uint8Array(result)));
});

export const DUMMY_HASH = `scrypt$32768$8$3$${'00'.repeat(16)}$${'00'.repeat(32)}`;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `scrypt$32768$8$3$${hex(salt)}$${hex(await derive(password, salt))}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const match = /^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(encoded);
  if (!match) return false;
  return timingSafeEqual(await derive(password, bytes(match[1])), bytes(match[2]));
}
