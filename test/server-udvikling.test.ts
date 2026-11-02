import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import type { Runner } from '../src/rooms/mail/source.ts';
import type { Kort, KuratorState } from '../src/rooms/hjem/kort.ts';
import { laesOpgaver } from '../src/udvikling/lager.ts';
import { rejsenFaerdig } from './fixtures/start.ts';

const NOW = new Date('2026-10-29T10:00:00Z');
const ingenMail: Runner = async () => ({ code: 0, stdout: '[]', stderr: '' });
const KORT: Kort = { id: 'tjeneste:sentry-1', type: 'tjeneste', titel: 'Sentry: TypeError i ShelfAtlas', betyder: 'En fejl rammer forsiden.', grundlag: ['TypeError: x is undefined', '12 brugere'], kilder: ['https://sentry.io/issues/1'], anbefaling: 'Ret den.', prioritet: 2 };

async function opsaet() {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-udvikling-'));
  const store = createFileStore(path.join(dir, 'data'));
  await rejsenFaerdig(store);
  const sut = createApp({ store, hermes: createFakeAgent({ answer: () => 'ok' }), sourceGlob: path.join(dir, 'avis_{date}.json'), mailRunner: ingenMail, mailStateDir: path.join(dir, 'state'), now: () => NOW });
  const kurator: KuratorState = { kort: [KORT], intet: [], afvist: [], sete: [] };
  await store.writeState('hjem', kurator);
  const post = async (url: string, body?: unknown): Promise<Response> => sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? null : JSON.stringify(body) });
  const get = async (url: string): Promise<Response> => sut.app.request(url);
  return { store, sut, post, get, ryd: () => rm(dir, { recursive: true, force: true }) };
}

test('GET /api/udvikling/projekter lists the projects', async () => {
  const t = await opsaet();
  try {
    const j = await (await t.get('/api/udvikling/projekter')).json() as { projekter: { id: string; navn: string; repo: string }[] };
    assert.deepEqual(j.projekter.map((p) => p.navn), ['Kontrolcenter', 'ShelfAtlas']);
  } finally { await t.ryd(); }
});

test('sending from a card copies the card from the stored state as grundlag and logs it in Hjem', async () => {
  const t = await opsaet();
  try {
    const res = await t.post('/api/udvikling/opgaver', { projekt: 'shelfatlas', saetning: 'Ret fejlen på forsiden', kortId: KORT.id });
    assert.equal(res.status, 201);
    const { opgave } = await res.json() as { opgave: { id: string; status: string; kilde: string; grundlag: unknown } };
    assert.equal(opgave.status, 'sendt');
    assert.equal(opgave.kilde, 'kort');
    assert.deepEqual(opgave.grundlag, { titel: KORT.titel, linjer: [KORT.betyder, ...KORT.grundlag], kilder: KORT.kilder });
    assert.equal((await laesOpgaver(t.store)).length, 1);
    assert.match((await t.store.readLog('hjem'))[0]?.tekst ?? '', /^Sendte til Claude Code \(ShelfAtlas\): Ret fejlen på forsiden$/);
  } finally { await t.ryd(); }
});

test('sending from the chat takes the element as grundlag; bad input is refused', async () => {
  const t = await opsaet();
  try {
    const res = await t.post('/api/udvikling/opgaver', { projekt: 'kontrolcenter', saetning: 'Gør knappen større', kontekst: 'Kortet: Vercel' });
    assert.equal(res.status, 201);
    const { opgave } = await res.json() as { opgave: { kilde: string; grundlag: unknown } };
    assert.equal(opgave.kilde, 'chat');
    assert.deepEqual(opgave.grundlag, { titel: 'Kortet: Vercel', linjer: [], kilder: [] });
    const uden = await (await t.post('/api/udvikling/opgaver', { projekt: 'kontrolcenter', saetning: 'Uden noget' })).json() as { opgave: { grundlag: unknown } };
    assert.equal(uden.opgave.grundlag, null);
    assert.equal((await t.post('/api/udvikling/opgaver', { projekt: 'nope', saetning: 'x' })).status, 400);
    assert.equal((await t.post('/api/udvikling/opgaver', { projekt: 'kontrolcenter', saetning: '' })).status, 400);
    assert.equal((await t.post('/api/udvikling/opgaver', { projekt: 'kontrolcenter', saetning: 7 })).status, 400);
    assert.equal((await t.post('/api/udvikling/opgaver', { projekt: 'kontrolcenter', saetning: 'x', kortId: 'findes:ikke' })).status, 404);
  } finally { await t.ryd(); }
});

