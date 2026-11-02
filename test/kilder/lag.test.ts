// KC-0170: the dependency direction of src/kilder/ (AGENTS §1): store/, identitet/ and graenser/ only — never shell/, rooms/,
// hushold/ or the server. The language reaches a connector through src/store/sprog.ts, not through the shell's tables.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const TILLADT = new Set(['store', 'identitet', 'graenser', 'kilder']);

function filer(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? filer(p) : p.endsWith('.ts') ? [p] : [];
  });
}

test('src/kilder imports only store/, identitet/, graenser/ and itself', () => {
  const brud: string[] = [];
  for (const fil of filer(path.join(src, 'kilder'))) {
    for (const m of readFileSync(fil, 'utf8').matchAll(/^(?:import|export)\s[^;]*?from\s+'(\.[^']+)'/gm)) {
      const mod = path.relative(src, path.resolve(path.dirname(fil), m[1] as string)).split(path.sep)[0] ?? '';
      if (!TILLADT.has(mod) && !mod.startsWith('..')) brud.push(`${path.relative(src, fil)} -> ${m[1]}`);
    }
  }
  assert.deepEqual(brud, []);
});
