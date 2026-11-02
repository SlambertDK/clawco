import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUniversChatRun, buildForberedRun, buildOversigtChatRun, MARKOER } from '../../src/rooms/univers/prompt.ts';
import { tomtIndeks, tomtUnivers, type Moede, type UniversInfo, type UniversState } from '../../src/rooms/univers/schema.ts';
import { udenData, udpak } from '../../src/agent/udtroet.ts';
import { golden, navneMed, PROMPTER, samlet } from '../fixtures/sprog-golden-prompt-rum-b.ts';
import { medSprog } from '../../src/store/sprog.ts';

// KC-0123: the universe, the meeting and the element Henrik points at are data segments, never instructions.
const seg = (r: { input: string }, kilde: string): string => udpak(r.input).filter((d) => d.kilde === kilde).map((d) => d.tekst).join('\n');

const NOW = new Date('2026-10-27T10:00:00Z');
const info: UniversInfo = { id: 'min-arena', navn: 'Min arena', om: 'Min nye lederrolle', oprettet: NOW.toISOString() };
const moede: Moede = {
  id: 'moede-1', kilde: 'manuel', titel: 'Pitch til Tom', start: '2026-10-28T08:00:00.000Z', slut: '2026-10-28T09:00:00.000Z',
  deltagere: [{ navn: 'Jonas Holm', email: 'tom@example.org' }, { navn: 'Line Berg' }],
};
const state: UniversState = {
  ...tomtUnivers(),
  dokumenter: [{
    id: 'dok-aaaa1111', titel: 'Pitch', html: '<style>body{background:#000}</style><script>evil()</script><h1>Min pitch</h1><p>Vi bygger <b>noget</b>.</p>',
    tekst: 'Min pitch\nVi bygger noget.', versioner: [], oprettet: NOW.toISOString(), aendret: NOW.toISOString(),
  }],
  noter: [{ id: 'note-bbbb2222', titel: 'Idé', tekst: 'Start med kunderne', oprettet: NOW.toISOString() }],
  opgaver: [{ id: 'opg-cccc3333', titel: 'Find tal', note: 'fra driften', status: 'igang' }],
  moeder: [moede],
};

