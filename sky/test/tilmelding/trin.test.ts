// KC-0198: the step on screen is a pure function of server state (account, entitlement, tenant), never
// something the browser remembers. Every combination that matters, as a table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tilmeldingsTrin, visningsNoegle, LANGSOM_MS, type KontoTilstand, type RettighedTilstand, type TenantTilstand, type Visning, type RettighedsStatus, type Tilstand } from '../../src/tilmelding/trin.ts';
import type { RettighedsStatus as AbonnementStatus } from '../../src/abonnement/rettigheder.ts';
import type { Tilstand as FlaadeTilstand } from '../../src/fleet/tilstand.ts';

// Compile-time: the states written out in trin.ts are exactly billing's and the fleet's (no drift).
type Ens<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _status: Ens<RettighedsStatus, AbonnementStatus> = true;
const _tilstand: Ens<Tilstand, FlaadeTilstand> = true;
void _status; void _tilstand;

const NU = new Date('2026-11-01T10:00:00.000Z');
const siden = (ms: number) => new Date(NU.getTime() - ms);
const KLAR_KONTO: KontoTilstand = { profilKlar: true };
const ret = (status: RettighedsStatus, o: Partial<RettighedTilstand> = {}): RettighedTilstand => ({ status, kilde: 'stripe', betalt: false, ...o });
const ten = (tilstand: Tilstand, o: Partial<NonNullable<TenantTilstand>> = {}): TenantTilstand => ({ tilstand, fejl: false, bestilt: siden(10_000), ...o });
const trin = (k: KontoTilstand | null, r: RettighedTilstand, t: TenantTilstand, tilstand: 'open' | 'invitation' = 'open'): Visning => tilmeldingsTrin(k, r, t, { tilstand, nu: NU });

test('no session → the account step, whatever else exists', () => {
  assert.deepEqual(trin(null, ret('ingen'), null), { trin: 'konto' });
  assert.deepEqual(trin(null, ret('aktiv'), ten('klar')), { trin: 'konto' });
});

test('logged in without a complete profile (or with an old consent version) → profile', () => {
  assert.deepEqual(trin({ profilKlar: false }, ret('ingen'), null), { trin: 'profil' });
  assert.deepEqual(trin({ profilKlar: false }, ret('proeve'), ten('klar')), { trin: 'profil' });
});

test('KC-0204: an account that accepted an older version sees one blocking screen, whatever else is true (tenant klar, paid up)', () => {
  const GENACCEPT: KontoTilstand = { profilKlar: false, genaccept: true };
  for (const r of [ret('ingen'), ret('proeve'), ret('aktiv'), ret('aktiv', { kilde: 'gave' }), ret('forfalden'), ret('pause')]) {
    for (const t of [null, ten('startet'), ten('klar'), ten('afvikles')]) assert.deepEqual(trin(GENACCEPT, r, t), { trin: 'samtykke' });
  }
  // A person who never finished the profile still gets the profile step, not "terms changed".
  assert.deepEqual(trin({ profilKlar: false, genaccept: false }, ret('aktiv'), ten('klar')), { trin: 'profil' });
  assert.equal(visningsNoegle({ trin: 'samtykke' }), 'samtykke');
});

test('no entitlement: plan in open mode, the invitation step in invitation mode — never both', () => {
  assert.deepEqual(trin(KLAR_KONTO, ret('ingen'), null, 'open'), { trin: 'plan' });
  assert.deepEqual(trin(KLAR_KONTO, ret('ingen'), null, 'invitation'), { trin: 'invitation' });
  assert.deepEqual(trin(KLAR_KONTO, ret('opsagt'), null, 'open'), { trin: 'plan' });
  assert.deepEqual(trin(KLAR_KONTO, ret('opsagt'), null, 'invitation'), { trin: 'invitation' });
});

test('back from a completed Checkout before the webhook → payment, waiting (never a dead end)', () => {
  assert.deepEqual(trin(KLAR_KONTO, ret('ingen', { betalt: true }), null), { trin: 'betaling' });
  assert.deepEqual(trin(KLAR_KONTO, ret('ingen', { betalt: true }), null, 'invitation'), { trin: 'betaling' });
  assert.deepEqual(trin(KLAR_KONTO, ret('opsagt', { betalt: true }), null), { trin: 'betaling' });
});

test('a paused or overdue subscription is fixed on the subscription page, never by a second Checkout', () => {
  for (const s of ['pause', 'forfalden'] as const) {
    assert.deepEqual(trin(KLAR_KONTO, ret(s), null), { trin: 'abonnement' }, s);
    assert.deepEqual(trin(KLAR_KONTO, ret(s), ten('klar')), { trin: 'abonnement' }, `${s} with a ready tenant`);
    assert.deepEqual(trin(KLAR_KONTO, ret(s, { betalt: true }), ten('klar')), { trin: 'abonnement' }, `${s} after a Checkout`);
  }
});

