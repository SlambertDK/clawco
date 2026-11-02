// KC-0181: Sky refuses to START with a fleet and no valid master key (AGENTS §0 r7). A real child process,
// no database reachable on purpose: the check comes before anything connects. Neither stdout nor stderr
// ever contains the value that was given.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'server.ts');
const PUBKEY = 'A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg';
const BASIS = {
  PATH: process.env['PATH'] ?? '',
  SKY_DATABASE_URL: 'postgres://ingen:ingen@127.0.0.1:1/ingen', SKY_PUBLIC_URL: 'https://konto.example.test',
  SKY_FLAADE: 'lokal', SKY_TENANT_BILLEDE: 'clawco:test', SKY_KONTO_PUBKEY: PUBKEY,
};

function start(env: Record<string, string>) {
  return spawnSync(process.execPath, [SERVER], { encoding: 'utf8', env, timeout: 20_000 });
}

test('a fleet without SKY_MASTERNOEGLE: exit 1, the message names the key', () => {
  const r = start(BASIS);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /SKY_MASTERNOEGLE mangler/);
});

test('a fleet with an invalid SKY_MASTERNOEGLE: exit 1, the value is never printed', () => {
  const r = start({ ...BASIS, SKY_MASTERNOEGLE: 'HEMMELIG-VAERDI-DER-IKKE-ER-EN-NOEGLE' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /SKY_MASTERNOEGLE er ugyldig/);
  assert.ok(!(r.stdout + r.stderr).includes('HEMMELIG-VAERDI'));
});

test('with a valid key the gate is passed (it then stops on the unreachable database, not on the key)', () => {
  const r = start({ ...BASIS, SKY_MASTERNOEGLE: Buffer.alloc(32, 9).toString('base64') });
  assert.doesNotMatch(r.stderr, /SKY_MASTERNOEGLE/);
  assert.equal(r.status, 1, 'no database: still does not start');
});
