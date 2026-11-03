// KC-0203 smoke: the closed beta through Sky's real wiring (forbind + createSkyApp), as a household lives it. An
// operator makes two codes; a stranger signs in by mail link, fills the profile, types one code with the consent box
// ticked, and the real reconciler (fake fleet) gives them a Clawco under a gift: no Stripe customer, no Checkout. The
// code cannot be used twice; the klar tenant is then asked for its measures over the (faked) signed call and the numbers
// land; the report reads them. The browser-and-staging half of the ticket's verification is the orchestrator's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Hono } from 'hono';
import { createSkyApp, forbind, tilmeldingDeps } from '../../src/server.ts';
import { laesConfig } from '../../src/config.ts';
import { pgliteDatabase } from '../pglite.ts';
import { migrer } from '../../src/db/migrer.ts';
import { afstem, type AfstemDeps } from '../../src/fleet/afstem.ts';
import { laase } from '../../src/fleet/tilstand.ts';
import { kontiMedAdgang, hentRettigheder } from '../../src/abonnement/synk.ts';
import { laesPriser } from '../../src/abonnement/priser.ts';
import { lavInvitationer } from '../../src/beta/invitationer.ts';
import { hentMaal } from '../../src/beta/hent.ts';
import { betaRapport } from '../../scripts/beta-rapport.ts';
import { falskFlaade, falskNoegler } from '../fleet/hjaelp.ts';
import { FROE } from '../gateway/hjaelp.ts';

// KC-0272: dev mode (the outbox, the fake Checkout) runs only on a localhost address.
const PUBLIC = 'https://konto.localhost';

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

