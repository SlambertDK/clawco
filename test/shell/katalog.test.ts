// KC-0119: the seven blocks as one catalog — the renderers, the prompt and the
// schema offer the same set (the built blocks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { BLOKKE, BYGGET, VISUEL_FELT, katalogTekst, passer, tilJsonSkema } from '../../src/shell/katalog.ts';
import { BILLEDER, TONER, ZONER } from '../../src/shell/visuel.ts';
import { IKONER } from '../../src/shell/ikoner.ts';
import { TILSTANDE } from '../../src/hushold/foresp.ts';
import { byggPrompt } from '../../src/agent/prompt.ts';
import { medSprog } from '../../src/store/sprog.ts';

const SRC = new URL('../../src/', import.meta.url).pathname;
const filer = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? filer(p) : p.endsWith('.ts') ? [p] : []; });
/** Every block a renderer draws: the data-blok markers in src/ (the test world's coverage list does not count). */
const tegnet = new Set(filer(SRC).filter((f) => !f.includes('testtilstand')).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/data-blok="([a-z]+)"/g)].map((m) => m[1]!)));

test('KC-0119: the catalog is exactly the seven blocks, each fully described', () => {
  assert.deepEqual(BLOKKE.map((b) => b.id), ['kort', 'beslutning', 'bunke', 'ordnet', 'samtale', 'forespoergsel', 'ressource']);
  for (const b of BLOKKE) {
    assert.ok(b.navn && b.formaal && b.anatomi, b.id);
    assert.ok(b.status === 'bygget' || b.status === 'defineret', b.id);
    assert.equal(b.felter.type, 'object', b.id);
    assert.ok(b.eksempel !== undefined, `${b.id} has an example`);
  }
  assert.deepEqual(BLOKKE.filter((b) => b.status === 'defineret').map((b) => b.id), [], 'KC-0150 built the last defined block, ressource');
});

test('KC-0119: what the renderers draw is exactly the built blocks', () => {
  assert.deepEqual([...tegnet].sort(), [...BYGGET].sort());
});

test('KC-0119: the visual field takes its enums from the code\'s own lists', () => {
  const p = VISUEL_FELT.properties;
  assert.deepEqual(p.ikon.enum, Object.keys(IKONER));
  assert.deepEqual(p.tone.enum, [...TONER]);
  assert.deepEqual(p.billede.properties.art.enum, [...BILLEDER]);
  assert.deepEqual(p.billede.properties.zoner.items.properties.slags.enum, [...ZONER]);
  assert.deepEqual(BLOKKE.find((b) => b.id === 'forespoergsel')?.felter.properties?.['tilstand']?.enum, [...TILSTANDE]); // KC-0149
});

test('KC-0119: the JSON Schema survives a JSON round trip and every example passes its own schema', () => {
  const s = tilJsonSkema();
  assert.equal(s.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  for (const b of BLOKKE) assert.ok(passer(s.$defs[b.id], b.eksempel, s), `${b.id}: its example passes`);
  assert.ok(!passer(s.$defs['kort'], { titel: 7 }, s), 'a wrong type fails');
  assert.ok(!passer(VISUEL_FELT, { ikon: 'ingen-saadan' }, s), 'an unknown icon fails');
});

test('KC-0119: the prompt offers the built blocks and never the defined ones', () => {
  const tekst = katalogTekst();
  for (const b of BLOKKE) assert.equal(tekst.includes(`- ${b.id}:`), b.status === 'bygget', b.id);
  const { instructions } = byggPrompt({ rum: 'hjem', zone: 'privat', opgave: 'Opgave.', katalog: true, data: [] });
  assert.ok(instructions.includes(tekst));
  assert.match(instructions, /- ressource:/, 'KC-0150: ressource is built, so the prompt offers it');
});

// KC-0241: the catalog section of a prompt in the language of the run; ids and field names stay.
test('katalogTekst: English lists the same built blocks by id, with English purposes', () => {
  const da = katalogTekst();
  const en = medSprog('en', () => katalogTekst());
  const ider = (t: string): string[] => [...t.matchAll(/^- (\w+): /gm)].map((m) => m[1]!).filter((i) => BYGGET.includes(i as never));
  assert.deepEqual(ider(en), ider(da));
  assert.ok(ider(en).length >= BYGGET.length);
  assert.match(en, /^The building blocks \(only these exist on the screen\):/);
  assert.match(en, /The field "visuel":/);
  assert.match(da, /^Byggeklodserne \(kun disse findes på skærmen\):/);
});
