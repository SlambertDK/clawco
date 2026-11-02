import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSkyApp, kontoDeps, flaadeFra, forbind, fordeler } from '../src/server.ts';
import { FROE as GW_FROE, OFFENTLIG as GW_OFFENTLIG } from './gateway/hjaelp.ts';
import { laesConfig } from '../src/config.ts';
import { pgliteDatabase } from './pglite.ts';
import { migrer } from '../src/db/migrer.ts';
import { FalskBetalingsKlient } from '../src/abonnement/falsk.ts';
import { findEllerOpretKonto } from '../src/konto/konto.ts';
import { sikrKunde } from '../src/abonnement/kunde.ts';

const ENV = { SKY_DATABASE_URL: 'postgres:///sky', SKY_PUBLIC_URL: 'https://konto.example.test' };

test('production wiring without SKY_RESEND_API_KEY: Post refuses (fail closed) and there is no outbox', async () => {
  const db = await pgliteDatabase();
  const d = kontoDeps(laesConfig(ENV), db, undefined, undefined, ENV);
  assert.equal(d.dev, false);
  assert.equal(d.udbakke, null);
  await assert.rejects(d.post.send({ til: 'a@example.test', skabelon: 'maillink', data: { link: 'https://konto.example.test/log-ind/link?t=x', minutter: '15' } }));
  assert.deepEqual(d.rp, { id: 'konto.example.test', navn: 'Clawco', origin: 'https://konto.example.test' });
  await db.close();
});

test('dev wiring (SKY_DEV=1): the fake Post and its outbox', async () => {
  const db = await pgliteDatabase();
  const d = kontoDeps(laesConfig({ ...ENV, SKY_DEV: '1' }), db);
  await d.post.send({ til: 'a@example.test', skabelon: 'maillink', data: { link: 'https://konto.example.test/log-ind/link?t=x', minutter: '15' } });
  assert.equal(d.udbakke?.length, 1);
  await db.close();
});

test('the account app is mounted beside /health', async () => {
  const db = await pgliteDatabase();
  await migrer(db);
  const app = createSkyApp({ db, sha: 'x', startet: Date.now(), konto: kontoDeps(laesConfig(ENV), db) });
  assert.equal((await app.request('/health')).status, 200);
  const r = await app.request('/log-ind');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Log ind på Clawco/);
  await db.close();
});

const PUBKEY = 'A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg';
const LOKAL = { ...ENV, SKY_FLAADE: 'lokal', SKY_TENANT_BILLEDE: 'clawco:test', SKY_KONTO_PUBKEY: PUBKEY };

test('KC-0212: deprovisioning stays refused unless a fleet is chosen; lokal wires the fleet-backed afvikler; hetzner refuses to provision', async () => {
  const db = await pgliteDatabase();
  await migrer(db);
  await assert.rejects(kontoDeps(laesConfig(ENV), db).afvikler.afprovisioner('a1'), /KC-0182/);
  assert.equal(flaadeFra(laesConfig(ENV)), null);
  assert.equal(flaadeFra(laesConfig(LOKAL))?.navn, 'lokal');
  const h = flaadeFra(laesConfig({ ...ENV, SKY_FLAADE: 'hetzner' }));
  assert.equal(h?.navn, 'hetzner');
  await assert.rejects(h!.klargoer({ id: 'hus-abcdefgh', ejer: 'a@example.test' }), /slukket/);
  // A fleet-backed afvikler never claims to delete a tenant it has no row for.
  await assert.rejects(kontoDeps(laesConfig(LOKAL), db).afvikler.afprovisioner('hus-abcdefgh'), /ukendt/);
  await db.close();
});