test('the Mac fetches by repo, claims once, and reports status back', async () => {
  const t = await opsaet();
  try {
    const a = (await (await t.post('/api/udvikling/opgaver', { projekt: 'kontrolcenter', saetning: 'Første' })).json() as { opgave: { id: string } }).opgave;
    await t.post('/api/udvikling/opgaver', { projekt: 'shelfatlas', saetning: 'Anden' });
    const liste = await (await t.get('/api/udvikling/opgaver?repo=slambertdk/kontrolcenter')).json() as { projekt: string; opgaver: { id: string }[] };
    assert.equal(liste.projekt, 'kontrolcenter');
    assert.deepEqual(liste.opgaver.map((o) => o.id), [a.id], 'only this repo');
    assert.equal((await t.get('/api/udvikling/opgaver?repo=SlambertDK/andet')).status, 404);
    assert.equal((await t.get('/api/udvikling/opgaver')).status, 400);

    const url = `/api/udvikling/opgaver/${a.id}/status`;
    assert.equal((await t.post(url, { status: 'modtaget' })).status, 200);
    assert.equal((await t.post(url, { status: 'modtaget' })).status, 409, 'a second claim loses');
    assert.equal((await t.post(url, { status: 'sendt' })).status, 200, 'release before a ticket');
    assert.equal((await t.post(url, { status: 'modtaget' })).status, 200);
    assert.equal((await t.post(url, { status: 'modtaget', ticket: 'KC-0049' })).status, 200);
    assert.equal((await t.post(url, { status: 'sendt' })).status, 409, 'a ticket was made: no release');
    const f = await t.post(url, { status: 'faerdig', bevis: '172 tests grønne, set live', pr: 'https://github.com/SlambertDK/kontrolcenter/pull/20' });
    assert.equal(f.status, 200);
    assert.equal((await t.post(url, { status: 'i-gang' })).status, 409, 'faerdig is final');
    assert.equal((await t.post('/api/udvikling/opgaver/o-findesikke/status', { status: 'modtaget' })).status, 404);
    assert.equal((await t.post(url, { status: 'nope' })).status, 400);

    const gemt = (await laesOpgaver(t.store)).find((o) => o.id === a.id);
    assert.equal(gemt?.status, 'faerdig');
    assert.equal(gemt?.ticket, 'KC-0049');
    const log = (await t.store.readLog('hjem')).map((e) => e.tekst);
    assert.ok(log.includes('Claude Code: KC-0049 er færdig — Første'), log.join(' | '));
  } finally { await t.ryd(); }
});

test('Hjem shows "Hos Claude Code" with status, project, ticket and evidence', async () => {
  const t = await opsaet();
  try {
    const before = await (await t.get('/api/rum/hjem/fragment')).json() as { html: string };
    assert.doesNotMatch(before.html, /Hos Claude Code/, 'hidden while empty');
    const a = (await (await t.post('/api/udvikling/opgaver', { projekt: 'shelfatlas', saetning: 'Ret fejlen', kortId: KORT.id })).json() as { opgave: { id: string } }).opgave;
    await t.post(`/api/udvikling/opgaver/${a.id}/status`, { status: 'modtaget', ticket: 'SA-0400' });
    await t.post(`/api/udvikling/opgaver/${a.id}/status`, { status: 'faerdig', bevis: '412 tests grønne', pr: 'https://github.com/SlambertDK/ShelfAtlas/pull/77' });
    const { html } = await (await t.get('/api/rum/hjem/fragment')).json() as { html: string };
    assert.match(html, /Claude Code færdig/);
    assert.match(html, /Færdig/);
    assert.match(html, /ShelfAtlas/);
    assert.match(html, /SA-0400/);
    assert.match(html, /412 tests grønne/);
    assert.match(html, /href="https:\/\/github\.com\/SlambertDK\/ShelfAtlas\/pull\/77"/);
    assert.doesNotMatch(html, /data-cc-kort="tjeneste:sentry-1"/, "KC-0046: only a card Kuratoren marks offers Send til Claude Code");
  } finally { await t.ryd(); }
});

