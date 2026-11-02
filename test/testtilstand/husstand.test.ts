// KC-0148 in the test world (AGENTS §4 r11): the fictional household has a
// family calendar connected in the husstand zone with a week of shared events;
// Husstanden shows them with whose they are, and never an event of the
// privat calendar (the day's work appointments).

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FORBUDT, MOMENTER, froe, svar } from '../../src/testtilstand/indhold.ts';
import { buildForespForslagRun, buildHusstandChatRun, parseForespForslag } from '../../src/hushold/prompt.ts';
import { parseHusstandState } from '../../src/hushold/schema.ts';
import { beslutter, TILSTANDE, ubesvaret } from '../../src/hushold/foresp.ts';
import { FAMILIEKALENDER, husstandUge, TEST_HUSSTAND } from '../../src/testtilstand/indhold/husstand.ts';
import { fakta } from '../../src/testtilstand/indhold/fakta.ts';
import { lavTestverden } from '../../src/testtilstand/verden.ts';

const DAG = '2026-10-29';
const rod = await mkdtemp(path.join(tmpdir(), 'kc-husstand-verden-'));
after(() => rm(rod, { recursive: true, force: true }));

test('the family calendar: a week of shared events, each member with a login on at least one, nothing real', () => {
  const uge = husstandUge(fakta(DAG));
  assert.equal(uge.days.length, 7);
  const events = uge.days.flatMap((d) => d.events);
  assert.ok(events.length >= 4);
  const tekst = JSON.stringify(uge);
  for (const p of TEST_HUSSTAND.personer.filter((x) => x.rolle !== 'ejer')) assert.ok(tekst.includes(p.login!), `${p.navn} is on an event`);
  for (const ord of FORBUDT) assert.ok(!tekst.toLowerCase().includes(ord.toLowerCase()), `contains "${ord}"`);
});

test('every moment of the day connects the family calendar in the husstand zone', () => {
  for (const m of MOMENTER) {
    const post = froe(m.id, DAG).kilder?.kilder.find((k) => k.id === FAMILIEKALENDER);
    assert.equal(post?.status, 'forbundet', m.id);
    assert.equal(post?.zone, 'husstand', m.id);
  }
});

test('the scripted Hermes answers the chat in Husstanden about the family week, not with the fallback', () => {
  const req = buildHusstandChatRun('Hvad skal vi i denne uge?', undefined, [], []);
  const tekst = svar(req, { moment: MOMENTER[0]!, dag: DAG });
  assert.match(tekst, /fællesspisning/i);
});

test('Husstanden in the test world:four members with their roles, the shared week, no privat appointment', async () => {
  const v = await lavTestverden({ dataDir: path.join(rod, 'data-test'), delayMs: 0 });
  await v.hop('morgen');
  const res = await v.app.request('/rum/husstand');
  assert.equal(res.status, 200);
  const h = await res.text();
  for (const r of ['ejer', 'medlem', 'barn', 'gaest']) assert.match(h, new RegExp(`data-medlem-rolle="${r}"`));
  assert.match(h, /Fællesspisning/);
  assert.match(h, /Svømning <span class="mono muted">· Ella<\/span>/);
  assert.doesNotMatch(h, /Stand-up: programmet/, 'the privat calendar never enters');
  assert.match(await (await v.app.request('/rum/hjem')).text(), /<ul class="rooms-sub">[\s\S]*?href="\/rum\/husstand"/);
});

test('KC-0149: the requests validate in every moment; during the day Henrik sees every state and a reminder, never Maja→Ella', async () => {
  for (const m of MOMENTER) parseHusstandState(froe(m.id, DAG).rum['husstand']?.state);
  const v = await lavTestverden({ dataDir: path.join(rod, 'foresp-data-test'), delayMs: 0 });
  await v.hop('morgen');
  const h = await (await v.app.request('/rum/husstand')).text();
  for (const t of TILSTANDE) assert.match(h, new RegExp(`data-foresp-tilstand="${t}"`), t);
  assert.match(h, /data-foresp-paamindelse/);
  assert.doesNotMatch(h, /fodre katten/, 'a request between two others is not shown');
  const nu = await (await v.app.request('/rum/hjem')).text();
  assert.match(nu, /Påmindelse: Maja spørger: Kan du hente Ella/);
  assert.match(nu, /data-gruppe="Venter på andre"[\s\S]*?Maja har ikke svaret endnu: Kan du tage pakken med fra posthuset\?/, 'I gang: what Henrik asked');
});

test('KC-0149: from the late evening nothing of Henrik\'s requests waits on him', () => {
  const s = parseHusstandState(froe('sent-aften', DAG).rum['husstand']?.state);
  assert.deepEqual(s.forespoergsler.filter((f) => beslutter(f) === 'henrik' || (f.fra === 'henrik' && ubesvaret(f))).map((f) => f.id), []);
});

