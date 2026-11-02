import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileStore } from '../../src/store/fileStore.ts';
import {
  slug, laesIndeks, opretUnivers, arkiverUnivers, laesUnivers, endreUnivers, endreIndeks, universRum,
  anvendElementer, fortrydElementer, parseFortryd, saetOpgaveStatus, tilfoejMoede, anvendForberedelse,
  placerMoede, skjulMoede, flettKandidater, placerMoedeIUnivers, universStat, moedeFraKandidat, nytMoedeFraInput,
} from '../../src/rooms/univers/lager.ts';
import { tomtUnivers, tomtIndeks, SchemaError, type UniversState, type Moede, type MoedeKandidat, type IdPrefix } from '../../src/rooms/univers/schema.ts';

const NOW = new Date('2026-10-27T10:00:00Z');
const LATER = new Date('2026-10-27T11:00:00Z');
function taeller(): (p: IdPrefix) => string {
  let n = 0;
  return (p) => `${p}-${String(++n).padStart(8, '0')}`;
}
const moede = (over: Partial<Moede> = {}): Moede => ({ id: 'moede-1', kilde: 'manuel', titel: 'Arena', start: '2026-10-27T12:00:00Z', slut: '2026-10-27T13:00:00Z', deltagere: [], ...over });

// ---------- slug ----------

test('slug maps Danish letters, strips the rest and stays within 30 characters', () => {
  assert.equal(slug('Min Arena'), 'min-arena');
  assert.equal(slug('Børn & Søen på Ærø'), 'boern-soeen-paa-aeroe');
  assert.equal(slug('  Café  Ørsted!! '), 'cafe-oersted');
  assert.equal(slug('!!!'), 'univers');
  assert.ok(slug('a'.repeat(100)).length <= 30);
  assert.ok(`univers-${slug('a'.repeat(100))}`.length <= 40);
});

test('slug is unique against existing ones by numeric suffix, still within the limit', () => {
  assert.equal(slug('Arena', ['arena']), 'arena-2');
  assert.equal(slug('Arena', ['arena', 'arena-2']), 'arena-3');
  const lang = 'b'.repeat(30);
  const s = slug(lang, [lang]);
  assert.equal(s.length, 30);
  assert.ok(s.endsWith('-2'));
});

// ---------- store ----------

