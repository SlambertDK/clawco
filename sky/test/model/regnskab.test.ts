// KC-0264: the ledger: one row per call, numbers only, summed per tenant and month and per day for the owner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pgliteDatabase } from '../pglite.ts';
import { migrer } from '../../src/db/migrer.ts';
import { brugtIMaaned, dagligt, noterKald } from '../../src/model/regnskab.ts';
import { SENTINEL } from './hjaelp.ts';

const f = { input: 100, output: 20, cacheLaes: 5, cacheSkriv5m: 2, cacheSkriv1t: 1 };

async function db() {
  const d = await pgliteDatabase();
  await migrer(d);
  return d;
}

test('a call is one appended row; the month sum is per tenant and per UTC month', async () => {
  const d = await db();
  await noterKald(d, { kaldId: randomUUID(), tenant: 'hus-aaaaaaaa', tid: new Date('2026-11-03T10:00:00Z'), model: 'claude-haiku-5-5', udbyder: 'anthropic', forbrug: f, prisMikroUsd: 300 });
  await noterKald(d, { kaldId: randomUUID(), tenant: 'hus-aaaaaaaa', tid: new Date('2026-11-30T23:59:00Z'), model: 'claude-haiku-5-5', udbyder: 'anthropic', forbrug: f, prisMikroUsd: 200 });
  await noterKald(d, { kaldId: randomUUID(), tenant: 'hus-aaaaaaaa', tid: new Date('2026-10-31T23:59:00Z'), model: 'claude-haiku-5-5', udbyder: 'anthropic', forbrug: f, prisMikroUsd: 999 });
  await noterKald(d, { kaldId: randomUUID(), tenant: 'hus-bbbbbbbb', tid: new Date('2026-11-03T10:00:00Z'), model: 'claude-haiku-5-5', udbyder: 'bedrock', forbrug: f, prisMikroUsd: 7 });
  assert.equal(await brugtIMaaned(d, 'hus-aaaaaaaa', new Date('2026-11-15T00:00:00Z')), 500);
  assert.equal(await brugtIMaaned(d, 'hus-aaaaaaaa', new Date('2026-10-15T00:00:00Z')), 999);
  assert.equal(await brugtIMaaned(d, 'hus-bbbbbbbb', new Date('2026-11-15T00:00:00Z')), 7);
  assert.equal(await brugtIMaaned(d, 'hus-cccccccc', new Date('2026-11-15T00:00:00Z')), 0);
  const [r] = await d.query('SELECT * FROM model.forbrug WHERE pris_mikro_usd = 7');
  assert.equal(Number(r!['input_tokens']), 100);
  assert.equal(Number(r!['cache_skriv_1t_tokens']), 1);
  assert.equal(r!['maaned'] instanceof Date ? (r!['maaned'] as Date).toISOString().slice(0, 10) : String(r!['maaned']).slice(0, 10), '2026-11-01');
  await d.close();
});

test('the same call id twice is refused (a retry can never count a call twice)', async () => {
  const d = await db();
  const id = randomUUID();
  const r = { kaldId: id, tenant: 'hus-aaaaaaaa', tid: new Date(), model: 'claude-haiku-5-5', udbyder: 'anthropic', forbrug: f, prisMikroUsd: 1 };
  await noterKald(d, r);
  await assert.rejects(noterKald(d, r));
  await d.close();
});

test('the ledger has no column a text could go into except model and provider ids, and refuses a long one', async () => {
  const d = await db();
  const kol = await d.query<{ column_name: string; data_type: string }>("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'model' AND table_name = 'forbrug' ORDER BY column_name");
  assert.deepEqual(kol.filter((k) => k.data_type === 'text').map((k) => k.column_name).sort(), ['model', 'tenant', 'udbyder']);
  await assert.rejects(noterKald(d, { kaldId: randomUUID(), tenant: 'hus-aaaaaaaa', tid: new Date(), model: SENTINEL.repeat(10), udbyder: 'anthropic', forbrug: f, prisMikroUsd: 1 }));
  await d.close();
});

test('the owner view: calls, tokens and cost per UTC day across all tenants, oldest first', async () => {
  const d = await db();
  for (const [tid, p] of [['2026-11-01T08:00:00Z', 100], ['2026-11-01T22:00:00Z', 50], ['2026-11-03T09:00:00Z', 25]] as const) {
    await noterKald(d, { kaldId: randomUUID(), tenant: 'hus-aaaaaaaa', tid: new Date(tid), model: 'claude-haiku-5-5', udbyder: 'anthropic', forbrug: f, prisMikroUsd: p });
  }
  const dage = await dagligt(d, new Date('2026-11-01T00:00:00Z'), new Date('2026-11-04T00:00:00Z'));
  assert.deepEqual(dage, [
    { dag: '2026-11-01', kald: 2, tenanter: 1, input: 200, output: 40, cacheLaes: 10, cacheSkriv: 6, mikroUsd: 150 },
    { dag: '2026-11-03', kald: 1, tenanter: 1, input: 100, output: 20, cacheLaes: 5, cacheSkriv: 3, mikroUsd: 25 },
  ]);
  await d.close();
});
