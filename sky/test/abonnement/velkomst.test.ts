// KC-0200: which welcome mails an account is owed is a pure function of the clock, the account (when its Clawco became
// klar, whether it is deleted, whether it wants tips), the entitlement (KC-0192) and what was already sent. The table
// walks one trial through its days and the ways it can end early.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hvilkeMailsSkalUd, VELKOMST_MAILS, type VelkomstKonto, type VelkomstMail } from '../../src/abonnement/velkomst.ts';
import { INGEN, type Rettighed } from '../../src/abonnement/rettigheder.ts';

const DAG = 86_400_000;
const START = new Date('2026-11-02T09:00:00.000Z');
const dag = (n: number, timer = 0): Date => new Date(START.getTime() + n * DAG + timer * 3_600_000);

/** The Clawco became klar a few minutes after the trial started. */
const KONTO: VelkomstKonto = { klarVed: new Date(START.getTime() + 2 * 60_000), slettet: false, tips: true };
const PROEVE: Rettighed = {
  ...INGEN, kilde: 'stripe', plan: 'sky-solo', status: 'proeve', medlemmerMax: 1,
  proeveSlutter: dag(14).toISOString(), periodeSlutter: dag(14).toISOString(), abonnement: 'sub_test_1',
};
const AKTIV: Rettighed = { ...PROEVE, status: 'aktiv', proeveSlutter: dag(5).toISOString() };
const OPSAGT_I_PROEVE: Rettighed = { ...PROEVE, opsiges: dag(14).toISOString() };
const OPSAGT: Rettighed = { ...INGEN, status: 'opsagt', skrivebeskyttet: true, abonnement: 'sub_test_1' };
const PAUSE: Rettighed = { ...PROEVE, status: 'pause', skrivebeskyttet: true };
const GAVE: Rettighed = { ...INGEN, kilde: 'gave', plan: 'sky-solo', status: 'aktiv', medlemmerMax: 1 };

const ingen = new Set<VelkomstMail>();
const sendt = (...m: VelkomstMail[]) => new Set<VelkomstMail>(m);

type Raekke = { navn: string; nu: Date; konto?: Partial<VelkomstKonto>; r?: Rettighed; udsendte?: Set<VelkomstMail>; forvent: VelkomstMail[] };

