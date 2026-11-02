// KC-0209: the consumer-rights rules as pure functions: the two consents, the 14 days, the proportional amount
// and who is due a renewal reminder. No database, no Stripe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laesPriser } from '../../src/abonnement/priser.ts';
import {
  FELT, FRIST_DAGE, beloeb, fortrydTilladt, fristSlut, forholdsmaessig, paamindelseForfald, planPris, prisLinje, samtykkerGivet,
  type FornyelseRaekke,
} from '../../src/abonnement/forbrugerret.ts';

const DAG = 86_400_000;
const priser = laesPriser();

test('the withdrawal period is 14 days', () => {
  assert.equal(FRIST_DAGE, 14);
});

test('both consents are needed, the terms one with exactly the current version, the start one as "ja"', () => {
  const ok = { [FELT.vilkaar]: '0.1-udkast', [FELT.straks]: 'ja' };
  assert.equal(samtykkerGivet(ok, '0.1-udkast'), true);
  assert.equal(samtykkerGivet({ [FELT.vilkaar]: '0.1-udkast' }, '0.1-udkast'), false);
  assert.equal(samtykkerGivet({ [FELT.straks]: 'ja' }, '0.1-udkast'), false);
  assert.equal(samtykkerGivet({}, '0.1-udkast'), false);
  assert.equal(samtykkerGivet({ ...ok, [FELT.vilkaar]: '0.0' }, '0.1-udkast'), false, 'an old version is not consent to the current one');
  assert.equal(samtykkerGivet({ ...ok, [FELT.straks]: 'nej' }, '0.1-udkast'), false);
  assert.equal(samtykkerGivet({ ...ok, [FELT.straks]: ['ja', 'ja'] }, '0.1-udkast'), false);
  assert.equal(samtykkerGivet({ [FELT.vilkaar]: 1, [FELT.straks]: true }, '1'), false);
});

test('the price text comes from config/priser.json, with no VAT added, in both languages', () => {
  assert.equal(planPris(priser, 'sky-solo', 'maaned'), priser.planer['sky-solo']!.maanedlig.dkk);
  assert.equal(planPris(priser, 'sky-husstand', 'aar'), priser.planer['sky-husstand']!.aarlig.dkk);
  assert.equal(planPris(priser, 'findes-ikke', 'aar'), null);
  assert.equal(prisLinje(priser, 'sky-solo', 'maaned', 'da'), '79 kr. om måneden');
  assert.equal(prisLinje(priser, 'sky-solo', 'aar', 'da'), '790 kr. om året');
  assert.equal(prisLinje(priser, 'sky-husstand', 'aar', 'en'), 'DKK 1,290 per year');
  assert.equal(beloeb(6583, 'da'), '65,83 kr.');
  assert.equal(beloeb(7900, 'en'), 'DKK 79');
  for (const t of [prisLinje(priser, 'sky-solo', 'maaned', 'da'), prisLinje(priser, 'sky-solo', 'maaned', 'en')]) assert.doesNotMatch(t, /moms|vat/i);
});

test('the 14 days run until midnight in Copenhagen after the 14th day from the one the agreement began', () => {
  const start = new Date('2026-11-02T22:30:00.000Z');
  assert.equal(fristSlut(start).toISOString(), '2026-11-16T23:00:00.000Z', '17 November 00:00 in Copenhagen (winter time)');
  assert.equal(fristSlut(new Date('2026-06-02T10:00:00.000Z')).toISOString(), '2026-06-16T22:00:00.000Z', 'summer time: 17 June 00:00 is 22:00 UTC the day before');
  assert.ok(fristSlut(start).getTime() - start.getTime() >= FRIST_DAGE * DAG);
  assert.equal(fortrydTilladt(start, new Date(start.getTime() + 13 * DAG)), true);
  assert.equal(fortrydTilladt(start, new Date('2026-11-16T22:59:59.000Z')), true);
  assert.equal(fortrydTilladt(start, new Date('2026-11-16T23:00:00.000Z')), false);
  assert.equal(fortrydTilladt(start, new Date(start.getTime() - 1000)), true, 'a clock that is a little behind is not a refusal');
});

