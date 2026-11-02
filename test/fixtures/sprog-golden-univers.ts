// KC-0170: fixed inputs for the Univers room's screens, rendered without a chosen language. The files in
// test/fixtures/sprog-univers/ were captured from these inputs BEFORE the strings moved into
// src/rooms/univers/tekster.ts; test/rooms/univers-tekster.test.ts holds the renders to them byte for byte.
// Change a golden only when the Danish copy changes on purpose. The titles and notes below carry no Danish word
// or letter, so an English render shows only the room's own words.

import { renderOversigt, renderUnivers, renderMoedeVisning } from '../../src/rooms/univers/render.ts';
import { tomtIndeks, tomtUnivers, type Moede, type UniversIndeks, type UniversInfo, type UniversState } from '../../src/rooms/univers/schema.ts';
import type { LogEntry } from '../../src/store/types.ts';
import { FAMILIE } from '../../src/testtilstand/familie.ts';

/** 11.00 in Copenhagen. */
export const NU = new Date('2026-10-27T10:00:00Z');

const info: UniversInfo = { id: 'arena', navn: 'Roadmap', om: 'The new lead role and what to deliver in it', oprettet: '2026-10-01T08:00:00Z' };
const indeks: UniversIndeks = {
  univers: [info, { id: 'gammelt', navn: 'Archive', om: '', oprettet: 't', arkiveret: 't2' }, { id: 'hus', navn: 'Cabin', om: 'Renovation', oprettet: 't' }],
  nyeMoeder: [
    { eventId: 'ev1', titel: 'Kickoff', start: '2026-10-28T08:30:00Z', slut: '2026-10-28T09:30:00Z', sted: 'Room 4', deltagere: [{ navn: FAMILIE.partner.navn }, { navn: FAMILIE.barn.navn }] },
    { eventId: 'ev2', titel: 'Lunch', start: '2026-10-24T11:00:00Z', slut: '2026-10-24T12:15:00Z', deltagere: [] },
  ],
  skjulteMoeder: [],
};

const forberedt: Moede = {
  id: 'moede-1', kilde: 'kalender', eventId: 'e1', titel: 'Pitch to the board', start: '2026-10-27T10:30:00Z', slut: '2026-10-27T11:30:00Z', sted: 'Teams',
  deltagere: [{ navn: FAMILIE.partner.navn }],
  forberedelse: {
    maal: 'Get the role confirmed', talepunkter: ['First this', 'Then that', 'Last the ask'], dokumentId: 'dok-1', tid: '2026-10-27T09:00:00Z',
    deltagere: [
      { navn: FAMILIE.partner.navn, hvem: 'Chair', baggrund: 'Joined last year', vil: 'Clear numbers' },
      { navn: FAMILIE.barn.navn, hvem: 'Advisor', baggrund: '', vil: '' },
    ],
  },
};
const ufoert: Moede = { id: 'moede-2', kilde: 'manuel', titel: 'Internal sync', start: '2026-10-29T10:00:00Z', slut: '2026-10-29T11:00:00Z', deltagere: [{ navn: FAMILIE.medlem.navn }, { navn: FAMILIE.yngste.navn }] };
const fortid: Moede = { id: 'moede-0', kilde: 'manuel', titel: 'Wrapped up', start: '2026-10-26T10:00:00Z', slut: '2026-10-26T11:00:00Z', deltagere: [] };
const koerende: Moede = { ...forberedt, id: 'moede-3', titel: 'Running now', start: '2026-10-27T09:30:00Z', slut: '2026-10-27T10:45:00Z' };
const lang: Moede = { ...ufoert, id: 'moede-4', titel: 'Workshop', start: '2026-10-27T13:00:00Z', slut: '2026-10-27T16:30:00Z', sted: 'Studio' };

const state: UniversState = {
  dokumenter: [
    { id: 'dok-1', titel: 'Board pitch', html: '<p>Slide</p>', tekst: 'Slide', versioner: [{ html: 'a', tekst: 'a', tid: 't' }], moedeId: 'moede-1', oprettet: '2026-10-27T08:00:00Z', aendret: '2026-10-27T09:00:00Z' },
    { id: 'dok-2', titel: 'Brief', html: '<p>x</p>', tekst: 'x', versioner: [], oprettet: '2026-10-25T08:00:00Z', aendret: '2026-10-26T09:00:00Z' },
  ],
  noter: [{ id: 'note-1', titel: 'Thought', tekst: 'Remember to ask', oprettet: '2026-10-24T08:00:00Z' }],
  opgaver: [
    { id: 'opg-1', titel: 'Find the numbers', status: 'aaben', moedeId: 'moede-1', note: 'from Q3' },
    { id: 'opg-2', titel: 'Call back', status: 'igang' },
    { id: 'opg-3', titel: 'Finished thing', status: 'faerdig' },
  ],
  moeder: [fortid, ufoert, forberedt, koerende, lang],
};

const log: LogEntry[] = [
  { id: 'l1', tid: '2026-10-27T09:00:00Z', kilde: 'hermes', tekst: 'Prepared the pitch', fortryd: 'undo it' },
  { id: 'l2', tid: '2026-10-27T08:00:00Z', kilde: 'hermes', tekst: 'Added a task', fortryd: 'undo it', fortrudt: '2026-10-27T08:30:00Z' },
  { id: 'l3', tid: '2026-10-27T07:00:00Z', kilde: 'system', tekst: 'Read the calendar' },
];

const igang = [{ id: 'r1', label: 'Preparing the pitch', status: 'running' as const }, { id: 'r2', label: 'Placing a meeting', status: 'queued' as const }];

export const OVERSIGT = (): string => String(renderOversigt(indeks, { arena: { moeder: 2, aabneOpgaver: 3, dokumenter: 1 }, hus: { moeder: 1, aabneOpgaver: 1, dokumenter: 0 } }, NU, igang, { husstand: true }));
export const OVERSIGT_UDEN_UNIVERS = (): string => String(renderOversigt({ ...tomtIndeks(), nyeMoeder: indeks.nyeMoeder }, {}, NU, [], { husstand: true }));
export const OVERSIGT_TOM = (): string => String(renderOversigt(tomtIndeks(), {}, NU));
export const UNIVERS_FULD = (): string => String(renderUnivers(info, state, NU, { log, igang }));
export const UNIVERS_TOM = (): string => String(renderUnivers({ ...info, om: '' }, tomtUnivers(), NU));
export const MOEDE_FORBEREDT = (): string => String(renderMoedeVisning(info, forberedt, state, NU));
export const MOEDE_KOERENDE = (): string => String(renderMoedeVisning(info, koerende, state, NU));
export const MOEDE_UFOERT = (): string => String(renderMoedeVisning(info, ufoert, state, NU));
export const MOEDE_LANG = (): string => String(renderMoedeVisning(info, lang, { ...state, moeder: [lang] }, NU));

/** Every golden: file name → render. */
export const UNIVERS: Record<string, () => string> = {
  oversigt: OVERSIGT, 'oversigt-uden-univers': OVERSIGT_UDEN_UNIVERS, 'oversigt-tom': OVERSIGT_TOM,
  'univers-fuld': UNIVERS_FULD, 'univers-tom': UNIVERS_TOM,
  'moede-forberedt': MOEDE_FORBEREDT, 'moede-koerende': MOEDE_KOERENDE, 'moede-ufoert': MOEDE_UFOERT, 'moede-lang': MOEDE_LANG,
};
