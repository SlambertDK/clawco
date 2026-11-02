// KC-0170 slice 2, Husstanden: fixed inputs for the household room's screens, rendered without a chosen language. The
// files in test/fixtures/sprog-husstand/ were captured from these inputs BEFORE the strings moved into
// src/hushold/tekster.ts; test/hushold/tekster.test.ts holds the renders to them byte for byte. Content (names,
// titles) is English or a name from FAMILIE on purpose, so that an English render has only chrome to be judged on.
// Change a golden only when the Danish copy changes on purpose.

import { html } from '../../src/shell/html.ts';
import { renderHusstand, renderIkkeHer } from '../../src/hushold/render.ts';
import { forespLog, forespSektion } from '../../src/hushold/foresp-render.ts';
import { ressourceSektion } from '../../src/hushold/ressource-render.ts';
import { konfliktSektion } from '../../src/hushold/konflikt-render.ts';
import { invitationSektion, renderInviter } from '../../src/hushold/invitation-render.ts';
import { anvend, nyForespoergsel, type Forespoergsel, type Haendelse } from '../../src/hushold/foresp.ts';
import { nySammenfald, type Booking, type Ressource } from '../../src/hushold/ressource.ts';
import { nytKonflikt, weekendKonflikter, type Blok, type Konflikt } from '../../src/hushold/konflikt.ts';
import type { BookingUdkast } from '../../src/hushold/bil.ts';
import type { Medlem } from '../../src/hushold/schema.ts';
import type { FaellesDag } from '../../src/hushold/uge.ts';
import type { Person } from '../../src/identitet/husstand.ts';
import type { LogEntry } from '../../src/store/types.ts';
import { FAMILIE } from '../../src/testtilstand/familie.ts';

/** Tuesday 2026-11-03, 09:00 in Copenhagen. */
export const NU = new Date('2026-11-03T08:00:00.000Z');
const H = FAMILIE.ejer.id, R = FAMILIE.partner.id, M = FAMILIE.medlem.id, E = FAMILIE.yngste.id, N = FAMILIE.barn.id;
const FARMOR = 'grandma';

const person = (id: string, rolle: Person['rolle'], navn: string): Person => ({ id, login: `${id}@example.com`, navn, rolle });
export const EJER = person(H, 'ejer', FAMILIE.ejer.navn);

export const MEDLEMMER: Medlem[] = [
  { id: H, navn: FAMILIE.ejer.navn, rolle: 'ejer' },
  { id: R, navn: FAMILIE.partner.navn, rolle: 'medlem', relation: 'your wife' },
  { id: M, navn: FAMILIE.medlem.navn, rolle: 'medlem', kanal: { kanal: 'signal', handle: '+4500000001', status: 'aktiv' } },
  { id: E, navn: FAMILIE.yngste.navn, rolle: 'barn' },
  { id: FARMOR, navn: 'Grandma', rolle: 'gaest' },
];

const UGE: FaellesDag[] = [
  { dato: '2026-11-03', poster: [] },
  { dato: '2026-11-04', poster: [
    { id: 'p1', titel: 'Grandma visits', start: '2026-11-04', slut: '2026-11-05', heldag: true, hvem: [], kilde: 'kalender' },
    { id: 'p2', titel: 'Dentist', start: '2026-11-04T16:30:00+01:00', slut: '2026-11-04T17:30:00+01:00', hvem: [M, H], heldag: false, kilde: 'kalender' },
  ] },
  { dato: '2026-11-07', poster: [
    { id: 'p3', titel: 'Football', start: '2026-11-07T10:00:00+01:00', slut: '2026-11-07T12:00:00+01:00', hvem: [E], heldag: false, kilde: 'kalender' },
    { id: 'p4', titel: 'Dinner', start: '2026-11-07T18:00:00+01:00', slut: '', hvem: [H, M, E], heldag: false, kilde: 'kalender' },
  ] },
];

// ---- requests ----------------------------------------------------------------------------------------------------

