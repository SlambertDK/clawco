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

// ---------- KC-0236: the Danmark-pakke ----------

test('KC-0236 the cold start: Start has ONE group "Danmark-pakke" holding Aula\'s card (no Digital Post step: no mail yet), and step 3 does not offer Aula', async () => {
  await verden.hop('kold');
  const h = await side('/rum/start');
  assert.equal((h.match(/data-danmark-pakke/g) ?? []).length, 1);
  assert.match(h, /<h3 class="eyebrow">Danmark-pakke<\/h3>/);
  assert.equal((h.match(/data-kilde-kort="aula-kalender"/g) ?? []).length, 1);
  assert.ok(h.indexOf('data-kilde-kort="aula-kalender"') > h.indexOf('data-danmark-pakke'), 'inside the group');
  assert.match(h, /data-aktion="aula-ikke-nu"/);
  assert.doesNotMatch(h, /data-post-start/);
});

test('KC-0236 "Digital Post: Start-trinnet": the same group holds both cards, Aula\'s first', async () => {
  await verden.hop('post-start');
  const h = await side('/rum/start');
  assert.equal((h.match(/data-danmark-pakke/g) ?? []).length, 1);
  assert.equal((h.match(/Danmark-pakke<\/h3>/g) ?? []).length, 1);
  const a = h.indexOf('data-kilde-kort="aula-kalender"');
  assert.ok(a > h.indexOf('data-danmark-pakke') && h.indexOf('data-post-start') > a);
});

test('KC-0236 aula-koblet: Nu shows the school day — today\'s sports day and tomorrow\'s parent talk — as elements with no handling; the week labels each event with the institution', async () => {
  await verden.hop('aula-koblet');
  const hjem = await side('/rum/hjem');
  assert.match(hjem, /data-gruppe="Aula"/);
  assert.match(hjem, /I dag: Idrætsdag i 2\.B \(Kløvermarkskolen, kl\. 13\.00\)/);
  assert.match(hjem, /I morgen: Skole-hjem-samtale for Ella \(Kløvermarkskolen, kl\. 16\.30\)/);
  assert.equal((hjem.match(/data-aula-kort="/g) ?? []).length, 2, 'the sports day and the talk; the later ones are not for Nu');
  const g = hjem.indexOf('data-gruppe="Aula"');
  const rest = hjem.slice(g + 10);
  const del = hjem.slice(g, g + 10 + rest.search(/<section|<\/main>|data-gruppe=|data-baand=/));
  for (const ikke of ['Skolen holder fri', 'Sommerfest', 'Gymnastik', 'Næste måneds']) assert.ok(!del.includes(ikke), `${ikke} is not for Nu`);
  for (const forbudt of ['<button', 'data-handling', 'data-aktion', 'data-spoerg', '<form', ...ALDRIG]) assert.ok(!del.includes(forbudt), forbudt);
  const uge = await side('/rum/husstand');
  assert.ok((uge.match(/data-uge-institution>· Kløvermarkskolen<\/span>/g) ?? []).length >= 4, 'every Aula event in the week carries the institution');
});

test('KC-0236 outside the moments with Aula connected, and when the link is revoked: no school element in Nu', async () => {
  for (const m of ['kold', 'aula-tilbagekaldt']) {
    await verden.hop(m);
    const h = await side('/rum/hjem');
    assert.doesNotMatch(h, /data-aula-kort|data-gruppe="Aula"/, m);
  }
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
