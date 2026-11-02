// KC-0170: Nyheder's actions, log lines and status in English or Danish. The Danish is what the room wrote before the
// strings moved (captured first); in English nothing Danish reaches the toast, the log, the chat, the status line or
// the Read-later note, and a note made in the other language is still the one used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { nyhederRoom } from '../../src/rooms/nyheder/room.ts';
import { aktion, iSprog, laes, lavVerden } from '../fixtures/sprog-handling.ts';
import { DANSK } from '../fixtures/sprog-tjek.ts';
import type { Sprog } from '../../src/store/profil.ts';

const AVIS = '```json\n' + JSON.stringify({
  femLinjer: ['One line'],
  baner: [{ navn: 'Tech', nyheder: [{ titel: 'Story without source', hvorfor: 'because', zone: 'privat' }, { titel: 'Story with source', hvorfor: 'also', kilde: 'Example Wire', url: 'https://example.com/a', zone: 'privat' }] }],
  forslag: [{ tekst: 'Archive the rest', handling: { label: 'Archive', instruktion: 'Archive them.', fortryd: 'Restore them.' } }],
}) + '\n```';

async function scenarie(sprog: Sprog | undefined): Promise<string[]> {
  const ud: string[] = [];
  const v = await lavVerden({ vault: true, svar: [AVIS, '', '', ''] });
  try {
    const k = (navn: string, body: Record<string, unknown>) => laes(sprog, aktion(nyhederRoom, v, navn, body));
    const status = async (): Promise<string> => iSprog(sprog, async () => (await nyhederRoom.view(v.deps)).hermesStatus);
    ud.push(`gem-uden-vault: ${await laes(sprog, () => nyhederRoom.startAction!({ ...v.deps, vaultInbox: '' }, 'gem', { nyhedId: 'n1' }))}`);
    ud.push(`gem-ukendt: ${await k('gem', { nyhedId: 'n1' })}`);
    const opdater = await iSprog(sprog, () => nyhederRoom.startOpdater(v.deps, 'hent'));
    const o = await opdater!.finished;
    ud.push(`opdater: ${o.status} ${o.error ?? ''}`);
    ud.push(`status: ${await status()}`);
    ud.push(`gem1: ${await k('gem', { nyhedId: 'n1' })}`);
    ud.push(`gem2: ${await k('gem', { nyhedId: 'n2' })}`);
    const fil = (await readdir(path.join(v.dir, 'vault')))[0]!;
    ud.push(`fil: ${fil}`);
    ud.push(`indhold: ${(await readFile(path.join(v.dir, 'vault', fil), 'utf8')).split('\n').join('|')}`);
    const h = await iSprog(sprog, () => nyhederRoom.startHandling(v.deps, 'forslag-1-archive'));
    const hr = await h!.finished;
    ud.push(`handling: ${hr.result?.text ?? hr.error}`);
    const log = await v.store.readLog('nyheder');
    for (const e of log.filter((x) => x.fortryd)) {
      const r = await (await iSprog(sprog, () => nyhederRoom.startFortryd(v.deps, e.id)))!.finished;
      ud.push(`fortryd: ${r.result?.text ?? r.error}`);
    }
    ud.push(`indhold-efter: ${(await readFile(path.join(v.dir, 'vault', fil), 'utf8')).split('\n').join('|')}`);
    ud.push(`log: ${(await v.store.readLog('nyheder')).map((e) => e.tekst).reverse().join(' | ')}`);
    const chat = await iSprog(sprog, () => nyhederRoom.startChat(v.deps, 'Hi', undefined));
    const c = await chat.finished;
    ud.push(`chat-tom: ${c.result?.text ?? c.error}`);
  } finally { await v.ryd(); }
  return ud;
}