test('KC-0182: with a fleet, forbind hands out the reconciler (entitled accounts from billing), the owner household seam and the /konto line', async () => {
  const db = await pgliteDatabase();
  await migrer(db);
  const ingen = await forbind(laesConfig(ENV), db, {});
  assert.equal(ingen.flaade, null);
  assert.equal(ingen.konto.clawco, undefined);
  const f = await forbind(laesConfig(LOKAL), db, {});
  assert.ok(f.flaade);
  assert.equal(f.flaade.flaade.navn, 'lokal');
  assert.equal(f.flaade.billede, 'clawco:test');
  const { konto } = await findEllerOpretKonto(db, 'ejer@example.test', new Date());
  assert.deepEqual(await f.flaade.berettigede(), []);
  await db.query("INSERT INTO abonnement.rettigheder (konto_id, kilde, plan, status, medlemmer_max, skrivebeskyttet, opdateret) VALUES ($1, 'gave', 'sky-solo', 'aktiv', 1, false, now())", [konto.id]);
  assert.deepEqual(await f.flaade.berettigede(), [konto.id]);
  await db.query("INSERT INTO flaade.tenant (slug, ejer_konto_id, driver, tilstand, bestilt, klar, oprettet, opdateret) VALUES ('hus-abcdefgh', $1, 'lokal', 'klar', now(), now(), now(), now())", [konto.id]);
  assert.equal((await f.konto.husstand.forKonto(konto.id))?.tenantId, 'hus-abcdefgh');
  assert.deepEqual(await f.konto.clawco!(konto.id), { url: 'https://hus-abcdefgh.clawco.work/' });
  await db.close();
});

test('KC-0182: Sky\'s /health names the fleet driver', async () => {
  const db = await pgliteDatabase();
  await migrer(db);
  const app = createSkyApp({ db, sha: 'x', startet: Date.now(), flaade: 'lokal' });
  assert.equal((await (await app.request('/health')).json() as { flaade?: string }).flaade, 'lokal');
  await db.close();
});

// --- KC-0191/KC-0192: billing wiring ------------------------------------------------------------

test('production without a Stripe key: billing is wired but answers 503 (fail closed), never a fake', async () => {
  const db = await pgliteDatabase();
  await migrer(db);
  const f = await forbind(laesConfig(ENV), db, {});
  assert.equal(f.abonnement.klient, null);
  assert.equal(f.dev, null);
  const app = createSkyApp({ db, sha: 'x', startet: Date.now(), konto: f.konto, abonnement: f.abonnement });
  assert.equal((await app.request('https://konto.example.test/api/abonnement/webhook', { method: 'POST', body: '{}' })).status, 503);
  assert.equal((await app.request('https://konto.example.test/dev/stripe/checkout/cs_x')).status, 404);
  await db.close();
});

test('dev without a key: the fake client with the config\'s prices, a per-process webhook secret, and the dev Checkout page', async () => {
  const db = await pgliteDatabase();
  await migrer(db);
  const f = await forbind(laesConfig({ ...ENV, SKY_DEV: '1' }), db, {});
  assert.ok(f.abonnement.klient instanceof FalskBetalingsKlient);
  assert.ok(await f.abonnement.klient.prisForLookupKey('clawco-sky-solo-maaned'));
  assert.match(f.abonnement.webhookHemmelighed ?? '', /^whsec_/);
  assert.ok(f.dev);
  await db.close();
});