test('cancelled trial with a ready tenant → never "Åbn Clawco"', () => {
  assert.deepEqual(trin(KLAR_KONTO, ret('opsagt'), ten('klar')), { trin: 'plan' });
  assert.deepEqual(trin(KLAR_KONTO, ret('ingen'), ten('klar'), 'invitation'), { trin: 'invitation' });
});

test('entitled, no tenant yet → provisioning, being ordered', () => {
  for (const r of [ret('proeve'), ret('aktiv'), ret('aktiv', { kilde: 'gave' })]) {
    assert.deepEqual(trin(KLAR_KONTO, r, null), { trin: 'klargoering', fase: 'bestilles', status: 'i-gang' });
  }
});

test('a gift skips the invitation step', () => {
  assert.deepEqual(trin(KLAR_KONTO, ret('aktiv', { kilde: 'gave' }), null, 'invitation'), { trin: 'klargoering', fase: 'bestilles', status: 'i-gang' });
  assert.deepEqual(trin(KLAR_KONTO, ret('aktiv', { kilde: 'gave' }), ten('klar'), 'invitation'), { trin: 'aabn' });
});

test('each real fleet state is its own phase', () => {
  for (const s of ['bestilt', 'startet', 'sund', 'i-gateway'] as const) {
    assert.deepEqual(trin(KLAR_KONTO, ret('proeve'), ten(s)), { trin: 'klargoering', fase: s, status: 'i-gang' }, s);
  }
});

test('paid but the provisioning failed → provisioning with a retry (status fejlet), at any phase', () => {
  for (const s of ['bestilt', 'startet', 'sund', 'i-gateway'] as const) {
    assert.deepEqual(trin(KLAR_KONTO, ret('proeve'), ten(s, { fejl: true })), { trin: 'klargoering', fase: s, status: 'fejlet' }, s);
  }
});

test('slow: not klar more than two minutes after bestilt (a failure outranks slowness)', () => {
  assert.equal(LANGSOM_MS, 120_000);
  assert.deepEqual(trin(KLAR_KONTO, ret('proeve'), ten('startet', { bestilt: siden(LANGSOM_MS) })), { trin: 'klargoering', fase: 'startet', status: 'i-gang' });
  assert.deepEqual(trin(KLAR_KONTO, ret('proeve'), ten('startet', { bestilt: siden(LANGSOM_MS + 1) })), { trin: 'klargoering', fase: 'startet', status: 'langsom' });
  assert.deepEqual(trin(KLAR_KONTO, ret('proeve'), ten('startet', { bestilt: siden(LANGSOM_MS + 1), fejl: true })), { trin: 'klargoering', fase: 'startet', status: 'fejlet' });
});

test('"Åbn Clawco" only when the tenant is klar and the entitlement is a trial or active (gift included)', () => {
  assert.deepEqual(trin(KLAR_KONTO, ret('proeve'), ten('klar')), { trin: 'aabn' });
  assert.deepEqual(trin(KLAR_KONTO, ret('aktiv'), ten('klar')), { trin: 'aabn' });
  // A klar tenant whose last stamp was a failure that has since cleared is still klar.
  assert.deepEqual(trin(KLAR_KONTO, ret('aktiv'), ten('klar', { bestilt: siden(10 * LANGSOM_MS) })), { trin: 'aabn' });
});

test('a tenant being deleted is never offered', () => {
  assert.deepEqual(trin(KLAR_KONTO, ret('proeve'), ten('afvikles')), { trin: 'slettes' });
  assert.deepEqual(trin(KLAR_KONTO, ret('proeve'), ten('slettet')), { trin: 'slettes' });
});

test('the exhaustive table never offers "Åbn Clawco" outside its rule', () => {
  const statusser: RettighedsStatus[] = ['proeve', 'aktiv', 'forfalden', 'pause', 'opsagt', 'ingen'];
  const tilstande: (Tilstand | null)[] = [null, 'bestilt', 'startet', 'sund', 'i-gateway', 'klar', 'afvikles', 'slettet'];
  for (const k of [null, { profilKlar: false }, { profilKlar: false, genaccept: true }, KLAR_KONTO]) for (const s of statusser) for (const kilde of ['stripe', 'gave'] as const) for (const betalt of [false, true])
    for (const t of tilstande) for (const fejl of [false, true]) for (const mode of ['open', 'invitation'] as const) {
      const v = trin(k, ret(s, { kilde, betalt }), t ? ten(t, { fejl }) : null, mode);
      const maa = k?.profilKlar === true && (s === 'proeve' || s === 'aktiv') && t === 'klar';
      assert.equal(v.trin === 'aabn', maa, JSON.stringify({ k, s, kilde, betalt, t, fejl, mode, v }));
      assert.ok(!(mode === 'open' && v.trin === 'invitation') && !(mode === 'invitation' && v.trin === 'plan'), 'never both ways at once');
    }
});

test('the key the page polls on changes exactly when what is shown changes', () => {
  assert.equal(visningsNoegle({ trin: 'plan' }), 'plan');
  assert.equal(visningsNoegle({ trin: 'klargoering', fase: 'sund', status: 'langsom' }), 'klargoering:sund:langsom');
});
