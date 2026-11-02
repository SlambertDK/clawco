// KC-0150: the ressource block (name, kind, owner circle, next bookings, a
// seven-day strip, the booking form) and the clash card — the existing
// beslutning block — that the two bookers see with the same options in the same
// order. Blue only for the viewer's own first option; anything that asks the
// other person is red (KC-0067); every name and title escaped (§4 r9).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ressourceForm, ressourceBlok, ressourceSektion, sammenfaldKort, udkastKort } from '../../src/hushold/ressource-render.ts';
import { nySammenfald, type Booking, type Ressource } from '../../src/hushold/ressource.ts';
import type { Medlem } from '../../src/hushold/schema.ts';
import { BYGGET, BLOKKE } from '../../src/shell/katalog.ts';
import type { BookingUdkast } from '../../src/hushold/bil.ts';

const NU = new Date('2026-11-05T07:00:00.000Z'); // Thursday 08.00 in Copenhagen
const MEDLEMMER: Medlem[] = [
  { id: 'henrik', navn: 'Henrik', rolle: 'ejer' },
  { id: 'rikke', navn: 'Rikke', rolle: 'medlem' },
  { id: 'maja', navn: 'Maja', rolle: 'medlem' },
  { id: 'farmor', navn: 'Farmor', rolle: 'gaest' },
];
const b = (id: string, af: string, dag: number, fra: string, til: string, ressourceId = 'stor-bil', titel = 'Tur'): Booking =>
  ({ id, ressourceId, af, start: `2026-11-0${dag}T${fra}:00.000Z`, slut: `2026-11-0${dag}T${til}:00.000Z`, titel });
const STOR: Ressource = { id: 'stor-bil', navn: 'Den store bil', slags: 'bil', ejere: ['henrik', 'rikke', 'maja'], kalender: [b('b1', 'rikke', 7, '07:00', '15:00', 'stor-bil', 'Til Odense'), b('b0', 'maja', 4, '07:00', '08:00')] };
const LILLE: Ressource = { id: 'lille-bil', navn: 'Den lille bil', slags: 'bil', ejere: ['henrik', 'rikke'], kalender: [] };
const antal = (h: string, re: RegExp): number => (h.match(re) ?? []).length;
const PRIMAER = /class="btn btn-primary"/g;
const ROED = /class="btn btn-graense"/g;
/** The block without its "Ret" disclosure (KC-0215), whose Fjern is red by design. */
const utenRet = (h: string): string => h.replace(/<details class="ressource-ret"[\s\S]*<\/details>/, '');

