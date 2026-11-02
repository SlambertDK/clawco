// KC-0148: the household universe's stored state (members' extras, and the
// resource and request subsets KC-0149/0150 extend) and who it is for. Every
// field is checked and capped; members come from the E1 identity, never from
// the stored list alone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HusholdFejl, parseHusstandState, TOM_HUSSTAND, type HusstandState } from '../../src/hushold/schema.ts';
import { husstandRelevant, maaSeHusstand, medlemmerAf } from '../../src/hushold/personer.ts';
import { ENEBRUGER, INGEN } from '../../src/identitet/identitet.ts';
import type { Person } from '../../src/identitet/husstand.ts';

const GYLDIG: HusstandState = {
  konflikter: [],
  medlemmer: [{ id: 'maja', navn: 'Maja', rolle: 'medlem', relation: 'din kone', telefon: '+45 12 34 56 78' }],
  ressourcer: [
    { id: 'stor-bil', navn: 'Den store bil', slags: 'bil', ejere: ['maja', 'henrik'], kalender: [{ id: 'b1', ressourceId: 'stor-bil', af: 'maja', start: '2026-11-07T08:00:00.000Z', slut: '2026-11-07T16:00:00.000Z', titel: 'Til Odense', foresporgselId: 'f1' }] },
    { id: 'ella', navn: 'Ella', slags: 'person', ejere: ['henrik'], kalender: [] },
  ],
  forespoergsler: [{
    id: 'f1', fra: 'maja', til: 'henrik', titel: 'Må jeg låne bilen?', tid: { start: '2026-11-08T08:00:00.000Z', slut: '2026-11-08T12:00:00.000Z' }, tilstand: 'alternativ',
    alternativ: { start: '2026-11-08T09:00:00.000Z', slut: '2026-11-08T13:00:00.000Z', tekst: 'Kan 10.00' },
    oprettet: '2026-11-02T08:00:00.000Z', udloeber: '2026-11-04T08:00:00.000Z', paamindet: ['henrik:24t'],
    historik: [{ tid: '2026-11-02T08:00:00.000Z', tilstand: 'spurgt', af: 'maja' }, { tid: '2026-11-02T09:00:00.000Z', tilstand: 'alternativ', af: 'henrik' }],
    forslag: { anbefaling: 'Bilen er fri efter 10.', alternativer: [{ kl: '10:00', tekst: 'Kan 10.00' }] },
    iKalender: ['maja'],
  }],
  // KC-0150: a clash between Henrik's wish and Maja's booking, with Hermes' suggestion and a request it led to.
  sammenfald: [{
    id: 's1', ressourceId: 'stor-bil', oprettet: '2026-11-02T08:00:00.000Z',
    ny: { id: 'w1', ressourceId: 'stor-bil', af: 'henrik', start: '2026-11-07T10:00:00.000Z', slut: '2026-11-07T12:00:00.000Z', titel: 'Indkøb' },
    mod: { id: 'b1', ressourceId: 'stor-bil', af: 'maja', start: '2026-11-07T08:00:00.000Z', slut: '2026-11-07T16:00:00.000Z', titel: 'Til Odense' },
    valg: [{ id: 'v1', slags: 'afgiv', hvem: 'maja' }, { id: 'v2', slags: 'anden', hvem: 'maja', ressourceId: 'ella' }, { id: 'v3', slags: 'afgiv', hvem: 'henrik' }],
    forslag: { foerste: 'v1', anbefaling: 'Maja kører hele dagen.' },
    forespId: 'f1', forespValg: 'v1',
    afgjort: { valg: 'v1', af: 'maja', tid: '2026-11-02T09:00:00.000Z' },
  }],
  // KC-0151: a booking waiting for Henrik's tap.
  udkast: [{ id: 'u1', af: 'henrik', ressourceId: 'stor-bil', start: '2026-11-07T09:00:00.000Z', slut: '2026-11-07T14:00:00.000Z', titel: 'Indkøb', oprettet: '2026-11-02T08:00:00.000Z' }],
};

