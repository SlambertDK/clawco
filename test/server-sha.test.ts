import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitSha } from '../src/server.ts';

// KC-0157: an image has no .git, so the build bakes the sha into <app>/GIT_SHA and /health reads it first.
function medMappe(fn: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'kc-sha-'));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('a baked GIT_SHA file wins, and git is never asked', () => {
  medMappe((dir) => {
    writeFileSync(path.join(dir, 'GIT_SHA'), 'abc1234\n');
    assert.equal(gitSha(dir, () => { throw new Error('git må ikke køre'); }), 'abc1234');
  });
});

test('without the file the sha comes from git', () => {
  medMappe((dir) => assert.equal(gitSha(dir, () => 'def5678'), 'def5678'));
});

test('an empty GIT_SHA file (a build without the arg) falls back to git', () => {
  medMappe((dir) => {
    writeFileSync(path.join(dir, 'GIT_SHA'), '  \n');
    assert.equal(gitSha(dir, () => 'def5678'), 'def5678');
  });
});

test('neither a file nor git: unknown', () => {
  medMappe((dir) => assert.equal(gitSha(dir, () => { throw new Error('ingen git'); }), 'unknown'));
});
