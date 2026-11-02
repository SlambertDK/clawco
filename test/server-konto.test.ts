// KC-0179 end to end: KC_IDENTITET=konto through the real routes of createApp.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { getRequestListener } from '@hono/node-server';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { skrivHusstand } from '../src/identitet/husstand.ts';
import { kontoFraMiljoe, type KontoIndstilling } from '../src/identitet/konto.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-srv-konto-'));
after(() => rm(rod, { recursive: true, force: true }));
const publicDir = path.relative(process.cwd(), fileURLToPath(new URL('../public', import.meta.url)));

const V = JSON.parse(await readFile(new URL('./fixtures/konto-vektorer.json', import.meta.url), 'utf8')) as {
  tenant: string; nu: number; noegler: Record<string, { offentlig: string }>; vektorer: { navn: string; header: string }[];
};
const header = (navn: string): string => V.vektorer.find((v) => v.navn === navn)!.header;
const GATEWAY = '10.20.0.2';
const konto = kontoFraMiljoe({ KC_IDENTITET: 'konto', KC_KONTO_TENANT: V.tenant, KC_KONTO_PUBKEY: V.noegler['a']!.offentlig, KC_KONTO_GATEWAY: GATEWAY }) as KontoIndstilling;
const FRA_GATEWAY = { incoming: { socket: { remoteAddress: GATEWAY } } };
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const TO = { personer: [
  { id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' as const },
  { id: 'maja', login: 'maja@example.com', navn: 'Maja', rolle: 'medlem' as const },
] };

const noMail = { mailRunner: async () => ({ code: 1, stdout: '', stderr: 'ingen' }), mailStateDir: '/nonexistent' };
async function lav(navn: string, husstand = true) {
  const dataDir = path.join(rod, navn);
  if (husstand) await skrivHusstand(dataDir, TO);
  return createApp({ store: createFileStore(dataDir), hermes: createFakeAgent({ answer: () => 'ok' }), sourceGlob: '/nonexistent/{date}.json', dataDir, sha: 'abc', publicDir, now: () => new Date(V.nu * 1000), identitet: { konto }, ...noMail });
}
const som = (navn: string, ekstra: Record<string, string> = {}): RequestInit => ({ headers: { 'Clawco-Konto': header(navn), ...ekstra } });

test('a signed header from the gateway is the household member: 200 with that person', async () => {
  const { app } = await lav('ok');
  const res = await app.request('/rum/hjem', som('gyldig'), FRA_GATEWAY);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<body[^>]* data-person="maja"/);
  const ejer = await app.request('/rum/hjem', som('ejer'), FRA_GATEWAY);
  assert.match(await ejer.text(), /<body[^>]* data-rolle="ejer"/);
  assert.equal((await app.request('/api/koe', som('gyldig'), FRA_GATEWAY)).status, 200);
});

test('a forged header is 401 with no data — on /api/…, on a room and on a static file', async () => {
  const { app } = await lav('forfalsket');
  const api = await app.request('/api/koe', som('forfalsket'), FRA_GATEWAY);
  assert.equal(api.status, 401);
  assert.deepEqual(Object.keys((await api.json()) as object), ['error']);
  const side = await app.request('/rum/hjem', som('forfalsket'), FRA_GATEWAY);
  assert.equal(side.status, 401);
  const html = await side.text();
  assert.match(html, /Clawco ved ikke, hvem du er/);
  assert.doesNotMatch(html, /data-person=|Maja|Henrik/);
  const css = await app.request('/app.css', som('forfalsket'), FRA_GATEWAY);
  assert.equal(css.status, 401);
  const afvist = await css.text();
  assert.match(afvist, /data-adgang="afvist"/, 'the refusal page, not the file');
  const ok = await app.request('/app.css', som('gyldig'), FRA_GATEWAY);
  assert.equal(ok.status, 200, 'the same file with a valid signature');
  assert.ok(!afvist.includes((await ok.text()).slice(0, 200)));
});

test('expired, other tenant, tampered, unknown key, no header: 401 — the same body for every reason', async () => {
  const { app } = await lav('afvist');
  const bodies = new Set<string>();
  for (const navn of ['udloebet', 'fra-fremtiden', 'anden-tenant', 'manipuleret-efter-signering', 'fremmed-noegle', 'forkert-noegle-id']) {
    const res = await app.request('/api/koe', som(navn), FRA_GATEWAY);
    assert.equal(res.status, 401, navn);
    bodies.add(await res.text());
  }
  const uden = await app.request('/api/koe', {}, FRA_GATEWAY);
  assert.equal(uden.status, 401);
  bodies.add(await uden.text());
  assert.equal(bodies.size, 1);
});

test('a valid signature from another peer than the gateway is 401', async () => {
  const { app } = await lav('peer');
  assert.equal((await app.request('/rum/hjem', som('gyldig'), LOOPBACK)).status, 401);
  assert.equal((await app.request('/rum/hjem', som('gyldig'))).status, 401, 'no peer at all');
});

