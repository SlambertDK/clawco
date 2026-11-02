import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { PRODUKT } from '../src/shell/navn.ts';
import type { AgentRunRequest } from '../src/agent/types.ts';
import type { Runner } from '../src/rooms/mail/source.ts';
import { laesIndeks, laesUnivers } from '../src/rooms/univers/lager.ts';
import { type MoedeKandidat } from '../src/rooms/univers/schema.ts';
import { rejsenFaerdig } from './fixtures/start.ts';
import { udenData } from '../src/agent/udtroet.ts';

const NOW = new Date('2026-10-27T10:00:00Z');
const SLIDES = '<!doctype html><html><head><style>body{background:#000}</style></head><body><section><h1>Arena</h1></section><section><h2>Plan</h2></section></body></html>';
const FORBEREDELSE = { forberedelse: { maal: 'Få rollen afklaret', deltagere: [{ navn: 'Jonas Holm', hvem: 'Din leder', baggrund: 'Otte år i huset', vil: 'Høre din plan' }], talepunkter: ['Åbn med planen', 'Spørg til tallene'], opgaver: [{ titel: 'Find tallene', note: 'Fra driften' }, { titel: 'Skriv spørgsmål' }], praesentation: { titel: 'Arena-pitch', html: SLIDES } } };

let svar: (req: AgentRunRequest) => string = () => 'Intet.';
const answer = (req: AgentRunRequest): string => svar(req);

let dir = '';
let sut: ReturnType<typeof createApp>;
let hermes: ReturnType<typeof createFakeAgent>;
let store: ReturnType<typeof createFileStore>;
let kalender = '{"days":[]}';
const runnerKald: { cmd: string; args: string[] }[] = [];
const runner: Runner = async (cmd, args) => { runnerKald.push({ cmd, args }); return { code: 0, stdout: kalender, stderr: '' }; };

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kc-univers-'));
  store = createFileStore(path.join(dir, 'data'));
  await rejsenFaerdig(store);
  hermes = createFakeAgent({ answer });
  sut = createApp({ store, hermes, sourceGlob: path.join(dir, 'avis_{date}.json'), now: () => NOW, mailRunner: runner, mailStateDir: '/nonexistent', kalenderScript: '/opt/kalender_uge.py', dataDir: path.join(dir, 'settings') });
});
after(async () => { await rm(dir, { recursive: true, force: true }); });

const post = (url: string, body?: unknown): Promise<Response> => Promise.resolve(sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? null : JSON.stringify(body) }));
async function koer(res: Response) {
  const text = await res.text();
  assert.equal(res.status, 202, text);
  const rec = sut.runs.get((JSON.parse(text) as { runId: string }).runId);
  assert.ok(rec);
  return rec.finished;
}
const aktion = async (rum: string, name: string, body: unknown) => koer(await post(`/api/rum/${rum}/aktion/${name}`, body));
const chat = async (rum: string, besked: string, kontekst?: string) => koer(await post(`/api/rum/${rum}/chat`, { besked, ...(kontekst ? { kontekst } : {}) }));
const side = async (url: string): Promise<{ status: number; text: string }> => { const r = await sut.app.request(url); return { status: r.status, text: await r.text() }; };
const state = () => laesUnivers(store, 'min-arena');
const kandidat = (over: Partial<MoedeKandidat> & { eventId: string }): MoedeKandidat => ({ titel: 'Arena kickoff', start: '2026-10-28T10:00:00+01:00', slut: '2026-10-28T11:00:00+01:00', deltagere: [{ navn: 'Jonas Holm', email: 'tom@x.example' }], ...over });

