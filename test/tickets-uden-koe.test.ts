// KC-0228: the public mirror carries the code but not the ticket queue, so `npm test` there must not fail on the
// missing docs/tickets/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('the ticket check passes, and says so, where there is no ticket queue', () => {
  const rod = mkdtempSync(path.join(tmpdir(), 'kc-uden-koe-'));
  try {
    cpSync(path.resolve(import.meta.dirname, '../scripts/tickets'), path.join(rod, 'scripts/tickets'), { recursive: true });
    const r = spawnSync(process.execPath, [path.join(rod, 'scripts/tickets/check.mjs')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no ticket queue/);
  } finally { rmSync(rod, { recursive: true, force: true }); }
});