const TID = { start: '2026-11-05T15:00:00.000Z', slut: '2026-11-05T16:00:00.000Z' };
const ny = (id: string, fra: string, til: string, titel: string, tid?: typeof TID): Forespoergsel => nyForespoergsel({ id, fra, til, titel, ...(tid ? { tid } : {}) }, NU);
function efter(f: Forespoergsel, h: Haendelse, timer = 1): Forespoergsel {
  const r = anvend(f, h, new Date(NU.getTime() + timer * 3600_000));
  if (!r.ok) throw new Error(`golden: ${h.slags} refused`);
  return r.f;
}

const FORESP: Forespoergsel[] = [
  { ...ny('f1', H, M, 'Can you pick up Ella on Thursday?', TID), forslag: { anbefaling: 'You are free on Thursday.', alternativer: [{ kl: '16:30', tekst: 'Can 16:30' }] } },
  { ...ny('f2', H, M, 'Can you water the plants?'), paamindet: [`${M}:24t`] },
  efter({ ...ny('f3', M, H, 'Can you pay the plumber?', TID), paamindet: [`${M}:24t`] }, { slags: 'alternativ', af: H, alternativ: { start: '2026-11-05T16:30:00.000Z', slut: '2026-11-05T17:30:00.000Z', tekst: 'Can 17:30' } }),
  efter(ny('f4', H, M, 'Can you take the bins out?', TID), { slags: 'ja', af: M }),
  efter(ny('f5', M, H, 'Can you lend me the drill?'), { slags: 'nej', af: H }),
  efter(ny('f6', M, E, 'Can you set the table?'), { slags: 'udloeb' }, 49),
  efter(ny('f7', H, M, 'Can you book the barber?'), { slags: 'traek', af: H }),
  { ...ny('f8', M, FARMOR, 'Can you come on Sunday?'), kanal: { sendt: [{ tid: '2026-11-03T08:05:00.000Z', slags: 'foresp' }], beskeder: [{ tid: '2026-11-03T08:10:00.000Z', tekst: 'maybe, call me' }] } },
  efter({ ...ny('f9', M, E, 'Can you tidy your room?', TID) }, { slags: 'ja', af: E }),
];
// Ella is a child with no channel; Grandma (a guest) answers on hers: give her one so the go-between cards exist.
const MEDLEMMER_KANAL: Medlem[] = MEDLEMMER.map((m) => (m.id === FARMOR ? { ...m, kanal: { kanal: 'telegram' as const, handle: '123456', status: 'aktiv' as const } } : m));
const FORESP_SEND: Forespoergsel[] = [
  ny('s1', M, FARMOR, 'Can you come on Sunday?'),
  { ...ny('s2', M, FARMOR, 'Can you bring the cake?'), kanal: { sendt: [{ tid: '2026-11-03T08:05:00.000Z', slags: 'foresp' }], beskeder: [] } },
  { ...efter(ny('s3', H, FARMOR, 'Can you take Nora?'), { slags: 'ja', af: FARMOR }), historik: [{ tid: NU.toISOString(), tilstand: 'spurgt', af: H }, { tid: NU.toISOString(), tilstand: 'accepteret', af: FARMOR, via: 'kanal' }] },
];

const LOG: LogEntry[] = [
  { id: 'l1', tid: '2026-11-03T07:30:00.000Z', kilde: 'henrik', tekst: 'You asked Maja', zone: 'privat', ejer: H, fortryd: 'foresp:f1:1' },
  { id: 'l2', tid: '2026-11-03T07:00:00.000Z', kilde: 'henrik', tekst: 'You dropped the bins', zone: 'privat', ejer: H, fortrudt: '2026-11-03T07:10:00.000Z' },
  { id: 'l3', tid: '2026-11-03T06:00:00.000Z', kilde: 'system', tekst: 'Someone answered', zone: 'privat', ejer: R },
] as LogEntry[];

// ---- things and clashes ------------------------------------------------------------------------------------------

const b = (id: string, af: string, dag: number, fra: string, til: string, ressourceId = 'big-car', titel = 'Trip'): Booking =>
  ({ id, ressourceId, af, start: `2026-11-0${dag}T${fra}:00.000Z`, slut: `2026-11-0${dag}T${til}:00.000Z`, titel });
