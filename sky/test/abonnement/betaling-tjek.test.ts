// KC-0193: `npm run betaling:tjek` without the network. The Stripe layer (stripe-verden.ts) runs against a
// simulation of the Stripe calls it makes, backed by the fake client's time model: the whole table goes green
// through the same clock driver, event polling and cleanup the real run uses. Plus the invariants: only a test
// key runs, the key is never printed, --dry-run builds nothing, and the run's test clocks are deleted on
// success and after a failure mid-run; everything created carries metadata clawco_tjek=<run id>.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Stripe from 'stripe';
import { FalskBetalingsKlient } from '../../src/abonnement/falsk.ts';
import { koerBetalingsTjek, erTestNoegle, nyKoersel, NOEGLE_NAVN } from './betaling/tjek.ts';
import { stripeVerden, abonnementFraCheckout, urNavn, TJEK_NOEGLE, MAKS_SKRIDT_MS, type TestureApi, type TestUr } from './betaling/stripe-verden.ts';
import { SCENARIER } from './betaling/scenarier.ts';

const TEST_NOEGLE = 'sk_test_SENTINELbetalingstjek0123456789'; // gitleaks:allow (a fake key in a test)
const LIVE_NOEGLER = [
  ['sk', 'live', 'SENT'].join('_') + 'INELbetalingstjek0123456789', // a fake key, joined at run time
  ['rk', 'live', 'SENT'].join('_') + 'INELbetalingstjek0123456789', // a fake key, joined at run time
  'pk_test_SENTINELbetalingstjek0123456789', // a fake key, joined at run time
  'sk_test_', 'whsec_SENTINEL', ' sk_test_SENTINEL med mellemrum',
];
const NU = new Date('2026-11-02T09:00:00.000Z');

type Kald = { metode: string; args: unknown };

/** Stripe as the test layer sees it, in memory: clocks move their own customers through the fake's time model. */
class SimuleretStripe implements TestureApi {
  readonly kald: Kald[] = [];
  readonly ure = new Map<string, TestUr & { navn: string; slettet: boolean; kunder: Set<string> }>();
  fejlVed: { metode: string; nummer: number } | null = null;
  sletFejler = false;
  private n = 0;
  private taeller = new Map<string, number>();
  readonly falsk: FalskBetalingsKlient;
  constructor(falsk: FalskBetalingsKlient) { this.falsk = falsk; }

  private log(metode: string, args: unknown): void {
    this.kald.push({ metode, args: structuredClone(args) });
    const nr = (this.taeller.get(metode) ?? 0) + 1;
    this.taeller.set(metode, nr);
    if (this.fejlVed && this.fejlVed.metode === metode && this.fejlVed.nummer === nr) throw new Error(`injiceret fejl i ${metode}`);
  }
  private ur(id: string) {
    const u = this.ure.get(id);
    if (!u || u.slettet) throw new Error(`intet testur ${id}`);
    return u;
  }

