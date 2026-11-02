// KC-0190 invariants: (1) the Stripe objects are a pure function of config/priser.json — the
// expected list is built from the config and compared with what the fake received; a second run
// writes nothing; a changed amount makes a new price and archives the old; nothing is deleted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laesPriser } from '../../src/abonnement/priser.ts';
import type { Priser } from '../../src/abonnement/priser.ts';
import { FalskBetalingsKlient } from '../../src/abonnement/falsk.ts';
import { anvend, beskriv, forventedeObjekter, koerOpsaet, lookupKey, planlaeg, produktId } from '../../src/abonnement/opsaet.ts';

const config = (): Priser => structuredClone(laesPriser());

async function opsaet(p: Priser, k: FalskBetalingsKlient) {
  const plan = await planlaeg(p, k);
  await anvend(plan.skridt, k);
  return plan;
}

/** What the fake holds, in the shape of forventedeObjekter. */
async function iStripe(k: FalskBetalingsKlient) {
  const produkter = (await k.listProdukter()).filter((p) => p.aktiv);
  const priser = (await Promise.all(produkter.map((p) => k.listPriser(p.id)))).flat().filter((p) => p.aktiv);
  return {
    produkter: produkter.map((p) => ({ id: p.id, navn: p.navn, metadata: p.metadata })).sort((a, b) => a.id.localeCompare(b.id)),
    priser: priser.map((p) => ({ produkt: p.produkt, lookupKey: p.lookupKey, dkk: p.dkk, eur: p.eur, interval: p.interval, metadata: p.metadata })).sort((a, b) => String(a.lookupKey).localeCompare(String(b.lookupKey))),
  };
}

function forventet(p: Priser) {
  const f = forventedeObjekter(p);
  return {
    produkter: f.produkter.map((x) => ({ id: x.id, navn: x.navn, metadata: x.metadata })).sort((a, b) => a.id.localeCompare(b.id)),
    priser: f.priser.map((x) => ({ produkt: x.produkt, lookupKey: x.lookupKey, dkk: x.dkk, eur: x.eur, interval: x.interval, metadata: x.metadata })).sort((a, b) => a.lookupKey.localeCompare(b.lookupKey)),
  };
}

test('ids and lookup keys are clawco-prefixed (shared account) and stable', () => {
  assert.equal(produktId('sky-solo'), 'clawco-sky-solo');
  assert.equal(lookupKey('sky-solo', 'maaned'), 'clawco-sky-solo-maaned');
  assert.equal(lookupKey('sky-husstand', 'aar'), 'clawco-sky-husstand-aar');
});

test('the expected objects follow the config: two products, four prices, DKK with EUR, no tax behaviour', () => {
  const f = forventedeObjekter(config());
  assert.deepEqual(f.produkter.map((p) => [p.id, p.navn, p.metadata]), [
    ['clawco-sky-solo', 'Clawco Sky Solo', { clawco: 'ja', clawco_plan: 'sky-solo' }],
    ['clawco-sky-husstand', 'Clawco Sky Husstand', { clawco: 'ja', clawco_plan: 'sky-husstand' }],
  ]);
  assert.deepEqual(f.priser.map((p) => [p.lookupKey, p.produkt, p.dkk, p.eur, p.interval]), [
    ['clawco-sky-solo-maaned', 'clawco-sky-solo', 7900, 1060, 'month'],
    ['clawco-sky-solo-aar', 'clawco-sky-solo', 79000, 10600, 'year'],
    ['clawco-sky-husstand-maaned', 'clawco-sky-husstand', 12900, 1730, 'month'],
    ['clawco-sky-husstand-aar', 'clawco-sky-husstand', 129000, 17300, 'year'],
  ]);
  for (const p of f.priser) assert.deepEqual(p.metadata, { clawco: 'ja', clawco_plan: p.produkt.replace('clawco-', ''), clawco_interval: p.lookupKey.endsWith('-aar') ? 'aar' : 'maaned' });
  for (const p of f.priser) assert.ok(!('taxBehavior' in p) && !('tax_behavior' in p));
});

test('invariant (1): after a run on an empty account, Stripe holds exactly the expected objects', async () => {
  const k = new FalskBetalingsKlient('test');
  await opsaet(config(), k);
  assert.deepEqual(await iStripe(k), forventet(config()));
});