const STOR: Ressource = { id: 'big-car', navn: 'The big car', slags: 'bil', ejere: [H, R, M], kalender: [b('b1', R, 7, '07:00', '15:00', 'big-car', 'To Odense'), b('b0', M, 4, '07:00', '08:00')] };
const LILLE: Ressource = { id: 'small-car', navn: 'The small car', slags: 'bil', ejere: [H, R], kalender: [] };
const SAMMENFALD = nySammenfald({ id: 's1', ny: b('w1', H, 7, '09:00', '13:00', 'big-car', 'Shopping'), mod: STOR.kalender[0]!, ressourcer: [STOR, LILLE], nu: NU });
const UDKAST: BookingUdkast = { id: 'u1', af: H, ressourceId: 'small-car', start: '2026-11-07T09:00:00.000Z', slut: '2026-11-07T14:00:00.000Z', titel: 'Shopping', oprettet: NU.toISOString() };
const UDKAST_M: BookingUdkast = { ...UDKAST, id: 'u2', af: M };

// ---- the Saturday conflict ---------------------------------------------------------------------------------------

/** The weekend check wants two adults and a child who needs someone. */
const KONFLIKT_MEDLEMMER: Medlem[] = [{ id: H, navn: FAMILIE.ejer.navn, rolle: 'ejer' }, { id: R, navn: FAMILIE.partner.navn, rolle: 'medlem' }, { id: N, navn: FAMILIE.barn.navn, rolle: 'barn' }];
const blok = (hvem: string, fra: string, til: string, titel?: string): Blok => ({ hvem, start: `2026-11-07T${fra}:00+01:00`, slut: `2026-11-07T${til}:00+01:00`, med: [hvem], ...(titel ? { titel } : {}) });
const konflikt = (id: string, titelH?: string, titelR?: string): Konflikt =>
  nytKonflikt({ id, kandidat: weekendKonflikter([blok(H, '09:00', '14:00', titelH), blok(R, '11:00', '13:00', titelR)], { medlemmer: KONFLIKT_MEDLEMMER, ressourcer: [] }, ['2026-11-07'])[0]!, nu: NU });
const KONFLIKT = konflikt('k-1', 'Cycling', 'Coffee with Anne');
const KONFLIKT_OPTAGET = konflikt('k-2');
const KONFLIKT_VENTER: Konflikt = { ...konflikt('k-3', 'Cycling', 'Coffee with Anne'), forespId: 'fk', forespValg: 'v1' };
const FK = ny('fk', H, R, 'Can you take Nora on Saturday?', { start: '2026-11-07T10:00:00.000Z', slut: '2026-11-07T12:00:00.000Z' });

// ---- invitations --------------------------------------------------------------------------------------------------

const INVITATIONER: Medlem[] = [
  { id: H, navn: FAMILIE.ejer.navn, rolle: 'ejer' },
  { id: R, navn: FAMILIE.partner.navn, rolle: 'medlem', indgang: { status: 'venter', oprettet: NU.toISOString() } },
  { id: M, navn: FAMILIE.medlem.navn, rolle: 'medlem', kanal: { kanal: 'signal', handle: '+4500000001', status: 'afventer-ja' } },
  { id: N, navn: FAMILIE.barn.navn, rolle: 'barn', kanal: { kanal: 'telegram', handle: '123456', status: 'afventer-ja', inviteret: '2026-11-03T07:30:00.000Z' } },
  { id: E, navn: FAMILIE.yngste.navn, rolle: 'gaest', kanal: { kanal: 'whatsapp', handle: '+4500000002', status: 'afventer-ja', inviteret: '2026-11-03T07:00:00.000Z' } },
];

// ---- the cases ---------------------------------------------------------------------------------------------------

const sek = (person: string, f: Forespoergsel[], medlemmer: Medlem[] = MEDLEMMER, ekstra: { kanSvare?: boolean; kanSpoerge?: boolean } = {}) =>
  forespSektion({ forespoergsler: f, person, medlemmer, now: NU, ...ekstra });
const ress = (person: string, o: { sammenfald?: ReturnType<typeof nySammenfald>[]; udkast?: BookingUdkast[]; forespoergsler?: Forespoergsel[] } = {}) =>
  ressourceSektion({ ressourcer: [STOR, LILLE], sammenfald: o.sammenfald ?? [], forespoergsler: o.forespoergsler ?? [], udkast: o.udkast ?? [], person, medlemmer: MEDLEMMER, now: NU });
