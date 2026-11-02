import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// KC-0125: `npm run hemmeligheder` — which secret names are set on this host: name and length, never a value.
const SCRIPT = fileURLToPath(new URL('../scripts/hemmeligheder.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));
const HERMES = 'planted-hermes-key-VALUE-1234';
const ELEVEN = 'planted-eleven-key-VALUE-5678';

function koer(env: Record<string, string>): { status: number | null; ud: string } {
  // A clean environment: only PATH and the planted names, so the host's own secrets never enter the test.
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: REPO, env: { PATH: process.env['PATH'] ?? '', ...env }, encoding: 'utf8' });
  return { status: r.status, ud: `${r.stdout}\n${r.stderr}` };
}

test('prints each secret name with its length and never a value; exits 0 when the required name is set', () => {
  const { status, ud } = koer({ KC_HERMES_API_KEY: HERMES, KC_ELEVENLABS_API_KEY: ELEVEN });
  assert.equal(status, 0, ud);
  assert.match(ud, new RegExp(`KC_HERMES_API_KEY\\s+sat \\(længde ${HERMES.length}\\)`));
  assert.match(ud, new RegExp(`KC_ELEVENLABS_API_KEY\\s+sat \\(længde ${ELEVEN.length}\\)`));
  assert.ok(!ud.includes(HERMES) && !ud.includes(ELEVEN) && !ud.includes('VALUE'), 'no value, not even a piece');
});

test('a missing required name says "mangler" and exits 1; a missing optional one says it too but exits 0', () => {
  const uden = koer({});
  assert.equal(uden.status, 1, uden.ud);
  assert.match(uden.ud, /KC_HERMES_API_KEY\s+mangler \(påkrævet\)/);
  assert.match(uden.ud, /KC_ELEVENLABS_API_KEY\s+mangler\b/);
  const valgfri = koer({ KC_HERMES_API_KEY: HERMES });
  assert.equal(valgfri.status, 0, valgfri.ud);
  assert.match(valgfri.ud, /KC_ELEVENLABS_API_KEY\s+mangler\b/);
});

test('the fake agent needs no key; konto mode requires its names', () => {
  assert.equal(koer({ KC_AGENT: 'fake' }).status, 0);
  const konto = koer({ KC_AGENT: 'fake', KC_IDENTITET: 'konto' });
  assert.equal(konto.status, 1);
  assert.match(konto.ud, /KC_KONTO_PUBKEY\s+mangler \(påkrævet\)/);
});

test('a value below the minimum length is reported as "for kort" (it would not be masked), with its length', () => {
  const { ud } = koer({ KC_HERMES_API_KEY: 'kort123', KC_AGENT: 'hermes-http' });
  assert.match(ud, /KC_HERMES_API_KEY\s+for kort \(længde 7, maskeres ikke\)/);
  assert.ok(!ud.includes('kort123'));
});

test('model keys of the direct agent (KC_MODEL_NOEGLE_*) are listed by name and length though they are not in the template', () => {
  const { ud } = koer({ KC_AGENT: 'direkte', KC_MODEL_NOEGLE_ANTHROPIC: 'sk-ant-planted-model-0001' });
  assert.match(ud, /KC_MODEL_NOEGLE_ANTHROPIC\s+sat \(længde 25\)/);
  assert.ok(!ud.includes('sk-ant-planted'));
});

test('the script reads the names from the template and never opens a file that could hold a value', () => {
  const kilde = readFileSync(SCRIPT, 'utf8');
  assert.match(kilde, /\.env\.example/);
  assert.ok(!/['"`]\.env['"`]/.test(kilde), 'no reference to the real .env file');
  assert.ok(!/readFile\w*\([^)]*process\.argv/.test(kilde), 'no file chosen from the command line');
});
