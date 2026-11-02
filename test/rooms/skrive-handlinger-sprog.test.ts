// KC-0170: Skrive's actions, log lines and status in English or Danish. The Danish is what the room wrote before the
// strings moved (captured first, so the test is the proof it did not change); in English nothing Danish reaches the
// toast, the log, the chat or the status line.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skriveRoom } from '../../src/rooms/skrive/room.ts';
import { tomtState, type SkriveState } from '../../src/rooms/skrive/schema.ts';
import { SKRIVE_TEKSTER } from '../../src/rooms/skrive/tekster.ts';
import { aktion, iSprog, laes, lavVerden } from '../fixtures/sprog-handling.ts';
import { DANSK } from '../fixtures/sprog-tjek.ts';
import type { Sprog } from '../../src/store/profil.ts';

const NYT = '```json\n{"titel":"Note to ops","afsnit":[{"tekst":"One"},{"tekst":"Two"}],"kilder":["https://example.com/a"]}\n```';
const FORSLAG = (afsnitId: string | null): string => `\`\`\`json\n{"forslag":[{"afsnitId":${afsnitId === null ? 'null' : `"${afsnitId}"`},"efterId":"a1","ny":"${afsnitId === null ? 'Inserted' : 'Replacement'}","hvorfor":"clearer"}]}\n\`\`\``;

async function scenarie(sprog: Sprog | undefined): Promise<string[]> {
  const ud: string[] = [];
  const v = await lavVerden({ vault: true, svar: [NYT, FORSLAG('a1'), FORSLAG(null), 'Plain answer', ''] });
  try {
    const k = (navn: string, body: Record<string, unknown>) => laes(sprog, aktion(skriveRoom, v, navn, body));
    const log = async (): Promise<string[]> => (await v.store.readLog('skrive')).map((e) => e.tekst);
    const status = async (): Promise<string> => iSprog(sprog, async () => (await skriveRoom.view(v.deps)).hermesStatus);
    ud.push(`status0: ${await status()}`);
    ud.push(`nyt-uden-brief: ${await k('nyt', {})}`);
    ud.push(`forslag-ukendt-dok: ${await k('forslag', { dokId: 'dok-x' })}`);
    ud.push(`brug-ukendt: ${await k('brug', { forslagId: 'f-x' })}`);
    ud.push(`gem-uden-vault: ${await laes(sprog, () => skriveRoom.startAction!({ ...v.deps, vaultInbox: '' }, 'gem', { dokId: 'dok-x' }))}`);
    ud.push(`vaelg-ukendt: ${await k('vaelg', { dokId: 'dok-x' })}`);
    ud.push(`nyt: ${await k('nyt', { brief: 'Mail to Tom' })}`);
    ud.push(`status1: ${await status()}`);
    const s = (await v.store.readState<SkriveState>('skrive'))!;
    const dokId = s.dokumenter[0]!.id;
    ud.push(`forslag-ukendt-afsnit: ${await k('forslag', { dokId, afsnitId: 'a9' })}`);
    ud.push(`forslag: ${await k('forslag', { dokId, afsnitId: 'a1' })}`);
    const f1 = (await v.store.readState<SkriveState>('skrive'))!.forslag[0]!.id;
    ud.push(`brug: ${await k('brug', { forslagId: f1 })}`);
    ud.push(`forslag-nyt: ${await k('forslag', { dokId })}`);
    const f2 = (await v.store.readState<SkriveState>('skrive'))!.forslag[0]!.id;
    ud.push(`brug-nyt: ${await k('brug', { forslagId: f2 })}`);
    ud.push(`gem: ${await k('gem', { dokId })}`);
    for (const e of (await v.store.readLog('skrive')).filter((x) => x.fortryd)) {
      const run = await iSprog(sprog, () => skriveRoom.startFortryd(v.deps, e.id));
      const r = await run!.finished;
      ud.push(`fortryd: ${r.result?.text ?? r.error}`);
    }
    // The saved note is gone, so undoing it again is not possible; a note changed by hand is left alone (Danish only matters in text).
    ud.push(`log: ${(await log()).reverse().join(' | ')}`);
    // A chat answer with no text at all
    const chat = await iSprog(sprog, () => skriveRoom.startChat(v.deps, 'Hi', undefined));
    const c = await chat.finished;
    ud.push(`chat: ${c.result?.text ?? c.error}`);
    const tom = await iSprog(sprog, () => skriveRoom.startChat(v.deps, 'Hello?', undefined));
    const t = await tom.finished;
    ud.push(`chat-tom: ${t.result?.text ?? t.error}`);
    ud.push(`dok-md: ${(await iSprog(sprog, () => skriveRoom.fil!(v.deps, s.dokumenter[0]!.id + '.md')))!.content.split('\n').slice(-4).join('|')}`);
    ud.push(`status-slut: ${await status()}`);
  } finally { await v.ryd(); }
  return ud;
}