test('every create carries an idempotency key, and the keys are distinct', async () => {
  const k = new FalskBetalingsKlient('test');
  await opsaet(config(), k);
  const opret = k.kald.filter((c) => c.metode.startsWith('opret'));
  assert.equal(opret.length, 6);
  for (const c of opret) assert.ok(c.idempotensNoegle && c.idempotensNoegle.length >= 16);
  assert.equal(new Set(opret.map((c) => c.idempotensNoegle)).size, 6);
});

test('idempotent: a second run plans nothing and writes nothing', async () => {
  const k = new FalskBetalingsKlient('test');
  await opsaet(config(), k);
  const foer = k.skrivninger;
  const anden = await opsaet(config(), k);
  assert.deepEqual(anden.skridt, []);
  assert.equal(k.skrivninger, foer);
  assert.equal(anden.uaendrede, 6);
});

test('a changed amount creates a new price that takes the lookup key, and archives the old one', async () => {
  const k = new FalskBetalingsKlient('test');
  await opsaet(config(), k);
  const gammel = (await k.listPriser('clawco-sky-solo')).find((p) => p.lookupKey === 'clawco-sky-solo-maaned')!;
  const ny = config();
  ny.planer['sky-solo']!.maanedlig.dkk = 8900;
  const plan = await opsaet(ny, k);
  const opret = k.kald.filter((c) => c.metode === 'opretPris').at(-1)!;
  assert.equal((opret.args as { transferLookupKey: boolean }).transferLookupKey, true);
  assert.deepEqual(k.kald.filter((c) => c.metode === 'arkiverPris').map((c) => (c.args as { id: string }).id), [gammel.id]);
  assert.deepEqual(await iStripe(k), forventet(ny));
  assert.ok(k.allePriser().some((p) => p.id === gammel.id && !p.aktiv), 'den gamle pris er arkiveret, ikke slettet');
  assert.ok(beskriv(plan.skridt).some((l) => /eksisterende abonnenter/i.test(l)), 'outputtet siger, at eksisterende abonnenter beholder den gamle pris');
});

test('a changed EUR amount alone also replaces the price', async () => {
  const k = new FalskBetalingsKlient('test');
  await opsaet(config(), k);
  const ny = config();
  ny.planer['sky-husstand']!.aarlig.eur = 17500;
  const plan = await opsaet(ny, k);
  assert.deepEqual(plan.skridt.map((s) => s.type), ['opret-pris', 'arkiver-pris']);
  assert.deepEqual(await iStripe(k), forventet(ny));
});

test('reverting an amount creates a third price under a new idempotency key (no stale replay)', async () => {
  const k = new FalskBetalingsKlient('test');
  await opsaet(config(), k);
  const ny = config();
  ny.planer['sky-solo']!.maanedlig.dkk = 8900;
  await opsaet(ny, k);
  await opsaet(config(), k);
  assert.deepEqual(await iStripe(k), forventet(config()));
  assert.equal(k.allePriser().filter((p) => p.produkt === 'clawco-sky-solo' && p.interval === 'month').length, 3);
});

test('a renamed plan name updates the product in place', async () => {
  const k = new FalskBetalingsKlient('test');
  await opsaet(config(), k);
  const ny = config();
  ny.planer['sky-solo']!.navn = 'Sky Alene';
  const plan = await opsaet(ny, k);
  assert.deepEqual(plan.skridt.map((s) => s.type), ['opdater-produkt']);
  assert.equal((await k.listProdukter()).find((p) => p.id === 'clawco-sky-solo')?.navn, 'Clawco Sky Alene');
});

test('a plan removed from the config is archived with its prices, never deleted', async () => {
  const k = new FalskBetalingsKlient('test');
  await opsaet(config(), k);
  const ny = config();
  delete ny.planer['sky-husstand'];
  await opsaet(ny, k);
  assert.deepEqual(await iStripe(k), forventet(ny));
  const husstand = (await k.listProdukter()).find((p) => p.id === 'clawco-sky-husstand');
  assert.equal(husstand?.aktiv, false, 'produktet findes stadig, arkiveret');
  assert.equal(k.allePriser().filter((p) => p.produkt === 'clawco-sky-husstand').length, 2);
  assert.ok(!k.kald.some((c) => /slet|delete/i.test(c.metode)));
});

test('an archived product that is back in the config is reactivated', async () => {
  const k = new FalskBetalingsKlient('test');
  await opsaet(config(), k);
  const uden = config();
  delete uden.planer['sky-husstand'];
  await opsaet(uden, k);
  await opsaet(config(), k);
  assert.deepEqual(await iStripe(k), forventet(config()));
});

