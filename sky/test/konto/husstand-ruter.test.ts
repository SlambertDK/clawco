// KC-0184 over HTTP: the owner's household page, the preview that equals the send, the owner's own click, the invited
// person's page and accept, and the refusals (another account, a non-owner, a full plan). Hono's app.request with a
// tiny cookie-keeping browser, the fake mail client and a fake tenant call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Hono } from 'hono';
import { nyDb, ur } from './hjaelp.ts';
import { kontoRuter, type KontoDeps } from '../../src/konto/ruter.ts';
import { ingenAfvikler, ingenHusstand } from '../../src/konto/slet.ts';
import { falskPost, renderBesked, type FalskPost } from '../../src/delt/post.ts';
import { haendelser } from '../../src/delt/haendelser.ts';
import { bestil, skift } from '../../src/fleet/tilstand.ts';
import { kontoForEmail } from '../../src/konto/konto.ts';
import type { MedlemOp } from '../../src/konto/medlemskab.ts';

const PUBLIC = 'https://konto.example.test';
const RP = { id: 'konto.example.test', navn: 'Clawco', origin: PUBLIC };

class Browser {
  jar = new Map<string, string>();
  app: Hono;
  constructor(app: Hono) { this.app = app; }
  async hent(sti: string, init: RequestInit = {}): Promise<Response> {
    const h = new Headers(init.headers);
    if (this.jar.size) h.set('cookie', [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '));
    if ((init.method ?? 'GET') !== 'GET') h.set('origin', PUBLIC);
    const r = await this.app.request(`${PUBLIC}${sti}`, { ...init, headers: h });
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

const csrfAf = (html: string): string => /<meta name="csrf" content="([^"]+)">/.exec(html)![1]!;
const linkToken = (post: FalskPost, skabelon: string): string => new URL(post.udbakke.filter((b) => b.skabelon === skabelon).at(-1)!.data['link']!).searchParams.get('t')!;
const afkod = (s: string): string => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

async function opsaet() {
  const db = await nyDb();
  const post = falskPost();
  const u = ur();
  const max = { n: 6 };
  const ops: MedlemOp[] = [];
  const glemt: string[] = [];
  const d: KontoDeps = {
    db, post, udbakke: post.udbakke, rp: RP, publicUrl: PUBLIC, dev: false, husstand: ingenHusstand(), afvikler: ingenAfvikler(), haendelser: haendelser(), nu: u.nu,
    medlemskab: { kald: { async medlem(_t, op) { ops.push(op); return { aendret: true }; } }, entitlements: { medlemmer: async () => max.n }, glem: (s) => { glemt.push(s); }, url: (slug) => `https://${slug}.example.test/` },
  };
  const app = kontoRuter(d);
  const logInd = async (email: string, til = '/konto'): Promise<Browser> => {
    const b = new Browser(app);
    await b.form('/log-ind/link', { email, til });
    const r = await b.form('/log-ind/link/bekraeft', { t: linkToken(post, 'maillink') });
    assert.equal(r.status, 303);
    return b;
  };
  const ejer = await logInd('ejer@example.test');
  const ejerId = (await kontoForEmail(db, 'ejer@example.test'))!.id;
  const t = await bestil(db, { kontoId: ejerId, driver: 'lokal', nu: u.nu(), nySlug: () => 'hus-abcdefgh' });
  await skift(db, t.slug, ['bestilt'], 'klar', u.nu(), { adresse: 'http://127.0.0.1:1' });
  return { db, post, u, max, ops, glemt, app, logInd, ejer };
}

async function inviter(s: Awaited<ReturnType<typeof opsaet>>, email = 'nora@example.test'): Promise<{ preview: string; send: Response }> {
  const side = await (await s.ejer.hent('/konto/husstand')).text();
  const csrf = csrfAf(side);
  const p = await s.ejer.form('/konto/husstand/inviter', { csrf, email, navn: 'Nora', rolle: 'barn', inviterer: 'Ida' });
  assert.equal(p.status, 200);
  const preview = await p.text();
  const id = /name="id" value="(\d+)"/.exec(preview)![1]!;
  const t = /name="t" value="([A-Za-z0-9_-]{43})"/.exec(preview)![1]!;
  return { preview, send: await s.ejer.form('/konto/husstand/inviter/send', { csrf, id, t }) };
}

test('the owner sees the exact mail first (nothing sent), then his own click sends exactly that', async () => {
  const s = await opsaet();
  const side = await (await s.ejer.hent('/konto/husstand')).text();
  assert.match(side, /data-inviter/);
  assert.match(side, /data-boern/, 'the children consent note (draft) is on the invite screen');
  assert.match(side, /1 af 6 pladser/);
  const { preview, send } = await inviter(s);
  assert.equal(send.status, 303);
  assert.equal(send.headers.get('location'), '/konto/husstand?ok=sendt');
  const sendte = s.post.udbakke.filter((b) => b.skabelon === 'invitation');
  assert.equal(sendte.length, 1);
  const mail = renderBesked(sendte[0]!);
  const vist = afkod(/<pre class="kort" data-mail>([\s\S]*?)<\/pre>/.exec(preview)![1]!);
  assert.equal(vist, mail.tekst.replace(/\r\n/g, '\n'), 'preview equals send, link included');
  assert.equal(afkod(/<span data-emne>([^<]*)<\/span>/.exec(preview)![1]!), mail.emne);
  const efter = await (await s.ejer.hent('/konto/husstand?ok=sendt')).text();
  assert.match(efter, /data-invitation="nora@example.test"/);
  assert.match(efter, /2 af 6 pladser/);
});

test('the invited person: logged out she is sent to log in and back; with her own address she accepts and opens the household', async () => {
  const s = await opsaet();
  await inviter(s);
  const t = linkToken(s.post, 'invitation');
  const ude = await new Browser(s.app).hent(`/invitation?t=${t}`);
  assert.equal(ude.status, 200);
  assert.match(await ude.text(), new RegExp(`/log-ind\\?til=${encodeURIComponent(`/invitation?t=${t}`).replace(/[?]/g, '\\?')}`));
  const nora = await s.logInd('nora@example.test', `/invitation?t=${t}`);
  const side = await nora.hent(`/invitation?t=${t}`);
  const html = await side.text();
  assert.match(html, /Ida har inviteret dig til sin husstand på Clawco som barn/);
  const r = await nora.form('/invitation', { csrf: csrfAf(html), t });
  assert.equal(r.status, 200);
  const med = await r.text();
  assert.match(med, /data-med/);
  assert.match(med, /href="https:\/\/hus-abcdefgh\.example\.test\/"/);
  assert.deepEqual(s.ops, [{ op: 'tilfoej', email: 'nora@example.test', navn: 'Nora', rolle: 'barn' }]);
  const hendes = await (await nora.hent('/konto/husstand')).text();
  assert.match(hendes, /data-rolle>barn</);
  assert.match(hendes, /Forlad husstanden/);
});

test('another account gets "Invitationen er til en anden mailadresse" and spends nothing; a dead link says so', async () => {
  const s = await opsaet();
  await inviter(s);
  const t = linkToken(s.post, 'invitation');
  const fremmed = await s.logInd('fremmed@example.test');
  const r = await fremmed.hent(`/invitation?t=${t}`);
  assert.equal(r.status, 403);
  assert.match(await r.text(), /Invitationen er til en anden mailadresse/);
  const csrf = csrfAf(await (await fremmed.hent('/konto')).text());
  assert.equal((await fremmed.form('/invitation', { csrf, t })).status, 403);
  assert.equal(s.ops.length, 0);
  const doed = await fremmed.hent(`/invitation?t=${'x'.repeat(43)}`);
  assert.equal(doed.status, 404);
  assert.match(await doed.text(), /virker ikke længere/);
});

test('a non-owner gets 403 on every owner action and nothing is sent or changed', async () => {
  const s = await opsaet();
  await inviter(s);
  const nora = await s.logInd('nora@example.test');
  await nora.form('/invitation', { csrf: csrfAf(await (await nora.hent('/konto')).text()), t: linkToken(s.post, 'invitation') });
  const foer = s.post.udbakke.length;
  const fremmed = await s.logInd('fremmed@example.test');
  for (const b of [fremmed, nora]) {
    const csrf = csrfAf(await (await b.hent('/konto')).text());
    assert.equal((await b.form('/konto/husstand/inviter', { csrf, email: 'maja@example.test', navn: 'Maja', rolle: 'medlem', inviterer: 'X' })).status, 403);
    const id = String((await kontoForEmail(s.db, 'nora@example.test'))!.id);
    assert.equal((await b.form(`/konto/husstand/medlemmer/${id}/fjern`, { csrf })).status, 403);
    assert.equal((await b.form(`/konto/husstand/medlemmer/${id}/rolle`, { csrf, rolle: 'gaest' })).status, 403);
  }
  assert.equal(s.post.udbakke.length - foer, 1, 'only the stranger\'s login link');
  assert.equal(s.ops.length, 1, 'only Nora\'s own accept');
  // Without a CSRF token or from another origin: refused before anything.
  assert.equal((await s.ejer.form('/konto/husstand/inviter', { email: 'maja@example.test', navn: 'Maja', rolle: 'medlem', inviterer: 'Ida' })).status, 403);
});

test('over the limit: the page says so in plain Danish instead of the form, and a POST sends nothing (409)', async () => {
  const s = await opsaet();
  s.max.n = 1;
  const side = await (await s.ejer.hent('/konto/husstand')).text();
  assert.match(side, /data-fuld/);
  assert.match(side, /Din plan har plads til én person: dig/);
  assert.doesNotMatch(side, /data-inviter/);
  const r = await s.ejer.form('/konto/husstand/inviter', { csrf: csrfAf(side), email: 'nora@example.test', navn: 'Nora', rolle: 'barn', inviterer: 'Ida' });
  assert.equal(r.status, 409);
  assert.equal(s.post.udbakke.filter((b) => b.skabelon === 'invitation').length, 0);
});

test('remove: the owner\'s click removes her, tells the tenant and drops the gateway cache', async () => {
  const s = await opsaet();
  await inviter(s);
  const nora = await s.logInd('nora@example.test');
  await nora.form('/invitation', { csrf: csrfAf(await (await nora.hent('/konto')).text()), t: linkToken(s.post, 'invitation') });
  const side = await (await s.ejer.hent('/konto/husstand')).text();
  assert.match(side, /data-medlem="nora@example.test"/);
  const id = /action="\/konto\/husstand\/medlemmer\/(\d+)\/fjern"/.exec(side)![1]!;
  const r = await s.ejer.form(`/konto/husstand/medlemmer/${id}/fjern`, { csrf: csrfAf(side) });
  assert.equal(r.status, 303);
  assert.deepEqual(s.ops.at(-1), { op: 'fjern', email: 'nora@example.test' });
  assert.deepEqual(s.glemt, ['hus-abcdefgh', 'hus-abcdefgh']);
  assert.doesNotMatch(await (await s.ejer.hent('/konto/husstand')).text(), /data-medlem=/);
});
