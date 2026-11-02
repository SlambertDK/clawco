// The whole "build" of clawco.work (KC-0164): copy site/ and deploy/install.sh into an output
// folder and prove the installer arrived byte-identical. No bundler, no transform. The one generated part is
// the legal pages (KC-0204): docs/legal/*.md rendered by scripts/juridisk.ts, checked against their source hash.
//   node scripts/site-byg.mjs [--ud DIR]     (default: .site-ud/, which is gitignored)
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { byggJuridisk } from './juridisk.ts';

const rod = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kilde = path.join(rod, 'site');
const standard = path.join(rod, '.site-ud');
const i = process.argv.indexOf('--ud');
const ud = path.resolve(i > -1 ? process.argv[i + 1] ?? '' : standard);
if (i > -1 && !process.argv[i + 1]) { console.error('--ud needs a folder'); process.exit(2); }

const hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const filer = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filer(path.join(d, e.name)) : [1]));

if (ud === kilde || ud.startsWith(kilde + path.sep) || kilde.startsWith(ud + path.sep)) {
  console.error(`${ud} is inside the source folder (or contains it); pick an output folder outside site/`);
  process.exit(2);
}
// Only the default output is cleaned; a folder named by hand must be new or empty, never someone's data.
if (ud === standard) rmSync(ud, { recursive: true, force: true });
else if (existsSync(ud) && readdirSync(ud).length > 0) { console.error(`${ud} is not empty; refusing to write into it`); process.exit(2); }
mkdirSync(ud, { recursive: true });

// Never published: the notes for the builder.
cpSync(kilde, ud, { recursive: true, filter: (s) => s !== path.join(kilde, 'README.md') });
cpSync(path.join(rod, 'deploy/install.sh'), path.join(ud, 'install.sh'));

const a = hash(path.join(rod, 'deploy/install.sh'));
const b = hash(path.join(ud, 'install.sh'));
if (a !== b) { console.error(`install.sh differs from deploy/install.sh (${a} vs ${b})`); process.exit(1); }

let juridiske;
try { juridiske = byggJuridisk({ docsDir: path.join(rod, 'docs/legal'), ud, siteDir: kilde }); } catch (e) { console.error(`legal pages: ${e.message}`); process.exit(1); }
console.log(`site built into ${ud}: ${filer(ud).length} files (${juridiske.length} legal pages); install.sh sha256 ${b}`);
