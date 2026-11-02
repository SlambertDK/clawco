// KC-0170: fixed inputs for Skrive, rendered without a chosen language. The files in test/fixtures/sprog-skrive/
// were captured from these inputs BEFORE the strings moved into src/rooms/skrive/tekster.ts;
// test/rooms/skrive-tekster.test.ts holds the renders to them byte for byte. The content is plain ASCII so an
// English render shows only the room's own words to the Danish-word detector. Change a golden only when the
// Danish copy changes on purpose.

import { renderSkrive } from '../../src/rooms/skrive/render.ts';
import type { SkriveState } from '../../src/rooms/skrive/schema.ts';
import type { LogEntry } from '../../src/store/types.ts';
import { krop } from './sprog-golden.ts';

export const NU = new Date('2026-10-27T12:00:00.000Z');

const state: SkriveState = {
  dokumenter: [
    { id: 'dok-1', titel: 'Note to the ops team', brief: 'Short mail about winter reserves', afsnit: [{ id: 'a1', tekst: 'First paragraph.' }, { id: 'a2', tekst: 'Second paragraph.' }], kilder: ['Example Energy report', 'Grid memo'], oprettet: '2026-10-27T10:00:00Z', aendret: '2026-10-27T10:05:00Z' },
    { id: 'dok-2', titel: 'Another draft', brief: 'x', afsnit: [{ id: 'a1', tekst: 'Y' }], kilder: [], oprettet: '2026-10-27T09:00:00Z', aendret: '2026-10-27T09:00:00Z', gemtSom: '/vault/00-Inbox/2026-10-27 Another draft.md' },
  ],
  aktivt: 'dok-1',
  forslag: [
    { id: 'f-1', dokId: 'dok-1', afsnitId: 'a2', ny: 'Second paragraph, tightened.', hvorfor: 'Shorter and more concrete.', tid: '2026-10-27T10:04:00Z' },
    { id: 'f-2', dokId: 'dok-1', afsnitId: null, efterId: 'a1', ny: 'A new paragraph.', hvorfor: '', tid: '2026-10-27T10:06:00Z' },
  ],
  hermesStatus: 'Ready',
};

const log: LogEntry[] = [
  { id: 'l1', tid: '2026-10-27T10:00:00Z', kilde: 'hermes', tekst: 'Wrote the draft.', fortryd: 'x' },
  { id: 'l2', tid: '2026-10-27T10:05:00Z', kilde: 'hermes', tekst: 'Tightened paragraph 2.', fortryd: 'x', fortrudt: '2026-10-27T10:30:00Z' },
  { id: 'l3', tid: '2026-10-26T08:00:00Z', kilde: 'hermes', tekst: 'Old entry.', fortryd: 'x' },
];

export const SKRIVE: Record<string, () => string> = {
  fuld: () => krop(String(renderSkrive(state, log, NU, [{ id: 'r1', label: 'Writing the draft', status: 'running' }, { id: 'r2', label: 'Making a proposal', status: 'queued' }]))),
  gemt: () => krop(String(renderSkrive({ ...state, aktivt: 'dok-2', forslag: [] }, [], NU))),
  tom: () => krop(String(renderSkrive({ dokumenter: [], aktivt: null, forslag: [], hermesStatus: 'Ready' }, [], NU))),
};
