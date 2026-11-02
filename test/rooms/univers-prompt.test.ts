import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUniversChatRun, buildForberedRun, buildOversigtChatRun, MARKOER } from '../../src/rooms/univers/prompt.ts';
import { tomtIndeks, tomtUnivers, type Moede, type UniversInfo, type UniversState } from '../../src/rooms/univers/schema.ts';
import { udenData, udpak } from '../../src/agent/udtroet.ts';

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
