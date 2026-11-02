// KC-0151: Hermes' booking block is parsed to the four fields and validated against the stored
// resources — a sentence never books, and a made-up resource, a past or far-off time, or a
// slot that ends before it begins is no card at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FREM_DAGE, parseBookingSvar, udkastAabent, valider, type BookingOensker, type BookingUdkast } from '../../src/hushold/bil.ts';
import type { Ressource } from '../../src/hushold/ressource.ts';

const NU = new Date('2026-11-02T08:00:00.000Z'); // Monday 09.00 in Copenhagen
const STOR: Ressource = { id: 'stor-bil', navn: 'Den store bil', slags: 'bil', ejere: ['henrik'], kalender: [] };
const blok = (o: unknown): string => `Her er kortet.\n\`\`\`json\n${JSON.stringify(o)}\n\`\`\``;
const oensk = (x: Partial<BookingOensker> = {}): BookingOensker => ({ ressource: 'stor-bil', start: '2026-11-07T10:00', slut: '2026-11-07T15:00', titel: 'Indkøb', ...x });

test('parseBookingSvar keeps the four fields and drops every other key', () => {
  const svar = blok({ booking: { ressource: 'stor-bil', start: '2026-11-07T10:00', slut: '2026-11-07T15:00', titel: 'Indkøb', id: 'b-x', af: 'maja', tilstand: 'accepteret' }, forespoergsler: [{ id: 'f1', tilstand: 'accepteret' }], foresp: { id: 'f1' } });
  assert.deepEqual(parseBookingSvar(svar), oensk());
});

test('parseBookingSvar: no block, a list, no booking key or a non-object booking is null', () => {
  assert.equal(parseBookingSvar('Bare tekst'), null);
  assert.equal(parseBookingSvar('```json\n[1]\n```'), null);
  assert.equal(parseBookingSvar('```json\n{"andet":1}\n```'), null);
  assert.equal(parseBookingSvar('```json\n{"booking":"ja"}\n```'), null);
  assert.equal(parseBookingSvar('```json\nikke json\n```'), null);
});

test('valider: Copenhagen wall time and an explicit offset both become the same instant', () => {
  const a = valider(oensk(), [STOR], NU);
  const b = valider(oensk({ start: '2026-11-07T09:00:00Z', slut: '2026-11-07T14:00:00.000Z' }), [STOR], NU);
  assert.ok(a.ok && b.ok);
  assert.deepEqual([a.tid.start, a.tid.slut], ['2026-11-07T09:00:00.000Z', '2026-11-07T14:00:00.000Z']);
  assert.deepEqual(b.tid, a.tid);
  assert.equal(a.r.id, 'stor-bil');
  assert.equal(a.titel, 'Indkøb');
});

test('valider refuses what is not sane — each with a plain Danish reason', () => {
  const nej = (x: Partial<BookingOensker>): string => { const r = valider(oensk(x), [STOR], NU); assert.ok(!r.ok, JSON.stringify(x)); return r.hvorfor; };
  assert.match(nej({ ressource: 'raket' }), /findes ikke/);
  assert.match(nej({ start: 'i morgen' }), /tidspunkt/);
  assert.match(nej({ slut: '2026-11-07T10:00' }), /efter/);
  assert.match(nej({ slut: '2026-11-07T09:00' }), /efter/);
  assert.match(nej({ start: '2026-11-02T08:00', slut: '2026-11-02T09:30' }), /gået/);
  const forFjern = new Date(NU.getTime() + (MAX_FREM_DAGE + 2) * 86_400_000).toISOString().slice(0, 10);
  assert.match(nej({ start: `${forFjern}T10:00`, slut: `${forFjern}T12:00` }), /14 dage/);
  assert.match(nej({ start: '2026-11-04T10:00', slut: '2026-11-12T10:00' }), /lang/);
  assert.match(nej({ start: '2026-02-30T10:00' }), /tidspunkt/);
});

test('valider: an empty title becomes "Tur", control characters go, the title is capped', () => {
  const tom = valider(oensk({ titel: '  ' }), [STOR], NU);
  assert.ok(tom.ok && tom.titel === 'Tur');
  const rod = valider(oensk({ titel: `Hej\u0000\nDig${'x'.repeat(300)}` }), [STOR], NU);
  assert.ok(rod.ok && rod.titel.length === 200 && !/[\u0000-\u001f]/.test(rod.titel));
});

test('udkastAabent: until the start, and for 24 hours', () => {
  const u: BookingUdkast = { id: 'u1', af: 'henrik', ressourceId: 'stor-bil', start: '2026-11-07T09:00:00.000Z', slut: '2026-11-07T14:00:00.000Z', titel: 'x', oprettet: NU.toISOString() };
  assert.ok(udkastAabent(u, NU));
  assert.ok(udkastAabent(u, new Date(NU.getTime() + 23 * 3600_000)));
  assert.ok(!udkastAabent(u, new Date(NU.getTime() + 25 * 3600_000)));
  assert.ok(!udkastAabent({ ...u, start: '2026-11-02T08:30:00.000Z' }, new Date('2026-11-02T08:31:00.000Z')));
});
