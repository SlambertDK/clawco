// The account routes end to end over HTTP (Hono's app.request): cookies, Origin, CSRF, the link
// flow, the passkey flow with the software authenticator, and deletion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nyDb, ur, antal } from './hjaelp.ts';
import { nyAutentifikator } from './autentifikator.ts';
import { kontoRuter, type KontoDeps } from '../../src/konto/ruter.ts';
import { ingenHusstand, type TenantAfvikler } from '../../src/konto/slet.ts';
import { FRISK_MS } from '../../src/konto/session.ts';
import { falskPost, type FalskPost } from '../../src/delt/post.ts';
import { haendelser } from '../../src/delt/haendelser.ts';
import type { Hono } from 'hono';
import type { PublicKeyCredentialCreationOptionsJSON as Opr, PublicKeyCredentialRequestOptionsJSON as Anm } from '@simplewebauthn/server';

const PUBLIC = 'https://konto.example.test';
const RP = { id: 'konto.example.test', navn: 'Clawco', origin: PUBLIC };

/** A tiny browser: keeps cookies, sends Origin on POST unless told not to. */
class Browser {
  jar = new Map<string, string>();
  app: Hono;
  constructor(app: Hono) { this.app = app; }
  async hent(sti: string, init: RequestInit & { origin?: string | null } = {}): Promise<Response> {
    const h = new Headers(init.headers);
    if (this.jar.size) h.set('cookie', [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '));
    h.set('user-agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36');
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
  json(sti: string, body: unknown, csrf?: string): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (csrf) headers['x-csrf'] = csrf;
    return this.hent(sti, { method: 'POST', body: JSON.stringify(body), headers });
  }
}

async function opsaet(over: Partial<KontoDeps> = {}) {
  const db = await nyDb();
  const post = falskPost();
  const u = ur();
  const afvist: string[] = [];
  const afvikler: TenantAfvikler = { async afprovisioner(t) { afvist.push(t); } };
  const d: KontoDeps = { db, post, udbakke: post.udbakke, rp: RP, publicUrl: PUBLIC, dev: false, husstand: ingenHusstand(), afvikler, haendelser: haendelser(), nu: u.nu, ...over };
  return { db, post, u, app: kontoRuter(d), afvist };
}

function token(post: FalskPost): string {
  return new URL(post.udbakke.at(-1)!.data['link']!).searchParams.get('t')!;
}

async function csrfFra(r: Response): Promise<string> {
  const m = /<meta name="csrf" content="([^"]+)">/.exec(await r.text());
  assert.ok(m, 'siden har ingen csrf-meta');
  return m[1]!;
}

async function logIndMedLink(b: Browser, post: FalskPost, email = 'a@example.test'): Promise<Response> {
  await b.form('/log-ind/link', { email });
  await b.hent(`/log-ind/link?t=${token(post)}`);
  return b.form('/log-ind/link/bekraeft', { t: token(post) });
}

test('sign-up by link: neutral page, browser binding cookie, POST consumes, session cookie is host-only', async () => {
  const { app, post } = await opsaet();
  const b = new Browser(app);
  assert.equal((await b.hent('/log-ind')).status, 200);
  const r = await b.form('/log-ind/link', { email: 'Ny@Example.test' });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Tjek din mail/);
  assert.ok(b.jar.has('__Host-sky-binding'));
  const link = new URL(post.udbakke[0]!.data['link']!);
  assert.equal(link.origin, PUBLIC);
  // A scanner (no cookies) fetching the link twice burns nothing.
  const scanner = new Browser(app);
  // KC-0246: a browser that did not ask sees the code to type in the first window, not a button that would fail — still burning nothing.
  const kode = post.udbakke[0]!.data['kode']!;
  assert.match(await (await scanner.hent(`${link.pathname}${link.search}`)).text(), new RegExp(`<strong>${kode}</strong>`));
  assert.match(await (await scanner.hent(`${link.pathname}${link.search}`)).text(), /Skriv koden i det vindue/);
  const ok = await b.form('/log-ind/link/bekraeft', { t: token(post) });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/konto');
  const saet = ok.headers.getSetCookie().find((c) => c.startsWith('__Host-sky='));
  assert.ok(saet);
  assert.match(saet, /HttpOnly/i);
  assert.match(saet, /Secure/i);
  assert.match(saet, /SameSite=Lax/i);
  assert.match(saet, /Path=\//);
  assert.doesNotMatch(saet, /Domain=/i);
  const konto = await b.hent('/konto');
  assert.equal(konto.status, 200);
  const side = await konto.text();
  assert.match(side, /ny@example\.test/);
  assert.match(side, /Tilføj en passkey, så logger du ind/);
  assert.match(side, /Chrome på Mac/);
});