test('creating a univers: validated input, listed on the overview, linked in the nav, and the page renders with its own name', async () => {
  assert.equal((await post('/api/rum/univers/aktion/nytUnivers', { navn: '  ', om: '' })).status, 400);
  assert.equal((await post('/api/rum/univers/aktion/nytUnivers', { navn: 'x'.repeat(61), om: '' })).status, 400);
  assert.equal((await post('/api/rum/univers/aktion/nytUnivers', { navn: 'Fint', om: 'y'.repeat(301) })).status, 400);
  assert.equal((await post('/api/rum/univers/aktion/nope', {})).status, 404);
  const done = await aktion('univers', 'nytUnivers', { navn: 'Min arena', om: 'Min nye lederrolle' });
  assert.equal(done.status, 'done', done.error);
  assert.match(done.result?.html ?? '', /Min arena/);
  assert.deepEqual((await laesIndeks(store)).univers.map((u) => u.id), ['min-arena']);
  assert.match((await store.readLog('univers'))[0]?.tekst ?? '', /Min arena/);

  const oversigt = await side('/rum/univers');
  assert.equal(oversigt.status, 200);
  assert.match(oversigt.text, /data-element="Univers: Min arena"/);
  assert.match(oversigt.text, /href="\/rum\/univers-min-arena"/);
  const dagen = await side('/rum/dagen');
  // KC-0052: listed under Univers, hidden until it is relevant (opened today or something open in it).
  assert.match(dagen.text, /<ul class="rooms-sub"><li hidden data-eget><a href="\/rum\/univers-min-arena"><span>Min arena<\/span>/);

  const u = await side('/rum/univers-min-arena');
  assert.equal(u.status, 200);
  assert.match(u.text, new RegExp(`<title>Min arena · ${PRODUKT}</title>`));
  assert.match(u.text, /aria-current="page"[^>]*><span>Min arena<\/span>/);
  assert.match(u.text, /data-room="univers-min-arena"/);
  assert.match(u.text, /id="chat-form" data-room="univers-min-arena"/);
  assert.equal((await side('/api/rum/univers-min-arena/fragment')).status, 200);
});

test('an unknown univers is a 404 page, a 400 on actions and chat and a 404 on fortryd, fragment and files', async () => {
  const p = await side('/rum/univers-findes-ikke');
  assert.equal(p.status, 404);
  assert.match(p.text, /Universet findes ikke/);
  assert.equal((await post('/api/rum/univers-findes-ikke/aktion/nytMoede', { titel: 'x', start: '2026-10-28T10:00' })).status, 400);
  assert.equal((await post('/api/rum/univers-findes-ikke/aktion/forbered', { moedeId: 'moede-1' })).status, 400);
  assert.equal((await post('/api/rum/univers-findes-ikke/chat', { besked: 'hej' })).status, 400);
  assert.equal((await post('/api/rum/univers-findes-ikke/log/x/fortryd')).status, 404);
  assert.equal((await side('/api/rum/univers-findes-ikke/fragment')).status, 404);
  assert.equal((await side('/rum/univers-findes-ikke/vis/dok-1.html')).status, 404);
  assert.equal((await side('/rum/univers-Stort')).status, 404, 'not a valid univers id at all');
});

test('nytMoede stores an ISO start in Copenhagen wall time: winter +01:00, summer +02:00; duration defaults to 60 and is clamped to 5..600', async () => {
  const vinter = await aktion('univers-min-arena', 'nytMoede', { titel: 'Vintermøde', start: '2026-01-15T10:00', varighed: '45', deltagere: 'Jonas Holm, anne@x.example' });
  assert.equal(vinter.status, 'done', vinter.error);
  const sommer = await aktion('univers-min-arena', 'nytMoede', { titel: 'Sommermøde', start: '2026-07-15T10:00' });
  assert.equal(sommer.status, 'done', sommer.error);
  await aktion('univers-min-arena', 'nytMoede', { titel: 'Kort', start: '2026-07-16T10:00', varighed: '1' });
  await aktion('univers-min-arena', 'nytMoede', { titel: 'Lang', start: '2026-07-17T10:00', varighed: 9999 });
  const m = (await state()).moeder;
  const find = (t: string) => m.find((x) => x.titel === t)!;
  assert.equal(find('Vintermøde').start, '2026-01-15T09:00:00.000Z');
  assert.equal(find('Vintermøde').slut, '2026-01-15T09:45:00.000Z');
  assert.deepEqual(find('Vintermøde').deltagere, [{ navn: 'Jonas Holm' }, { navn: 'anne', email: 'anne@x.example' }]);
  assert.equal(find('Sommermøde').start, '2026-07-15T08:00:00.000Z');
  assert.equal(Date.parse(find('Sommermøde').slut) - Date.parse(find('Sommermøde').start), 60 * 60_000);
  assert.equal(Date.parse(find('Kort').slut) - Date.parse(find('Kort').start), 5 * 60_000);
  assert.equal(Date.parse(find('Lang').slut) - Date.parse(find('Lang').start), 600 * 60_000);
  assert.equal(find('Vintermøde').kilde, 'manuel');
  assert.equal((await post('/api/rum/univers-min-arena/aktion/nytMoede', { titel: '', start: '2026-07-15T10:00' })).status, 400);
  assert.equal((await post('/api/rum/univers-min-arena/aktion/nytMoede', { titel: 'x', start: 'i morgen' })).status, 400);
  const side1 = await side('/rum/univers-min-arena');
  assert.match(side1.text, /Sommermøde/);
});

