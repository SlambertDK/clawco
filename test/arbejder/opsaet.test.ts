import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('../../deploy/arbejder/opsaet.sh', import.meta.url), 'utf8');

test('opsaet.sh does not pass -q to ssh-keyscan (kira-home\'s OpenSSH has no such flag)', () => {
  assert.doesNotMatch(script, /ssh-keyscan\s+-q/);
  assert.match(script, /ssh-keyscan\s+localhost/);
});

test('opsaet.sh gives ~/.ssh/config mode 600, before the keyscan step can stop it', () => {
  const chmod = script.indexOf('chmod 600 ~/.ssh/config');
  assert.ok(chmod > -1, 'chmod 600 ~/.ssh/config is missing');
  assert.ok(chmod < script.indexOf('ssh-keyscan'), 'chmod must come before ssh-keyscan');
});

// KC-0276 (F1/F6): the worker's toolchain and its key are pinned, the key only works from this machine.
test('opsaet.sh: the deploy key is limited with from=, claude-code is pinned exactly, playwright follows package-lock, home is 0700', () => {
  assert.match(script, /restrict,from=\\"127\.0\.0\.1,::1\\",command=/);
  assert.match(script, /^CLAUDE_KODE_VERSION=\d+\.\d+\.\d+$/m);
  assert.match(script, /@anthropic-ai\/claude-code@\$CLAUDE_KODE_VERSION/);
  assert.ok(!/claude-code(?!@)/.test(script.replace(/#.*$/gm, '').replace(/@anthropic-ai\/claude-code@/g, '')), 'no unpinned claude-code install');
  assert.match(script, /playwright-core@\$PW_VERSION install/);
  assert.match(script, /package-lock\.json'\)\.packages\['node_modules\/playwright-core'\]\.version/);
  assert.match(script, /npm ci --ignore-scripts/);
  assert.match(script, /^chmod 700 "\$HJEM"$/m);
  assert.match(script, /stat -c %a "\$HJEM"\)" = 700/);
});

test('arbejder.sh keeps --dangerously-skip-permissions (Henrik\'s design) and names KC-0269 as the gate', () => {
  const a = readFileSync(new URL('../../deploy/arbejder/arbejder.sh', import.meta.url), 'utf8');
  assert.match(a, /--dangerously-skip-permissions/);
  assert.match(a, /KC-0269 is the gate/);
});