test('a household redeems a code with the consent box ticked: a gift, no Stripe, a Clawco; the code is spent; the numbers are pulled and reported', async () => {
  const db = await pgliteDatabase();
  await migrer(db);
  const env = { SKY_DATABASE_URL: 'postgres:///sky', SKY_PUBLIC_URL: PUBLIC, SKY_DEV: '1', SKY_GATEWAY_SIGNERINGSNOEGLE: FROE };
  const config = laesConfig(env);
  assert.equal(config.tilmelding, 'invitation');
  const f = await forbind(config, db, { ...env });
  const flaade = falskFlaade();
  const fl: AfstemDeps = {
    db, flaade, billede: 'clawco:test', laas: laase(), nu: () => new Date(), vent: async () => {},
    sundhed: async () => ({ ok: true, sha: 'abc' }), iGateway: async ({ slug }) => { f.gateway.ruter.glem(slug); }, udAfGateway: async () => {},
    noegler: falskNoegler(), berettigede: () => kontiMedAdgang(db),
  };
  const tilmelding = tilmeldingDeps({ config, db, adgang: f.adgang, abonnement: f.abonnement, flaade: fl, gateway: f.gateway.noegle });
  const app = createSkyApp({ db, sha: 'x', startet: Date.now(), konto: f.konto, abonnement: f.abonnement, dev: f.dev, loginVej: f.gateway.loginVej, tilmelding });
  const b = new Browser(app);

  // The operator's two codes (printed once, never stored).
  const [kode, andenKode] = await lavInvitationer(db, 2, new Date());

  // The stranger: mail link → profile → the invitation step with the beta card and the box.
  const start = await (await b.hent('/tilmeld')).text();
  await b.form('/log-ind/link', { email: 'fremmed@example.test', til: felt(start, 'til').replace(/&amp;/g, '&') });
  const link = f.konto.udbakke!.at(-1)!.data['link']!;
  await b.hent(link);
  await b.form('/log-ind/link/bekraeft', { t: new URL(link).searchParams.get('t')! });
  const profil = await (await b.hent('/tilmeld')).text();
  const ok = await b.form('/tilmeld/profil', { csrf: csrf(profil), land: 'DK', sprog: 'da', vilkaar: felt(profil, 'vilkaar'), privatliv: felt(profil, 'privatliv') });
  assert.equal(ok.status, 303);
  const inv = await (await b.hent('/tilmeld')).text();
  assert.match(inv, /Tilmelding kræver en invitation/);
  assert.match(inv, /Det her er en lukket beta: det kan gå galt, og vi skriver til dig, før noget slutter\./);
  assert.match(inv, /<input type="checkbox" name="betaSamtykke" value="ja">/);

  // A wrong code is refused; the right one, with the box ticked, moves on.
  const forkert = await b.form('/tilmeld/invitation', { csrf: csrf(inv), kode: 'forkert' });
  assert.equal(forkert.status, 400);
  const ind = await b.form('/tilmeld/invitation', { csrf: csrf(inv), kode: kode!, betaSamtykke: 'ja' });
  assert.equal(ind.status, 303);
  assert.equal(ind.headers.get('location'), '/tilmeld');

  // A gift on the Husstand plan; no Stripe customer, no Checkout; the consent is stored.
  const [konto] = await db.query<{ id: unknown }>('SELECT id FROM konto');
  const id = Number(konto!.id);
  const r = await hentRettigheder(db, id, laesPriser(), new Date());
  assert.deepEqual([r.kilde, r.plan, r.status, r.abonnement], ['gave', 'sky-husstand', 'aktiv', null]);
  assert.equal((await db.query('SELECT 1 FROM abonnement.kunde')).length, 0, 'no Stripe customer');
  assert.equal(f.dev!.klient.kald.filter((k) => k.metode === 'opretCheckout').length, 0, 'no Checkout');
  assert.deepEqual((await db.query<{ samtykke: boolean }>('SELECT samtykke FROM beta.maal WHERE konto_id = $1', [id])).map((x) => x.samtykke), [true]);

  // The code is spent: another account cannot use it, and neither can this one again.
  const andenB = new Browser(app);
  await andenB.form('/log-ind/link', { email: 'anden@example.test', til: '/tilmeld' });
  const link2 = f.konto.udbakke!.at(-1)!.data['link']!;
  await andenB.hent(link2);
  await andenB.form('/log-ind/link/bekraeft', { t: new URL(link2).searchParams.get('t')! });
  const profil2 = await (await andenB.hent('/tilmeld')).text();
  await andenB.form('/tilmeld/profil', { csrf: csrf(profil2), land: 'DK', sprog: 'da', vilkaar: felt(profil2, 'vilkaar'), privatliv: felt(profil2, 'privatliv') });
  const inv2 = await (await andenB.hent('/tilmeld')).text();
  assert.equal((await andenB.form('/tilmeld/invitation', { csrf: csrf(inv2), kode: kode! })).status, 400, 'the spent code');
  assert.equal((await db.query('SELECT 1 FROM beta.maal')).length, 1);
  void andenKode;

  // The real reconciler gives the household its Clawco; the page leads to "Åbn Clawco".
  await afstem(fl);
  let noegle = '';
  for (let i = 0; i < 50 && noegle !== 'aabn'; i++) {
    noegle = ((await (await b.hent('/api/tilmelding/status')).json()) as { noegle: string }).noegle;
    if (noegle !== 'aabn') await new Promise((res) => setTimeout(res, 20));
  }
  assert.equal(noegle, 'aabn');
  assert.equal((await db.query("SELECT 1 FROM flaade.tenant WHERE tilstand = 'klar'")).length, 1);

  // The daily pull: the klar beta tenant answers with its consented numbers; they land and the report reads them.
  const maal = { version: 1, samtykke: true, foersteVaerdi: { kildeForbundetMs: 20_000, foersteVaerdiMs: 70_000 }, dage: [{ dag: '2026-11-02', kraever: 5 }], feedback: [{ dag: 3, vurdering: 5, tekst: 'Roligt', betale: null, tid: '2026-11-04T10:00:00Z' }] };
  const ud = await hentMaal({ db, hent: async () => maal, log: () => {} }, new Date());
  assert.deepEqual(ud, { beta: 1, hentet: 1, afvist: 0, udenSvar: 0 });
  const rapport = await betaRapport(db, new Date());
  assert.equal(rapport.husstande, 1);
  assert.equal(rapport.foersteVaerdi.medianEfterKildeMs, 70_000);
  assert.deepEqual(rapport.tekster.map((t) => t.tekst), ['Roligt']);
  await db.close();
});
