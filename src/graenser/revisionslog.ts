// The audit log (KC-0124, spec §5): what Clawco did and what it said no to,
// one JSON line per decision in $KC_DATA_DIR/revision-YYYY-MM.jsonl (the
// Copenhagen month). Append-only: the app never edits or deletes a line.
// Metadata only — ids, labels and the app's own reason, never mail text or a
// secret: an entry with any field outside `Revision` is refused (KC-0125
// enforces the wider rule). Tamper evidence: each line carries `forrige`, the
// sha256 of the previous line's raw text (64 zeros for the very first line; a
// new month continues from the last line of the latest earlier file).

import { createHash } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { redigeres } from './redaktion.ts';
import { erDataZone, type DataZone } from '../identitet/zoner.ts';

// KC-0188: 'stoette' = Clawco support looking along under the owner's time-boxed grant ("Lad support se med").
export const KANALER = ['knap', 'stemme', 'chat', 'agent', 'planlagt', 'stoette'] as const;
export type Kanal = (typeof KANALER)[number];
export const REVISION_UDFALD = ['tillad', 'kraever-ja', 'afvist', 'stop', 'genoptag'] as const;
export type RevisionUdfald = (typeof REVISION_UDFALD)[number];

export type Revision = {
  tid: string;
  person: string;
  kanal: Kanal;
  rum: string;
  verb: string;
  udfald: RevisionUdfald;
  /** The app's own plain-Danish reason (afgoer, the kill switch) — never text from a mail or the model. */
  hvorfor: string;
  handlingId?: string;
  runId?: string;
  zoner: DataZone[];
  /** Which part of Clawco wrote the line: 'graense' (the policy port) or 'nodstop' (the kill switch). */
  kilde: string;
};
export type Revisionslinje = Revision & { forrige: string };

const maskerFelter = (r: Revision): Revision => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' ? redigeres(v) : v])) as Revision;
export type Kaedetjek = { ok: true } | { ok: false; fil: string; linje: number };

export class RevisionFejl extends Error {}

export const NUL_HASH = '0'.repeat(64);

/** The longest each text field may be; anything longer is not metadata. */
const LAENGDE: Record<string, number> = { person: 40, rum: 80, verb: 40, hvorfor: 300, handlingId: 200, runId: 80, kilde: 30 };
const FELTER = new Set(['tid', 'person', 'kanal', 'rum', 'verb', 'udfald', 'hvorfor', 'handlingId', 'runId', 'zoner', 'kilde']);
const FIL = /^revision-(\d{4})-(\d{2})\.jsonl$/;

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
export const erNej = (e: Pick<Revision, 'udfald'>): boolean => e.udfald === 'afvist' || e.udfald === 'kraever-ja';

function valider(raw: unknown): Revision {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new RevisionFejl('en revisionslinje skal være et objekt');
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!FELTER.has(k)) throw new RevisionFejl(`ukendt felt i revisionslinjen: ${k.slice(0, 40)}`);
  for (const [k, max] of Object.entries(LAENGDE)) {
    const v = o[k];
    const valgfri = k === 'handlingId' || k === 'runId';
    if (valgfri && v === undefined) continue;
    if (typeof v !== 'string' || v.length > max || (!valgfri && k !== 'hvorfor' && !v)) throw new RevisionFejl(`ugyldigt felt i revisionslinjen: ${k}`);
  }
  if (typeof o['tid'] !== 'string' || Number.isNaN(Date.parse(o['tid']))) throw new RevisionFejl('ugyldig tid i revisionslinjen');
  if (!(KANALER as readonly unknown[]).includes(o['kanal'])) throw new RevisionFejl('ukendt kanal i revisionslinjen');
  if (!(REVISION_UDFALD as readonly unknown[]).includes(o['udfald'])) throw new RevisionFejl('ukendt udfald i revisionslinjen');
  if (!Array.isArray(o['zoner']) || o['zoner'].length > 3 || !o['zoner'].every(erDataZone)) throw new RevisionFejl('ukendte zoner i revisionslinjen');
  return o as Revision;
}

/** The file of an instant: the Copenhagen month. */
export function revisionsfil(tid: string): string {
  const [aar, md] = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit' }).format(new Date(tid)).split('-');
  return `revision-${aar}-${md}.jsonl`;
}

async function linjer(fil: string): Promise<string[]> {
  try { return (await readFile(fil, 'utf8')).split('\n').filter((l) => l.length > 0); } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function filer(dataDir: string): Promise<string[]> {
  try { return (await readdir(dataDir)).filter((f) => FIL.test(f)).sort(); } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/** One write queue per data dir: every instance on the same dir (a new registry, the test world) appends in order. */
const KOEER = new Map<string, Promise<unknown>>();

export function lavRevisionslog(dataDir: string, o: { nu?: () => Date } = {}) {
  const dir = path.resolve(dataDir);
  const nu = o.nu ?? (() => new Date());

  /** The hash the next line in `fil` must carry: its own last line, else the latest earlier file's, else zeros. */
  async function forrigeFor(fil: string): Promise<string> {
    const egne = await linjer(path.join(dir, fil));
    if (egne.length) return sha(egne.at(-1)!);
    for (const f of (await filer(dir)).filter((x) => x < fil).reverse()) {
      const l = await linjer(path.join(dir, f));
      if (l.length) return sha(l.at(-1)!);
    }
    return NUL_HASH;
  }

  return {
    /** Validates and appends one entry (tid defaults to now). Throws RevisionFejl before anything is written. */
    async skriv(e: Omit<Revision, 'tid'> & { tid?: string }): Promise<Revisionslinje> {
      // KC-0125: metadata only, and a secret value in any text field is masked before the line is chained and written.
      const ren = maskerFelter(valider({ ...e, tid: e.tid ?? nu().toISOString() }));
      const forrige = KOEER.get(dir) ?? Promise.resolve();
      const job = forrige.catch(() => undefined).then(async () => {
        const fil = revisionsfil(ren.tid);
        const linje: Revisionslinje = { ...ren, forrige: await forrigeFor(fil) };
        await mkdir(dir, { recursive: true });
        await appendFile(path.join(dir, fil), `${JSON.stringify(linje)}\n`, 'utf8');
        return linje;
      });
      KOEER.set(dir, job);
      return job;
    },

    /** The newest `antal` lines, newest first, across months. Unreadable lines are skipped (tjekKaede reports them). */
    async seneste(antal = 50): Promise<Revisionslinje[]> {
      const ud: Revisionslinje[] = [];
      for (const f of (await filer(dir)).reverse()) {
        for (const l of (await linjer(path.join(dir, f))).reverse()) {
          try { ud.push(JSON.parse(l) as Revisionslinje); } catch { continue; }
          if (ud.length >= antal) return ud;
        }
      }
      return ud;
    },

    /** Walks every file oldest first; the first line whose `forrige` is not the hash of the line before breaks the chain. */
    async tjekKaede(): Promise<Kaedetjek> {
      let forventet = NUL_HASH;
      for (const f of await filer(dir)) {
        const l = await linjer(path.join(dir, f));
        for (let i = 0; i < l.length; i++) {
          let forrige: unknown;
          try { forrige = (JSON.parse(l[i]!) as { forrige?: unknown }).forrige; } catch { forrige = undefined; }
          if (forrige !== forventet) return { ok: false, fil: f, linje: i + 1 };
          forventet = sha(l[i]!);
        }
      }
      return { ok: true };
    },
  };
}
export type Revisionslog = ReturnType<typeof lavRevisionslog>;
