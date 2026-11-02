// The copy store (KC-0185): where encrypted copies live. One seam, two implementations: Cloudflare R2 over
// the S3 API (the free tier, zero-cost rule D18; EU jurisdiction bucket) and an in-memory fake for tests. KC-0186
// adds a local directory store for an upgrade's restore point while R2 is not set up: the same sealed bytes, on the
// Sky host's own disk (so not an offsite backup), in a directory only Sky's user can open.
// The R2 token is bucket-scoped (object read/write on one bucket), so only object PUT/GET/DELETE and
// ListObjectsV2 inside the bucket are ever called — never a bucket-level admin call. Path-style URLs, region
// `auto`. Errors carry the HTTP status and S3's error code only; never a body, never a key.
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TOM_SHA256, kanoniskQuery, koder, signer } from './sigv4.ts';

export type Objekt = { noegle: string; bytes: number };

export interface KopiLager {
  put(noegle: string, data: Buffer): Promise<void>;
  /** null when there is no such object. */
  hent(noegle: string): Promise<Buffer | null>;
  /** Quiet when the object is already gone. */
  slet(noegle: string): Promise<void>;
  liste(prefix: string): Promise<Objekt[]>;
}

const NOEGLE = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9A-Z][a-zA-Z0-9._-]*)*\/?$/;

function tjek(noegle: string): string {
  if (!NOEGLE.test(noegle) || noegle.split('/').some((d) => d === '..' || d === '.')) throw new Error('ugyldig nøgle i kopilageret');
  return noegle;
}

export function falskKopiLager(): KopiLager & { objekter: Map<string, Buffer> } {
  const objekter = new Map<string, Buffer>();
  return {
    objekter,
    async put(n, d) { objekter.set(tjek(n), Buffer.from(d)); },
    async hent(n) { const d = objekter.get(tjek(n)); return d ? Buffer.from(d) : null; },
    async slet(n) { objekter.delete(tjek(n)); },
    async liste(p) { return [...objekter].filter(([n]) => n.startsWith(tjek(p))).map(([noegle, d]) => ({ noegle, bytes: d.length })).sort((a, b) => (a.noegle < b.noegle ? -1 : 1)); },
  };
}

/** Objects as files under `mappe` (absolute): directories 0700, files 0600, each written to a temp name and renamed.
 *  Refuses to use a directory that anyone but its owner can open (fail closed: the copies are sealed, but their names
 *  carry tenant slugs). */
export function lokalKopiLager(mappe: string): KopiLager {
  let klar: Promise<void> | null = null;
  const sikr = (): Promise<void> => (klar ??= (async () => {
    if (!path.isAbsolute(mappe)) throw new Error('SKY_LOKALE_KOPIER skal være en absolut sti');
    await fs.mkdir(mappe, { recursive: true, mode: 0o700 });
    const st = await fs.stat(mappe);
    if ((st.mode & 0o077) !== 0) throw new Error('mappen til lokale kopier kan åbnes af andre end Sky (skal være 0700)');
  })().catch((err: unknown) => { klar = null; throw err; }));
  const fil = (noegle: string) => path.join(mappe, ...tjek(noegle).split('/').filter(Boolean));
  async function gaa(dir: string, rel: string, ud: Objekt[]): Promise<void> {
    let ind;
    try { ind = await fs.readdir(dir, { withFileTypes: true }); } catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return; throw err; }
    for (const e of ind) {
      if (e.name.startsWith('.')) continue; // a temp file of a write in progress
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await gaa(path.join(dir, e.name), r, ud);
      else if (e.isFile()) ud.push({ noegle: r, bytes: (await fs.stat(path.join(dir, e.name))).size });
    }
  }
  return {
    async put(noegle, data) {
      await sikr();
      const f = fil(noegle);
      await fs.mkdir(path.dirname(f), { recursive: true, mode: 0o700 });
      const tmp = path.join(path.dirname(f), `.${path.basename(f)}.${randomBytes(4).toString('hex')}.tmp`);
      try {
        await fs.writeFile(tmp, data, { mode: 0o600, flag: 'wx' });
        await fs.rename(tmp, f);
      } finally { await fs.rm(tmp, { force: true }); }
    },
    async hent(noegle) {
      await sikr();
      try { return await fs.readFile(fil(noegle)); } catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null; throw err; }
    },
    async slet(noegle) { await sikr(); await fs.rm(fil(noegle), { force: true }); },
    async liste(prefix) {
      await sikr();
      tjek(prefix);
      const ud: Objekt[] = [];
      await gaa(mappe, '', ud);
      return ud.filter((o) => o.noegle.startsWith(prefix)).sort((a, b) => (a.noegle < b.noegle ? -1 : 1));
    },
  };
}