  async opretUr(navn: string, frossetSek: number): Promise<TestUr> {
    this.log('opretUr', { navn, frossetSek });
    const id = `clock_sim_${++this.n}`;
    this.ure.set(id, { id, status: 'ready', frossetSek, navn, slettet: false, kunder: new Set() });
    return { id, status: 'ready', frossetSek };
  }
  async hentUr(id: string): Promise<TestUr> {
    const u = this.ur(id);
    // Stripe answers "advancing" first; the layer must wait for "ready".
    if (u.status === 'advancing') { u.status = 'ready'; return { id, status: 'advancing', frossetSek: u.frossetSek }; }
    return { id, status: u.status, frossetSek: u.frossetSek };
  }
  async fremUr(id: string, tilSek: number): Promise<void> {
    this.log('fremUr', { id, tilSek });
    const u = this.ur(id);
    if ((tilSek - u.frossetSek) * 1000 > MAKS_SKRIDT_MS) throw new Error('for stort skridt for Stripe');
    u.frossetSek = tilSek;
    u.status = 'advancing';
    for (const k of u.kunder) this.falsk.spolFrem(new Date(tilSek * 1000), k);
  }
  async sletUr(id: string): Promise<void> {
    this.log('sletUr', { id });
    if (this.sletFejler) throw new Error('Stripe svarede 500');
    this.ur(id).slettet = true;
  }
  async listUre(): Promise<{ id: string; navn: string | null }[]> {
    return [...this.ure.values()].filter((u) => !u.slettet).map((u) => ({ id: u.id, navn: u.navn }));
  }
  async opretKunde(params: Stripe.CustomerCreateParams, n: string): Promise<{ id: string }> {
    this.log('opretKunde', { params, n });
    const m = params.metadata as Record<string, string>;
    const k = await this.falsk.opretKunde({ kontoId: Number(m['konto_id']), email: params.email!, sprog: params.preferred_locales?.[0] === 'en' ? 'en' : 'da' }, n);
    this.ur(params.test_clock!).kunder.add(k.id);
    return k;
  }
  async vedhaeftKort(kunde: string, pm: string): Promise<void> {
    this.log('vedhaeftKort', { kunde, pm });
    this.falsk.vedhaeftBetalingsmiddel(kunde, pm);
  }
  async opretAbonnement(params: Stripe.SubscriptionCreateParams, n: string): Promise<{ id: string }> {
    this.log('opretAbonnement', { params, n });
    const ur = [...this.ure.values()].find((u) => u.kunder.has(params.customer!))!;
    // The simulation creates it the way the fake does (a completed Checkout with the same parameters).
    const s = await this.falsk.opretCheckout({
      mode: 'subscription', customer: params.customer!, line_items: params.items!.map((i) => ({ price: i.price!, quantity: i.quantity! })),
      subscription_data: { trial_period_days: params.trial_period_days!, ...(params.trial_settings?.end_behavior?.missing_payment_method ? { trial_settings: { end_behavior: { missing_payment_method: params.trial_settings.end_behavior.missing_payment_method } } } : {}), metadata: params.metadata as Record<string, string> },
      success_url: 'https://sky.example.com/tilbage',
    }, n);
    this.falsk.fuldfoerCheckout(s.id, new Date(ur.frossetSek * 1000));
    return { id: (await this.falsk.hentCheckout(s.id))!.abonnement!.id };
  }
  async skiftPris(abonnement: string, prisId: string): Promise<void> {
    this.log('skiftPris', { abonnement, prisId });
    this.falsk.skiftPris(abonnement, prisId);
  }
  async betalAabne(kunde: string): Promise<void> {
    this.log('betalAabne', { kunde });
    this.falsk.betalAabne(kunde);
  }
  async haendelser(): Promise<{ id: string; type: string; kunde: string | null; krop: string }[]> {
    return this.falsk.haendelser();
  }
}

function simulation() {
  const falsk = new FalskBetalingsKlient('test');
  const api = new SimuleretStripe(falsk);
  const lavStripe = (noegle: string) => {
    assert.equal(noegle, TEST_NOEGLE);
    return { api, verden: (koersel: string) => stripeVerden({ api, indre: falsk, koersel, nu: () => NU, vent: async () => {} }) };
  };
  return { falsk, api, lavStripe };
}

async function koer(argv: string[], env: Record<string, string | undefined>, lavStripe?: Parameters<typeof koerBetalingsTjek>[0]['lavStripe']) {
  const linjer: string[] = [];
  const kode = await koerBetalingsTjek({ argv, env, skriv: (l) => linjer.push(l), koersel: 'k1', ur: () => 0, ...(lavStripe ? { lavStripe } : {}) });
  return { kode, tekst: linjer.join('\n'), linjer };
}

test('only a Stripe test key runs: a live, publishable or malformed key exits 1 before anything is built, and is never printed', async () => {
  assert.ok(erTestNoegle(TEST_NOEGLE));
  assert.ok(erTestNoegle('rk_test_SENTINEL0123')); // gitleaks:allow (a fake key in a test)
  for (const noegle of LIVE_NOEGLER) {
    let bygget = false;
    for (const argv of [[], ['--dry-run']]) {
      const r = await koer(argv, { [NOEGLE_NAVN]: noegle }, () => { bygget = true; throw new Error('må ikke bygges'); });
      assert.equal(r.kode, 1, noegle);
      assert.match(r.tekst, /Afvist: KC_STRIPE_SECRET_KEY er ikke en testnøgle/);
      assert.ok(!r.tekst.includes('SENTINEL'), 'the key is never printed');
    }
    assert.equal(bygget, false);
  }
});

