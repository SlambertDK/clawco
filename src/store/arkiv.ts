// KC-0159: backup and restore of the user's folder as one tar.gz. Which files belong to the user's folder is NOT
// decided here — src/tillid/brugermappe.ts (listSikkerhedskopi) owns that list, the one list the export and the
// backup share (§0 r8); this file only knows the archive format and how to write and read it safely. It depends on
// nothing in src/ (store layering), so the caller hands it the file list.
//
// Format: ustar tar (regular files only; names longer than 100 bytes or non-ASCII travel in a pax `path` record),
// gzipped, with a MANIFEST.json first. Top-level folders: `data/` (the data folder), `vault/` (a vault outside it),
// `miljoe/` (the install's settings file, only in a backup made with the keys). No new dependency: the tar reader
// and writer are here so a hostile archive can be judged BEFORE a single byte is extracted (no system tar differences,
// no `._` files from macOS tar).
//
// Invariants: writing an archive only reads the live data; the archive is written to a temp file and renamed
// (§4 r5), mode 600, and never replaces an older one. A restore validates the whole archive first (names, types,
// duplicates, free space), extracts into a staging folder next to the target, and only then moves the old folder
// aside (`<folder>.foer-gendannelse-<date>`) and renames the staging folder into place. It never deletes data.
// Link entries are refused whatever they point at: a Clawco backup holds none, so any link is an attack or a
// corrupt file.

import { randomUUID } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { chmod, link, lstat, mkdir, open, readdir, readFile, rename, rm, statfs, unlink, utimes } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';

export class ArkivFejl extends Error {}

/** A file for the archive: `sti` is the name in the archive; the bytes come from `abs` or, for generated entries, `data`. */
export type ArkivFil = { sti: string; abs: string } | { sti: string; data: Buffer };

export const FORMAT = 'clawco-backup';
export const MANIFEST = 'MANIFEST.json';
/** The only top-level names an archive may hold. */
const RODER = ['data', 'vault', 'miljoe'] as const;
export type Rod = (typeof RODER)[number];

const BLOK = 512;
const MAKS_PAX = 1 << 20;

// ---------------------------------------------------------------- names

/** `backup-name`: clawco-backup-YYYY-MM-DD-HHMM.tar.gz in local time; `n` > 1 adds -2, -3 … */
export function arkivNavn(tid: Date, n = 1): string {
  const t = (x: number, l = 2): string => String(x).padStart(l, '0');
  const stamp = `${tid.getFullYear()}-${t(tid.getMonth() + 1)}-${t(tid.getDate())}-${t(tid.getHours())}${t(tid.getMinutes())}`;
  return `clawco-backup-${stamp}${n > 1 ? `-${n}` : ''}.tar.gz`;
}

const kort = (s: string): string => (s.length > 80 ? s.slice(0, 80) + '…' : s).replace(/[^\x20-\x7e -￿]/g, '?');

/** Throws for a name that could leave the target folder or is not one of ours. Entry names are checked as text, never joined first. */
function tjekNavn(sti: string, mappe: boolean): { rod: Rod | typeof MANIFEST; rel: string[] } {
  const net = mappe ? sti.replace(/\/+$/, '') : sti;
  const dele = net.split('/');
  if (!net || net.includes('\0') || net.includes('\\') || net.startsWith('/') || /^[a-zA-Z]:/.test(net) || dele.some((d) => d === '' || d === '.' || d === '..')) {
    throw new ArkivFejl(`arkivet er ikke sikkert at pakke ud: ugyldigt navn «${kort(sti)}»`);
  }
  const rod = dele[0] as string;
  if (rod === MANIFEST && dele.length === 1 && !mappe) return { rod: MANIFEST, rel: [] };
  if (!(RODER as readonly string[]).includes(rod)) throw new ArkivFejl(`arkivet er ikke en Clawco-sikkerhedskopi: ukendt mappe «${kort(rod)}»`);
  return { rod: rod as Rod, rel: dele.slice(1) };
}

// ---------------------------------------------------------------- writing

const oktal = (v: number, l: number): string => v.toString(8).padStart(l - 1, '0') + '\0';

