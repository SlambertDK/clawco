// KC-0133: the Google Calendar connector over the in-process fake Google —
// the card walks through setting up one's own Google app (redirect address
// ready to copy) until the client keys are set, then offers "Log ind med
// Google"; the whole flow through the registry (PKCE, the read, refresh
// with 60 s skew, refresh on 401, revoke on disconnect); health classifies
// invalid_grant as log-ind-igen; missing keys or address fail closed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { googleKalender, GOOGLE_KALENDER_ID } from '../../../src/kilder/google-kalender/kilde.ts';
import { falskGoogle } from '../../../src/kilder/google/falsk-google.ts';
import { lavRegister } from '../../../src/kilder/register.ts';
import { KildeFejl, type KildeKontekst } from '../../../src/kilder/types.ts';
import type { Person } from '../../../src/identitet/husstand.ts';
import { medData, NU } from '../hjaelp.ts';

const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const KLIENT = { id: 'klient-1.apps.googleusercontent.com', hemmelighed: 'GOCSPX-klient' };
const ENV = { KC_GOOGLE_CLIENT_ID: KLIENT.id, KC_GOOGLE_CLIENT_SECRET: KLIENT.hemmelighed };
const ADR = 'https://kontrol.example.ts.net';
const TILBAGE = `${ADR}/api/kilder/google-kalender/tilbage`;

const story = () => [{ id: 'primary@example.test', summary: 'primary@example.test', events: [
  { id: 'a1', summary: 'Stand-up', start: { dateTime: '2026-10-31T09:00:00+01:00' }, end: { dateTime: '2026-10-31T09:15:00+01:00' } },
] }];
const ctx = (hemmelighed: Record<string, string> | null, nu = NU): KildeKontekst => ({ nu, zone: 'privat', valg: {}, hemmelighed: async () => hemmelighed });

/** Connect through the registry: forbind → the fake Google consents → tilbage. Returns the registry and the fake. */
async function forbundet(dir: string, store: Parameters<typeof lavRegister>[0]['store'], o: { nu?: () => Date } = {}) {
  const g = falskGoogle({ klient: KLIENT, kalendere: story });
  const k = googleKalender({ env: { ...ENV }, adresse: ADR, hent: g.hent });
  const r = lavRegister({ dataDir: dir, store, nu: o.nu ?? (() => NU), adresse: ADR });
  r.registrer(k);
  const svar = await r.forbind(GOOGLE_KALENDER_ID, {}, EJER);
  assert.ok('omdiriger' in svar);
  const tilbage = new URL(g.samtykke(svar.omdiriger));
  const f = await r.tilbage(GOOGLE_KALENDER_ID, tilbage.searchParams.get('state')!, tilbage.searchParams.get('code')!, EJER);
  return { r, g, k, f };
}

test('card without client keys: one step at a time, the redirect address ready to copy, two fields to the env file', async () => {
  const kort = await googleKalender({ env: {}, adresse: ADR }).kort(ctx(null));
  assert.ok((kort.trin?.length ?? 0) >= 5);
  assert.ok(kort.trin!.some((t) => t.kopier === TILBAGE), 'the redirect URI is offered to copy');
  assert.ok(kort.trin!.some((t) => /Publish app/.test(t.tekst) && /syv dage/.test(t.tekst)), 'publish to avoid the 7-day expiry');
  assert.ok(kort.trin!.some((t) => /External/.test(t.tekst)));
  assert.ok(kort.trin!.some((t) => /testbruger/.test(t.tekst)));
  assert.deepEqual(kort.felter.map((f) => [f.navn, f.type, f.miljoe, f.paakraevet]), [
    ['klient_id', 'tekst', 'KC_GOOGLE_CLIENT_ID', true], ['klient_hemmelighed', 'hemmelig', 'KC_GOOGLE_CLIENT_SECRET', true],
  ]);
});

test('card with client keys: no fields, "Log ind med Google", read-only promise', async () => {
  const kort = await googleKalender({ env: { ...ENV }, adresse: ADR }).kort(ctx(null));
  assert.deepEqual(kort.felter, []);
  assert.equal(kort.handling, 'Log ind med Google');
  assert.match(kort.tekst, /kun læse/);
  assert.equal(kort.trin, undefined);
});

test('the connector can never write: read-only scope, no verbs, no act', () => {
  const k = googleKalender({ env: {} });
  assert.equal(k.verber, undefined);
  assert.equal(k.act, undefined);
  assert.equal(k.auth, 'oauth');
  assert.equal(k.slags, 'kalender');
  assert.equal(k.zone, 'privat');
});