test('the key comes from KC_STRIPE_SECRET_KEY only: without it the run exits 1 (Sky\'s own key name is not read)', async () => {
  const r = await koer([], { SKY_STRIPE_SECRET_KEY: TEST_NOEGLE }, () => { throw new Error('må ikke bygges'); });
  assert.equal(r.kode, 1);
  assert.match(r.tekst, /KC_STRIPE_SECRET_KEY mangler/);
  assert.equal((await koer(['--anvend'], { [NOEGLE_NAVN]: TEST_NOEGLE })).kode, 1);
});

test('--dry-run prints the plan, every scenario and step, without a key and without building a Stripe client', async () => {
  const r = await koer(['--dry-run'], {}, () => { throw new Error('ingen netværk i en tør kørsel'); });
  assert.equal(r.kode, 0);
  for (const sc of SCENARIER) assert.ok(r.linjer.includes(`${sc.id} ${sc.navn}`), sc.id);
  assert.match(r.tekst, /S8 kommer med KC-0194/);
  assert.doesNotMatch(r.tekst, /S3 kommer med/);
  assert.match(r.tekst, /S8 kommer med KC-0194/);
  assert.match(r.tekst, /clawco_tjek=k1/);
});

test('the Stripe layer runs the whole table green against the simulation, with test clocks advanced in steps of at most 28 days', async () => {
  const { api, lavStripe } = simulation();
  const r = await koer([], { [NOEGLE_NAVN]: TEST_NOEGLE }, lavStripe);
  assert.equal(r.kode, 0, r.tekst);
  assert.match(r.tekst, new RegExp(`${SCENARIER.length} af ${SCENARIER.length} scenarier grønne`));
  for (const sc of SCENARIER) for (const [i] of sc.skridt.entries()) assert.ok(r.linjer.some((l) => l.startsWith(`${sc.id} trin ${i + 1} `) && l.endsWith('✓')), `${sc.id} trin ${i + 1}`);
  const frem = api.kald.filter((k) => k.metode === 'fremUr');
  assert.ok(frem.length > 0);
  assert.ok(r.tekst.includes('Testure fra tjek efter oprydning: 0 (før: 0)'));
  assert.ok(!r.tekst.includes('SENTINEL'));
});

test('everything the run creates carries clawco_tjek=<run id>, in its own catalogue: the account\'s products and lookup keys are never touched', async () => {
  const { falsk, api, lavStripe } = simulation();
  // The account already holds a real Clawco product (the owner's own test data): the run must leave it alone.
  await falsk.opretProdukt({ id: 'clawco-sky-solo', navn: 'Clawco Sky Solo', metadata: { clawco: 'ja', clawco_plan: 'sky-solo' } }, 'ejer');
  await falsk.opretPris({ produkt: 'clawco-sky-solo', navn: 'Sky Solo pr. måned', lookupKey: 'clawco-sky-solo-maaned', dkk: 7900, eur: 1060, interval: 'month', metadata: { clawco: 'ja' }, transferLookupKey: false }, 'ejer-pris');
  const foer = falsk.kald.length;
  assert.equal((await koer([], { [NOEGLE_NAVN]: TEST_NOEGLE }, lavStripe)).kode, 0);

  for (const k of api.kald) {
    const a = k.args as { navn?: string; params?: { metadata?: Record<string, string> } };
    if (k.metode === 'opretUr') assert.match(a.navn!, /^clawco_tjek=k1 S\d$/);
    if (k.metode === 'opretKunde' || k.metode === 'opretAbonnement') assert.equal(a.params!.metadata![TJEK_NOEGLE], 'k1', k.metode);
  }
  for (const k of falsk.kald.slice(foer)) {
    const a = k.args as { metadata?: Record<string, string>; id?: string; produkt?: string };
    if (k.metode === 'opretProdukt' || k.metode === 'opretPris') assert.equal(a.metadata?.[TJEK_NOEGLE], 'k1', `${k.metode} ${a.id ?? a.produkt}`);
    if (k.metode === 'opdaterProdukt' || k.metode === 'arkiverPris') assert.ok(!['clawco-sky-solo'].includes(String(a.id)), 'the account\'s own product is never changed');
  }
  const ejers = (await falsk.listPriser('clawco-sky-solo'))[0]!;
  assert.equal(ejers.aktiv, true);
  assert.equal(ejers.lookupKey, 'clawco-sky-solo-maaned');
  // The run's catalogue is archived at the end (Stripe never deletes a used price).
  for (const p of await falsk.listProdukter()) if (p.id.startsWith('clawco-tjek-k1-')) assert.equal(p.aktiv, false, p.id);
});

