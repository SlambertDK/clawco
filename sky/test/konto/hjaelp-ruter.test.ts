// KC-0201: "Få hjælp" in the account app. The link on /konto and the page /konto/hjaelp that shows, before anything is
// sent, exactly the text the mail will carry. The facts come from a seam wired in server.ts (konto/ never imports
// billing or the fleet); the account number comes from the session, never from the request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nyDb, ur } from './hjaelp.ts';
import { kontoRuter, type KontoDeps } from '../../src/konto/ruter.ts';
import { ingenHusstand } from '../../src/konto/slet.ts';
import { falskPost } from '../../src/delt/post.ts';
import { haendelser } from '../../src/delt/haendelser.ts';
import { hjaelpMail } from '../../src/konto/hjaelp.ts';
import type { Hono } from 'hono';

const PUBLIC = 'https://konto.example.test';
const RP = { id: 'konto.example.test', navn: 'Clawco', origin: PUBLIC };
const SENTINEL = 'RUM-INDHOLD-SENTINEL-4410';

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
  form(sti: string, felter: Record<string, string>): Promise<Response> {
    return this.hent(sti, { method: 'POST', body: new URLSearchParams(felter), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  }
}

async function opsaet(over: Partial<KontoDeps> = {}) {
  const db = await nyDb();
  const post = falskPost();
  const u = ur();
  const d: KontoDeps = {
    db, post, udbakke: post.udbakke, rp: RP, publicUrl: PUBLIC, dev: false, husstand: ingenHusstand(),
    afvikler: { async afprovisioner() {} }, haendelser: haendelser(), nu: u.nu, ...over,
  };
  const app = kontoRuter(d);
  const b = new Browser(app);
  await b.form('/log-ind/link', { email: 'a@example.test' });
  const t = new URL(post.udbakke.at(-1)!.data['link']!).searchParams.get('t')!;
  await b.hent(`/log-ind/link?t=${t}`);
  await b.form('/log-ind/link/bekraeft', { t });
  const [{ id }] = await db.query<{ id: number }>("SELECT id FROM konto WHERE email = 'a@example.test'") as [{ id: number }];
  return { b, app, kontoId: Number(id), db };
}

const hjaelpSeam = (): NonNullable<KontoDeps['hjaelp']> => async () => ({
  plan: 'sky-solo', status: 'aktiv', skrivebeskyttet: false, version: '0.1.0', sha: 'abc1234', release: 'def5678', placering: 'lokal',
  // Anything extra a careless seam returns must never get through (the builder reads the allowlist only).
  ...({ rumIndhold: SENTINEL, kildenavn: SENTINEL } as object),
});

const href = (h: string, start: string): string => {
  const m = new RegExp(`href="(${start}[^"]*)"`).exec(h);
  assert.ok(m, `no link starting ${start}`);
  return m[1]!.replace(/&amp;/g, '&');
};

test('/konto offers "Få hjælp": a plain mailto with the account number from the session, the sentence on response time, and the page that shows the text', async () => {
  const { b, kontoId } = await opsaet({ hjaelp: hjaelpSeam() });
  const h = await (await b.hent('/konto')).text();
  const mailto = href(h, 'mailto:');
  assert.ok(mailto.startsWith('mailto:kontakt@clawco.work?subject='));
  const body = new URL(mailto).searchParams.get('body')!;
  assert.match(body, new RegExp(`Konto: ${kontoId}\\r\\n`));
  assert.match(body, /Plan: sky-solo\r\nStatus: aktiv\r\nSkrivebeskyttet: nej\r\n/);
  assert.ok(!h.includes(SENTINEL), 'nothing outside the allowlist reaches the page');
  assert.ok(!body.includes('a@example.test'), 'the email stays out (the mail carries the sender)');
  assert.match(h, /Få hjælp/);
  assert.match(h, /Vi svarer inden for 2 hverdage\./);
  assert.match(h, /href="\/konto\/hjaelp"/);
});

test('/konto has no help section when the seam is not wired (no half-built link)', async () => {
  const { b } = await opsaet();
  const h = await (await b.hent('/konto')).text();
  assert.doesNotMatch(h, /mailto:/);
  assert.equal((await b.hent('/konto/hjaelp')).status, 404);
});

test('/konto/hjaelp shows the very text the mail carries, with the mailto button and the response time', async () => {
  const { b, kontoId } = await opsaet({ hjaelp: hjaelpSeam() });
  const r = await b.hent('/konto/hjaelp');
  assert.equal(r.status, 200);
  const h = await r.text();
  const forventet = hjaelpMail({ kontoId, plan: 'sky-solo', status: 'aktiv', skrivebeskyttet: false, version: '0.1.0', sha: 'abc1234', release: 'def5678', placering: 'lokal' });
  assert.equal(href(h, 'mailto:'), forventet.mailto);
  assert.ok(h.includes(`Konto: ${kontoId}`));
  assert.match(h, /<pre/);
  assert.match(h, /Vi svarer inden for 2 hverdage\./);
  assert.match(h, /aldrig indholdet af din Clawco/);
  assert.ok(!h.includes(SENTINEL));
  assert.doesNotMatch(h, /<script/, 'the link works without JavaScript');
});

test('the account number is the session\'s: a number in the query changes nothing', async () => {
  const { b, kontoId } = await opsaet({ hjaelp: hjaelpSeam() });
  const h = await (await b.hent(`/konto/hjaelp?konto=999&kontoId=999`)).text();
  assert.ok(h.includes(`Konto: ${kontoId}`));
  assert.ok(!h.includes('Konto: 999'));
});

test('the last error code can ride in as ?fejl= and only a code-shaped value is used', async () => {
  const { b } = await opsaet({ hjaelp: hjaelpSeam() });
  const ok = await (await b.hent('/konto/hjaelp?fejl=E_KILDE_401')).text();
  assert.ok(ok.includes('Sidste fejlkode: E_KILDE_401'));
  for (const ond of ['%3Cscript%3Ealert(1)%3C%2Fscript%3E', 'a%20b', 'x'.repeat(60), '%0D%0ABcc%3A%20ond%40example.test']) {
    const h = await (await b.hent(`/konto/hjaelp?fejl=${ond}`)).text();
    assert.ok(!h.includes('Sidste fejlkode'), `kept ${ond}`);
    assert.ok(!h.includes('<script>alert'));
  }
});

test('logged out, /konto/hjaelp goes to the login and comes back to the same page', async () => {
  const { app } = await opsaet({ hjaelp: hjaelpSeam() });
  const ud = await new Browser(app).hent('/konto/hjaelp');
  assert.equal(ud.status, 303);
  assert.equal(ud.headers.get('location'), '/log-ind?til=/konto/hjaelp');
  const side = await (await new Browser(app).hent('/log-ind?til=/konto/hjaelp')).text();
  assert.match(side, /data-til="\/konto\/hjaelp"/);
});

test('the public help page is linked when the wiring gives its address', async () => {
  const { b } = await opsaet({ hjaelp: hjaelpSeam(), hjaelpSide: 'https://hjaelp.example.test/hjaelp' });
  const h = await (await b.hent('/konto/hjaelp')).text();
  assert.match(h, /href="https:\/\/hjaelp\.example\.test\/hjaelp"/);
});
