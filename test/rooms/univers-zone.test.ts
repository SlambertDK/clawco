// KC-0117: zones on the Univers elements Dokument and Note — schema, apply, filter, render, fil().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseUniversSvar, normaliserUnivers, tomtUnivers, SchemaError, type UniversState, type UniversInfo } from '../../src/rooms/univers/schema.ts';
import { anvendElementer, anvendForberedelse, laesUnivers } from '../../src/rooms/univers/lager.ts';
import { synligUnivers, synligUniversLog, universRoom } from '../../src/rooms/univers/room.ts';
import { renderUnivers } from '../../src/rooms/univers/render.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import type { RoomDeps } from '../../src/rooms/module.ts';
import type { Person } from '../../src/identitet/husstand.ts';
import type { LogEntry } from '../../src/store/types.ts';

const NOW = new Date('2026-10-27T10:00:00Z');
const info: UniversInfo = { id: 'arena', navn: 'Arena', om: '', oprettet: '2026-10-01T08:00:00Z' };
const henrik: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const medlem: Person = { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' };
const gaest: Person = { id: 'gus', login: null, navn: 'Gus', rolle: 'gaest' };
const nyId = (prefix: string): string => `${prefix}-x${++teller}`;
let teller = 0;

test('a document and a note without zone are stored privat; an opgave is untouched', () => {
  const r = parseUniversSvar({ elementer: [
    { type: 'dokument', titel: 'D', html: '<p>x</p>' },
    { type: 'note', titel: 'N', tekst: 't' },
    { type: 'opgave', titel: 'O' },
  ] });
  assert.equal(r[0]?.type === 'dokument' && r[0].zone, 'privat');
  assert.equal(r[1]?.type === 'note' && r[1].zone, 'privat');
  assert.equal(r[2] && 'zone' in r[2], false);
});

test('a document or note with an unknown zone, or another zone than the run read, is rejected as a schema error', () => {
  for (const zone of ['firma', 'arbejde', 'husstand']) {
    assert.throws(() => parseUniversSvar({ elementer: [{ type: 'dokument', titel: 'D', html: '<p>x</p>', zone }] }), SchemaError, zone);
    assert.throws(() => parseUniversSvar({ elementer: [{ type: 'note', titel: 'N', tekst: 't', zone }] }), SchemaError, zone);
  }
});

test('new documents and notes made by anvendElementer and anvendForberedelse carry zone privat', () => {
  const els = parseUniversSvar({ elementer: [{ type: 'dokument', titel: 'D', html: '<p>x</p>' }, { type: 'note', titel: 'N', tekst: 't' }] });
  const { state } = anvendElementer(tomtUnivers(), els, NOW, nyId);
  assert.equal(state.dokumenter[0]?.zone, 'privat');
  assert.equal(state.noter[0]?.zone, 'privat');
  const s0: UniversState = { ...tomtUnivers(), moeder: [{ id: 'm1', kilde: 'manuel', titel: 'M', start: NOW.toISOString(), slut: NOW.toISOString(), deltagere: [] }] };
  const f = anvendForberedelse(s0, 'm1', { maal: 'x', deltagere: [], talepunkter: ['a'], opgaver: [], praesentation: { titel: 'P', html: '<p>p</p>' } }, NOW, nyId);
  assert.equal(f.state.dokumenter[0]?.zone, 'privat');
});

test('updating an existing document keeps its zone and ejer; an id in another zone than the run read mints a new element', () => {
  const s0: UniversState = { ...tomtUnivers(), dokumenter: [{ id: 'dok-h', titel: 'Fælles', html: '<p>a</p>', tekst: 'a', versioner: [], oprettet: 't', aendret: 't', zone: 'husstand' }, { id: 'dok-p', titel: 'Min', html: '<p>a</p>', tekst: 'a', versioner: [], oprettet: 't', aendret: 't', zone: 'privat', ejer: 'henrik' }] };
  const els = parseUniversSvar({ elementer: [{ type: 'dokument', id: 'dok-h', titel: 'Ny', html: '<p>b</p>' }, { type: 'dokument', id: 'dok-p', titel: 'Min2', html: '<p>b</p>' }] });
  const { state } = anvendElementer(s0, els, NOW, nyId);
  assert.equal(state.dokumenter.find((d) => d.id === 'dok-h')?.titel, 'Fælles', 'the husstand document is not overwritten by a privat run');
  assert.equal(state.dokumenter.length, 3);
  assert.equal(state.dokumenter.find((d) => d.id === 'dok-p')?.ejer, 'henrik');
});

test('old stored state without zone is read as-is (absent stays absent)', () => {
  const s = normaliserUnivers({ dokumenter: [{ id: 'dok-1', titel: 'Gammel', html: '', tekst: '', oprettet: 't', aendret: 't' }], noter: [{ id: 'note-1', titel: 'G', tekst: 't', oprettet: 't' }] });
  assert.equal('zone' in (s.dokumenter[0] ?? {}), false);
  assert.equal('zone' in (s.noter[0] ?? {}), false);
});

const dok = (id: string, titel: string, extra: object = {}) => ({ id, titel, html: `<p>${titel}</p>`, tekst: titel, versioner: [], oprettet: '2026-10-26T08:00:00Z', aendret: '2026-10-26T09:00:00Z', ...extra });
const note = (id: string, titel: string, extra: object = {}) => ({ id, titel, tekst: 'tekst', oprettet: '2026-10-26T08:00:00Z', ...extra });
const state: UniversState = {
  ...tomtUnivers(),
  dokumenter: [dok('dok-1', 'Mit dokument', { zone: 'privat' }), dok('dok-2', 'Andens dokument', { zone: 'privat', ejer: 'anden' }), dok('dok-3', 'Fælles dokument', { zone: 'husstand' }), dok('dok-4', 'Gammelt dokument')],
  noter: [note('note-1', 'Min note', { zone: 'privat' }), note('note-2', 'Andens note', { zone: 'privat', ejer: 'anden' }), note('note-3', 'Fælles note', { zone: 'husstand' })],
};
const dokTitler = (s: UniversState): string[] => s.dokumenter.map((d) => d.titel);

test('synligUnivers drops documents and notes the person may not see (old ones without zone belong to the owner)', () => {
  assert.deepEqual(dokTitler(synligUnivers(state, henrik)), ['Mit dokument', 'Fælles dokument', 'Gammelt dokument']);
  assert.deepEqual(synligUnivers(state, henrik).noter.map((n) => n.titel), ['Min note', 'Fælles note']);
  assert.deepEqual(dokTitler(synligUnivers(state, medlem)), ['Fælles dokument']);
  assert.deepEqual(synligUnivers(state, medlem).noter.map((n) => n.titel), ['Fælles note']);
  assert.deepEqual(dokTitler(synligUnivers(state, gaest)), []);
  assert.deepEqual(synligUnivers(state, gaest).noter, []);
});

test('a foreign privat document and note are absent from the rendered page; husstand shows for a member only', () => {
  const vis = (p: Person): string => String(renderUnivers(info, synligUnivers(state, p), NOW));
  assert.doesNotMatch(vis(henrik), /Andens (dokument|note)/);
  assert.match(vis(henrik), /Mit dokument/);
  assert.match(vis(medlem), /Fælles dokument/);
  assert.match(vis(medlem), /Fælles note/);
  assert.doesNotMatch(vis(gaest), /Fælles (dokument|note)/);
});

test('document cards and note cards carry data-datazone and a zone chip', () => {
  const out = String(renderUnivers(info, synligUnivers(state, henrik), NOW));
  assert.match(out, /<article[^>]*class="card uv-dok"[^>]* data-datazone="privat"/);
  assert.match(out, /<article[^>]*class="card uv-dok"[^>]* data-datazone="husstand"/);
  assert.match(out, /<article[^>]*class="card"[^>]* data-element="Note: Min note"[^>]* data-datazone="privat"/);
  assert.match(out, /zone-chip/);
});

test('log lines carry data-datazone, and a foreign line is dropped', () => {
  const log: LogEntry[] = [
    { id: 'l1', tid: NOW.toISOString(), kilde: 'hermes', tekst: 'Min linje', zone: 'privat' },
    { id: 'l2', tid: NOW.toISOString(), kilde: 'hermes', tekst: 'Fremmed linje', zone: 'privat', ejer: 'anden' },
  ];
  const out = String(renderUnivers(info, synligUnivers(state, henrik), NOW, { log: synligUniversLog(log, henrik) }));
  assert.match(out, /class="row log-row"[^>]* data-datazone="privat"/);
  assert.doesNotMatch(out, /Fremmed linje/);
});

test('fil() hands out a document to a person who may see it, and null for one who may not', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-uv-zone-'));
  try {
    const store = createFileStore(dir);
    await store.writeState('univers', { univers: [info], nyeMoeder: [], skjulteMoeder: [] });
    await store.writeState('univers-arena', state);
    const deps = (person: Person): RoomDeps => ({ store, person, now: () => NOW }) as unknown as RoomDeps;
    const rum = universRoom('arena');
    assert.ok(await rum.fil?.(deps(henrik), 'dok-1.html'));
    assert.equal(await rum.fil?.(deps(henrik), 'dok-2.html'), null);
    assert.ok(await rum.fil?.(deps(medlem), 'dok-3.html'));
    assert.equal(await rum.fil?.(deps(gaest), 'dok-3.html'), null);
    assert.equal(await rum.fil?.(deps(medlem), 'dok-1.html'), null);
    assert.equal((await laesUnivers(store, 'arena')).dokumenter.length, 4, 'reading does not write');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