test('a valid state round-trips; null or absent is the empty household', () => {
  assert.deepEqual(parseHusstandState(JSON.parse(JSON.stringify(GYLDIG))), GYLDIG);
  assert.deepEqual(parseHusstandState(null), TOM_HUSSTAND);
  assert.deepEqual(parseHusstandState(undefined), TOM_HUSSTAND);
  assert.deepEqual(parseHusstandState({}), TOM_HUSSTAND);
});

test('unknown fields are dropped', () => {
  const s = parseHusstandState({ ...GYLDIG, ekstra: 1, medlemmer: [{ ...GYLDIG.medlemmer[0], kodeord: 'x' }] });
  assert.equal('ekstra' in s, false);
  assert.equal('kodeord' in s.medlemmer[0]!, false);
});

test('every bad field is refused (HusholdFejl)', () => {
  const m = GYLDIG.medlemmer[0]!;
  const r = GYLDIG.ressourcer[0]!;
  const b = r.kalender[0]!;
  const f = GYLDIG.forespoergsler[0]!;
  const sf = GYLDIG.sammenfald[0]!;
  const daarlige: unknown[] = [
    [],
    'x',
    { ...GYLDIG, medlemmer: 'maja' },
    { ...GYLDIG, medlemmer: [{ ...m, id: '../ud' }] },
    { ...GYLDIG, medlemmer: [{ ...m, rolle: 'konge' }] },
    { ...GYLDIG, medlemmer: [{ ...m, navn: 'x'.repeat(81) }] },
    { ...GYLDIG, medlemmer: [{ ...m, navn: '  ' }] },
    { ...GYLDIG, medlemmer: [{ ...m, telefon: 'ring mig' }] },
    { ...GYLDIG, medlemmer: [{ ...m, relation: 'x'.repeat(81) }] },
    { ...GYLDIG, medlemmer: [m, m] },
    { ...GYLDIG, ressourcer: [{ ...r, navn: '' }] },
    { ...GYLDIG, ressourcer: [{ ...r, kalender: [{ ...b, slut: b.start }] }] },
    { ...GYLDIG, ressourcer: [{ ...r, kalender: [{ ...b, start: 'i morgen' }] }] },
    { ...GYLDIG, forespoergsler: [{ ...f, tilstand: 'maaske' }] },
    { ...GYLDIG, forespoergsler: [{ ...f, tid: { start: f.tid!.slut, slut: f.tid!.start } }] },
    { ...GYLDIG, forespoergsler: [{ ...f, titel: 'x'.repeat(201) }] },
    { ...GYLDIG, forespoergsler: [{ ...f, til: 'maja' }] }, // KC-0149: nobody asks themselves
    { ...GYLDIG, forespoergsler: [{ ...f, historik: [] }] },
    { ...GYLDIG, forespoergsler: [{ ...f, historik: [{ ...f.historik[0], af: '../x' }] }] },
    { ...GYLDIG, forespoergsler: [{ ...f, udloeber: 'snart' }] },
    { ...GYLDIG, forespoergsler: [{ ...f, aarsag: 'glemt' }] },
    { ...GYLDIG, forespoergsler: [{ ...f, paamindet: ['henrik:1t'] }] },
    { ...GYLDIG, forespoergsler: [{ ...f, forslag: { alternativer: [{ kl: '25:00', tekst: 'x' }] } }] },
    { ...GYLDIG, forespoergsler: [{ ...f, alternativ: { ...f.alternativ, tekst: '' } }] },
    // KC-0150: resources and clashes
    { ...GYLDIG, ressourcer: [{ ...r, slags: 'raket' }] },
    { ...GYLDIG, ressourcer: [{ ...r, ejere: 'maja' }] },
    { ...GYLDIG, ressourcer: [{ ...r, ejere: ['../x'] }] },
    { ...GYLDIG, ressourcer: [{ ...r, kalender: [b, { ...b, id: 'b2', start: '2026-11-07T15:59:00.000Z', slut: '2026-11-07T17:00:00.000Z' }] }] }, // a stored double booking
    { ...GYLDIG, ressourcer: [{ ...r, kalender: [{ ...b, ressourceId: 'lille-bil' }] }] },
    { ...GYLDIG, sammenfald: [{ ...sf, valg: [] }] },
    { ...GYLDIG, sammenfald: [{ ...sf, valg: [...sf.valg, ...sf.valg] }] },
    { ...GYLDIG, sammenfald: [{ ...sf, valg: [{ id: 'v1', slags: 'stjael', hvem: 'maja' }] }] },
    { ...GYLDIG, sammenfald: [{ ...sf, mod: { ...sf.mod, af: 'henrik' } }] }, // a clash with oneself
    { ...GYLDIG, sammenfald: [{ ...sf, forslag: { foerste: 'v9' } }] },
    { ...GYLDIG, medlemmer: Array.from({ length: 51 }, (_, i) => ({ ...m, id: `m${i}` })) },
  ];
  for (const d of daarlige) assert.throws(() => parseHusstandState(d), HusholdFejl, JSON.stringify(d).slice(0, 80));
});

