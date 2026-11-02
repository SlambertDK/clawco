// KC-0235 in the test world (AGENTS §4 r11): Aula's calendar link in each state — the connect card and its steps in the cold
// start, connected and in the household's shared week (the real reader over the world's fetcher, an invented family), and
// revoked (Aula answers 410: the card in Nu asks for a new link, in the fixed words). Nothing of the file's organizer,
// invitees or long description reaches a page; the world never calls the internet.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lavTestverden } from '../../src/testtilstand/verden.ts';
import { aulaIcs, aulaLink } from '../../src/testtilstand/indhold/aula.ts';
import { fakta } from '../../src/testtilstand/indhold/fakta.ts';
import { FORBUDT } from '../../src/testtilstand/indhold.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-aula-verden-'));
after(() => rm(rod, { recursive: true, force: true }));
const verden = await lavTestverden({ dataDir: path.join(rod, 'data-test'), delayMs: 0 });
const side = async (sti: string): Promise<string> => (await verden.app.request(sti)).text();
type O = { id: string; zone: string; forbundet: boolean; helbred: { status: string; tekst?: string } | null; kort: { handling: string; tekst: string; trin?: { tekst: string }[]; felter: { navn: string; type: string }[] } };
const aula = async (): Promise<O> => ((await (await verden.app.request('/api/kilder')).json()) as { kilder: O[] }).kilder.find((k) => k.id === 'aula-kalender')!;
const forbind = (link: string) => verden.app.request('/api/kilder/aula-kalender/forbind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ felter: { link } }) });

/** What the invented file holds that must never be on a page. */
const ALDRIG = ['Lærer Lund', 'lund@kloevermark.example', 'ella@kloevermark.example', 'mads@boernehuset.example', 'mailto', 'En lang tekst til forældrene', 'besked/12345', 'opdigtet-1@aula.example', 'Aflyst skovtur'];

test('the file has what must be dropped (so the tests below are not vacuous)', () => {
  const t = aulaIcs(fakta('2026-11-02'));
  for (const s of ['ORGANIZER', 'ATTENDEE', 'DESCRIPTION:En lang tekst', 'URL:https://www.aula.dk/besked', 'STATUS:CANCELLED', 'RRULE:FREQ=WEEKLY']) assert.ok(t.includes(s), s);
  assert.ok(!FORBUDT.some((f) => t.toLowerCase().includes(f.toLowerCase())), 'no deny-listed name');
});

test('the cold start: Aula\'s card and its steps in Aula\'s own words are in Start, with one secret field', async () => {
  await verden.hop('kold');
  const a = await aula();
  assert.deepEqual([a.forbundet, a.zone, a.kort.handling], [false, 'husstand', 'Forbind Aula']);
  assert.deepEqual(a.kort.felter.map((f) => [f.navn, f.type]), [['link', 'hemmelig']]);
  assert.match(a.kort.trin!.map((t) => t.tekst).join(' '), /Ugekalender/);
  const h = await side('/rum/start');
  assert.match(h, /data-kilde-kort="aula-kalender"/);
  assert.match(h, /data-kilde-trin="aula-kalender"/);
  assert.match(h, /tid, titel, sted og institution/);
});

test('aula-koblet: connected in the husstand zone and ok; the shared week shows the events (the kindergarten\'s too), the cancelled one not, and nothing of who is invited', async () => {
  await verden.hop('aula-koblet');
  const a = await aula();
  assert.deepEqual([a.forbundet, a.zone, a.helbred?.status], [true, 'husstand', 'ok']);
  assert.match(a.kort.tekst, /Forbundet til www\.aula\.dk/);
  assert.ok(!a.kort.tekst.includes('ugekalender/'), 'only the host, never the link');
  const h = await side('/rum/husstand');
  for (const titel of ['Skole-hjem-samtale for Ella', 'Skolen holder fri (lærerkursus)', 'Gymnastik i 2.B', 'Sommerfest i Børnehuset Solsikken for Mads']) assert.ok(h.includes(titel), titel);
  for (const forbudt of ALDRIG) assert.ok(!h.includes(forbudt), `Husstanden holds "${forbudt}"`);
  const koe = (await (await verden.app.request('/api/koe?kilder=1')).json()) as { kilder?: string };
  assert.match(koe.kilder ?? '', /data-kilde="aula-kalender" data-kilde-tilstand="forbundet"/);
  for (const sti of ['/rum/hjem', '/rum/dagen', '/api/kilder']) for (const forbudt of ALDRIG) assert.ok(!(await side(sti)).includes(forbudt), `${sti} holds "${forbudt}"`);
});

test('aula-koblet: the link is in the secret store only — the moment\'s own, never in kilder.json or any page', async () => {
  await verden.hop('aula-koblet');
  const dir = path.join(rod, 'data-test');
  const hemmeligt = await readFile(path.join(dir, 'hemmeligheder', 'aula-kalender.json'), 'utf8');
  assert.ok(hemmeligt.includes(aulaLink('aula-koblet')));
  assert.ok(!(await readFile(path.join(dir, 'kilder.json'), 'utf8')).includes('ugekalender'));
  for (const sti of ['/rum/husstand', '/rum/hjem', '/api/kilder', '/api/koe?kilder=1']) assert.ok(!(await side(sti)).includes('ugekalender/'), sti);
});

test('aula-tilbagekaldt: Aula answers 410 — the card in Nu asks for a new link in the fixed words, with the link field and no password words', async () => {
  await verden.hop('aula-tilbagekaldt');
  assert.equal((await aula()).helbred?.status, 'log-ind-igen');
  const h = await side('/rum/hjem');
  assert.match(h, /data-kilde-helbred="log-ind-igen" data-kilde-helbred-id="aula-kalender"/);
  assert.match(h, /Kalenderlinket virker ikke længere/);
  assert.match(h, /nyt kalenderlink i Aula/);
  assert.match(h, />Indsæt et nyt link</);
  assert.match(h, /name="link" type="password"/);
  assert.ok(!/adgangskode/i.test(h.slice(h.indexOf('data-kilde-helbred-id="aula-kalender"'), h.indexOf('data-kilde-helbred-id="aula-kalender"') + 2500)));
  for (const forbudt of ALDRIG) assert.ok(!h.includes(forbudt), forbudt);
});

test('the world never calls the internet: a link that is not on Aula is refused, an Aula link the world does not know too', async () => {
  await verden.hop('aula-koblet');
  assert.equal((await forbind('https://example.com/kalender.ics')).status, 400);
  assert.equal((await forbind('https://www.aula.dk/kalender/ugekalender/et-rigtigt-link')).status, 400, 'the world\'s fetcher refuses it: no call leaves');
  assert.equal((await forbind(aulaLink('aula-koblet'))).status, 200, 'the world\'s own invented link connects');
});
