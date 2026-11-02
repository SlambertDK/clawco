// KC-0196: the grace stages as a table. A stage is a pure function of the entitlement and the clock, so a missed
// scheduler tick or a restart can never skip or repeat one (invariant 4); the day numbers come from config/priser.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beregnFrist } from '../../src/abonnement/frist.ts';
import { INGEN, type Rettighed } from '../../src/abonnement/rettigheder.ts';
import { laesPriser } from '../../src/abonnement/priser.ts';

const priser = laesPriser();
const DAG = 86_400_000;
const FEJL = new Date('2026-11-14T10:00:00.000Z');
const dag = (n: number): Date => new Date(FEJL.getTime() + n * DAG);

const forfalden: Rettighed = {
  kilde: 'stripe', plan: 'sky-solo', status: 'forfalden', medlemmerMax: 1, proeveSlutter: '2026-11-14T10:00:00.000Z', periodeSlutter: '2026-12-14T10:00:00.000Z',
  opsiges: null, forfaldenSiden: FEJL.toISOString(), skrivebeskyttet: false, abonnement: 'sub_1',
};
const aktiv: Rettighed = { ...forfalden, status: 'aktiv', forfaldenSiden: null };
const opsagt: Rettighed = { ...INGEN, status: 'opsagt', skrivebeskyttet: true, abonnement: 'sub_1' };

test('the config puts the second mail on day 7 and read-only on day 14', () => {
  assert.equal(priser.paamindelseVedFejl, 7);
  assert.equal(priser.fristVedFejl, 14);
});

const TABEL: { navn: string; r: Rettighed; nu: Date; trin: string; mail: string | null; skrivebeskyttet: boolean }[] = [
  { navn: 'day 0: the payment failed', r: forfalden, nu: dag(0), trin: 'betaling-fejlet', mail: 'betaling-fejlet', skrivebeskyttet: false },
  { navn: 'day 6', r: forfalden, nu: dag(6), trin: 'betaling-fejlet', mail: 'betaling-fejlet', skrivebeskyttet: false },
  { navn: 'day 7: the sharper mail', r: forfalden, nu: dag(7), trin: 'betaling-paamindelse', mail: 'betaling-paamindelse', skrivebeskyttet: false },
  { navn: 'day 13', r: forfalden, nu: dag(13), trin: 'betaling-paamindelse', mail: 'betaling-paamindelse', skrivebeskyttet: false },
  // Read-only carries no mail of its own (the published terms promise no automatic stop in beta); a missed day-7 mail is still owed.
  { navn: 'day 14: read-only', r: forfalden, nu: dag(14), trin: 'skrivebeskyttet', mail: 'betaling-paamindelse', skrivebeskyttet: true },
  { navn: 'day 29', r: forfalden, nu: dag(29), trin: 'skrivebeskyttet', mail: 'betaling-paamindelse', skrivebeskyttet: true },
  // Day 30: Stripe has cancelled after its retries; still read-only, handed to the retention rules, no mail from here.
  { navn: 'day 30: Stripe cancelled', r: opsagt, nu: dag(30), trin: 'ingen', mail: null, skrivebeskyttet: true },
  { navn: 'paid on day 10', r: aktiv, nu: dag(10), trin: 'ingen', mail: null, skrivebeskyttet: false },
  { navn: 'paid on day 15, after read-only', r: aktiv, nu: dag(15), trin: 'ingen', mail: null, skrivebeskyttet: false },
];

for (const t of TABEL) {
  test(`frist: ${t.navn}`, () => {
    const f = beregnFrist(t.r, priser, t.nu);
    assert.equal(f.trin, t.trin);
    assert.equal(f.mail, t.mail);
    assert.equal(f.skrivebeskyttet, t.skrivebeskyttet);
  });
}

test('one episode per failed payment: its key and dates come from forfaldenSiden, so a new failure after recovery is a new episode', () => {
  const f = beregnFrist(forfalden, priser, dag(3));
  assert.equal(f.episode, `forfalden:${FEJL.toISOString()}`);
  assert.equal(f.siden, FEJL.toISOString());
  assert.equal(f.skrivebeskyttesVed, dag(14).toISOString());
  const igen = beregnFrist({ ...forfalden, forfaldenSiden: dag(40).toISOString() }, priser, dag(41));
  assert.notEqual(igen.episode, f.episode);
  assert.equal(igen.trin, 'betaling-fejlet');
});

test('the stage is the same whenever it is computed: a tick at 13:59 on day 14 and one an hour later agree with the clock, not with each other', () => {
  assert.equal(beregnFrist(forfalden, priser, new Date(dag(14).getTime() - 1)).trin, 'betaling-paamindelse');
  assert.equal(beregnFrist(forfalden, priser, dag(14)).trin, 'skrivebeskyttet');
});

test('a trial that ended without a card: paused, read-only at once, one mail, no multi-stage dunning', () => {
  const pause: Rettighed = { ...forfalden, status: 'pause', forfaldenSiden: null, skrivebeskyttet: true };
  for (const n of [0, 7, 14, 40]) {
    const f = beregnFrist(pause, priser, dag(n));
    assert.equal(f.trin, 'proeve-slut');
    assert.equal(f.mail, 'proeve-slut');
    assert.equal(f.skrivebeskyttet, true);
    assert.equal(f.episode, 'proeve:sub_1');
    assert.equal(f.siden, pause.proeveSlutter);
  }
});

test('nothing to say: a trial, a gift, no entitlement, an overdue row without a date', () => {
  for (const r of [{ ...forfalden, status: 'proeve' as const, forfaldenSiden: null }, { ...INGEN, kilde: 'gave' as const, plan: 'sky-solo', status: 'aktiv' as const }, { ...INGEN }, { ...forfalden, forfaldenSiden: null }]) {
    const f = beregnFrist(r, priser, dag(20));
    assert.equal(f.trin, 'ingen');
    assert.equal(f.mail, null);
    assert.equal(f.episode, null);
  }
});
