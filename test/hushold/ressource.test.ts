// KC-0150: the resource model, pure. A resource has its own calendar and an
// owner circle; overlap is half-open (touching edges do not clash); a clash
// offers 2–4 outcomes for the two bookers; applying one never leaves a double
// booking and never silently displaces anyone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OPRET_SLAGS, SLAGS, aabenSammenfald, dobbeltBooket, erEjer, erPartI, hvorforIkkeFjernes, indsaet, kommendeAfAndre, loesSammenfald, maaRetteRessource, nySammenfald, overlapper, sammenfald, valgFor,
  type Booking, type Ressource,
} from '../../src/hushold/ressource.ts';

const T = (hhmm: string, dag = 7): string => `2026-11-${String(dag).padStart(2, '0')}T${hhmm}:00.000Z`;
const b = (id: string, af: string, fra: string, til: string, ressourceId = 'stor-bil', titel = 'Tur'): Booking => ({ id, ressourceId, af, start: T(fra), slut: T(til), titel });
const STOR: Ressource = { id: 'stor-bil', navn: 'Den store bil', slags: 'bil', ejere: ['henrik', 'rikke', 'maja'], kalender: [b('b1', 'rikke', '08:00', '16:00')] };
const LILLE: Ressource = { id: 'lille-bil', navn: 'Den lille bil', slags: 'bil', ejere: ['henrik', 'rikke'], kalender: [] };
const RUM: Ressource = { id: 'gaestevaerelse', navn: 'Gæsteværelset', slags: 'rum', ejere: ['henrik'], kalender: [] };
const ELLA: Ressource = { id: 'ella', navn: 'Ella', slags: 'person', ejere: ['henrik', 'maja'], kalender: [b('e1', 'maja', '15:00', '17:00', 'ella', 'Svømning')] };

test('overlap is half-open: touching edges do not clash, containment and partial overlap do', () => {
  const tabel: [string, string, string, string, boolean][] = [
    ['08:00', '10:00', '10:00', '12:00', false], // touching after
    ['10:00', '12:00', '08:00', '10:00', false], // touching before
    ['08:00', '10:00', '09:59', '12:00', true],  // one minute over
    ['08:00', '16:00', '10:00', '12:00', true],  // contains
    ['10:00', '12:00', '08:00', '16:00', true],  // contained
    ['08:00', '10:00', '08:00', '10:00', true],  // identical
    ['08:00', '09:00', '11:00', '12:00', false], // apart
  ];
  for (const [a1, a2, b1, b2, ja] of tabel) {
    assert.equal(overlapper({ start: T(a1), slut: T(a2) }, { start: T(b1), slut: T(b2) }), ja, `${a1}-${a2} vs ${b1}-${b2}`);
  }
});

test('sammenfald returns the overlapping bookings by start, never the booking itself', () => {
  const kal = [b('b2', 'maja', '14:00', '18:00'), b('b1', 'rikke', '08:00', '12:00'), b('b3', 'henrik', '18:00', '20:00')];
  assert.deepEqual(sammenfald({ id: 'ny', start: T('11:00'), slut: T('15:00') }, kal).map((x) => x.id), ['b1', 'b2']);
  assert.deepEqual(sammenfald({ id: 'b1', start: T('08:00'), slut: T('12:00') }, kal).map((x) => x.id), []);
  assert.deepEqual(sammenfald({ id: 'ny', start: T('12:00'), slut: T('14:00') }, kal), []);
});

test('the owner circle decides who books without asking — also for a person-resource', () => {
  assert.equal(erEjer(STOR, 'rikke'), true);
  assert.equal(erEjer(LILLE, 'maja'), false);
  assert.equal(erEjer(ELLA, 'maja'), true);
  assert.equal(erEjer(ELLA, 'ella'), false, 'a child as a resource is not her own owner here');
  assert.deepEqual([...SLAGS], ['bil', 'rum', 'ting', 'person']);
  // "She can only be one place": Ella is booked like any other resource.
  assert.equal(sammenfald({ id: 'ny', start: T('16:00'), slut: T('18:00') }, ELLA.kalender).length, 1);
});

test('indsaet books only into a free slot; dobbeltBooket finds any overlapping pair', () => {
  const ok = indsaet([STOR, LILLE], b('b9', 'henrik', '16:00', '18:00'));
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.ressourcer[0]!.kalender.length, 2);
  const nej = indsaet([STOR, LILLE], b('b9', 'henrik', '15:00', '18:00'));
  assert.equal(nej.ok, false);
  assert.equal(indsaet([STOR], b('b9', 'henrik', '15:00', '18:00', 'findes-ikke')).ok, false);
  assert.equal(dobbeltBooket(STOR), false);
  assert.equal(dobbeltBooket({ ...STOR, kalender: [...STOR.kalender, b('b2', 'maja', '15:59', '17:00')] }), true);
});