async function medStore(fn: (store: ReturnType<typeof createFileStore>) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'univers-'));
  try { await fn(createFileStore(dir)); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('opretUnivers writes the index entry and an empty state; the slug is unique; archive hides it', async () => {
  await medStore(async (store) => {
    assert.deepEqual(await laesIndeks(store), tomtIndeks());
    const a = await opretUnivers(store, { navn: 'Min arena', om: 'Lederrollen' }, NOW);
    const b = await opretUnivers(store, { navn: 'Min arena', om: 'Igen' }, NOW);
    assert.equal(a.id, 'min-arena');
    assert.equal(b.id, 'min-arena-2');
    assert.equal(a.oprettet, NOW.toISOString());
    assert.deepEqual(await laesUnivers(store, 'min-arena'), tomtUnivers());
    assert.notEqual(await store.readState(universRum('min-arena')), null);
    assert.equal((await laesIndeks(store)).univers.length, 2);
    const arkiveret = await arkiverUnivers(store, 'min-arena', LATER);
    assert.equal(arkiveret?.arkiveret, LATER.toISOString());
    assert.equal((await laesIndeks(store)).univers.find((u) => u.id === 'min-arena')?.arkiveret, LATER.toISOString());
    assert.equal(await arkiverUnivers(store, 'findes-ikke', LATER), null);
    // an archived slug is still taken
    assert.equal((await opretUnivers(store, { navn: 'Min arena', om: '' }, NOW)).id, 'min-arena-3');
    await assert.rejects(opretUnivers(store, { navn: '  ', om: '' }, NOW), SchemaError);
  });
});

test('endreUnivers serialises overlapping writes per room, so no change is lost; a throw blocks nothing', async () => {
  await medStore(async (store) => {
    await opretUnivers(store, { navn: 'X', om: '' }, NOW);
    const rum = universRum('x');
    const slaa = (n: number) => endreUnivers(store, rum, async (s) => {
      await new Promise((r) => setTimeout(r, 5 - n));
      return { ...s, noter: [...s.noter, { id: `n${n}`, titel: String(n), tekst: '', oprettet: 't' }] };
    });
    await Promise.all([slaa(0), slaa(1), slaa(2), slaa(3)]);
    assert.equal((await laesUnivers(store, 'x')).noter.length, 4);
    await assert.rejects(endreUnivers(store, rum, () => { throw new Error('boom'); }), /boom/);
    await endreUnivers(store, rum, (s) => ({ ...s, noter: [] }));
    assert.equal((await laesUnivers(store, 'x')).noter.length, 0);
    // returning the same object writes nothing but still resolves
    const foer = await laesUnivers(store, 'x');
    const r = await endreUnivers(store, rum, (s) => s);
    assert.deepEqual(r, foer);
    await assert.rejects(endreUnivers(store, 'hjem', (s) => s), /univers/);
  });
});

test('endreIndeks shares the lock discipline for the index', async () => {
  await medStore(async (store) => {
    await Promise.all([1, 2, 3].map((n) => endreIndeks(store, async (i) => {
      await new Promise((r) => setTimeout(r, 4 - n));
      return { ...i, skjulteMoeder: [...i.skjulteMoeder, `e${n}`] };
    })));
    assert.equal((await laesIndeks(store)).skjulteMoeder.length, 3);
  });
});

test('placerMoedeIUnivers moves a candidate from the index into the universe, idempotently', async () => {
  await medStore(async (store) => {
    await opretUnivers(store, { navn: 'Arena', om: '' }, NOW);
    const k: MoedeKandidat = { eventId: 'ev1', titel: 'Kickoff', start: '2026-10-28T08:00:00Z', slut: '2026-10-28T09:00:00Z', deltagere: [{ navn: 'Tom' }] };
    await endreIndeks(store, (i) => flettKandidater(i, [k], []));
    const m = await placerMoedeIUnivers(store, 'ev1', 'arena', taeller());
    assert.equal(m?.titel, 'Kickoff');
    assert.equal(m?.kilde, 'kalender');
    assert.equal(m?.eventId, 'ev1');
    assert.equal((await laesIndeks(store)).nyeMoeder.length, 0);
    assert.equal((await laesUnivers(store, 'arena')).moeder.length, 1);
    assert.equal(await placerMoedeIUnivers(store, 'ev1', 'arena', taeller()), null);
    assert.equal(await placerMoedeIUnivers(store, 'ev1', 'findes-ikke', taeller()), null);
  });
});

// ---------- element ops ----------

test('anvendElementer adds elements with fresh ids and a fortryd that removes them', () => {
  const nyId = taeller();
  const r = anvendElementer(tomtUnivers(), [
    { type: 'dokument', zone: 'privat', titel: 'Pitch', html: '<h1>Hej</h1><p>Verden</p>' },
    { type: 'note', zone: 'privat', titel: 'N', tekst: 't' },
    { type: 'opgave', titel: 'O' },
    { type: 'opgave', titel: 'P', note: 'x', status: 'igang' },
  ], NOW, nyId);
  assert.equal(r.state.dokumenter[0]?.id, 'dok-00000001');
  assert.equal(r.state.dokumenter[0]?.tekst, 'Hej\nVerden');
  assert.equal(r.state.dokumenter[0]?.oprettet, NOW.toISOString());
  assert.deepEqual(r.state.dokumenter[0]?.versioner, []);
  assert.equal(r.state.noter[0]?.id, 'note-00000002');
  assert.equal(r.state.opgaver[0]?.status, 'aaben');
  assert.equal(r.state.opgaver[1]?.status, 'igang');
  assert.equal(r.state.opgaver[1]?.note, 'x');
  const tilbage = fortrydElementer(r.state, r.fortryd);
  assert.deepEqual(tilbage, tomtUnivers());
});

test('anvendElementer does not mutate its input', () => {
  const foer = tomtUnivers();
  const kopi = structuredClone(foer);
  anvendElementer(foer, [{ type: 'note', zone: 'privat', titel: 'N', tekst: 't' }], NOW, taeller());
  assert.deepEqual(foer, kopi);
});

test('updating a document by id keeps the previous version and fortryd brings it back', () => {
  const nyId = taeller();
  const a = anvendElementer(tomtUnivers(), [{ type: 'dokument', zone: 'privat', titel: 'Pitch', html: '<p>Lang</p>' }], NOW, nyId);
  const id = a.state.dokumenter[0]?.id ?? '';
  const b = anvendElementer(a.state, [{ type: 'dokument', zone: 'privat', id, titel: 'Pitch kort', html: '<p>Kort</p>' }], LATER, nyId);
  const dok = b.state.dokumenter[0];
  assert.equal(b.state.dokumenter.length, 1);
  assert.equal(dok?.titel, 'Pitch kort');
  assert.equal(dok?.tekst, 'Kort');
  assert.equal(dok?.aendret, LATER.toISOString());
  assert.equal(dok?.oprettet, NOW.toISOString());
  assert.deepEqual(dok?.versioner, [{ html: '<p>Lang</p>', tekst: 'Lang', tid: NOW.toISOString() }]);
  const tilbage = fortrydElementer(b.state, b.fortryd);
  assert.deepEqual(tilbage, a.state);
});

test('a document keeps at most ten earlier versions (the oldest drop first)', () => {
  const nyId = taeller();
  let s = anvendElementer(tomtUnivers(), [{ type: 'dokument', zone: 'privat', titel: 'D', html: '<p>v0</p>' }], NOW, nyId).state;
  const id = s.dokumenter[0]?.id ?? '';
  for (let i = 1; i <= 14; i++) s = anvendElementer(s, [{ type: 'dokument', zone: 'privat', id, titel: 'D', html: `<p>v${i}</p>` }], NOW, nyId).state;
  assert.equal(s.dokumenter[0]?.versioner.length, 10);
  assert.equal(s.dokumenter[0]?.versioner.at(-1)?.tekst, 'v13');
  assert.equal(s.dokumenter[0]?.versioner[0]?.tekst, 'v4');
});

test('updating notes and tasks by id keeps unspecified fields; an unknown id adds a new element with a minted id', () => {
  const nyId = taeller();
  const a = anvendElementer(tomtUnivers(), [{ type: 'opgave', titel: 'O', note: 'n', status: 'igang' }, { type: 'note', zone: 'privat', titel: 'N', tekst: 't' }], NOW, nyId);
  const oid = a.state.opgaver[0]?.id ?? '';
  const nid = a.state.noter[0]?.id ?? '';
  const b = anvendElementer(a.state, [
    { type: 'opgave', id: oid, titel: 'O2' },
    { type: 'note', zone: 'privat', id: nid, titel: 'N2', tekst: 't2' },
    { type: 'opgave', id: 'opg-findesikke', titel: 'Ny' },
  ], LATER, nyId);
  assert.equal(b.state.opgaver.length, 2);
  assert.equal(b.state.opgaver[0]?.titel, 'O2');
  assert.equal(b.state.opgaver[0]?.note, 'n');
  assert.equal(b.state.opgaver[0]?.status, 'igang');
  assert.notEqual(b.state.opgaver[1]?.id, 'opg-findesikke');
  assert.equal(b.state.noter[0]?.tekst, 't2');
  assert.deepEqual(fortrydElementer(b.state, b.fortryd), a.state);
});

test('fortryd survives a JSON round trip and parseFortryd rejects junk', () => {
  const a = anvendElementer(tomtUnivers(), [{ type: 'note', zone: 'privat', titel: 'N', tekst: 't' }], NOW, taeller());
  const fra = parseFortryd(JSON.parse(JSON.stringify(a.fortryd)));
  assert.deepEqual(fortrydElementer(a.state, fra), tomtUnivers());
  assert.throws(() => parseFortryd({ nej: 1 }), SchemaError);
  assert.throws(() => parseFortryd([{ op: 'slet-alt' }]), SchemaError);
});

test('saetOpgaveStatus moves a task, rejects unknown tasks and statuses', () => {
  const s: UniversState = { ...tomtUnivers(), opgaver: [{ id: 'opg-1', titel: 'O', status: 'aaben' }] };
  assert.equal(saetOpgaveStatus(s, 'opg-1', 'igang').opgaver[0]?.status, 'igang');
  assert.equal(s.opgaver[0]?.status, 'aaben');
  assert.throws(() => saetOpgaveStatus(s, 'nope', 'igang'), SchemaError);
  assert.throws(() => saetOpgaveStatus(s, 'opg-1', 'tosset' as never), SchemaError);
});

test('tilfoejMoede adds a meeting and merges calendar updates by eventId without losing preparation', () => {
  const a = tilfoejMoede(tomtUnivers(), moede({ kilde: 'kalender', eventId: 'ev1' }));
  assert.equal(a.moeder.length, 1);
  const forb = { maal: 'm', deltagere: [], talepunkter: ['a'], tid: 't' };
  const medForb: UniversState = { ...a, moeder: [{ ...(a.moeder[0] as Moede), forberedelse: forb }] };
  const b = tilfoejMoede(medForb, moede({ id: 'moede-9', kilde: 'kalender', eventId: 'ev1', titel: 'Flyttet', start: '2026-10-27T14:00:00Z' }));
  assert.equal(b.moeder.length, 1);
  assert.equal(b.moeder[0]?.id, 'moede-1');
  assert.equal(b.moeder[0]?.titel, 'Flyttet');
  assert.equal(b.moeder[0]?.start, '2026-10-27T14:00:00Z');
  assert.deepEqual(b.moeder[0]?.forberedelse, forb);
  assert.equal(tilfoejMoede(a, moede({ id: 'moede-2' })).moeder.length, 2);
});

test('moedeFraKandidat and nytMoedeFraInput build meetings with minted ids', () => {
  const k: MoedeKandidat = { eventId: 'e', titel: 'T', start: 's', slut: 'u', sted: 'Rum 1', deltagere: [{ navn: 'A' }] };
  const m = moedeFraKandidat(k, taeller());
  assert.deepEqual(m, { id: 'moede-00000001', kilde: 'kalender', eventId: 'e', titel: 'T', start: 's', slut: 'u', sted: 'Rum 1', deltagere: [{ navn: 'A' }] });
  const n = nytMoedeFraInput({ titel: ' Intern ', start: '2026-10-27T12:00:00Z', varighedMinutter: 45, deltagere: 'Tom, Anne' }, taeller());
  assert.equal(n.kilde, 'manuel');
  assert.equal(n.titel, 'Intern');
  assert.equal(n.slut, '2026-10-27T12:45:00.000Z');
  assert.deepEqual(n.deltagere, [{ navn: 'Tom' }, { navn: 'Anne' }]);
  assert.throws(() => nytMoedeFraInput({ titel: '', start: '2026-10-27T12:00:00Z', varighedMinutter: 30, deltagere: '' }, taeller()), SchemaError);
  assert.throws(() => nytMoedeFraInput({ titel: 'x', start: 'ikke en dato', varighedMinutter: 30, deltagere: '' }, taeller()), SchemaError);
  assert.equal(nytMoedeFraInput({ titel: 'x', start: '2026-10-27T12:00:00Z', varighedMinutter: 99999, deltagere: '' }, taeller()).slut, '2026-10-28T12:00:00.000Z');
});

// ---------- forberedelse ----------

const svar = (over: Record<string, unknown> = {}) => ({
  maal: 'Afklar rollen',
  deltagere: [{ navn: 'Tom', hvem: 'Chef', baggrund: 'b', vil: 'v' }],
  talepunkter: ['Et', 'To'],
  opgaver: [{ titel: 'Find tal' }, { titel: 'Ring til Anne', note: 'n' }],
  ...over,
});

test('anvendForberedelse stores the preparation, links tasks and creates the presentation document', () => {
  const s0: UniversState = tilfoejMoede(tomtUnivers(), moede());
  const r = anvendForberedelse(s0, 'moede-1', svar({ praesentation: { titel: 'Pitch', html: '<p>Slide</p>' } }), NOW, taeller());
  const m = r.state.moeder[0];
  assert.equal(m?.forberedelse?.maal, 'Afklar rollen');
  assert.equal(m?.forberedelse?.tid, NOW.toISOString());
  assert.deepEqual(m?.forberedelse?.talepunkter, ['Et', 'To']);
  assert.equal(r.state.opgaver.length, 2);
  assert.ok(r.state.opgaver.every((o) => o.moedeId === 'moede-1' && o.status === 'aaben'));
  assert.equal(r.state.dokumenter.length, 1);
  assert.equal(r.state.dokumenter[0]?.moedeId, 'moede-1');
  assert.equal(m?.forberedelse?.dokumentId, r.state.dokumenter[0]?.id);
  assert.deepEqual(fortrydElementer(r.state, r.fortryd), s0);
});

test('anvendForberedelse keeps talepunktIkoner on the stored preparation, and omits the field without them', () => {
  const s0: UniversState = tilfoejMoede(tomtUnivers(), moede());
  const med = anvendForberedelse(s0, 'moede-1', svar({ talepunktIkoner: ['target', undefined] }), NOW, taeller());
  assert.deepEqual(med.state.moeder[0]?.forberedelse?.talepunktIkoner, ['target', undefined]);
  const uden = anvendForberedelse(s0, 'moede-1', svar(), NOW, taeller());
  assert.ok(!('talepunktIkoner' in (uden.state.moeder[0]?.forberedelse ?? {})));
});

test('re-preparing updates the same presentation as a new version, does not duplicate tasks and keeps the old document link without a new presentation', () => {
  const nyId = taeller();
  const s0 = tilfoejMoede(tomtUnivers(), moede());
  const a = anvendForberedelse(s0, 'moede-1', svar({ praesentation: { titel: 'Pitch', html: '<p>v1</p>' } }), NOW, nyId);
  const b = anvendForberedelse(a.state, 'moede-1', svar({ maal: 'Nyt mål', opgaver: [{ titel: 'find TAL' }, { titel: 'Ny opgave' }], praesentation: { titel: 'Pitch 2', html: '<p>v2</p>' } }), LATER, nyId);
  assert.equal(b.state.dokumenter.length, 1);
  assert.equal(b.state.dokumenter[0]?.versioner.length, 1);
  assert.equal(b.state.dokumenter[0]?.tekst, 'v2');
  assert.equal(b.state.opgaver.length, 3);
  assert.equal(b.state.moeder[0]?.forberedelse?.maal, 'Nyt mål');
  assert.equal(b.state.moeder[0]?.forberedelse?.dokumentId, a.state.dokumenter[0]?.id);
  assert.deepEqual(fortrydElementer(b.state, b.fortryd), a.state);
  const c = anvendForberedelse(b.state, 'moede-1', svar({ maal: 'Tredje' }), LATER, nyId);
  assert.equal(c.state.moeder[0]?.forberedelse?.dokumentId, a.state.dokumenter[0]?.id);
  assert.equal(c.state.dokumenter[0]?.versioner.length, 1);
});

test('anvendForberedelse rejects an unknown meeting', () => {
  assert.throws(() => anvendForberedelse(tomtUnivers(), 'moede-x', svar(), NOW, taeller()), SchemaError);
});

// ---------- index ops ----------

const kand = (eventId: string, start = '2026-10-28T08:00:00Z'): MoedeKandidat => ({ eventId, titel: `M ${eventId}`, start, slut: '2026-10-28T09:00:00Z', deltagere: [] });

test('flettKandidater adds new, refreshes known, drops vanished, skips placed and hidden, sorts by start', () => {
  let i = { ...tomtIndeks(), nyeMoeder: [kand('gammel'), kand('bliver', '2026-10-30T08:00:00Z')], skjulteMoeder: ['skjult'] };
  i = flettKandidater(i, [kand('bliver', '2026-10-29T08:00:00Z'), kand('ny', '2026-10-28T08:00:00Z'), kand('skjult'), kand('placeret')], ['placeret']);
  assert.deepEqual(i.nyeMoeder.map((k) => k.eventId), ['ny', 'bliver']);
  assert.equal(i.nyeMoeder[1]?.start, '2026-10-29T08:00:00Z');
  assert.deepEqual(i.skjulteMoeder, ['skjult']);
});

test('placerMoede removes the candidate and returns it; unknown id gives null and leaves the index', () => {
  const i = { ...tomtIndeks(), nyeMoeder: [kand('a'), kand('b')] };
  const r = placerMoede(i, 'a');
  assert.equal(r.kandidat?.eventId, 'a');
  assert.deepEqual(r.indeks.nyeMoeder.map((k) => k.eventId), ['b']);
  assert.equal(i.nyeMoeder.length, 2);
  assert.equal(placerMoede(i, 'zzz').kandidat, null);
});

test('skjulMoede removes it from the new ones and remembers it once', () => {
  const i = { ...tomtIndeks(), nyeMoeder: [kand('a'), kand('b')] };
  const a = skjulMoede(i, 'a');
  assert.deepEqual(a.nyeMoeder.map((k) => k.eventId), ['b']);
  assert.deepEqual(skjulMoede(a, 'a').skjulteMoeder, ['a']);
});

test('universStat counts upcoming meetings, open tasks and documents', () => {
  const s: UniversState = {
    ...tomtUnivers(),
    moeder: [moede({ id: 'a', slut: '2026-10-27T09:00:00Z', start: '2026-10-27T08:00:00Z' }), moede({ id: 'b' })],
    opgaver: [{ id: '1', titel: 'x', status: 'aaben' }, { id: '2', titel: 'y', status: 'igang' }, { id: '3', titel: 'z', status: 'faerdig' }],
    dokumenter: [{ id: 'd', titel: 'D', html: '', tekst: '', versioner: [], oprettet: 't', aendret: 't' }],
  };
  assert.deepEqual(universStat(s, NOW), { moeder: 1, aabneOpgaver: 2, dokumenter: 1 });
});