test('the neutral answer is the same for a known and an unknown email', async () => {
  const { app, post } = await opsaet();
  const b = new Browser(app);
  await logIndMedLink(b, post, 'kendt@example.test');
  const kendt = await (await new Browser(app).form('/log-ind/link', { email: 'kendt@example.test' })).text();
  const ukendt = await (await new Browser(app).form('/log-ind/link', { email: 'ukendt@example.test' })).text();
  const skrald = await (await new Browser(app).form('/log-ind/link', { email: 'skrald' })).text();
  assert.equal(kendt, ukendt);
  assert.equal(kendt, skrald);
});

test('the link refuses another browser; the right browser still gets in', async () => {
  const { app, post } = await opsaet();
  const b = new Browser(app);
  await b.form('/log-ind/link', { email: 'a@example.test' });
  const anden = new Browser(app);
  const r = await anden.form('/log-ind/link/bekraeft', { t: token(post) });
  assert.equal(r.status, 400);
  assert.ok(!anden.jar.has('__Host-sky'));
  assert.equal((await b.form('/log-ind/link/bekraeft', { t: token(post) })).status, 303);
});

test('a POST without our Origin is refused (403) before anything happens', async () => {
  const { app, post, db } = await opsaet();
  const b = new Browser(app);
  assert.equal((await b.form('/log-ind/link', { email: 'a@example.test' }, { origin: null })).status, 403);
  assert.equal((await b.form('/log-ind/link', { email: 'a@example.test' }, { origin: 'https://ond.example.test' })).status, 403);
  assert.equal(post.udbakke.length, 0);
  await logIndMedLink(b, post);
  const csrf = await csrfFra(await b.hent('/konto'));
  assert.equal((await b.form('/log-ud', { csrf }, { origin: 'https://ond.example.test' })).status, 403);
  assert.equal(await antal(db, 'session'), 1);
});

test('logged-in POSTs need the session\'s CSRF token', async () => {
  const { app, post, db } = await opsaet();
  const b = new Browser(app);
  await logIndMedLink(b, post);
  assert.equal((await b.form('/log-ud', {})).status, 403);
  assert.equal((await b.form('/log-ud', { csrf: 'gaet' })).status, 403);
  assert.equal(await antal(db, 'session'), 1);
  const csrf = await csrfFra(await b.hent('/konto'));
  const r = await b.form('/log-ud', { csrf });
  assert.equal(r.status, 303);
  assert.equal(await antal(db, 'session'), 0);
  assert.ok(!b.jar.has('__Host-sky'));
  const ud = await b.hent('/konto');
  assert.equal(ud.status, 303);
  assert.equal(ud.headers.get('location'), '/log-ind');
});

test('another session can be ended from the account page', async () => {
  const { app, post, db } = await opsaet();
  const mac = new Browser(app);
  const telefon = new Browser(app);
  await logIndMedLink(mac, post);
  await logIndMedLink(telefon, post);
  assert.equal(await antal(db, 'session'), 2);
  const side = await mac.hent('/konto');
  const csrf = await csrfFra(side.clone());
  const id = /action="\/konto\/sessioner\/(\d+)\/afslut"/.exec(await side.text())?.[1];
  assert.ok(id);
  assert.equal((await mac.form(`/konto/sessioner/${id}/afslut`, { csrf })).status, 303);
  assert.equal((await telefon.hent('/konto')).status, 303, 'telefonen er logget ud');
  assert.equal((await mac.hent('/konto')).status, 200);
});

