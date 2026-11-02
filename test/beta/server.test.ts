// KC-0203 through the server: the beta exists only under KC_BETA (deps.beta); the cards in Nu, the answers, "Hvad deler
// jeg?", the consent switch, and the pull route Clawco Sky signs (GET /api/beta/maal). Nothing without the switch.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/server.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { skrivHusstand } from '../../src/identitet/husstand.ts';
import { kontoFraMiljoe, type KontoIndstilling } from '../../src/identitet/konto.ts';
import { KONTROL_HEADER } from '../../src/identitet/kontrol.ts';
import { MAAL_FELTER } from '../../src/beta/maal.ts';
import type { BetaTilstand } from '../../src/beta/tilstand.ts';
import { rejsenFaerdig } from '../fixtures/start.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-beta-srv-'));
after(() => rm(rod, { recursive: true, force: true }));
const publicDir = path.relative(process.cwd(), fileURLToPath(new URL('../../public', import.meta.url)));
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const PRISER = (solo: number, husstand: number) => ({ planer: { 'sky-solo': { maanedlig: { dkk: solo } }, 'sky-husstand': { maanedlig: { dkk: husstand } } } });

const V = JSON.parse(await readFile(new URL('../fixtures/kontrol-vektorer.json', import.meta.url), 'utf8')) as { tenant: string; noegle: { froe: string; offentlig: string; id: string } };
const GATEWAY = '10.20.0.2';
const K = kontoFraMiljoe({ KC_IDENTITET: 'konto', KC_KONTO_TENANT: V.tenant, KC_KONTO_PUBKEY: V.noegle.offentlig, KC_KONTO_GATEWAY: GATEWAY }) as KontoIndstilling;
const FRA_GATEWAY = { incoming: { socket: { remoteAddress: GATEWAY } } };
const PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
const TOM_KROP = createHash('sha256').update('').digest('base64url');
/** The test's own signer of the k1 scheme (the tenant shares no code with Sky). Defaults: a GET of /api/beta/maal with an empty body. */
function kontrol(nuMs: number, o: { sti?: string; metode?: string; krop?: string; n?: string; tenant?: string } = {}): string {
  const privat = createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.from(V.noegle.froe, 'hex')]), format: 'der', type: 'pkcs8' });
  const p = { aud: 'clawco-tenant-kontrol', t: o.tenant ?? V.tenant, m: o.metode ?? 'GET', p: o.sti ?? '/api/beta/maal', h: createHash('sha256').update(o.krop ?? '').digest('base64url'), iat: Math.floor(nuMs / 1000), n: o.n ?? Math.random().toString(16).slice(2).padEnd(16, '0').slice(0, 16) };
  const til = `k1.${V.noegle.id}.${Buffer.from(JSON.stringify(p)).toString('base64url')}`;
  return `${til}.${sign(null, Buffer.from(til), privat).toString('base64url')}`;
}