/** <account>.<jurisdiction>.r2.cloudflarestorage.com; an empty jurisdiction gives the plain host. */
export function r2Vaert(kontoId: string, jurisdiktion: string): string {
  if (!/^[a-f0-9]{32}$/.test(kontoId)) throw new Error('SKY_R2_ACCOUNT_ID er ugyldig: skal være 32 hex-tegn');
  if (jurisdiktion && !/^[a-z]{2,8}$/.test(jurisdiktion)) throw new Error('SKY_R2_JURISDICTION er ugyldig: fx eu, eller tom');
  return `${kontoId}${jurisdiktion ? `.${jurisdiktion}` : ''}.r2.cloudflarestorage.com`;
}

export type R2Opsaet = { kontoId: string; jurisdiktion: string; bucket: string; noegleId: string; hemmelighed: string; fetch?: typeof fetch; nu?: () => Date };

const afkod = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export function r2KopiLager(o: R2Opsaet): KopiLager {
  const vaert = r2Vaert(o.kontoId, o.jurisdiktion);
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(o.bucket)) throw new Error('SKY_R2_BUCKET er ugyldig');
  const f = o.fetch ?? fetch;
  const nu = o.nu ?? (() => new Date());

  async function kald(metode: string, noegle: string | null, query: Record<string, string> = {}, krop?: Buffer): Promise<Response> {
    const sti = noegle === null ? `/${o.bucket}` : `/${o.bucket}/${tjek(noegle)}`;
    const indholdSha = krop ? createHash('sha256').update(krop).digest('hex') : TOM_SHA256;
    const headers = signer({ metode, vaert, sti, query, headers: {}, indholdSha, region: 'auto', noegleId: o.noegleId, hemmelighed: o.hemmelighed, nu: nu() });
    const q = kanoniskQuery(query);
    const url = `https://${vaert}${koder(sti, '/')}${q ? `?${q}` : ''}`;
    return f(url, { method: metode, headers, ...(krop ? { body: new Uint8Array(krop) } : {}), signal: AbortSignal.timeout(120_000), redirect: 'error' });
  }

  async function fejl(r: Response, hvad: string): Promise<Error> {
    const tekst = await r.text().catch(() => '');
    const kode = /<Code>([A-Za-z]{1,64})<\/Code>/.exec(tekst)?.[1] ?? '';
    return new Error(`R2 ${hvad} fejlede: ${r.status}${kode ? ` ${kode}` : ''}`);
  }

  return {
    async put(noegle, data) {
      const r = await kald('PUT', noegle, {}, data);
      if (!r.ok) throw await fejl(r, 'upload');
      await r.arrayBuffer().catch(() => undefined);
    },
    async hent(noegle) {
      const r = await kald('GET', noegle);
      if (r.status === 404) { await r.arrayBuffer().catch(() => undefined); return null; }
      if (!r.ok) throw await fejl(r, 'hentning');
      return Buffer.from(await r.arrayBuffer());
    },
    async slet(noegle) {
      const r = await kald('DELETE', noegle);
      if (!r.ok && r.status !== 404) throw await fejl(r, 'sletning');
      await r.arrayBuffer().catch(() => undefined);
    },
    async liste(prefix) {
      tjek(prefix);
      const ud: Objekt[] = [];
      let token: string | null = null;
      for (let side = 0; side < 10_000; side++) {
        const query: Record<string, string> = { 'list-type': '2', prefix };
        if (token) query['continuation-token'] = token;
        const r = await kald('GET', null, query);
        if (!r.ok) throw await fejl(r, 'liste');
        const xml = await r.text();
        for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const noegle = /<Key>([\s\S]*?)<\/Key>/.exec(m[1]!)?.[1];
          const bytes = Number(/<Size>(\d+)<\/Size>/.exec(m[1]!)?.[1] ?? NaN);
          if (noegle !== undefined && Number.isFinite(bytes)) ud.push({ noegle: afkod(noegle), bytes });
        }
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? afkod(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? '') || null : null;
        if (!token) return ud;
      }
      throw new Error('R2 liste: for mange sider');
    },
  };
}