function header(navn: string, size: number, mtime: number, type: string): Buffer {
  const h = Buffer.alloc(BLOK);
  const kortNavn = Buffer.from(navn, 'utf8').length <= 100 && /^[\x20-\x7e]*$/.test(navn) ? navn : navn.replace(/[^\x20-\x7e]/g, '_').slice(-99);
  h.write(kortNavn, 0, 'ascii');
  h.write(oktal(type === '5' ? 0o700 : 0o600, 8), 100, 'ascii');
  h.write(oktal(0, 8), 108, 'ascii');
  h.write(oktal(0, 8), 116, 'ascii');
  h.write(oktal(size, 12), 124, 'ascii');
  h.write(oktal(Math.max(0, Math.floor(mtime)), 12), 136, 'ascii');
  h.write('        ', 148, 'ascii');
  h.write(type, 156, 'ascii');
  h.write('ustar\0', 257, 'ascii');
  h.write('00', 263, 'ascii');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(oktal(sum, 7) + ' ', 148, 'ascii');
  return h;
}

/** One pax record: "<length> path=<value>\n", the length counting itself. */
function paxPost(noegle: string, vaerdi: string): Buffer {
  const krop = Buffer.from(` ${noegle}=${vaerdi}\n`, 'utf8');
  let l = krop.length + 1;
  while (String(l).length + krop.length !== l) l = String(l).length + krop.length;
  return Buffer.concat([Buffer.from(String(l), 'ascii'), krop]);
}

const udfyld = (n: number): Buffer => Buffer.alloc((BLOK - (n % BLOK)) % BLOK);

function* postHoved(navn: string, size: number, mtime: number): Generator<Buffer> {
  if (!(Buffer.from(navn, 'utf8').length <= 100 && /^[\x20-\x7e]*$/.test(navn))) {
    const pax = paxPost('path', navn);
    yield header('PaxHeader', pax.length, mtime, 'x');
    yield pax;
    yield udfyld(pax.length);
  }
  yield header(navn, size, mtime, '0');
}

type Taeller = { filer: number; forsvundet: number };

async function* byggArkiv(filer: readonly ArkivFil[], t: Taeller): AsyncGenerator<Buffer> {
  const nu = Date.now() / 1000;
  for (const f of filer) {
    if ('data' in f) {
      yield* postHoved(f.sti, f.data.length, nu);
      yield f.data;
      yield udfyld(f.data.length);
      t.filer += 1;
      continue;
    }
    let fh;
    try { fh = await open(f.abs, constants.O_RDONLY | constants.O_NOFOLLOW); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ELOOP') { t.forsvundet += 1; continue; }
      throw e;
    }
    try {
      const st = await fh.stat();
      if (!st.isFile()) { t.forsvundet += 1; continue; }
      yield* postHoved(f.sti, st.size, st.mtimeMs / 1000);
      let rest = st.size;
      const buf = Buffer.allocUnsafe(1 << 16);
      while (rest > 0) {
        const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, rest), null);
        if (!bytesRead) throw new ArkivFejl(`en fil blev kortere, mens kopien blev taget (${kort(f.sti)}); prøv igen`);
        yield Buffer.from(buf.subarray(0, bytesRead));
        rest -= bytesRead;
      }
      yield udfyld(st.size);
      t.filer += 1;
    } finally { await fh.close(); }
  }
  yield Buffer.alloc(BLOK * 2);
}

export type Skrevet = { sti: string; bytes: number; filer: number; forsvundet: number };

/**
 * Writes the archive of `filer` into `mappe` (created, mode 700) under the next free name for `tid`, mode 600, via a
 * temp file and a rename that never replaces an existing backup. A failure removes the temp file and nothing else.
 * The manifest is written first. Reads the live files only.
 */
