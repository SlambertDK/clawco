// KC-0170: the screen's language through the app. No profile (Henrik's installation) = Danish, as before. Choosing
// English in Start's step 1 makes every page English from the next request, and the step tells the browser to reload
// so the whole screen (nav, header, chat) changes at once; choosing the same language again does not reload.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { FAMILIE } from '../src/testtilstand/familie.ts';
import type { Person } from '../src/identitet/husstand.ts';

const NOW = new Date('2026-10-31T10:00:00Z');
const EJER: Person = { id: FAMILIE.medlem.id, login: null, navn: FAMILIE.medlem.navn, rolle: 'ejer' };

type Sut = ReturnType<typeof createApp> & { hermes: ReturnType<typeof createFakeAgent> };
async function medApp(fn: (s: Sut) => Promise<void>, ekstra: { standardSprog?: 'da' | 'en' } = {}): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-server-sprog-'));
  try {
    const hermes = createFakeAgent({ answer: () => 'Hej.' });
    const app = createApp({
      store: createFileStore(dir), hermes, sourceGlob: '/nonexistent/{date}.json', dataDir: dir, now: () => NOW,
      mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent', identitet: { fast: EJER }, kilder: [], ...ekstra,
    });
    await fn({ ...app, hermes });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const side = async (s: Sut, url: string): Promise<string> => (await s.app.request(url)).text();
async function gem(s: Sut, sprog: 'da' | 'en') {
  const res = await s.app.request('/api/rum/start/aktion/velkommen-gem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ navn: FAMILIE.medlem.navn, sprog, husstand: 'alene' }) });
  const text = await res.text();
  assert.equal(res.status, 202, text);
  return s.runs.get((JSON.parse(text) as { runId: string }).runId)!.finished;
}

test('no profile: the pages are Danish, exactly as on an installation from before Start', async () => {
  await medApp(async (s) => {
    const h = await side(s, '/rum/start');
    assert.match(h, /<html lang="da">/);
    assert.match(h, /<span>Nu<\/span>/);
    assert.match(h, /Velkommen/);
    assert.match(h, /window\.KC_TEKST=\{[^<]*"fortryd":"Fortryd"/);
    // The picker starts on the language being shown.
    assert.match(h, /<option value="da" selected>Dansk<\/option>/);
  });
});

test('choosing English in step 1: the next page is English throughout, and the browser is told to reload once', async () => {
  await medApp(async (s) => {
    const run = await gem(s, 'en');
    assert.equal(run.status, 'done');
    assert.equal(run.result?.genindlaes, true);
    const h = await side(s, '/rum/start');
    assert.match(h, /<html lang="en">/);
    assert.match(h, /<span>Now<\/span>/);
    assert.match(h, /Ask Hermes/);
    assert.match(h, /id="hermes-status">Ready</);
    assert.match(h, /Your name is Maja · Hermes answers in English/);
    assert.match(h, /window\.KC_TEKST=\{[^<]*"fortryd":"Undo"/);
    assert.doesNotMatch(h, /Spørg Hermes|Kræver dig|Intet i gang/);
    // The language persists: a later save of the same language does not reload, and Danish switches back.
    assert.equal((await gem(s, 'en')).result?.genindlaes, undefined);
    assert.equal((await gem(s, 'da')).result?.genindlaes, true);
    assert.match(await side(s, '/rum/start'), /<html lang="da">/);
  });
});

test('Fortryd of the save that chose English reloads back into Danish', async () => {
  await medApp(async (s) => {
    await gem(s, 'en');
    const linje = (await side(s, '/rum/start')).match(/data-fortryd="([^"]+)"/)?.[1];
    assert.ok(linje, 'the save has a Fortryd');
    const res = await s.app.request(`/api/rum/start/log/${linje}/fortryd`, { method: 'POST' });
    const text = await res.text();
    assert.equal(res.status, 202, text);
    const run = await s.runs.get((JSON.parse(text) as { runId: string }).runId)!.finished;
    assert.equal(run.result?.genindlaes, true);
    assert.match(await side(s, '/rum/start'), /<html lang="da">/);
  });
});

test('a run after choosing English tells Hermes to answer in English (KC-0241: in English instructions, no "even though" caveat)', async () => {
  await medApp(async (s) => {
    await gem(s, 'en');
    await s.runs.start({ kind: 'chat', spec: { input: 'x', instructions: 'Sprog: dansk, kort og konkret.' }, onDone: async () => ({}) }).finished;
    const ins = s.hermes.calls.at(-1)?.instructions ?? '';
    assert.match(ins, /Answer in English/);
    assert.doesNotMatch(ins, /even though/i);
    assert.match(ins, /The user is called /);
  });
});

// Slice 3: what server.ts itself answers follows the language too.
test('API errors the server writes itself are English after choosing English, Danish before', async () => {
  await medApp(async (s) => {
    const daarlig = async (): Promise<Response> => s.app.request('/api/kilder/nyheder-rss/feeds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    const foer = await daarlig();
    assert.equal(foer.status, 400);
    assert.deepEqual(await foer.json(), { error: 'Send {"adresse": "…"} med adressen på én nyhedskilde.' });
    assert.deepEqual(await (await s.app.request('/api/ingenting')).json(), { error: 'Findes ikke' });
    await gem(s, 'en');
    const efter = await daarlig();
    assert.equal(efter.status, 400);
    assert.deepEqual(await efter.json(), { error: 'Send {"adresse": "…"} with the address of one news source.' });
    assert.deepEqual(await (await s.app.request('/api/ingenting')).json(), { error: 'Not found' });
    assert.equal(await (await s.app.request('/api/runs/nej/events')).text(), 'The run does not exist');
  });
});

test('the meeting page that is gone answers in the language too', async () => {
  await medApp(async (s) => {
    const side = (): Promise<Response> => Promise.resolve(s.app.request('/moede/intet/m1'));
    const da = await side();
    assert.equal(da.status, 404);
    assert.match(await da.text(), /<h1>Mødet findes ikke<\/h1>/);
    await gem(s, 'en');
    const en = await side();
    assert.equal(en.status, 404);
    const t = await en.text();
    assert.match(t, /<h1>The meeting does not exist<\/h1>/);
    assert.match(t, /To Dagen/);
  });
});

// Slice 3: a new installation (store/installation.ts says so) is English before step 1; Danish only when chosen.
test('a new installation: no profile renders English; choosing English does not reload, choosing Danish does', async () => {
  await medApp(async (s) => {
    const h = await side(s, '/rum/start');
    assert.match(h, /<html lang="en">/);
    assert.match(h, /<span>Now<\/span>/);
    assert.match(h, /<option value="en" selected>English<\/option>/);
    // Nobody has a name yet: the greeting names no one (Henrik is the reference installation's fallback only).
    assert.match(await side(s, '/rum/hjem'), /<h1>Good afternoon<\/h1>/);
    const en = await gem(s, 'en');
    assert.equal(en.result?.genindlaes, undefined);
    assert.match(await side(s, '/rum/start'), /<html lang="en">/);
  }, { standardSprog: 'en' });
  await medApp(async (s) => {
    const da = await gem(s, 'da');
    assert.equal(da.result?.genindlaes, true);
    assert.match(await side(s, '/rum/start'), /<html lang="da">/);
  }, { standardSprog: 'en' });
});