test('proportional amount: what was used is kept, the rest goes back; a started day counts as a whole day', () => {
  const start = new Date('2026-11-02T10:00:00.000Z');
  // Monthly, 30 days to 2 December. 4 days and 1 hour in → 5 days used.
  const a = forholdsmaessig({ prisOere: 7900, interval: 'maaned', startet: start, nu: new Date(start.getTime() + 4 * DAG + 3_600_000) });
  assert.deepEqual(a, { periodeDage: 30, brugteDage: 5, beholdOere: 1317, tilbageOere: 6583 });
  assert.equal(a.beholdOere + a.tilbageOere, 7900, 'every øre is accounted for');
  // The same minute: one day (the minimum), never zero.
  assert.equal(forholdsmaessig({ prisOere: 7900, interval: 'maaned', startet: start, nu: start }).brugteDage, 1);
  // Yearly: 2026-11-02 to 2027-11-02 is 365 days; the 14th day.
  const aar = forholdsmaessig({ prisOere: 79000, interval: 'aar', startet: start, nu: new Date(start.getTime() + 13 * DAG + 1000) });
  assert.equal(aar.periodeDage, 365);
  assert.equal(aar.brugteDage, 14);
  assert.equal(aar.tilbageOere, 79000 - Math.round(79000 * 14 / 365));
  // Past the period it is all used, nothing goes back.
  assert.equal(forholdsmaessig({ prisOere: 7900, interval: 'maaned', startet: start, nu: new Date(start.getTime() + 90 * DAG) }).tilbageOere, 0);
  // A month that is shorter than the start day's date (31 January): the period ends on the last day of February.
  assert.equal(forholdsmaessig({ prisOere: 7900, interval: 'maaned', startet: new Date('2027-01-31T10:00:00.000Z'), nu: new Date('2027-01-31T11:00:00.000Z') }).periodeDage, 28);
});

const raekke = (o: Partial<FornyelseRaekke> = {}): FornyelseRaekke => ({ bestillingId: 1,
  kontoId: 1, abonnement: 'sub_1', interval: 'aar', status: 'aktiv', periodeSlutter: new Date('2027-11-02T10:00:00.000Z'), opsiges: null, paamindetFor: null, ...o,
});

test('renewal reminder: due only for an active annual plan, within 14 days of the renewal, not cancelled, once per period', () => {
  const slut = new Date('2027-11-02T10:00:00.000Z');
  const foer = (dage: number) => new Date(slut.getTime() - dage * DAG);
  assert.equal(paamindelseForfald([raekke()], foer(15)).length, 0, 'too early');
  assert.equal(paamindelseForfald([raekke()], foer(14)).length, 1, 'exactly 14 days before');
  assert.equal(paamindelseForfald([raekke()], foer(1)).length, 1);
  assert.equal(paamindelseForfald([raekke()], new Date(slut.getTime() + 1)).length, 0, 'the renewal has passed');
  assert.equal(paamindelseForfald([raekke({ interval: 'maaned' })], foer(3)).length, 0, 'monthly plans get no reminder');
  assert.equal(paamindelseForfald([raekke({ status: 'proeve' })], foer(3)).length, 0);
  assert.equal(paamindelseForfald([raekke({ status: 'pause' })], foer(3)).length, 0);
  assert.equal(paamindelseForfald([raekke({ status: 'forfalden' })], foer(3)).length, 0);
  assert.equal(paamindelseForfald([raekke({ opsiges: slut })], foer(3)).length, 0, 'already cancelled: nothing renews');
  assert.equal(paamindelseForfald([raekke({ periodeSlutter: null })], foer(3)).length, 0);
  assert.equal(paamindelseForfald([raekke({ paamindetFor: slut })], foer(3)).length, 0, 'this period was already reminded');
  assert.equal(paamindelseForfald([raekke({ paamindetFor: new Date(slut.getTime() - 365 * DAG) })], foer(3)).length, 1, 'last year\'s reminder does not count');
  assert.deepEqual(paamindelseForfald([raekke({ kontoId: 1 }), raekke({ kontoId: 2, interval: 'maaned' }), raekke({ kontoId: 3 })], foer(5)).map((r) => r.kontoId), [1, 3]);
});
