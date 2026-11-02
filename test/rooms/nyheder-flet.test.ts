// KC-0137: Nyheder builds from the morning paper and from the user's own feeds together.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flettNyheder, MAX_NYHEDER, type RaaNyhed, type TrimmedNyheder } from '../../src/rooms/nyheder/source.ts';

const NU = new Date('2026-11-01T07:10:00Z');
const ny = (titel: string, kilde: string, udgivet?: string, url?: string): RaaNyhed => ({ titel, kilde, ...(url ? { url } : {}), ...(udgivet ? { udgivet } : {}) });
const papir: TrimmedNyheder = { dato: '2026-11-01', nyheder: [ny('Papir 1', 'Avisen', '2026-11-01T05:00:00Z', 'https://p.example/1'), ny('Papir 2', 'Avisen', '2026-10-31T05:00:00Z')], kilder: { antal: 2, medNyheder: 1, nyheder: 2, fejlede: ['Død kilde'] } };
const rss = { nyheder: [ny('Rss 1', 'Min feed', '2026-11-01T06:00:00Z', 'https://r.example/1'), ny('Papir 1 igen', 'Min feed', '2026-11-01T04:00:00Z', 'https://p.example/1')], kilder: { antal: 3, medNyheder: 2, nyheder: 2, fejlede: ['Stum feed'] } };

test('nothing from either side is null (the old "ask Hermes to fetch" path stays)', () => {
  assert.equal(flettNyheder(null, null, NU), null);
});

test('only the paper: unchanged', () => {
  assert.equal(flettNyheder(papir, null, NU), papir);
});

test('only the feeds: the paper-shaped answer with today\'s Copenhagen date', () => {
  assert.deepEqual(flettNyheder(null, rss, NU), { dato: '2026-11-01', nyheder: rss.nyheder, kilder: rss.kilder });
});

test('both: newest first, one line per link, sources counted together with every name that failed', () => {
  const t = flettNyheder(papir, rss, NU);
  assert.ok(t);
  assert.deepEqual(t.nyheder.map((n) => n.titel), ['Rss 1', 'Papir 1', 'Papir 2']);
  assert.deepEqual(t.kilder, { antal: 5, medNyheder: 3, nyheder: 3, fejlede: ['Død kilde', 'Stum feed'] });
  assert.equal(t.dato, '2026-11-01');
});

test('the merged list is capped like the paper', () => {
  const mange = Array.from({ length: 120 }, (_, i) => ny(`R${i}`, 'F', new Date(Date.UTC(2026, 10, 1) - i * 60_000).toISOString(), `https://r.example/${i}`));
  const t = flettNyheder(papir, { nyheder: mange, kilder: { antal: 1, medNyheder: 1, nyheder: 120, fejlede: [] } }, NU);
  assert.equal(t?.nyheder.length, MAX_NYHEDER);
  assert.equal(MAX_NYHEDER, 80);
  assert.equal(t?.kilder.nyheder, 122);
});