test('billing is mounted before konto: its CSP stays on its own pages and the webhook is outside konto\'s 64 KB limit', async () => {
  const db = await pgliteDatabase();
  await migrer(db);
  const f = await forbind(laesConfig({ ...ENV, SKY_DEV: '1' }), db, {});
  const app = createSkyApp({ db, sha: 'x', startet: Date.now(), konto: f.konto, abonnement: f.abonnement, dev: f.dev });
  const logInd = await app.request('https://konto.example.test/log-ind');
  assert.match(logInd.headers.get('content-security-policy') ?? '', /form-action 'self';/);
  assert.doesNotMatch(logInd.headers.get('content-security-policy') ?? '', /stripe/);
  const plan = await app.request('https://konto.example.test/konto/abonnement');
  assert.equal(plan.status, 303);
  assert.match(plan.headers.get('content-security-policy') ?? '', /checkout\.stripe\.com/);
  const stor = await app.request('https://konto.example.test/api/abonnement/webhook', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=0' }, body: 'x'.repeat(200_000) });
  assert.equal(stor.status, 400);
  await db.close();
});

test('konto and abonnement share one event bus: deleting an account cancels its subscription', async () => {
  const db = await pgliteDatabase();
  await migrer(db);
  const f = await forbind(laesConfig({ ...ENV, SKY_DEV: '1' }), db, {});
  const klient = f.abonnement.klient as FalskBetalingsKlient;
  const { konto } = await findEllerOpretKonto(db, 'a@example.test', new Date());
  const k = await sikrKunde(db, klient, { kontoId: konto.id, email: 'a@example.test', sprog: 'da', land: 'DK', nu: new Date() });
  const pris = await klient.prisForLookupKey('clawco-sky-solo-maaned');
  const s = await klient.opretCheckout({ mode: 'subscription', customer: k.stripeKunde, line_items: [{ price: pris!.id, quantity: 1 }], subscription_data: { trial_period_days: 14 }, success_url: 'https://konto.example.test/x' }, 's');
  klient.fuldfoerCheckout(s.id, new Date());
  const { log } = await fang(async () => {
    f.konto.haendelser.udsend({ navn: 'konto.slettet', kontoId: konto.id, tidspunkt: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 20));
  });
  assert.match(log, /opsagt/);
  assert.deepEqual((await klient.listAbonnementer(k.stripeKunde)).map((a) => a.status), ['canceled']);
  await db.close();
});

async function fang(fn: () => Promise<void>): Promise<{ log: string }> {
  const gemt = console.log;
  const linjer: string[] = [];
  console.log = (...a: unknown[]) => { linjer.push(a.map(String).join(' ')); };
  try { await fn(); } finally { console.log = gemt; }
  return { log: linjer.join('\n') };
}

// --- KC-0181: the master key gate ---------------------------------------------------------------------

test('KC-0181: forbind reads the master key (and removes it from env); with it a tenant gets its data key, without it provisioning refuses', async () => {
  const db = await pgliteDatabase();
  await migrer(db);
  const env: Record<string, string | undefined> = { SKY_MASTERNOEGLE: Buffer.alloc(32, 7).toString('base64') };
  const med = await forbind(laesConfig(LOKAL), db, env);
  assert.equal(med.noegler, 'ok');
  assert.equal(env['SKY_MASTERNOEGLE'], undefined, 'child processes (the Docker CLI) never inherit the master key');
  await med.flaade!.noegler.sikr('hus-abcdefgh');
  assert.equal((await db.query('SELECT 1 FROM hemmeligheder.tenant_noegle WHERE tenant = $1', ['hus-abcdefgh'])).length, 1);

  const uden = await forbind(laesConfig(LOKAL), db, {});
  assert.equal(uden.noegler, 'mangler');
  await assert.rejects(uden.flaade!.noegler.sikr('hus-bbbbbbbb'), /SKY_MASTERNOEGLE/);
  assert.equal((await db.query('SELECT 1 FROM hemmeligheder.tenant_noegle WHERE tenant = $1', ['hus-bbbbbbbb'])).length, 0);
  // An invalid key is the same as none: named, never shown.
  const ugyldig = await forbind(laesConfig(LOKAL), db, { SKY_MASTERNOEGLE: 'HEMMELIG-IKKE-EN-NOEGLE' });
  assert.equal(ugyldig.noegler, 'mangler');
  assert.ok(!(ugyldig.noeglefejl ?? '').includes('HEMMELIG'));
  assert.match(ugyldig.noeglefejl ?? '', /SKY_MASTERNOEGLE/);
  await db.close();
});

// --- KC-0183: the gateway's wiring ----------------------------------------------------------------------

test('KC-0183: forbind reads the gateway key (and removes it from env); a key that does not match SKY_KONTO_PUBKEY is none', async () => {
  const db = await pgliteDatabase();
  await migrer(db);
  const env: Record<string, string | undefined> = { SKY_GATEWAY_SIGNERINGSNOEGLE: GW_FROE };
  const med = await forbind(laesConfig({ ...LOKAL, SKY_KONTO_PUBKEY: GW_OFFENTLIG }), db, env);
  assert.equal(med.gateway.status, 'ok');
  assert.equal(med.gateway.noegle?.offentlig, GW_OFFENTLIG);
  assert.equal(env['SKY_GATEWAY_SIGNERINGSNOEGLE'], undefined, 'child processes never inherit the signing key');
  const forkert = await forbind(laesConfig({ ...LOKAL, SKY_KONTO_PUBKEY: 'Kay64UG8yvCyLhqU000LxzYeUm0L_hLIl5S8kyKWbdc' }), db, { SKY_GATEWAY_SIGNERINGSNOEGLE: GW_FROE });
  assert.equal(forkert.gateway.status, 'mangler');
  assert.match(forkert.gateway.fejl ?? '', /SKY_KONTO_PUBKEY/);
  assert.equal((await forbind(laesConfig(ENV), db, {})).gateway.status, 'mangler');
  // Without a fleet there is no SKY_KONTO_PUBKEY to match: the key alone is enough.
  assert.equal((await forbind(laesConfig(ENV), db, { SKY_GATEWAY_SIGNERINGSNOEGLE: GW_FROE })).gateway.status, 'ok');
  await db.close();
});

test('KC-0183: the fleet\'s iGateway/udAfGateway hooks invalidate the route table at once and drop the tenant\'s unspent codes', async () => {
  const db = await pgliteDatabase();
  await migrer(db);
  const f = await forbind(laesConfig({ ...LOKAL, SKY_KONTO_PUBKEY: GW_OFFENTLIG }), db, { SKY_GATEWAY_SIGNERINGSNOEGLE: GW_FROE });
  const { konto } = await findEllerOpretKonto(db, 'ejer@example.test', new Date());
  await db.query("INSERT INTO flaade.tenant (slug, ejer_konto_id, driver, tilstand, bestilt, klar, adresse, oprettet, opdateret) VALUES ('hus-abcdefgh', $1, 'lokal', 'sund', now(), now(), 'http://172.18.0.2:8750', now(), now())", [konto.id]);
  assert.equal(await f.gateway.ruter.find('hus-abcdefgh'), null);
  await db.query("UPDATE flaade.tenant SET tilstand = 'klar' WHERE slug = 'hus-abcdefgh'");
  await f.flaade!.iGateway({ slug: 'hus-abcdefgh', adresse: 'http://172.18.0.2:8750' });
  assert.ok(await f.gateway.ruter.find('hus-abcdefgh'), 'visible at once, not after the cache runs out');
  const [s] = await db.query<{ id: number }>("INSERT INTO session (hash, konto_id, oprettet, sidst_set, udloeber, autentificeret, metode, csrf) VALUES ('h', $1, now(), now(), now() + interval '1 day', now(), 'link', 'c') RETURNING id", [konto.id]);
  await db.query("INSERT INTO gateway.kode (hash, konto_id, session_id, slug, naeste, oprettet, udloeber) VALUES ('k', $1, $2, 'hus-abcdefgh', '/', now(), now() + interval '1 minute')", [konto.id, s!.id]);
  await db.query("UPDATE flaade.tenant SET tilstand = 'afvikles' WHERE slug = 'hus-abcdefgh'");
  await f.flaade!.udAfGateway('hus-abcdefgh');
  assert.equal(await f.gateway.ruter.find('hus-abcdefgh'), null);
  assert.equal((await db.query('SELECT 1 FROM gateway.kode')).length, 0);
  await db.close();
});

test('KC-0183: /aabn is mounted on the account app when the gateway is wired', async () => {
  const db = await pgliteDatabase();
  await migrer(db);
  const f = await forbind(laesConfig(ENV), db, { SKY_GATEWAY_SIGNERINGSNOEGLE: GW_FROE });
  const app = createSkyApp({ db, sha: 'x', startet: Date.now(), konto: f.konto, loginVej: f.gateway.loginVej });
  assert.equal((await app.request('/aabn?t=hus-abcdefgh&n=%2F&s=forkert')).status, 400);
  assert.equal((await createSkyApp({ db, sha: 'x', startet: Date.now(), konto: f.konto }).request('/aabn')).status, 404);
  await db.close();
});

test('KC-0183: the Host dispatch — account host and loopback to Sky, a slug to the gateway, anything else 404', async () => {
  const kald: string[] = [];
  const f = fordeler({
    kontoVaert: 'konto.example.test', basedomain: 'example.test',
    sky: (_req, res) => { kald.push('sky'); res.end(); },
    gateway: (_req, res, slug) => { kald.push(`gateway ${slug}`); res.end(); },
  });
  const server = http.createServer(f);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const hent = (host: string) => new Promise<number>((ok, fejl) => {
    http.request({ host: '127.0.0.1', port, path: '/', headers: { host }, agent: false }, (res) => { res.resume(); res.on('end', () => ok(res.statusCode ?? 0)); }).on('error', fejl).end();
  });
  try {
    assert.equal(await hent('konto.example.test'), 200);
    assert.equal(await hent('127.0.0.1:8781'), 200);
    assert.equal(await hent('hus-abcdefgh.example.test'), 200);
    assert.equal(await hent('www.example.test'), 404);
    assert.equal(await hent('evil.test'), 404);
    assert.deepEqual(kald, ['sky', 'sky', 'gateway hus-abcdefgh']);
  } finally { server.closeAllConnections(); server.close(); }
});

test('KC-0198: sign-up is mounted on the account host with its own CSP; konto keeps form-action self', async () => {
  const db = await pgliteDatabase();
  await migrer(db);
  const f = await forbind(laesConfig({ ...ENV, SKY_DEV: '1' }), db, {});
  assert.equal(f.tilmelding.tilstand, 'invitation');
  const app = createSkyApp({ db, sha: 'x', startet: Date.now(), konto: f.konto, abonnement: f.abonnement, dev: f.dev, tilmelding: f.tilmelding });
  const r = await app.request('https://konto.example.test/tilmeld');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Kom i gang med Clawco i skyen/);
  assert.match(r.headers.get('content-security-policy') ?? '', /form-action 'self' https:\/\/checkout\.stripe\.com;/);
  assert.doesNotMatch((await app.request('https://konto.example.test/log-ind')).headers.get('content-security-policy') ?? '', /stripe/);
  await db.close();
});

