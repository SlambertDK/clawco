// KC-0170: Dagen's log lines, empty answers and status in English or Danish. The Danish is what the room wrote before
// the strings moved (captured first); in English nothing Danish reaches the toast, the log, the chat or the status line.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dagenRoom } from '../../src/rooms/dagen/room.ts';
import type { DagenState } from '../../src/rooms/dagen/schema.ts';
import { iSprog, lavVerden } from '../fixtures/sprog-handling.ts';
import { DANSK } from '../fixtures/sprog-tjek.ts';
import type { Sprog } from '../../src/store/profil.ts';

const DAG = '```json\n' + JSON.stringify({
  treLinjer: ['One'],
  anbefaling: { tekst: 'Use the time', handling: { label: 'Block it', instruktion: 'Block the calendar.', fortryd: 'Unblock it.' } },
  kalender: [{ tid: '10.00', titel: 'Standup', zone: 'privat' }, { tid: '11.00', titel: 'Review', zone: 'privat' }],
  morgenavis: [{ titel: 'A story', hvorfor: 'because', zone: 'privat' }],
}) + '\n```';
const CHAT = '```json\n' + JSON.stringify({ opdater: { treLinjer: ['Two'] } }) + '\n```';

async function scenarie(sprog: Sprog | undefined): Promise<string[]> {
  const ud: string[] = [];
  const v = await lavVerden({ svar: [DAG, '', '', '', CHAT, ''] });
  try {
    const status = async (): Promise<string> => iSprog(sprog, async () => (await dagenRoom.view(v.deps)).hermesStatus);
    const opdater = await (await iSprog(sprog, () => dagenRoom.startOpdater(v.deps, 'opdater')))!.finished;
    ud.push(`opdater: ${opdater.status} ${opdater.error ?? ''}`);
    ud.push(`status: ${await status()}`);
    const id = (await v.store.readState<DagenState>('dagen'))!.anbefaling.handling!.id;
    const h = await (await iSprog(sprog, () => dagenRoom.startHandling(v.deps, id)))!.finished;
    ud.push(`handling: ${h.result?.text ?? h.error}`);
    for (const e of (await v.store.readLog('dagen')).filter((x) => x.fortryd)) {
      const r = await (await iSprog(sprog, () => dagenRoom.startFortryd(v.deps, e.id)))!.finished;
      ud.push(`fortryd: ${JSON.stringify(r.result?.text ?? r.error)}`);
    }
    const c1 = await (await iSprog(sprog, () => dagenRoom.startChat(v.deps, 'Hello?', undefined))).finished;
    ud.push(`chat-tom: ${c1.result?.text ?? c1.error}`);
    const c2 = await (await iSprog(sprog, () => dagenRoom.startChat(v.deps, 'Change it', undefined))).finished;
    ud.push(`chat-opdaterer: ${c2.result?.text ?? c2.error}`);
    ud.push(`log: ${(await v.store.readLog('dagen')).map((e) => e.tekst).reverse().join(' | ')}`);
  } finally { await v.ryd(); }
  return ud;
}

test('Dagen: a status stored by the room in Danish still reads in English; Hermes\' own status is shown as it is', async () => {
  const v = await lavVerden({ svar: [DAG] });
  try {
    await (await iSprog(undefined, () => dagenRoom.startOpdater(v.deps, 'opdater')))!.finished;
    assert.equal((await iSprog(undefined, () => dagenRoom.view(v.deps))).hermesStatus, 'Klar');
    assert.equal((await iSprog('en', () => dagenRoom.view(v.deps))).hermesStatus, 'Ready');
    const s = (await v.store.readState<DagenState>('dagen'))!;
    await v.store.writeState('dagen', { ...s, hermesStatus: 'Bygger dagen' });
    assert.equal((await iSprog('en', () => dagenRoom.view(v.deps))).hermesStatus, 'Bygger dagen');
  } finally { await v.ryd(); }
});

test('Dagen: Danish (no language, and da) is what the room said before', async () => {
  const a = await scenarie(undefined);
  assert.deepEqual(await scenarie('da'), a);
  assert.deepEqual(a, DANSK_FORVENTET);
});

test('Dagen: English says everything in English, and no Danish line is left', async () => {
  const en = await scenarie('en');
  assert.deepEqual(en.filter((l) => DANSK.test(l)), []);
  assert.deepEqual(en, ENGELSK_FORVENTET);
});

const DANSK_FORVENTET: string[] = [
  "opdater: done ",
  "status: Klar",
  "handling: Block it: gjort.",
  "fortryd: \"\"",
  "chat-tom: (intet svar)",
  "chat-opdaterer: (intet svar)",
  "log: Hermes byggede Dagen (2 aftaler, 1 nyheder). | Block it: gjort. | Fortrudt. | Opdaterede rummet fra chatten.",
];
const ENGELSK_FORVENTET: string[] = [
  "opdater: done ",
  "status: Ready",
  "handling: Block it: done.",
  "fortryd: \"\"",
  "chat-tom: (no answer)",
  "chat-opdaterer: (no answer)",
  "log: Hermes built Today (2 appointments, 1 news item). | Block it: done. | Undone. | Updated the room from the chat.",
];
