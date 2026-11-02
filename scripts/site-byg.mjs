// The whole "build" of clawco.work (KC-0164): copy site/ and deploy/install.sh (and, KC-0171, the own-cloud recipe
// deploy/egen-sky/hetzner.sh as /egen-sky/hetzner.sh) into an output folder and prove they arrived byte-identical. No bundler, no transform. The one generated part is
// the legal pages (KC-0204): docs/legal/*.md rendered by scripts/juridisk.ts, checked against their source hash.
//   node scripts/site-byg.mjs [--ud DIR]     (default: .site-ud/, which is gitignored)
// The pricing page (KC-0199) is rendered from config/priser.json by scripts/priser-side.ts, and only when asked for:
//   --preview   include priser.html (with the red draft banner while the config says status "udkast")
//   --live      include priser.html for publishing; REFUSES (exit 1, KC-0169) while the status is "udkast"
//   neither     the page is left out, so the normal build can never publish it
//   --priser FILE   read the prices from FILE instead of config/priser.json (tests)
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { byggJuridisk } from './juridisk.ts';
import { PriserNaegtet, byggPriser, laesPriser, tjekUdgivelse } from './priser-side.ts';

const rod = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kilde = path.join(rod, 'site');
const standard = path.join(rod, '.site-ud');
const i = process.argv.indexOf('--ud');
const ud = path.resolve(i > -1 ? process.argv[i + 1] ?? '' : standard);
if (i > -1 && !process.argv[i + 1]) { console.error('--ud needs a folder'); process.exit(2); }

const preview = process.argv.includes('--preview');
const live = process.argv.includes('--live');
if (preview && live) { console.error('--preview and --live exclude each other'); process.exit(2); }
const pf = process.argv.indexOf('--priser');
if (pf > -1 && !process.argv[pf + 1]) { console.error('--priser needs a file'); process.exit(2); }
// Read and judged before anything is written: a refused build leaves no output folder behind.
let priser = null;
if (preview || live) {
  try {
    priser = laesPriser(pf > -1 ? path.resolve(process.argv[pf + 1]) : path.join(rod, 'config/priser.json'));
    tjekUdgivelse(priser, live ? 'live' : 'preview');
  } catch (e) { console.error(e instanceof PriserNaegtet ? e.message : `prices: ${e.message}`); process.exit(1); }
}

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

// Never published: the notes for the builder, and the price page's template (priser.html is written by byggPriser).
const ikkeUd = new Set([path.join(kilde, 'README.md'), path.join(kilde, 'priser.template.html')]);
cpSync(kilde, ud, { recursive: true, filter: (s) => !ikkeUd.has(s) });
cpSync(path.join(rod, 'deploy/install.sh'), path.join(ud, 'install.sh'));

const a = hash(path.join(rod, 'deploy/install.sh'));
const b = hash(path.join(ud, 'install.sh'));
if (a !== b) { console.error(`install.sh differs from deploy/install.sh (${a} vs ${b})`); process.exit(1); }

// KC-0171: the own-cloud recipe is a download too (read the script first, run it with --dry-run), same proof.
mkdirSync(path.join(ud, 'egen-sky'), { recursive: true });
cpSync(path.join(rod, 'deploy/egen-sky/hetzner.sh'), path.join(ud, 'egen-sky/hetzner.sh'));
const c = hash(path.join(rod, 'deploy/egen-sky/hetzner.sh'));
const d = hash(path.join(ud, 'egen-sky/hetzner.sh'));
if (c !== d) { console.error(`hetzner.sh differs from deploy/egen-sky/hetzner.sh (${c} vs ${d})`); process.exit(1); }

let juridiske;
try { juridiske = byggJuridisk({ docsDir: path.join(rod, 'docs/legal'), ud, siteDir: kilde }); } catch (e) { console.error(`legal pages: ${e.message}`); process.exit(1); }
let priserNote = 'priser.html left out (KC-0199: build with --preview to look at it, --live to publish it)';
if (priser) {
  try { byggPriser({ siteDir: kilde, ud, priser, maal: live ? 'live' : 'preview' }); } catch (e) { console.error(`price page: ${e.message}`); process.exit(1); }
  priserNote = `priser.html built from config/priser.json (${live ? 'live' : 'preview'}, status ${priser.status})`;
}
console.log(`site built into ${ud}: ${filer(ud).length} files (${juridiske.length} legal pages); install.sh sha256 ${b}; hetzner.sh sha256 ${d}; ${priserNote}`);
