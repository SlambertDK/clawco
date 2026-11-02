// KC-0170 slice 2: fixed inputs for Dagen's screens, rendered without a chosen language. The files in
// test/fixtures/sprog-dagen/ were captured from these inputs BEFORE the strings moved into src/rooms/dagen/tekster.ts;
// test/rooms/dagen-tekster.test.ts holds the renders to them byte for byte. The content (titles, notes) has no Danish
// letters or words, so an English render shows only chrome the room owns. Change a golden only when the Danish copy
// changes on purpose.

import { renderDagen, renderDagenEmpty } from '../../src/rooms/dagen/render.ts';
import type { DagenState } from '../../src/rooms/dagen/schema.ts';
import type { LogEntry } from '../../src/store/types.ts';
import { krop } from './sprog-golden.ts';

/** 09:00 on Monday 26 Oct 2026 in Copenhagen (CET). */
export const DAGEN_NU = new Date('2026-10-26T08:00:00.000Z');

export const dagenFuld: DagenState = {
  dato: '2026-10-26', genereret: '2026-10-26T06:00:00.000Z', vejr: '7 °C, regn fra 11',
  treLinjer: ['Main meeting at 10.', 'Free from 13.', 'The train leaves 16.42.'],
  anbefaling: { tekst: 'Use the free hour on the draft.', overskrift: 'Block 13 for the draft', handling: { id: 'block-13', label: 'Block 13', instruktion: 'i', fortryd: 'f' } },
  kalender: [
    { tid: '10.00', slut: '11.00', titel: 'Operations: winter plan', note: 'Material is ready.', status: 'klar', handling: { id: 'cal-1-prepare', label: 'Prepare', instruktion: 'i' } },
    { tid: '12.00', titel: 'Lunch', handling: { id: 'cal-2-pay', label: 'Pay the bill', instruktion: 'i', verb: 'betal' } },
    { tid: '14.30', titel: 'Internal: supplier choice', status: 'flyttet' },
    { tid: '16.00', titel: 'Call', status: 'aflyst' },
  ],
  morgenavis: [
    { titel: 'Energy firm tightens reserves', hvorfor: 'Relevant for the meeting.', kilde: 'Example Energy', url: 'https://example.org/a' },
    { titel: 'A note without a link', hvorfor: 'Background.' },
  ],
  ugen: [
    { dato: '2026-10-27', note: 'Quiet day.', aftaler: [{ tid: '09.00', slut: '10.00', titel: 'Standup', kalender: 'Work' }, { tid: '13.00', titel: 'Dentist' }] },
    { dato: '2026-10-28', note: '', aftaler: [] },
    { dato: '2026-11-01', note: 'Weekend.', aftaler: [] },
  ],
  hermesStatus: 'Watching the calendar',
};

const log: LogEntry[] = [
  { id: 'l1', tid: '2026-10-26T06:00:00.000Z', kilde: 'hermes', tekst: 'Built the day.', fortryd: 'x' },
  { id: 'l2', tid: '2026-10-26T05:00:00.000Z', kilde: 'hermes', tekst: 'Moved the meeting.', fortrudt: '2026-10-26T05:30:00.000Z' },
  { id: 'l3', tid: '2026-10-26T07:30:00.000Z', kilde: 'hermes', tekst: 'Prepared the material.', handlingId: 'cal-1-prepare', fortryd: 'y' },
];

const { ugen: _u, ...utenUgen } = dagenFuld;
const { vejr: _v, ...utenVejr } = dagenFuld;
const igang = [{ id: 'r1', label: 'Building the day', status: 'running' as const }];

export const DAGEN: Record<string, () => string> = {
  fuld: () => krop(String(renderDagen(dagenFuld, log, DAGEN_NU, igang, { slags: 'kalender', sidstLaest: '2026-10-26T06:00:00.000Z', ok: true }))),
  udenHandling: () => krop(String(renderDagen({ ...utenUgen, anbefaling: { tekst: 'Take a walk at noon.' }, vejr: 'sol, 18 grader' }, [], DAGEN_NU))),
  tomKalender: () => krop(String(renderDagen({ ...utenVejr, kalender: [], morgenavis: [], treLinjer: [], ugen: [] }, [], DAGEN_NU, [], { slags: 'kalender', sidstLaest: '2026-10-24T06:00:00.000Z', ok: false }))),
  gammel: () => krop(String(renderDagen({ ...dagenFuld, genereret: '2026-10-25T06:00:00.000Z' }, [], new Date('2026-10-26T08:00:00.000Z')))),
  rumTomt: () => krop(String(renderDagenEmpty('No data for today yet.'))),
};
