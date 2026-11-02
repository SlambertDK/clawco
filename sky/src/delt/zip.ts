// KC-0146: a store-only zip writer for "Hent alt" (no new dependency). Every
// entry is stored uncompressed (method 0) with its CRC-32 and the UTF-8 name
// flag, so Danish file names survive. No ZIP64: an archive over 4 GiB or 65535
// entries is refused rather than written broken. Names must be relative,
// '/'-separated and free of '..', so unpacking can never leave the target folder.

import { crc32 } from 'node:zlib';

export type ZipFil = { navn: string; data: Buffer };

const MAKS = 0xffffffff;
const UTF8 = 0x0800;

function tjekNavn(navn: string): void {
  const dele = navn.split('/');
  if (!navn || navn.startsWith('/') || navn.includes('\\') || /^[a-zA-Z]:/.test(navn) || dele.some((d) => d === '' || d === '.' || d === '..')) {
    throw new Error(`ugyldigt navn i zip-filen: ${navn.slice(0, 80)}`);
  }
}

/** MS-DOS date and time (2-second resolution), from the UTC fields of `d`. */
function dos(d: Date): { tid: number; dato: number } {
  const aar = Math.min(Math.max(d.getUTCFullYear(), 1980), 2107);
  return {
    tid: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    dato: ((aar - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

/** The archive of `filer`, in the given order. `o.tid`: the timestamp every entry carries (default now). */
export function lavZip(filer: readonly ZipFil[], o: { tid?: Date } = {}): Buffer {
  if (filer.length > 0xffff) throw new Error('for mange filer til én zip-fil');
  const { tid, dato } = dos(o.tid ?? new Date());
  const dele: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of filer) {
    tjekNavn(f.navn);
    const navn = Buffer.from(f.navn.normalize('NFC'), 'utf8');
    const crc = crc32(f.data);
    if (f.data.length > MAKS || offset > MAKS) throw new Error('zip-filen bliver for stor');
    const lokal = Buffer.alloc(30);
    lokal.writeUInt32LE(0x04034b50, 0);
    lokal.writeUInt16LE(20, 4); // version needed
    lokal.writeUInt16LE(UTF8, 6);
    lokal.writeUInt16LE(0, 8); // stored
    lokal.writeUInt16LE(tid, 10);
    lokal.writeUInt16LE(dato, 12);
    lokal.writeUInt32LE(crc, 14);
    lokal.writeUInt32LE(f.data.length, 18);
    lokal.writeUInt32LE(f.data.length, 22);
    lokal.writeUInt16LE(navn.length, 26);
    lokal.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(0x0314, 4); // made by: Unix, 2.0
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(UTF8, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt16LE(tid, 12);
    c.writeUInt16LE(dato, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(f.data.length, 20);
    c.writeUInt32LE(f.data.length, 24);
    c.writeUInt16LE(navn.length, 28);
    c.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a plain file, rw-r--r--
    c.writeUInt32LE(offset, 42);
    dele.push(lokal, navn, f.data);
    central.push(c, navn);
    offset += lokal.length + navn.length + f.data.length;
  }
  const cd = Buffer.concat(central);
  if (offset > MAKS || cd.length > MAKS) throw new Error('zip-filen bliver for stor');
  const slut = Buffer.alloc(22);
  slut.writeUInt32LE(0x06054b50, 0);
  slut.writeUInt16LE(filer.length, 8);
  slut.writeUInt16LE(filer.length, 10);
  slut.writeUInt32LE(cd.length, 12);
  slut.writeUInt32LE(offset, 16);
  return Buffer.concat([...dele, cd, slut]);
}