test('a stray active price on a Clawco product (no lookup key) is archived', async () => {
  const k = new FalskBetalingsKlient('test');
  await opsaet(config(), k);
  await k.opretPris({ produkt: 'clawco-sky-solo', navn: 'løs', lookupKey: 'clawco-loes', dkk: 1, eur: 1, interval: 'month', metadata: { clawco: 'ja' }, transferLookupKey: false }, 'loes');
  const plan = await opsaet(config(), k);
  assert.deepEqual(plan.skridt.map((s) => s.type), ['arkiver-pris']);
  assert.deepEqual(await iStripe(k), forventet(config()));
});

test('products without the clawco marker (ShelfAtlas) are never touched', async () => {
  const shelf = { id: 'prod_shelf', navn: 'ShelfAtlas Pro', aktiv: true, metadata: {} };
  const k = new FalskBetalingsKlient('test', { produkter: [shelf], priser: [{ id: 'price_shelf', produkt: 'prod_shelf', aktiv: true, lookupKey: 'shelf-pro', dkk: 4900, eur: null, interval: 'month', metadata: {} }] });
  await opsaet(config(), k);
  assert.ok(!k.kald.some((c) => JSON.stringify(c.args).includes('shelf')));
});

test('a run that failed halfway converges on the next run', async () => {
  const k = new FalskBetalingsKlient('test');
  k.fejlNaeste('opretPris', 'netværksfejl');
  await assert.rejects(opsaet(config(), k), /netværksfejl/);
  await opsaet(config(), k);
  assert.deepEqual(await iStripe(k), forventet(config()));
  assert.deepEqual((await planlaeg(config(), k)).skridt, []);
});

test('beskriv names objects and counts, in Danish', async () => {
  const k = new FalskBetalingsKlient('test');
  const plan = await planlaeg(config(), k);
  const linjer = beskriv(plan.skridt);
  assert.ok(linjer.some((l) => l.includes('clawco-sky-solo') && /opret/i.test(l)));
  assert.ok(linjer.some((l) => l.includes('clawco-sky-husstand-aar') && l.includes('1.290,00 kr') && l.includes('173,00 EUR')));
});

// --- the command (npm run stripe:opsaet) ---

const TEST_NOEGLE = 'rk_test_SENTINELhemmelig0123456789';
const LIVE_NOEGLE = 'rk_live_SENTINELhemmelig0123456789';

async function koer(argv: string[], env: Record<string, string | undefined>, opts: { klient?: FalskBetalingsKlient; priser?: Priser } = {}) {
  const linjer: string[] = [];
  let lavet = 0;
  const klient = opts.klient;
  const kode = await koerOpsaet({
    argv,
    env,
    skriv: (l) => linjer.push(l),
    lavKlient: (n) => { lavet++; assert.equal(n, env['SKY_STRIPE_SECRET_KEY']); return klient ?? new FalskBetalingsKlient(n.startsWith('rk_live_') ? 'live' : 'test'); },
    ...(opts.priser ? { priser: opts.priser } : {}),
  });
  const ud = linjer.join('\n');
  assert.ok(!ud.includes('SENTINEL'), `outputtet viser nøglen:\n${ud}`);
  return { kode, ud, lavet };
}

test('the command is a dry run by default: it prints the plan and writes nothing', async () => {
  const k = new FalskBetalingsKlient('test');
  const r = await koer([], { SKY_STRIPE_SECRET_KEY: TEST_NOEGLE }, { klient: k });
  assert.equal(r.kode, 0);
  assert.equal(k.skrivninger, 0);
  assert.match(r.ud, /test-tilstand/);
  assert.match(r.ud, /tør kørsel/i);
  assert.match(r.ud, /6 ændringer/);
  for (const lk of ['clawco-sky-solo-maaned', 'clawco-sky-solo-aar', 'clawco-sky-husstand-maaned', 'clawco-sky-husstand-aar']) assert.ok(r.ud.includes(lk), lk);
  assert.match(r.ud, /--anvend/);
});

test('--anvend applies, checks the result, and a second run reports zero changes', async () => {
  const k = new FalskBetalingsKlient('test');
  const a = await koer(['--anvend'], { SKY_STRIPE_SECRET_KEY: TEST_NOEGLE }, { klient: k });
  assert.equal(a.kode, 0, a.ud);
  assert.deepEqual(await iStripe(k), forventet(config()));
  assert.match(a.ud, /svarer nu til prisfilen/);
  const skrevet = k.skrivninger;
  const b = await koer(['--anvend'], { SKY_STRIPE_SECRET_KEY: TEST_NOEGLE }, { klient: k });
  assert.equal(b.kode, 0);
  assert.equal(k.skrivninger, skrevet);
  assert.match(b.ud, /0 ændringer/);
});

