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
