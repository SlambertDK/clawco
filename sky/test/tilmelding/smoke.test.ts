// KC-0198 smoke: the whole sign-up in-process through Sky's real wiring (forbind + createSkyApp), with the fake
// Post (SKY_DEV), the fake Stripe and its dev Checkout page, and the fake fleet behind the real reconciler:
// mail link → profile → plan → Checkout (trial, no card) → webhook → provisioning → "Åbn Clawco" → /aabn →
// the tenant's own host with a one-time code. Also: two tabs pressing "Prøv igen" make one tenant, and
// tilmelding_ms lands under the 120 s budget (loosely: the fake fleet is instant).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Hono } from 'hono';
import { createSkyApp, forbind, tilmeldingDeps } from '../../src/server.ts';
import { laesConfig } from '../../src/config.ts';
import { pgliteDatabase } from '../pglite.ts';
import { migrer } from '../../src/db/migrer.ts';
import { afstem, type AfstemDeps } from '../../src/fleet/afstem.ts';
import { laase, tenantForEjer } from '../../src/fleet/tilstand.ts';
import { kontiMedAdgang } from '../../src/abonnement/synk.ts';
import { hentProfil } from '../../src/konto/profil.ts';
import { falskFlaade, falskNoegler } from '../fleet/hjaelp.ts';
import { FROE } from '../gateway/hjaelp.ts';

const PUBLIC = 'https://konto.example.test';