const ny = b('w1', 'henrik', '10:00', '14:00');
const s0 = nySammenfald({ id: 's1', ny, mod: STOR.kalender[0]!, ressourcer: [STOR, LILLE, RUM], nu: new Date(T('07:00', 2)) });

test('a clash: the two bookers, outcomes in default order, own small car first, capped at 4', () => {
  assert.deepEqual(s0.valg.map((v) => [v.id, v.slags, v.hvem, 'ressourceId' in v ? v.ressourceId : '']), [
    ['v1', 'anden', 'henrik', 'lille-bil'],
    ['v2', 'afgiv', 'rikke', ''],
    ['v3', 'anden', 'rikke', 'lille-bil'],
    ['v4', 'afgiv', 'henrik', ''],
  ]);
  assert.equal(erPartI(s0, 'henrik'), true);
  assert.equal(erPartI(s0, 'rikke'), true);
  assert.equal(erPartI(s0, 'maja'), false, 'another owner of the same car is not a party');
  assert.equal(aabenSammenfald(s0, new Date(T('09:00'))), true);
  assert.equal(aabenSammenfald(s0, new Date(T('14:00'))), false, 'the wish has ended');
});

test('valgFor offers another resource only when it is free, of the same kind, and owned by that person', () => {
  const optaget = { ...LILLE, kalender: [b('l1', 'rikke', '09:00', '11:00', 'lille-bil')] };
  const v = valgFor([STOR, optaget, RUM], ny, STOR.kalender[0]!);
  assert.deepEqual(v.map((x) => x.slags), ['afgiv', 'afgiv'], 'small car taken for both: only the two let-go outcomes');
  const majasBil = valgFor([STOR, { ...LILLE, ejere: ['rikke'] }], ny, STOR.kalender[0]!);
  assert.deepEqual(majasBil.map((x) => `${x.slags}:${x.hvem}`), ['afgiv:rikke', 'anden:rikke', 'afgiv:henrik']);
});

test('loesSammenfald: each outcome, and nothing is ever double booked', () => {
  const r = [STOR, LILLE];
  const v1 = loesSammenfald(r, s0, 'v1', 'n1');
  assert.ok(v1.ok);
  assert.deepEqual(v1.booket.map((x) => [x.id, x.ressourceId, x.af]), [['n1', 'lille-bil', 'henrik']]);
  assert.equal(v1.ressourcer[0]!.kalender.length, 1, 'Rikke keeps the big car');

  const v2 = loesSammenfald(r, s0, 'v2', 'n1', { foresporgselId: 'f-1' });
  assert.ok(v2.ok);
  assert.deepEqual(v2.fjernet.map((x) => x.id), ['b1']);
  assert.deepEqual(v2.ressourcer[0]!.kalender.map((x) => [x.id, x.af, x.foresporgselId]), [['n1', 'henrik', 'f-1']]);

  const v3 = loesSammenfald(r, s0, 'v3', 'n1');
  assert.ok(v3.ok);
  assert.deepEqual(v3.ressourcer[1]!.kalender.map((x) => [x.id, x.af]), [['b1', 'rikke']], 'Rikke moved to the small car, same booking');
  assert.deepEqual(v3.ressourcer[0]!.kalender.map((x) => [x.id, x.af]), [['n1', 'henrik']]);

  const v4 = loesSammenfald(r, s0, 'v4', 'n1');
  assert.ok(v4.ok);
  assert.deepEqual(v4.booket, []);
  assert.deepEqual(v4.ressourcer, r);

  for (const x of [v1, v2, v3, v4]) if (x.ok) assert.ok(x.ressourcer.every((y) => !dobbeltBooket(y)));
});

test('loesSammenfald refuses when the world moved: target taken, held booking gone, third booking in the way, unknown option', () => {
  const lilleTaget = [STOR, { ...LILLE, kalender: [b('l1', 'maja', '12:00', '13:00', 'lille-bil')] }];
  assert.equal(loesSammenfald(lilleTaget, s0, 'v1', 'n1').ok, false);
  assert.equal(loesSammenfald([{ ...STOR, kalender: [] }, LILLE], s0, 'v2', 'n1').ok, false, 'Rikke already let go another way');
  const tredje = [{ ...STOR, kalender: [...STOR.kalender, b('b7', 'maja', '16:00', '18:00')] }, LILLE];
  const s = { ...s0, ny: b('w1', 'henrik', '10:00', '17:00') };
  assert.equal(loesSammenfald(tredje, s, 'v2', 'n1').ok, false, "Rikke letting go does not displace Maja's booking");
  assert.equal(loesSammenfald([STOR, LILLE], s0, 'v9', 'n1').ok, false);
  assert.equal(loesSammenfald([STOR, LILLE], { ...s0, afgjort: { valg: 'v4', af: 'henrik', tid: T('08:00') } }, 'v1', 'n1').ok, false);
});

// ---------- KC-0215: who may change a resource, and what blocks removing it ----------