const TABEL: Raekke[] = [
  { navn: 'before the Clawco is klar: nothing (the welcome never promises what is not there)', nu: dag(0), konto: { klarVed: null }, forvent: [] },
  { navn: 'day 0, klar: the welcome', nu: dag(0, 1), forvent: ['velkomst'] },
  { navn: 'day 0, welcome already sent: nothing', nu: dag(0, 1), udsendte: sendt('velkomst'), forvent: [] },
  { navn: 'day 1: still owed the welcome if a tick was missed', nu: dag(1), forvent: ['velkomst'] },
  { navn: 'day 2 and later: a welcome that was never sent is not sent late', nu: dag(2, 1), udsendte: ingen, forvent: [] },
  { navn: 'day 2: nothing new', nu: dag(2), udsendte: sendt('velkomst'), forvent: [] },
  { navn: 'day 3: the tips mail', nu: dag(3, 1), udsendte: sendt('velkomst'), forvent: ['kom-i-gang'] },
  { navn: 'day 3, tips already sent: nothing', nu: dag(3, 2), udsendte: sendt('velkomst', 'kom-i-gang'), forvent: [] },
  { navn: 'day 4: a missed day-3 tick still sends it', nu: dag(4), udsendte: sendt('velkomst'), forvent: ['kom-i-gang'] },
  { navn: 'day 5 and later: a tips mail is never sent late', nu: dag(5, 1), udsendte: sendt('velkomst'), forvent: [] },
  { navn: 'day 11: nothing', nu: dag(11), udsendte: sendt('velkomst', 'kom-i-gang'), forvent: [] },
  { navn: 'day 12: the trial ends in two days', nu: dag(12), udsendte: sendt('velkomst', 'kom-i-gang'), forvent: ['proeve-slutter'] },
  { navn: 'day 13: a missed day-12 tick still sends it', nu: dag(13), udsendte: sendt('velkomst', 'kom-i-gang'), forvent: ['proeve-slutter'] },
  { navn: 'day 13, already sent: nothing', nu: dag(13), udsendte: sendt('velkomst', 'kom-i-gang', 'proeve-slutter'), forvent: [] },
  { navn: 'day 14, the trial has ended: nothing (KC-0196 writes from here)', nu: dag(14, 1), udsendte: sendt('velkomst', 'kom-i-gang'), forvent: [] },
  { navn: 'the day-12 mail does not need the Clawco to be klar', nu: dag(12), konto: { klarVed: null }, forvent: ['proeve-slutter'] },
  { navn: 'converted to paid on day 5: no day-12 mail', nu: dag(12), r: AKTIV, udsendte: sendt('velkomst', 'kom-i-gang'), forvent: [] },
  { navn: 'cancelled on day 2 (cancel at trial end): no tips mail', nu: dag(3, 1), r: OPSAGT_I_PROEVE, udsendte: sendt('velkomst'), forvent: [] },
  { navn: 'cancelled on day 2 (cancel at trial end): no day-12 mail', nu: dag(12), r: OPSAGT_I_PROEVE, udsendte: sendt('velkomst'), forvent: [] },
  { navn: 'cancelled outright: no welcome either', nu: dag(0, 1), r: OPSAGT, forvent: [] },
  { navn: 'cancelled outright: no tips mail', nu: dag(3, 1), r: OPSAGT, udsendte: sendt('velkomst'), forvent: [] },
  { navn: 'paused: nothing', nu: dag(3, 1), r: PAUSE, udsendte: sendt('velkomst'), forvent: [] },
  { navn: 'deleted: nothing, ever', nu: dag(0, 1), konto: { slettet: true }, forvent: [] },
  { navn: 'deleted on day 12: nothing', nu: dag(12), konto: { slettet: true }, udsendte: sendt('velkomst', 'kom-i-gang'), forvent: [] },
  { navn: 'no entitlement at all: nothing', nu: dag(0, 1), r: INGEN, forvent: [] },
  { navn: 'gift (beta): the welcome', nu: dag(0, 1), r: GAVE, forvent: ['velkomst'] },
  { navn: 'gift (beta): no tips mail (it is for the trial)', nu: dag(3, 1), r: GAVE, udsendte: sendt('velkomst'), forvent: [] },
  { navn: 'gift (beta): no trial-ending mail', nu: dag(12), r: { ...GAVE, proeveSlutter: dag(14).toISOString() }, udsendte: sendt('velkomst'), forvent: [] },
  { navn: 'paying from the start: the welcome', nu: dag(0, 1), r: { ...AKTIV, proeveSlutter: null }, forvent: ['velkomst'] },
  { navn: 'paying from the start: no tips mail', nu: dag(3, 1), r: { ...AKTIV, proeveSlutter: null }, udsendte: sendt('velkomst'), forvent: [] },
  { navn: 'unsubscribed from tips: no tips mail', nu: dag(3, 1), konto: { tips: false }, udsendte: sendt('velkomst'), forvent: [] },
  { navn: 'unsubscribed from tips: the welcome still comes (a service message)', nu: dag(0, 1), konto: { tips: false }, forvent: ['velkomst'] },
  { navn: 'unsubscribed from tips: the trial-ending mail still comes (a service message)', nu: dag(12), konto: { tips: false }, udsendte: sendt('velkomst'), forvent: ['proeve-slutter'] },
  { navn: 'klar late (day 1): the welcome, and the tips mail counts from klar', nu: dag(4, 1), konto: { klarVed: dag(1) }, udsendte: sendt('velkomst'), forvent: ['kom-i-gang'] },
  { navn: 'klar on day 12: welcome and trial-ending in one pass, in that order', nu: dag(12, 1), konto: { klarVed: dag(12) }, forvent: ['velkomst', 'proeve-slutter'] },
];

for (const r of TABEL) {
  test(`hvilkeMailsSkalUd: ${r.navn}`, () => {
    const konto = { ...KONTO, ...r.konto };
    assert.deepEqual(hvilkeMailsSkalUd(r.nu, konto, r.r ?? PROEVE, r.udsendte ?? ingen), r.forvent);
  });
}

test('hvilkeMailsSkalUd is pure: same input, same answer, and the inputs are untouched', () => {
  const udsendte = sendt('velkomst');
  const konto = { ...KONTO };
  const r = { ...PROEVE };
  const a = hvilkeMailsSkalUd(dag(3, 1), konto, r, udsendte);
  const b = hvilkeMailsSkalUd(dag(3, 1), konto, r, udsendte);
  assert.deepEqual(a, b);
  assert.deepEqual([...udsendte], ['velkomst']);
  assert.deepEqual(konto, KONTO);
  assert.deepEqual(r, PROEVE);
});

test('the three mails, in the order a trial meets them', () => {
  assert.deepEqual([...VELKOMST_MAILS], ['velkomst', 'kom-i-gang', 'proeve-slutter']);
});
