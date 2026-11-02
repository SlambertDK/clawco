// KC-0192: the entitlement is a pure function of the subscription Stripe holds now, the price config
// and the clock. Table over every Stripe status × plan × cancel-at-period-end; unknown price or status
// fails closed (previous unchanged); a gift is never touched; over-limit households are named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beregnRettigheder, erSkrivebeskyttet, INGEN, maaInvitere, overGraense, planFraLookupKey, vaelgAbonnement, type Rettighed } from '../../src/abonnement/rettigheder.ts';
import { laesPriser } from '../../src/abonnement/priser.ts';
import type { AbonnementSnapshot } from '../../src/abonnement/stripe-klient.ts';

const priser = laesPriser();
const NU = new Date('2026-11-01T10:00:00.000Z');
const DAG = 86_400_000;

function snapshot(over: Partial<AbonnementSnapshot> = {}): AbonnementSnapshot {
  return {
    id: 'sub_1', kunde: 'cus_1', status: 'trialing', prisId: 'price_1', lookupKey: 'clawco-sky-solo-maaned', oprettet: new Date('2026-10-31T10:00:00Z'),
    proeveStart: new Date('2026-10-31T10:00:00Z'), proeveSlut: new Date('2026-11-14T10:00:00Z'), periodeSlut: new Date('2026-11-14T10:00:00Z'),
    opsigVedPeriodeslut: false, opsigesVed: null, forfaldenSiden: null, prisPlan: null, metadata: {}, ...over,
  };
}

test('plan comes from the lookup key through config/priser.json; anything else is unknown', () => {
  assert.equal(planFraLookupKey('clawco-sky-solo-maaned', priser), 'sky-solo');
  assert.equal(planFraLookupKey('clawco-sky-husstand-aar', priser), 'sky-husstand');
  assert.equal(planFraLookupKey('clawco-sky-guld-maaned', priser), null);
  assert.equal(planFraLookupKey('sky-solo', priser), null);
  assert.equal(planFraLookupKey(null, priser), null);
});

const FORVENTET: Record<string, { status: Rettighed['status']; plan: 'samme' | 'ingen'; skrivebeskyttet: boolean; opsiges: boolean }> = {
  trialing: { status: 'proeve', plan: 'samme', skrivebeskyttet: false, opsiges: true },
  active: { status: 'aktiv', plan: 'samme', skrivebeskyttet: false, opsiges: true },
  past_due: { status: 'forfalden', plan: 'samme', skrivebeskyttet: false, opsiges: true },
  unpaid: { status: 'forfalden', plan: 'samme', skrivebeskyttet: true, opsiges: true },
  paused: { status: 'pause', plan: 'samme', skrivebeskyttet: true, opsiges: false },
  canceled: { status: 'opsagt', plan: 'ingen', skrivebeskyttet: true, opsiges: false },
  incomplete: { status: 'ingen', plan: 'ingen', skrivebeskyttet: false, opsiges: false },
  incomplete_expired: { status: 'ingen', plan: 'ingen', skrivebeskyttet: false, opsiges: false },
};

test('every Stripe status × plan × cancel-at-period-end maps to one entitlement', () => {
  for (const [stripeStatus, f] of Object.entries(FORVENTET)) {
    for (const plan of ['sky-solo', 'sky-husstand']) {
      for (const opsig of [false, true]) {
        const navn = `${stripeStatus}/${plan}/${opsig}`;
        const { rettighed: r, advarsel } = beregnRettigheder({ snapshot: snapshot({ status: stripeStatus, lookupKey: `clawco-${plan}-maaned`, opsigVedPeriodeslut: opsig }), forrige: null }, priser, NU);
        assert.equal(advarsel, null, navn);
        assert.equal(r.kilde, 'stripe', navn);
        assert.equal(r.status, f.status, navn);
        assert.equal(r.plan, f.plan === 'samme' ? plan : 'ingen', navn);
        assert.equal(r.medlemmerMax, f.plan === 'samme' ? priser.planer[plan]!.medlemmer : 0, navn);
        assert.equal(r.skrivebeskyttet, f.skrivebeskyttet, navn);
        assert.equal(r.opsiges, opsig && f.opsiges ? '2026-11-14T10:00:00.000Z' : null, navn);
        assert.equal(r.abonnement, 'sub_1', navn);
      }
    }
  }
});

test('a trial carries its end; an explicit cancel_at wins over the period end', () => {
  const { rettighed: r } = beregnRettigheder({ snapshot: snapshot(), forrige: null }, priser, NU);
  assert.equal(r.proeveSlutter, '2026-11-14T10:00:00.000Z');
  assert.equal(r.periodeSlutter, '2026-11-14T10:00:00.000Z');
  const { rettighed: a } = beregnRettigheder({ snapshot: snapshot({ status: 'active', opsigesVed: new Date('2026-12-01T00:00:00Z') }), forrige: null }, priser, NU);
  assert.equal(a.opsiges, '2026-12-01T00:00:00.000Z');
});

test('past_due is read-only once fristVedFejl days have passed since the failed invoice', () => {
  const siden = new Date(NU.getTime() - (priser.fristVedFejl - 1) * DAG);
  const { rettighed: r } = beregnRettigheder({ snapshot: snapshot({ status: 'past_due', forfaldenSiden: siden }), forrige: null }, priser, NU);
  assert.equal(r.forfaldenSiden, siden.toISOString());
  assert.equal(r.skrivebeskyttet, false);
  assert.equal(erSkrivebeskyttet(r, priser, new Date(NU.getTime() + 2 * DAG)), true);
  const gammel = new Date(NU.getTime() - priser.fristVedFejl * DAG);
  assert.equal(beregnRettigheder({ snapshot: snapshot({ status: 'past_due', forfaldenSiden: gammel }), forrige: null }, priser, NU).rettighed.skrivebeskyttet, true);
});

