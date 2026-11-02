// KC-0129: what an upload may be and where it lives. The browser reads each chosen file as text and sends
// `{ navn, tekst }` pieces; here they are checked (type allowlist, size cap, names that are never a path) and written to
// ONE temp folder per upload, `<base>/<ms>-<random>/`, with names Clawco picked itself — so no user-given name is ever
// part of a path. The folder is removed when the proposals are saved or cancelled, and by `rydTmp` after one hour
// whatever happened (the card says so). Zip is not supported (no new dependency; the card says so).

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { ActionError } from '../../module.ts';
import { startTekst } from '../tekster.ts';

export const UPLOAD_MAKS = 10 * 1024 * 1024;
export const TMP_LEVETID_MS = 3_600_000;
export const FILER_MAKS = 200;
/** What Start can read: contacts, and notes as text or html. */
export const TILLADTE_TYPER = ['vcf', 'csv', 'md', 'txt', 'html', 'htm'] as const;

export type Upload = { dir: string; filer: { navn: string; tekst: string }[] };

const MAPPE = /^(\d{1,16})-[0-9a-f]{8,}$/;

function tjek(filer: unknown): { navn: string; tekst: string; type: string }[] {
  const T = startTekst().akt;
  if (!Array.isArray(filer) || !filer.length) throw new ActionError(T.vaelgMindstEn);
  if (filer.length > FILER_MAKS) throw new ActionError(T.hoejstFiler(FILER_MAKS));
  let bytes = 0;
  const ud: { navn: string; tekst: string; type: string }[] = [];
  for (const f of filer as unknown[]) {
    const o = typeof f === 'object' && f !== null ? (f as Record<string, unknown>) : null;
    if (!o || typeof o['navn'] !== 'string' || typeof o['tekst'] !== 'string') throw new ActionError(T.filKanIkkeLaeses);
    const navn = o['navn'];
    if (!navn || navn.length > 200 || /[\u0000-\u001f\u007f/\\]/.test(navn) || navn === '.' || navn === '..' || navn.includes('..')) throw new ActionError(T.filnavnKanIkke);
    const type = (/\.([A-Za-z0-9]{1,5})$/.exec(navn)?.[1] ?? '').toLowerCase();
    if (!(TILLADTE_TYPER as readonly string[]).includes(type) || navn.startsWith('.')) throw new ActionError(T.filtypeKanIkke(navn.slice(0, 60)));
    bytes += Buffer.byteLength(o['tekst'], 'utf8');
    if (bytes > UPLOAD_MAKS) throw new ActionError(T.forStore);
    ud.push({ navn, tekst: o['tekst'], type });
  }
  return ud;
}

/** Checks the pieces and writes them to a fresh folder under `base`. Refused uploads leave nothing behind. */
export async function modtagUpload(base: string, nu: Date, filer: unknown): Promise<Upload> {
  const ok = tjek(filer);
  const dir = path.join(base, `${nu.getTime()}-${randomBytes(6).toString('hex')}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    for (const [i, f] of ok.entries()) await writeFile(path.join(dir, `${i}.${f.type}`), f.tekst, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
  return { dir, filer: ok.map(({ navn, tekst }) => ({ navn, tekst })) };
}

/** Removes Clawco's own upload folders under `base`: all of them, or those made before `foer`. Returns how many. */
export async function rydTmp(base: string, o: { alle?: true; foer?: Date }): Promise<number> {
  let navne: string[];
  try { navne = await readdir(base); } catch { return 0; }
  let n = 0;
  for (const navn of navne) {
    const m = MAPPE.exec(navn);
    if (!m) continue;
    if (!o.alle && !(o.foer && Number(m[1]) < o.foer.getTime())) continue;
    await rm(path.join(base, navn), { recursive: true, force: true });
    n += 1;
  }
  return n;
}

/** Removes one upload folder (the one `modtagUpload` returned); never throws. */
export const fjernUpload = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true }).catch(() => undefined);