test('univers chat: marker in the instructions; name, brief and every element with its id as afledt data (documents as text, never raw html)', () => {
  const r = buildUniversChatRun(info, state, 'Gør pitchen kortere', undefined, NOW);
  assert.ok(r.instructions.includes(MARKOER.univers));
  const u = seg(r, 'univers');
  assert.ok(!r.instructions.includes('Min arena'));
  assert.match(u, /Min arena/);
  assert.match(u, /Min nye lederrolle/);
  assert.match(u, /\[dok-aaaa1111\] Pitch/);
  assert.match(u, /Vi bygger noget\./);
  assert.doesNotMatch(u, /evil\(\)|<h1>|background:#000|<p>/);
  assert.match(u, /\[note-bbbb2222\] Idé/);
  assert.match(u, /Start med kunderne/);
  assert.match(u, /\[opg-cccc3333\].*I gang.*Find tal/);
  assert.match(u, /\[moede-1\] Pitch til Tom/);
  assert.match(u, /Jonas Holm/);
  assert.equal(udenData(r.input), 'Gør pitchen kortere');
});

test('univers chat: the answer contract (prose, one elementer block, ids, html rules, never send/pay/delete)', () => {
  const t = buildUniversChatRun(info, state, 'x', undefined, NOW).instructions;
  assert.match(t, /kort på dansk/i);
  assert.match(t, /"elementer"/);
  for (const k of ['dokument', 'note', 'opgave', 'titel', 'html', 'tekst']) assert.ok(t.includes(k), k);
  assert.match(t, /én .*json-blok|ét .*json-blok|ÉN .*json/i);
  assert.match(t, /samme id|genbrug.*id/i);
  assert.match(t, /ingen scripts|uden scripts/i);
  assert.match(t, /systemskrifttyper/);
  assert.match(t, /mørk/i);
  assert.match(t, /sektion/i);
  assert.match(t, /kartotek|personer/i);
  assert.match(t, /aldrig .*(sende|betale|slette)|må aldrig/i);
  assert.match(t, /relation/i);
  assert.match(t, /"forberedelse"/, 'a change to a meeting preparation can come back as a forberedelse block');
});

test('univers chat: the context chip is passed on and an empty universe is described', () => {
  const r = buildUniversChatRun(info, tomtUnivers(), 'Hvad nu?', 'Møde: Pitch til Tom', NOW);
  assert.match(seg(r, 'element'), /Om: Møde: Pitch til Tom/);
  assert.match(seg(r, 'univers'), /tomt|ingenting endnu|ingen elementer/i);
  const uden = buildUniversChatRun(info, tomtUnivers(), 'Hvad nu?', undefined, NOW);
  assert.equal(seg(uden, 'element'), '');
});

test('long documents are cut so the prompt stays bounded', () => {
  const stor = { ...state, dokumenter: [{ ...state.dokumenter[0]!, tekst: 'ord '.repeat(10_000) }] };
  const r = buildUniversChatRun(info, stor, 'x', undefined, NOW);
  assert.ok(r.input.length < 30_000, String(r.input.length));
});

test('forbered run: marker, meeting facts, the schema, Henrik\'s wish and the guess rule', () => {
  const r = buildForberedRun(info, state, moede, 'Få rollen afklaret', NOW);
  assert.ok(r.instructions.includes(MARKOER.forbered));
  assert.match(seg(r, 'univers'), /Min arena/);
  assert.match(seg(r, 'kalender'), /Pitch til Tom/);
  assert.ok(!r.instructions.includes('Pitch til Tom'));
  assert.match(udenData(r.input), /Henriks ønske til mødet: Få rollen afklaret/);
  assert.match(r.instructions, /"forberedelse"/);
  for (const k of ['maal', 'deltagere', 'navn', 'hvem', 'baggrund', 'vil', 'talepunkter', 'opgaver', 'praesentation', 'titel', 'html']) assert.ok(r.instructions.includes(`"${k}"`), k);
  assert.match(r.instructions, /præcis .*json|kun .*json/i);
  assert.match(r.instructions, /gæt/i);
  assert.match(r.instructions, /systemskrifttyper/);
  assert.match(r.instructions, /ingen scripts|uden scripts/i);
  assert.match(r.input, /Pitch til Tom/);
  assert.match(r.input, /Jonas Holm/);
  assert.match(r.input, /Line Berg/);
  assert.match(r.input, /Få rollen afklaret/);
  assert.match(r.input, /tom@example\.org/, 'the address is there as a lookup aid');
  assert.match(r.instructions, /aldrig en e-?mailadresse som navn/i);
});

test('forbered run: without a wish Hermes is told there is none; a prior preparation is handed back for updating', () => {
  const uden = buildForberedRun(info, state, moede, '', NOW);
  assert.match(uden.input, /ingen|ikke oplyst/i);
  const m2: Moede = { ...moede, forberedelse: { maal: 'Få et ja', deltagere: [], talepunkter: ['Åbn med tallene'], tid: NOW.toISOString() } };
  const igen = buildForberedRun(info, { ...state, moeder: [m2] }, m2, 'kortere', NOW);
  assert.match(seg(igen, 'forberedelse'), /Få et ja/);
  assert.match(seg(igen, 'forberedelse'), /Åbn med tallene/);
  assert.match(igen.instructions, /forberedelse, der allerede ligger/);
});

test('overview chat: marker, the universes, the nytUnivers answer and no element block', () => {
  const indeks = { ...tomtIndeks(), univers: [info, { ...info, id: 'gammel', navn: 'Gammel', arkiveret: NOW.toISOString() }] };
  const r = buildOversigtChatRun(indeks, 'Lav et univers om min arena', undefined, NOW);
  assert.ok(r.instructions.includes(MARKOER.oversigt));
  assert.match(seg(r, 'univers'), /Min arena/);
  assert.doesNotMatch(r.input, /Gammel/, 'archived universes are not offered');
  assert.match(r.instructions, /"nytUnivers"/);
  assert.match(r.instructions, /navn/);
  assert.doesNotMatch(r.instructions, /"elementer"/);
  assert.equal(udenData(r.input), 'Lav et univers om min arena');
  assert.match(seg(buildOversigtChatRun(indeks, 'x', 'Univers: Min arena', NOW), 'element'), /Om: Univers: Min arena/);
});

test('the three markers differ so the dev fake can tell them apart', () => {
  assert.equal(new Set(Object.values(MARKOER)).size, 3);
  const u = buildUniversChatRun(info, state, 'x', undefined, NOW).instructions;
  const f = buildForberedRun(info, state, moede, '', NOW).instructions;
  const o = buildOversigtChatRun(tomtIndeks(), 'x', undefined, NOW).instructions;
  assert.ok(!u.includes(MARKOER.forbered) && !u.includes(MARKOER.oversigt));
  assert.ok(!f.includes(MARKOER.univers) && !f.includes(MARKOER.oversigt));
  assert.ok(!o.includes(MARKOER.univers) && !o.includes(MARKOER.forbered));
});

test('KC-0060: the forbered run asks for one pictogram per talepunkt from the shared list', () => {
  const t = buildForberedRun(info, state, moede, '', NOW).instructions;
  assert.match(t, /"talepunktIkoner": \["<ikon> pr\. talepunkt/);
  assert.match(t, /ét af [^\n]*calendar-clock/);
});

test('Univers prompts go through the shared builder: limits once, zone line', async () => {
  const { GRAENSER } = await import('../../src/agent/prompt.ts');
  for (const t of [
    buildUniversChatRun(info, state, 'x', undefined, NOW).instructions,
    buildForberedRun(info, state, moede, '', NOW).instructions,
    buildOversigtChatRun(tomtIndeks(), 'x', undefined, NOW).instructions,
  ]) {
    assert.equal(t.split(GRAENSER).length - 1, 1);
    assert.match(t, /Zone: privat/);
  }
});

test('Univers: every prompt is Danish byte for byte as before, with no language chosen and with da chosen (KC-0241)', () => {
  const navne = navneMed('univers-');
  assert.ok(navne.length >= 7, String(navne.length));
  for (const n of navne) {
    assert.equal(samlet(PROMPTER[n]!()), golden(n), n);
    assert.equal(samlet(medSprog('da', PROMPTER[n]!)), golden(n), `${n} (da chosen)`);
  }
});

// ---------- KC-0241: the language of the prompt ----------

import { DANSK, ensStrenge, form, tomme } from '../fixtures/sprog-tjek.ts';
import { egenTekst, egneDanskeLinjer, jsonNoegler, pak, struktur, utenData } from '../fixtures/sprog-golden-prompt-rum-b.ts';
import { UNIVERS_PROMPT } from '../../src/rooms/univers/prompt-tekster.ts';

const tabel = (t: unknown): Record<string, unknown> => t as Record<string, unknown>;
/** Strings that are the same in both languages on purpose (a name, or a word English borrows). */
const ENS = new Set<string>([]);
const en = (navn: string): { instructions: string; input: string } => medSprog('en', PROMPTER[navn]!);
const da = (navn: string): { instructions: string; input: string } => PROMPTER[navn]!();

test('Univers: English has exactly Danish\'s keys and shapes; no string is empty; no Danish string copied over', () => {
  assert.deepEqual(form(UNIVERS_PROMPT.en), form(UNIVERS_PROMPT.da));
  for (const t of [UNIVERS_PROMPT.da, UNIVERS_PROMPT.en]) assert.deepEqual(tomme(tabel(t)), []);
  assert.deepEqual(ensStrenge(tabel(UNIVERS_PROMPT.da), tabel(UNIVERS_PROMPT.en)).filter((k) => !ENS.has(k)), []);
});

test('Univers: the Danish detector works: the Danish prompts are full of Danish lines', () => {
  for (const n of navneMed('univers-')) assert.ok(da(n).instructions.split('\n').filter((l) => DANSK.test(l)).length >= 1, n);
});

test('Univers: English has no Danish line in what the room itself writes, in any of its prompts', () => {
  assert.ok(navneMed('univers-').length >= 7);
  for (const n of navneMed('univers-')) assert.deepEqual(egneDanskeLinjer(n), [], n);
});

test('Univers: English keeps what the app parses the answer by (JSON field names, fences, bullets, paragraphs) as in Danish', () => {
  for (const n of navneMed('univers-')) {
    assert.deepEqual(jsonNoegler(en(n).instructions), jsonNoegler(da(n).instructions), n);
    assert.deepEqual(struktur(en(n).instructions), struktur(da(n).instructions), n);
  }
});

import { MARKOER_EN } from '../../src/rooms/univers/prompt.ts';
import { UNIVERS_TEKSTER } from '../../src/rooms/univers/tekster.ts';

test('Univers: the markers of the two languages are the ones in the prompts, and all six differ', () => {
  assert.ok(en('univers-chat').instructions.includes(MARKOER_EN.univers));
  assert.ok(en('univers-forbered').instructions.includes(MARKOER_EN.forbered));
  assert.ok(en('univers-oversigt').instructions.includes(MARKOER_EN.oversigt));
  assert.ok(da('univers-chat').instructions.includes(MARKOER.univers));
  assert.equal(new Set([...Object.values(MARKOER), ...Object.values(MARKOER_EN)]).size, 6);
  assert.deepEqual(Object.keys(MARKOER_EN), Object.keys(MARKOER));
});

test('Univers: the element labels the prompt explains are the room\'s own (tekster.ts), in both languages', () => {
  for (const sprog of ['da', 'en'] as const) {
    const T = UNIVERS_TEKSTER[sprog];
    const dele = [T.elDokument('…'), T.elNote('…'), T.elOpgave('…'), T.elMoede('…')];
    const t = medSprog(sprog, () => PROMPTER['univers-chat']!().instructions);
    for (const d of dele) assert.ok(t.includes(`"${d}"`), `${sprog}: ${d}`);
  }
});

test('Univers: English says "the user", has English dates and words for the universe, the meeting and the tasks', () => {
  const chat = en('univers-chat');
  assert.match(chat.instructions, /^[\s\S]*You are Hermes, the user's agent\. The user writes in English/);
  assert.doesNotMatch(egenTekst('univers-chat'), /Henrik/);
  assert.match(chat.instructions, /It is now \w+,? 27 October 2026/);
  const u = pak(chat.input).find((d) => d.kilde === 'univers')?.tekst ?? '';
  assert.match(u, /^The universe "My arena" — My new leadership role/);
  assert.match(u, /Documents \(newest first; the text is an extract, not the HTML file\):\n- \[doc-aaaa1111\] Pitch \(belongs to the meeting meeting-1\), 1 version\(s\):/);
  assert.match(u, /(?:…|\.\.\.)\[cut\]/);
  assert.match(u, /Tasks:\n- \[task-1\] In progress: Find the numbers — from operations \(for the meeting meeting-1\)\n- \[task-2\] Open: Book the room\n- \[task-3\] Done: Send the invite/);
  assert.match(u, /Meetings:\n- \[meeting-1\] Pitch to Tom, [^\n]*, Room 4\. Participants: Jonas Holm, Line Berg\. Not prepared yet\./);
  assert.match(medSprog('en', () => PROMPTER['univers-chat-kontekst-tomt']!()).input, /^[\s\S]*The universe "My arena"/);
  assert.ok(pak(en('univers-chat-kontekst-tomt').input).some((d) => d.kilde === 'univers' && d.tekst.includes('The universe is still empty: there are no elements.')));
  const f = en('univers-forbered');
  assert.match(utenData(f.input), /^The user's wish for the meeting: A decision on the budget$/);
  const kal = pak(f.input).find((d) => d.kilde === 'kalender')?.tekst ?? '';
  assert.match(kal, /^Meeting: Pitch to Tom\nTime: [^\n]*\nPlace: Room 4\nParticipants: Jonas Holm <jonas@example\.org>, Line Berg$/);
  assert.match(utenData(en('univers-forbered-bar').input), /^The user's wish for the meeting: \(not given\)$/);
  assert.match(pak(en('univers-forbered-bar').input).find((d) => d.kilde === 'kalender')?.tekst ?? '', /Participants: none noted$/);
  const fb = pak(en('univers-forbered-forberedt').input).find((d) => d.kilde === 'forberedelse')?.tekst ?? '';
  assert.match(fb, /^There is already a preparation\.[\s\S]*\n- Goal: Agree the plan\n- Talking points: Status \| Plan\n- Participants: Jonas Holm \(The supplier\)$/);
  assert.match(pak(en('univers-forbered-forberedt-uden-deltagere').input).find((d) => d.kilde === 'forberedelse')?.tekst ?? '', /- Participants: none$/);
  assert.match(en('univers-forbered-forberedt').instructions, /the user's wish for it, the preparation that is already there, and what the user already has/);
  const o = pak(en('univers-oversigt').input).find((d) => d.kilde === 'univers')?.tekst ?? '';
  assert.equal(o, "The user's universes right now:\n- My arena — My new leadership role\n- My arena");
  assert.match(pak(en('univers-oversigt-tom-kontekst').input).find((d) => d.kilde === 'univers')?.tekst ?? '', /\(none yet\)$/);
});
