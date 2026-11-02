import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNytDokument, parseForslag, tomtState, dokumentTilMarkdown, type SkriveState } from '../../src/rooms/skrive/schema.ts';
import { SchemaError } from '../../src/rooms/dagen/schema.ts';

const NOW = new Date('2026-10-27T10:00:00Z');

test('parseNytDokument turns Hermes answer into a document with stable paragraph ids', () => {
  const d = parseNytDokument({ titel: 'Udkast til driften', afsnit: ['Første afsnit.', '', 'Andet afsnit.'], kilder: ['Eksempel Energi-rapport', 42] }, { brief: 'Kort mail til driften' }, NOW);
  assert.match(d.id, /^dok-/);
  assert.equal(d.titel, 'Udkast til driften');
  assert.deepEqual(d.afsnit.map((a) => a.tekst), ['Første afsnit.', 'Andet afsnit.']);
  assert.deepEqual(d.afsnit.map((a) => a.id), ['a1', 'a2']);
  assert.deepEqual(d.kilder, ['Eksempel Energi-rapport']);
  assert.equal(d.brief, 'Kort mail til driften');
  assert.equal(d.oprettet, NOW.toISOString());
});

test('parseNytDokument rejects an answer without paragraphs and falls back to the brief as title', () => {
  assert.throws(() => parseNytDokument({ titel: 'x', afsnit: [] }, { brief: 'b' }, NOW), SchemaError);
  assert.equal(parseNytDokument({ afsnit: ['a'] }, { brief: 'Takkemail til Tom' }, NOW).titel, 'Takkemail til Tom');
});

test('parseForslag keeps at most three proposals that point at existing paragraphs or add a new one', () => {
  const dok = parseNytDokument({ titel: 't', afsnit: ['a', 'b'] }, { brief: 'x' }, NOW);
  const f = parseForslag({ forslag: [
    { afsnitId: 'a2', ny: 'B strammet.', hvorfor: 'kortere' },
    { afsnitId: 'nope', ny: 'ignoreres', hvorfor: '' },
    { afsnitId: null, efterId: 'a2', ny: 'Nyt afsnit.', hvorfor: 'mangler afslutning' },
    { afsnitId: 'a1', ny: 'A1.', hvorfor: '' }, { afsnitId: 'a1', ny: 'A2.', hvorfor: '' },
  ] }, dok, NOW);
  assert.equal(f.length, 3);
  assert.equal(f[0]?.afsnitId, 'a2');
  assert.equal(f[1]?.afsnitId, null);
  assert.equal(f[1]?.efterId, 'a2');
  assert.match(f[0]?.id ?? '', /^f-/);
  assert.equal(f[0]?.dokId, dok.id);
});

test('parseForslag rejects an answer with no usable proposals', () => {
  const dok = parseNytDokument({ titel: 't', afsnit: ['a'] }, { brief: 'x' }, NOW);
  assert.throws(() => parseForslag({ forslag: [{ afsnitId: 'zz', ny: 'x', hvorfor: '' }] }, dok, NOW), SchemaError);
});

test('dokumentTilMarkdown renders title, paragraphs and sources', () => {
  const dok = parseNytDokument({ titel: 'Titel <1>', afsnit: ['Første.', 'Andet.'], kilder: ['K1'] }, { brief: 'x' }, NOW);
  const md = dokumentTilMarkdown(dok);
  assert.match(md, /^# Titel <1>\n\nFørste\.\n\nAndet\.\n/);
  assert.match(md, /\n## Kilder\n- K1\n/);
});

test('tomtState has no documents and a status', () => {
  const s: SkriveState = tomtState();
  assert.deepEqual(s.dokumenter, []);
  assert.equal(s.aktivt, null);
  assert.ok(s.hermesStatus);
});

// KC-0242: the messages this room's answer parser sends back to Hermes follow the language of the run.
import { SKRIVE_PROMPT } from '../../src/rooms/skrive/prompt-tekster.ts';
import { form, tomme, ensStrenge } from '../fixtures/sprog-tjek.ts';

test('KC-0242: the room has an English `fejl` table with exactly the Danish keys, no empty text and no Danish copy', () => {
  const { da, en } = { da: SKRIVE_PROMPT.da.fejl, en: SKRIVE_PROMPT.en.fejl };
  assert.ok(da && Object.keys(da).length > 0);
  assert.deepEqual(form(en), form(da));
  assert.deepEqual(tomme(en as never), []);
  assert.deepEqual(ensStrenge(da as never, en as never), []);
});
