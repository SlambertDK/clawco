// KC-0189: the state table of one tenant's health answer, the count of buckets, and the five-minute streak.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { andelSund, kunderStatus, sygeSiden, taelOp, TRAEG_MS, vurder, type Antal } from '../../../src/drift/helbred/vurder.ts';

const SHA = 'abc1234';

test('the state table: ok with the expected sha and fast is sund', () => {
  assert.equal(vurder({ ok: true, sha: SHA, ms: 40 }, SHA, false), 'sund');
});

test('slower than the threshold is traeg, never sund', () => {
  assert.equal(vurder({ ok: true, sha: SHA, ms: TRAEG_MS + 1 }, SHA, false), 'traeg');
  assert.equal(vurder({ ok: true, sha: SHA, ms: TRAEG_MS }, SHA, false), 'sund');
});

test('no answer, ok false, a wrong sha or no sha at all is syg', () => {
  assert.equal(vurder(null, SHA, false), 'syg');
  assert.equal(vurder({ ok: false, sha: null, ms: 10 }, SHA, false), 'syg');
  assert.equal(vurder({ ok: true, sha: 'def5678', ms: 10 }, SHA, false), 'syg');
  assert.equal(vurder({ ok: true, sha: null, ms: 10 }, SHA, false), 'syg');
  // An unknown expected sha cannot be confirmed: never a false sund.
  assert.equal(vurder({ ok: true, sha: SHA, ms: 10 }, null, false), 'syg');
});

test('an active rollout step is opdaterer, whatever the answer', () => {
  assert.equal(vurder(null, SHA, true), 'opdaterer');
  assert.equal(vurder({ ok: true, sha: 'def5678', ms: 10 }, SHA, true), 'opdaterer');
  assert.equal(vurder({ ok: true, sha: SHA, ms: 10 }, SHA, true), 'opdaterer');
});

const a = (o: Partial<Antal>): Antal => ({ sund: 0, traeg: 0, syg: 0, opdaterer: 0, ...o });

test('the buckets are counts; the share of healthy leaves upgrading tenants out', () => {
  assert.deepEqual(taelOp(['sund', 'sund', 'traeg', 'syg', 'opdaterer']), a({ sund: 2, traeg: 1, syg: 1, opdaterer: 1 }));
  assert.equal(andelSund(a({ sund: 3, traeg: 0, syg: 1, opdaterer: 5 })), 75);
  assert.equal(andelSund(a({ sund: 2, traeg: 0, syg: 1 })), 66.7);
  assert.equal(andelSund(a({ opdaterer: 2 })), null);
  assert.equal(andelSund(a({})), null);
});

test('the tenants component: no data is nedsat, never ok; upgrades are not outages', () => {
  assert.equal(kunderStatus(a({})), 'nedsat');
  assert.equal(kunderStatus(a({ sund: 10 })), 'ok');
  assert.equal(kunderStatus(a({ sund: 10, opdaterer: 10 })), 'ok');
  assert.equal(kunderStatus(a({ opdaterer: 3 })), 'ok');
  assert.equal(kunderStatus(a({ sund: 9, traeg: 1 })), 'nedsat');
  assert.equal(kunderStatus(a({ sund: 9, syg: 1 })), 'nedsat');
  assert.equal(kunderStatus(a({ sund: 1, syg: 1 })), 'nede');
});

test('the streak: a tenant is unhealthy since its first syg in an unbroken run; anything else ends the run', () => {
  const t = (m: number) => new Date(Date.UTC(2026, 10, 2, 10, m));
  let s = sygeSiden(new Map(), [{ slug: 'hus-aaaaaaaa', tilstand: 'syg' }, { slug: 'hus-bbbbbbbb', tilstand: 'sund' }], t(0));
  assert.deepEqual([...s], [['hus-aaaaaaaa', t(0)]]);
  s = sygeSiden(s, [{ slug: 'hus-aaaaaaaa', tilstand: 'syg' }, { slug: 'hus-bbbbbbbb', tilstand: 'syg' }], t(1));
  assert.deepEqual([...s].sort(), [['hus-aaaaaaaa', t(0)], ['hus-bbbbbbbb', t(1)]]);
  // traeg and opdaterer end the run; a tenant no longer measured (deleted) leaves the map.
  s = sygeSiden(s, [{ slug: 'hus-aaaaaaaa', tilstand: 'opdaterer' }], t(2));
  assert.deepEqual([...s], []);
});