test('Nyheder: a note made in the other language is still the one saved to and undone from', async () => {
  const v = await lavVerden({ vault: true, svar: [AVIS] });
  try {
    await (await iSprog(undefined, () => nyhederRoom.startOpdater(v.deps, 'hent')))!.finished;
    await laes(undefined, aktion(nyhederRoom, v, 'gem', { nyhedId: 'n1' }));
    assert.deepEqual(await readdir(path.join(v.dir, 'vault')), ['Læs senere.md']);
    await laes('en', aktion(nyhederRoom, v, 'gem', { nyhedId: 'n2' }));
    assert.deepEqual(await readdir(path.join(v.dir, 'vault')), ['Læs senere.md'], 'no second note');
    // An English note first: Danish saves into it.
    const w = await lavVerden({ vault: true, svar: [AVIS] });
    try {
      await (await iSprog('en', () => nyhederRoom.startOpdater(w.deps, 'hent')))!.finished;
      await mkdir(path.join(w.dir, 'vault'), { recursive: true });
      await writeFile(path.join(w.dir, 'vault', 'Read later.md'), '# Read later\n\n', 'utf8');
      await laes(undefined, aktion(nyhederRoom, w, 'gem', { nyhedId: 'n1' }));
      assert.deepEqual(await readdir(path.join(w.dir, 'vault')), ['Read later.md']);
    } finally { await w.ryd(); }
  } finally { await v.ryd(); }
});

test('Nyheder: a stored Danish status still shows in English, and the Danish installation shows what it stored', async () => {
  const v = await lavVerden({ svar: [AVIS] });
  try {
    await (await iSprog(undefined, () => nyhederRoom.startOpdater(v.deps, 'hent')))!.finished;
    assert.equal((await iSprog(undefined, () => nyhederRoom.view(v.deps))).hermesStatus, 'Følger nyhederne');
    assert.equal((await iSprog('en', () => nyhederRoom.view(v.deps))).hermesStatus, 'Following the news');
  } finally { await v.ryd(); }
});

test('Nyheder: Danish (no language, and da) is what the room said before', async () => {
  const a = await scenarie(undefined);
  assert.deepEqual(await scenarie('da'), a);
  assert.deepEqual(a, DANSK_FORVENTET);
});

test('Nyheder: English says everything in English, and no Danish line is left', async () => {
  const en = await scenarie('en');
  assert.deepEqual(en.filter((l) => DANSK.test(l)), []);
  assert.deepEqual(en, ENGELSK_FORVENTET);
});

const DANSK_FORVENTET: string[] = [
  "gem-uden-vault: afvist 400: Ingen Obsidian-mappe sat op (KC_VAULT_INBOX)",
  "gem-ukendt: afvist 400: Nyheden findes ikke i rummet",
  "opdater: done ",
  "status: Følger nyhederne",
  "gem1: ok: Gemt til senere.",
  "gem2: ok: Gemt til senere.",
  "fil: Læs senere.md",
  "indhold: # Læs senere||- Story without source — because (ukendt kilde, 2026-10-27)|- [Story with source](https://example.com/a) — also (Example Wire, 2026-10-27)|",
  "handling: Archive: gjort.",
  "fortryd: ",
  "fortryd: Fjernet fra Læs senere.",
  "fortryd: Fjernet fra Læs senere.",
  "indhold-efter: # Læs senere||",
  "log: Hermes udvalgte nyhederne (2 i 1 baner, 0 fra 0 kilder). | Gemte \"Story without source\" til senere i Obsidian. | Gemte \"Story with source\" til senere i Obsidian. | Archive: gjort. | Fortrudt. | Fjernede nyheden fra Læs senere igen. | Fjernede nyheden fra Læs senere igen.",
  "chat-tom: (intet svar)",
];
const ENGELSK_FORVENTET: string[] = [
  "gem-uden-vault: afvist 400: No Obsidian folder is set up (KC_VAULT_INBOX)",
  "gem-ukendt: afvist 400: The story is not in the room",
  "opdater: done ",
  "status: Following the news",
  "gem1: ok: Saved for later.",
  "gem2: ok: Saved for later.",
  "fil: Read later.md",
  "indhold: # Read later||- Story without source — because (unknown source, 2026-10-27)|- [Story with source](https://example.com/a) — also (Example Wire, 2026-10-27)|",
  "handling: Archive: done.",
  "fortryd: ",
  "fortryd: Removed from Read later.",
  "fortryd: Removed from Read later.",
  "indhold-efter: # Read later||",
  "log: Hermes picked the stories (2 in 1 lane, 0 from 0 sources). | Saved \"Story without source\" for later in Obsidian. | Saved \"Story with source\" for later in Obsidian. | Archive: done. | Undone. | Removed the story from Read later again. | Removed the story from Read later again.",
  "chat-tom: (no answer)",
];