test('passkey: add after a link login, log out, log in with it, counter regression refused', async () => {
  const { app, post } = await opsaet();
  const b = new Browser(app);
  await logIndMedLink(b, post);
  const csrf = await csrfFra(await b.hent('/konto/passkeys'));
  const auth = nyAutentifikator();
  const o = await (await b.json('/konto/passkeys/ny/muligheder', {}, csrf)).json() as Opr;
  const reg = await b.json('/konto/passkeys/ny', { svar: auth.registrer(o, PUBLIC), navn: 'Min Mac' }, csrf);
  assert.equal(reg.status, 200);
  assert.match(await (await b.hent('/konto/passkeys')).text(), /Min Mac/);
  await b.form('/log-ud', { csrf });

  const ny = new Browser(app);
  const lo = await (await ny.json('/log-ind/passkey/muligheder', {})).json() as Anm;
  const ind = await ny.json('/log-ind/passkey', { svar: auth.logInd(lo, PUBLIC), til: '/konto/passkeys' });
  assert.equal(ind.status, 200);
  assert.deepEqual(await ind.json(), { til: '/konto/passkeys' });
  assert.equal((await ny.hent('/konto')).status, 200);

  auth.taeller = 1;
  const igen = new Browser(app);
  const lo2 = await (await igen.json('/log-ind/passkey/muligheder', {})).json() as Anm;
  assert.equal((await igen.json('/log-ind/passkey', { svar: auth.logInd(lo2, PUBLIC) })).status, 401);
  assert.ok(!igen.jar.has('__Host-sky'));
});

test('after a passkey login, `til` only goes to our own account pages', async () => {
  const { app, post } = await opsaet();
  const b = new Browser(app);
  await logIndMedLink(b, post);
  const csrf = await csrfFra(await b.hent('/konto/passkeys'));
  const auth = nyAutentifikator();
  const o = await (await b.json('/konto/passkeys/ny/muligheder', {}, csrf)).json() as Opr;
  await b.json('/konto/passkeys/ny', { svar: auth.registrer(o, PUBLIC), navn: 'x' }, csrf);
  const ny = new Browser(app);
  const lo = await (await ny.json('/log-ind/passkey/muligheder', {})).json() as Anm;
  assert.deepEqual(await (await ny.json('/log-ind/passkey', { svar: auth.logInd(lo, PUBLIC), til: 'https://ond.example.test/' })).json(), { til: '/konto' });
});

test('KC-0183: `til` may also be the gateway\'s /aabn return path, and nothing that leaves it', async () => {
  const { app } = await opsaet();
  const aabn = '/aabn?t=hus-abcdefgh&n=%2Frum%2Fmail&s=Ab_-9';
  const side = await (await app.request(`/log-ind?til=${encodeURIComponent(aabn)}`)).text();
  assert.match(side, /data-til="\/aabn\?t=hus-abcdefgh&amp;n=%2Frum%2Fmail&amp;s=Ab_-9"/);
  for (const ond of ['/aabn?t=x"><script>', '/aabnx?t=1', '//aabn?t=1', '/aabn?t=1#x', 'https://ond.example.test/aabn?t=1']) {
    assert.match(await (await app.request(`/log-ind?til=${encodeURIComponent(ond)}`)).text(), /data-til="\/konto"/, ond);
  }
});

test('changing passkeys needs fresh authentication', async () => {
  const { app, post, u } = await opsaet();
  const b = new Browser(app);
  await logIndMedLink(b, post);
  const csrf = await csrfFra(await b.hent('/konto/passkeys'));
  u.frem(FRISK_MS + 1);
  assert.equal((await b.json('/konto/passkeys/ny/muligheder', {}, csrf)).status, 403);
  assert.match(await (await b.hent('/konto/passkeys')).text(), /Log ind igen/);
});