test('the block: kind, owner circle, next bookings (past ones gone), a strip of seven days', () => {
  const h = String(ressourceBlok({ r: STOR, person: 'henrik', medlemmer: MEDLEMMER, now: NU }));
  assert.match(h, /data-blok="ressource"/);
  assert.match(h, /data-ressource="stor-bil"/);
  assert.match(h, /data-ressource-slags="bil"/);
  assert.match(h, /data-ressource-ejere>Du, Rikke og Maja</);
  assert.match(h, /data-booking="b1"/);
  assert.doesNotMatch(h, /data-booking="b0"/, 'a booking that has ended is gone');
  assert.match(h, /Lørdag 7\. nov kl\. 08\.00–16\.00 · Rikke · Til Odense/);
  assert.equal(antal(h, /data-strip-dag="/g), 7);
  assert.match(h, /data-strip-dag="2026-11-07" data-strip-optaget/);
  assert.doesNotMatch(h, /data-strip-dag="2026-11-06" data-strip-optaget/);
});

test('an owner books with the one blue button; a non-owner asks the first owner, red', () => {
  const ejer = String(ressourceBlok({ r: LILLE, person: 'rikke', medlemmer: MEDLEMMER, now: NU }));
  assert.equal(antal(ejer, PRIMAER), 1);
  assert.match(ejer, /class="btn btn-primary" data-aktion="book" data-arg="\{&quot;ressourceId&quot;:&quot;lille-bil&quot;\}" data-form="book-lille-bil"/);
  assert.equal(antal(utenRet(ejer), ROED), 0, 'booking is the owner\'s own act');
  const ikke = String(ressourceBlok({ r: LILLE, person: 'maja', medlemmer: MEDLEMMER, now: NU }));
  assert.equal(antal(ikke, PRIMAER), 0);
  assert.match(ikke, /class="btn btn-graense" data-aktion="book-spoerg"[^>]*>Spørg Henrik</);
  assert.match(ikke, /data-kraever-ja/);
  // A person-resource is drawn like any other.
  const ella = String(ressourceBlok({ r: { id: 'ella', navn: 'Ella', slags: 'person', ejere: ['maja'], kalender: [] }, person: 'maja', medlemmer: MEDLEMMER, now: NU }));
  assert.match(ella, /data-ressource-slags="person"/);
});

const s = nySammenfald({ id: 's1', ny: b('w1', 'henrik', 7, '09:00', '13:00', 'stor-bil', 'Indkøb'), mod: STOR.kalender[0]!, ressourcer: [STOR, LILLE], nu: NU });
const kort = (person: string, x = s): string => String(sammenfaldKort({ s: x, ressourcer: [STOR, LILLE], forespoergsler: [], person, medlemmer: MEDLEMMER, now: NU }));
const valgIder = (h: string): string[] => [...h.matchAll(/data-sammenfald-valg="([^"]+)"/g)].map((m) => m[1]!);

test('the clash card is the beslutning block, same options in the same order for both, neutral sender', () => {
  const henrik = kort('henrik'), rikke = kort('rikke');
  for (const h of [henrik, rikke]) {
    assert.match(h, /data-blok="beslutning"/);
    assert.match(h, /data-sammenfald="s1"/);
    assert.match(h, /Fra Husstanden/);
    assert.match(h, /Den store bil er booket to gange/);
  }
  assert.deepEqual(valgIder(henrik), ['v1', 'v2', 'v3', 'v4']);
  assert.deepEqual(valgIder(rikke), valgIder(henrik));
  // Differs only in du / the name.
  assert.match(henrik, /Rikke har den store bil lørdag 7\. nov kl\. 08\.00–16\.00 \(Til Odense\)\. Du vil gerne have den kl\. 10\.00–14\.00 \(Indkøb\)\./);
  assert.match(rikke, /Du har den store bil lørdag 7\. nov kl\. 08\.00–16\.00 \(Til Odense\)\. Henrik vil gerne have den kl\. 10\.00–14\.00 \(Indkøb\)\./);
});

test('own options are actions (the first blue), the other person\'s are red asks; the ticket\'s "Spørg Rikke om at bytte"', () => {
  const henrik = kort('henrik');
  assert.equal(antal(henrik, PRIMAER), 1);
  assert.match(henrik, /class="btn btn-primary" data-aktion="sammenfald-valg"[^>]*data-sammenfald-valg="v1">Tag den lille bil</);
  assert.match(henrik, /class="btn btn-graense" data-aktion="sammenfald-spoerg"[^>]*data-sammenfald-valg="v2"[^>]*>Spørg Rikke om at bytte</);
  assert.match(henrik, /data-sammenfald-valg="v3"[^>]*>Spørg Rikke om at tage den lille bil</);
  assert.match(henrik, /class="btn" data-aktion="sammenfald-valg"[^>]*data-sammenfald-valg="v4">Drop det, Rikke beholder den</);
  const rikke = kort('rikke');
  assert.equal(antal(rikke, PRIMAER), 0, "Rikke's first option is Henrik's: red, never blue");
  assert.match(rikke, /data-sammenfald-valg="v1"[^>]*>Spørg Henrik om at tage den lille bil</);
  assert.match(rikke, /data-aktion="sammenfald-valg"[^>]*data-sammenfald-valg="v2">Lad Henrik få den</);
  assert.match(rikke, /data-sammenfald-valg="v4"[^>]*>Spørg Henrik om at droppe det</);
});

test("Hermes' suggestion comes first with its one sentence, for both", () => {
  const x = { ...s, forslag: { foerste: 'v2', anbefaling: 'Rikke kører hele dagen; den lille bil er fri.' } };
  for (const p of ['henrik', 'rikke']) {
    const h = kort(p, x);
    assert.deepEqual(valgIder(h), ['v2', 'v1', 'v3', 'v4']);
    assert.match(h, /data-sammenfald-anbefaling>Rikke kører hele dagen; den lille bil er fri\.</);
  }
  assert.equal(antal(kort('rikke', x), PRIMAER), 1, 'now the first option is her own');
});

test('a request already sent from the card: no second ask, the card says it waits', () => {
  const x = { ...s, forespId: 'f-1', forespValg: 'v2' };
  const f = { id: 'f-1', fra: 'henrik', til: 'rikke', titel: 'x', tilstand: 'spurgt' as const, oprettet: NU.toISOString(), udloeber: '2026-11-06T07:00:00.000Z', paamindet: [], historik: [{ tid: NU.toISOString(), tilstand: 'spurgt' as const, af: 'henrik' }] };
  const h = String(sammenfaldKort({ s: x, ressourcer: [STOR, LILLE], forespoergsler: [f], person: 'henrik', medlemmer: MEDLEMMER, now: NU }));
  assert.equal(antal(h, /data-aktion="sammenfald-spoerg"/g), 0);
  assert.match(h, /data-sammenfald-venter>Du har spurgt Rikke\. Venter på svar\.</);
});

test('the section: open clashes only for their two parties; blocks for everyone in the household', () => {
  const v = (person: string) => String(ressourceSektion({ ressourcer: [STOR, LILLE], sammenfald: [s], forespoergsler: [], person, medlemmer: MEDLEMMER, now: NU }));
  assert.match(v('henrik'), /data-sammenfald="s1"/);
  assert.match(v('rikke'), /data-sammenfald="s1"/);
  assert.doesNotMatch(v('maja'), /data-sammenfald=/, 'another owner of the same car sees no card');
  assert.equal(antal(v('maja'), /data-blok="ressource"/g), 2);
  const afgjort = { ...s, afgjort: { valg: 'v4', af: 'henrik', tid: NU.toISOString() } };
  assert.doesNotMatch(String(ressourceSektion({ ressourcer: [STOR], sammenfald: [afgjort], forespoergsler: [], person: 'henrik', medlemmer: MEDLEMMER, now: NU })), /data-sammenfald=/);
});

test('every name and title is escaped', () => {
  const ond: Ressource = { ...STOR, navn: '<img src=x onerror=alert(1)>', kalender: [{ ...STOR.kalender[0]!, titel: '<script>x</script>' }] };
  const med = [...MEDLEMMER.slice(0, 1), { id: 'rikke', navn: '"><b>Rikke', rolle: 'medlem' as const }];
  const blok = String(ressourceBlok({ r: ond, person: 'henrik', medlemmer: med, now: NU }));
  const x = nySammenfald({ id: 's2', ny: { ...s.ny, titel: '<i>ind</i>' }, mod: ond.kalender[0]!, ressourcer: [ond], nu: NU });
  const kortet = String(sammenfaldKort({ s: x, ressourcer: [ond], forespoergsler: [], person: 'henrik', medlemmer: med, now: NU }));
  for (const h of [blok, kortet]) {
    assert.doesNotMatch(h, /<img|<script|<b>|<i>/);
  }
  assert.match(blok, /&lt;img src=x/);
});

test('the catalog: ressource is built, its kinds from SLAGS', () => {
  assert.ok(BYGGET.includes('ressource'));
  const r = BLOKKE.find((x) => x.id === 'ressource')!;
  assert.deepEqual(r.felter.properties?.['slags']?.enum, ['bil', 'rum', 'ting', 'person']);
});

// ---------- KC-0151: the booking card and "Tilføj bil" ----------

const UDKAST: BookingUdkast = { id: 'u1', af: 'henrik', ressourceId: 'lille-bil', start: '2026-11-07T09:00:00.000Z', slut: '2026-11-07T14:00:00.000Z', titel: 'Indkøb', oprettet: NU.toISOString() };

test('the draft card for an owner: one blue Book button named with the car, day and time, and a Drop', () => {
  const h = String(udkastKort({ u: UDKAST, r: LILLE, person: 'henrik', medlemmer: MEDLEMMER, now: NU }));
  assert.match(h, /data-blok="beslutning" data-udkast="u1"/);
  assert.equal(antal(h, PRIMAER), 1);
  assert.match(h, /<button type="button" class="btn btn-primary" data-aktion="udkast-book" data-arg="\{&quot;id&quot;:&quot;u1&quot;\}"[^>]*>Book den lille bil lørdag 7\. nov kl\. 10\.00–15\.00<\/button>/);
  assert.equal(antal(h, ROED), 0, 'booking is the owner\'s own act, not an ask');
  assert.match(h, /data-aktion="udkast-drop"[^>]*>Drop</);
  assert.match(h, /Indkøb/);
});

test('the draft card for a non-owner: no booking button at all, one red ask to the first owner', () => {
  const h = String(udkastKort({ u: { ...UDKAST, af: 'maja' }, r: LILLE, person: 'maja', medlemmer: MEDLEMMER, now: NU }));
  assert.equal(antal(h, PRIMAER), 0);
  assert.doesNotMatch(h, /data-aktion="udkast-book"/);
  assert.equal(antal(h, ROED), 1);
  assert.match(h, /data-aktion="udkast-spoerg"[^>]*>Spørg Henrik om at låne den lille bil</);
  const ingen = String(udkastKort({ u: { ...UDKAST, af: 'farmor' }, r: { ...LILLE, ejere: ['farmor'] }, person: 'farmor', medlemmer: MEDLEMMER, now: NU }));
  assert.doesNotMatch(ingen, /data-aktion="udkast-spoerg"/, 'nobody to ask');
});

test('the section shows the viewer\'s own drafts only, and an expired draft is gone', () => {
  const v = (person: string, udkast: BookingUdkast[]) => String(ressourceSektion({ ressourcer: [STOR, LILLE], sammenfald: [], forespoergsler: [], udkast, person, medlemmer: MEDLEMMER, now: NU }));
  assert.match(v('henrik', [UDKAST]), /data-udkast="u1"/);
  assert.doesNotMatch(v('rikke', [UDKAST]), /data-udkast=/);
  assert.doesNotMatch(v('henrik', [{ ...UDKAST, oprettet: '2026-11-03T07:00:00.000Z' }]), /data-udkast=/, 'older than 24 hours');
  assert.doesNotMatch(v('henrik', [{ ...UDKAST, ressourceId: 'findes-ikke' }]), /data-udkast=/, 'its car is gone');
});

test('Tilføj bil: a form with the household\'s non-guest members as owner checkboxes, for members and owners only', () => {
  const h = String(ressourceForm({ person: 'henrik', medlemmer: MEDLEMMER }));
  assert.match(h, /name="navn"/);
  for (const id of ['henrik', 'rikke', 'maja']) assert.match(h, new RegExp(`name="ejer-${id}"`));
  assert.doesNotMatch(h, /name="ejer-farmor"/, 'a guest cannot own a car');
  assert.match(h, /name="ejer-henrik" checked/, 'the one adding is an owner by default');
  assert.match(h, /<select name="slags"[^>]*>\s*<option value="bil" selected>Bil<\/option>\s*<option value="rum">Rum<\/option>\s*<option value="ting">Ting<\/option>\s*<\/select>/, 'the kinds of the list, not person');
  assert.doesNotMatch(h, /name="ejer-rikke" checked/);
  assert.match(h, /data-aktion="tilfoej-ressource"/);
  const barn = [...MEDLEMMER, { id: 'ella', navn: 'Ella', rolle: 'barn' as const }];
  assert.equal(String(ressourceForm({ person: 'ella', medlemmer: barn })), '', 'a child adds no cars');
  assert.equal(String(ressourceForm({ person: 'farmor', medlemmer: MEDLEMMER })), '', 'a guest adds no cars');
});

test('Tilføj bil is in the section even before the first car; a household with no cars and no card shows only that', () => {
  const h = String(ressourceSektion({ ressourcer: [], sammenfald: [], forespoergsler: [], udkast: [], person: 'henrik', medlemmer: MEDLEMMER, now: NU }));
  assert.match(h, /data-ressource-form/);
  assert.doesNotMatch(h, /data-blok="ressource"/);
});

test('the draft card and the form escape every name and title', () => {
  const ond: Ressource = { ...LILLE, navn: '<img src=x onerror=alert(1)>' };
  const med = [{ id: 'henrik', navn: '<b>Henrik</b>', rolle: 'ejer' as const }, { id: 'maja', navn: '"><script>', rolle: 'medlem' as const }];
  const kort = String(udkastKort({ u: { ...UDKAST, titel: '<i>x</i>' }, r: ond, person: 'henrik', medlemmer: med, now: NU }));
  const spoerg = String(udkastKort({ u: { ...UDKAST, af: 'maja' }, r: { ...ond, ejere: ['henrik'] }, person: 'maja', medlemmer: med, now: NU }));
  for (const h of [kort, spoerg, String(ressourceForm({ person: 'henrik', medlemmer: med }))]) assert.doesNotMatch(h, /<img|<script|<b>|<i>/);
});

// ---------- KC-0215: Ret and Fjern on the block ----------

const RET = (r: Ressource, person: string, medlemmer: Medlem[] = MEDLEMMER): string => String(ressourceBlok({ r, person, medlemmer, now: NU }));

test('an owner of the thing gets "Ret": a form with the name, kind and owners filled in, and a quiet Gem (the one blue stays Book)', () => {
  const h = RET(STOR, 'maja');
  assert.match(h, /<details class="ressource-ret" data-ressource-ret="stor-bil">/);
  assert.match(h, /<form id="ret-stor-bil"/);
  assert.match(h, /name="navn"[^>]*value="Den store bil"/);
  assert.match(h, /<option value="bil" selected>Bil<\/option>/);
  for (const id of ['henrik', 'rikke', 'maja']) assert.match(h, new RegExp(`name="ejer-${id}" checked`));
  assert.doesNotMatch(h, /name="ejer-farmor"/, 'a guest cannot own');
  assert.match(h, /<button type="button" class="btn" data-aktion="ret-ressource" data-arg="\{&quot;ressourceId&quot;:&quot;stor-bil&quot;\}" data-form="ret-stor-bil"[^>]*>Gem<\/button>/);
  assert.equal(antal(h, PRIMAER), 1, 'Book is the only blue button');
});

test('the owner circle checkboxes are unchecked for those outside it', () => {
  const h = RET(LILLE, 'henrik');
  assert.match(h, /name="ejer-henrik" checked/);
  assert.match(h, /name="ejer-rikke" checked/);
  assert.match(h, /name="ejer-maja">/, 'maja is not an owner of the small car');
  assert.doesNotMatch(h, /name="ejer-maja" checked/);
});

test('Fjern: a confirmation inside the disclosure with exactly one red button that names the thing (the verb needs a human yes)', () => {
  const h = RET(LILLE, 'rikke');
  assert.match(h, /<details class="ressource-fjern" data-ressource-fjern>/);
  assert.equal(antal(h, ROED), 1);
  assert.match(h, /class="btn btn-graense" data-aktion="fjern-ressource" data-arg="\{&quot;ressourceId&quot;:&quot;lille-bil&quot;\}"[^>]*data-kraever-ja[^>]*>Ja, fjern den lille bil</);
});

test('nobody else gets Ret or Fjern: an adult outside the circle, a child, a guest — the household owner outside the circle does', () => {
  assert.doesNotMatch(RET(LILLE, 'maja'), /data-ressource-ret|fjern-ressource/);
  const barn = [...MEDLEMMER, { id: 'ella', navn: 'Ella', rolle: 'barn' as const }];
  assert.doesNotMatch(RET({ ...LILLE, ejere: ['ella'] }, 'ella', barn), /data-ressource-ret|fjern-ressource/);
  assert.doesNotMatch(RET({ ...LILLE, ejere: ['farmor'] }, 'farmor'), /data-ressource-ret|fjern-ressource/);
  assert.match(RET({ ...LILLE, ejere: ['rikke'] }, 'henrik'), /data-ressource-ret="lille-bil"/);
});

test('a person-resource is edited without a kind; the block says what Fjern does to the bookings', () => {
  const ella: Ressource = { id: 'ella', navn: 'Ella', slags: 'person', ejere: ['henrik'], kalender: [] };
  const h = RET(ella, 'henrik');
  assert.match(h, /data-ressource-ret="ella"/);
  assert.doesNotMatch(h, /<select name="slags"/);
  const med = RET({ ...LILLE, kalender: [b('k1', 'henrik', 7, '09:00', '11:00', 'lille-bil')] }, 'henrik');
  assert.match(med, /Overståede bookinger og dine egne går med/, 'the confirmation says which bookings go with it');
});

test('Ret and Fjern escape the name and the owners\' names', () => {
  const ond: Ressource = { ...LILLE, navn: '"><img src=x onerror=alert(1)>' };
  const med = [{ id: 'henrik', navn: '<b>Henrik</b>', rolle: 'ejer' as const }, { id: 'rikke', navn: '"><script>', rolle: 'medlem' as const }];
  const h = RET(ond, 'henrik', med);
  assert.doesNotMatch(h, /<img|<script|<b>/);
  assert.match(h, /value="&quot;&gt;&lt;img src=x/);
});
