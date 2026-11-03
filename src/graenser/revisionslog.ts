// The audit log (KC-0124, spec §5): what Clawco did and what it said no to,
// one JSON line per decision in $KC_DATA_DIR/revision-YYYY-MM.jsonl (the
// Copenhagen month). Append-only: the app never edits or deletes a line.
// Metadata only — ids, labels and the app's own reason, never mail text or a
// secret: an entry with any field outside `Revision` is refused (KC-0125
// enforces the wider rule). Tamper evidence: each line carries `forrige`, the
// hash of the previous line's raw text (64 zeros for the very first line; a
// new month continues from the last line of the latest earlier file).
// KC-0275 (B6): the hash is an HMAC-SHA256 under a sub-key (HKDF, label "revision") of the key file
// KC_HEMMELIGHEDER_FIL names (outside the data folder, the model-key store's key); without that file it is
// the plain sha256 as before (fail-visible: logging never stops, /viden says the log is not sealed). The last
// line's hash is also kept in `revision.anker` next to the log, so a cut-off tail shows. A line hashed with the
// key can never again be followed by a plain-sha256 one: once the chain is sealed an attacker without the key
// cannot re-chain a rewritten log. Limit: a process with the key file's rights can still forge both.

import { createHash, createHmac, hkdfSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { skrivAtomisk } from '../store/atomisk.ts';
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
/** A broken chain, or (`aarsag: 'anker'`) a tail that does not match the anchor: lines were cut off or the anchor was changed. */
export type Kaedetjek = { ok: true } | { ok: false; fil: string; linje: number; aarsag?: 'anker' };

export class RevisionFejl extends Error {}

export const NUL_HASH = '0'.repeat(64);

/** The longest each text field may be; anything longer is not metadata. */
const LAENGDE: Record<string, number> = { person: 40, rum: 80, verb: 40, hvorfor: 300, handlingId: 200, runId: 80, kilde: 30 };
const FELTER = new Set(['tid', 'person', 'kanal', 'rum', 'verb', 'udfald', 'hvorfor', 'handlingId', 'runId', 'zoner', 'kilde']);
const FIL = /^revision-(\d{4})-(\d{2})\.jsonl$/;

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const mac = (noegle: Buffer, s: string): string => createHmac('sha256', noegle).update(s).digest('hex');
/** The anchor: the hash the next line must carry (so it equals the tip of the chain). */
export const ANKER = 'revision.anker';
const B64_32 = /^[A-Za-z0-9+/]{43}=$/;
const afled = (raa: Buffer): Buffer => Buffer.from(hkdfSync('sha256', raa, Buffer.alloc(0), 'revision', 32));
const noeglefilen = (fil?: string): string => (fil ?? process.env['KC_HEMMELIGHEDER_FIL'] ?? '').trim();

/** The audit sub-key from the key file; null = no usable key file (absent, unreadable, not 32 bytes of base64). Read on every call. */
async function laesNoegle(fil?: string): Promise<Buffer | null> {
  const f = noeglefilen(fil);
  if (!f) return null;
  try {
    const t = (await readFile(f, 'utf8')).trim();
    return B64_32.test(t) ? afled(Buffer.from(t, 'base64')) : null;
  } catch { return null; }
}

/** Whether the audit chain is sealed with a key (for /viden: one sentence when it is not). */
export function revisionNoegleFindes(fil?: string): boolean {
  const f = noeglefilen(fil);
  if (!f) return false;
  try { return B64_32.test(readFileSync(f, 'utf8').trim()); } catch { return false; }
}
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

export function lavRevisionslog(dataDir: string, o: { nu?: () => Date; noeglefil?: string } = {}) {
  const dir = path.resolve(dataDir);
  const nu = o.nu ?? (() => new Date());

  /** The hash the next line in `fil` must carry: its own last line, else the latest earlier file's, else zeros. */
  async function forrigeFor(fil: string, noegle: Buffer | null): Promise<string> {
    const hash = (l: string): string => (noegle ? mac(noegle, l) : sha(l));
    const egne = await linjer(path.join(dir, fil));
    if (egne.length) return hash(egne.at(-1)!);
    for (const f of (await filer(dir)).filter((x) => x < fil).reverse()) {
      const l = await linjer(path.join(dir, f));
      if (l.length) return hash(l.at(-1)!);
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
        const noegle = await laesNoegle(o.noeglefil);
        const linje: Revisionslinje = { ...ren, forrige: await forrigeFor(fil, noegle) };
        await mkdir(dir, { recursive: true });
        const raa = JSON.stringify(linje);
        await appendFile(path.join(dir, fil), `${raa}\n`, 'utf8');
        // The anchor follows the append; a crash between the two leaves a stale anchor that the next line corrects.
        await skrivAtomisk(path.join(dir, ANKER), `${noegle ? mac(noegle, raa) : sha(raa)}\n`);
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

    /**
     * Walks every file oldest first; the first line whose `forrige` is not the hash of the line before breaks the chain.
     * With the key a line is chained by HMAC (a plain sha256 link is accepted only before the first HMAC one); then the
     * last line's hash must equal the anchor, which must itself be an HMAC when there is a key.
     */
    async tjekKaede(): Promise<Kaedetjek> {
      const noegle = await laesNoegle(o.noeglefil);
      let forrige: string | null = null; // the previous raw line
      let forseglet = false; // an HMAC link has been seen: from here on a sha256 link is a break
      let sidste: { fil: string; antal: number } | null = null;
      for (const f of await filer(dir)) {
        const l = await linjer(path.join(dir, f));
        for (let i = 0; i < l.length; i++) {
          let laenke: unknown;
          try { laenke = (JSON.parse(l[i]!) as { forrige?: unknown }).forrige; } catch { laenke = undefined; }
          if (forrige === null) {
            if (laenke !== NUL_HASH) return { ok: false, fil: f, linje: i + 1 };
          } else if (noegle && laenke === mac(noegle, forrige)) {
            forseglet = true;
          } else if (laenke !== sha(forrige) || forseglet) {
            return { ok: false, fil: f, linje: i + 1 };
          }
          forrige = l[i]!;
        }
        if (l.length) sidste = { fil: f, antal: l.length };
      }
      if (forrige === null || !sidste) return { ok: true };
      let anker: string | null = null;
      try { anker = (await readFile(path.join(dir, ANKER), 'utf8')).trim(); } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      // A log from before the anchor existed has none yet: fine without a key, and the next line writes it.
      if (anker === null && !noegle) return { ok: true };
      const forventet = noegle ? mac(noegle, forrige) : sha(forrige);
      if (anker !== forventet) return { ok: false, fil: sidste.fil, linje: sidste.antal, aarsag: 'anker' };
      return { ok: true };
    },
  };
}
export type Revisionslog = ReturnType<typeof lavRevisionslog>;
