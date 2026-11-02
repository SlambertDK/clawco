// KC-0191: one Stripe customer per account; and the billing half of "delete my account" — konto
// emits konto.slettet, abonnement cancels the account's live subscriptions (nothing is deleted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stativ, startProeve, fangLog, EMAIL } from './stativ.ts';
import { hentKundeRaekke, sikrKunde, opsigVedSletning, kontoensCheckout } from '../../src/abonnement/kunde.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { haendelser } from '../../src/delt/haendelser.ts';

const vent = () => new Promise((r) => setTimeout(r, 20));

test('sikrKunde makes one customer per account and keeps the latest country', async () => {
  const s = await stativ();
  const foer = s.klient.kald.length;
  const k = await sikrKunde(s.db, s.klient, { kontoId: s.kontoId, email: EMAIL, sprog: 'da', land: 'SE', nu: s.u.nu() });
  assert.equal(k.stripeKunde, s.kunde);
  assert.equal(k.land, 'SE');
  assert.equal((await hentKundeRaekke(s.db, s.kontoId))?.land, 'SE');
  assert.equal(s.klient.kald.length, foer, 'ingen ny kunde i Stripe');
});

test('konto.slettet cancels the account\'s live subscriptions; an account without a customer is left alone', async () => {
  const s = await stativ();
  await startProeve(s);
  const h = haendelser();
  const stop = opsigVedSletning(h, { db: s.db, klient: s.klient });
  const { log } = await fangLog(async () => {
    h.udsend({ navn: 'konto.slettet', kontoId: s.kontoId, tidspunkt: s.u.nu().toISOString() });
    h.udsend({ navn: 'konto.slettet', kontoId: 9999, tidspunkt: s.u.nu().toISOString() });
    await vent();
  });
  assert.deepEqual((await s.klient.listAbonnementer(s.kunde)).map((a) => a.status), ['canceled']);
  assert.match(log, /opsagt/);
  assert.ok(!log.includes(EMAIL));
  stop();
});

test('konto.slettet without a configured Stripe client is logged loudly, never silently ignored', async () => {
  const s = await stativ();
  const h = haendelser();
  opsigVedSletning(h, { db: s.db, klient: null });
  const { log } = await fangLog(async () => {
    h.udsend({ navn: 'konto.slettet', kontoId: s.kontoId, tidspunkt: s.u.nu().toISOString() });
    await vent();
  });
  assert.match(log, /ikke opsagt/);
});

test('KC-0198: kontoensCheckout returns a session only when it is this account\'s (customer row and reference)', async () => {
  const s = await stativ();
  const pris = await s.klient.prisForLookupKey('clawco-sky-solo-maaned');
  const egen = await s.klient.opretCheckout({ mode: 'subscription', customer: s.kunde, client_reference_id: String(s.kontoId), metadata: { konto_id: String(s.kontoId) }, line_items: [{ price: pris!.id, quantity: 1 }], success_url: 'https://x.test/s' }, 'egen');
  assert.equal((await kontoensCheckout(s.db, s.klient, s.kontoId, egen.id))?.id, egen.id);
  const { konto: anden } = await findEllerOpretKonto(s.db, 'anden@example.test', s.u.nu());
  assert.equal(await kontoensCheckout(s.db, s.klient, anden.id, egen.id), null, 'another account (no customer row)');
  assert.equal(await kontoensCheckout(s.db, s.klient, s.kontoId, 'cs_findes_ikke'), null);
});

test('KC-0206: the fake lists a customer\'s invoices only (what Hent alt shows)', async () => {
  const { FalskBetalingsKlient } = await import('../../src/abonnement/falsk.ts');
  const k = new FalskBetalingsKlient('test');
  k.tilfoejFaktura({ id: 'in_1', kunde: 'cus_a', nummer: 'A-1', oprettet: new Date('2026-10-01T00:00:00Z'), beloeb: 7900, valuta: 'dkk', status: 'paid', url: null });
  k.tilfoejFaktura({ id: 'in_2', kunde: 'cus_b', nummer: 'B-1', oprettet: new Date('2026-10-01T00:00:00Z'), beloeb: 7900, valuta: 'dkk', status: 'paid', url: null });
  assert.deepEqual((await k.listFakturaer('cus_a')).map((f) => f.nummer), ['A-1']);
  assert.ok(!('kunde' in (await k.listFakturaer('cus_a'))[0]!));
});

test('KC-0206: billing\'s part of Hent alt — the customer, the plan, its history and the invoices; nothing without a customer', async () => {
  const { abonnementEksport } = await import('../../src/abonnement/eksport.ts');
  const { synkKunde } = await import('../../src/abonnement/synk.ts');
  const s = await stativ();
  await startProeve(s);
  await synkKunde(s.db, s.klient, s.priser, { stripeKunde: s.kunde, kontoId: s.kontoId, grund: 'test', haendelseId: null, nu: s.u.nu() });
  s.klient.tilfoejFaktura({ id: 'in_1', kunde: s.kunde, nummer: 'A-1', oprettet: new Date('2026-10-01T00:00:00Z'), beloeb: 7900, valuta: 'dkk', status: 'paid', url: null });
  const e = await abonnementEksport({ db: s.db, klient: s.klient, priser: s.priser }, s.kontoId, s.u.nu()) as Record<string, unknown>;
  assert.equal((e['kunde'] as Record<string, unknown>)['land'], 'DK');
  assert.equal((e['plan'] as Record<string, unknown>)['status'], 'proeve');
  assert.ok((e['historik'] as unknown[]).length >= 1);
  assert.deepEqual((e['fakturaer'] as { nummer: string }[]).map((f) => f.nummer), ['A-1']);
  // Stripe unreachable: an error, never an export that silently lacks the invoices.
  s.klient.fejlNaeste('listFakturaer', 'nede');
  await assert.rejects(abonnementEksport({ db: s.db, klient: s.klient, priser: s.priser }, s.kontoId, s.u.nu()));
  const { konto: anden } = await findEllerOpretKonto(s.db, 'anden@example.test', s.u.nu());
  assert.deepEqual(await abonnementEksport({ db: s.db, klient: null, priser: s.priser }, anden.id, s.u.nu()), { kunde: null, plan: null, historik: [], fakturaer: [] });
});