test('delete: fresh + typed email → the account is gone, the cookie is cleared, an event is sent', async () => {
  const h = haendelser();
  const set: number[] = [];
  h.lyt('konto.slettet', (e) => { set.push(e.kontoId); });
  const { app, post, db } = await opsaet({ haendelser: h });
  const b = new Browser(app);
  await logIndMedLink(b, post, 'slet@example.test');
  const csrf = await csrfFra(await b.hent('/konto/slet'));
  const forkert = await b.form('/konto/slet', { csrf, email: 'anden@example.test' });
  assert.equal(forkert.status, 400);
  assert.match(await forkert.text(), /Det er ikke mailen på denne konto/);
  const r = await b.form('/konto/slet', { csrf, email: 'slet@example.test' });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Din konto er slettet/);
  assert.ok(!b.jar.has('__Host-sky'));
  assert.equal(await antal(db, 'session'), 0);
  assert.equal(set.length, 1);
  assert.deepEqual([post.udbakke.at(-1)?.til, post.udbakke.at(-1)?.skabelon], ['slet@example.test', 'konto-slettet'], 'kvitteringen gik til den adresse, kontoen havde');
  assert.equal((await b.hent('/konto')).status, 303);
});

test('the dev outbox exists only with SKY_DEV=1', async () => {
  const { app } = await opsaet();
  assert.equal((await new Browser(app).hent('/dev/udbakke')).status, 404);
  const dev = await opsaet({ dev: true });
  const b = new Browser(dev.app);
  await b.form('/log-ind/link', { email: 'a@example.test' });
  const r = await b.hent('/dev/udbakke');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /\/log-ind\/link\?t=/);
});

