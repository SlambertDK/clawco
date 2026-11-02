// KC-0118 (AGENTS §1): only the composition root picks the agent implementation;
// everything else depends on the AgentClient interface.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const SRC = new URL('../../src/', import.meta.url).pathname;

async function filer(dir: string): Promise<string[]> {
  const ud: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) ud.push(...(await filer(p)));
    else if (e.name.endsWith('.ts')) ud.push(p);
  }
  return ud;
}

test('only src/server.ts imports src/agent/hermes-http.ts', async () => {
  const importoerer: string[] = [];
  for (const f of await filer(SRC)) {
    if (/from\s+['"][^'"]*hermes-http(\.ts)?['"]/.test(await readFile(f, 'utf8'))) importoerer.push(path.relative(SRC, f));
  }
  assert.deepEqual(importoerer, ['server.ts']);
});

test('the guard can fail: it sees an import line', () => {
  assert.ok(/from\s+['"][^'"]*hermes-http(\.ts)?['"]/.test("import { x } from './agent/hermes-http.ts';"));
});
