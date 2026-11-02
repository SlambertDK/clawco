// KC-0200: "no thanks" to the tips mail. One toggle on the account's mail page, and a one-click unsubscribe link in the
// tips mail (RFC 8058: the mail client POSTs `List-Unsubscribe=One-Click` to the link). A GET never unsubscribes (link
// scanners fetch links), the token is stored as a hash only and does nothing else, and deleting the account removes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nyDb, ur, antal } from './hjaelp.ts';
import { kontoRuter, type KontoDeps } from '../../src/konto/ruter.ts';
import { ingenHusstand } from '../../src/konto/slet.ts';
import { sletKonto } from '../../src/konto/slet.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { vilHaveTips, saetTips, nytAfmeldLink, afmeldMedToken } from '../../src/konto/mailvalg.ts';
import { falskPost, type FalskPost } from '../../src/delt/post.ts';
import { haendelser } from '../../src/delt/haendelser.ts';
import type { Hono } from 'hono';
import type { Database } from '../../src/db/pool.ts';

const PUBLIC = 'https://konto.example.test';
const RP = { id: 'konto.example.test', navn: 'Clawco', origin: PUBLIC };

class Browser {
  jar = new Map<string, string>();
  app: Hono;
  constructor(app: Hono) { this.app = app; }
  async hent(sti: string, init: RequestInit & { origin?: string | null } = {}): Promise<Response> {
    const h = new Headers(init.headers);
    if (this.jar.size) h.set('cookie', [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '));
    if ((init.method ?? 'GET') !== 'GET' && init.origin !== null) h.set('origin', init.origin ?? PUBLIC);
    const r = await this.app.request(`${PUBLIC}${sti}`, { ...init, headers: h });
    for (const c of r.headers.getSetCookie()) {
      const [par] = c.split(';');
      const i = par!.indexOf('=');
      const k = par!.slice(0, i);
      const v = par!.slice(i + 1);
      if (/Max-Age=0/i.test(c) || v === '') this.jar.delete(k); else this.jar.set(k, v);
    }
    return r;
  }
  form(sti: string, felter: Record<string, string>, extra: { origin?: string | null } = {}): Promise<Response> {
    return this.hent(sti, { method: 'POST', body: new URLSearchParams(felter), headers: { 'content-type': 'application/x-www-form-urlencoded' }, ...extra });
  }
}

async function opsaet(): Promise<{ db: Database; post: FalskPost; app: Hono; u: ReturnType<typeof ur> }> {
  const db = await nyDb();
  const post = falskPost();
  const u = ur();
  const d: KontoDeps = { db, post, udbakke: post.udbakke, rp: RP, publicUrl: PUBLIC, dev: false, husstand: ingenHusstand(), afvikler: { async afprovisioner() {} }, haendelser: haendelser(), nu: u.nu };
  return { db, post, u, app: kontoRuter(d) };
}

const token = (post: FalskPost): string => new URL(post.udbakke.at(-1)!.data['link']!).searchParams.get('t')!;

async function logInd(b: Browser, post: FalskPost, email: string): Promise<void> {
  await b.form('/log-ind/link', { email });
  await b.hent(`/log-ind/link?t=${token(post)}`);
  await b.form('/log-ind/link/bekraeft', { t: token(post) });
}

async function csrfFra(r: Response): Promise<{ csrf: string; side: string }> {
  const side = await r.text();
  const m = /<meta name="csrf" content="([^"]+)">/.exec(side);
  assert.ok(m, 'siden har ingen csrf-meta');
  return { csrf: m[1]!, side };
}

const sti = (link: string): string => { const u = new URL(link); return `${u.pathname}${u.search}`; };

test('tips are on until the person says no, and the setting is per account', async () => {
  const { db, u } = await opsaet();
  const a = (await findEllerOpretKonto(db, 'a@example.test', u.nu())).konto.id;
  const b = (await findEllerOpretKonto(db, 'b@example.test', u.nu())).konto.id;
  assert.equal(await vilHaveTips(db, a), true);
  await saetTips(db, a, false, u.nu());
  assert.equal(await vilHaveTips(db, a), false);
  assert.equal(await vilHaveTips(db, b), true);
  await saetTips(db, a, true, u.nu());
  assert.equal(await vilHaveTips(db, a), true);
});

test('the unsubscribe link: its token is stored as a hash only, works for its own account only, and a new link replaces the old', async () => {
  const { db, u } = await opsaet();
  const a = (await findEllerOpretKonto(db, 'a@example.test', u.nu())).konto.id;
  const b = (await findEllerOpretKonto(db, 'b@example.test', u.nu())).konto.id;
  const link = await nytAfmeldLink(db, { kontoId: a, publicUrl: PUBLIC, sprog: 'en', nu: u.nu() });
  const url = new URL(link);
  assert.equal(url.origin, PUBLIC);
  assert.equal(url.pathname, '/post/afmeld');
  assert.equal(url.searchParams.get('sprog'), 'en');
  const t = url.searchParams.get('t')!;
  assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!JSON.stringify(await db.query('SELECT * FROM mailvalg')).includes(t), 'tokenet står kun som hash');
  assert.equal(await afmeldMedToken(db, 'forkert', u.nu()), false);
  assert.equal(await vilHaveTips(db, a), true, 'oprettelsen af et link afmelder ikke');
  assert.equal(await afmeldMedToken(db, t, u.nu()), true);
  assert.equal(await vilHaveTips(db, a), false);
  assert.equal(await vilHaveTips(db, b), true);
  // A new link (a later tips mail) replaces the old one.
  const nyt = new URL(await nytAfmeldLink(db, { kontoId: a, publicUrl: PUBLIC, sprog: 'da', nu: u.nu() })).searchParams.get('t')!;
  assert.equal(await afmeldMedToken(db, t, u.nu()), false);
  assert.equal(await afmeldMedToken(db, nyt, u.nu()), true);
  assert.equal(await vilHaveTips(db, a), false, 'stadig afmeldt; det gamle valg er bevaret');
});