test('Skrive: tomtState keeps the Danish default stored; the room shows it in the language of the request', async () => {
  assert.equal(tomtState().hermesStatus, 'Klar til at skrive');
  const v = await lavVerden();
  try {
    assert.equal((await iSprog(undefined, () => skriveRoom.view(v.deps))).hermesStatus, 'Klar til at skrive');
    assert.equal((await iSprog('da', () => skriveRoom.view(v.deps))).hermesStatus, 'Klar til at skrive');
    assert.equal((await iSprog('en', () => skriveRoom.view(v.deps))).hermesStatus, SKRIVE_TEKSTER.en.klar);
    // A Danish status a Danish installation stored before still shows in English (mapped from the table, not left Danish).
    await v.store.writeState('skrive', { ...tomtState(), hermesStatus: 'Klar til at skrive' });
    assert.equal((await iSprog('en', () => skriveRoom.view(v.deps))).hermesStatus, SKRIVE_TEKSTER.en.klar);
    await v.store.writeState('skrive', { ...tomtState(), hermesStatus: 'Skriver med på "Noget"' });
    assert.equal((await iSprog('en', () => skriveRoom.view(v.deps))).hermesStatus, 'Writing along on "Noget"');
    assert.equal((await iSprog('da', () => skriveRoom.view(v.deps))).hermesStatus, 'Skriver med på "Noget"');
  } finally { await v.ryd(); }
});

test('Skrive: Danish (no language, and da) is what the room said before', async () => {
  const a = await scenarie(undefined);
  assert.deepEqual(await scenarie('da'), a);
  assert.deepEqual(a, DANSK_FORVENTET);
});

test('Skrive: English says everything in English, and no Danish line is left', async () => {
  const en = await scenarie('en');
  assert.deepEqual(en.filter((l) => DANSK.test(l)), []);
  assert.deepEqual(en, ENGELSK_FORVENTET);
});

const DANSK_FORVENTET: string[] = [
  "status0: Klar til at skrive",
  "nyt-uden-brief: afvist 400: Skriv hvad Hermes skal skrive (brief mangler)",
  "forslag-ukendt-dok: afvist 400: Udkastet findes ikke",
  "brug-ukendt: fejl: Forslaget findes ikke længere",
  "gem-uden-vault: fejl: Ingen Obsidian-mappe sat op (KC_VAULT_INBOX)",
  "vaelg-ukendt: fejl: Udkastet findes ikke",
  "nyt: ok: ",
  "status1: Skriver med på \"Note to ops\"",
  "forslag-ukendt-afsnit: afvist 400: Afsnittet findes ikke",
  "forslag: ok: ",
  "brug: ok: Forslaget er brugt.",
  "forslag-nyt: ok: ",
  "brug-nyt: ok: Forslaget er brugt.",
  "gem: ok: Gemt som 2026-10-27 Note to ops.md",
  "fortryd: Fjernede noten fra Obsidian-indbakken igen.",
  "fortryd: Fjernede det indsatte afsnit igen.",
  "fortryd: Satte afsnittet tilbage.",
  "log: Skrev udkastet \"Note to ops\" (2 afsnit). | Brugte Hermes' forslag til afsnit 1 i \"Note to ops\". | Brugte Hermes' forslag til nyt afsnit i \"Note to ops\". | Gemte \"Note to ops\" i Obsidian-indbakken (2026-10-27 Note to ops.md). | Fjernede noten fra Obsidian-indbakken igen. | Fjernede det indsatte afsnit igen. | Satte afsnittet tilbage.",
  "chat: Plain answer",
  "chat-tom: (intet svar)",
  "dok-md: |## Kilder|- https://example.com/a|",
  "status-slut: Skriver med på \"Note to ops\"",
];
const ENGELSK_FORVENTET: string[] = [
  "status0: Ready to write",
  "nyt-uden-brief: afvist 400: Say what Hermes should write (the brief is missing)",
  "forslag-ukendt-dok: afvist 400: The draft does not exist",
  "brug-ukendt: fejl: The proposal no longer exists",
  "gem-uden-vault: fejl: No Obsidian folder is set up (KC_VAULT_INBOX)",
  "vaelg-ukendt: fejl: The draft does not exist",
  "nyt: ok: ",
  "status1: Writing along on \"Note to ops\"",
  "forslag-ukendt-afsnit: afvist 400: The paragraph does not exist",
  "forslag: ok: ",
  "brug: ok: The proposal has been used.",
  "forslag-nyt: ok: ",
  "brug-nyt: ok: The proposal has been used.",
  "gem: ok: Saved as 2026-10-27 Note to ops.md",
  "fortryd: Removed the note from the Obsidian inbox again.",
  "fortryd: Removed the inserted paragraph again.",
  "fortryd: Put the paragraph back.",
  "log: Wrote the draft \"Note to ops\" (2 paragraphs). | Used Hermes' proposal for paragraph 1 in \"Note to ops\". | Used Hermes' proposal for a new paragraph in \"Note to ops\". | Saved \"Note to ops\" to the Obsidian inbox (2026-10-27 Note to ops.md). | Removed the note from the Obsidian inbox again. | Removed the inserted paragraph again. | Put the paragraph back.",
  "chat: Plain answer",
  "chat-tom: (no answer)",
  "dok-md: |## Sources|- https://example.com/a|",
  "status-slut: Writing along on \"Note to ops\"",
];
