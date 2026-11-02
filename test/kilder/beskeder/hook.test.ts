// KC-0138: the contract between Hermes' gateway hook (deploy/hermes/beskeder-hook.py) and the connector's reader —
// what the hook writes for a documented agent:start / gateway:startup context is exactly what jsonl.ts reads.
// Runs the hook with python3 against a temp dir; skipped where python3 is missing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { laesLog, laesStatus } from '../../../src/kilder/beskeder/jsonl.ts';

const HOOK = fileURLToPath(new URL('../../../deploy/hermes/beskeder-hook.py', import.meta.url));
const harPython = (() => { try { execFileSync('python3', ['-c', 'pass']); return true; } catch { return false; } })();

function koer(dataDir: string | null, kald: [string, unknown][]): void {
  const py = `import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("hook", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
for e, c in json.loads(sys.argv[2]): m.handle(e, c)`;
  const env = { ...process.env, CLAWCO_DATA_DIR: dataDir ?? '', PYTHONDONTWRITEBYTECODE: '1' };
  execFileSync('python3', ['-I', '-B', '-c', py, HOOK, JSON.stringify(kald)], { env });
}

test('the hook writes what the reader reads: channels only, groups marked, other platforms and junk ignored', { skip: !harPython }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-beskeder-hook-'));
  try {
    koer(dir, [
      ['gateway:startup', { platforms: ['telegram', 'api_server', 'whatsapp'] }],
      ['agent:start', { platform: 'telegram', user_id: '111', chat_id: '-100', chat_type: 'group', session_id: 's', message: 'Hej familien' }],
      ['agent:start', { platform: 'whatsapp', user_id: '4512345678@s.whatsapp.net', chat_id: '4512345678@s.whatsapp.net', chat_type: 'dm', session_id: 's', message: 'x'.repeat(900) }],
      ['agent:start', { platform: 'api_server', user_id: 'u', chat_id: 'c', chat_type: 'dm', message: 'ikke en kanal' }],
      ['agent:start', { platform: 'signal', user_id: '', chat_id: 'c', message: 'ingen afsender' }],
      ['agent:end', { platform: 'telegram', user_id: '1', chat_id: '1', message: 'svar' }],
    ]);
    const log = await laesLog(path.join(dir, 'beskeder'));
    assert.equal(log?.length, 2);
    assert.deepEqual(log?.map((l) => [l.kanal, l.gruppe]), [['telegram', true], ['whatsapp', false]]);
    assert.equal(log?.[1]?.tekst.length, 500);
    assert.deepEqual((await laesStatus(path.join(dir, 'beskeder')))?.kanaler, ['telegram', 'whatsapp']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('without CLAWCO_DATA_DIR the hook writes nothing anywhere', { skip: !harPython }, async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'kc-beskeder-hook-'));
  try {
    execFileSync('python3', ['-I', '-B', '-c', `import importlib.util, sys
spec = importlib.util.spec_from_file_location("hook", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.handle("agent:start", {"platform": "telegram", "user_id": "1", "chat_id": "1", "message": "hej"})`, HOOK], { cwd, env: { ...process.env, CLAWCO_DATA_DIR: '', PYTHONDONTWRITEBYTECODE: '1' } });
    assert.deepEqual(await readdir(cwd), []);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
