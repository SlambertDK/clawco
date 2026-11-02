// KC-0192: webhooks become entitlements. Signed or refused; idempotent by event id in the same
// transaction as the work; order-independent because every event re-reads Stripe; fail closed on
// unknown prices and customers; a gift is never touched; nothing secret or personal in the log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stativ, startProeve, haendelse, fangLog, HEMMELIGHED, EMAIL, type Stativ } from './stativ.ts';
import { antal } from '../konto/hjaelp.ts';
import { modtagWebhook, HAANDTEREDE_HAENDELSER, type WebhookDeps } from '../../src/abonnement/webhook.ts';
import { hentRettigheder, saetGave } from '../../src/abonnement/synk.ts';
import { hentKundeRaekke } from '../../src/abonnement/kunde.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { INGEN, type Rettighed } from '../../src/abonnement/rettigheder.ts';

const DAG = 86_400_000;

function deps(s: Stativ, over: Partial<WebhookDeps> = {}): WebhookDeps {
  return { db: s.db, klient: s.klient, priser: s.priser, hemmelighed: HEMMELIGHED, nu: s.u.nu, taeller: { afvist: 0 }, ...over };
}

const send = (d: WebhookDeps, h: { raw: Uint8Array; signatur: string }) => modtagWebhook(d, h.raw, h.signatur);
const raekke = async (s: Stativ): Promise<Record<string, unknown> | undefined> => (await s.db.query('SELECT * FROM abonnement.rettigheder WHERE konto_id = $1', [s.kontoId]))[0];

test('the handled event types are exactly the ticket\'s list', () => {
  assert.deepEqual([...HAANDTEREDE_HAENDELSER].sort(), [
    'checkout.session.completed', 'customer.deleted', 'customer.subscription.created', 'customer.subscription.deleted', 'customer.subscription.paused',
    'customer.subscription.resumed', 'customer.subscription.trial_will_end', 'customer.subscription.updated', 'invoice.paid', 'invoice.payment_action_required', 'invoice.payment_failed',
  ]);
});

test('no signing secret or no Stripe client: 503, never 200, and nothing is read or stored (fail closed)', async () => {
  const s = await stativ();
  await startProeve(s);
  const h = haendelse('checkout.session.completed', s.kunde);
  assert.equal((await send(deps(s, { hemmelighed: null }), h)).status, 503);
  assert.equal((await send(deps(s, { klient: null }), h)).status, 503);
  assert.equal(await antal(s.db, 'abonnement.stripe_haendelser'), 0);
  assert.equal(await raekke(s), undefined);
});

test('a bad, missing or foreign signature is 400; only the counter moves', async () => {
  const s = await stativ();
  await startProeve(s);
  const d = deps(s);
  const h = haendelse('checkout.session.completed', s.kunde);
  assert.equal((await modtagWebhook(d, h.raw, undefined)).status, 400);
  assert.equal((await modtagWebhook(d, h.raw, 't=1,v1=00')).status, 400);
  assert.equal((await send(d, haendelse('checkout.session.completed', s.kunde, { hemmelighed: 'whsec_andenKONTO' }))).status, 400);
  assert.equal((await modtagWebhook(d, Buffer.from(Buffer.from(h.raw).toString().replace(s.kunde, 'cus_anden')), h.signatur)).status, 400);
  assert.equal(d.taeller.afvist, 4);
  assert.equal(await antal(s.db, 'abonnement.stripe_haendelser'), 0);
  assert.equal(await raekke(s), undefined);
});

test('a completed trial Checkout becomes a trial entitlement, one outbox row, and the trial is marked used', async () => {
  const s = await stativ();
  const sub = await startProeve(s, 'sky-husstand');
  const r = await send(deps(s), haendelse('checkout.session.completed', s.kunde));
  assert.equal(r.status, 200);
  const ret = await hentRettigheder(s.db, s.kontoId, s.priser, s.u.nu());
  assert.deepEqual(ret, {
    kilde: 'stripe', plan: 'sky-husstand', status: 'proeve', medlemmerMax: 6, proeveSlutter: new Date(s.u.nu().getTime() + 14 * DAG).toISOString(),
    periodeSlutter: new Date(s.u.nu().getTime() + 14 * DAG).toISOString(), opsiges: null, forfaldenSiden: null, skrivebeskyttet: false, abonnement: sub,
  });
  const ud = await s.db.query<{ fra: unknown; til: Rettighed; grund: string; haendelse_id: string }>('SELECT fra, til, grund, haendelse_id FROM abonnement.rettigheds_haendelser WHERE konto_id = $1', [s.kontoId]);
  assert.equal(ud.length, 1);
  assert.equal(ud[0]!.fra, null);
  assert.equal(ud[0]!.til.status, 'proeve');
  assert.equal(ud[0]!.grund, 'checkout.session.completed');
  assert.match(ud[0]!.haendelse_id, /^evt_/);
  assert.equal((await hentKundeRaekke(s.db, s.kontoId))?.proeveBrugt, true);
});

