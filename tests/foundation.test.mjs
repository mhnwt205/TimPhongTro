import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';

const root = fileURLToPath(new URL('../', import.meta.url));
const createServer = () => createTestHarness({
  root,
  workers: [{ configPath: 'apps/api/wrangler.test.jsonc' }],
});

describe('Database readiness before migration', () => {
  const server = createServer();
  before(async () => { await server.listen(); });
  after(async () => { await server.close(); });

  test('returns 503 when the schema is missing, without leaking SQL', async () => {
    const response = await server.fetch('/api/health');
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'unavailable' });
  });
});

describe('Migrated D1 and public API', () => {
  const server = createServer();
  before(async () => {
    await server.listen();
    await server.getWorker().applyD1Migrations('DB');
    await server.getWorker().applyD1Migrations('DB');
  });
  after(async () => { await server.close(); });

  test('reads the agreed plans from D1, with no duplicate seed after rerunning migrations', async () => {
    const response = await server.fetch('/api/plans');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [
      { id: 'basic-7d', name: 'Gói 7 ngày', price_vnd: 5000, duration_days: 7, description: '', is_priority: 0 },
      { id: 'standard-30d', name: 'Gói 30 ngày', price_vnd: 10000, duration_days: 30, description: '', is_priority: 0 },
    ] });
  });

  test('reports readiness only after the migrated configuration is readable', async () => {
    const response = await server.fetch('/api/health');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', service: 'timphongtro', database: 'ready' });
  });

  test('does not advertise deactivated plans', async () => {
    const { DB } = await server.getWorker().getEnv();
    try {
      await DB.prepare('UPDATE listing_plans SET is_active = 0 WHERE id = ?').bind('basic-7d').run();
      const body = await (await server.fetch('/api/plans')).json();
      assert.deepEqual(body.items.map((plan) => plan.id), ['standard-30d']);
    } finally {
      await DB.prepare('UPDATE listing_plans SET is_active = 1 WHERE id = ?').bind('basic-7d').run();
    }
  });

  test('rejects invalid monetary and duration values at the database boundary', async () => {
    const { DB } = await server.getWorker().getEnv();
    for (const [price, duration] of [[0, 7], [-5000, 7], [1.5, 7], [5000, 0], [5000, 1.5]]) {
      await assert.rejects(DB.prepare(
        'INSERT INTO listing_plans (id, name, price_vnd, duration_days) VALUES (?, ?, ?, ?)',
      ).bind(`invalid-${price}-${duration}`, 'Invalid', price, duration).run());
    }
  });

  test('does not expose unimplemented write routes', async () => {
    const target = await server.listen();
    const response = await server.fetch('/api/topups', { method: 'POST', headers: { Origin: target.url.origin, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});