test('a failure mid-run (a clock advance fails) still deletes every test clock the run made, and exits 1 naming the step', async () => {
  const { api, lavStripe } = simulation();
  api.fejlVed = { metode: 'fremUr', nummer: 1 };
  const r = await koer([], { [NOEGLE_NAVN]: TEST_NOEGLE }, lavStripe);
  assert.equal(r.kode, 1);
  assert.match(r.tekst, /S1 RØD: injiceret fejl i fremUr/);
  const lavet = api.kald.filter((k) => k.metode === 'opretUr').length;
  assert.equal(lavet, SCENARIER.length);
  assert.equal(api.kald.filter((k) => k.metode === 'sletUr').length, lavet);
  assert.equal((await api.listUre()).length, 0);
  assert.match(r.tekst, new RegExp(`Oprydning: ${lavet} af ${lavet} testure slettet`));
});

test('a failure before the scenarios (the catalogue cannot be made) still cleans up; a failed cleanup is a failed run', async () => {
  const { falsk, api, lavStripe } = simulation();
  falsk.fejlNaeste('opretPris', 'Stripe svarede 500');
  const r = await koer([], { [NOEGLE_NAVN]: TEST_NOEGLE }, lavStripe);
  assert.equal(r.kode, 1);
  assert.match(r.tekst, /Fejl: Stripe svarede 500/);
  assert.match(r.tekst, /Oprydning: 0 af 0 testure slettet/);

  const b = simulation();
  b.api.fejlVed = { metode: 'opretAbonnement', nummer: 2 };
  b.api.sletFejler = true;
  const r2 = await koer([], { [NOEGLE_NAVN]: TEST_NOEGLE }, b.lavStripe);
  assert.equal(r2.kode, 1);
  assert.match(r2.tekst, /oprydningen fejlede: testur clock_sim_1/);
  void api;
});

test('a Stripe error that echoes the key is masked in the output', async () => {
  const { falsk, lavStripe } = simulation();
  falsk.fejlNaeste('listProdukter', `ugyldig nøgle ${TEST_NOEGLE}`);
  const r = await koer([], { [NOEGLE_NAVN]: TEST_NOEGLE }, lavStripe);
  assert.equal(r.kode, 1);
  assert.ok(!r.tekst.includes('SENTINEL'));
});

test('the subscription is made from byggCheckout\'s own parameters: price, trial, trial end behaviour, metadata plus the run id', () => {
  const p: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription', customer: 'cus_1', currency: 'dkk', line_items: [{ price: 'price_1', quantity: 1 }],
    subscription_data: { trial_period_days: 14, trial_settings: { end_behavior: { missing_payment_method: 'pause' } }, metadata: { clawco: 'ja', konto_id: '7', plan: 'sky-solo' } },
  };
  assert.deepEqual(abonnementFraCheckout(p, 'k1'), {
    customer: 'cus_1', currency: 'dkk', items: [{ price: 'price_1', quantity: 1 }], trial_period_days: 14,
    trial_settings: { end_behavior: { missing_payment_method: 'pause' } }, payment_settings: { save_default_payment_method: 'on_subscription' },
    metadata: { clawco: 'ja', konto_id: '7', plan: 'sky-solo', clawco_tjek: 'k1' },
  });
  assert.throws(() => abonnementFraCheckout({ ...p, subscription_data: { metadata: {} } }, 'k1'), /prøveperiode/);
});

test('run ids and clock names are short and safe for product ids and lookup keys', () => {
  const k = nyKoersel(NU);
  assert.match(k, /^20261102t0900-[0-9a-f]{6}$/);
  assert.equal(urNavn(k, 'S1'), `clawco_tjek=${k} S1`);
});
