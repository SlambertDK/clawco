// KC-0138: opt-in per conversation. Nothing is read until the user picks a zone for a conversation on the card;
// every choice starts at "Læs ikke" (groups too); the card's list carries no message text and no raw ids.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { felter, IKKE, nytValg, samtaleNoegle, samtaler, valgte } from '../../../src/kilder/beskeder/valg.ts';
import type { RaaBesked } from '../../../src/kilder/beskeder/jsonl.ts';

const raa = (o: Partial<RaaBesked>): RaaBesked => ({ kanal: 'signal', samtale: '+4512345678', gruppe: false, afsender: '+4512345678', tid: '2026-11-01T08:00:00.000Z', tekst: 'Hej', ...o });

test('the key is stable per channel and conversation and never shows the raw id', () => {
  const k = samtaleNoegle('signal', '+4512345678');
  assert.match(k, /^s-[0-9a-f]{12}$/);
  assert.equal(samtaleNoegle('signal', '+4512345678'), k);
  assert.notEqual(samtaleNoegle('telegram', '+4512345678'), k);
  assert.ok(!k.includes('4512345678'));
});

test('only conversations given a zone are chosen; "Læs ikke", junk and unknown keys are not', () => {
  const k = samtaleNoegle('signal', 'a');
  const m = valgte({ [k]: 'husstand', [samtaleNoegle('signal', 'b')]: IKKE, [samtaleNoegle('signal', 'c')]: 'offentlig', dage: '14', andet: 'privat' });
  assert.deepEqual([...m], [[k, 'husstand']]);
  assert.equal(valgte({}).size, 0);
});

test('samtaler lists each conversation once with its latest name and count, never its text', () => {
  const liste = samtaler([
    raa({ tekst: 'hemmelig', samtaleNavn: 'Maja' }),
    raa({ tekst: 'mere', tid: '2026-11-01T09:00:00.000Z', samtaleNavn: 'Maja M' }),
    raa({ kanal: 'telegram', samtale: '-100', gruppe: true, afsender: '7', samtaleNavn: 'Familien' }),
  ]);
  assert.equal(liste.length, 2);
  const maja = liste.find((s) => s.kanal === 'signal');
  assert.deepEqual(maja && { navn: maja.navn, antal: maja.antal, gruppe: maja.gruppe, sidst: maja.sidst }, { navn: 'Maja M', antal: 2, gruppe: false, sidst: '2026-11-01T09:00:00.000Z' });
  assert.ok(!JSON.stringify(liste).includes('hemmelig'));
  assert.ok(!JSON.stringify(liste).includes('4512345678'));
});

test('a conversation without a name is named by its kind and channel, not its number', () => {
  const [s] = samtaler([raa({})]);
  assert.equal(s?.navn, 'Samtale på Signal');
  const [g] = samtaler([raa({ gruppe: true, samtale: 'g1' })]);
  assert.equal(g?.navn, 'Gruppe på Signal');
});

test('felter: one select per conversation, "Læs ikke" first so a group (and everything else) starts off', () => {
  const liste = samtaler([raa({ samtaleNavn: 'Maja' }), raa({ gruppe: true, samtale: 'g1', samtaleNavn: 'Familien' })]);
  const f = felter(liste);
  assert.equal(f.length, 2);
  for (const x of f) {
    assert.equal(x.muligheder?.[0]?.vaerdi, IKKE);
    assert.deepEqual(x.muligheder?.map((m) => m.vaerdi), [IKKE, 'privat', 'arbejde', 'husstand']);
    assert.equal(x.paakraevet, false);
    assert.match(x.navn, /^s-[0-9a-f]{12}$/);
  }
  assert.match(f.find((x) => x.etiket.includes('Familien'))?.etiket ?? '', /gruppe/);
});

test('a one-to-one conversation without its own name is named by the sender’s display name (never an id)', () => {
  assert.equal(samtaler([raa({ afsenderNavn: 'Ella' })])[0]?.navn, 'Ella');
  assert.equal(samtaler([raa({ afsenderNavn: '+45 12 34 56 78' })])[0]?.navn, 'Samtale på Signal');
  assert.equal(samtaler([raa({ gruppe: true, samtale: 'g', afsenderNavn: 'Søren' })])[0]?.navn, 'Gruppe på Signal');
});

// KC-0224: the chosen set after a change made after the connection.
test('nytValg: a chosen conversation keeps its zone, a new one gets the standard zone, an un-chosen one is gone, an unknown key is refused', () => {
  const liste = samtaler([raa({ samtale: 'a' }), raa({ samtale: 'b' }), raa({ samtale: 'c' })]);
  const [a, b, c] = ['a', 'b', 'c'].map((x) => samtaleNoegle('signal', x)) as [string, string, string];
  const foer = new Map([[a, 'husstand' as const], [b, 'arbejde' as const]]);
  assert.deepEqual([...(nytValg(liste, foer, [a, c], 'privat') ?? [])].sort(), [[a, 'husstand'], [c, 'privat']].sort());
  assert.deepEqual([...(nytValg(liste, foer, [], 'privat') ?? [])], []);
  assert.deepEqual([...(nytValg(liste, foer, [c, c], 'privat') ?? [])], [[c, 'privat']], 'a repeat is one');
  assert.equal(nytValg(liste, foer, [a, 's-000000000000'], 'privat'), null);
  assert.deepEqual([...foer.keys()], [a, b], 'the old choice is not mutated');
});
