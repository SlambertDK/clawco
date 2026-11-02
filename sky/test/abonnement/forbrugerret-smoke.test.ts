// KC-0209 smoke: the consumer-rights flow in-process through Sky's real wiring (forbind + createSkyApp), with the fake
// mail (SKY_DEV), the fake Stripe and its dev Checkout page: sign-up with the statement and its boxes, the receipt, the
// account page with "Opsig" and "Fortryd aftale" (found in the page's own HTML, as a person would), the click counts
// (cancel takes at most three and never more than signing up), and a withdrawal that ends in the owner's refund task.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Hono } from 'hono';
import { createSkyApp, forbind } from '../../src/server.ts';
import { laesConfig } from '../../src/config.ts';
import { pgliteDatabase } from '../pglite.ts';
import { migrer } from '../../src/db/migrer.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { gemProfil } from '../../src/konto/profil.ts';
import { opretSession } from '../../src/konto/session.ts';
import { laesSamtykke } from '../../src/tilmelding/samtykke.ts';
import { sikrKunde } from '../../src/abonnement/kunde.ts';
import { aabneRefusioner } from '../../src/abonnement/bestilling.ts';
import { FROE } from '../gateway/hjaelp.ts';
import type { Database } from '../../src/db/pool.ts';

const PUBLIC = 'https://konto.example.test';

/** A browser with a click counter: every link followed and every button pressed is one click, every box ticked is one. */
class Browser {
  jar = new Map<string, string>();
  klik = 0;
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
  /** Follows a link (one click). */
  async foelg(href: string): Promise<Response> { this.klik++; return this.hent(href.replace(/&amp;/g, '&')); }
  /** Presses a button of a form (one click), plus one per box ticked. */
  async tryk(sti: string, felter: Record<string, string>, kryds = 0): Promise<Response> {
    this.klik += 1 + kryds;
    return this.hent(sti, { method: 'POST', body: new URLSearchParams(felter), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  }
}

const csrf = (t: string): string => /<meta name="csrf" content="([^"]+)">/.exec(t)![1]!;
const felt = (t: string, navn: string): string => new RegExp(`name="${navn}" value="([^"]+)"`).exec(t)![1]!;
const linkMed = (t: string, tekst: string): string => new RegExp(`<a href="([^"]+)">${tekst}</a>`).exec(t)?.[1] ?? '';
const tekst = (t: string): string => t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

async function opsaet(): Promise<{ db: Database; app: Hono; f: Awaited<ReturnType<typeof forbind>> }> {
  const db = await pgliteDatabase();
  await migrer(db);
  const env = { SKY_DATABASE_URL: 'postgres:///sky', SKY_PUBLIC_URL: PUBLIC, SKY_DEV: '1', SKY_TILMELDING: 'open', SKY_GATEWAY_SIGNERINGSNOEGLE: FROE };
  const f = await forbind(laesConfig(env), db, { ...env });
  const app = createSkyApp({ db, sha: 'x', startet: Date.now(), konto: f.konto, abonnement: f.abonnement, dev: f.dev, loginVej: f.gateway.loginVej, tilmelding: f.tilmelding });
  return { db, app, f };
}

const mailTil = (f: Awaited<ReturnType<typeof forbind>>, skabelon: string) => f.konto.udbakke!.filter((m) => m.skabelon === skabelon);