test('the same event twice changes the row once: the second answers 200 without work', async () => {
  const s = await stativ();
  await startProeve(s);
  const h = haendelse('customer.subscription.created', s.kunde);
  assert.equal((await send(deps(s), h)).status, 200);
  const foer = await raekke(s);
  s.klient.kald.length = 0;
  const igen = await send(deps(s), h);
  assert.equal(igen.status, 200);
  assert.match(igen.svar, /dublet/);
  assert.deepEqual(await raekke(s), foer);
  assert.equal(await antal(s.db, 'abonnement.rettigheds_haendelser'), 1);
  assert.equal(await antal(s.db, 'abonnement.stripe_haendelser'), 1);
});

/** Deterministic shuffle (mulberry32). */
function bland<T>(xs: T[], frø: number): T[] {
  let a = frø;
  const r = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const ud = [...xs];
  for (let i = ud.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ud[i], ud[j]] = [ud[j]!, ud[i]!]; }
  return ud;
}

test('invariant (2): any order and any duplication of a recorded stream gives the same final row', async () => {
  const TYPER = ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.trial_will_end', 'invoice.payment_failed', 'customer.subscription.updated', 'invoice.paid', 'customer.subscription.updated'];
  async function koer(frø: number | null): Promise<Record<string, unknown>> {
    const s = await stativ();
    const sub = await startProeve(s);
    // Stripe's state by the time the events arrive: the trial ended, the card was added and paid.
    const [nu] = await s.klient.listAbonnementer(s.kunde);
    s.klient.saetAbonnement({ ...nu!, status: 'active', proeveSlut: nu!.proeveSlut, periodeSlut: new Date('2026-12-14T10:00:00Z') });
    const strøm = TYPER.map((t, i) => haendelse(t, s.kunde, { id: `evt_strøm_${i}` }));
    const raekkefoelge = frø === null ? strøm : bland([...strøm, ...bland(strøm, frø).slice(0, 4)], frø);
    for (const h of raekkefoelge) assert.equal((await send(deps(s), h)).status, 200);
    const r = (await raekke(s))!;
    assert.equal(r['stripe_abonnement'], sub);
    const { opdateret: _o, konto_id: _k, ...rest } = r;
    return rest;
  }
  const facit = await koer(null);
  assert.equal(facit['status'], 'aktiv');
  for (const frø of [1, 2, 3, 42, 1337]) assert.deepEqual(await koer(frø), facit, `frø ${frø}`);
});

test('an event that arrives late cannot overwrite newer state: the handler reads Stripe, not the event', async () => {
  const s = await stativ();
  await startProeve(s);
  const [ab] = await s.klient.listAbonnementer(s.kunde);
  s.klient.saetAbonnement({ ...ab!, status: 'past_due', forfaldenSiden: s.u.nu() });
  await send(deps(s), haendelse('invoice.payment_failed', s.kunde));
  s.klient.saetAbonnement({ ...ab!, status: 'active' });
  await send(deps(s), haendelse('invoice.paid', s.kunde));
  // The old "trial started" event arrives last.
  await send(deps(s), haendelse('customer.subscription.created', s.kunde));
  assert.equal((await hentRettigheder(s.db, s.kontoId, s.priser, s.u.nu())).status, 'aktiv');
});

test('event types we do not handle answer 200 and are ignored', async () => {
  const s = await stativ();
  const r = await send(deps(s), haendelse('charge.refunded', s.kunde));
  assert.equal(r.status, 200);
  assert.equal(await antal(s.db, 'abonnement.stripe_haendelser'), 0);
});

test('a customer we do not know, or whose metadata names another account, is logged and answered 200; nothing is written', async () => {
  const s = await stativ();
  const fremmed = await s.klient.opretKunde({ kontoId: s.kontoId, email: 'x@example.test', sprog: 'da' }, 'fremmed');
  const { log } = await fangLog(async () => {
    assert.equal((await send(deps(s), haendelse('customer.subscription.updated', 'cus_ukendt'))).status, 200);
    assert.equal((await send(deps(s), haendelse('customer.subscription.updated', fremmed.id))).status, 200);
  });
  assert.match(log, /ukendt kunde/);
  assert.equal(await raekke(s), undefined);
  // Our own customer, but Stripe's metadata says another account: refused as well.
  const { konto: anden } = await findEllerOpretKonto(s.db, 'anden@example.test', s.u.nu());
  const loegn = await s.klient.opretKunde({ kontoId: anden.id, email: 'y@example.test', sprog: 'da' }, 'loegn');
  await s.db.query('UPDATE abonnement.kunde SET stripe_kunde = $1 WHERE konto_id = $2', [loegn.id, s.kontoId]);
  await startProeve({ ...s, kunde: loegn.id });
  assert.equal((await send(deps(s), haendelse('customer.subscription.created', loegn.id))).status, 200);
  assert.equal(await raekke(s), undefined);
});

