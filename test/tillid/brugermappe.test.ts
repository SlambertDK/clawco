// KC-0146: the user's folder — what the export lists and what the page counts. Temp dirs only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { erHemmelig, listBrugerfiler, opgoer } from '../../src/tillid/brugermappe.ts';
import { SKJULTE_DATAFILER } from '../../src/hemmeligheder/lager-fil.ts';
import { KILDE_HEMMELIGHEDER } from '../../src/kilder/hemmeligheder.ts';

async function skriv(fil: string, tekst = 'x'): Promise<void> {
  await mkdir(path.dirname(fil), { recursive: true });
  await writeFile(fil, tekst, 'utf8');
}

async function fixture() {
  const rod = await mkdtemp(path.join(tmpdir(), 'kc-brugermappe-'));
  const data = path.join(rod, 'data');
  const vault = path.join(data, 'vault'); // the dev default: the vault inside the data dir
  await skriv(path.join(data, 'rum', 'mail', 'state.json'), '{"a":1}');
  await skriv(path.join(data, 'rum', 'mail', 'log.jsonl'), '{"id":"1"}\n{"id":"2"}\n');
  await skriv(path.join(data, 'rum', 'mail', 'chat.jsonl'), '{"id":"c"}\n');
  await skriv(path.join(data, 'kilder.json'), '{"kilder":[]}');
  await skriv(path.join(data, 'revision-2026-11.jsonl'), '{}\n');
  await skriv(path.join(data, '.env'), 'KC_X=1');
  await skriv(path.join(data, 'clawco.env'), 'KC_X=1');
  await skriv(path.join(data, 'api-key.txt'));
  await skriv(path.join(data, 'TOKEN.json'));
  await skriv(path.join(data, 'my_secret'));
  for (const n of SKJULTE_DATAFILER) await skriv(path.join(data, n));
  await skriv(path.join(data, KILDE_HEMMELIGHEDER, 'mail-imap.json'), '{"adgangskode":"x"}');
  await skriv(path.join(vault, 'Clawco', 'regler.md'), 'naeste-id: R-0001\n');
  await skriv(path.join(vault, 'Clawco', 'Om mig.md'), '# Om mig\n');
  await skriv(path.join(vault, '00-Indbakke', 'egen note.md'), 'min egen');
  await skriv(path.join(vault, '40-Mennesker', 'People', 'familie', 'Maja.md'), '---\nnavn: Maja\n---\n');
  const ude = path.join(rod, 'ude');
  await skriv(path.join(ude, 'fremmed.txt'), 'ikke Clawcos');
  await symlink(ude, path.join(data, 'link-ud'));
  await symlink(ude, path.join(vault, 'Clawco', 'link-ud'));
  return { rod, data, vault, ude, ryd: () => rm(rod, { recursive: true, force: true }) };
}

test('erHemmelig: env files, key/token/secret names and the encrypted store', () => {
  for (const n of ['.env', '.env.local', 'clawco.env', 'api-key.txt', 'TOKEN.json', 'my_secret', 'nøgler.json', 'hemmeligheder.enc', ...SKJULTE_DATAFILER]) assert.equal(erHemmelig(n), true, n);
  for (const n of ['state.json', 'log.jsonl', 'kilder.json', 'regler.md', 'Om mig.md', 'environment.md']) assert.equal(erHemmelig(n), false, n);
});

test('the list: the data dir and <vault>/Clawco, no secrets, no other notes, no symlinks', async () => {
  const f = await fixture();
  try {
    const stier = (await listBrugerfiler({ dataDir: f.data, vaultDir: f.vault })).map((x) => x.sti);
    assert.deepEqual(stier, [
      'data/kilder.json', 'data/revision-2026-11.jsonl',
      'data/rum/mail/chat.jsonl', 'data/rum/mail/log.jsonl', 'data/rum/mail/state.json',
      'vault/Clawco/Om mig.md', 'vault/Clawco/regler.md',
    ]);
  } finally { await f.ryd(); }
});

test('the list: the people the page shows, under personer/', async () => {
  const f = await fixture();
  try {
    const dir = path.join(f.vault, '40-Mennesker', 'People');
    const ud = await listBrugerfiler({ dataDir: f.data, vaultDir: f.vault }, { personer: { dir, filer: ['familie/Maja.md', '../../Clawco/regler.md', 'mangler.md'] } });
    const p = ud.filter((x) => x.sti.startsWith('personer/')).map((x) => x.sti);
    assert.deepEqual(p, ['personer/familie/Maja.md'], 'only files inside the register that exist');
  } finally { await f.ryd(); }
});

test('the list: protected folders inside the data dir stay out', async () => {
  const f = await fixture();
  try {
    await skriv(path.join(f.data, 'indbakke', 'note.md'));
    const stier = (await listBrugerfiler({ dataDir: f.data, vaultDir: f.vault, beskyt: [path.join(f.data, 'indbakke')] })).map((x) => x.sti);
    assert.ok(!stier.some((s) => s.includes('indbakke')));
  } finally { await f.ryd(); }
});

test('the list: a data dir that is the vault lists only Clawco/', async () => {
  const f = await fixture();
  try {
    const stier = (await listBrugerfiler({ dataDir: f.vault, vaultDir: f.vault })).map((x) => x.sti);
    assert.deepEqual(stier, ['vault/Clawco/Om mig.md', 'vault/Clawco/regler.md']);
  } finally { await f.ryd(); }
});

test('the list: no data dir and no vault is an empty list', async () => {
  const rod = await mkdtemp(path.join(tmpdir(), 'kc-brugermappe-tom-'));
  try {
    assert.deepEqual(await listBrugerfiler({ dataDir: path.join(rod, 'findes-ikke') }), []);
  } finally { await rm(rod, { recursive: true, force: true }); }
});

test('opgoer: per room the log and chat lines and the bytes; Clawco files; the rest as a count', async () => {
  const f = await fixture();
  try {
    const o = await opgoer({ dataDir: f.data, vaultDir: f.vault });
    assert.deepEqual(o.rum.map((r) => ({ id: r.id, log: r.log, chat: r.chat })), [{ id: 'mail', log: 2, chat: 1 }]);
    assert.deepEqual(o.rum[0]?.filer, ['data/rum/mail/chat.jsonl', 'data/rum/mail/log.jsonl', 'data/rum/mail/state.json']);
    assert.ok((o.rum[0]?.bytes ?? 0) > 0);
    assert.deepEqual(o.clawco, ['vault/Clawco/Om mig.md', 'vault/Clawco/regler.md']);
    assert.equal(o.andre, 1, 'kilder.json; the audit trail stays out of the count (KC-0275: Slet alt leaves one tombstone line by design)');
    assert.equal(o.noegler, 8, 'the env files, the key/token/secret names, the encrypted store and its temp name, one source login');
    assert.ok(o.bytes >= (o.rum[0]?.bytes ?? 0));
  } finally { await f.ryd(); }
});