test('smoke: sign-up with the statement and both boxes, receipt, Opsig in at most three clicks (and never more than signing up)', async () => {
  const { db, app, f } = await opsaet();
  const b = new Browser(app);

  // Sign-up: the account by mail link, the profile, the plan, the statement, Stripe's page.
  const start = await (await b.hent('/tilmeld?plan=sky-solo&interval=maaned')).text();
  await b.tryk('/log-ind/link', { email: 'koeber@example.test', til: felt(start, 'til').replace(/&amp;/g, '&') });
  const link = f.konto.udbakke!.at(-1)!.data['link']!;
  await b.foelg(link);
  const ind = await b.tryk('/log-ind/link/bekraeft', { t: new URL(link).searchParams.get('t')! });
  const profil = await (await b.hent(ind.headers.get('location')!)).text();
  const ok = await b.tryk('/tilmeld/profil', { csrf: csrf(profil), land: 'DK', sprog: 'da', vilkaar: felt(profil, 'vilkaar'), privatliv: felt(profil, 'privatliv'), plan: 'sky-solo', interval: 'maaned' }, 2);
  const plan = await (await b.hent(ok.headers.get('location')!)).text();
  assert.match(plan, /action="\/konto\/abonnement\/bekraeft"/);
  const bekraeft = await (await b.foelg(`/konto/abonnement/bekraeft?plan=sky-solo&interval=maaned&land=${felt(plan, 'land')}&retur=tilmelding`)).text();
  assert.match(bekraeft, /Bekræft din gratis prøve/);
  assert.match(bekraeft, /Det er den fulde pris\./);
  assert.doesNotMatch(bekraeft, /moms|\bVAT\b/i, 'no VAT is mentioned while moms.aktiv is false (KC-0194, G6)');

  // The statement's button without the boxes is refused; with both it goes on to Stripe's page.
  const uden = await b.tryk('/api/abonnement/checkout', { csrf: csrf(bekraeft), plan: 'sky-solo', interval: 'maaned', land: 'DK', retur: 'tilmelding' });
  assert.equal(uden.status, 400);
  assert.match(await uden.text(), /Sæt kryds i begge felter/);
  assert.equal(f.abonnement.klient!.tilstand, 'test');
  const co = await b.tryk('/api/abonnement/checkout', { csrf: csrf(bekraeft), plan: 'sky-solo', interval: 'maaned', land: 'DK', retur: 'tilmelding', vilkaar: felt(bekraeft, 'vilkaar'), straks: 'ja' }, 2);
  assert.equal(co.status, 303);
  const stripe = new URL(co.headers.get('location')!);
  assert.match(stripe.pathname, /^\/dev\/stripe\/checkout\/cs_/);
  await b.tryk(stripe.pathname, {});
  const tilmeldKlik = b.klik;

  // The receipt: sent by the webhook the fake delivered.
  const kv = mailTil(f, 'kvittering');
  assert.equal(kv.length, 1);
  assert.equal(kv[0]?.til, 'koeber@example.test');
  assert.match(kv[0]!.data['pris']!, /^79 kr\. om måneden\. Det er den fulde pris\.$/);
  assert.equal(kv[0]?.data['vilkaarversion'], laesSamtykke().vilkaar.version);

  // The account page offers both buttons, found in its own HTML.
  b.klik = 0;
  const konto = await (await b.hent('/konto')).text();
  const opsigLink = linkMed(konto, 'Opsig abonnement');
  assert.ok(opsigLink, 'Opsig is on the account page');
  assert.ok(linkMed(konto, 'Fortryd aftale'), 'Fortryd aftale is on the account page');

  // Opsig: link, confirmation button. Nothing to log in to, nobody to contact.
  const side = await (await b.foelg(opsigLink)).text();
  const form = /<form method="post" action="([^"]+)"/.exec(side)![1]!;
  const r = await b.tryk(form, { csrf: csrf(side) });
  const opsagt = tekst(await r.text());
  assert.equal(r.status, 200);
  assert.match(opsagt, /Abonnementet er opsagt/);
  assert.match(opsagt, /Det slutter .*20\d\d\. Du har adgang til din Clawco, til det er slut\. Bekræftelsen er sendt på mail\./);
  const opsigKlik = b.klik;
  assert.equal(mailTil(f, 'opsigelse').length, 1);
  assert.ok(opsigKlik <= 3, `Opsig must take at most three clicks from the account page (it took ${opsigKlik})`);
  assert.ok(opsigKlik <= tilmeldKlik, `cancelling (${opsigKlik}) must never take more steps than signing up (${tilmeldKlik})`);
  assert.ok(tilmeldKlik > opsigKlik, 'signing up takes more clicks than cancelling');

  // The entitlement followed through the webhook the fake delivered: the account page now says when it ends, and no Opsig.
  const efter = await (await b.hent('/konto')).text();
  assert.match(tekst(efter), /Slutter /);
  assert.equal(linkMed(efter, 'Opsig abonnement'), '');
  console.log(`sky smoke KC-0209: tilmelding ${tilmeldKlik} klik, opsigelse ${opsigKlik} klik`);
  await db.close();
});

