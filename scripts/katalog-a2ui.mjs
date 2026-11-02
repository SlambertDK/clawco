#!/usr/bin/env node
// KC-0163: write the building blocks as an A2UI catalog (docs/a2ui/clawco-katalog.json).
//   npm run katalog:a2ui                 write the file
//   npm run katalog:a2ui -- --tjek       exit 1 when the file differs from what the code exports (drift)
//   --fil STI                            use another file than docs/a2ui/clawco-katalog.json (tests)
// The export is derived in src/shell/a2ui.ts from src/shell/katalog.ts; this file only reads flags and files.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tilA2ui, tilTekst } from '../src/shell/a2ui.ts';

const rod = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const tjek = args.includes('--tjek');
const i = args.indexOf('--fil');
const fil = i >= 0 && args[i + 1] ? path.resolve(args[i + 1]) : path.join(rod, 'docs', 'a2ui', 'clawco-katalog.json');
const ukendt = args.filter((a, j) => a !== '--tjek' && a !== '--fil' && args[j - 1] !== '--fil');
if (ukendt.length) { console.error(`Ukendt argument: ${ukendt.join(' ')}\nBrug: npm run katalog:a2ui [-- --tjek] [--fil STI]`); process.exit(2); }

const tekst = tilTekst(tilA2ui());
if (tjek) {
  let paaDisk = null;
  try { paaDisk = readFileSync(fil, 'utf8'); } catch { /* missing counts as drift */ }
  if (paaDisk === tekst) { console.log(`A2UI-kataloget er ajour (${path.relative(rod, fil) || fil}).`); process.exit(0); }
  console.error(`${path.relative(rod, fil) || fil} er ikke som koden eksporterer den (eller findes ikke). Kør: npm run katalog:a2ui`);
  process.exit(1);
}
mkdirSync(path.dirname(fil), { recursive: true });
writeFileSync(fil, tekst);
console.log(`Skrev ${path.relative(rod, fil) || fil} (${tekst.length} tegn).`);
