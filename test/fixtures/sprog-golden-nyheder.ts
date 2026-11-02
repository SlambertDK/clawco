// KC-0170: fixed inputs for Nyheder, rendered without a chosen language. The files in test/fixtures/sprog-nyheder/
// were captured from these inputs BEFORE the strings moved into src/rooms/nyheder/tekster.ts;
// test/rooms/nyheder-tekster.test.ts holds the renders to them byte for byte. The content is plain ASCII so an
// English render shows only the room's own words to the Danish-word detector. Change a golden only when the
// Danish copy changes on purpose.

import { renderNyheder, renderNyhederEmpty } from '../../src/rooms/nyheder/render.ts';
import type { NyhederState } from '../../src/rooms/nyheder/schema.ts';
import type { LogEntry } from '../../src/store/types.ts';
import { krop } from './sprog-golden.ts';

export const NU = new Date('2026-10-27T09:00:00.000Z');

const state: NyhederState = {
  dato: '2026-10-27', genereret: '2026-10-27T07:10:00Z',
  femLinjer: ['Line one', 'Line two', 'Line three', 'Line four', 'Line five'],
  baner: [
    { navn: 'Energy', nyheder: [
      { id: 'n1', titel: 'Reserves tighten this winter', hvorfor: 'Stricter reserve rules from December.', kilde: 'Example Energy', url: 'https://example.org/reserves', relevans: [{ for: 'arbejde', note: 'Your own system.' }, { for: 'danmark', note: 'Higher prices in cold weeks.' }, { for: 'mig', note: 'Check the contract.' }] },
      { id: 'n2', titel: 'Without a link', hvorfor: 'x' },
    ] },
    { navn: 'AI and agents', nyheder: [
      { id: 'n3', titel: 'Open model matches closed ones', hvorfor: 'On par for tool use.', kilde: 'r/LocalLLaMA', url: 'https://example.org/agents', relevans: [{ for: 'projekter', note: 'Candidate for the server.' }, { for: 'holdning', note: 'Backs your line.' }, { for: 'familie', note: 'None.' }] },
    ] },
  ],
  forslag: [
    { id: 'f1', tekst: 'Shall I build a test room?', handling: { id: 'h-f1', label: 'Yes, build it', instruktion: 'i' } },
    { id: 'f2', tekst: 'Answered proposal', handling: { id: 'h-f2', label: 'Yes', instruktion: 'i' } },
    { id: 'f3', tekst: 'Reply in the chat' },
  ],
  nyhedsbreve: [{ mailId: '7', emne: 'Weekly energy news', fra: 'Example Energy' }],
  kilder: { antal: 25, medNyheder: 9, nyheder: 39, fejlede: ['r/LocalLLaMA', 'r/OpenAI'] },
  gemt: ['n2'],
  hermesStatus: 'Following the news',
};

const log: LogEntry[] = [
  { id: 'l1', tid: '2026-10-27T08:00:00Z', kilde: 'hermes', tekst: 'Built the test room.', handlingId: 'h-f2', fortryd: 'x' },
  { id: 'l2', tid: '2026-10-27T07:05:00Z', kilde: 'henrik', tekst: 'Saved an item.', fortryd: 'x', fortrudt: '2026-10-27T07:30:00Z' },
];

export const NYHEDER: Record<string, () => string> = {
  fuld: () => krop(String(renderNyheder(state, log, NU, [{ id: 'r1', label: 'Picking the news', status: 'running' }]))),
  gammel: () => krop(String(renderNyheder({ ...state, genereret: '2026-10-24T07:10:00Z', femLinjer: [], forslag: [], nyhedsbreve: [], kilder: { antal: 3, medNyheder: 3, nyheder: 4, fejlede: [] } }, [], new Date('2026-10-29T09:00:00.000Z')))),
  tom: () => krop(String(renderNyhederEmpty('Ingen avis for i dag endnu.'))),
};
