// KC-0136: the people register — one markdown file per person in the vault's
// 40-Mennesker/People, the folder telling who is who. The format is written
// down in docs/superpowers/specs/2026-10-31-personregister.md (KC-0129 imports
// through skrivPerson). Reading matches the shape Henrik's register already
// has: the name may live only in the file name, the relation only in the
// folder, `fødselsdag` is read as `foedselsdag`, other keys are left alone.
//
// Invariants: every path goes through iRod (never outside `dir`); a write never
// overwrites — an existing person (any folder, any Unicode form of the name)
// is a collision answered with a diff; Fortryd (fjernPerson) removes only a
// file whose bytes are still exactly what the handling wrote.

import { createHash } from 'node:crypto';
import { mkdir, open, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { erDataZone, type DataZone } from '../../identitet/zoner.ts';
import { KildeFejl } from '../types.ts';
import { filnavn, iRod } from './sti.ts';

/** The relation folders (created on first use). Henrik's register has familie/, arbejde/, andre/. */
export const PERSON_MAPPER = ['familie', 'venner', 'arbejde', 'andre'] as const;

export type PersonFil = { navn: string; relation: string; org?: string; foedselsdag?: string; zone: DataZone; kilde?: string; importeret?: string; tekst?: string };
/** A person as read for a room: no body. `mappe` = the relation folder ('' at the register's root), `sti` relative to it. */
export type PersonPost = Omit<PersonFil, 'tekst'> & { mappe: string; sti: string };
/** What a handling keeps to undo its write: the file and the hash of what it wrote (and what was there before, if any). */
export type Kvittering = { sti: string; sha256: string; forrige?: string };
export type Forskel = { felt: string; nu: string; ny: string };
export type Skrevet = { udfald: 'oprettet'; sti: string; kvittering: Kvittering } | { udfald: 'uaendret'; sti: string } | { udfald: 'kollision'; sti: string; diff: Forskel[] };

const FELTER = ['navn', 'relation', 'org', 'foedselsdag', 'zone', 'kilde', 'importeret'] as const;
type Felt = (typeof FELTER)[number];
const MAKS: Record<Felt, number> = { navn: 120, relation: 80, org: 200, foedselsdag: 40, zone: 20, kilde: 80, importeret: 40 };
const TEKST_MAKS = 20_000;
const FORHOVED_BYTES = 4096;
const KONTROL = /[\u0000-\u001f\u007f]/;

export const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

// ---------- frontmatter ----------

function vaerdi(raw: string): string {
  const v = raw.trim();
  if (v.startsWith('"')) { try { const p: unknown = JSON.parse(v); if (typeof p === 'string') return p; } catch { /* as written */ } }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

/** Frontmatter keys (only the plain `key: value` lines) and the body. A file without frontmatter is all body. */
export function delFil(tekst: string): { felter: Record<string, string>; krop: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(tekst);
  if (!m) return { felter: {}, krop: tekst };
  const felter: Record<string, string> = {};
  for (const linje of (m[1] ?? '').split(/\r?\n/)) {
    const l = /^([\p{L}_][\p{L}\p{N}_-]*):[ \t]*(.*)$/u.exec(linje);
    if (l && l[1] && l[2] !== undefined && l[2] !== '') felter[l[1].normalize('NFC')] = vaerdi(l[2]);
  }
  return { felter, krop: tekst.slice(m[0].length) };
}

const BAR = /^[\p{L}\p{N}][\p{L}\p{N} ._,()'/&+-]*$/u;
const yaml = (v: string): string => (BAR.test(v) ? v : JSON.stringify(v));

function somFil(p: PersonFil): string {
  const linjer = FELTER.filter((f) => p[f] !== undefined && p[f] !== '').map((f) => `${f}: ${yaml(String(p[f]))}`);
  const krop = (p.tekst ?? '').trimEnd();
  return `---\n${linjer.join('\n')}\n---\n${krop ? `${krop}\n` : ''}`;
}

/** The person a file holds: name from frontmatter or the file name, relation from frontmatter or the folder. */
function somPerson(felter: Record<string, string>, fil: string, mappe: string, zone: DataZone): Omit<PersonFil, 'tekst'> {
  const navn = (felter['navn'] || path.basename(fil, '.md')).normalize('NFC').slice(0, MAKS.navn);
  const ud: Omit<PersonFil, 'tekst'> = { navn, relation: (felter['relation'] || mappe).slice(0, MAKS.relation), zone: erDataZone(felter['zone']) ? felter['zone'] : zone };
  const foedselsdag = felter['foedselsdag'] || felter['fødselsdag'];
  if (felter['org']) ud.org = felter['org'].slice(0, MAKS.org);
  if (foedselsdag) ud.foedselsdag = foedselsdag.slice(0, MAKS.foedselsdag);
  if (felter['kilde']) ud.kilde = felter['kilde'].slice(0, MAKS.kilde);
  if (felter['importeret']) ud.importeret = felter['importeret'].slice(0, MAKS.importeret);
  return ud;
}

// ---------- reading ----------

/** The register's person files: `.md` at the root and one folder down; never symlinks; frontmatter from the first 4 KB only. */
async function personFiler(dir: string): Promise<{ mappe: string; navn: string }[]> {
  const ud: { mappe: string; navn: string }[] = [];
  let top;
  try { top = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  for (const p of top) {
    if (p.name.startsWith('.')) continue;
    if (p.isFile() && p.name.endsWith('.md')) ud.push({ mappe: '', navn: p.name });
    else if (p.isDirectory()) {
      const under = await readdir(path.join(dir, p.name), { withFileTypes: true }).catch(() => []);
      for (const f of under) if (f.isFile() && f.name.endsWith('.md') && !f.name.startsWith('.')) ud.push({ mappe: p.name, navn: f.name });
    }
  }
  return ud;
}

async function forhoved(fil: string): Promise<string> {
  const h = await open(fil, 'r');
  try {
    const buf = Buffer.alloc(FORHOVED_BYTES);
    const { bytesRead } = await h.read(buf, 0, FORHOVED_BYTES, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally { await h.close(); }
}

/** Everyone in the register at `dir`, sorted by path. `zone` = the vault's zone, for files that carry none. */
export async function laesPersoner(dir: string, o: { zone: DataZone }): Promise<PersonPost[]> {
  const ud: PersonPost[] = [];
  for (const f of await personFiler(dir)) {
    const sti = f.mappe ? `${f.mappe}/${f.navn}` : f.navn;
    let hoved: string;
    try { hoved = await forhoved(await iRod(dir, sti)); } catch { continue; }
    ud.push({ ...somPerson(delFil(hoved).felter, f.navn, f.mappe, o.zone), mappe: f.mappe, sti: sti.normalize('NFC') });
  }
  return ud.sort((a, b) => (a.sti < b.sti ? -1 : a.sti > b.sti ? 1 : 0));
}

// ---------- writing ----------

function tjekPerson(p: PersonFil): PersonFil {
  const ren: PersonFil = { navn: filnavn(p.navn), relation: '', zone: p.zone };
  if (!erDataZone(p.zone)) throw new KildeFejl(400, 'Ukendt zone.');
  for (const f of ['relation', 'org', 'foedselsdag', 'kilde', 'importeret'] as const) {
    const v = p[f];
    if (v === undefined) continue;
    if (typeof v !== 'string' || v.length > MAKS[f] || KONTROL.test(v)) throw new KildeFejl(400, `Ugyldig ${f}.`);
    if (v.trim()) ren[f] = v.trim();
  }
  if (!ren.relation) throw new KildeFejl(400, 'Relationen mangler.');
  if (p.tekst !== undefined) {
    if (typeof p.tekst !== 'string' || p.tekst.length > TEKST_MAKS || p.tekst.includes('\u0000')) throw new KildeFejl(400, 'Ugyldig tekst.');
    ren.tekst = p.tekst;
  }
  return ren;
}

function tjekMappe(mappe: string): string {
  return mappe === '' ? '' : filnavn(mappe);
}

/** What differs between the file on disk and `ny`. A field `ny` leaves out is not a change. */
function forskelle(nu: Omit<PersonFil, 'tekst'> & { tekst: string }, ny: PersonFil): Forskel[] {
  const ud: Forskel[] = [];
  for (const f of FELTER) {
    const n = ny[f];
    if (n === undefined) continue;
    const g = nu[f] ?? '';
    if (String(g).normalize('NFC') !== String(n).normalize('NFC')) ud.push({ felt: f, nu: String(g), ny: String(n) });
  }
  if (ny.tekst !== undefined && nu.tekst.trimEnd() !== ny.tekst.trimEnd()) ud.push({ felt: 'tekst', nu: nu.tekst.trimEnd(), ny: ny.tekst.trimEnd() });
  return ud;
}

/**
 * Writes person `p` into folder `o.mappe` of the register at `dir` (the folder is made on first use). An existing
 * file for the same name — in any folder — is never overwritten: identical → uaendret, else kollision with the diff.
 * `o.zone` = the vault's zone (for existing files that carry none).
 */
export async function skrivPerson(dir: string, p: PersonFil, o: { mappe: string; zone: DataZone }): Promise<Skrevet> {
  const ren = tjekPerson(p);
  const mappe = tjekMappe(o.mappe);
  const noegle = `${ren.navn}.md`.toLowerCase();
  const findes = (await personFiler(dir)).find((f) => f.navn.normalize('NFC').toLowerCase() === noegle);
  if (findes) {
    const sti = (findes.mappe ? `${findes.mappe}/${findes.navn}` : findes.navn).normalize('NFC');
    const { felter, krop } = delFil(await readFile(await iRod(dir, findes.mappe ? `${findes.mappe}/${findes.navn}` : findes.navn), 'utf8'));
    const diff = forskelle({ ...somPerson(felter, findes.navn, findes.mappe, o.zone), tekst: krop }, ren);
    return diff.length ? { udfald: 'kollision', sti, diff } : { udfald: 'uaendret', sti };
  }
  const sti = mappe ? `${mappe}/${ren.navn}.md` : `${ren.navn}.md`;
  const fil = await iRod(dir, sti);
  await mkdir(path.dirname(fil), { recursive: true });
  const indhold = somFil(ren);
  try { await writeFile(fil, indhold, { encoding: 'utf8', flag: 'wx' }); } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return skrivPerson(dir, p, o); // appeared meanwhile: answer as a collision
    throw err;
  }
  return { udfald: 'oprettet', sti, kvittering: { sti, sha256: sha256(indhold) } };
}

/** Fortryd: removes the file of `k` only while it still holds exactly what was written. True when removed. */
export async function fjernPerson(dir: string, k: Kvittering): Promise<boolean> {
  if (!k.sti.endsWith('.md')) throw new KildeFejl(400, 'Kun en persons fil kan fjernes.');
  const fil = await iRod(dir, k.sti);
  const nu = await readFile(fil, 'utf8').catch(() => null);
  if (nu === null || sha256(nu) !== k.sha256) return false;
  await unlink(fil);
  return true;
}
