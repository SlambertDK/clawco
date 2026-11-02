// Writes a Froe (one moment's data, src/testtilstand/typer.ts) into the test
// world's data dir: room files through the store, the Dagen/Nyheder source
// file and the Hermes mail plan as the real sources expect them. Also the
// test mail runner (fictional himalaya). Lifted from the demo's skriv.ts
// (KC-0058); KC-0068.

import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { RumLager } from '../store/types.ts';
import type { Runner } from '../rooms/mail/source.ts';
import type { Froe } from './typer.ts';
import { idagKbh } from './ur.ts';
import { lavRevisionslog } from '../graenser/revisionslog.ts';
import { skrivKonfig } from '../kilder/register.ts';

/** Subfolders of the test dir the app derives from the seed; wiped on every seed. */
const OPRYDDES = ['rum', 'hermes-state', 'vault', 'tillid', 'hemmeligheder', 'beskeder', 'beskeder-clawco'];
/** "test" must be a whole token of the folder name (data-test, kc-test-1), not a substring (latest, contest). */
const TESTMAPPE = /(^|[-_.])test($|[-_.])/i;

async function skrivAtomisk(fil: string, indhold: string): Promise<void> {
  const tmp = `${fil}.tmp-${randomUUID()}`;
  await writeFile(tmp, indhold, 'utf8');
  await rename(tmp, fil);
}

/**
 * Replaces the test world's data with `froe`. Everything is written under `dataDir` and nothing outside it is
 * touched. `dataDir` must be a test folder (its name has "test" as a whole token, e.g. `data-test`): anything else is
 * refused before a single file is removed, so the real data dir can never be wiped by a wrong path. `store` must be
 * rooted at the same `dataDir` (the guard cannot check that). `dag` = the test date (YYYY-MM-DD).
 */
export async function skrivFroe(dataDir: string, froe: Froe, store: RumLager, dag: string = idagKbh(new Date())): Promise<void> {
  const rod = path.resolve(dataDir);
  if (!TESTMAPPE.test(path.basename(rod))) throw new Error(`skrivFroe skriver kun i en testmappe (navnet skal have "test" som eget led, fx data-test), ikke ${rod}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dag)) throw new Error(`ugyldig dag: ${dag}`);

  await mkdir(rod, { recursive: true });
  for (const navn of OPRYDDES) await rm(path.join(rod, navn), { recursive: true, force: true });
  for (const navn of await readdir(rod)) if (/^avis_\d{4}-\d{2}-\d{2}\.json$/.test(navn)) await rm(path.join(rod, navn), { force: true });
  // KC-0124: the kill switch's pause and the audit log are per moment too.
  for (const navn of await readdir(rod)) if (navn === 'pause.json' || navn === 'stoette.json' || navn === 'kilder.json' || navn === 'helbred.json' || navn === 'profil.json' || navn === 'indstillinger.json' || /^revision-\d{4}-\d{2}\.jsonl$/.test(navn)) await rm(path.join(rod, navn), { force: true });

  for (const [rum, r] of Object.entries(froe.rum)) {
    await store.writeState(rum, r.state);
    // The log file is oldest first (the store reads it newest first), whatever order the story gave.
    for (const e of [...(r.log ?? [])].sort((a, b) => a.tid.localeCompare(b.tid))) await store.appendLog(rum, e);
    for (const e of r.chat ?? []) await store.appendChat(rum, e);
  }

  if (froe.avis !== null && froe.avis !== undefined) await skrivAtomisk(path.join(rod, `avis_${dag}.json`), JSON.stringify(froe.avis, null, 2));
  await skrivAtomisk(path.join(rod, 'husstand.json'), JSON.stringify(froe.husstand, null, 2));
  // KC-0147: the history of what required the owner, as the app's own store reads it (lines, oldest first).
  if (froe.dagstal?.length) {
    await mkdir(path.join(rod, 'tillid'), { recursive: true });
    await skrivAtomisk(path.join(rod, 'tillid', 'dagstal.jsonl'), froe.dagstal.map((d) => `${JSON.stringify(d)}\n`).join(''));
  }
  // KC-0145: what the app kept off the screen and the Sunday sample's ledger, as the app's own stores read them.
  if (froe.skjulte?.length || froe.stikproever) await mkdir(path.join(rod, 'tillid'), { recursive: true });
  if (froe.skjulte?.length) await skrivAtomisk(path.join(rod, 'tillid', 'skjulte.jsonl'), froe.skjulte.map((s) => `${JSON.stringify(s)}\n`).join(''));
  if (froe.stikproever) await skrivAtomisk(path.join(rod, 'tillid', 'stikproever.json'), JSON.stringify(froe.stikproever, null, 2));
  if (froe.pause) await skrivAtomisk(path.join(rod, 'pause.json'), JSON.stringify(froe.pause, null, 2));
  if (froe.stoette) await skrivAtomisk(path.join(rod, 'stoette.json'), JSON.stringify(froe.stoette, null, 2)); // KC-0188: support looking along
  if (froe.kilder) await skrivKonfig(rod, froe.kilder); // KC-0132: the moment's connected fakes
  if (froe.helbred) await skrivAtomisk(path.join(rod, 'helbred.json'), JSON.stringify({ kilder: froe.helbred }, null, 2)); // KC-0139: the moment's connection health
  if (froe.profil) await skrivAtomisk(path.join(rod, 'profil.json'), JSON.stringify(froe.profil, null, 2)); // KC-0126: Start's step 1
  if (froe.indstillinger) await skrivAtomisk(path.join(rod, 'indstillinger.json'), JSON.stringify(froe.indstillinger, null, 2)); // KC-0127: Start's step 2
  if (froe.beskeder) { // KC-0138: what the gateway hook has written so far
    await mkdir(path.join(rod, 'beskeder'), { recursive: true });
    await skrivAtomisk(path.join(rod, 'beskeder', 'indgaaende.jsonl'), froe.beskeder.log);
    await skrivAtomisk(path.join(rod, 'beskeder', 'status.json'), froe.beskeder.status);
  }
  if (froe.revision?.length) { const log = lavRevisionslog(rod); for (const e of froe.revision) await log.skriv(e); }
  if (froe.mailPlan !== null && froe.mailPlan !== undefined) {
    const mappe = path.join(rod, 'hermes-state');
    await mkdir(mappe, { recursive: true });
    await skrivAtomisk(path.join(mappe, `mail-plan-auto-${dag}-031000.json`), JSON.stringify(froe.mailPlan, null, 2));
  }
}

/** A fictional himalaya: `envelope list -m <folder>` answers from froe.mappe (empty for unknown folders); any other command succeeds quietly. */
export function testMailRunner(getFroe: () => Froe | undefined): Runner {
  return async (_cmd, args) => {
    if (args[0] === 'envelope' && args[1] === 'list') {
      const mappe = args[args.indexOf('-m') + 1] ?? '';
      const envelopes = getFroe()?.mappe[mappe] ?? [];
      return { code: 0, stdout: JSON.stringify({ envelopes }), stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
}