test('KC-0198: the account language chosen at sign-up reaches billing (Checkout locale)', async () => {
  const db = await pgliteDatabase();
  await migrer(db);
  // KC-0220: Checkout needs open sign-up and a finished profile, so the language is always chosen first.
  const f = await forbind(laesConfig({ ...ENV, SKY_DEV: '1', SKY_TILMELDING: 'open' }), db, {});
  const { konto } = await findEllerOpretKonto(db, 'en@example.test', new Date());
  const { gemProfil } = await import('../src/konto/profil.ts');
  const { laesSamtykke } = await import('../src/tilmelding/samtykke.ts');
  const sam = laesSamtykke();
  const profil = (sprog: 'da' | 'en') => gemProfil(db, konto.id, { land: 'SE', sprog, vilkaar: sam.vilkaar.version, privatliv: sam.privatliv.version, nu: new Date() });
  await profil('da');
  const { opretSession } = await import('../src/konto/session.ts');
  const { token, session } = await opretSession(db, { kontoId: konto.id, metode: 'link', enhed: '', nu: new Date() });
  const app = createSkyApp({ db, sha: 'x', startet: Date.now(), konto: f.konto, abonnement: f.abonnement, dev: f.dev });
  const klient = f.abonnement.klient as FalskBetalingsKlient;
  const checkout = async () => {
    await app.request('https://konto.example.test/api/abonnement/checkout', {
      method: 'POST',
      headers: { cookie: `__Host-sky=${token}`, origin: 'https://konto.example.test', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf: session.csrf, plan: 'sky-solo', interval: 'maaned', land: 'SE' }),
    });
    return (klient.kald.filter((k) => k.metode === 'opretCheckout').at(-1)?.args as { locale?: string } | undefined)?.locale;
  };
  assert.equal(await checkout(), 'da');
  await profil('en');
  await db.query('UPDATE abonnement.kunde SET aaben_checkout = NULL');
  assert.equal(await checkout(), 'en');
  await db.close();
});

