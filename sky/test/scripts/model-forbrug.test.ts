// KC-0264: the owner's daily view of the included model's cost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { modelOversigt, oversigtTekst } from '../../scripts/model-forbrug.ts';
import { noterKald } from '../../src/model/regnskab.ts';
import { migreretDb } from '../hemmeligheder/hjaelp.ts';

test('per day and the month so far, in USD, naming no tenant', async () => {
  const db = await migreretDb();
  const f = { input: 20_000, output: 1_000, cacheLaes: 50_000, cacheSkriv5m: 0, cacheSkriv1t: 0 };
  for (const [t, tid, p] of [['hus-aaaaaaaa', '2026-10-31T12:00:00Z', 9_000_000], ['hus-aaaaaaaa', '2026-11-01T08:00:00Z', 250_000], ['hus-bbbbbbbb', '2026-11-01T09:00:00Z', 250_000], ['hus-aaaaaaaa', '2026-11-03T09:00:00Z', 10_000]] as const) {
    await noterKald(db, { kaldId: randomUUID(), tenant: t, tid: new Date(tid), model: 'claude-haiku-5-5', udbyder: 'anthropic', forbrug: f, prisMikroUsd: p });
  }
  const o = await modelOversigt(db, new Date('2026-11-03T15:00:00Z'), 7);
  assert.deepEqual(o.dage.map((d) => [d.dag, d.kald, d.tenanter, d.mikroUsd]), [['2026-10-31', 1, 1, 9_000_000], ['2026-11-01', 2, 2, 500_000], ['2026-11-03', 1, 1, 10_000]]);
  assert.deepEqual(o.maaned, { fra: '2026-11-01', kald: 3, mikroUsd: 510_000 });
  const tekst = oversigtTekst(o).join('\n');
  assert.match(tekst, /2026-11-01: 2 kald fra 2 husstande, 0,50 \$/);
  assert.match(tekst, /Måneden fra 2026-11-01: 3 kald, 0,51 \$/);
  assert.ok(!/hus-/.test(tekst));
  await db.close();
});