test('invariant (2): --anvend with a live key is refused unless the prices are approved AND SKY_STRIPE_LIVE_OK=ja', async () => {
  const udkast = config();
  udkast.status = 'udkast';
  for (const [env, priser] of [
    [{ SKY_STRIPE_SECRET_KEY: LIVE_NOEGLE }, config()],
    [{ SKY_STRIPE_SECRET_KEY: LIVE_NOEGLE, SKY_STRIPE_LIVE_OK: 'ja' }, udkast],
    [{ SKY_STRIPE_SECRET_KEY: LIVE_NOEGLE, SKY_STRIPE_LIVE_OK: 'yes' }, config()],
  ] as const) {
    const k = new FalskBetalingsKlient('live');
    const r = await koer(['--anvend'], env, { klient: k, priser });
    assert.equal(r.kode, 1);
    assert.equal(k.skrivninger, 0);
    assert.match(r.ud, /live/i);
  }
  const k = new FalskBetalingsKlient('live');
  const ok = await koer(['--anvend'], { SKY_STRIPE_SECRET_KEY: LIVE_NOEGLE, SKY_STRIPE_LIVE_OK: 'ja' }, { klient: k });
  assert.equal(ok.kode, 0, ok.ud);
  assert.equal(k.skrivninger, 6);
});

test('a live dry run only reads, and test mode has no live block', async () => {
  const live = new FalskBetalingsKlient('live');
  const r = await koer([], { SKY_STRIPE_SECRET_KEY: LIVE_NOEGLE }, { klient: live });
  assert.equal(r.kode, 0);
  assert.equal(live.skrivninger, 0);
  const udkast = config();
  udkast.status = 'udkast';
  const t = new FalskBetalingsKlient('test');
  assert.equal((await koer(['--anvend'], { SKY_STRIPE_SECRET_KEY: TEST_NOEGLE }, { klient: t, priser: udkast })).kode, 0);
});

test('invariant (3): a missing or malformed key exits 1 before any client exists', async () => {
  for (const env of [{}, { SKY_STRIPE_SECRET_KEY: '' }, { SKY_STRIPE_SECRET_KEY: 'sk_live_SENTINELhemmelig0123456789' }, { SKY_STRIPE_SECRET_KEY: 'SENTINELhemmelig' }]) {
    const r = await koer(['--anvend'], env);
    assert.equal(r.kode, 1);
    assert.equal(r.lavet, 0);
    assert.match(r.ud, /SKY_STRIPE_SECRET_KEY/);
  }
});

test('an unknown flag exits 1 without touching Stripe (a typo of --anvend must not dry-run silently)', async () => {
  const r = await koer(['--anvent'], { SKY_STRIPE_SECRET_KEY: TEST_NOEGLE });
  assert.equal(r.kode, 1);
  assert.equal(r.lavet, 0);
  assert.match(r.ud, /--anvent/);
});

test('a client whose mode disagrees with the key prefix is refused', async () => {
  const r = await koer(['--anvend'], { SKY_STRIPE_SECRET_KEY: TEST_NOEGLE }, { klient: new FalskBetalingsKlient('live') });
  assert.equal(r.kode, 1);
});

test('a Stripe error exits 1 and never shows the key, even when the error text contains it', async () => {
  const k = new FalskBetalingsKlient('test');
  k.fejlNaeste('opretPris', `Invalid API Key provided: ${TEST_NOEGLE}`);
  const r = await koer(['--anvend'], { SKY_STRIPE_SECRET_KEY: TEST_NOEGLE }, { klient: k });
  assert.equal(r.kode, 1);
  assert.match(r.ud, /Invalid API Key provided/);
  assert.match(r.ud, /kør igen/i);
});

test('the command lists account settings the API cannot set: unset ones by name, the unreadable ones as a checklist', async () => {
  const k = new FalskBetalingsKlient('test');
  k.konto = ['Virksomhedsnavn', 'Support-e-mail'];
  const r = await koer([], { SKY_STRIPE_SECRET_KEY: TEST_NOEGLE }, { klient: k });
  assert.match(r.ud, /Virksomhedsnavn/);
  assert.match(r.ud, /Support-e-mail/);
  assert.match(r.ud, /Smart Retries/);
  const u = new FalskBetalingsKlient('test');
  u.konto = null;
  assert.match((await koer([], { SKY_STRIPE_SECRET_KEY: TEST_NOEGLE }, { klient: u })).ud, /kan ikke læse/i);
});