test('forbered asks Hermes (taenker tier) and stores the preparation, linked tasks and the presentation; vis serves it inline under a strict CSP', async () => {
  sut.runs.setModels({ lille: 'model-lille', taenker: 'model-taenker' });
  svar = () => 'Her er forberedelsen.\n```json\n' + JSON.stringify(FORBEREDELSE) + '\n```';
  const moede = (await state()).moeder.find((x) => x.titel === 'Sommermøde')!;
  assert.equal((await post('/api/rum/univers-min-arena/aktion/forbered', { moedeId: 'moede-findes-ikke' })).status, 400);
  const foer = hermes.calls.length;
  const done = await aktion('univers-min-arena', 'forbered', { moedeId: moede.id, onske: 'Få rollen afklaret' });
  assert.equal(done.status, 'done', done.error);
  const kald = hermes.calls[foer]!;
  assert.equal(kald.model, 'model-taenker');
  assert.match(kald.input, /Sommermøde/);
  assert.match(kald.input, /Få rollen afklaret/);
  assert.match(kald.instructions, /Du forbereder et møde/);
  const s = await state();
  const m = s.moeder.find((x) => x.id === moede.id)!;
  assert.equal(m.forberedelse?.maal, 'Få rollen afklaret');
  assert.deepEqual(m.forberedelse?.talepunkter, ['Åbn med planen', 'Spørg til tallene']);
  assert.deepEqual(s.opgaver.filter((o) => o.moedeId === moede.id).map((o) => o.titel), ['Find tallene', 'Skriv spørgsmål']);
  const dok = s.dokumenter.find((d) => d.moedeId === moede.id)!;
  assert.equal(dok.titel, 'Arena-pitch');
  assert.equal(m.forberedelse?.dokumentId, dok.id);
  assert.match(done.result?.html ?? '', /Arena-pitch/);
  assert.deepEqual(done.result?.venter, { 'univers-min-arena': 2 });

  const log = (await store.readLog('univers-min-arena'))[0]!;
  assert.match(log.tekst, /forberedte mødet "Sommermøde"/);
  assert.ok(log.fortryd?.startsWith('lokal:'));

  const vis = await sut.app.request(`/rum/univers-min-arena/vis/${dok.id}.html`);
  assert.equal(vis.status, 200);
  assert.equal(vis.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(vis.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(vis.headers.get('content-security-policy'), "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data: https:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
  assert.equal(vis.headers.get('content-disposition'), null, 'inline, not an attachment');
  assert.equal(await vis.text(), SLIDES);

  // Fortryd takes the whole preparation back: tasks, document and the preparation itself.
  const fortryd = await koer(await post(`/api/rum/univers-min-arena/log/${log.id}/fortryd`));
  assert.equal(fortryd.status, 'done', fortryd.error);
  const efter = await state();
  assert.equal(efter.moeder.find((x) => x.id === moede.id)?.forberedelse, undefined);
  assert.equal(efter.opgaver.filter((o) => o.moedeId === moede.id).length, 0);
  assert.equal(efter.dokumenter.length, 0);
  assert.equal((await post(`/api/rum/univers-min-arena/log/${log.id}/fortryd`)).status, 404, 'cannot be undone twice');
  svar = () => 'Intet.';
});

test('a forbered answer without a usable block fails the run and writes nothing', async () => {
  const moede = (await state()).moeder.find((x) => x.titel === 'Sommermøde')!;
  const foer = JSON.stringify(await state());
  svar = () => 'Det ved jeg ikke.';
  const a = await aktion('univers-min-arena', 'forbered', { moedeId: moede.id });
  assert.equal(a.status, 'failed');
  svar = () => '```json\n{"forberedelse":{"maal":""}}\n```';
  const b = await aktion('univers-min-arena', 'forbered', { moedeId: moede.id });
  assert.equal(b.status, 'failed');
  assert.equal(JSON.stringify(await state()), foer);
  svar = () => 'Intet.';
});

test('chat with an elementer block adds a note and a task, logs it, and Fortryd removes them again', async () => {
  svar = () => 'Jeg har lagt en note og en opgave.\n```json\n{"elementer":[{"type":"note","titel":"Idé","tekst":"Start med kunderne"},{"type":"opgave","titel":"Ring til Tom"}]}\n```';
  const foer = hermes.calls.length;
  const done = await chat('univers-min-arena', 'Skriv en note om kunderne', 'Møde: Sommermøde');
  assert.equal(done.status, 'done', done.error);
  assert.equal(done.result?.text, 'Jeg har lagt en note og en opgave.');
  const kald = hermes.calls[foer]!;
  assert.match(kald.instructions, /Du arbejder i ét univers/);
  assert.match(kald.input, /Om: Møde: Sommermøde/);
  assert.equal(udenData(kald.input), 'Skriv en note om kunderne'); // KC-0123: the rest is wrapped data
  const s = await state();
  assert.deepEqual(s.noter.map((n) => n.titel), ['Idé']);
  assert.ok(s.opgaver.some((o) => o.titel === 'Ring til Tom'));
  const chatLog = await store.readChat('univers-min-arena');
  assert.deepEqual(chatLog.map((c) => c.fra), ['henrik', 'hermes']);
  assert.equal(chatLog[0]?.kontekst, 'Møde: Sommermøde');
  const log = (await store.readLog('univers-min-arena'))[0]!;
  assert.match(log.tekst, /lavede 1 note og 1 opgave/);
  assert.ok(log.fortryd?.startsWith('lokal:'));
  assert.match((await side('/rum/univers-min-arena')).text, new RegExp(`data-fortryd="${log.id}"`));

  const fortryd = await koer(await post(`/api/rum/univers-min-arena/log/${log.id}/fortryd`));
  assert.equal(fortryd.status, 'done', fortryd.error);
  const efter = await state();
  assert.equal(efter.noter.length, 0);
  assert.ok(!efter.opgaver.some((o) => o.titel === 'Ring til Tom'));
  assert.equal((await store.readLog('univers-min-arena', 200)).find((e) => e.id === log.id)?.fortrudt !== undefined, true);
  svar = () => 'Intet.';
});

test('chat that updates an existing document by id makes a new version; Fortryd brings the old one back', async () => {
  svar = () => '```json\n{"elementer":[{"type":"dokument","titel":"Notat","html":"<h1>Første</h1>"}]}\n```';
  await chat('univers-min-arena', 'Lav et notat');
  const dok = (await state()).dokumenter.find((d) => d.titel === 'Notat')!;
  svar = () => `Kortere.\n\`\`\`json\n{"elementer":[{"type":"dokument","id":"${dok.id}","titel":"Notat","html":"<h1>Anden</h1>"}]}\n\`\`\``;
  await chat('univers-min-arena', 'Gør det kortere');
  const ny = (await state()).dokumenter.find((d) => d.id === dok.id)!;
  assert.equal(ny.html, '<h1>Anden</h1>');
  assert.equal(ny.versioner.length, 1);
  assert.equal(ny.versioner[0]?.html, '<h1>Første</h1>');
  const log = (await store.readLog('univers-min-arena'))[0]!;
  await koer(await post(`/api/rum/univers-min-arena/log/${log.id}/fortryd`));
  assert.equal((await state()).dokumenter.find((d) => d.id === dok.id)?.html, '<h1>Første</h1>');
  svar = () => 'Intet.';
});

test('chat without a block changes nothing but the chat; a bad block fails the run and writes nothing', async () => {
  const foer = JSON.stringify(await state());
  const logFoer = (await store.readLog('univers-min-arena', 500)).length;
  svar = () => 'Næste møde er i morgen kl. 10.';
  const prosa = await chat('univers-min-arena', 'Hvornår er næste møde?');
  assert.equal(prosa.status, 'done', prosa.error);
  assert.equal(prosa.result?.text, 'Næste møde er i morgen kl. 10.');
  assert.equal(prosa.result?.html, undefined);
  assert.equal(JSON.stringify(await state()), foer);
  assert.equal((await store.readLog('univers-min-arena', 500)).length, logFoer);
  assert.equal((await store.readChat('univers-min-arena')).at(-1)?.tekst, 'Næste møde er i morgen kl. 10.');

  svar = () => 'Her.\n```json\n{"elementer":[]}\n```';
  assert.equal((await chat('univers-min-arena', 'noget')).status, 'failed');
  svar = () => 'Her.\n```json\n{ikke json\n```';
  assert.equal((await chat('univers-min-arena', 'noget')).status, 'failed');
  assert.equal(JSON.stringify(await state()), foer);
  svar = () => 'Intet.';
});

test('KC-0050: a chat block that cannot be used goes back to Hermes once; the corrected answer is applied and chatted only once', async () => {
  svar = (req) => req.input.includes('kunne ikke bruges')
    ? 'Rettet.\n```json\n{"elementer":[{"type":"note","titel":"Rettet note","tekst":"Nu virker den"}]}\n```'
    : 'Her.\n```json\n{"elementer":[]}\n```';
  const chatFoer = (await store.readChat('univers-min-arena')).length;
  const done = await chat('univers-min-arena', 'Lav en note');
  assert.equal(done.status, 'done', done.error);
  assert.equal(done.result?.text, 'Rettet.');
  assert.ok((await state()).noter.some((n) => n.titel === 'Rettet note'));
  const nye = (await store.readChat('univers-min-arena')).slice(chatFoer);
  assert.deepEqual(nye.map((c) => `${c.fra}:${c.tekst}`), ['henrik:Lav en note', 'hermes:Rettet.']);
  svar = () => 'Intet.';
});

test('chat with a forberedelse block replaces the preparation of the meeting named by the context; without a named meeting it fails', async () => {
  const moede = (await state()).moeder.find((x) => x.titel === 'Vintermøde')!;
  svar = () => 'Opdateret.\n```json\n' + JSON.stringify({ forberedelse: { ...FORBEREDELSE.forberedelse, maal: 'Kortere mål', praesentation: undefined } }) + '\n```';
  assert.equal((await chat('univers-min-arena', 'Skærp målet')).status, 'failed');
  const done = await chat('univers-min-arena', 'Skærp målet', 'Mødet: Vintermøde');
  assert.equal(done.status, 'done', done.error);
  assert.equal((await state()).moeder.find((x) => x.id === moede.id)?.forberedelse?.maal, 'Kortere mål');
  svar = () => 'Intet.';
});

test('opgaveStatus moves a task with one tap; unknown tasks and statuses are 400', async () => {
  const o = (await state()).opgaver[0]!;
  const done = await aktion('univers-min-arena', 'opgaveStatus', { opgaveId: o.id, status: 'igang' });
  assert.equal(done.status, 'done', done.error);
  assert.equal((await state()).opgaver.find((x) => x.id === o.id)?.status, 'igang');
  assert.equal((await post('/api/rum/univers-min-arena/aktion/opgaveStatus', { opgaveId: o.id, status: 'nej' })).status, 400);
  assert.equal((await post('/api/rum/univers-min-arena/aktion/opgaveStatus', { opgaveId: 'opg-nope', status: 'faerdig' })).status, 400);
  const venter = await aktion('univers-min-arena', 'opgaveStatus', { opgaveId: o.id, status: 'faerdig' });
  assert.ok(venter.result?.venter !== undefined);
});

test('the files route only serves .html names of documents in a univers; everything else is 404', async () => {
  const dok = (await state()).dokumenter[0]!;
  assert.equal((await side(`/rum/univers-min-arena/vis/${dok.id}.html`)).status, 200);
  assert.equal((await side(`/rum/univers-min-arena/vis/${dok.id}.md`)).status, 404);
  assert.equal((await side(`/rum/univers-min-arena/vis/${dok.id}`)).status, 404);
  assert.equal((await side('/rum/univers-min-arena/vis/dok-ffffffff.html')).status, 404);
  assert.equal((await side('/rum/univers-min-arena/vis/..%2F..%2Fetc%2Fpasswd.html')).status, 404);
  assert.equal((await side('/rum/univers-min-arena/vis/../../etc')).status, 404);
  assert.equal((await side('/rum/univers-min-arena/vis/..%2F..%2Fetc')).status, 404);
  assert.equal((await side('/rum/dagen/vis/x.html')).status, 404, 'rooms without files have no vis');
  assert.equal((await side('/rum/skrive/vis/dok-1.html')).status, 404);
  assert.equal((await side(`/rum/univers-min-arena/dok/${dok.id}.html`)).status, 200, 'the attachment route is left as it was');
});

test('new meetings: placing and hiding validate the candidate and the univers, and the nav and Hjem count them', async () => {
  await store.writeState('univers', { ...(await laesIndeks(store)), nyeMoeder: [kandidat({ eventId: 'e1' }), kandidat({ eventId: 'e2', titel: 'Andet', start: '2026-10-29T10:00:00+01:00', slut: '2026-10-29T11:00:00+01:00' })] });
  assert.match((await side('/rum/dagen')).text, /href="\/rum\/univers"[^>]*><span>Univers<\/span><span class="count">2<\/span>/);
  assert.match((await side('/rum/hjem')).text, /2 nye møder venter på et univers/);
  assert.match((await side('/rum/univers')).text, /Læg i univers/);

  assert.equal((await post('/api/rum/univers/aktion/placerMoede', { eventId: 'findes-ikke', slug: 'min-arena' })).status, 400);
  assert.equal((await post('/api/rum/univers/aktion/placerMoede', { eventId: 'e1', slug: 'findes-ikke' })).status, 400);
  assert.equal((await post('/api/rum/univers/aktion/skjulMoede', { eventId: 'findes-ikke' })).status, 400);

  const placed = await aktion('univers', 'placerMoede', { eventId: 'e1', slug: 'min-arena' });
  assert.equal(placed.status, 'done', placed.error);
  assert.deepEqual((await laesIndeks(store)).nyeMoeder.map((k) => k.eventId), ['e2']);
  assert.ok((await state()).moeder.some((m) => m.eventId === 'e1' && m.kilde === 'kalender'));
  assert.deepEqual(placed.result?.venter, { univers: 1 });

  const skjult = await aktion('univers', 'skjulMoede', { eventId: 'e2' });
  assert.equal(skjult.status, 'done', skjult.error);
  const indeks = await laesIndeks(store);
  assert.deepEqual(indeks.nyeMoeder, []);
  assert.deepEqual(indeks.skjulteMoeder, ['e2']);
  assert.doesNotMatch((await side('/rum/hjem')).text, /nye møder venter på et univers|nyt møde venter/);
});

test('the calendar poller merges candidates, skips placed and hidden ones, refreshes placed meetings and is off without a script', async () => {
  const dag = (events: unknown[]) => JSON.stringify({ days: [{ date: '2026-10-28', events }] });
  const ev = (id: string, title: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({ id, title, start, end, all_day: false, attendees: [{ name: 'Jonas Holm', email: 'tom@x.example' }, { name: 'Henrik', email: 'h@x.example', self: true }], ...extra });
  kalender = dag([
    ev('e1', 'Arena kickoff', '2026-10-28T11:00:00+01:00', '2026-10-28T12:00:00+01:00'), // placed earlier, moved an hour
    ev('e2', 'Skjult', '2026-10-29T10:00:00+01:00', '2026-10-29T11:00:00+01:00'), // hidden
    ev('e3', 'Nyt møde', '2026-10-30T10:00:00+01:00', '2026-10-30T11:00:00+01:00'),
    ev('e4', 'Alene', '2026-10-30T12:00:00+01:00', '2026-10-30T13:00:00+01:00', { attendees: [{ name: 'Henrik', email: 'h@x.example', self: true }] }), // nobody else
    ev('e5', 'Hele dagen', '2026-10-31', '2026-11-01', { all_day: true }),
  ]);
  runnerKald.length = 0;
  const r = await sut.moedeTikNu();
  assert.deepEqual(runnerKald, [{ cmd: 'python3', args: ['/opt/kalender_uge.py', '--days', '14'] }]);
  assert.deepEqual(r, { nye: 1, opdateret: 1 });
  const indeks = await laesIndeks(store);
  assert.deepEqual(indeks.nyeMoeder.map((k) => k.eventId), ['e3']);
  const placeret = (await state()).moeder.find((m) => m.eventId === 'e1')!;
  assert.equal(placeret.start, '2026-10-28T11:00:00+01:00');
  assert.equal(placeret.kilde, 'kalender');

  // Same calendar again: nothing changes; a candidate that vanished from the calendar drops out.
  assert.deepEqual(await sut.moedeTikNu(), { nye: 1, opdateret: 0 });
  kalender = dag([ev('e1', 'Arena kickoff', '2026-10-28T11:00:00+01:00', '2026-10-28T12:00:00+01:00')]);
  assert.deepEqual(await sut.moedeTikNu(), { nye: 0, opdateret: 0 });
  assert.deepEqual((await laesIndeks(store)).nyeMoeder, []);

  // A failing or unreadable script changes nothing.
  kalender = 'ikke json';
  assert.equal(await sut.moedeTikNu(), null);

  const udenScript = createApp({ store, hermes, sourceGlob: '/x/{date}.json', now: () => NOW, mailRunner: runner, mailStateDir: '/nonexistent', dataDir: path.join(dir, 'settings2') });
  runnerKald.length = 0;
  assert.equal(await udenScript.moedeTikNu(), null);
  assert.equal(runnerKald.length, 0);
  const stop = udenScript.moedeTik();
  stop();
  assert.equal(runnerKald.length, 0, 'the poller does not start without a script');
});

test('the poller starts once at once and stops; a placed meeting that was archived with its univers never returns as new', async () => {
  const dag = JSON.stringify({ days: [{ date: '2026-10-28', events: [{ id: 'e1', title: 'Arena kickoff', start: '2026-10-28T11:00:00+01:00', end: '2026-10-28T12:00:00+01:00', attendees: [{ name: 'Jonas Holm', email: 'tom@x.example' }] }] }] });
  kalender = dag;
  await aktion('univers-min-arena', 'arkiver', {});
  assert.equal((await laesIndeks(store)).univers.find((u) => u.id === 'min-arena')?.arkiveret !== undefined, true);
  runnerKald.length = 0;
  const stop = sut.moedeTik();
  await new Promise((res) => setTimeout(res, 50));
  stop();
  assert.equal(runnerKald.length, 1, 'one poll at start');
  assert.deepEqual((await laesIndeks(store)).nyeMoeder, []);
  assert.doesNotMatch((await side('/rum/dagen')).text, /href="\/rum\/univers-min-arena"/, 'archived: gone from the nav');
  assert.equal((await side('/rum/univers-min-arena')).status, 200, 'but the page and its data remain');
  assert.match((await side('/rum/univers-min-arena')).text, /arkiveret/);
});

test('the overview chat: a nytUnivers block creates a univers, a prose answer does not', async () => {
  svar = () => 'Jeg har oprettet det.\n```json\n{"nytUnivers":{"navn":"Energi og politik","om":"Det jeg følger"}}\n```';
  const foer = hermes.calls.length;
  const done = await chat('univers', 'Lav et univers om energi og politik');
  assert.equal(done.status, 'done', done.error);
  assert.match(hermes.calls[foer]!.instructions, /Du arbejder i Univers-oversigten/);
  assert.equal(done.result?.text, 'Jeg har oprettet det.');
  assert.deepEqual((await laesIndeks(store)).univers.map((u) => u.id), ['min-arena', 'energi-og-politik']);
  assert.match(done.result?.html ?? '', /Energi og politik/);

  svar = () => 'Du har to universer.';
  const n = (await laesIndeks(store)).univers.length;
  const prosa = await chat('univers', 'Hvad har jeg?');
  assert.equal(prosa.status, 'done');
  assert.equal(prosa.result?.html, undefined);
  assert.equal((await laesIndeks(store)).univers.length, n);

  svar = () => '```json\n{"nytUnivers":{"navn":""}}\n```';
  assert.equal((await chat('univers', 'lav et tomt')).status, 'failed');
  assert.equal((await laesIndeks(store)).univers.length, n);
  svar = () => 'Intet.';
});

test('runs are labelled in Danish with the room name and use the right tier', async () => {
  const run = sut.runs.list().find((r) => r.kind === 'forbered');
  assert.equal(run?.label, 'Univers: forbereder mødet');
  assert.equal(run?.room, 'univers-min-arena');
  assert.equal(hermes.calls.filter((c) => c.model === 'model-taenker').length >= 1, true);
});