export async function skrivArkiv(mappe: string, filer: readonly ArkivFil[], o: { tid: Date; manifest: Record<string, unknown> }): Promise<Skrevet> {
  await mkdir(mappe, { recursive: true, mode: 0o700 });
  const tmp = path.join(mappe, `.clawco-backup.tmp-${randomUUID()}`);
  const t: Taeller = { filer: 0, forsvundet: 0 };
  const manifest = Buffer.from(JSON.stringify({ format: FORMAT, version: 1, oprettet: o.tid.toISOString(), ...o.manifest }, null, 2) + '\n', 'utf8');
  try {
    await pipeline(
      Readable.from(byggArkiv([{ sti: MANIFEST, data: manifest }, ...filer], t)),
      createGzip(),
      createWriteStream(tmp, { flags: 'wx', mode: 0o600 }),
    );
    await chmod(tmp, 0o600);
    for (let n = 1; ; n += 1) {
      const maal = path.join(mappe, arkivNavn(o.tid, n));
      try {
        await link(tmp, maal);
      } catch (e) {
        const kode = (e as NodeJS.ErrnoException).code;
        if (kode === 'EEXIST') continue;
        // A file system without hard links (FAT, some network shares): check, then rename.
        if (kode === 'EPERM' || kode === 'ENOTSUP' || kode === 'ENOSYS' || kode === 'EXDEV' || kode === 'EOPNOTSUPP') {
          if (await lstat(maal).then(() => true, () => false)) continue;
          await rename(tmp, maal);
          return { sti: maal, bytes: (await lstat(maal)).size, filer: t.filer - 1, forsvundet: t.forsvundet };
        }
        throw e;
      }
      await unlink(tmp);
      return { sti: maal, bytes: (await lstat(maal)).size, filer: t.filer - 1, forsvundet: t.forsvundet };
    }
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

// ---------------------------------------------------------------- reading

type Post = { sti: string; type: 'fil' | 'mappe' | 'link' | 'andet'; size: number; mtime: number };
type Sink = { skriv(b: Buffer): Promise<void>; slut(): Promise<void>; afbryd(): Promise<void> };

const korrupt = (): ArkivFejl => new ArkivFejl('arkivet er beskadiget, afkortet eller ikke en Clawco-sikkerhedskopi');

class Laeser {
  private buf: Buffer = Buffer.alloc(0);
  private ferdig = false;
  private readonly it: AsyncIterator<Buffer>;
  constructor(it: AsyncIterator<Buffer>) { this.it = it; }
  private async fyld(): Promise<boolean> {
    if (this.ferdig) return false;
    const r = await this.it.next();
    if (r.done) { this.ferdig = true; return false; }
    this.buf = this.buf.length ? Buffer.concat([this.buf, r.value]) : r.value;
    return true;
  }
  /** Exactly n bytes, or fewer only at the end of the stream. */
  async tag(n: number): Promise<Buffer> {
    while (this.buf.length < n) if (!(await this.fyld())) break;
    const ud = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return ud;
  }
  /** Passes exactly n bytes to `modtag` in chunks. */
  async dele(n: number, modtag: (b: Buffer) => Promise<void>): Promise<void> {
    let rest = n;
    while (rest > 0) {
      if (!this.buf.length && !(await this.fyld())) throw korrupt();
      const b = this.buf.subarray(0, Math.min(rest, this.buf.length));
      this.buf = this.buf.subarray(b.length);
      rest -= b.length;
      await modtag(b);
    }
  }
}

function tal(felt: Buffer, navn: string): number {
  if (felt[0] !== undefined && felt[0] & 0x80) throw new ArkivFejl(`arkivet har en ${navn}, der er for stor`);
  const t = felt.toString('ascii').replace(/\0[\s\S]*$/, '').trim();
  if (t !== '' && !/^[0-7]+$/.test(t)) throw korrupt();
  const v = t === '' ? 0 : parseInt(t, 8);
  if (!Number.isSafeInteger(v)) throw korrupt();
  return v;
}

const tekstFelt = (felt: Buffer): string => felt.toString('utf8').replace(/\0[\s\S]*$/, '');

/** Pax records ("<len> key=value\n") of a local extended header. */
function paxFelter(b: Buffer): Map<string, string> {
  const ud = new Map<string, string>();
  let i = 0;
  while (i < b.length) {
    const mellem = b.indexOf(0x20, i);
    if (mellem < 0) throw korrupt();
    const l = parseInt(b.subarray(i, mellem).toString('ascii'), 10);
    if (!Number.isSafeInteger(l) || l <= mellem - i + 1 || i + l > b.length || b[i + l - 1] !== 0x0a) throw korrupt();
    const post = b.subarray(mellem + 1, i + l - 1).toString('utf8');
    const lig = post.indexOf('=');
    if (lig > 0) ud.set(post.slice(0, lig), post.slice(lig + 1));
    i += l;
  }
  return ud;
}

/**
 * Reads the archive once, in order. `paa` is called for every entry (links and other kinds too, so a validator can
 * refuse them) and returns a sink for a regular file's bytes, or null to skip them.
 */
async function gennemgaa(fil: string, paa: (p: Post) => Promise<Sink | null> | Sink | null): Promise<void> {
  const ind = createReadStream(fil);
  const gz = createGunzip();
  ind.on('error', (e) => gz.destroy(e));
  ind.pipe(gz);
  const l = new Laeser(gz[Symbol.asyncIterator]());
  try {
    let pax = new Map<string, string>();
    let langNavn: string | undefined;
    let sluttet = false;
    for (;;) {
      const h = await l.tag(BLOK);
      if (h.length === 0) break;
      if (h.length < BLOK) throw korrupt();
      if (h.every((b) => b === 0)) { sluttet = true; break; }
      let sum = 0;
      for (let i = 0; i < BLOK; i += 1) sum += i >= 148 && i < 156 ? 0x20 : (h[i] as number);
      if (tal(h.subarray(148, 156), 'kontrolsum') !== sum) throw korrupt();
      const typeTegn = String.fromCharCode(h[156] as number);
      const size = tal(h.subarray(124, 136), 'fil');
      const mtime = tal(h.subarray(136, 148), 'tid');
      const pad = (BLOK - (size % BLOK)) % BLOK;
      if (typeTegn === 'x' || typeTegn === 'g' || typeTegn === 'L') {
        if (size > MAKS_PAX) throw korrupt();
        const data = await l.tag(size);
        if (data.length < size) throw korrupt();
        await l.tag(pad);
        if (typeTegn === 'x') pax = paxFelter(data);
        else if (typeTegn === 'L') langNavn = data.toString('utf8').replace(/\0[\s\S]*$/, '');
        continue;
      }
      const prefix = tekstFelt(h.subarray(345, 500));
      const grund = tekstFelt(h.subarray(0, 100));
      const sti = pax.get('path') ?? langNavn ?? (prefix ? `${prefix}/${grund}` : grund);
      const sizeFinal = pax.has('size') ? Number(pax.get('size')) : size;
      if (!Number.isSafeInteger(sizeFinal) || sizeFinal < 0) throw korrupt();
      const type = typeTegn === '0' || typeTegn === '\0' || typeTegn === '7' ? 'fil' : typeTegn === '5' ? 'mappe' : typeTegn === '1' || typeTegn === '2' ? 'link' : 'andet';
      pax = new Map();
      langNavn = undefined;
      const sink = await paa({ sti, type, size: sizeFinal, mtime });
      const datalaengde = type === 'fil' ? sizeFinal : size;
      if (type === 'fil' && sink) {
        try {
          await l.dele(sizeFinal, (b) => sink.skriv(b));
          await sink.slut();
        } catch (e) { await sink.afbryd(); throw e; }
      } else await l.dele(datalaengde, async () => {});
      const rest = (BLOK - (datalaengde % BLOK)) % BLOK;
      if ((await l.tag(rest)).length < rest) throw korrupt();
    }
    if (!sluttet) {
      // No end-of-archive marker is tolerated only for an archive that simply ends on a block boundary.
      if ((await l.tag(1)).length) throw korrupt();
    }
  } catch (e) {
    if (e instanceof ArkivFejl) throw e;
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new ArkivFejl(`kan ikke åbne sikkerhedskopien: ${kort(fil)}`);
    throw korrupt();
  } finally {
    gz.destroy();
    ind.destroy();
  }
}

export type Oversigt = {
  filer: number;
  bytes: number;
  /** Rooms with data (data/rum/<id>/…), notes (.md files in the vault). */
  rum: string[];
  noter: number;
  roder: Rod[];
  /** Every entry name, sorted. */
  navne: string[];
  manifest: { medNoegler: boolean; oprettet: string; vaultSti: string | null } | null;
};

/**
 * Reads the whole archive and judges every entry: only regular files and folders, names inside one of the known top
 * folders, no `..`, absolute, backslash or drive paths, no duplicates or file-and-folder clashes, no links. Writes
 * nothing. The first problem throws an ArkivFejl naming the entry (never its contents).
 */
export async function valider(fil: string): Promise<Oversigt> {
  const filer = new Set<string>();
  const mapper = new Set<string>();
  const rum = new Set<string>();
  const roder = new Set<Rod>();
  let bytes = 0;
  let noter = 0;
  let manifest: Oversigt['manifest'] = null;
  let set = 0;
  await gennemgaa(fil, (p) => {
    set += 1;
    if (p.type === 'link') throw new ArkivFejl(`arkivet er ikke sikkert at pakke ud: «${kort(p.sti)}» er et link, og en Clawco-sikkerhedskopi har ingen`);
    if (p.type === 'andet') throw new ArkivFejl(`arkivet er ikke sikkert at pakke ud: «${kort(p.sti)}» er hverken en fil eller en mappe`);
    const { rod, rel } = tjekNavn(p.sti, p.type === 'mappe');
    if (set === 1 && rod !== MANIFEST) throw new ArkivFejl('arkivet er ikke en Clawco-sikkerhedskopi: manifestet mangler');
    const navn = p.type === 'mappe' ? `${rod}/${rel.join('/')}` : rod === MANIFEST ? MANIFEST : `${rod}/${rel.join('/')}`;
    if (rod === MANIFEST) {
      if (p.size > MAKS_PAX) throw korrupt();
      const dele: Buffer[] = [];
      return { skriv: async (b) => { dele.push(Buffer.from(b)); }, slut: async () => { manifest = laesManifest(Buffer.concat(dele)); }, afbryd: async () => {} };
    }
    // A name is either a file or a folder, once.
    const dele = [rod, ...rel];
    for (let i = 1; i < dele.length; i += 1) if (filer.has(dele.slice(0, i).join('/'))) throw new ArkivFejl(`arkivet er ikke sikkert at pakke ud: «${kort(p.sti)}» ligger under en fil`);
    if (p.type === 'mappe') {
      if (filer.has(navn)) throw new ArkivFejl(`arkivet er ikke sikkert at pakke ud: «${kort(p.sti)}» er både fil og mappe`);
      mapper.add(navn);
      if (rel.length === 0) roder.add(rod);
      return null;
    }
    if (rel.length === 0) throw new ArkivFejl(`arkivet er ikke sikkert at pakke ud: «${kort(p.sti)}» er en fil, hvor der skulle være en mappe`);
    if (filer.has(navn) || mapper.has(navn)) throw new ArkivFejl(`arkivet er ikke sikkert at pakke ud: «${kort(p.sti)}» findes to gange`);
    filer.add(navn);
    for (let i = 2; i < dele.length; i += 1) mapper.add(dele.slice(0, i).join('/'));
    roder.add(rod);
    bytes += p.size;
    if (rod === 'data' && rel[0] === 'rum' && rel.length >= 3 && rel[1]) rum.add(rel[1]);
    const vs = manifest?.vaultSti ?? 'vault';
    if (navn.endsWith('.md') && (navn.startsWith(vs + '/'))) noter += 1;
    return null;
  });
  if (!filer.size) throw new ArkivFejl('sikkerhedskopien indeholder ingen filer');
  return { filer: filer.size, bytes, rum: [...rum].sort(), noter, roder: [...roder], navne: [...filer].sort(), manifest };
}

function laesManifest(b: Buffer): NonNullable<Oversigt['manifest']> {
  let j: unknown;
  try { j = JSON.parse(b.toString('utf8')); } catch { throw new ArkivFejl('arkivet er ikke en Clawco-sikkerhedskopi: manifestet kan ikke læses'); }
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
  if (o['format'] !== FORMAT) throw new ArkivFejl('arkivet er ikke en Clawco-sikkerhedskopi: forkert format');
  const vs = o['vaultSti'];
  return {
    medNoegler: o['medNoegler'] === true,
    oprettet: typeof o['oprettet'] === 'string' ? o['oprettet'].slice(0, 40) : '',
    vaultSti: typeof vs === 'string' && vs && !vs.includes('\0') && !vs.startsWith('/') && !vs.split('/').includes('..') ? vs : null,
  };
}

// ---------------------------------------------------------------- restoring

/** Where each top folder of the archive goes. `data` is required; the others only when the archive holds them. */
export type Maal = { data: string; vault?: string; miljoe?: string };
export type Gendannet = { filer: number; bytes: number; rum: number; noter: number; steder: Partial<Record<Rod, string>>; flyttet: Partial<Record<Rod, string>> };

const dato = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function tom(mappe: string): Promise<'findes-ikke' | 'tom' | 'ikke-tom'> {
  const s = await lstat(mappe).catch(() => null);
  if (!s) return 'findes-ikke';
  if (s.isSymbolicLink() || !s.isDirectory()) throw new ArkivFejl(`${mappe} er ikke en almindelig mappe; gendannelsen rører den ikke`);
  return (await readdir(mappe)).length ? 'ikke-tom' : 'tom';
}

async function ledigtNavn(base: string): Promise<string> {
  for (let n = 1; ; n += 1) {
    const kandidat = n === 1 ? base : `${base}-${n}`;
    if (!(await lstat(kandidat).then(() => true, () => false))) return kandidat;
  }
}

function filSink(abs: string, mtime: number): Sink {
  let fh: Awaited<ReturnType<typeof open>> | undefined;
  return {
    async skriv(b) {
      if (!fh) { await mkdir(path.dirname(abs), { recursive: true, mode: 0o700 }); fh = await open(abs, 'wx', 0o600); }
      await fh.write(b);
    },
    async slut() {
      if (!fh) { await mkdir(path.dirname(abs), { recursive: true, mode: 0o700 }); fh = await open(abs, 'wx', 0o600); }
      await fh.close();
      fh = undefined;
      await utimes(abs, mtime, mtime).catch(() => {});
    },
    async afbryd() { await fh?.close().catch(() => {}); },
  };
}

/**
 * Restores the archive. First everything is judged (valider) and the targets checked — a target that holds files
 * stops the restore (`erstat` false) with nothing changed. Then the files are extracted into a staging folder next
 * to each target; only when that has succeeded is a non-empty old target renamed to `<target>.foer-gendannelse-<date>`
 * and the staging folder renamed into place. A failure removes the staging folders (ours) and nothing else.
 */
export async function gendan(fil: string, maal: Maal, o: { erstat?: boolean; tid?: Date } = {}): Promise<Gendannet> {
  const tid = o.tid ?? new Date();
  const oversigt = await valider(fil);
  const ud: Rod[] = oversigt.roder.filter((r) => r === 'data' || r === 'vault' || r === 'miljoe');
  if (!ud.includes('data')) throw new ArkivFejl('sikkerhedskopien indeholder ingen data-mappe');
  const mål: Partial<Record<Rod, string>> = {};
  for (const r of ud) {
    const m = maal[r];
    if (!m) throw new ArkivFejl(`sikkerhedskopien indeholder «${r}», men der er ikke sagt, hvor det skal hen`);
    mål[r] = path.resolve(m);
  }
  const maalListe = Object.entries(mål) as [Rod, string][];
  // 1. Judge the targets: nothing is touched yet.
  const tilstand = new Map<Rod, 'findes-ikke' | 'tom' | 'ikke-tom'>();
  for (const [r, m] of maalListe) {
    const t = await tom(m);
    if (t === 'ikke-tom' && !o.erstat) {
      throw new ArkivFejl(`${m} er ikke tom, og gendannelsen ændrer ingenting. Brug --erstat for at flytte den gamle mappe til side og gendanne; den slettes aldrig.`);
    }
    tilstand.set(r, t);
  }
  for (const [, m] of maalListe) {
    const forælder = path.dirname(m);
    let sted = forælder;
    while (!(await lstat(sted).then(() => true, () => false)) && path.dirname(sted) !== sted) sted = path.dirname(sted);
    const fs = await statfs(sted).catch(() => null);
    if (fs && Number(fs.bavail) * Number(fs.bsize) < oversigt.bytes * 1.05 + (1 << 20)) {
      throw new ArkivFejl(`der er ikke plads nok ved ${forælder}: gendannelsen skal bruge ca. ${Math.ceil(oversigt.bytes / (1 << 20))} MB`);
    }
  }
  // 2. Extract into staging folders next to the targets.
  const staging = new Map<Rod, string>();
  for (const [r, m] of maalListe) {
    await mkdir(path.dirname(m), { recursive: true });
    staging.set(r, `${m}.gendanner-${randomUUID().slice(0, 8)}`);
  }
  try {
    for (const s of staging.values()) await mkdir(s, { mode: 0o700 });
    await gennemgaa(fil, (p) => {
      const { rod, rel } = tjekNavn(p.sti, p.type === 'mappe');
      if (rod === MANIFEST) return null;
      const rodMappe = staging.get(rod);
      if (!rodMappe) throw korrupt();
      const abs = path.resolve(rodMappe, ...rel);
      if (abs !== rodMappe && !abs.startsWith(rodMappe + path.sep)) throw new ArkivFejl('arkivet er ikke sikkert at pakke ud');
      if (p.type === 'mappe') return mkdirNu(abs);
      return filSink(abs, p.mtime);
    });
  } catch (e) {
    for (const s of staging.values()) await rm(s, { recursive: true, force: true });
    throw e;
  }
  // 3. Swap into place; the old folder is moved aside, never deleted.
  const flyttet: Partial<Record<Rod, string>> = {};
  const skiftet: [string, string][] = [];
  try {
    for (const [r, m] of maalListe) {
      if (tilstand.get(r) === 'ikke-tom') {
        const til = await ledigtNavn(`${m}.foer-gendannelse-${dato(tid)}`);
        await rename(m, til);
        skiftet.push([m, til]);
        flyttet[r] = til;
      }
      await rename(staging.get(r) as string, m);
    }
  } catch (e) {
    for (const [m, til] of skiftet.reverse()) await rename(til, m).catch(() => {});
    for (const s of staging.values()) await rm(s, { recursive: true, force: true });
    throw e;
  }
  return { filer: oversigt.filer, bytes: oversigt.bytes, rum: oversigt.rum.length, noter: oversigt.noter, steder: mål, flyttet };
}

async function mkdirNu(abs: string): Promise<null> {
  await mkdir(abs, { recursive: true, mode: 0o700 });
  return null;
}

// ---------------------------------------------------------------- network mounts

/** File systems that live on another machine: a vault there "already lives elsewhere" and is left out of a backup. */
const FJERNE = new Set(['nfs', 'nfs4', 'cifs', 'smb', 'smb3', 'smbfs', 'afpfs', 'webdav', 'davfs', 'davfs2', 'sshfs', 'fuse.sshfs', 'fuse.rclone', 'fuse.gvfsd-fuse', '9p', 'ceph', 'glusterfs', 'fuse.glusterfs', 'afs']);

/** Whether `sti` lies on a network file system, from the text of `/proc/mounts` (Linux) or `mount` (macOS). Pure. */
export function fjernFraMountTekst(tekst: string, sti: string): boolean {
  const mål = path.resolve(sti);
  let bedst = { laengde: -1, fjern: false };
  for (const linje of tekst.split('\n')) {
    let mont: string | undefined;
    let fs: string | undefined;
    const mac = /^.+? on (.+) \(([^,)]+)/.exec(linje);
    if (mac) { mont = mac[1]; fs = mac[2]; } else {
      const f = linje.split(' ');
      if (f.length >= 4) { mont = f[1]?.replace(/\\([0-7]{3})/g, (_m, o: string) => String.fromCharCode(parseInt(o, 8))); fs = f[2]; }
    }
    if (!mont || !fs) continue;
    const under = mål === mont || mål.startsWith(mont.endsWith('/') ? mont : mont + '/');
    if (under && mont.length > bedst.laengde) bedst = { laengde: mont.length, fjern: FJERNE.has(fs.toLowerCase()) };
  }
  return bedst.fjern;
}

/** Whether `sti` is on a network mount on this machine. Unknown (no mount table) counts as local: nothing is left out silently. */
export async function erFjernmonteret(sti: string): Promise<boolean> {
  const tekst = await readFile('/proc/mounts', 'utf8').catch(() => new Promise<string>((res) => {
    execFile('mount', [], { timeout: 5000, encoding: 'utf8' }, (err, ud) => res(err ? '' : ud));
  }));
  return fjernFraMountTekst(tekst, sti);
}
