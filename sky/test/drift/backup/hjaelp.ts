// Test helpers for KC-0185: a minimal ustar writer (with a GNU long-name and a pax entry on request), so the
// manifest and the fake node never need a system tar; and fakes for the node, key and dump seams.
import { randomBytes } from 'node:crypto';
import { tarFiler } from '../../../src/drift/backup/manifest.ts';
import type { KopiNode, KopiNoegler, DbDump } from '../../../src/drift/backup/typer.ts';

function oktal(n: number, bredde: number): string { return `${n.toString(8).padStart(bredde - 1, '0')}\0`; }

function hoved(navn: string, stoerrelse: number, type: string): Buffer {
  const h = Buffer.alloc(512);
  h.write(navn.slice(0, 100), 0, 'utf8');
  h.write(oktal(0o600, 8), 100);
  h.write(oktal(1000, 8), 108);
  h.write(oktal(1000, 8), 116);
  h.write(oktal(stoerrelse, 12), 124);
  h.write(oktal(0, 12), 136);
  h.write('        ', 148);
  h.write(type, 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return h;
}

function blok(data: Buffer): Buffer {
  const fyld = (512 - (data.length % 512)) % 512;
  return Buffer.concat([data, Buffer.alloc(fyld)]);
}

/** A tar of `filer` (path → content). `langt` writes long paths as GNU 'L' entries; `pax` as pax 'x' entries. */
export function tar(filer: Record<string, string | Buffer>, o: { mapper?: string[]; langt?: 'gnu' | 'pax' } = {}): Buffer {
  const dele: Buffer[] = [];
  for (const m of o.mapper ?? []) dele.push(hoved(m.endsWith('/') ? m : `${m}/`, 0, '5'));
  for (const [sti, indhold] of Object.entries(filer)) {
    const data = Buffer.isBuffer(indhold) ? indhold : Buffer.from(indhold, 'utf8');
    if (sti.length > 99 && o.langt === 'gnu') {
      const n = Buffer.from(`${sti}\0`, 'utf8');
      dele.push(hoved('././@LongLink', n.length, 'L'), blok(n));
    } else if (sti.length > 99 && o.langt === 'pax') {
      const linje = (k: string, v: string) => { let n = k.length + v.length + 3; n += String(n).length; if (String(n).length !== String(n - String(n).length).length) n++; return `${n} ${k}=${v}\n`; };
      const p = Buffer.from(linje('path', sti), 'utf8');
      dele.push(hoved('PaxHeaders/x', p.length, 'x'), blok(p));
    }
    dele.push(hoved(sti, data.length, '0'), blok(data));
  }
  dele.push(Buffer.alloc(1024));
  return Buffer.concat(dele);
}

// --- Fakes for the seams (KC-0185) -------------------------------------------------------------------

export type FalskNode = KopiNode & {
  kald: string[];
  /** Live tenant volumes by tenant slug, and restored/scratch volumes by name: path → content. */
  levende: Map<string, Record<string, string>>;
  gendannede: Map<string, Record<string, string>>;
  containere: Set<string>;
  fejlNaeste(hvad: 'pak' | 'udpak' | 'start' | 'pakGendannet' | 'fjern'): void;
  /** What the next pakGendannet returns instead of the restored files (to fake a corrupted restore). */
  aendreGendannet?: (filer: Record<string, string>) => Record<string, string>;
};

export function falskNode(levende: Record<string, Record<string, string>> = {}): FalskNode {
  const fejl = new Set<string>();
  const tjek = (h: string) => { if (fejl.delete(h)) throw new Error(`falsk ${h}-fejl`); };
  const n: FalskNode = {
    kald: [], levende: new Map(Object.entries(levende)), gendannede: new Map(), containere: new Set(),
    fejlNaeste(h) { fejl.add(h); },
    async pak(t) {
      n.kald.push(`pak ${t}`); tjek('pak');
      const f = n.levende.get(t);
      if (!f) throw new Error(`disken for ${t} findes ikke`);
      return tar(f);
    },
    async udpak(navn, t, data) {
      n.kald.push(`udpak ${navn} ${t}`); tjek('udpak');
      if (n.gendannede.has(navn)) throw new Error('findes allerede');
      n.gendannede.set(navn, Object.fromEntries(tarFiler(data).map((f) => [f.sti, f.data.toString('utf8')])));
    },
    async start(navn, t) { n.kald.push(`start ${navn} ${t}`); tjek('start'); n.containere.add(navn); return { adresse: `http://172.18.9.9:8750` }; },
    async pakGendannet(navn) {
      n.kald.push(`pakGendannet ${navn}`); tjek('pakGendannet');
      const f = n.gendannede.get(navn);
      if (!f) throw new Error('ingen sådan disk');
      return tar(n.aendreGendannet ? n.aendreGendannet(f) : f);
    },
    async fjern(navn) { n.kald.push(`fjern ${navn}`); tjek('fjern'); n.gendannede.delete(navn); n.containere.delete(navn); },
  };
  return n;
}

export type FalskeNoegler = KopiNoegler & { tenantNoegler: Map<string, Buffer>; dbNoegler: Map<number, Buffer>; destruer(t: string): void };

export function falskeNoegler(): FalskeNoegler {
  const tenantNoegler = new Map<string, Buffer>();
  const dbNoegler = new Map<number, Buffer>([[1, randomBytes(32)]]);
  const destruerede = new Set<string>();
  return {
    tenantNoegler, dbNoegler,
    destruer(t) { destruerede.add(t); },
    async tenant(t) {
      if (destruerede.has(t)) throw new Error(`nøglen er destrueret for tenant ${t}`);
      if (!tenantNoegler.has(t)) tenantNoegler.set(t, randomBytes(32));
      const b = Buffer.from(tenantNoegler.get(t)!);
      return { aaben: () => b, oedelaeg: () => { b.fill(0); } };
    },
    db(version) {
      const v = version ?? Math.max(...dbNoegler.keys());
      const b = dbNoegler.get(v);
      if (!b) throw new Error(`ingen masternøgle med version ${v}`);
      return { version: v, noegle: { aaben: () => b } };
    },
  };
}

export function falskDump(indhold = 'PGDMP falsk dump'): DbDump & { kald: string[] } {
  const kald: string[] = [];
  return {
    kald,
    async dump() { kald.push('dump'); return Buffer.from(indhold); },
    async tjek(d) { kald.push('tjek'); if (!d.subarray(0, 5).equals(Buffer.from('PGDMP'))) throw new Error('pg_restore: ikke et arkiv'); return 3; },
    async gendan(_d, maal) { kald.push(`gendan ${maal}`); },
  };
}
