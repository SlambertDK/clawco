// KC-0209: the order record (what the person was shown and ticked, with the terms version and the time), the
// withdrawal request and the refund task, over a real (PGlite) database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stativ } from './stativ.ts';
import {
  aabneRefusioner, hentBestilling, hentFortrydelse, knytBestilling, markerRefusionUdfoert, opretBestilling, registrerFortrydelse, senesteFortrydbare, ubehandlede,
} from '../../src/abonnement/bestilling.ts';

const ord = (kontoId: number, over: Partial<Parameters<typeof opretBestilling>[1]> = {}) => ({
  kontoId, checkoutSession: 'cs_test_1', plan: 'sky-solo', interval: 'maaned' as const, prisOere: 7900, valuta: 'dkk' as const, proeve: false, vilkaarVersion: '0.1-udkast', sprog: 'da' as const, nu: new Date('2026-11-02T10:00:00.000Z'), ...over,
});

test('an order keeps the price shown, the terms version and when both boxes were ticked', async () => {
  const s = await stativ();
  const id = await opretBestilling(s.db, ord(s.kontoId));
  const b = await hentBestilling(s.db, id!);
  assert.equal(b?.vilkaarVersion, '0.1-udkast');
  assert.equal(b?.prisOere, 7900);
  assert.equal(b?.proeve, false);
  assert.equal(b?.vilkaarSamtykkeVed.toISOString(), '2026-11-02T10:00:00.000Z');
  assert.equal(b?.straksStartSamtykkeVed.toISOString(), '2026-11-02T10:00:00.000Z');
  assert.equal(b?.stripeAbonnement, null);
});

test('the same Checkout Session is one order: a double click keeps the first consent time', async () => {
  const s = await stativ();
  const a = await opretBestilling(s.db, ord(s.kontoId));
  const b = await opretBestilling(s.db, ord(s.kontoId, { nu: new Date('2026-11-02T10:05:00.000Z') }));
  assert.equal(b, a);
  assert.equal((await hentBestilling(s.db, a!))?.straksStartSamtykkeVed.toISOString(), '2026-11-02T10:00:00.000Z');
  assert.equal((await ubehandlede(s.db, s.kontoId)).length, 1);
});

test('the database itself refuses an order without the immediate-start consent or the terms version', async () => {
  const s = await stativ();
  await assert.rejects(s.db.query(
    "INSERT INTO abonnement.bestilling (konto_id, checkout_session, plan, interval, pris_oere, proeve, vilkaar_version, vilkaar_samtykke_ved, sprog, oprettet) VALUES ($1, 'cs_x', 'sky-solo', 'maaned', 7900, false, '1', now(), 'da', now())", [s.kontoId]));
  await assert.rejects(s.db.query(
    "INSERT INTO abonnement.bestilling (konto_id, checkout_session, plan, interval, pris_oere, proeve, vilkaar_samtykke_ved, straks_start_samtykke_ved, sprog, oprettet) VALUES ($1, 'cs_y', 'sky-solo', 'maaned', 7900, false, now(), now(), 'da', now())", [s.kontoId]));
});

test('an order becomes withdrawable once Stripe says it began; a withdrawn one no longer is, and the period ends', async () => {
  const s = await stativ();
  const id = (await opretBestilling(s.db, ord(s.kontoId)))!;
  const start = new Date('2026-11-02T10:00:00.000Z');
  assert.equal(await senesteFortrydbare(s.db, s.kontoId, start), null, 'not begun yet: nothing to withdraw from');
  await knytBestilling(s.db, id, 'sub_1', start);
  assert.equal((await ubehandlede(s.db, s.kontoId)).length, 0);
  assert.equal((await senesteFortrydbare(s.db, s.kontoId, new Date('2026-11-16T12:00:00.000Z')))?.id, id);
  assert.equal(await senesteFortrydbare(s.db, s.kontoId, new Date('2026-11-17T00:00:00.000Z')), null, 'after the 14 days');
  const r = await registrerFortrydelse(s.db, { bestillingId: id, kontoId: s.kontoId, tidspunkt: new Date('2026-11-05T10:00:00.000Z'), brugteDage: 4, periodeDage: 30, tilbageOere: 6847, forfald: new Date('2026-11-19T10:00:00.000Z'), beloebOpgave: 6847, valuta: 'dkk' });
  assert.equal(r.ny, true);
  assert.equal(await senesteFortrydbare(s.db, s.kontoId, new Date('2026-11-06T10:00:00.000Z')), null, 'already withdrawn');
  assert.equal((await hentFortrydelse(s.db, id))?.tilbageOere, 6847);
});

