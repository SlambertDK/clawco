import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNyhederState, alleNyheder, type NyhederState } from '../../src/rooms/nyheder/schema.ts';
import { SchemaError } from '../../src/rooms/dagen/schema.ts';

const NOW = new Date('2026-10-27T07:10:00Z');
const facts = { nyhedsbreve: [{ mailId: '7', emne: 'Ugens energinyt', fra: 'Eksempel Energi' }], kilder: { antal: 25, medNyheder: 9, nyheder: 39, fejlede: ['r/LocalLLaMA'] } };
const valid = {
  femLinjer: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'],
  baner: [
    { navn: 'AI og agenter', nyheder: [{ titel: 'GPT-6.1 Terra', hvorfor: 'Relevant for Hermes på kira-home.', kilde: 'Simon Willison', url: 'https://example.org/gpt' }, { titel: 'Uden url', hvorfor: 'x' }] },
    { navn: 'Tom bane', nyheder: [] },
    { navn: 'Forskning', nyheder: Array.from({ length: 7 }, (_, i) => ({ titel: `P${i}`, hvorfor: 'h', url: `https://example.org/${i}` })) },
  ],
  forslag: [{ tekst: 'Skal jeg lave et testrum til agent-nyheder?', handling: { label: 'Ja, lav testrum', instruktion: 'Opret …', fortryd: 'Slet …' } }, { tekst: 'Uden handling' }],
  hermesStatus: 'Følger AI-nyheder',
};

test('parseNyhederState validates lanes, caps five lines and five items per lane, drops empty lanes and gives items ids', () => {
  const s = parseNyhederState(valid, facts, NOW);
  assert.equal(s.femLinjer.length, 5);
  assert.deepEqual(s.baner.map((b) => b.navn), ['AI og agenter', 'Forskning']);
  assert.equal(s.baner[1]?.nyheder.length, 5);
  assert.equal(s.baner[0]?.nyheder[0]?.id, 'n1');
  assert.equal(s.baner[1]?.nyheder[0]?.id, 'n3');
  assert.equal(s.baner[0]?.nyheder[1]?.url, undefined);
  assert.deepEqual(s.kilder, facts.kilder);
  assert.equal(s.nyhedsbreve[0]?.emne, 'Ugens energinyt');
  assert.equal(s.forslag.length, 2);
  assert.match(s.forslag[0]?.handling?.id ?? '', /^forslag-1-/);
  assert.equal(s.dato, '2026-10-27');
});

test('parseNyhederState rejects an answer without lanes or lines', () => {
  assert.throws(() => parseNyhederState({ ...valid, baner: [] }, facts, NOW), SchemaError);
  assert.throws(() => parseNyhederState({ ...valid, femLinjer: [] }, facts, NOW), SchemaError);
});

test('parseNyhederState keeps gemt ids from the previous state only when the url still exists', () => {
  const prev: NyhederState = parseNyhederState(valid, facts, NOW);
  prev.gemt = ['n1', 'n99'];
  const s = parseNyhederState(valid, facts, NOW, prev);
  assert.deepEqual(s.gemt, ['n1']);
});

test('alleNyheder flattens lanes by id', () => {
  const s = parseNyhederState(valid, facts, NOW);
  assert.equal(alleNyheder(s).get('n1')?.titel, 'GPT-6.1 Terra');
});

test('parseNyhederState keeps up to three relevans notes per item with known keys only', () => {
  const raw = { ...valid, baner: [{ navn: 'X', nyheder: [{ titel: 'T', hvorfor: 'h', relevans: [
    { for: 'arbejde', note: 'Rammer Eksempel Energis reserver.' }, { for: 'familie', note: 'Ingen' }, { for: 'ukendt', note: 'x' }, { for: 'danmark', note: 'Elpriser.' }, { for: 'holdning', note: 'Statslig styring.' }, { for: 'mig', note: 'for mange' },
  ] }] }] };
  const s = parseNyhederState(raw, facts, NOW);
  assert.deepEqual(s.baner[0]?.nyheder[0]?.relevans, [
    { for: 'arbejde', note: 'Rammer Eksempel Energis reserver.' }, { for: 'familie', note: 'Ingen' }, { for: 'danmark', note: 'Elpriser.' },
  ]);
  assert.equal(parseNyhederState(valid, facts, NOW).baner[0]?.nyheder[0]?.relevans, undefined);
});