let nr = 0;
async function opsaet(o: { beta?: boolean; startetDageSiden?: number; samtykkeStart?: boolean; solo?: number; husstand?: number; maja?: boolean } = {}) {
  const dir = path.join(rod, `t${++nr}`);
  const dataDir = path.join(dir, 'data');
  const store = createFileStore(dataDir);
  await rejsenFaerdig(store);
  if (o.maja) await skrivHusstand(dataDir, { personer: [{ id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' }, { id: 'maja', login: 'maja@example.com', navn: 'Maja', rolle: 'medlem' }] });
  const priserFil = path.join(dir, 'priser.json');
  await (await import('node:fs/promises')).mkdir(dir, { recursive: true });
  await writeFile(priserFil, JSON.stringify(PRISER(o.solo ?? 7900, o.husstand ?? 12900)));
  const ur = { nu: new Date('2026-11-02T10:00:00Z') };
  const deps = { store, hermes: createFakeAgent({ answer: () => 'ok' }), dataDir, sourceGlob: path.join(dir, 'avis_{date}.json'), mailRunner: async () => ({ code: 0, stdout: '[]', stderr: '' }), mailStateDir: path.join(dir, 'state'), publicDir, now: () => ur.nu };
  const beta = o.beta === false ? {} : { beta: { samtykkeStart: o.samtykkeStart ?? false, priserFil } };
  const app = createApp({ ...deps, ...beta }).app;
  const konto = createApp({ ...deps, ...beta, identitet: { konto: K } }).app;
  if (o.beta !== false && o.startetDageSiden !== undefined) await laesTilstand(); // creates the file at "now"
  async function laesTilstand(): Promise<BetaTilstand> { await app.request('/rum/hjem', { headers: o.maja ? { 'Tailscale-User-Login': 'henrik@example.com' } : {} }, o.maja ? LOOPBACK : undefined); return JSON.parse(await readFile(path.join(dataDir, 'beta.json'), 'utf8')) as BetaTilstand; }
  async function saetStartet(dageSiden: number): Promise<void> {
    const t = await laesTilstand();
    await writeFile(path.join(dataDir, 'beta.json'), JSON.stringify({ ...t, startet: new Date(ur.nu.getTime() - dageSiden * 86_400_000).toISOString() }));
  }
  if (o.beta !== false && o.startetDageSiden !== undefined) await saetStartet(o.startetDageSiden);
  const som = (hvem?: string): Record<string, string> => (hvem ? { 'Tailscale-User-Login': `${hvem}@example.com` } : {});
  const env = o.maja ? LOOPBACK : undefined;
  const nu = async (hvem?: string): Promise<string> => (await app.request('/rum/hjem', { headers: som(hvem) }, env)).text();
  const ja = async (id: string, hvem?: string): Promise<string> => ((await (await app.request('/api/graense/ja', { method: 'POST', headers: { 'content-type': 'application/json', ...som(hvem) }, body: JSON.stringify({ rum: 'hjem', slags: 'beta', id }) }, env)).json()) as { ja: string }).ja;
  const post = (url: string, body: unknown, hvem?: string, ekstra: Record<string, string> = {}) => app.request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...som(hvem), ...ekstra }, body: JSON.stringify(body) }, env);
  /** A real tap: fetch the one-time yes for exactly this answer, then post it. */
  const svar = async (body: Record<string, unknown>, hvem?: string) => post('/api/beta/feedback', { ...body, ja: await ja(`feedback:${String(body['dag'])}`, hvem) }, hvem);
  const fil = async (): Promise<BetaTilstand> => JSON.parse(await readFile(path.join(dataDir, 'beta.json'), 'utf8')) as BetaTilstand;
  const hent = (metode = 'GET', header: string | null = kontrol(ur.nu.getTime()), sti = '/api/beta/maal', krop?: string) => konto.request(sti, { method: metode, headers: header === null ? {} : { [KONTROL_HEADER]: header }, ...(krop !== undefined ? { body: krop } : {}) }, FRA_GATEWAY);
  return { dir, dataDir, app, konto, ur, nu, ja, post, svar, fil, hent, saetStartet, priserFil, laesTilstand, som, env };
}

// ---------- nothing without the switch ----------

test('without KC_BETA there is nothing: no card, no page, no link, no script, no route — and a valid signature opens nothing', async () => {
  const t = await opsaet({ beta: false });
  const h = await t.nu();
  assert.doesNotMatch(h, /data-beta|lukket beta|Hvordan går det|Hvad deler jeg|beta\.js/);
  for (const [metode, url] of [['GET', '/beta/deling'], ['POST', '/api/beta/feedback'], ['POST', '/api/beta/feedback/udsaet'], ['POST', '/api/beta/kort/luk'], ['POST', '/api/beta/samtykke']] as [string, string][]) {
    const r = await t.app.request(url, { method: metode, headers: { 'content-type': 'application/json' }, body: metode === 'POST' ? '{}' : null });
    assert.equal(r.status, 404, `${metode} ${url}`);
  }
  assert.equal((await t.hent()).status, 404, 'GET /api/beta/maal with a valid signature');
  await assert.rejects(() => readFile(path.join(t.dataDir, 'beta.json'), 'utf8'), /ENOENT/, 'no beta.json is ever made');
});

// ---------- the cards in Nu ----------

test('first visit: the plain beta card (data-beta-kort); Forstået removes it for good, and day 3 is not due yet', async () => {
  const t = await opsaet();
  const h = await t.nu();
  assert.match(h, /data-beta-kort/);
  assert.match(h, /Det her er en lukket beta: det kan gå galt, og vi skriver til dig, før noget slutter\./);
  assert.doesNotMatch(h, /data-beta-feedback/);
  assert.match(h, /<script src="\/beta\.js"/);
  const r = await t.post('/api/beta/kort/luk', {});
  assert.equal(r.status, 200);
  assert.doesNotMatch(await t.nu(), /data-beta-kort/);
  assert.ok((await t.fil()).betaKortLukket);
  assert.equal((await t.post('/api/beta/kort/luk', {})).status, 200, 'a second tap changes nothing');
});

test('the Kø panel has "Hvad deler jeg?" (owner only) next to the other links, only under the beta', async () => {
  const t = await opsaet({ maja: true });
  assert.match(await t.nu('henrik'), /data-beta-deling-link[^>]*>Hvad deler jeg\?</);
  assert.doesNotMatch(await t.nu('maja'), /data-beta-deling-link/);
});

test('day 3: the feedback card replaces nothing else; it is not shown while the plain beta card is open, and it shows after', async () => {
  const t = await opsaet({ startetDageSiden: 2 }); // day 3
  const foer = await t.nu();
  assert.match(foer, /data-beta-kort/);
  assert.doesNotMatch(foer, /data-beta-feedback/, 'one card at a time');
  await t.post('/api/beta/kort/luk', {});
  const h = await t.nu();
  assert.match(h, /data-beta-feedback="3"/);
  assert.match(h, /Hvordan går det\? \(dag 3\)/);
  assert.doesNotMatch(h, /data-beta-betale/);
});

test('the answer: validated, stored, logged, and the card is gone from Nu (not greyed); asked twice is refused', async () => {
  const t = await opsaet({ startetDageSiden: 2 });
  await t.post('/api/beta/kort/luk', {});
  const r = await t.svar({ dag: 3, vurdering: 4, tekst: 'Mailen drillede' });
  assert.equal(r.status, 200);
  const s = await t.fil();
  assert.deepEqual(s.feedback.map((f) => [f.dag, f.vurdering, f.tekst, f.betale]), [[3, 4, 'Mailen drillede', null]]);
  assert.ok(s.svaret[3]);
  const h = await t.nu();
  assert.doesNotMatch(h, /data-beta-feedback/);
  assert.match(h, /Feedback dag 3 sendt til Henrik/, 'the Nu log line');
  const igen = await t.svar({ dag: 3, vurdering: 5 });
  assert.equal(igen.status, 409);
  assert.equal((await t.fil()).feedback.length, 1);
});

test('the answer is refused: unknown or not-due day, rating 0 or 6, 501 characters, pay on day 3, no human-tap token, a token for another answer, another site, a member', async () => {
  const t = await opsaet({ startetDageSiden: 2, maja: true });
  await t.post('/api/beta/kort/luk', {}, 'henrik');
  const kald = async (body: Record<string, unknown>, hvem = 'henrik') => (await t.svar(body, hvem)).status;
  assert.equal(await kald({ dag: 4, vurdering: 3 }), 400, 'not a feedback day');
  assert.equal(await kald({ dag: 7, vurdering: 3 }), 409, 'not due');
  assert.equal(await kald({ dag: 3, vurdering: 0 }), 400);
  assert.equal(await kald({ dag: 3, vurdering: 6 }), 400);
  assert.equal(await kald({ dag: 3, vurdering: 3, tekst: 'x'.repeat(501) }), 400);
  assert.equal(await kald({ dag: 3, vurdering: 3, betale: 'ja' }), 400, 'the pay question is day 14 only');
  assert.equal((await t.post('/api/beta/feedback', { dag: 3, vurdering: 3 }, 'henrik')).status, 403, 'no token');
  const andens = await t.ja('feedback:7', 'henrik');
  assert.equal((await t.post('/api/beta/feedback', { dag: 3, vurdering: 3, ja: andens }, 'henrik')).status, 403, 'a token for another answer');
  assert.equal((await t.post('/api/beta/feedback', { dag: 3, vurdering: 3, ja: await t.ja('feedback:3', 'henrik') }, 'henrik', { 'sec-fetch-site': 'cross-site' })).status, 403, 'from another site');
  assert.equal(await kald({ dag: 3, vurdering: 3 }, 'maja'), 403, 'a member');
  assert.deepEqual((await t.fil()).feedback, [], 'nothing was stored by any of these');
});

test('"Ikke nu" hides the card for the rest of the day and it comes back the next day; a member cannot', async () => {
  const t = await opsaet({ startetDageSiden: 2, maja: true });
  await t.post('/api/beta/kort/luk', {}, 'henrik');
  assert.equal((await t.post('/api/beta/feedback/udsaet', { dag: 3 }, 'maja')).status, 403);
  assert.equal((await t.post('/api/beta/feedback/udsaet', { dag: 7 }, 'henrik')).status, 409, 'only the card that is due');
  assert.equal((await t.post('/api/beta/feedback/udsaet', { dag: 3 }, 'henrik')).status, 200);
  assert.doesNotMatch(await t.nu('henrik'), /data-beta-feedback/);
  t.ur.nu = new Date('2026-11-03T08:00:00Z');
  assert.match(await t.nu('henrik'), /data-beta-feedback="3"/);
});

test('day 14 asks the pay question with the prices of the price file; a changed file changes the question; the answer keeps the choice', async () => {
  const t = await opsaet({ startetDageSiden: 13, solo: 7900, husstand: 12900 });
  await t.post('/api/beta/kort/luk', {});
  const h = await t.nu();
  assert.match(h, /data-beta-feedback="14"/);
  assert.match(h, /Ville du betale 79 kr \(Solo\) \/ 129 kr \(Husstand\) om måneden for det her\?/);
  await writeFile(t.priserFil, JSON.stringify(PRISER(6900, 11900)));
  assert.match(await t.nu(), /Ville du betale 69 kr \(Solo\) \/ 119 kr \(Husstand\)/);
  assert.equal((await t.svar({ dag: 14, vurdering: 5, betale: 'maaske' })).status, 200);
  assert.equal((await t.fil()).feedback[0]?.betale, 'maaske');
  assert.equal((await t.svar({ dag: 14, vurdering: 5 })).status, 409);
});

test('after day 21 no card is asked any more', async () => {
  const t = await opsaet({ startetDageSiden: 21 }); // day 22
  await t.post('/api/beta/kort/luk', {});
  assert.doesNotMatch(await t.nu(), /data-beta-feedback/);
});

test('a damaged beta.json never breaks Nu: no card, the page still renders', async () => {
  const t = await opsaet({ startetDageSiden: 2 });
  await writeFile(path.join(t.dataDir, 'beta.json'), '{ ikke json');
  const r = await t.app.request('/rum/hjem');
  assert.equal(r.status, 200);
  assert.doesNotMatch(await r.text(), /data-beta-(kort|feedback)/);
});

// ---------- Hvad deler jeg? and the consent switch ----------

test('Hvad deler jeg?: the plain-word list and the exact JSON of the answer as it stands now; with consent off it also shows what switching on would send', async () => {
  const t = await opsaet({ startetDageSiden: 2 });
  await t.post('/api/beta/kort/luk', {});
  await t.svar({ dag: 3, vurdering: 4, tekst: 'Mailen drillede' });
  const r = await t.app.request('/beta/deling');
  assert.equal(r.status, 200);
  const h = await r.text();
  assert.match(h, /data-beta-deling/);
  assert.match(h, /hvor lang tid der gik til det første nyttige element/);
  assert.match(h, /hvor mange ting der krævede dig per dag/);
  assert.match(h, /dine feedback-svar/);
  const nu = /data-beta-json>([\s\S]*?)<\/pre>/.exec(h);
  assert.ok(nu);
  const tekstSvar = JSON.parse(nu![1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(tekstSvar), ['version', 'samtykke', 'feedback'], 'consent is off: nothing but feedback');
  assert.match(h, /data-beta-json-hvis/);
  assert.match(h, /data-beta-samtykke="ja"/);
  assert.doesNotMatch(h, /data-beta-samtykke="nej"/);
});

test('Hvad deler jeg? is the owner\'s: a member is refused', async () => {
  const t = await opsaet({ maja: true });
  assert.equal((await t.app.request('/beta/deling', { headers: t.som('maja') }, LOOPBACK)).status, 403);
  assert.equal((await t.app.request('/beta/deling', { headers: t.som('henrik') }, LOOPBACK)).status, 200);
});

test('consent: starts from KC_BETA_SAMTYKKE, is switched by the owner with a human tap (not by a member, another site or a missing token), and works at once', async () => {
  const t = await opsaet({ samtykkeStart: true, maja: true });
  await t.laesTilstand();
  assert.equal((await t.fil()).samtykke, true);
  const nej = async (hvem: string, ekstra: Record<string, string> = {}, token = true) => t.post('/api/beta/samtykke', { samtykke: 'nej', ...(token ? { ja: await t.ja('samtykke:nej', hvem) } : {}) }, hvem, ekstra);
  assert.equal((await nej('maja')).status, 403);
  assert.equal((await nej('henrik', { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await nej('henrik', {}, false)).status, 403);
  assert.equal((await t.post('/api/beta/samtykke', { samtykke: 'kanske', ja: await t.ja('samtykke:kanske', 'henrik') }, 'henrik')).status, 400);
  assert.equal((await t.fil()).samtykke, true, 'none of those changed it');
  assert.equal((await nej('henrik')).status, 200);
  assert.equal((await t.fil()).samtykke, false);
  assert.match(await t.nu('henrik'), /Deling af beta-tal slået fra/);
  const pull = await (await t.hent()).json() as Record<string, unknown>;
  assert.equal(pull['samtykke'], false);
  assert.equal((await t.post('/api/beta/samtykke', { samtykke: 'ja', ja: await t.ja('samtykke:ja', 'henrik') }, 'henrik')).status, 200);
  assert.equal(((await (await t.hent()).json()) as Record<string, unknown>)['samtykke'], true, 'the next pull sees it at once');
});

// ---------- the pull route ----------

test('GET /api/beta/maal with consent off: version, samtykke:false and the feedback sent on purpose — nothing else', async () => {
  const t = await opsaet({ startetDageSiden: 2 });
  await t.post('/api/beta/kort/luk', {});
  await t.svar({ dag: 3, vurdering: 4, tekst: 'Mailen drillede' });
  const r = await t.hent();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const j = await r.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(j), ['version', 'samtykke', 'feedback']);
  assert.equal(j['samtykke'], false);
  assert.deepEqual((j['feedback'] as Record<string, unknown>[]).map((f) => Object.keys(f)), [['dag', 'vurdering', 'tekst', 'betale', 'tid']]);
});

test('GET /api/beta/maal with consent on: exactly the closed key set; the first-value time from Start\'s state; finished days of the daily count', async () => {
  const t = await opsaet({ startetDageSiden: 2, samtykkeStart: true });
  // Start's first source: connected 4 min after the beta started, first value 90 s later.
  const start = JSON.parse(await readFile(path.join(t.dataDir, 'rum', 'start', 'state.json'), 'utf8')) as Record<string, unknown>;
  const startet = Date.parse((await t.fil()).startet);
  const laest = new Date(startet + 4 * 60_000 + 90_000).toISOString();
  await writeFile(path.join(t.dataDir, 'rum', 'start', 'state.json'), JSON.stringify({ ...start, kilder: { 'kira-kalender': { foersteVaerdiMs: 90_000, tid: laest, forhaandsvisning: { kildeId: 'kira-kalender', navn: 'Kalender', slags: 'kalender', titel: 'x', linje: 'y', hentet: laest }} } }));
  // Two earlier days of Nu's count (KC-0147's ledger).
  await (await import('node:fs/promises')).mkdir(path.join(t.dataDir, 'tillid'), { recursive: true });
  await writeFile(path.join(t.dataDir, 'tillid', 'dagstal.jsonl'), ['{"dato":"2026-10-31","nye":["a","b","c"],"kraevede":3,"fortryd":0}', '{"dato":"2026-11-01","nye":["d"],"kraevede":1,"fortryd":0}', ''].join('\n'));
  const j = await (await t.hent()).json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(j), [...MAAL_FELTER]);
  assert.equal(j['samtykke'], true);
  assert.deepEqual(j['foersteVaerdi'], { kildeForbundetMs: 240_000, foersteVaerdiMs: 90_000 });
  assert.deepEqual(j['dage'], [{ dag: '2026-10-31', kraever: 3 }, { dag: '2026-11-01', kraever: 1 }]);
});

test('GET /api/beta/maal is a Sky control call: verified for tenant, method GET, path and the empty body — anything else is 401', async () => {
  const t = await opsaet({ startetDageSiden: 2 });
  const nu = t.ur.nu.getTime();
  assert.equal((await t.hent()).status, 200);
  assert.equal((await t.hent()).status, 200, 'a fresh nonce each time');
  const fast = kontrol(nu, { n: 'abcdef0123456789' });
  assert.equal((await t.hent('GET', fast)).status, 200);
  assert.equal((await t.hent('GET', fast)).status, 401, 'a replay of the same header');
  assert.equal((await t.hent('GET', null)).status, 401, 'no Clawco-Kontrol');
  assert.equal((await t.hent('GET', 'k1.rod.rod.rod')).status, 401, 'garbage');
  assert.equal((await t.hent('GET', kontrol(nu, { metode: 'POST' }))).status, 401, 'signed for POST');
  assert.equal((await t.hent('GET', kontrol(nu, { sti: '/intern/husstand/medlem' }))).status, 401, 'signed for another path');
  assert.equal((await t.hent('GET', kontrol(nu, { tenant: 'hus-andetsted' }))).status, 401, 'another tenant');
  assert.equal((await t.hent('GET', kontrol(nu, { krop: '{"x":1}' }))).status, 401, 'signed for another body');
  assert.equal((await t.hent('GET', kontrol(nu - 120_000))).status, 401, 'too old');
  assert.equal((await t.konto.request('/api/beta/maal', { headers: { [KONTROL_HEADER]: kontrol(nu) } }, { incoming: { socket: { remoteAddress: '10.20.0.9' } } })).status, 401, 'not from the gateway');
  assert.notEqual((await t.hent('POST', kontrol(nu, { metode: 'POST' }))).status, 200, 'POST is not the route');
  assert.equal(TOM_KROP, createHash('sha256').update('').digest('base64url'));
});

test('the pull route does not exist on an install without Sky\'s keys (no konto identity), even with the beta on', async () => {
  const t = await opsaet();
  assert.equal((await t.app.request('/api/beta/maal', { headers: { [KONTROL_HEADER]: kontrol(t.ur.nu.getTime()) } }, FRA_GATEWAY)).status, 404);
});