test('a deleted Stripe customer has no metadata: our own customer table maps it, and the entitlement ends', async () => {
  const s = await stativ();
  await startProeve(s);
  await send(deps(s), haendelse('checkout.session.completed', s.kunde));
  s.klient.sletKunde(s.kunde);
  assert.equal((await send(deps(s), haendelse('customer.deleted', s.kunde))).status, 200);
  const r = await hentRettigheder(s.db, s.kontoId, s.priser, s.u.nu());
  assert.equal(r.status, 'opsagt');
  assert.equal(r.plan, 'ingen');
});

test('an unknown price grants nothing new: the row stays, an alert is logged, no outbox row', async () => {
  const s = await stativ();
  await startProeve(s);
  await send(deps(s), haendelse('checkout.session.completed', s.kunde));
  const foer = await raekke(s);
  const [ab] = await s.klient.listAbonnementer(s.kunde);
  s.klient.saetAbonnement({ ...ab!, status: 'active', lookupKey: 'clawco-sky-guld-maaned', prisId: 'price_guld', prisPlan: null });
  const { log } = await fangLog(() => send(deps(s), haendelse('customer.subscription.updated', s.kunde)));
  assert.match(log, /ukendt pris/);
  assert.deepEqual(await raekke(s), foer);
  assert.equal(await antal(s.db, 'abonnement.rettigheds_haendelser'), 1);
});

test('a gift is never overwritten by a webhook, not even by a cancellation', async () => {
  const s = await stativ();
  await saetGave(s.db, s.kontoId, 'sky-husstand', s.priser, s.u.nu());
  await startProeve(s);
  const [ab] = await s.klient.listAbonnementer(s.kunde);
  s.klient.saetAbonnement({ ...ab!, status: 'canceled' });
  for (const t of ['checkout.session.completed', 'customer.subscription.deleted']) assert.equal((await send(deps(s), haendelse(t, s.kunde))).status, 200);
  const r = await hentRettigheder(s.db, s.kontoId, s.priser, s.u.nu());
  assert.equal(r.kilde, 'gave');
  assert.equal(r.plan, 'sky-husstand');
  assert.equal(r.status, 'aktiv');
  assert.equal(r.medlemmerMax, 6);
  assert.deepEqual((await s.db.query('SELECT grund FROM abonnement.rettigheds_haendelser')).map((x) => x['grund']), ['gave']);
  await assert.rejects(saetGave(s.db, s.kontoId, 'sky-guld', s.priser, s.u.nu()), /plan/);
});

test('a Stripe failure mid-processing answers 500 and records nothing, so Stripe\'s retry processes it cleanly', async () => {
  const s = await stativ();
  await startProeve(s);
  const h = haendelse('checkout.session.completed', s.kunde);
  s.klient.fejlNaeste('listAbonnementer', 'netværksfejl');
  const { r } = await fangLog(() => send(deps(s), h));
  assert.equal(r.status, 500);
  assert.equal(await antal(s.db, 'abonnement.stripe_haendelser'), 0);
  assert.equal((await send(deps(s), h)).status, 200);
  assert.equal((await hentRettigheder(s.db, s.kontoId, s.priser, s.u.nu())).status, 'proeve');
});

test('no secret, no payload body and no email address reach the log', async () => {
  const s = await stativ();
  await startProeve(s);
  const h = haendelse('checkout.session.completed', s.kunde);
  const { log } = await fangLog(async () => {
    await send(deps(s), h);
    await send(deps(s), h);
    await send(deps(s), haendelse('checkout.session.completed', s.kunde, { hemmelighed: 'whsec_forkertSENTINEL' }));
    await send(deps(s), haendelse('customer.subscription.updated', 'cus_ukendt'));
  });
  assert.ok(log.length > 0, 'handleren logger noget');
  assert.ok(!log.includes('SENTINEL'), 'en hemmelighed er i loggen');
  assert.ok(!log.includes('whsec_'), 'en webhook-hemmelighed er i loggen');
  assert.ok(!log.includes(EMAIL), 'en mailadresse er i loggen');
  assert.ok(!log.includes('"data"') && !log.includes('"object"'), 'en hændelseskrop er i loggen');
});

test('hentRettigheder: an account without a row has none; overdue turns read-only as days pass without an event', async () => {
  const s = await stativ();
  assert.deepEqual(await hentRettigheder(s.db, s.kontoId, s.priser, s.u.nu()), INGEN);
  await startProeve(s);
  const [ab] = await s.klient.listAbonnementer(s.kunde);
  s.klient.saetAbonnement({ ...ab!, status: 'past_due', forfaldenSiden: s.u.nu() });
  await send(deps(s), haendelse('invoice.payment_failed', s.kunde));
  assert.equal((await hentRettigheder(s.db, s.kontoId, s.priser, s.u.nu())).skrivebeskyttet, false);
  assert.equal((await hentRettigheder(s.db, s.kontoId, s.priser, new Date(s.u.nu().getTime() + s.priser.fristVedFejl * DAG))).skrivebeskyttet, true);
});
