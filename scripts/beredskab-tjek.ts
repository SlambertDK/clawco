// KC-0207: the check for the breach plan (docs/beredskab/). No dependency; run with Node's type stripping.
//   node scripts/beredskab-tjek.ts             lists every open placeholder [..] with file and line; exit 0 (a warning)
//   node scripts/beredskab-tjek.ts --streng    the same, but exit 1 while a placeholder is open in the plan itself
//                                              (the launch gate, KC-0175)
//   --rod <mappe>                              check another folder with the same layout (the tests use it)
//
// Two kinds of placeholder, because they mean different things:
//   ÅBEN  in docs/beredskab/README.md: something the plan still lacks (the lawyer's contact, until one is chosen).
//         Blocking in --streng.
//   FELT  in docs/beredskab/skabeloner/*: a field to fill in when a message is written during an incident. Always
//         present by design, listed for the writer, never blocking.
// Whatever the mode, exit 1 when the security contact is not one mailbox everywhere or security.txt is about to lapse:
//   - Contact: in site/.well-known/security.txt, "postkasse" in config/hjaelp.json and the "Os selv" row of the
//     plan's contact table (section "Kontaktpunkter") name the same address;
//   - Expires: in security.txt is more than 30 days away (the same bar as test/site-hjaelp.test.ts).
// Prints file, line and the placeholder only, never anything else from the plan.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const BRUG = 'brug: beredskab-tjek.ts [--streng] [--rod <mappe>]';
const DAG = 86_400_000;
const RUNBOG = 'docs/beredskab/README.md';
const SKABELONER = 'docs/beredskab/skabeloner';

export type Fund = { fil: string; linje: number; tekst: string };

/** Every `[..]` with something in it, except markdown links `[a](b)` and checkbox marks `[ ]` / `[x]`. */
export function pladsholdere(fil: string, tekst: string): Fund[] {
  const ud: Fund[] = [];
  tekst.split('\n').forEach((l, i) => {
    for (const m of l.matchAll(/\[([^[\]]+)\](?!\()/g)) {
      const inde = m[1]!.trim();
      if (inde && !/^x$/i.test(inde)) ud.push({ fil, linje: i + 1, tekst: m[0] });
    }
  });
  return ud;
}

const MAIL = /[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g;

/** The mailboxes in the "Os selv" row of the runbook's contact table; null when there is no such row. */
export function egneAdresser(runbog: string): string[] | null {
  let i = false;
  for (const l of runbog.split('\n')) {
    const h = /^## (.+?)\s*$/.exec(l);
    if (h) i = h[1] === 'Kontaktpunkter';
    else if (i && /^\|\s*Os selv\b/i.test(l)) return [...new Set([...l.matchAll(MAIL)].map((m) => m[0].toLowerCase()))];
  }
  return null;
}

export function tjekKontakt(rod: string, runbog: string, nu: number): string[] {
  const fejl: string[] = [];
  const stiTxt = path.join(rod, 'site/.well-known/security.txt');
  const stiCfg = path.join(rod, 'config/hjaelp.json');
  if (!existsSync(stiTxt)) return [`security.txt mangler: ${path.relative(rod, stiTxt)}`];
  const txt = readFileSync(stiTxt, 'utf8');
  const felter = (n: string): string[] => txt.split('\n').flatMap((l) => (l.toLowerCase().startsWith(`${n.toLowerCase()}:`) ? [l.slice(n.length + 1).trim()] : []));
  let postkasse = '';
  try { postkasse = String((JSON.parse(readFileSync(stiCfg, 'utf8')) as { postkasse?: unknown }).postkasse ?? '').toLowerCase(); } catch { /* reported below */ }
  if (!postkasse) fejl.push('config/hjaelp.json har ingen "postkasse"');
  const kontakter = felter('Contact').map((c) => c.replace(/^mailto:/i, '').toLowerCase());
  if (!kontakter.length) fejl.push('security.txt har ingen Contact:');
  else if (postkasse && kontakter.some((k) => k !== postkasse)) fejl.push('Contact: i security.txt er ikke postkassen i config/hjaelp.json');
  const egne = egneAdresser(runbog);
  if (egne === null) fejl.push('beredskabsplanen har ingen række "Os selv" i afsnittet Kontaktpunkter');
  else if (postkasse && (egne.length !== 1 || egne[0] !== postkasse)) fejl.push('rækken "Os selv" i Kontaktpunkter nævner ikke præcis postkassen i config/hjaelp.json (som security.txt)');
  const e = felter('Expires')[0];
  const t = e ? Date.parse(e) : NaN;
  if (Number.isNaN(t)) fejl.push('Expires: i security.txt mangler eller er ikke en dato');
  else if (t - nu <= 30 * DAG) fejl.push(`Expires: i security.txt er ${e}, mindre end 30 dage væk eller overskredet: forny datoen (højst et år frem) og udgiv sitet`);
  return fejl;
}

function main(argv: string[]): number {
  const streng = argv.includes('--streng');
  const ri = argv.indexOf('--rod');
  const ukendt = argv.filter((a, i) => a !== '--streng' && a !== '--rod' && !(ri >= 0 && i === ri + 1));
  if (ukendt.length || (ri >= 0 && !argv[ri + 1])) { console.error(BRUG); return 2; }
  const rod = path.resolve(ri >= 0 ? argv[ri + 1]! : path.join(import.meta.dirname, '..'));

  const stiRunbog = path.join(rod, RUNBOG);
  if (!existsSync(stiRunbog)) { console.log(`FEJL beredskabsplanen findes ikke: ${RUNBOG}`); return 1; }
  const runbog = readFileSync(stiRunbog, 'utf8');
  const aabne = pladsholdere(RUNBOG, runbog);
  const mappe = path.join(rod, SKABELONER);
  const felter = (existsSync(mappe) ? readdirSync(mappe).filter((f) => f.endsWith('.md')).sort() : [])
    .flatMap((f) => pladsholdere(`${SKABELONER}/${f}`, readFileSync(path.join(mappe, f), 'utf8')));

  for (const f of aabne) console.log(`ÅBEN ${f.fil}:${f.linje} ${f.tekst}`);
  for (const f of felter) console.log(`FELT ${f.fil}:${f.linje} ${f.tekst}`);
  if (aabne.length) console.log(`ADVARSEL: ${aabne.length} åben(e) pladsholder(e) i beredskabsplanen. De skal være udfyldt, før produktet åbner (--streng tjekker det).`);
  else console.log('Ingen åbne pladsholdere i beredskabsplanen.');
  console.log(`${felter.length} felt(er) i skabelonerne udfyldes, når en besked skrives (ikke en fejl).`);

  const fejl = tjekKontakt(rod, runbog, Date.now());
  for (const f of fejl) console.log(`FEJL ${f}`);
  if (fejl.length) return 1;
  return streng && aabne.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) process.exitCode = main(process.argv.slice(2));
