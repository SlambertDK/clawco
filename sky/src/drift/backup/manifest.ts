// The manifest of a copy (KC-0185): how many regular files and one sha256 over every file's path, size and
// own sha256, read from the tar itself (ustar, GNU long names, pax paths). Taken at backup time and stored
// with the snapshot; the drill takes it again from the restored volume and the two must be equal. A
// truncated or corrupt archive, or a path that climbs out of the volume, refuses — never a short manifest.
import { createHash } from 'node:crypto';

export type Manifest = { antal: number; digest: string };
export type TarFil = { sti: string; data: Buffer };

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

function fejl(hvad: string): Error { return new Error(`ugyldig tar: ${hvad}`); }

function tekst(b: Buffer): string {
  const nul = b.indexOf(0);
  return (nul === -1 ? b : b.subarray(0, nul)).toString('utf8');
}

function tal(b: Buffer): number {
  if (b[0]! & 0x80) { // base-256 (GNU, for sizes over 8 GB)
    let n = 0;
    for (let i = 1; i < b.length; i++) n = n * 256 + b[i]!;
    return n;
  }
  const s = tekst(b).trim();
  if (!/^[0-7]*$/.test(s)) throw fejl('et tal-felt er ikke oktalt');
  return s ? parseInt(s, 8) : 0;
}

function rens(sti: string): string {
  const s = sti.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  if (!s || s.startsWith('/') || s.split('/').some((d) => d === '..')) throw fejl('en sti peger ud af disken');
  return s;
}

function paxSti(b: Buffer): string | null {
  let sti: string | null = null;
  let i = 0;
  while (i < b.length) {
    const mellem = b.indexOf(0x20, i);
    if (mellem === -1) break;
    const n = Number(b.subarray(i, mellem).toString('ascii'));
    if (!Number.isInteger(n) || n <= 0) throw fejl('en pax-linje er forkert');
    const linje = b.subarray(mellem + 1, i + n - 1).toString('utf8');
    const lig = linje.indexOf('=');
    if (linje.slice(0, lig) === 'path') sti = linje.slice(lig + 1);
    i += n;
  }
  return sti;
}

export function tarFiler(tar: Buffer): TarFil[] {
  const ud: TarFil[] = [];
  let i = 0;
  let naesteNavn: string | null = null;
  let slut = false;
  while (i + 512 <= tar.length) {
    const h = tar.subarray(i, i + 512);
    if (h.every((b) => b === 0)) { slut = true; break; }
    let sum = 0;
    for (let j = 0; j < 512; j++) sum += j >= 148 && j < 156 ? 0x20 : h[j]!;
    if (sum !== tal(h.subarray(148, 156))) throw fejl('en kontrolsum passer ikke');
    const stoerrelse = tal(h.subarray(124, 136));
    const type = String.fromCharCode(h[156]!);
    const dataStart = i + 512;
    const dataSlut = dataStart + stoerrelse;
    if (dataSlut > tar.length) throw fejl('arkivet er afkortet');
    const data = tar.subarray(dataStart, dataSlut);
    i = dataStart + Math.ceil(stoerrelse / 512) * 512;
    if (type === 'L') { naesteNavn = tekst(data); continue; }
    if (type === 'x') { naesteNavn = paxSti(data) ?? naesteNavn; continue; }
    if (type === 'g') continue;
    const prefix = h.subarray(257, 262).toString('ascii') === 'ustar' ? tekst(h.subarray(345, 500)) : '';
    const navn = naesteNavn ?? (prefix ? `${prefix}/${tekst(h.subarray(0, 100))}` : tekst(h.subarray(0, 100)));
    naesteNavn = null;
    if (type === '0' || type === '\0' || type === '7') ud.push({ sti: rens(navn), data: Buffer.from(data) });
    else if (type === '5' && navn.replace(/^(\.\/)+/, '').replace(/\/+$/, '')) rens(navn);
  }
  if (!slut) throw fejl('arkivet er afkortet');
  return ud;
}

export function manifestFraFiler(filer: TarFil[]): Manifest {
  const linjer = filer.map((f) => `${f.sti}\0${f.data.length}\0${sha(f.data)}\n`).sort();
  return { antal: filer.length, digest: sha(linjer.join('')) };
}

export function manifestFraTar(tar: Buffer): Manifest {
  return manifestFraFiler(tarFiler(tar));
}