test('KC-0048: "Hos Claude Code" shows the trust numbers per project, and a rollback is counted apart from what landed', async () => {
  const t = await opsaet();
  try {
    const send = async (saetning: string, ticket: string): Promise<string> => {
      const a = (await (await t.post('/api/udvikling/opgaver', { projekt: 'kontrolcenter', saetning })).json() as { opgave: { id: string } }).opgave;
      await t.post(`/api/udvikling/opgaver/${a.id}/status`, { status: 'modtaget', ticket });
      await t.post(`/api/udvikling/opgaver/${a.id}/status`, { status: 'faerdig', bevis: 'Live.' });
      return a.id;
    };
    await send('Ret knappen', 'KC-0070');
    const b = await send('Ret teksten', 'KC-0071');
    assert.equal((await t.post(`/api/udvikling/opgaver/${b}/status`, { status: 'faerdig', tilbagerullet: '2026-10-29' })).status, 200);
    const { html } = await (await t.get('/api/rum/hjem/fragment')).json() as { html: string };
    assert.match(html, /data-cc-tal="kontrolcenter"[^>]*>Kontrolcenter: 1 færdig · 1 rullet tilbage · typisk 0 min · 0 parkeret</);
  } finally { await t.ryd(); }
});

test('KC-0045: a parked question shows as a card in Hjem and counts on Hjem; Henrik answers once and the answer waits for the Mac', async () => {
  const t = await opsaet();
  try {
    const a = (await (await t.post('/api/udvikling/opgaver', { projekt: 'kontrolcenter', saetning: 'Gør knappen tydeligere' })).json() as { opgave: { id: string } }).opgave;
    const url = `/api/udvikling/opgaver/${a.id}/status`;
    await t.post(url, { status: 'modtaget', ticket: 'KC-0060' });
    assert.equal((await t.post(`/api/udvikling/opgaver/${a.id}/svar`, { svar: 'Grøn' })).status, 409, 'nothing asked yet');
    const p = await t.post(url, { status: 'parkeret', grund: 'Mangler et valg', spoergsmaal: { tekst: 'Grøn eller blå knap?', valg: ['Grøn', 'Blå'] } });
    assert.equal(p.status, 200);

    const side = await (await t.get('/rum/hjem')).text();
    assert.match(side, /<h3 class="eyebrow">Claude Code spørger/);
    assert.match(side, /Grøn eller blå knap\?/);
    assert.match(side, /data-cc-svar="o-[a-z0-9]+" data-svar="Grøn"[^>]*>Grøn<\/button>/);
    assert.match(side, /data-cc-svar="o-[a-z0-9]+" data-svar="Blå"/);
    assert.match(side, /class="row-note cc-anbefalet">← anbefalet/);
    // KC-0093: Hjem's number is all that waits — the question and the open card — as the page says.
    assert.match(side, /href="\/rum\/hjem"[^>]*><span>Nu<\/span><span class="count">2<\/span>/, 'a decision waits in Hjem');
    assert.match(side, /<span class="tilstand-kraever">2 venter på dig<\/span>/);
    const log0 = (await t.store.readLog('hjem')).map((e) => e.tekst);
    assert.ok(log0.includes('Claude Code spørger (KC-0060): Grøn eller blå knap?'), log0.join(' | '));

    assert.equal((await t.post(`/api/udvikling/opgaver/${a.id}/svar`, { svar: '  ' })).status, 400);
    assert.equal((await t.post('/api/udvikling/opgaver/o-findesikke/svar', { svar: 'Grøn' })).status, 404);
    const s = await t.post(`/api/udvikling/opgaver/${a.id}/svar`, { svar: 'Grøn' });
    assert.equal(s.status, 200);
    assert.equal((await t.post(`/api/udvikling/opgaver/${a.id}/svar`, { svar: 'Blå' })).status, 409, 'answered once');

    const efter = await (await t.get('/rum/hjem')).text();
    assert.doesNotMatch(efter, /<h3 class="eyebrow">Claude Code spørger/);
    assert.match(efter, /Dit svar: Grøn/);
    // The answered question no longer waits; the open card still does (KC-0093: Hjem's number = its page's).
    assert.match(efter, /href="\/rum\/hjem"[^>]*><span>Nu<\/span><span class="count">1<\/span>/);
    assert.match(efter, /<span class="tilstand-kraever">1 venter på dig<\/span>/);
    const liste = await (await t.get('/api/udvikling/opgaver?repo=SlambertDK/kontrolcenter')).json() as { opgaver: { svar?: { tekst: string } }[] };
    assert.equal(liste.opgaver[0]?.svar?.tekst, 'Grøn', 'the Mac reads the answer');
    const log = (await t.store.readLog('hjem')).map((e) => e.tekst);
    assert.ok(log.includes('Svarede Claude Code (KC-0060): Grøn'), log.join(' | '));

    assert.equal((await t.post(url, { status: 'modtaget', ticket: 'KC-0060' })).status, 200, 'the Mac took the answer');
    assert.equal((await laesOpgaver(t.store))[0]?.svar, undefined);
  } finally { await t.ryd(); }
});
