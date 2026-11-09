// KC-0160: laptop mode — one person, this machine only, no Tailscale needed. Settings: KC_LAPTOP=ja (the installer's
// --laptop). Invariants: in laptop mode every route works as the owner and the Tailscale identity header is ignored
// entirely (a spoofed one changes nothing); in household mode the header maps to a person as KC-0105 decides (here: no
// header with two people = 401); the process binds loopback only (a LAN address with KC_LAPTOP=ja refuses to start);
// Start leaves the household question out; the installer plans a loopback-only service and no Tailscale step.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { skrivHusstand } from '../src/identitet/husstand.ts';
import { laptopFraMiljoe } from '../src/identitet/laptop.ts';
import type { TsKoerer } from '../src/shell/tailscale.ts';
import { falskeKilder, type FalskData } from '../src/kilder/falsk/falsk.ts';
import { forbiTil } from './helpers/start-forbi.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-laptop-'));
after(() => rm(rod, { recursive: true, force: true }));
const ROD = fileURLToPath(new URL('..', import.meta.url));
const publicDir = path.relative(process.cwd(), path.join(ROD, 'public'));

const noMail = { mailRunner: async () => ({ code: 1, stdout: '', stderr: 'ingen' }), mailStateDir: '/nonexistent' };
let nr = 0;
const DATA: FalskData = {
  kalender: () => ({ generated: '2026-10-31T10:00:00Z', days: [], errors: [] }),
  mail: () => [],
  nyheder: () => ({ nyheder: [], status: { antal: 0, medNyheder: 0, nyheder: 0, fejlede: [] } }),
  noter: () => ({ personer: [], noter: [] }),
  beskeder: () => [],
};
function lav(o: { laptop?: boolean; tailscale?: TsKoerer; kilder?: boolean } = {}) {
  const dataDir = path.join(rod, `d${++nr}`);
  const sut = createApp({
    store: createFileStore(dataDir), hermes: createFakeAgent({ answer: () => 'ok' }), sourceGlob: '/nonexistent/{date}.json', dataDir, sha: 'abc', publicDir, ...noMail,
    ...(o.laptop ? { laptop: true } : {}),
    ...(o.kilder ? { kilder: falskeKilder({ data: DATA, forsinkelseMs: 0 }) } : {}),
    ...(o.tailscale ? { tailscale: { koerer: o.tailscale, port: 8750 } } : {}),
  });
  return { dataDir, sut };
}
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const TO = { personer: [
  { id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' as const },
  { id: 'maja', login: 'maja@example.com', navn: 'Maja', rolle: 'medlem' as const },
] };
const body = (h: string): string => /<main[\s\S]*<\/main>/.exec(h)?.[0] ?? h;
const tekstAf = (h: string): string => h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');

test('laptop mode, no header: Nu loads as the owner', async () => {
  const { sut } = lav({ laptop: true });
  const res = await sut.app.request('/rum/hjem', {}, LOOPBACK);
  assert.equal(res.status, 200);
  const h = await res.text();
  assert.match(h, /<body[^>]* data-person="ejer"/);
  assert.match(h, /<body[^>]* data-rolle="ejer"/);
});

test('household mode, no header, two people: refused with 401 (KC-0105: nobody can be told apart)', async () => {
  const { sut, dataDir } = lav();
  await skrivHusstand(dataDir, TO);
  const res = await sut.app.request('/rum/hjem', {}, LOOPBACK);
  assert.equal(res.status, 401);
});

test('laptop mode ignores the identity header entirely, even with a household file present', async () => {
  const { sut, dataDir } = lav({ laptop: true });
  await skrivHusstand(dataDir, TO);
  for (const login of ['maja@example.com', 'stranger@example.org', '']) {
    const res = await sut.app.request('/rum/hjem', { headers: { 'Tailscale-User-Login': login, 'Tailscale-User-Name': 'X' } }, LOOPBACK);
    assert.equal(res.status, 200, `header "${login}"`);
    const h = await res.text();
    assert.match(h, /<body[^>]* data-person="ejer"/, `header "${login}" is not who is looking`);
  }
  const fjern = await sut.app.request('/rum/hjem', { headers: { 'Tailscale-User-Login': 'maja@example.com' } }, { incoming: { socket: { remoteAddress: '100.64.0.9' } } });
  assert.match(await fjern.text(), /data-person="ejer"/, 'a non-loopback peer cannot pick a person either');
});

test('laptop mode is never public: a Funnel request is refused', async () => {
  const { sut } = lav({ laptop: true });
  const res = await sut.app.request('/rum/hjem', { headers: { 'Tailscale-Funnel-Request': '?1' } }, LOOPBACK);
  assert.equal(res.status, 403);
});

test('KC_LAPTOP: off unless ja; binds loopback only; refuses a LAN address, Sky, and says which key to fix', () => {
  assert.equal(laptopFraMiljoe({}), false);
  assert.equal(laptopFraMiljoe({ KC_LAPTOP: '' }), false);
  assert.equal(laptopFraMiljoe({ KC_LAPTOP: 'nej' }), false);
  assert.equal(laptopFraMiljoe({ KC_LAPTOP: 'ja' }), true);
  assert.equal(laptopFraMiljoe({ KC_LAPTOP: 'ja', KC_HOST: '127.0.0.1' }), true);
  assert.equal(laptopFraMiljoe({ KC_LAPTOP: 'ja', KC_HOST: 'localhost' }), true);
  assert.equal(laptopFraMiljoe({ KC_LAPTOP: 'ja', KC_HOST: '::1' }), true);
  for (const host of ['0.0.0.0', '192.168.1.20', '::', '100.64.0.9', 'laptop.local']) assert.throws(() => laptopFraMiljoe({ KC_LAPTOP: 'ja', KC_HOST: host }), /KC_HOST/, host);
  assert.throws(() => laptopFraMiljoe({ KC_LAPTOP: 'ja', KC_IDENTITET: 'konto' }), /KC_IDENTITET/);
  assert.equal(laptopFraMiljoe({ KC_HOST: '0.0.0.0' }), false, 'a household install may bind as before');
});

test('Start in laptop mode asks no household question and shows no household wording; household mode still does', async () => {
  const baerbar = await lav({ laptop: true }).sut.app.request('/rum/start', {}, LOOPBACK);
  const h = await baerbar.text();
  assert.equal(baerbar.status, 200);
  assert.doesNotMatch(tekstAf(body(h)), /husstand/i, 'no household wording on screen');
  assert.doesNotMatch(h, /<select name="husstand"/);
  assert.match(h, /<input type="hidden" name="husstand" value="alene">/, 'the profile still gets its answer: alone');
  const husstand = await lav().sut.app.request('/rum/start', {}, LOOPBACK);
  const k = await husstand.text();
  assert.match(k, /<select name="husstand"/);
  assert.match(tekstAf(body(k)), /husstand/i);
});

test('Start in laptop mode: the profile saves as alone and the step is Klaret without a household sentence', async () => {
  const { sut } = lav({ laptop: true });
  const r = await sut.app.request('/api/rum/start/aktion/velkommen-gem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ navn: 'Alma', sprog: 'da', husstand: 'alene' }) }, LOOPBACK);
  assert.equal(r.status, 202, await r.clone().text());
  await sut.runs.get(((await r.json()) as { runId: string }).runId)!.finished;
  const h = await (await sut.app.request('/rum/start', {}, LOOPBACK)).text();
  assert.match(tekstAf(body(h)), /Du hedder Alma/);
  assert.doesNotMatch(tekstAf(body(h)), /husstand|alene/i);
});

test('a source card in laptop mode offers no household zone; household mode does', async () => {
  // KC-0247: steps 1–2 done, so step 3 (the connect cards) is the open step.
  const b = lav({ laptop: true, kilder: true });
  await forbiTil(b.dataDir, 'model');
  const baerbar = await (await b.sut.app.request('/rum/start', {}, LOOPBACK)).text();
  assert.match(baerbar, /<select name="zone">/, 'the connect card is there');
  assert.doesNotMatch(baerbar, /<option value="husstand"/);
  assert.match(baerbar, /<option value="privat"/);
  const h = lav({ kilder: true });
  await forbiTil(h.dataDir, 'model');
  const husstand = await (await h.sut.app.request('/rum/start', {}, LOOPBACK)).text();
  assert.match(husstand, /<option value="husstand"/);
});

test('the Tailscale card in laptop mode without Tailscale says the phone limit; the card in household mode does not', async () => {
  const ingen: TsKoerer = async () => ({ fundet: false });
  // KC-0247: the phone card waits until the first source works.
  const b = lav({ laptop: true, tailscale: ingen, kilder: true });
  await forbiTil(b.dataDir, 'foerste-kilde');
  const baerbar = await (await b.sut.app.request('/rum/start', {}, LOOPBACK)).text();
  assert.match(baerbar, /data-tailscale="laptop"/);
  assert.match(tekstAf(baerbar), /Uden Tailscale kan telefonen ikke nå Clawco; med Tailscale kan den, men kun når den bærbare er vågen/);
  const h = lav({ tailscale: ingen, kilder: true });
  await forbiTil(h.dataDir, 'foerste-kilde');
  const husstand = await (await h.sut.app.request('/rum/start', {}, LOOPBACK)).text();
  assert.match(husstand, /data-tailscale="mangler"/);
});

test('install --laptop --dry-run plans a loopback bind and no Tailscale step', () => {
  const home = path.join(rod, 'hjem-dry');
  const r = spawnSync('bash', [path.join(ROD, 'deploy', 'install.sh'), '--laptop', '--dry-run', '--yes', '--port', '8774'], {
    encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', HOME: home, CLAWCO_REPO: 'https://example.invalid/clawco.git' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /127\.0\.0\.1/);
  assert.match(r.stdout, /Bærbar-tilstand/);
  assert.doesNotMatch(r.stdout, /tailscale/i);
});

test('the launchd agent the installer writes for a laptop restarts Clawco and starts it at login', () => {
  const skabelon = path.join(ROD, 'deploy', 'work.clawco.plist.template');
  const r = spawnSync('bash', ['-c', 'CLAWCO_FUNKTIONER=1 . "$0"; LABEL=work.clawco; APP=/x/app; NODE=/usr/bin/node; ENV_FIL=/x/.env; LOGMAPPE=/x/log; render "$1" xml', path.join(ROD, 'deploy', 'install.sh'), skabelon], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(r.stdout, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(r.stdout, /--env-file=\/x\/\.env/);
  assert.doesNotMatch(r.stdout, /@[A-Z]+@/, 'every placeholder is filled');
  assert.ok(readFileSync(skabelon, 'utf8').includes('KeepAlive'));
});