test('smoke: a paid purchase, Fortryd aftale in two clicks, receipt by mail and a refund task for the owner (no refund made by code)', async () => {
  const { db, app, f } = await opsaet();
  const sam = laesSamtykke();
  const { konto } = await findEllerOpretKonto(db, 'betaler@example.test', new Date());
  await gemProfil(db, konto.id, { land: 'DK', sprog: 'da', vilkaar: sam.vilkaar.version, privatliv: sam.privatliv.version, nu: new Date() });
  const klient = f.abonnement.klient!;
  await sikrKunde(db, klient, { kontoId: konto.id, email: 'betaler@example.test', sprog: 'da', land: 'DK', nu: new Date() });
  await db.query('UPDATE abonnement.kunde SET proeve_brugt = true');
  const { token } = await opretSession(db, { kontoId: konto.id, metode: 'link', enhed: '', nu: new Date() });
  const b = new Browser(app);
  b.jar.set('__Host-sky', token);

  const bekraeft = await (await b.hent('/konto/abonnement/bekraeft?plan=sky-solo&interval=maaned&land=DK')).text();
  assert.match(bekraeft, /Betal 79 kr\. og start nu/);
  const co = await b.tryk('/api/abonnement/checkout', { csrf: csrf(bekraeft), plan: 'sky-solo', interval: 'maaned', land: 'DK', vilkaar: felt(bekraeft, 'vilkaar'), straks: 'ja', pris: '7900', proeve: '0' }, 2);
  assert.equal(co.status, 303);
  await b.tryk(new URL(co.headers.get('location')!).pathname, {});
  assert.equal(mailTil(f, 'kvittering').length, 1);

  b.klik = 0;
  const kontoSide = await (await b.hent('/konto')).text();
  const fortrydLink = linkMed(kontoSide, 'Fortryd aftale');
  assert.ok(fortrydLink);
  const side = await (await b.foelg(fortrydLink)).text();
  assert.match(tekst(side), /Du kan fortryde aftalen til og med/);
  assert.match(tekst(side), /Vi tilbagebetaler inden for 14 dage\./);
  const r = await b.tryk(/<form method="post" action="([^"]+)"/.exec(side)![1]!, { csrf: csrf(side) });
  assert.equal(r.status, 200);
  assert.match(tekst(await r.text()), /Du har fortrudt aftalen.*Din kvittering er sendt på mail\./);
  assert.equal(b.klik, 2, 'a withdrawal is two clicks: the link and the confirmation');

  assert.equal(mailTil(f, 'fortrydelse').length, 1);
  assert.equal((await klient.listAbonnementer((await db.query<{ stripe_kunde: string }>('SELECT stripe_kunde FROM abonnement.kunde'))[0]!.stripe_kunde))[0]?.status, 'canceled');
  const [opgave] = await aabneRefusioner(db);
  assert.equal(opgave?.kontoId, konto.id);
  assert.ok(opgave && opgave.beloebOere > 0 && opgave.beloebOere < 7900, `proportional amount: ${opgave?.beloebOere}`);
  // Billing sees the cancellation like any other: the entitlement is "opsagt", and the account page offers neither button.
  const efter = await (await b.hent('/konto')).text();
  assert.equal(linkMed(efter, 'Opsig abonnement'), '');
  assert.equal(linkMed(efter, 'Fortryd aftale'), '');
  await db.close();
});
