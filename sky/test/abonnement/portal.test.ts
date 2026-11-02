// KC-0195: the Stripe customer portal as code. The configuration is a pure function of config/priser.json and the
// public URL (the four prices, plan change with proration, cancel at period end with Stripe's own reasons, invoices,
// card, customer details); stripe:opsaet creates it, a second run writes nothing, a changed config updates it in place,
// and configurations without the clawco marker (ShelfAtlas shares the account) are never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laesPriser, type Priser } from '../../src/abonnement/priser.ts';
import { FalskBetalingsKlient } from '../../src/abonnement/falsk.ts';
import { anvend, koerOpsaet, lookupKey, planlaeg } from '../../src/abonnement/opsaet.ts';
import { anvendPortal, byggPortalKonfiguration, opsaetPortal, planlaegPortal, portalKonfiguration } from '../../src/abonnement/portal.ts';

const RETUR = 'https://sky.example.test/konto/abonnement';
const config = (): Priser => structuredClone(laesPriser());

async function medPriser(p: Priser = config()): Promise<FalskBetalingsKlient> {
  const k = new FalskBetalingsKlient('test');
  await anvend((await planlaeg(p, k)).skridt, k);
  return k;
}

async function prisIds(k: FalskBetalingsKlient, p: Priser): Promise<Record<string, string>> {
  const ud: Record<string, string> = {};
  for (const plan of Object.keys(p.planer)) for (const i of ['maaned', 'aar'] as const) ud[lookupKey(plan, i)] = (await k.prisForLookupKey(lookupKey(plan, i)))!.id;
  return ud;
}

test('the portal configuration follows the config: four prices, proration, cancel at period end with Stripe\'s reasons, invoices, card, details', async () => {
  const p = config();
  const k = await medPriser(p);
  const ids = await prisIds(k, p);
  const { metadata, ...resten } = byggPortalKonfiguration(p, ids, RETUR);
  assert.deepEqual(resten, {
    name: 'Clawco',
    default_return_url: RETUR,
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ['email', 'name', 'address', 'tax_id'] },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price'],
        proration_behavior: 'create_prorations',
        schedule_at_period_end: { conditions: [{ type: 'decreasing_item_amount' }, { type: 'shortening_interval' }] },
        trial_update_behavior: 'continue_trial',
        products: [
          { product: 'clawco-sky-solo', prices: [ids['clawco-sky-solo-maaned'], ids['clawco-sky-solo-aar']] },
          { product: 'clawco-sky-husstand', prices: [ids['clawco-sky-husstand-maaned'], ids['clawco-sky-husstand-aar']] },
        ],
      },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end',
        cancellation_reason: { enabled: true, options: ['too_expensive', 'missing_features', 'switched_service', 'unused', 'customer_service', 'too_complex', 'low_quality', 'other'] },
      },
    },
  });
  assert.equal(metadata?.['clawco'], 'ja');
  assert.match(String(metadata?.['clawco_konfig']), /^[0-9a-f]{40}$/);
  assert.deepEqual(byggPortalKonfiguration(p, ids, RETUR), byggPortalKonfiguration(p, ids, RETUR), 'deterministic');
  assert.notEqual(byggPortalKonfiguration(p, ids, `${RETUR}?x`).metadata?.['clawco_konfig'], metadata?.['clawco_konfig'], 'the fingerprint follows the content');
  assert.throws(() => byggPortalKonfiguration(p, { ...ids, 'clawco-sky-solo-aar': '' }, RETUR), /clawco-sky-solo-aar/);
});

test('setup creates the configuration once; a second run plans nothing and writes nothing', async () => {
  const p = config();
  const k = await medPriser(p);
  const plan = await planlaegPortal(p, k, RETUR);
  assert.equal(plan.status, 'klar');
  assert.deepEqual(plan.status === 'klar' && plan.skridt.map((s) => s.type), ['opret-portal']);
  await anvendPortal(plan.status === 'klar' ? plan.skridt : [], k);
  const id = await portalKonfiguration(k);
  assert.match(String(id), /^bpc_/);
  const skrevet = k.skrivninger;
  const igen = await planlaegPortal(p, k, RETUR);
  assert.deepEqual(igen.status === 'klar' && igen.skridt, []);
  assert.equal(k.skrivninger, skrevet);
  const opret = k.kald.find((c) => c.metode === 'opretPortalKonfiguration');
  assert.match(String(opret?.idempotensNoegle), /^clawco-portal-[0-9a-f]{40}$/);
});