class Browser {
  jar = new Map<string, string>();
  app: Hono;
  constructor(app: Hono) { this.app = app; }
  async hent(sti: string, init: RequestInit = {}): Promise<Response> {
    const h = new Headers(init.headers);
    if (this.jar.size) h.set('cookie', [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '));
    if ((init.method ?? 'GET') !== 'GET') h.set('origin', PUBLIC);
    const r = await this.app.request(sti.startsWith('http') ? sti : `${PUBLIC}${sti}`, { ...init, headers: h });
    for (const c of r.headers.getSetCookie()) {
      const [par] = c.split(';');
      const i = par!.indexOf('=');
      if (/Max-Age=0/i.test(c) || par!.slice(i + 1) === '') this.jar.delete(par!.slice(0, i)); else this.jar.set(par!.slice(0, i), par!.slice(i + 1));
    }
    return r;
  }
  form(sti: string, felter: Record<string, string>): Promise<Response> {
    return this.hent(sti, { method: 'POST', body: new URLSearchParams(felter), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  }
}

const csrf = (t: string): string => /<meta name="csrf" content="([^"]+)">/.exec(t)![1]!;
const felt = (t: string, navn: string): string => new RegExp(`name="${navn}" value="([^"]+)"`).exec(t)![1]!;

test('smoke: a stranger signs up, starts a trial and lands in the Start room of their own Clawco, in budget', async () => {
  const db = await pgliteDatabase();
  await migrer(db);
  const env = { SKY_DATABASE_URL: 'postgres:///sky', SKY_PUBLIC_URL: PUBLIC, SKY_DEV: '1', SKY_TILMELDING: 'open', SKY_GATEWAY_SIGNERINGSNOEGLE: FROE };
  const config = laesConfig(env);
  const f = await forbind(config, db, { ...env });
  assert.equal(f.tilmelding.tilstand, 'open');
  // The fake fleet behind the real reconciler (the lokal driver needs Docker; the orchestrator runs that one).
  const flaade = falskFlaade();
  const fl: AfstemDeps = {
    db, flaade, billede: 'clawco:test', laas: laase(), nu: () => new Date(), vent: async () => {},
    sundhed: async () => ({ ok: true, sha: 'abc' }), iGateway: async ({ slug }) => { f.gateway.ruter.glem(slug); }, udAfGateway: async () => {},
    noegler: falskNoegler(), berettigede: () => kontiMedAdgang(db),
  };
  const tilmelding = tilmeldingDeps({ config, db, adgang: f.adgang, abonnement: f.abonnement, flaade: fl, gateway: f.gateway.noegle });
  const app = createSkyApp({ db, sha: 'x', startet: Date.now(), konto: f.konto, abonnement: f.abonnement, dev: f.dev, loginVej: f.gateway.loginVej, tilmelding });
  const b = new Browser(app);

  // Step 1: the account, by mail link, back into the flow with the pricing page's choice kept.
  const start = await (await b.hent('/tilmeld?plan=sky-husstand&interval=aar')).text();
  assert.match(start, /Kom i gang med Clawco i skyen/);
  await b.form('/log-ind/link', { email: 'fremmed@example.test', til: felt(start, 'til').replace(/&amp;/g, '&') });
  const link = f.konto.udbakke!.at(-1)!.data['link']!;
  await b.hent(link);
  const ind = await b.form('/log-ind/link/bekraeft', { t: new URL(link).searchParams.get('t')! });
  assert.equal(ind.headers.get('location'), '/tilmeld?plan=sky-husstand&interval=aar');
  const profil = await (await b.hent(ind.headers.get('location')!)).text();
  assert.match(profil, /Om dig/);
  const ok = await b.form('/tilmeld/profil', { csrf: csrf(profil), land: 'DK', sprog: 'da', vilkaar: felt(profil, 'vilkaar'), privatliv: felt(profil, 'privatliv'), plan: 'sky-husstand', interval: 'aar' });
  assert.equal(ok.status, 303);

  // Step 2: the plan, preselected; Checkout (the dev stand-in for Stripe's page).
  const plan = await (await b.hent(ok.headers.get('location')!)).text();
  assert.match(plan, /value="sky-husstand" checked/);
  const co = await b.form('/api/abonnement/checkout', { csrf: csrf(plan), plan: 'sky-husstand', interval: 'aar', land: felt(plan, 'land'), retur: 'tilmelding' });
  assert.equal(co.status, 303);
  const stripe = new URL(co.headers.get('location')!);
  assert.match(stripe.pathname, /^\/dev\/stripe\/checkout\/cs_/);

  // Step 3: back from Stripe; the fake delivered the webhook, so the trial is already there.
  const tilbage = await b.form(stripe.pathname, {});
  const retur = new URL(tilbage.headers.get('location')!);
  assert.equal(retur.pathname, '/tilmeld');
  assert.match(retur.searchParams.get('session') ?? '', /^cs_/);
  const klargoering = await (await b.hent(`${retur.pathname}${retur.search}`)).text();
  assert.match(klargoering, /Vi gør din Clawco klar/);

  // Step 4: two tabs press "Prøv igen" while the reconciler also runs — one tenant, one container.
  const c = csrf(klargoering);
  await Promise.all([b.form('/api/tilmelding/igen', { csrf: c }), b.form('/api/tilmelding/igen', { csrf: c }), afstem(fl)]);
  let noegle = '';
  for (let i = 0; i < 50 && noegle !== 'aabn'; i++) {
    noegle = ((await (await b.hent('/api/tilmelding/status')).json()) as { noegle: string }).noegle;
    if (noegle !== 'aabn') await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(noegle, 'aabn');
  assert.equal((await db.query('SELECT 1 FROM flaade.tenant')).length, 1);
  assert.equal(flaade.kald.filter((k) => k.startsWith('klargoer')).length, 1);

  // Step 5: one button, through /aabn, to the tenant's own host and the Start room.
  const aabn = await (await b.hent('/tilmeld')).text();
  const href = /<a class="knap primaer" href="([^"]+)">Åbn Clawco<\/a>/.exec(aabn)![1]!.replace(/&amp;/g, '&');
  const u = new URL(href);
  assert.equal(u.origin, PUBLIC);
  assert.equal(u.pathname, '/aabn');
  assert.equal(u.searchParams.get('n'), '/rum/start');
  const ind2 = await b.hent(`${u.pathname}${u.search}`);
  assert.equal(ind2.status, 303);
  const t = await tenantForEjer(db, (await db.query<{ id: unknown }>('SELECT id FROM konto'))[0]!.id as number);
  assert.ok(ind2.headers.get('location')!.startsWith(`https://${t!.slug}.${config.basedomain}/_sky/faa?kode=`), ind2.headers.get('location')!);

  // Timing: account created → tenant klar, recorded once; budget 120 s p95 (loosely, with the fake fleet).
  const p = await hentProfil(db, t!.ejerKontoId);
  assert.ok(p?.tilmeldingMs !== null && p!.tilmeldingMs! < 120_000, `tilmeldingMs ${p?.tilmeldingMs}`);

  // KC-0204: the text changes (the version the account accepted is no longer the current one). The way into the
  // product is closed behind one screen; the account page and deleting stay open; accepting opens it again.
  await db.query("UPDATE konto SET vilkaar_version = '0.0-gammel'");
  const lukket = await b.hent(`${u.pathname}${u.search}`);
  assert.equal(lukket.status, 303);
  assert.equal(lukket.headers.get('location'), '/tilmeld', 'no code, no way to the tenant');
  const skaerm = await (await b.hent('/tilmeld')).text();
  assert.match(skaerm, /Vilkårene er ændret/);
  assert.doesNotMatch(skaerm, /Åbn Clawco/);
  assert.equal((await b.hent('/konto')).status, 200);
  assert.equal((await b.hent('/konto/slet')).status, 200);
  const nyt = await b.form('/tilmeld/samtykke', { csrf: csrf(skaerm), vilkaar: felt(skaerm, 'vilkaar'), privatliv: felt(skaerm, 'privatliv') });
  assert.equal(nyt.status, 303);
  assert.equal((await hentProfil(db, t!.ejerKontoId))?.vilkaar, f.tilmelding.samtykke.vilkaar.version);
  const aabnet = await b.hent(`${u.pathname}${u.search}`);
  assert.ok(aabnet.headers.get('location')!.startsWith(`https://${t!.slug}.${config.basedomain}/_sky/faa?kode=`), 'accepted: the way in is open again');
  await db.close();
});

// KC-0220: the plan page and Checkout predate the sign-up flow. Found live 2026-11-01: an account that had
// skipped the profile (no consents recorded) reached a trial through /konto/abonnement while sign-up was
// invitation-only, and so got a container. Invariant: a plan can be chosen only where the sign-up flow would
// show the plan step — open sign-up AND the profile with the current consents recorded.
async function logInd(tilmelding: 'open' | undefined) {
  const db = await pgliteDatabase();
  await migrer(db);
  const env: Record<string, string> = { SKY_DATABASE_URL: 'postgres:///sky', SKY_PUBLIC_URL: PUBLIC, SKY_DEV: '1', SKY_GATEWAY_SIGNERINGSNOEGLE: FROE };
  if (tilmelding) env['SKY_TILMELDING'] = tilmelding;
  const config = laesConfig(env);
  const f = await forbind(config, db, { ...env });
  const app = createSkyApp({ db, sha: 'x', startet: Date.now(), konto: f.konto, abonnement: f.abonnement, dev: f.dev, loginVej: f.gateway.loginVej, tilmelding: f.tilmelding });
  const b = new Browser(app);
  await b.form('/log-ind/link', { email: 'udenom@example.test', til: '/konto' });
  const link = f.konto.udbakke!.at(-1)!.data['link']!;
  await b.hent(link);
  await b.form('/log-ind/link/bekraeft', { t: new URL(link).searchParams.get('t')! });
  const c = csrf(await (await b.hent('/konto')).text());
  const checkouts = () => f.dev!.klient.kald.filter((k) => k.metode === 'opretCheckout').length;
  return { db, b, c, checkouts };
}

for (const [navn, tilstand] of [['invitation-only sign-up', undefined], ['open sign-up without the profile', 'open']] as const) {
  test(`KC-0220: ${navn}: the plan page and Checkout send the account to /tilmeld, and nothing reaches Stripe`, async () => {
    const { db, b, c, checkouts } = await logInd(tilstand);
    const side = await b.hent('/konto/abonnement');
    assert.equal(side.status, 303);
    assert.equal(side.headers.get('location'), '/tilmeld');
    const co = await b.form('/api/abonnement/checkout', { csrf: c, plan: 'sky-solo', interval: 'maaned', land: 'DK' });
    assert.equal(co.status, 303);
    assert.equal(co.headers.get('location'), '/tilmeld');
    assert.equal(checkouts(), 0);
    assert.equal((await db.query("SELECT 1 FROM abonnement.rettigheder WHERE status IN ('proeve', 'aktiv')")).length, 0);
    await db.close();
  });
}