test('an unknown price or lookup key grants nothing new: the previous entitlement stays and an alert is raised', () => {
  const forrige = beregnRettigheder({ snapshot: snapshot({ status: 'active' }), forrige: null }, priser, NU).rettighed;
  for (const s of [snapshot({ lookupKey: 'clawco-sky-guld-maaned' }), snapshot({ lookupKey: null, prisId: 'price_x' })]) {
    const r = beregnRettigheder({ snapshot: s, forrige }, priser, NU);
    assert.deepEqual(r.rettighed, forrige);
    assert.match(r.advarsel ?? '', /ukendt pris/);
  }
  const intet = beregnRettigheder({ snapshot: snapshot({ lookupKey: 'clawco-sky-guld-maaned' }), forrige: null }, priser, NU);
  assert.deepEqual(intet.rettighed, INGEN);
});

test('KC-0193 S7: a price that lost its lookup key to a config price change still maps by its clawco_plan metadata', () => {
  // The setup moves the lookup key to the new price and archives the old one; existing subscribers keep paying the old.
  const gammel = beregnRettigheder({ snapshot: snapshot({ status: 'active', lookupKey: null, prisId: 'price_gammel', prisPlan: 'sky-husstand' }), forrige: null }, priser, NU);
  assert.equal(gammel.advarsel, null);
  assert.equal(gammel.rettighed.status, 'aktiv');
  assert.equal(gammel.rettighed.plan, 'sky-husstand');
  assert.equal(gammel.rettighed.medlemmerMax, priser.planer['sky-husstand']!.medlemmer);
  // The lookup key wins when both are there; a metadata plan the config does not know is still unknown (fail closed).
  assert.equal(beregnRettigheder({ snapshot: snapshot({ status: 'active', prisPlan: 'sky-husstand' }), forrige: null }, priser, NU).rettighed.plan, 'sky-solo');
  for (const prisPlan of ['sky-guld', 'toString', '']) {
    const r = beregnRettigheder({ snapshot: snapshot({ status: 'active', lookupKey: null, prisPlan }), forrige: null }, priser, NU);
    assert.deepEqual(r.rettighed, INGEN);
    assert.match(r.advarsel ?? '', /ukendt pris/);
  }
});

test('an unknown Stripe status fails closed the same way', () => {
  const forrige = beregnRettigheder({ snapshot: snapshot({ status: 'active' }), forrige: null }, priser, NU).rettighed;
  const r = beregnRettigheder({ snapshot: snapshot({ status: 'frozen' }), forrige }, priser, NU);
  assert.deepEqual(r.rettighed, forrige);
  assert.match(r.advarsel ?? '', /ukendt status/);
});

test('no subscription at all means no entitlement', () => {
  assert.deepEqual(beregnRettigheder({ snapshot: null, forrige: null }, priser, NU), { rettighed: INGEN, advarsel: null });
});

test('a gift is never changed by Stripe state, not even downgraded by a cancellation', () => {
  const gave: Rettighed = { ...INGEN, kilde: 'gave', plan: 'sky-husstand', status: 'aktiv', medlemmerMax: 6 };
  for (const status of Object.keys(FORVENTET)) {
    assert.deepEqual(beregnRettigheder({ snapshot: snapshot({ status }), forrige: gave }, priser, NU), { rettighed: gave, advarsel: null });
  }
  assert.deepEqual(beregnRettigheder({ snapshot: null, forrige: gave }, priser, NU).rettighed, gave);
});

test('of several subscriptions the live one wins, then the newest', () => {
  const gammel = snapshot({ id: 'sub_gammel', status: 'canceled', oprettet: new Date('2026-12-01T00:00:00Z') });
  const levende = snapshot({ id: 'sub_levende', status: 'past_due', oprettet: new Date('2026-10-01T00:00:00Z') });
  assert.equal(vaelgAbonnement([gammel, levende])?.id, 'sub_levende');
  assert.equal(vaelgAbonnement([levende, gammel])?.id, 'sub_levende');
  const nyere = snapshot({ id: 'sub_nyere', status: 'canceled', oprettet: new Date('2027-01-01T00:00:00Z') });
  assert.equal(vaelgAbonnement([gammel, nyere])?.id, 'sub_nyere');
  assert.equal(vaelgAbonnement([]), null);
});

test('over the member limit: nobody is removed, invites are blocked, the owner is told which plan fits', () => {
  const solo = beregnRettigheder({ snapshot: snapshot({ status: 'active' }), forrige: null }, priser, NU).rettighed;
  assert.deepEqual(overGraense(solo, 4, priser), { antal: 4, max: 1, plan: 'Sky Solo', forslag: 'Sky Husstand' });
  assert.equal(overGraense(solo, 1, priser), null);
  assert.equal(maaInvitere(solo, 1), false);
  const hus = beregnRettigheder({ snapshot: snapshot({ status: 'active', lookupKey: 'clawco-sky-husstand-aar' }), forrige: null }, priser, NU).rettighed;
  assert.equal(maaInvitere(hus, 5), true);
  assert.equal(maaInvitere(hus, 6), false);
  assert.deepEqual(overGraense(hus, 8, priser), { antal: 8, max: 6, plan: 'Sky Husstand', forslag: null });
  assert.equal(maaInvitere(INGEN, 0), false);
});