test('the kinds a person can create are bil, rum and ting — a person-resource stands for a member', () => {
  assert.deepEqual([...OPRET_SLAGS], ['bil', 'rum', 'ting']);
  for (const k of OPRET_SLAGS) assert.ok((SLAGS as readonly string[]).includes(k));
});

test('maaRetteRessource: an adult in the owner circle, or the household owner; never a child, a guest or an outsider', () => {
  const kreds = { ejere: ['henrik', 'rikke', 'ella', 'farmor'] };
  assert.equal(maaRetteRessource(kreds, { id: 'rikke', rolle: 'medlem' }), true);
  assert.equal(maaRetteRessource(kreds, { id: 'henrik', rolle: 'ejer' }), true);
  assert.equal(maaRetteRessource(kreds, { id: 'ella', rolle: 'barn' }), false, 'a child in the circle');
  assert.equal(maaRetteRessource(kreds, { id: 'farmor', rolle: 'gaest' }), false, 'a guest in the circle');
  assert.equal(maaRetteRessource(LILLE, { id: 'maja', rolle: 'medlem' }), false, 'a member outside the circle');
  assert.equal(maaRetteRessource(LILLE, { id: 'boss', rolle: 'ejer' }), true, 'the household owner outside the circle');
});

const NU = new Date('2026-11-03T08:00:00.000Z');
const frem = (id: string, af: string, ressourceId = 'x'): Booking => ({ id, ressourceId, af, start: '2026-11-07T09:00:00.000Z', slut: '2026-11-07T11:00:00.000Z', titel: 'Tur' });
const gammel = (id: string, af: string, ressourceId = 'x'): Booking => ({ id, ressourceId, af, start: '2026-10-01T09:00:00.000Z', slut: '2026-10-01T11:00:00.000Z', titel: 'Før' });
const bil = (kalender: Booking[]): Ressource => ({ id: 'x', navn: 'Cyklen', slags: 'ting', ejere: ['henrik'], kalender });
const ingen = { nu: NU, sammenfald: [], forespoergsler: [] };

test('kommendeAfAndre: upcoming bookings of anyone but the remover', () => {
  assert.deepEqual(kommendeAfAndre(bil([frem('a', 'henrik'), frem('b', 'maja'), gammel('c', 'maja')]), 'henrik', NU).map((x) => x.id), ['b']);
});

test('hvorforIkkeFjernes: free, own upcoming and others\' past bookings do not block', () => {
  assert.equal(hvorforIkkeFjernes(bil([]), { person: 'henrik', ...ingen }), null);
  assert.equal(hvorforIkkeFjernes(bil([frem('a', 'henrik')]), { person: 'henrik', ...ingen }), null);
  assert.equal(hvorforIkkeFjernes(bil([gammel('c', 'maja')]), { person: 'henrik', ...ingen }), null);
});

test('hvorforIkkeFjernes: another person\'s upcoming booking blocks, with the reason in Danish', () => {
  const r = hvorforIkkeFjernes(bil([frem('b', 'maja')]), { person: 'henrik', ...ingen });
  assert.match(r ?? '', /bookinger/);
});

test('hvorforIkkeFjernes: an open clash on it or offering it, and an open request naming it, block; settled ones do not', () => {
  const s = nySammenfald({ id: 's1', ny: { ...frem('n', 'rikke', 'x'), id: 'n' }, mod: { ...frem('m', 'henrik', 'x'), start: '2026-11-07T10:00:00.000Z' }, ressourcer: [bil([])], nu: NU });
  assert.match(hvorforIkkeFjernes(bil([]), { person: 'henrik', ...ingen, sammenfald: [s] }) ?? '', /kort/);
  assert.equal(hvorforIkkeFjernes(bil([]), { person: 'henrik', ...ingen, sammenfald: [{ ...s, afgjort: { valg: 'v1', af: 'rikke', tid: NU.toISOString() } }] }), null);
  const andenSide = { ...s, ressourceId: 'y', valg: [{ id: 'v1', slags: 'anden' as const, hvem: 'rikke', ressourceId: 'x' }, { id: 'v2', slags: 'afgiv' as const, hvem: 'henrik' }] };
  assert.match(hvorforIkkeFjernes(bil([]), { person: 'henrik', ...ingen, sammenfald: [andenSide] }) ?? '', /kort/);
  for (const t of ['spurgt', 'alternativ']) assert.match(hvorforIkkeFjernes(bil([]), { person: 'henrik', ...ingen, forespoergsler: [{ ressourceId: 'x', tilstand: t }] }) ?? '', /spørgsmål|forespørgsel/);
  assert.equal(hvorforIkkeFjernes(bil([]), { person: 'henrik', ...ingen, forespoergsler: [{ ressourceId: 'x', tilstand: 'accepteret' }] }), null);
  assert.equal(hvorforIkkeFjernes(bil([]), { person: 'henrik', ...ingen, forespoergsler: [{ ressourceId: 'y', tilstand: 'spurgt' }] }), null);
});