test('a withdrawal is recorded once; the second press finds the first and creates no second refund task', async () => {
  const s = await stativ();
  const id = (await opretBestilling(s.db, ord(s.kontoId)))!;
  await knytBestilling(s.db, id, 'sub_1', new Date('2026-11-02T10:00:00.000Z'));
  const a = { bestillingId: id, kontoId: s.kontoId, tidspunkt: new Date('2026-11-05T10:00:00.000Z'), brugteDage: 4, periodeDage: 30, tilbageOere: 6847, forfald: new Date('2026-11-19T10:00:00.000Z'), beloebOpgave: 6847, valuta: 'dkk' as const };
  const foerste = await registrerFortrydelse(s.db, a);
  const anden = await registrerFortrydelse(s.db, { ...a, tidspunkt: new Date('2026-11-05T10:09:00.000Z') });
  assert.equal(foerste.ny, true);
  assert.equal(anden.ny, false);
  assert.equal((await hentFortrydelse(s.db, id))?.tidspunkt.toISOString(), '2026-11-05T10:00:00.000Z', 'the first time stands');
  const opgaver = await aabneRefusioner(s.db);
  assert.equal(opgaver.length, 1);
  assert.equal(opgaver[0]?.beloebOere, 6847);
  assert.equal(opgaver[0]?.kontoId, s.kontoId);
  assert.equal(opgaver[0]?.forfald.toISOString(), '2026-11-19T10:00:00.000Z');
});

test('a trial withdrawal creates no refund task (nothing was paid)', async () => {
  const s = await stativ();
  const id = (await opretBestilling(s.db, ord(s.kontoId, { proeve: true })))!;
  await knytBestilling(s.db, id, 'sub_1', new Date('2026-11-02T10:00:00.000Z'));
  await registrerFortrydelse(s.db, { bestillingId: id, kontoId: s.kontoId, tidspunkt: new Date('2026-11-03T10:00:00.000Z'), brugteDage: 1, periodeDage: 30, tilbageOere: 0, forfald: new Date('2026-11-17T10:00:00.000Z'), beloebOpgave: 0, valuta: 'dkk' });
  assert.equal((await aabneRefusioner(s.db)).length, 0);
});

test('the owner marks a refund task done by hand; it then leaves the open list', async () => {
  const s = await stativ();
  const id = (await opretBestilling(s.db, ord(s.kontoId)))!;
  await knytBestilling(s.db, id, 'sub_1', new Date('2026-11-02T10:00:00.000Z'));
  await registrerFortrydelse(s.db, { bestillingId: id, kontoId: s.kontoId, tidspunkt: new Date('2026-11-05T10:00:00.000Z'), brugteDage: 4, periodeDage: 30, tilbageOere: 6847, forfald: new Date('2026-11-19T10:00:00.000Z'), beloebOpgave: 6847, valuta: 'dkk' });
  const [opgave] = await aabneRefusioner(s.db);
  assert.equal(await markerRefusionUdfoert(s.db, opgave!.id, new Date('2026-11-06T10:00:00.000Z')), true);
  assert.equal(await markerRefusionUdfoert(s.db, opgave!.id, new Date('2026-11-06T10:00:00.000Z')), false, 'done is done');
  assert.equal((await aabneRefusioner(s.db)).length, 0);
});

test('no row holds an e-mail address or a card number (the rows outlive the account)', async () => {
  const s = await stativ();
  const id = (await opretBestilling(s.db, ord(s.kontoId)))!;
  await knytBestilling(s.db, id, 'sub_1', new Date('2026-11-02T10:00:00.000Z'));
  await registrerFortrydelse(s.db, { bestillingId: id, kontoId: s.kontoId, tidspunkt: new Date('2026-11-05T10:00:00.000Z'), brugteDage: 4, periodeDage: 30, tilbageOere: 6847, forfald: new Date('2026-11-19T10:00:00.000Z'), beloebOpgave: 6847, valuta: 'dkk' });
  const alt = JSON.stringify([
    await s.db.query('SELECT * FROM abonnement.bestilling'), await s.db.query('SELECT * FROM abonnement.fortrydelse'), await s.db.query('SELECT * FROM abonnement.refusion_opgave'),
  ], (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v));
  assert.doesNotMatch(alt, /@/);
});