test('pages carry security headers and the static files are served', async () => {
  const { app } = await opsaet();
  const b = new Browser(app);
  const r = await b.hent('/log-ind');
  assert.match(r.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  // same-origin, not no-referrer: with no-referrer Chrome sends 'Origin: null' on our own form POSTs and the Origin check refuses them (found in the browser walk).
  assert.equal(r.headers.get('referrer-policy'), 'same-origin');
  assert.match(await r.clone().text(), /<meta name="referrer" content="same-origin">/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const css = await b.hent('/sky.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type') ?? '', /text\/css/);
  const js = await b.hent('/konto.js');
  assert.equal(js.status, 200);
  assert.match(await js.text(), /parseRequestOptionsFromJSON/);
});

test('KC-0182: /konto asks the fleet seam about the logged-in account and shows its Clawco', async () => {
  const spurgt: number[] = [];
  const { app, post } = await opsaet({ clawco: async (kontoId) => { spurgt.push(kontoId); return { url: 'https://hus-abcdefgh.clawco.example/' }; } });
  const b = new Browser(app);
  await logIndMedLink(b, post);
  const side = await (await b.hent('/konto')).text();
  assert.match(side, /Din Clawco: <a href="https:\/\/hus-abcdefgh\.clawco\.example\/">/);
  assert.equal(spurgt.length, 1);
});

// --- KC-0198: sign-up comes back to the flow -------------------------------------------------------

test('KC-0198: a link asked for from the sign-up flow logs in and lands back in the flow, plan and interval kept', async () => {
  const { app, post } = await opsaet();
  const b = new Browser(app);
  await b.form('/log-ind/link', { email: 'ny@example.test', til: '/tilmeld?plan=sky-husstand&interval=aar' });
  await b.hent(`/log-ind/link?t=${token(post)}`);
  const r = await b.form('/log-ind/link/bekraeft', { t: token(post) });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/tilmeld?plan=sky-husstand&interval=aar');
  assert.ok(![...b.jar.keys()].some((k) => k.includes('sky-til')), 'the return cookie is spent');
});

test('KC-0198: a return target that is not ours is ignored (no open redirect)', async () => {
  for (const til of ['https://ond.example/tilmeld', '//ond.example', '/tilmeld/../konto/slet', '/tilmeldx', '/tilmeld?x=<script>']) {
    const { app, post } = await opsaet();
    const b = new Browser(app);
    await b.form('/log-ind/link', { email: 'a@example.test', til });
    const r = await b.form('/log-ind/link/bekraeft', { t: token(post) });
    assert.equal(r.headers.get('location'), '/konto', til);
  }
});

test('KC-0198: the login page carries the return target into the mail form; a dead link offers a new one from the flow', async () => {
  const { app, post, u } = await opsaet();
  const b = new Browser(app);
  const t = await (await b.hent('/log-ind?til=%2Ftilmeld')).text();
  assert.match(t, /<input type="hidden" name="til" value="\/tilmeld">/);
  await b.form('/log-ind/link', { email: 'a@example.test', til: '/tilmeld' });
  u.frem(16 * 60_000);
  const doed = await (await b.hent(`/log-ind/link?t=${token(post)}`)).text();
  assert.match(doed, /href="\/tilmeld"/);
});

test('KC-0198: sign-up links are rate-limited like every login link (5 per address per window)', async () => {
  const { app, post } = await opsaet();
  const b = new Browser(app);
  for (let i = 0; i < 7; i++) assert.equal((await b.form('/log-ind/link', { email: 'flood@example.test', til: '/tilmeld' })).status, 200);
  assert.equal(post.udbakke.filter((m) => m.til === 'flood@example.test').length, 5);
});

// --- KC-0206: Hent alt over a 24-hour link ------------------------------------------------------------------
const EJER_H = { async forKonto() { return { tenantId: 'hus-abcdefgh', rolle: 'ejer' as const, medlemmer: [] }; }, async forlad() {} };

async function eksportLink(b: Browser): Promise<string> {
  const csrf = await csrfFra(await b.hent('/konto/hent-alt'));
  const r = await b.form('/konto/hent-alt', { csrf });
  assert.equal(r.status, 200);
  const m = /href="(\/konto\/hent-alt\/fil\?t=[A-Za-z0-9_-]{43})"/.exec(await r.text());
  assert.ok(m, 'the page shows the link');
  return m[1]!;
}

test('KC-0206: Hent alt gives a link that downloads one zip for this account, and only for 24 hours', async () => {
  const tenantZip = Buffer.from('PK-tenant');
  const { app, post, u } = await opsaet({ husstand: EJER_H, eksport: { tenant: async () => tenantZip } });
  const b = new Browser(app);
  await logIndMedLink(b, post);
  const side = await b.hent('/konto/hent-alt');
  assert.equal(side.status, 200);
  assert.match(await side.text(), /Hent alt/);
  const link = await eksportLink(b);
  const fil = await b.hent(link);
  assert.equal(fil.status, 200);
  assert.equal(fil.headers.get('content-type'), 'application/zip');
  assert.match(fil.headers.get('content-disposition') ?? '', /^attachment; filename="clawco-\d{4}-\d{2}-\d{2}\.zip"$/);
  assert.equal(fil.headers.get('cache-control'), 'no-store');
  const zip = Buffer.from(await fil.arrayBuffer());
  assert.ok(zip.includes(tenantZip), 'the tenant\'s own export is inside');
  // Another account, logged in in another browser, cannot use the link.
  const anden = new Browser(app);
  await logIndMedLink(anden, post, 'b@example.test');
  const fremmed = await anden.hent(link);
  assert.equal(fremmed.status, 404);
  assert.match(await fremmed.text(), /virker ikke/);
  // Not logged in: to the login page, back here after.
  const ude = await new Browser(app).hent(link);
  assert.equal(ude.status, 303);
  assert.equal(ude.headers.get('location'), '/log-ind?til=/konto/hent-alt');
  u.frem(24 * 3_600_000 + 1);
  assert.equal((await b.hent(link)).status, 404, 'expired after 24 h');
});

test('KC-0206: making the link needs CSRF and a fresh login; an unreadable Clawco is a 503, never a partial zip', async () => {
  const { app, post, u } = await opsaet({ husstand: EJER_H, eksport: { tenant: async () => { throw new Error('tenant svarede 502'); } } });
  const b = new Browser(app);
  await logIndMedLink(b, post);
  assert.equal((await b.form('/konto/hent-alt', {})).status, 403, 'no CSRF');
  const link = await eksportLink(b);
  const fil = await b.hent(link);
  assert.equal(fil.status, 503);
  assert.notEqual(fil.headers.get('content-type'), 'application/zip');
  assert.match(await fil.text(), /prøv igen/i);
  u.frem(FRISK_MS + 1);
  const side = await b.hent('/konto/hent-alt');
  assert.match(await side.text(), /Log ind igen/);
  const csrf = await csrfFra(await b.hent('/konto'));
  assert.equal((await b.form('/konto/hent-alt', { csrf })).status, 403, 'stale login: no link');
});

// --- KC-0246: the code from the sign-in mail, for a person who asks on one device and opens the mail on another ------------------
const kodeFra = (post: FalskPost): string => post.udbakke.at(-1)!.data['kode']!;
const forkertKode = (kode: string): string => (kode[0] === '2' ? '3' : '2') + kode.slice(1);

test('KC-0246: asked in browser A, the link opened in browser B shows the code, A types it and is signed in; the code and the link are then spent', async () => {
  const { app, post } = await opsaet();
  const a = new Browser(app);
  const venter = await (await a.form('/log-ind/link', { email: 'laptop@example.test' })).text();
  assert.match(venter, /action="\/log-ind\/kode"/, 'the waiting page has the field');
  assert.match(venter, /Eller skriv koden fra mailen/);
  // The phone (browser B, no cookies from A) opens the mail's link.
  const b = new Browser(app);
  const link = new URL(post.udbakke[0]!.data['link']!);
  const sideB = await b.hent(`${link.pathname}${link.search}`);
  assert.equal(sideB.status, 200);
  const htmlB = await sideB.text();
  assert.match(htmlB, /Skriv koden i det vindue, hvor du loggede ind/);
  assert.ok(htmlB.includes(`<strong>${kodeFra(post)}</strong>`), 'the page shows the same code as the mail');
  assert.ok(!htmlB.includes('name="t"'), 'no login button in the wrong browser');
  assert.ok(!b.jar.has('__Host-sky'), 'the phone is not signed in');
  // B cannot use the code (it has no binding), and trying does not spend A's login.
  assert.equal((await b.form('/log-ind/kode', { kode: kodeFra(post) })).status, 400);
  assert.ok(!b.jar.has('__Host-sky'));
  // A types it (lower case, no hyphen: tidied) and is in.
  const ok = await a.form('/log-ind/kode', { kode: kodeFra(post).replace('-', '').toLowerCase() });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/konto');
  const saet = ok.headers.getSetCookie().find((c) => c.startsWith('__Host-sky='));
  assert.ok(saet && /HttpOnly/i.test(saet) && /Secure/i.test(saet) && /SameSite=Lax/i.test(saet) && !/Domain=/i.test(saet));
  assert.equal((await a.hent('/konto')).status, 200);
  assert.ok(!a.jar.has('__Host-sky-binding'), 'the binding is spent with the login');
  // Single use, both ways.
  const igen = new Browser(app);
  await igen.form('/log-ind/link', { email: 'laptop@example.test' });
  const andenKode = kodeFra(post);
  assert.equal((await igen.form('/log-ind/kode', { kode: andenKode })).status, 303);
  assert.equal((await igen.form('/log-ind/kode', { kode: andenKode })).status, 400, 'the same code twice');
  const efter = await b.hent(`/log-ind/link?t=${new URL(post.udbakke.at(-1)!.data['link']!).searchParams.get('t')}`);
  assert.match(await efter.text(), /Linket virker ikke længere/, 'the link is spent by the code');
});

test('KC-0246: the link still works in the browser that asked (button, POST), and then the code is spent', async () => {
  const { app, post } = await opsaet();
  const a = new Browser(app);
  await a.form('/log-ind/link', { email: 'a@example.test' });
  const side = await (await a.hent(`/log-ind/link?t=${token(post)}`)).text();
  assert.match(side, /name="t"/, 'same browser: the button, as before');
  const kode = kodeFra(post);
  assert.equal((await a.form('/log-ind/link/bekraeft', { t: token(post) })).status, 303);
  const b = new Browser(app);
  b.jar.set('__Host-sky-binding', a.jar.get('__Host-sky-binding') ?? 'x');
  assert.equal((await b.form('/log-ind/kode', { kode })).status, 400);
});

test('KC-0246: five wrong codes void that login — the page says so, the sixth try fails with the right code, the link is dead; a new mail starts over', async () => {
  const { app, post } = await opsaet();
  const a = new Browser(app);
  await a.form('/log-ind/link', { email: 'a@example.test' });
  const rigtig = kodeFra(post);
  for (let i = 1; i <= 5; i++) {
    const r = await a.form('/log-ind/kode', { kode: forkertKode(rigtig) });
    assert.equal(r.status, 400);
    const h = await r.text();
    if (i < 5) { assert.match(h, /Koden passer ikke/); assert.match(h, /name="kode"/); } else { assert.match(h, /Koden virker ikke længere/); assert.match(h, /Bed om et nyt link/); assert.doesNotMatch(h, /name="kode"/); }
  }
  assert.equal((await a.form('/log-ind/kode', { kode: rigtig })).status, 400);
  assert.ok(!a.jar.has('__Host-sky'));
  assert.match(await (await a.hent(`/log-ind/link?t=${token(post)}`)).text(), /Linket virker ikke længere/);
  await a.form('/log-ind/link', { email: 'a@example.test' });
  assert.equal((await a.form('/log-ind/kode', { kode: kodeFra(post) })).status, 303, 'a new mail is a new login');
});

test('KC-0246: the code route has the link\'s protections: Origin is checked first, a body limit applies, failures share the IP budget', async () => {
  const { app, post, db } = await opsaet();
  const a = new Browser(app);
  await a.form('/log-ind/link', { email: 'a@example.test' });
  assert.equal((await a.form('/log-ind/kode', { kode: kodeFra(post) }, { origin: null })).status, 403);
  assert.equal((await a.form('/log-ind/kode', { kode: kodeFra(post) }, { origin: 'https://evil.example.test' })).status, 403);
  assert.equal((await a.hent('/log-ind/kode')).status, 404, 'no GET: the code is never in a URL');
  assert.equal(await antal(db, 'loginkode'), 1);
  const stor = await a.form('/log-ind/kode', { kode: 'x'.repeat(70_000) });
  assert.equal(stor.status, 413);
  // Failures (any kind) from one address fill the same budget as failed links: then even the right code is refused from it.
  for (let i = 0; i < 12; i++) await new Browser(app).form('/log-ind/kode', { kode: 'AAAAAAAA' });
  const blokeret = await a.form('/log-ind/kode', { kode: kodeFra(post) });
  assert.equal(blokeret.status, 429);
  assert.ok(!a.jar.has('__Host-sky'));
  assert.match(await blokeret.text(), /For mange forsøg/);
});

test('KC-0246: a code typed after the sign-up flow\'s link request lands where the link would (the sign-up page), and nowhere else', async () => {
  const { app, post } = await opsaet();
  const a = new Browser(app);
  await a.form('/log-ind/link', { email: 'ny@example.test', til: '/tilmeld?plan=familie' });
  const ok = await a.form('/log-ind/kode', { kode: kodeFra(post) });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/tilmeld?plan=familie');
  assert.ok(!a.jar.has('__Host-sky-til'), 'the landing cookie is spent');
});

test('KC-0246: the code never shows in a log, a header or a URL on the way', async () => {
  const { app, post } = await opsaet();
  const fanget: string[] = [];
  const gemt = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const k of Object.keys(gemt) as (keyof typeof gemt)[]) console[k] = (...a: unknown[]) => { fanget.push(a.map(String).join(' ')); };
  let kode = '';
  try {
    const a = new Browser(app);
    await a.form('/log-ind/link', { email: 'a@example.test' });
    kode = kodeFra(post);
    await a.form('/log-ind/kode', { kode: forkertKode(kode) });
    const ok = await a.form('/log-ind/kode', { kode });
    assert.ok(!(ok.headers.get('location') ?? '').includes(kode.replace('-', '')));
    for (const [, v] of ok.headers) assert.ok(!v.includes(kode), 'headers');
  } finally { Object.assign(console, gemt); }
  assert.ok(!fanget.join('\n').includes(kode.replace('-', '')) && !fanget.join('\n').includes(kode));
});