const kons = (person: string, konflikter: Konflikt[], forespoergsler: Forespoergsel[] = []) => konfliktSektion({ konflikter, forespoergsler, person, medlemmer: MEDLEMMER, now: NU });

export const HUSSTAND: Record<string, () => string> = {
  /** The owner's whole room: invitations, requests, things, clashes, the weekend card, the week, who is in it. */
  'ejer-hele-rummet': () => String(renderHusstand({
    medlemmer: INVITATIONER, person: EJER, uge: UGE, now: NU, kanRette: true,
    invitationer: invitationSektion({ medlemmer: INVITATIONER, person: EJER, kanSende: true }),
    forespoergsler: html`${sek(H, FORESP, MEDLEMMER)}${ress(H, { sammenfald: [SAMMENFALD], udkast: [UDKAST] })}${kons(H, [KONFLIKT, KONFLIKT_OPTAGET])}${forespLog({ log: LOG, forespoergsler: FORESP, person: H, now: NU })}`,
  })),
  /** A member with nothing in the week and no requests: the empty states. */
  'medlem-tomt': () => String(renderHusstand({ medlemmer: MEDLEMMER, person: person(M, 'medlem', FAMILIE.medlem.navn), uge: [{ dato: '2026-11-03', poster: [] }], now: NU, forespoergsler: ress(M) })),
  /** A guest: her requests only, no shared week. */
  'gaest': () => String(renderHusstand({ medlemmer: MEDLEMMER, person: person(FARMOR, 'gaest', 'Grandma'), uge: UGE, now: NU, faelles: false, forespoergsler: sek(FARMOR, FORESP, MEDLEMMER, { kanSvare: false }) })),
  'ikke-her': () => String(renderIkkeHer()),
  /** The requests from the recipient's side (Maja). */
  'foresp-modtager': () => String(sek(M, FORESP)),
  /** The same requests from the asker's side (Henrik), a red Send where the go-between may go, and the owner's answers on a channel. */
  'foresp-asker': () => String(sek(H, [...FORESP, ...FORESP_SEND], MEDLEMMER_KANAL)),
  'foresp-asker-kanal': () => String(sek(M, FORESP_SEND, MEDLEMMER_KANAL)),
  'foresp-ingen-ny': () => String(sek(FARMOR, FORESP, MEDLEMMER, { kanSvare: false, kanSpoerge: false })),
  'foresp-log': () => String(forespLog({ log: LOG, forespoergsler: FORESP, person: H, now: NU })),
  /** Things: the owner's view (a booking form, Ret, a draft, a clash) and a non-owner's (Ask instead of Book). */
  'ressourcer-ejer': () => String(ress(H, { sammenfald: [SAMMENFALD], udkast: [UDKAST] })),
  'ressourcer-andre': () => String(ress(M, { udkast: [UDKAST_M] })),
  'ressourcer-venter': () => String(ressourceSektion({ ressourcer: [STOR, LILLE], sammenfald: [{ ...SAMMENFALD, forespId: 'fk' }], forespoergsler: [{ ...FK, id: 'fk', fra: H, til: R }], person: H, medlemmer: MEDLEMMER, now: NU })),
  'konflikt-aaben': () => String(kons(H, [KONFLIKT, KONFLIKT_OPTAGET])),
  'konflikt-venter': () => String(kons(H, [KONFLIKT_VENTER], [FK])) + String(kons(R, [KONFLIKT_VENTER], [FK])),
  'invitationer': () => String(invitationSektion({ medlemmer: INVITATIONER, person: EJER, kanSende: true })),
  'invitationer-uden-kanal': () => String(invitationSektion({ medlemmer: INVITATIONER, person: EJER, kanSende: false })),
  'inviter-enebruger': () => String(renderInviter({ enebruger: true, plads: true })),
  'inviter': () => String(renderInviter({ enebruger: false, plads: true })),
  'inviter-fuldt': () => String(renderInviter({ enebruger: false, plads: false })),
};

/** The inputs of the English render checks that need more than a golden: the same pieces, exposed. */
export const DELE = { MEDLEMMER, MEDLEMMER_KANAL, FORESP, FORESP_SEND, KONFLIKT, KONFLIKT_VENTER, FK, STOR, LILLE, SAMMENFALD, UDKAST, UDKAST_M, UGE, INVITATIONER, LOG, EJER };
