// KC-0194, gate G6: the revenue watch. Henrik is not VAT-registered; the control plane sums the paid invoices of the
// trailing 12 months (in kroner, euro at the config's rate) and hands the total to the alert rules (drift/alarm.ts,
// rule moms-graense), which raise "Momsregistrering nærmer sig" at moms.varselOere (40,000 kr). Stripe is read at most
// once per interval; a failed read is an unknown signal (the rule neither fires nor clears), never a crash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laesPriser, type Priser } from '../../src/abonnement/priser.ts';
import { FalskBetalingsKlient } from '../../src/abonnement/falsk.ts';
import { omsaetning12, omsaetningsVagt } from '../../src/abonnement/omsaetning.ts';
import { alarmer } from '../../src/drift/alarm.ts';
import { falskPost } from '../../src/delt/post.ts';
import { lavFejlrapport } from '../../src/delt/fejlrapport-kerne.ts';

const priser = laesPriser();
const NU = new Date('2026-11-02T10:00:00.000Z');
const DAG = 86_400_000;
const foer = (dage: number) => new Date(NU.getTime() - dage * DAG);

function faktura(k: FalskBetalingsKlient, i: number, beloeb: number, valuta: string, betalt: Date, status = 'paid'): void {
  k.tilfoejFaktura({ id: `in_${i}`, nummer: null, oprettet: betalt, beloeb, valuta, status, url: null, kunde: `cus_${i}`, betalt });
}

test('the 12-month sum: kroner as they are, euro at the config rate, other currencies counted apart', () => {
  const s = omsaetning12([{ beloeb: 7900, valuta: 'dkk', betalt: foer(1) }, { beloeb: 1060, valuta: 'eur', betalt: foer(2) }, { beloeb: 999, valuta: 'usd', betalt: foer(3) }], priser);
  assert.equal(s.oere, 7900 + Math.round(1060 * 7.46));
  assert.equal(s.andreValutaer, 1);
  assert.equal(s.graenseOere, 4_000_000);
});

test('only paid invoices from the last 12 months count', async () => {
  const k = new FalskBetalingsKlient('test');
  faktura(k, 1, 3_000_000, 'dkk', foer(364));
  faktura(k, 2, 1_500_000, 'dkk', foer(366));
  faktura(k, 3, 2_000_000, 'dkk', foer(10), 'open');
  faktura(k, 4, 1_000_000, 'dkk', foer(1));
  const vagt = omsaetningsVagt({ klient: k, priser, log: () => {} });
  assert.deepEqual(await vagt(NU), { oere: 4_000_000, graenseOere: 4_000_000, andreValutaer: 0 });
});

test('the watch fires at the threshold and not below it, through the real alert rules', async () => {
  const post = falskPost();
  const a = alarmer({ post, til: 'drift@example.com', rapport: lavFejlrapport({ transport: async () => {}, release: 'x' }), log: () => {} });
  const k = new FalskBetalingsKlient('test');
  faktura(k, 1, 3_999_999, 'dkk', foer(30));
  let t = NU;
  const vagt = omsaetningsVagt({ klient: k, priser, interval: 0, log: () => {} });
  assert.deepEqual(await a.vurder({ omsaetning: (await vagt(t))! }, t), []);
  faktura(k, 2, 1, 'dkk', foer(1));
  t = new Date(NU.getTime() + 1000);
  const fyret = await a.vurder({ omsaetning: (await vagt(t))! }, t);
  assert.deepEqual(fyret.map((x) => x.regel), ['moms-graense']);
  assert.equal(post.udbakke[0]?.data['titel'], 'Momsregistrering nærmer sig');
});

test('Stripe is read at most once per interval; a failed read is an unknown signal, reported, never thrown', async () => {
  const k = new FalskBetalingsKlient('test');
  faktura(k, 1, 7900, 'dkk', foer(5));
  const log: string[] = [];
  const vagt = omsaetningsVagt({ klient: k, priser, interval: 6 * 3_600_000, log: (l) => log.push(l) });
  assert.equal((await vagt(NU))?.oere, 7900);
  faktura(k, 2, 7900, 'dkk', foer(1));
  assert.equal((await vagt(new Date(NU.getTime() + 3_600_000)))?.oere, 7900, 'cached within the interval');
  assert.equal((await vagt(new Date(NU.getTime() + 7 * 3_600_000)))?.oere, 15800, 'read again after it');
  k.fejlNaeste('listBetalteFakturaer', 'netværksfejl rk_test_SENTINEL123'); // gitleaks:allow (a fake key in a test)
  assert.equal(await vagt(new Date(NU.getTime() + 14 * 3_600_000)), undefined);
  assert.ok(log.some((l) => l.includes('omsætning')));
  assert.ok(!log.join('\n').includes('SENTINEL'), 'a key in an error text is masked');
});

test('no watch once VAT is on (the registration has happened), and none without a Stripe client', async () => {
  const k = new FalskBetalingsKlient('test');
  faktura(k, 1, 9_000_000, 'dkk', foer(5));
  const med: Priser = { ...priser, moms: { ...priser.moms, aktiv: true } };
  assert.equal(await omsaetningsVagt({ klient: k, priser: med, log: () => {} })(NU), undefined);
  assert.equal(await omsaetningsVagt({ klient: null, priser, log: () => {} })(NU), undefined);
});