test('a stranger with a valid signature is 403 "Du er ikke inviteret endnu"', async () => {
  const { app } = await lav('fremmed');
  const res = await app.request('/rum/hjem', som('ikke-i-husstanden'), FRA_GATEWAY);
  assert.equal(res.status, 403);
  assert.match(await res.text(), /Du er ikke inviteret endnu/);
});

test('without husstand.json: 503, never the implicit owner', async () => {
  const { app } = await lav('uden-husstand', false);
  const res = await app.request('/rum/hjem', som('gyldig'), FRA_GATEWAY);
  assert.equal(res.status, 503);
  assert.doesNotMatch(await res.text(), /data-person=/);
});

test('Tailscale headers are ignored in konto mode, even from loopback', async () => {
  const { app } = await lav('tailscale');
  const ts = { headers: { 'Tailscale-User-Login': 'henrik@example.com', 'Tailscale-User-Name': 'Henrik' } };
  assert.equal((await app.request('/rum/hjem', ts, LOOPBACK)).status, 401);
  assert.equal((await app.request('/rum/hjem', ts, FRA_GATEWAY)).status, 401);
  const begge = await app.request('/rum/hjem', som('gyldig', { 'Tailscale-User-Login': 'henrik@example.com' }), FRA_GATEWAY);
  assert.match(await begge.text(), /<body[^>]* data-person="maja"/, 'the signature wins; the Tailscale login is not read');
});

test('/health stays open in konto mode', async () => {
  const { app } = await lav('health');
  assert.equal((await app.request('/health')).status, 200);
});

test('KC-0206: Sky runs Hent alt and Slet alt as the owner over real HTTP with the signed header; anyone else is refused', async () => {
  // Sky reaches these KC-0146 routes from the gateway's own address with the gateway's signature — the same check as
  // every forwarded request. Real sockets and Node's fetch, as Sky sends them (no Sec-Fetch-Site from a server).
  const dataDir = path.join(rod, 'sky-kald');
  await skrivHusstand(dataDir, TO);
  await mkdir(path.join(dataDir, 'rum', 'dagen'), { recursive: true });
  await writeFile(path.join(dataDir, 'rum', 'dagen', 'chat.jsonl'), '{"tekst":"min dag"}\n');
  const lokal = kontoFraMiljoe({ KC_IDENTITET: 'konto', KC_KONTO_TENANT: V.tenant, KC_KONTO_PUBKEY: V.noegler['a']!.offentlig, KC_KONTO_GATEWAY: '127.0.0.1' }) as KontoIndstilling;
  const { app } = createApp({ store: createFileStore(dataDir), hermes: createFakeAgent({ answer: () => 'ok' }), sourceGlob: '/nonexistent/{date}.json', dataDir, sha: 'abc', publicDir, now: () => new Date(V.nu * 1000), identitet: { konto: lokal }, ...noMail });
  const srv = http.createServer(getRequestListener(app.fetch));
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const url = (sti: string) => `http://127.0.0.1:${(srv.address() as AddressInfo).port}${sti}`;
  try {
    for (const [navn, status] of [['forfalsket', 401], ['fremmed-noegle', 401], ['gyldig', 403]] as const) {
      assert.equal((await fetch(url('/api/tillid/eksport'), som(navn))).status, status, navn);
      const slet = await fetch(url('/api/tillid/slet-alt'), { method: 'POST', headers: { 'Clawco-Konto': header(navn), 'content-type': 'application/json' }, body: '{"bekraeft":"SLET"}' });
      assert.equal(slet.status, status, `slet-alt ${navn}`);
    }
    assert.equal((await fetch(url('/api/tillid/eksport'))).status, 401, 'unsigned');
    const zip = await fetch(url('/api/tillid/eksport'), som('ejer'));
    assert.equal(zip.status, 200);
    assert.equal(zip.headers.get('content-type'), 'application/zip');
    assert.ok(Buffer.from(await zip.arrayBuffer()).includes(Buffer.from('min dag')));
    assert.ok(await stat(path.join(dataDir, 'rum', 'dagen', 'chat.jsonl')), 'nothing deleted by the refused calls');
    const slet = await fetch(url('/api/tillid/slet-alt'), { method: 'POST', headers: { 'Clawco-Konto': header('ejer'), 'content-type': 'application/json' }, body: '{"bekraeft":"SLET"}' });
    assert.equal(slet.status, 200);
    assert.deepEqual(await slet.json(), { slettet: true });
    await assert.rejects(stat(path.join(dataDir, 'rum', 'dagen', 'chat.jsonl')));
  } finally {
    await new Promise<void>((r) => { srv.close(() => r()); srv.closeAllConnections(); });
  }
});