test('fail closed: no client keys or no known address → start refuses with Danish text', async () => {
  await assert.rejects(googleKalender({ env: {}, adresse: ADR }).oauth!.start('s', TILBAGE, ctx(null)), (e) => e instanceof KildeFejl && e.status === 409 && /Google-appen/.test(e.message));
  await assert.rejects(googleKalender({ env: { ...ENV } }).oauth!.start('s', '/api/kilder/google-kalender/tilbage', ctx(null)), (e) => e instanceof KildeFejl && e.status === 409 && /adresse/.test(e.message));
  await assert.rejects(googleKalender({ env: { ...ENV }, adresse: ADR }).oauth!.tilbage('kode', ctx(null), 'ukendt-state'), (e) => e instanceof KildeFejl && e.status === 400);
});

test('connect through the registry: PKCE consent, refresh token stored, the first read has the event', async () => {
  await medData(async (dir, store) => {
    const { f, g, r } = await forbundet(dir, store);
    assert.equal(f.foersteLaesning?.antal, 1);
    const l = await r.laes(GOOGLE_KALENDER_ID);
    assert.equal(l.slags, 'kalender');
    assert.equal(l.uklar, true);
    if (l.slags === 'kalender') assert.equal(l.data.days[0]!.events[0]!['title'], 'Stand-up');
    assert.equal(g.tokenKald().filter((k) => k === 'authorization_code').length, 1);
  });
});

test('access token: reused while valid, refreshed within 60 s of expiry, refreshed once on a 401', async () => {
  await medData(async (dir, store) => {
    let nu = NU;
    const { r, g } = await forbundet(dir, store, { nu: () => nu });
    const foer = g.tokenKald().length;
    await r.laes(GOOGLE_KALENDER_ID);
    assert.equal(g.tokenKald().length, foer, 'cached token reused');
    nu = new Date(NU.getTime() + (3600 - 50) * 1000); // 50 s before expiry: inside the skew
    await r.laes(GOOGLE_KALENDER_ID);
    assert.deepEqual(g.tokenKald().slice(foer), ['refresh_token']);
    g.udloebAdgang(); // Google drops the access token early
    await r.laes(GOOGLE_KALENDER_ID);
    assert.deepEqual(g.tokenKald().slice(foer), ['refresh_token', 'refresh_token']);
  });
});

test('health: invalid_grant → log-ind-igen (no read); no refresh token → log-ind-igen; no client keys → nede', async () => {
  // A refresh token Google does not know (revoked, or a Testing app's 7 days passed) is invalid_grant.
  const g = falskGoogle({ klient: KLIENT, kalendere: story });
  const h = await googleKalender({ env: { ...ENV }, hent: g.hent }).helbred(ctx({ refresh_token: 'ukendt' }));
  assert.equal(h.status, 'log-ind-igen');
  assert.match(h.tekst ?? '', /Log ind med Google igen/);
  assert.equal((await googleKalender({ env: { ...ENV } }).helbred(ctx(null))).status, 'log-ind-igen');
  assert.equal((await googleKalender({ env: {} }).helbred(ctx({ refresh_token: 'r' }))).status, 'nede');
});

test('a refused refresh is remembered: no further token calls until the user logs in again', async () => {
  await medData(async (dir, store) => {
    let nu = NU;
    const { r, g } = await forbundet(dir, store, { nu: () => nu });
    g.tilbagekaldAlt();
    nu = new Date(NU.getTime() + 2 * 3600_000);
    await assert.rejects(r.laes(GOOGLE_KALENDER_ID), (e) => e instanceof KildeFejl && e.status === 502);
    const n = g.tokenKald().length;
    await assert.rejects(r.laes(GOOGLE_KALENDER_ID));
    assert.equal(g.tokenKald().length, n, 'invalid_grant is not retried against Google');
    assert.equal((await r.oversigt()).find((x) => x.id === GOOGLE_KALENDER_ID)!.helbred?.status, 'log-ind-igen');
  });
});

test('disconnect revokes the grant at Google and removes the refresh token', async () => {
  await medData(async (dir, store) => {
    const { r, g } = await forbundet(dir, store);
    await r.frakobl(GOOGLE_KALENDER_ID, EJER);
    assert.equal(g.tilbagekaldte().length, 1);
    await assert.rejects(r.laes(GOOGLE_KALENDER_ID), (e) => e instanceof KildeFejl && e.status === 409);
  });
});
