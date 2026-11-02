// KC-0136: the people register — one markdown file per person in the vault's
// 40-Mennesker/People, the folder telling who is who. The format is written
// down in docs/superpowers/specs/2026-10-31-personregister.md (KC-0129 imports
// through skrivPerson). Reading matches the shape Henrik's register already
// has: the name may live only in the file name, the relation only in the
// folder, `fødselsdag` is read as `foedselsdag`, other keys are left alone.
//
// Invariants: every path goes through iRod (never outside `dir`); skrivPerson never
// overwrites — an existing person (any folder, any Unicode form of the name)
// is a collision answered with a diff; Fortryd (fjernPerson) removes only a
// file whose bytes are still exactly what the handling wrote. The one way to
// change an existing person is opdaterPerson (KC-0219): only the fields the user
// saw in the diff, in place, atomically, and gendanPerson puts the old bytes back.

import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { erDataZone, type DataZone } from '../../identitet/zoner.ts';
import { KildeFejl } from '../types.ts';
import { noterTekst } from './tekster.ts';
import { filnavn, iRod } from './sti.ts';

/** The relation folders (created on first use). Henrik's register has familie/, arbejde/, andre/. */
export const PERSON_MAPPER = ['familie', 'venner', 'arbejde', 'andre'] as const;

export type PersonFil = { navn: string; relation: string; org?: string; foedselsdag?: string; zone: DataZone; kilde?: string; importeret?: string; tekst?: string };
/** A person as read for a room: no body. `mappe` = the relation folder ('' at the register's root), `sti` relative to it. */
export type PersonPost = Omit<PersonFil, 'tekst'> & { mappe: string; sti: string; kanaler?: Kanaler };
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

// ---------- per-channel ids (KC-0225) ----------

/**
 * The ids a person has on the message channels, written by hand in the person's own file as ONE line of flow-style
 * frontmatter (Obsidian reads it as a property):
 *   kanaler: { signal: "+45 12 34 56 78", whatsapp: "+4512345678", telegram: "@maja_dk", telefon: "+4512345678" }
 * Keys are lowercase words (the channel, or `telefon` = a phone number for any phone channel); values are text, quoted
 * when they hold a comma or start with @. Clawco only reads it, to name a sender; the ids never leave the register.
 */
export type Kanaler = Record<string, string>;
const KANAL_NOEGLE = /^[a-z][a-z0-9_-]{1,19}$/;
const KANAL_VAERDI_MAKS = 80;
const KANALER_MAKS = 8;

/** Splits on commas outside quotes; null when a quote is never closed. */
function delKanalPar(inde: string): string[] | null {
  const dele: string[] = [];
  let nu = '';
  let q: string | null = null;
  for (let i = 0; i < inde.length; i += 1) {
    const c = inde[i] as string;
    if (q) {
      nu += c;
      if (c === '\\' && q === '"') { nu += inde[i + 1] ?? ''; i += 1; } else if (c === q) q = null;
    } else if (c === '"' || c === "'") { q = c; nu += c; } else if (c === ',') { dele.push(nu); nu = ''; } else nu += c;
  }
  if (q) return null;
  dele.push(nu);
  return dele;
}

/** The `kanaler` value of a person file's frontmatter; undefined when absent or not a one-line map. Bad pairs are dropped; never throws. */
export function laesKanaler(raa: string | undefined): Kanaler | undefined {
  const t = (raa ?? '').trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return undefined;
  const dele = delKanalPar(t.slice(1, -1));
  if (!dele) return undefined;
  const ud: Kanaler = {};
  for (const del of dele) {
    const m = /^\s*(["']?)([^:"']+)\1\s*:\s*(.*?)\s*$/s.exec(del);
    if (!m) continue;
    const noegle = (m[2] as string).trim().toLowerCase();
    const v = vaerdi(m[3] as string);
    if (!KANAL_NOEGLE.test(noegle) || noegle in ud || !v || v.length > KANAL_VAERDI_MAKS || KONTROL.test(v) || Object.keys(ud).length >= KANALER_MAKS) continue;
    ud[noegle] = v;
  }
  return Object.keys(ud).length ? ud : undefined;
}

/** The frontmatter line for `k` (what laesKanaler reads back). */
export const somKanalLinje = (k: Kanaler): string => `kanaler: { ${Object.entries(k).map(([n, v]) => `${n}: ${JSON.stringify(v)}`).join(', ')} }`;

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
    const { felter } = delFil(hoved);
    const kanaler = laesKanaler(felter['kanaler']);
    ud.push({ ...somPerson(felter, f.navn, f.mappe, o.zone), mappe: f.mappe, sti: sti.normalize('NFC'), ...(kanaler ? { kanaler } : {}) });
  }
  return ud.sort((a, b) => (a.sti < b.sti ? -1 : a.sti > b.sti ? 1 : 0));
}

