// AGENTS.md §1 dependency direction: the agent seam (src/agent/) depends on
// nothing in src/ but its own folder; what it needs from the app (the secrets
// module's env-file writer, KC-0127) is injected by the composition root.
// Node built-ins and packages are fine. The one standing exception is the
// prompt builder (KC-0118, spec D4: prompts are built on the app's side of the
// seam) and the language table (KC-0170), each held to exactly the imports it has, so nothing new slips in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAPPE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'agent');
const UNDTAGET: Record<string, string[]> = {
  'prompt.ts': ['../identitet/zoner.ts', '../shell/katalog.ts', '../graenser/verber.ts'],
  // KC-0123: the untrusted-data wrapper tags every segment with its zone.
  'udtroet.ts': ['../identitet/zoner.ts'],
  // KC-0170: the language of the request (src/store/sprog.ts, the seam below the shell) picks the words of a failed connection.
  'tekster.ts': ['../store/sprog.ts'],
};

/** Every module specifier a file imports or re-exports (static and dynamic). */
function specifikatorer(kilde: string): string[] {
  const ud: string[] = [];
  for (const m of kilde.matchAll(/\b(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm)) ud.push((m[1] ?? m[2] ?? m[3])!);
  return ud;
}

test('nothing under src/agent/ imports from outside src/agent/ (but the prompt builder\'s two)', () => {
  const filer = readdirSync(MAPPE, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'));
  assert.ok(filer.includes('hermes-http.ts') && filer.includes('prompt.ts'), 'the scan sees the folder');
  const brud: string[] = [];
  for (const f of filer) {
    for (const s of specifikatorer(readFileSync(path.join(MAPPE, f), 'utf8'))) {
      if (!s.startsWith('.') && !s.startsWith('/')) continue; // node:… and packages
      const maal = path.resolve(MAPPE, path.dirname(f), s);
      if (maal.startsWith(MAPPE + path.sep)) continue;
      if (UNDTAGET[f]?.includes(s)) continue;
      brud.push(`${f} → ${s}`);
    }
  }
  assert.deepEqual(brud, []);
});

test('the scan catches an outside import (the test can fail)', () => {
  assert.deepEqual(specifikatorer("import { x } from '../kilder/hemmeligheder.ts';\nimport type { Y } from './types.ts';\nconst z = await import('../server.ts');"), ['../kilder/hemmeligheder.ts', './types.ts', '../server.ts']);
});
