// KC-0136, derive don't mirror (§0 r6): the inbox and the people register come
// from the vault chosen on the notes card (kilder.json); KC_VAULT_INBOX and
// KC_PEOPLE_DIR still win (Henrik's NAS). The rooms that save (Nyheder, Skrive)
// and the people rule every run carries read the paths from here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lavVaultStier, NOTER_ID, noterStier, valgtVault } from '../../../src/kilder/noter/stier.ts';
import { skrivKonfig, type KonfigPost } from '../../../src/kilder/register.ts';
import { createApp, medNoter } from '../../../src/server.ts';
import { kiraNoter, noterKilde } from '../../../src/kilder/noter/noter.ts';
import { createFileStore } from '../../../src/store/fileStore.ts';
import { createFakeAgent } from '../../../src/agent/fake.ts';
import { createRunRegistry } from '../../../src/runs.ts';
import { NU } from '../hjaelp.ts';

const post = (over: Partial<KonfigPost> = {}): KonfigPost => ({ id: NOTER_ID, status: 'forbundet', zone: 'privat', valg: { opsaetning: 'ny', mappe: '/hjem/Clawco/Vault' }, tid: NU.toISOString(), af: 'henrik', ...over });

test('noterStier: with the env unset the paths come from the chosen vault; with it set the env wins', () => {
  assert.deepEqual(noterStier({}, '/v'), { rod: '/v', indbakke: path.join('/v', '00-Indbakke'), personer: path.join('/v', '40-Mennesker', 'People') });
  assert.deepEqual(noterStier({ KC_VAULT_INBOX: ' /nas/In ', KC_PEOPLE_DIR: '/nas/P' }, '/v'), { rod: '/v', indbakke: '/nas/In', personer: '/nas/P' });
  assert.deepEqual(noterStier({ KC_PEOPLE_DIR: '/nas/P' }, '/v'), { rod: '/v', indbakke: path.join('/v', '00-Indbakke'), personer: '/nas/P' });
  assert.deepEqual(noterStier({}, ''), { rod: '', indbakke: '', personer: '' });
});

test('valgtVault: the connected notes connector\'s folder, nothing when disconnected or another source', () => {
  assert.equal(valgtVault({ kilder: [post()] }), '/hjem/Clawco/Vault');
  assert.equal(valgtVault({ kilder: [post({ status: 'frakoblet' })] }), '');
  assert.equal(valgtVault({ kilder: [post({ id: 'falsk-noter' })] }), '');
  assert.equal(valgtVault({ kilder: [] }), '');
});

test('lavVaultStier follows kilder.json as it changes; an unreadable kilder.json means no chosen vault (fail closed); a fallback inbox only when nothing else is known', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-noter-stier-'));
  try {
    const stier = lavVaultStier({ dataDir: dir, env: {}, standardIndbakke: '/dev/indbakke' });
    assert.equal(stier().indbakke, '/dev/indbakke');
    assert.equal(stier().personer, '');
    await skrivKonfig(dir, { kilder: [post({ valg: { mappe: '/a' } })] });
    assert.equal(stier().indbakke, path.join('/a', '00-Indbakke'));
    await skrivKonfig(dir, { kilder: [post({ valg: { mappe: '/bb' } })] });
    assert.equal(stier().personer, path.join('/bb', '40-Mennesker', 'People'));
    await writeFile(path.join(dir, 'kilder.json'), '{ ødelagt');
    assert.equal(stier().indbakke, '/dev/indbakke');
    assert.equal(lavVaultStier({ env: { KC_VAULT_INBOX: '/env' } })().indbakke, '/env');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the people rule every run carries reads the register path when the run starts', async () => {
  const hermes = createFakeAgent({ answer: () => 'ok' });
  let personer = '';
  const runs = createRunRegistry(hermes, { personer: () => personer });
  const kør = async (): Promise<string> => {
    await runs.start({ kind: 'chat', spec: { input: 'x', instructions: 'y' }, onDone: async (t) => ({ text: t }) }).finished;
    return hermes.calls.at(-1)?.instructions ?? '';
  };
  assert.doesNotMatch(await kør(), /kartotek over mennesker/);
  personer = '/valgt/40-Mennesker/People';
  assert.match(await kør(), /\/valgt\/40-Mennesker\/People/);
});

test('main offers the notes connector unless the host already connects a vault (kira-noter)', () => {
  const ny = () => noterKilde({ hjem: '/hjem' });
  assert.deepEqual(medNoter([], ny).map((k) => k.id), [NOTER_ID]);
  assert.deepEqual(medNoter([kiraNoter({ rod: '/nas', personer: '/nas/P' })], ny).map((k) => k.id), ['kira-noter']);
});

test('Nyheder "Gem til senere" saves into the inbox of the vault chosen on the notes card', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-noter-gem-'));
  try {
    const data = path.join(dir, 'data');
    const vault = path.join(dir, 'Vault');
    await writeFile(path.join(dir, 'avis_2026-10-26.json'), await readFile(new URL('../../fixtures/avis_data_sample.json', import.meta.url), 'utf8'));
    const nyheder = { femLinjer: ['L1', 'L2', 'L3', 'L4', 'L5'], baner: [{ navn: 'Energi', nyheder: [{ titel: 'Reserver i vinter', hvorfor: 'Dit system.', kilde: 'Eksempel Energi', url: 'https://example.org/r' }] }], forslag: [], hermesStatus: 'ok' };
    const hermes = createFakeAgent({ answer: () => '```json\n' + JSON.stringify(nyheder) + '\n```' });
    const sut = createApp({ store: createFileStore(data), dataDir: data, hermes, sourceGlob: path.join(dir, 'avis_{date}.json'), mailRunner: async () => ({ code: 0, stdout: '{"envelopes":[]}', stderr: '' }), mailStateDir: '/nonexistent', now: () => new Date('2026-10-26T07:10:00Z') });
    await skrivKonfig(data, { kilder: [post({ valg: { opsaetning: 'ny', mappe: vault } })] });
    const send = (sti: string, b: unknown) => sut.app.request(sti, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    const vent = async (res: Response): Promise<string> => {
      const tekst = await res.text();
      assert.equal(res.status, 202, tekst);
      const r = await sut.runs.get((JSON.parse(tekst) as { runId: string }).runId)!.finished;
      return `${r.status} ${r.error ?? ''}`;
    };
    assert.equal(await vent(await send('/api/rum/nyheder/opdater', { mode: 'opdater' })), 'done ');
    assert.equal(await vent(await send('/api/rum/nyheder/aktion/gem', { nyhedId: 'n1' })), 'done ');
    assert.match(await readFile(path.join(vault, '00-Indbakke', 'Læs senere.md'), 'utf8'), /Reserver i vinter/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
