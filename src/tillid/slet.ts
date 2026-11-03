// KC-0146 "Slet alt" (D7: delete = remove the folder): removes the contents of
// $KC_DATA_DIR and of <vault>/Clawco/ — the two roots of the user's folder
// (brugermappe.ts) — and nothing else. Not a handling: no room offers it, no
// chat phrase, voice id or Hermes answer reaches it; the route asks for the
// owner and the typed word. A plain function (no HTTP), so Sky (KC-0206) can
// run it inside a tenant.
//
// Invariants: the data dir and Clawco/ themselves stay (empty), the vault root
// and the protected folders are never entered, a symlink is removed as a link
// and never followed (fs.rm does not follow links), a Clawco/ that is a symlink
// is skipped. One audit line is written first — if it cannot be written,
// nothing is deleted. Kept (KC-0275): pause.json (an app that was stopped stays stopped) and husstand.json
// (without it every tailnet login would be the owner afterwards). After the wipe a tombstone — who deleted
// everything, and when — is the first line of a fresh audit log.

import { lstat, readdir, realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Revision } from '../graenser/revisionslog.ts';
import { clawcoMappe, type Brugermappe } from './brugermappe.ts';
import { tillidTekst } from './tekster.ts';

export type SletValg = {
  person: string;
  kanal: 'knap';
  /** The audit log (E7); absent = none on this install. */
  revision?: { skriv(e: Omit<Revision, 'tid'>): Promise<unknown> };
};

/** What "Slet alt" keeps in the data dir: the kill switch's pause and the household's people. */
const BEVARES = new Set(['pause.json', 'husstand.json']);
const aegte = async (p: string): Promise<string> => { try { return await realpath(p); } catch { return path.resolve(p); } };
const indenfor = (rod: string, p: string): boolean => p.startsWith(rod + path.sep);

/** How many files (and links) `p` holds, without following links. */
async function antal(p: string): Promise<number> {
  const s = await lstat(p).catch(() => null);
  if (!s) return 0;
  if (!s.isDirectory()) return 1;
  let n = 0;
  for (const navn of await readdir(p).catch(() => [] as string[])) n += await antal(path.join(p, navn));
  return n;
}

/**
 * Removes everything in `dir` except `beskyt` (and the way down to them) and the names `vent` keeps for later.
 * Returns the count of removed files.
 */
async function ryd(dir: string, beskyt: readonly string[], vent: (navn: string) => boolean = () => false): Promise<number> {
  let n = 0;
  for (const p of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const abs = path.join(dir, p.name);
    if (beskyt.includes(abs) || vent(p.name)) continue;
    if (p.isDirectory() && beskyt.some((b) => indenfor(abs, b))) { n += await ryd(abs, beskyt); continue; }
    n += await antal(abs);
    await rm(abs, { recursive: true, force: true });
  }
  return n;
}

function tjekRod(dataDir: string): void {
  const r = dataDir.trim() ? path.resolve(dataDir) : '';
  if (!r || r === path.parse(r).root || r === path.resolve(homedir())) throw new Error(tillidTekst().sletRod(r || tillidTekst().ingenMappe));
}

export async function sletAlt(m: Brugermappe, o: SletValg): Promise<{ filer: number }> {
  tjekRod(m.dataDir);
  const data = await aegte(m.dataDir);
  tjekRod(data);
  const findesData = (await lstat(data).catch(() => null))?.isDirectory() ?? false;
  const clawco = await clawcoMappe(m.vaultDir);
  if (!findesData && !clawco) return { filer: 0 };
  const beskyt = await Promise.all([m.vaultDir, ...(m.beskyt ?? [])].filter((p): p is string => !!p?.trim()).map(aegte));
  // A vault (or another protected folder) that IS the data dir: its contents are the user's notes — refuse.
  if (findesData && beskyt.includes(data)) throw new Error(tillidTekst().dataErVault);

  await o.revision?.skriv({
    person: o.person, kanal: o.kanal, rum: 'viden', verb: 'slet', udfald: 'tillad',
    hvorfor: tillidTekst().sletRevision, zoner: [], kilde: 'viden',
  });

  let filer = 0;
  if (clawco) filer += await ryd(clawco, []);
  if (findesData) {
    filer += await ryd(data, beskyt, (navn) => BEVARES.has(navn));
  }
  // The old log went with the rest (its pre-wipe line included); the tombstone starts a new one. The data is gone, so a
  // failure here must not turn a finished wipe into an error.
  await o.revision?.skriv({
    person: o.person, kanal: o.kanal, rum: 'viden', verb: 'slet', udfald: 'tillad',
    hvorfor: tillidTekst().sletFaerdig, zoner: [], kilde: 'viden',
  }).catch(() => undefined);
  return { filer };
}