test('KC-0185: the backup wiring — off without R2 keys or a master key, on with both; R2 calls go to the EU endpoint', async () => {
  const { kopiFra } = await import('../src/server.ts');
  const { laesKopiConfig } = await import('../src/config.ts');
  const { ring } = await import('./hemmeligheder/hjaelp.ts');
  const db = await pgliteDatabase();
  await migrer(db);
  const r2 = () => ({ SKY_R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef', SKY_R2_ACCESS_KEY_ID: 'id', SKY_R2_SECRET_ACCESS_KEY: 'hemmelig', SKY_R2_BUCKET: 'clawco-sky-backup', SKY_KOPI_TESTTENANT: 'hus-testtest' });
  const config = laesConfig(LOKAL);
  assert.match(kopiFra({ config, db, ring: ring(), kopi: laesKopiConfig({}).kopi }).grund!, /SKY_R2/);
  assert.match(kopiFra({ config, db, ring: null, kopi: laesKopiConfig(r2()).kopi }).grund!, /SKY_MASTERNOEGLE/);
  const urls: string[] = [];
  const f = (async (u: string | URL | Request) => { urls.push(String(u)); return new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>', { status: 200 }); }) as typeof fetch;
  const k = kopiFra({ config, db, ring: ring(), kopi: laesKopiConfig(r2()).kopi, fetch: f });
  assert.equal(k.grund, null);
  assert.equal(k.deps!.testTenant, 'hus-testtest');
  await k.deps!.lager.liste('db/');
  assert.match(urls[0]!, /^https:\/\/0123456789abcdef0123456789abcdef\.eu\.r2\.cloudflarestorage\.com\/clawco-sky-backup\?/);
  assert.deepEqual(await k.deps!.tenanter(), []);
  const uden = kopiFra({ config: laesConfig(ENV), db, ring: ring(), kopi: laesKopiConfig(r2()).kopi, fetch: f });
  await assert.rejects(uden.deps!.node.pak('hus-aaaaaaaa'), /ingen flåde/, 'without a lokal fleet only the database is copied');
  await db.close();
});

test('KC-0186: the rollout wiring — needs the lokal fleet and the master key; restore points go to R2 when set, else the local store', async () => {
  const { udrulFra } = await import('../src/server.ts');
  const { laesKopiConfig, lokaleKopier } = await import('../src/config.ts');
  const { ring } = await import('./hemmeligheder/hjaelp.ts');
  const db = await pgliteDatabase();
  await migrer(db);
  assert.equal(lokaleKopier({}), '/srv/sky/kopier');
  assert.equal(lokaleKopier({ SKY_LOKALE_KOPIER: '/data/kopier' }), '/data/kopier');
  assert.throws(() => lokaleKopier({ SKY_LOKALE_KOPIER: 'relativ' }), /absolut/);
  const r2 = { SKY_R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef', SKY_R2_ACCESS_KEY_ID: 'id', SKY_R2_SECRET_ACCESS_KEY: 'hemmelig', SKY_R2_BUCKET: 'clawco-sky-backup' };
  assert.match(udrulFra({ config: laesConfig(ENV), db, ring: ring(), kopi: null, lokaleKopier: '/srv/sky/kopier' }).grund!, /SKY_FLAADE=lokal/);
  assert.match(udrulFra({ config: laesConfig(LOKAL), db, ring: null, kopi: null, lokaleKopier: '/srv/sky/kopier' }).grund!, /SKY_MASTERNOEGLE/);
  const uden = udrulFra({ config: laesConfig(LOKAL), db, ring: ring(), kopi: null, lokaleKopier: '/srv/sky/kopier' });
  assert.equal(uden.grund, null);
  assert.equal(uden.deps!.lagre.r2, null);
  assert.equal(uden.lager, 'lokal');
  const med = udrulFra({ config: laesConfig(LOKAL), db, ring: ring(), kopi: laesKopiConfig(r2).kopi, lokaleKopier: '/srv/sky/kopier' });
  assert.notEqual(med.deps!.lagre.r2, null);
  assert.equal(med.lager, 'r2');
  assert.deepEqual(await med.deps!.tenanter.klare(), []);
  await db.close();
});