// ---------- writing ----------

function tjekPerson(p: PersonFil): PersonFil {
  const ren: PersonFil = { navn: filnavn(p.navn), relation: '', zone: p.zone };
  if (!erDataZone(p.zone)) throw new KildeFejl(400, noterTekst().ukendtZone);
  for (const f of ['relation', 'org', 'foedselsdag', 'kilde', 'importeret'] as const) {
    const v = p[f];
    if (v === undefined) continue;
    if (typeof v !== 'string' || v.length > MAKS[f] || KONTROL.test(v)) throw new KildeFejl(400, noterTekst().ugyldigt(noterTekst().personFelt[f] ?? f));
    if (v.trim()) ren[f] = v.trim();
  }
  if (!ren.relation) throw new KildeFejl(400, noterTekst().relationenMangler);
  if (p.tekst !== undefined) {
    if (typeof p.tekst !== 'string' || p.tekst.length > TEKST_MAKS || p.tekst.includes('\u0000')) throw new KildeFejl(400, noterTekst().ugyldigTekst);
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
  if (!k.sti.endsWith('.md')) throw new KildeFejl(400, noterTekst().kunPersonFil);
  const fil = await iRod(dir, k.sti);
  const nu = await readFile(fil, 'utf8').catch(() => null);
  if (nu === null || sha256(nu) !== k.sha256) return false;
  await unlink(fil);
  return true;
}

// ---------- updating (KC-0219) ----------

/** The fields an update may change: the ones a person differs in on the pile. Name, zone, source and body are never touched. */
const RET_FELTER = ['relation', 'org', 'foedselsdag'] as const;
type RetFelt = (typeof RET_FELTER)[number];
const erRetFelt = (f: string): f is RetFelt => (RET_FELTER as readonly string[]).includes(f);
/** The keys a field may stand under in a file (Henrik's register writes `fødselsdag`). */
const NOEGLER: Record<RetFelt, string[]> = { relation: ['relation'], org: ['org'], foedselsdag: ['foedselsdag', 'fødselsdag'] };
/** What Fortryd keeps of the old file in the log line; a bigger file is not updated (it could not be undone from the log). */
export const OPDATER_MAKS_TEGN = 16_000;

export type Opdateret =
  | { udfald: 'opdateret'; sti: string; kvittering: Kvittering & { forrige: string }; felter: RetFelt[]; sprunget: RetFelt[] }
  | { udfald: 'uaendret'; sti: string }
  /** The file no longer says what the diff said: nothing was written. */
  | { udfald: 'forandret'; sti: string; sprunget: RetFelt[] };

const FORHOVED = /^(---\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/;
const NOEGLE_LINJE = /^([\p{L}_][\p{L}\p{N}_-]*):[ \t]*(.*)$/u;

/** `tekst` with `ret` written into its frontmatter line by line; every other byte stays. A file without frontmatter gets a block on top. */
function retForhoved(tekst: string, ret: [RetFelt, string][]): string {
  const m = FORHOVED.exec(tekst);
  const eol = (m ? m[0] : tekst).includes('\r\n') ? '\r\n' : '\n';
  const nye: string[] = [];
  if (!m) {
    for (const [felt, v] of ret) nye.push(`${felt}: ${yaml(v)}`);
    return `---${eol}${nye.join(eol)}${eol}---${eol}${tekst}`;
  }
  const dele = (m[2] as string).split(/(\r?\n)/); // even index = a line, odd = its line ending
  for (const [felt, v] of ret) {
    let i = -1;
    for (let k = 0; k < dele.length && i < 0; k += 2) {
      const l = NOEGLE_LINJE.exec(dele[k] as string);
      if (l && NOEGLER[felt].includes((l[1] as string).normalize('NFC'))) i = k;
    }
    if (i < 0) { nye.push(`${felt}: ${yaml(v)}`); continue; }
    const l = NOEGLE_LINJE.exec(dele[i] as string) as RegExpExecArray;
    if ((l[2] as string).trim() === '' && /^(?:[ \t]+\S|-[ \t])/.test(dele[i + 2] ?? '')) throw new KildeFejl(409, noterTekst().listeUnderSig(l[1] as string));
    dele[i] = `${l[1]}: ${yaml(v)}`;
  }
  let hoved = dele.join('');
  if (nye.length) hoved = hoved === '' ? nye.join(eol) : `${hoved}${eol}${nye.join(eol)}`;
  return `${m[1]}${hoved}${m[3]}${tekst.slice(m[0].length)}`;
}

/** tmp + rename in the file's own folder, keeping its mode; the tmp file is removed when anything fails. */
async function skrivAtomiskFil(fil: string, tekst: string, mode: number): Promise<void> {
  const tmp = `${fil}.tmp-${randomUUID()}`;
  try {
    await writeFile(tmp, tekst, { encoding: 'utf8', flag: 'wx' });
    await chmod(tmp, mode);
    await rename(tmp, fil);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/**
 * KC-0219: changes an existing person to what an import brings. `p.diff` is what the user saw (`nu` → `ny`); only the
 * fields relation, org and foedselsdag are applied, each only while the file still says `nu` — a field that moved on
 * since is left (`sprunget`), and when nothing is left the answer is `forandret`/`uaendret` and nothing is written.
 * Everything else in the file (other keys, their order, the body) stays byte for byte; the write is tmp + rename. The
 * receipt carries the previous content (`forrige`) for gendanPerson. Refused (KildeFejl): no such person (404), a file
 * over OPDATER_MAKS_TEGN or one that is not plain UTF-8 text (409 — it could not be put back exactly), a changed file
 * between reading and writing (409), a bad value (400).
 */
export async function opdaterPerson(dir: string, p: { navn: string; diff: Forskel[] }): Promise<Opdateret> {
  const navn = filnavn(p.navn);
  const diff = p.diff.filter((d) => erRetFelt(d.felt));
  for (const d of diff) {
    const felt = d.felt as RetFelt;
    if (typeof d.ny !== 'string' || !d.ny.trim() || d.ny.trim().length > MAKS[felt] || KONTROL.test(d.ny)) throw new KildeFejl(400, noterTekst().ugyldigt(noterTekst().personFelt[felt] ?? felt));
  }
  const noegle = `${navn}.md`.toLowerCase();
  const fundet = (await personFiler(dir)).find((f) => f.navn.normalize('NFC').toLowerCase() === noegle);
  if (!fundet) throw new KildeFejl(404, noterTekst().personenFindesIkke);
  const rel = fundet.mappe ? `${fundet.mappe}/${fundet.navn}` : fundet.navn;
  const sti = rel.normalize('NFC');
  const fil = await iRod(dir, rel);
  const raa = await readFile(fil);
  const gammel = raa.toString('utf8');
  if (!Buffer.from(gammel, 'utf8').equals(raa) || gammel.includes('\u0000')) throw new KildeFejl(409, noterTekst().ikkeRenTekst);
  if (gammel.length > OPDATER_MAKS_TEGN) throw new KildeFejl(409, noterTekst().forStorTilFortryd);
  const { felter } = delFil(gammel);
  const nu = somPerson(felter, fundet.navn, fundet.mappe, 'privat');
  const gaelder = (a: string | undefined, b: string): boolean => (a ?? '').normalize('NFC').trim() === b.normalize('NFC').trim();
  const ret: [RetFelt, string][] = [];
  const sprunget: RetFelt[] = [];
  for (const d of diff) {
    const felt = d.felt as RetFelt;
    if (ret.some(([f]) => f === felt) || sprunget.includes(felt)) continue;
    if (gaelder(nu[felt], d.ny)) continue;
    if (gaelder(nu[felt], d.nu)) ret.push([felt, d.ny.trim()]); else sprunget.push(felt);
  }
  if (!ret.length) return sprunget.length ? { udfald: 'forandret', sti, sprunget } : { udfald: 'uaendret', sti };
  const ny = retForhoved(gammel, ret);
  if (ny === gammel) return { udfald: 'uaendret', sti };
  // Nobody may have saved the file since it was read (Obsidian is open next to Clawco): else we would overwrite their edit.
  const [igen, st] = await Promise.all([readFile(fil), stat(fil)]);
  if (!igen.equals(raa)) throw new KildeFejl(409, noterTekst().filenAendret);
  await skrivAtomiskFil(fil, ny, st.mode & 0o777);
  return { udfald: 'opdateret', sti, kvittering: { sti, sha256: sha256(ny), forrige: gammel }, felter: ret.map(([f]) => f), sprunget };
}

/** Fortryd of an update: writes the previous content back (atomically) — only while the file still holds exactly what the update wrote. True when put back. */
export async function gendanPerson(dir: string, k: Kvittering): Promise<boolean> {
  if (!k.sti.endsWith('.md') || k.forrige === undefined) throw new KildeFejl(400, noterTekst().kunOpdateret);
  const fil = await iRod(dir, k.sti);
  const nu = await readFile(fil, 'utf8').catch(() => null);
  if (nu === null || sha256(nu) !== k.sha256) return false;
  await skrivAtomiskFil(fil, k.forrige, (await stat(fil)).mode & 0o777);
  return true;
}