// ---------- Members and relevance ----------

const HENRIK: Person = { id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' };
const MAJA: Person = { id: 'maja', login: 'maja@example.com', navn: 'Maja', rolle: 'medlem' };
const FARMOR: Person = { id: 'farmor', login: null, navn: 'Farmor', rolle: 'gaest' };

test('medlemmerAf: identity decides who, name and role; the store only adds relation and telefon', () => {
  const gemte = [{ id: 'maja', navn: 'Gammelt navn', rolle: 'barn' as const, relation: 'din kone', telefon: '+45 12345678' }, { id: 'fremmed', navn: 'Fremmed', rolle: 'medlem' as const }];
  const m = medlemmerAf([HENRIK, MAJA], gemte);
  assert.deepEqual(m, [
    { id: 'henrik', navn: 'Henrik', rolle: 'ejer', tailnetLogin: 'henrik@example.com' },
    { id: 'maja', navn: 'Maja', rolle: 'medlem', tailnetLogin: 'maja@example.com', relation: 'din kone', telefon: '+45 12345678' },
  ]);
  assert.deepEqual(medlemmerAf([FARMOR], []), [{ id: 'farmor', navn: 'Farmor', rolle: 'gaest' }]);
});

test('husstandRelevant: two members, or a resource or a request; one person alone is not', () => {
  const en = medlemmerAf([HENRIK], []);
  const to = medlemmerAf([HENRIK, MAJA], []);
  assert.equal(husstandRelevant([], TOM_HUSSTAND), false);
  assert.equal(husstandRelevant(en, TOM_HUSSTAND), false);
  assert.equal(husstandRelevant(to, TOM_HUSSTAND), true);
  assert.equal(husstandRelevant(en, { ...TOM_HUSSTAND, ressourcer: GYLDIG.ressourcer }), true);
  assert.equal(husstandRelevant(en, { ...TOM_HUSSTAND, forespoergsler: GYLDIG.forespoergsler }), true);
});

test('maaSeHusstand: a member who is not a guest, and only when relevant', () => {
  const tre = medlemmerAf([HENRIK, MAJA, FARMOR], []);
  assert.equal(maaSeHusstand(HENRIK, tre, TOM_HUSSTAND), true);
  assert.equal(maaSeHusstand(MAJA, tre, TOM_HUSSTAND), true);
  assert.equal(maaSeHusstand(FARMOR, tre, TOM_HUSSTAND), false, 'a guest');
  assert.equal(maaSeHusstand(INGEN, tre, TOM_HUSSTAND), false, 'nobody');
  assert.equal(maaSeHusstand(ENEBRUGER, [], TOM_HUSSTAND), false, 'single-user');
  assert.equal(maaSeHusstand(HENRIK, medlemmerAf([HENRIK], []), TOM_HUSSTAND), false, 'a household of one');
});

test('KC-0151: a booking draft is checked and capped; a state without drafts reads as none', () => {
  const u = GYLDIG.udkast[0]!;
  assert.deepEqual(parseHusstandState({ ...GYLDIG, udkast: undefined }).udkast, []);
  const daarlige: unknown[] = [
    { ...u, id: 'U 1' }, { ...u, af: '' }, { ...u, ressourceId: 'x y' }, { ...u, titel: '' }, { ...u, titel: 'x'.repeat(201) },
    { ...u, start: 'nu' }, { ...u, slut: u.start }, { ...u, oprettet: 'i går' }, 'x',
  ];
  for (const d of daarlige) assert.throws(() => parseHusstandState({ ...GYLDIG, udkast: [d] }), HusholdFejl, JSON.stringify(d));
  assert.throws(() => parseHusstandState({ ...GYLDIG, udkast: [u, u] }), HusholdFejl, 'the same id twice');
  assert.throws(() => parseHusstandState({ ...GYLDIG, udkast: Array.from({ length: 51 }, (_, i) => ({ ...u, id: `u${i}` })) }), HusholdFejl, 'too many');
});

test('KC-0152: a weekend card is checked and capped; a state without cards reads as none', () => {
  const blok = (hvem: string, titel?: string) => ({ hvem, start: '2026-11-07T08:00:00.000Z', slut: '2026-11-07T13:00:00.000Z', med: [hvem], ...(titel ? { titel } : {}) });
  const k = {
    id: 'k1', noegle: '2026-11-07|barn:ella', dag: '2026-11-07', parter: ['henrik', 'maja'], behov: { slags: 'barn', id: 'ella', navn: 'Ella' },
    tid: { start: '2026-11-07T10:00:00.000Z', slut: '2026-11-07T12:00:00.000Z' }, blokke: [blok('henrik', 'Cykeltur'), blok('maja')],
    valg: [{ id: 'v1', slags: 'tager', hvem: 'henrik' }, { id: 'v2', slags: 'tager', hvem: 'maja' }, { id: 'v3', slags: 'tredje' }],
    oprettet: '2026-11-03T06:30:00.000Z', tekst: { resume: 'Henrik og Maja er væk.', spoergsmaal: 'Hvem har Ella?' }, forespId: 'f1', forespValg: 'v2',
  };
  const ok = parseHusstandState({ ...GYLDIG, konflikter: [k], konfliktTjek: '2026-11-07' });
  assert.deepEqual(ok.konflikter, [k]);
  assert.equal(ok.konfliktTjek, '2026-11-07');
  assert.deepEqual(parseHusstandState({ ...GYLDIG, konflikter: undefined }).konflikter, []);
  assert.equal(parseHusstandState(GYLDIG).konfliktTjek, undefined);
  const daarlige: unknown[] = [
    { ...k, id: 'K 1' }, { ...k, dag: 'lørdag' }, { ...k, parter: ['henrik'] }, { ...k, parter: ['henrik', 'henrik'] }, { ...k, behov: { slags: 'dyr', id: 'x', navn: 'x' } },
    { ...k, tid: { start: k.tid.slut, slut: k.tid.start } }, { ...k, blokke: [blok('henrik')] }, { ...k, blokke: [blok('henrik'), blok('tredje')] },
    { ...k, valg: [] }, { ...k, valg: [{ id: 'v1', slags: 'tager', hvem: 'tredje' }, { id: 'v2', slags: 'tredje' }] }, { ...k, valg: [{ id: 'v1', slags: 'stjael', hvem: 'henrik' }, { id: 'v2', slags: 'tredje' }] },
    { ...k, tekst: { resume: '', spoergsmaal: 'x' } }, { ...k, tekst: { resume: 'x'.repeat(301), spoergsmaal: 'x' } }, { ...k, forespValg: 'v9' }, { ...k, oprettet: 'nu' }, 'x',
    { ...k, blokke: [blok('henrik', 'x'.repeat(121)), blok('maja')] },
  ];
  for (const d of daarlige) assert.throws(() => parseHusstandState({ ...GYLDIG, konflikter: [d] }), HusholdFejl, JSON.stringify(d));
  assert.throws(() => parseHusstandState({ ...GYLDIG, konflikter: [k, k] }), HusholdFejl, 'the same id twice');
  assert.throws(() => parseHusstandState({ ...GYLDIG, konflikter: [k, { ...k, id: 'k2' }] }), HusholdFejl, 'the same need twice');
  assert.throws(() => parseHusstandState({ ...GYLDIG, konfliktTjek: 'tirsdag' }), HusholdFejl);
});