test('one-click: a GET of the link shows a button and changes nothing; the mail client\'s POST unsubscribes at once', async () => {
  const { db, app, u } = await opsaet();
  const a = (await findEllerOpretKonto(db, 'a@example.test', u.nu())).konto.id;
  const link = await nytAfmeldLink(db, { kontoId: a, publicUrl: PUBLIC, sprog: 'da', nu: u.nu() });
  const scanner = new Browser(app);
  const vist = await scanner.hent(sti(link));
  assert.equal(vist.status, 200);
  const side = await vist.text();
  assert.match(side, /<form method="post"/);
  assert.match(side, /Afmeld tips/);
  await scanner.hent(sti(link));
  assert.equal(await vilHaveTips(db, a), true, 'et GET afmelder aldrig');
  // RFC 8058: the provider's POST comes from elsewhere (no Origin of ours, no cookie).
  const r = await scanner.hent(sti(link), { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' }, origin: null });
  assert.equal(r.status, 200);
  assert.equal(await vilHaveTips(db, a), false);
  assert.match(await r.text(), /ikke flere tips/);
});

test('the unsubscribe pages follow the mail\'s language, and a bad token changes nothing and says so', async () => {
  const { db, app, u } = await opsaet();
  const a = (await findEllerOpretKonto(db, 'a@example.test', u.nu())).konto.id;
  const link = await nytAfmeldLink(db, { kontoId: a, publicUrl: PUBLIC, sprog: 'en', nu: u.nu() });
  const b = new Browser(app);
  assert.match(await (await b.hent(sti(link))).text(), /<html lang="en">[\s\S]*Unsubscribe from tips/);
  const ok = await b.form(sti(link), {});
  assert.match(await ok.text(), /no more tips/);
  const daarlig = await b.form('/post/afmeld?t=forkert&sprog=en', {});
  assert.equal(daarlig.status, 404);
  assert.match(await daarlig.text(), /link does not work/);
  assert.equal((await b.hent('/post/afmeld')).status, 404);
  assert.equal((await b.hent('/post/afmeld?t=x&sprog=de')).status, 404);
});

test('the account\'s mail page: one toggle, behind login and CSRF; the account page links to it', async () => {
  const { db, app, post } = await opsaet();
  const b = new Browser(app);
  const ude = await b.hent('/konto/mails');
  assert.equal(ude.status, 303);
  assert.equal(ude.headers.get('location'), '/log-ind?til=/konto/mails');
  await logInd(b, post, 'a@example.test');
  assert.match(await (await b.hent('/konto')).text(), /href="\/konto\/mails"/);
  const { csrf, side } = await csrfFra(await b.hent('/konto/mails'));
  assert.match(side, /name="tips" value="ja" checked/);
  // Without the CSRF token (or from another origin) nothing changes.
  assert.equal((await b.form('/konto/mails', { tips: 'nej' })).status, 403);
  assert.equal((await b.form('/konto/mails', { tips: 'nej', csrf }, { origin: 'https://ond.example.test' })).status, 403);
  const [k] = await db.query<{ id: number }>("SELECT id FROM konto WHERE email = 'a@example.test'");
  assert.equal(await vilHaveTips(db, Number(k!.id)), true);
  const r = await b.form('/konto/mails', { tips: 'nej', csrf });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/konto/mails?gemt=1');
  assert.equal(await vilHaveTips(db, Number(k!.id)), false);
  const efter = await (await b.hent('/konto/mails?gemt=1')).text();
  assert.match(efter, /name="tips" value="nej" checked/);
  assert.match(efter, /Gemt/);
  await b.form('/konto/mails', { tips: 'ja', csrf });
  assert.equal(await vilHaveTips(db, Number(k!.id)), true);
});

test('deleting the account removes its mail choice and its unsubscribe token', async () => {
  const { db, u } = await opsaet();
  const a = (await findEllerOpretKonto(db, 'a@example.test', u.nu())).konto.id;
  await nytAfmeldLink(db, { kontoId: a, publicUrl: PUBLIC, sprog: 'da', nu: u.nu() });
  await saetTips(db, a, false, u.nu());
  assert.equal(await antal(db, 'mailvalg'), 1);
  const d = { db, husstand: ingenHusstand(), afvikler: { async afprovisioner() {} }, haendelser: haendelser(), post: falskPost() };
  assert.equal(await sletKonto(d, { kontoId: a, session: { autentificeret: u.nu() }, emailBekraeftelse: 'a@example.test', nu: u.nu() }), 'slettet');
  assert.equal(await antal(db, 'mailvalg'), 0);
});