test('a changed config (a new price) updates the same configuration in place, which then offers the new price', async () => {
  const p = config();
  const k = await medPriser(p);
  await opsaetPortal(p, k, RETUR);
  const id = await portalKonfiguration(k);
  p.planer['sky-solo']!.maanedlig.dkk += 100;
  await anvend((await planlaeg(p, k)).skridt, k);
  const plan = await planlaegPortal(p, k, RETUR);
  assert.deepEqual(plan.status === 'klar' && plan.skridt.map((s) => [s.type, 'id' in s ? s.id : null]), [['opdater-portal', id]]);
  await anvendPortal(plan.status === 'klar' ? plan.skridt : [], k);
  assert.equal(await portalKonfiguration(k), id);
  const ny = (await k.prisForLookupKey(lookupKey('sky-solo', 'maaned')))!.id;
  assert.ok(JSON.stringify(k.portalParams(id!)).includes(ny), 'the new price is offered');
  assert.deepEqual(((await planlaegPortal(p, k, RETUR)) as { skridt: unknown[] }).skridt, []);
});

test('a configuration without the clawco marker (ShelfAtlas) is never read as ours nor touched; extra Clawco ones are deactivated', async () => {
  const p = config();
  const k = await medPriser(p);
  const fremmed = k.tilfoejPortalKonfiguration({ metadata: {} });
  assert.equal(await portalKonfiguration(k), null, 'the shared account\'s default portal is never used');
  await opsaetPortal(p, k, RETUR);
  const ekstra = k.tilfoejPortalKonfiguration({ metadata: { clawco: 'ja', clawco_konfig: 'gammel' } });
  const plan = await planlaegPortal(p, k, RETUR);
  assert.deepEqual(plan.status === 'klar' && plan.skridt, [{ type: 'deaktiver-portal', id: ekstra }]);
  await anvendPortal(plan.status === 'klar' ? plan.skridt : [], k);
  assert.ok(!k.kald.some((c) => JSON.stringify(c.args).includes(fremmed)), 'ShelfAtlas\' configuration is untouched');
  assert.notEqual(await portalKonfiguration(k), ekstra);
});

test('before the prices exist the portal waits for them (dry run on an empty account)', async () => {
  const k = new FalskBetalingsKlient('test');
  const plan = await planlaegPortal(config(), k, RETUR);
  assert.equal(plan.status, 'venter');
  assert.equal(k.skrivninger, 0);
});

// --- through the command -------------------------------------------------------------------------------

const TEST_NOEGLE = 'rk_test_SENTINELhemmelig0123456789'; // gitleaks:allow

async function koer(argv: string[], env: Record<string, string | undefined>, klient: FalskBetalingsKlient) {
  const linjer: string[] = [];
  const kode = await koerOpsaet({ argv, env, skriv: (l) => linjer.push(l), lavKlient: () => klient });
  const ud = linjer.join('\n');
  assert.ok(!ud.includes('SENTINEL'));
  return { kode, ud };
}

test('stripe:opsaet --anvend sets up the portal with SKY_PUBLIC_URL; a second run reports it unchanged; a dry run writes nothing', async () => {
  const k = new FalskBetalingsKlient('test');
  const env = { SKY_STRIPE_SECRET_KEY: TEST_NOEGLE, SKY_PUBLIC_URL: 'https://sky.example.test' };
  const tor = await koer([], env, k);
  assert.equal(tor.kode, 0);
  assert.equal(k.skrivninger, 0);
  assert.match(tor.ud, /Kundeportalen: .*når priserne er anvendt/);
  const a = await koer(['--anvend'], env, k);
  assert.equal(a.kode, 0, a.ud);
  assert.match(a.ud, /Kundeportalen: opret/);
  assert.equal(k.portalParams((await portalKonfiguration(k))!)?.default_return_url, RETUR);
  const skrevet = k.skrivninger;
  const b = await koer(['--anvend'], env, k);
  assert.match(b.ud, /Kundeportalen: uændret/);
  assert.equal(k.skrivninger, skrevet);
});

test('stripe:opsaet without SKY_PUBLIC_URL says the portal was not set up; a malformed one exits 1 before any write', async () => {
  const k = new FalskBetalingsKlient('test');
  const r = await koer(['--anvend'], { SKY_STRIPE_SECRET_KEY: TEST_NOEGLE }, k);
  assert.equal(r.kode, 0);
  assert.match(r.ud, /Kundeportalen: SKY_PUBLIC_URL mangler/);
  assert.equal(await portalKonfiguration(k), null);
  const m = new FalskBetalingsKlient('test');
  const f = await koer(['--anvend'], { SKY_STRIPE_SECRET_KEY: TEST_NOEGLE, SKY_PUBLIC_URL: 'ftp://sky.example.test' }, m);
  assert.equal(f.kode, 1);
  assert.match(f.ud, /SKY_PUBLIC_URL/);
  assert.equal(m.skrivninger, 0);
});