test('KC-0149: the scripted Hermes answers a request\'s suggestion run with valid advice', () => {
  const f = parseHusstandState(froe('morgen', DAG).rum['husstand']?.state).forespoergsler[0]!;
  const forslag = parseForespForslag(svar(buildForespForslagRun(f, [], []), { moment: MOMENTER[0]!, dag: DAG }));
  assert.ok(forslag && forslag.alternativer.length > 0);
});

// ---------- KC-0152: "Tirsdag før weekenden" ----------

import { ALLE_MOMENTER } from '../../src/testtilstand/indhold.ts';
import { momentPlus } from '../../src/testtilstand/indhold/fakta.ts';
import { buildKonfliktRun } from '../../src/hushold/prompt.ts';
import { konfliktResume, parseKonfliktTekst, konfliktStatus } from '../../src/hushold/konflikt.ts';
import { medlemmerAf } from '../../src/hushold/personer.ts';

const TIRSDAG_ID = 'tirsdag-weekend';
const ugedagAf = (dato: string): number => new Date(`${dato}T12:00:00Z`).getUTCDay();

test('KC-0152: the moment puts the clock on a Tuesday whatever day the story is on', () => {
  const m = ALLE_MOMENTER.find((x) => x.id === TIRSDAG_ID);
  assert.equal(m?.navn, 'Tirsdag før weekenden');
  assert.equal(m?.url, '/rum/husstand');
  for (const dag of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']) {
    const plus = momentPlus(m!, dag);
    assert.ok(plus >= 1 && plus <= 7, `${dag}: ${plus}`);
    assert.equal(ugedagAf(fakta(dag).plus(plus)), 2, `${dag} + ${plus} is a Tuesday`);
  }
  assert.equal(momentPlus(ALLE_MOMENTER.find((x) => x.id === 'bil-loerdag')!, DAG), 1, 'other moments keep their fixed offset');
});

test('KC-0152: that moment has one weekend card for Henrik and Maja about Ella, on the coming Saturday; no other moment has one', () => {
  for (const dag of [DAG, '2026-11-03']) {
    const m = ALLE_MOMENTER.find((x) => x.id === TIRSDAG_ID)!;
    const s = parseHusstandState(froe(TIRSDAG_ID, dag).rum['husstand']?.state);
    assert.equal(s.konflikter.length, 1);
    const k = s.konflikter[0]!;
    assert.deepEqual(k.parter, ['henrik', 'maja']);
    assert.deepEqual(k.behov, { slags: 'barn', id: 'ella', navn: 'Ella' });
    assert.equal(ugedagAf(k.dag), 6, 'a Saturday');
    assert.equal(k.dag, fakta(dag).plus(momentPlus(m, dag) + 4), 'the Saturday after that Tuesday');
    const t = konfliktResume(k, medlemmerAf(TEST_HUSSTAND.personer, []));
    assert.equal(t.resume, 'Lørdag: Henrik har cykeltur 9 til 14, Maja har kaffe med Signe 11 til 13.');
    assert.equal(t.spoergsmaal, 'Hvem har Ella?');
    const tekst = JSON.stringify(k);
    for (const ord of FORBUDT) assert.ok(!tekst.toLowerCase().includes(ord.toLowerCase()), `contains "${ord}"`);
    assert.equal(konfliktStatus(k, s.forespoergsler, new Date(`${fakta(dag).plus(momentPlus(m, dag))}T08:00:00Z`)), 'aaben', 'open on that Tuesday');
  }
  for (const m of ALLE_MOMENTER.filter((x) => x.id !== TIRSDAG_ID)) assert.deepEqual(parseHusstandState(froe(m.id, DAG).rum['husstand']?.state).konflikter, [], m.id);
});

test('KC-0152: the scripted Hermes phrases the weekend card in words the app accepts', () => {
  const m = medlemmerAf(TEST_HUSSTAND.personer, []);
  const k = parseHusstandState(froe(TIRSDAG_ID, DAG).rum['husstand']?.state).konflikter[0]!;
  const tekst = parseKonfliktTekst(svar(buildKonfliktRun(k, m), { moment: ALLE_MOMENTER.find((x) => x.id === TIRSDAG_ID)!, dag: DAG }), k, m);
  assert.ok(tekst, 'valid, neutral, both names');
});

test('KC-0152: in the test world the card is on screen for Henrik, in Husstanden and in Nu, with the red options', async () => {
  const v = await lavTestverden({ dataDir: path.join(rod, 'weekend-data-test'), delayMs: 0 });
  await v.hop(TIRSDAG_ID);
  const h = await (await v.app.request('/rum/husstand')).text();
  assert.match(h, /data-konflikt="k-weekend"/);
  assert.match(h, /Hvem har Ella\?/);
  assert.match(h, />Maja tager Ella</);
  assert.match(await (await v.app.request('/rum/hjem')).text(), /Weekend: Hvem har Ella\?/);
});
