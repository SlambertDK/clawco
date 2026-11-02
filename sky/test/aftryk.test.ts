// KC-0176 invariant (AGENTS §0 r2): Sky and the tenant share no code path and no secret.
// Checked structurally: import lines in both trees, the tenant .dockerignore, sky/.env.example,
// and the tenant domain literal living in one file only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skyRod = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRod = path.resolve(skyRod, '..');
const KODE = /\.(ts|mts|js|mjs|cjs)$/;

function filer(dir: string, match: RegExp): string[] {
  if (!fs.existsSync(dir)) return [];
  const ud: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) ud.push(...filer(p, match));
    else if (match.test(e.name)) ud.push(p);
  }
  return ud;
}

/** Every module specifier a file imports: static, side-effect, dynamic, re-export, require. */
export function specifikationer(kilde: string): string[] {
  const ud: string[] = [];
  const mønstre = [/\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g];
  for (const m of mønstre) for (const hit of kilde.matchAll(m)) if (hit[1]) ud.push(hit[1]);
  return ud;
}

function erUnder(p: string, dir: string): boolean {
  const rel = path.relative(dir, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

test('the specifier reader sees every import form', () => {
  const s = specifikationer(`import a from '../sky/x.ts';\nimport '../sky/y.ts';\nexport { b } from "../sky/z.ts";\nconst c = await import('../sky/w.ts');\nconst d = require('clawco-sky');`);
  assert.deepEqual(s.sort(), ['../sky/w.ts', '../sky/x.ts', '../sky/y.ts', '../sky/z.ts', 'clawco-sky'].sort());
});

test('nothing in the tenant imports from sky/', () => {
  const tenant = ['src', 'test', 'scripts', 'public', 'deploy'].flatMap((d) => filer(path.join(repoRod, d), KODE));
  assert.ok(tenant.length > 50, 'fandt næsten ingen tenant-filer; peger testen det rigtige sted hen?');
  const brud: string[] = [];
  for (const f of tenant) {
    for (const s of specifikationer(fs.readFileSync(f, 'utf8'))) {
      const rammer = s === 'clawco-sky' || s.startsWith('clawco-sky/') || (s.startsWith('.') && erUnder(path.resolve(path.dirname(f), s), skyRod));
      if (rammer) brud.push(`${path.relative(repoRod, f)} → ${s}`);
    }
  }
  assert.deepEqual(brud, []);
});

test('nothing in sky/ imports from outside sky/', () => {
  const sky = ['src', 'test', 'scripts'].flatMap((d) => filer(path.join(skyRod, d), KODE));
  assert.ok(sky.length > 3);
  const brud: string[] = [];
  for (const f of sky) {
    for (const s of specifikationer(fs.readFileSync(f, 'utf8'))) {
      if ((s.startsWith('.') || s.startsWith('/')) && !erUnder(path.resolve(path.dirname(f), s), skyRod)) brud.push(`${path.relative(repoRod, f)} → ${s}`);
    }
  }
  assert.deepEqual(brud, []);
});

test('Sky modules never import each other (shared code lives in delt/, the database in db/)', () => {
  const src = path.join(skyRod, 'src');
  // Who a folder may import from (besides itself). Top-level files (server, config, helbred) wire
  // everything together and are not checked; a folder never imports a top-level file.
  const tilladt = (eget: string): Set<string> => new Set(eget === 'delt' ? ['delt'] : eget === 'db' ? ['db', 'delt'] : [eget, 'delt', 'db']);
  const brud: string[] = [];
  for (const f of filer(src, KODE)) {
    const rel = path.relative(src, f).split(path.sep);
    if (rel.length < 2) continue;
    const ok = tilladt(rel[0]!);
    for (const s of specifikationer(fs.readFileSync(f, 'utf8'))) {
      if (!s.startsWith('.')) continue;
      const maal = path.relative(src, path.resolve(path.dirname(f), s)).split(path.sep);
      if (maal.length < 2 || !ok.has(maal[0]!)) brud.push(`${rel.join('/')} → ${s}`);
    }
  }
  assert.deepEqual(brud, []);
});

test('the tenant image never gets sky/: .dockerignore excludes it', () => {
  const linjer = fs.readFileSync(path.join(repoRod, '.dockerignore'), 'utf8').split('\n').map((l) => l.trim());
  assert.ok(linjer.includes('sky/') || linjer.includes('sky'), '.dockerignore skal udelukke sky/');
});

test('sky/.env.example names keys only, never a value', () => {
  const linjer = fs.readFileSync(path.join(skyRod, '.env.example'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  assert.ok(linjer.length >= 4);
  for (const l of linjer) assert.match(l, /^SKY_[A-Z0-9_]+=$/, `linjen har en værdi eller et forkert navn: ${l.split('=')[0]}`);
  for (const k of ['SKY_DATABASE_URL', 'SKY_PUBLIC_URL', 'SKY_PORT', 'SKY_BASEDOMAIN']) assert.ok(linjer.includes(`${k}=`), `${k} mangler`);
});

test('the tenant domain literal lives in sky/src/config.ts only (AGENTS §0 r6)', () => {
  const naal = "'clawco" + ".work'"; // the quoted literal: URLs like https://clawco.work/skema are not the tenant domain
  const steder = [...['src', 'public', 'scripts', 'deploy'].map((d) => path.join(repoRod, d)), ...['src', 'scripts', 'deploy'].map((d) => path.join(skyRod, d))];
  const hits = steder.flatMap((d) => filer(d, /^(?!.*\.md$).+$/)).filter((f) => fs.readFileSync(f, 'utf8').includes(naal));
  assert.deepEqual(hits.map((f) => path.relative(repoRod, f)), [path.join('sky', 'src', 'config.ts')]);
});
