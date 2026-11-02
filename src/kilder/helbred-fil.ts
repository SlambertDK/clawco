// helbred.json (KC-0139): what is remembered of each connected source's health,
// next to kilder.json, and the controller that feeds the state machine
// (src/kilder/helbred.ts) with real outcomes — a poll of the connector's own
// health check (every 30 minutes, set up by the composition root) and a poll
// right after a failed read. Writes are atomic and serialised; a file that is
// missing or unreadable reads as "no state" (everything ok), never as an error
// on a page. Depends on store/ and the registry's interface only.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { skrivAtomisk } from '../store/atomisk.ts';
import type { RumLager } from '../store/types.ts';
import { iagttag, type Maaling, type Post } from './helbred.ts';
import { kortTekst } from './helbred-tekst.ts';
import { HELBRED, virker, type Helbred, type Kilde } from './types.ts';

export type HelbredFil = Record<string, Post>;

const fil = (dataDir: string): string => path.join(dataDir, 'helbred.json');
const erObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const tekst = (v: unknown): string | undefined => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : undefined);

function enPost(raw: unknown): Post | null {
  if (!erObj(raw)) return null;
  const { vist, fejl } = raw;
  if (typeof vist !== 'string' || !(HELBRED as readonly string[]).includes(vist) || typeof fejl !== 'number' || !Number.isInteger(fejl) || fejl < 0) return null;
  const p: Post = { vist: vist as Post['vist'], fejl };
  for (const felt of ['siden', 'foersteFejl', 'sidstOk', 'sidstLaest', 'udloeber'] as const) { const t = tekst(raw[felt]); if (t) p[felt] = t; }
  return p;
}

/** The remembered health per source id. Missing or unreadable file = {}; an entry that does not parse is dropped. */
export async function laesHelbredFil(dataDir: string): Promise<HelbredFil> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(fil(dataDir), 'utf8')); } catch { return {}; }
  if (!erObj(raw) || !erObj(raw['kilder'])) return {};
  const ud: HelbredFil = {};
  for (const [id, p] of Object.entries(raw['kilder'])) { const r = enPost(p); if (r) ud[id] = r; }
  return ud;
}

/** What the controller needs of the registry (lavRegister's result satisfies it). */
export type HelbredRegister = {
  forbundneAlle(): Promise<Kilde[]>;
  helbredFor(id: string): Promise<Helbred | null>;
  hvor(id: string): Promise<{ zone: 'privat' | 'arbejde' | 'husstand'; af: string | null }>;
  hent(id: string): Kilde | undefined;
};

export type HelbredStyringDeps = {
  dataDir: string;
  nu: () => Date;
  register: HelbredRegister;
  /** For the one line each change of state leaves (the room `kilder`'s log, where connects are). */
  store: Pick<RumLager, 'appendLog'>;
  /** The live bus: Nu is refetched when what is shown changes. */
  live?: { notify(kanal: string): void };
  /** The store room of the connect log (default 'kilder'). */
  logRum?: string;
  /** The live channel of Nu (default 'hjem'). */
  nuKanal?: string;
};

export function lavHelbredStyring(d: HelbredStyringDeps) {
  const logRum = d.logRum ?? 'kilder';
  const nuKanal = d.nuKanal ?? 'hjem';
  let kaede: Promise<unknown> = Promise.resolve();
  /** Runs `fn` after everything queued before it (the file is read-modified-written whole). */
  const efter = <T>(fn: () => Promise<T>): Promise<T> => { const r = kaede.then(fn); kaede = r.catch(() => undefined); return r; };
  /** Work in flight, so tom() can wait for it (a read's follow-up is fire and forget). */
  const igang = new Set<Promise<unknown>>();
  const spor = <T>(p: Promise<T>): Promise<T> => { igang.add(p); const frie = (): void => { igang.delete(p); }; p.then(frie, frie); return p; };

  async function linje(id: string, nu: Post): Promise<void> {
    const k = d.register.hent(id);
    if (!k) return;
    const hvor = await d.register.hvor(id).catch(() => null);
    const skriv = (t: string): Promise<void> => d.store.appendLog(logRum, { kilde: 'system', tekst: t, zone: hvor?.zone ?? k.zone, ...(hvor?.af ? { ejer: hvor.af } : {}) }).then(() => undefined);
    if (nu.vist === 'ok') await skriv(`${k.navn} virker igen.`);
    else if (nu.vist === 'langsomt') await skriv(`${k.navn} svarer langsomt.`);
    else await skriv(`${k.navn}: ${kortTekst(nu.vist, k.auth, k.slags).titel}.`);
  }

  /** Folds one outcome of `id` into the file; a change of what is shown logs a line and tells Nu. */
  function anvend(id: string, m: Maaling): Promise<void> {
    return efter(async () => {
      const alle = await laesHelbredFil(d.dataDir);
      const foer = alle[id];
      const nu = iagttag(foer, m);
      await skrivAtomisk(fil(d.dataDir), JSON.stringify({ kilder: { ...alle, [id]: nu } }, null, 2));
      const aendret = (foer?.vist ?? 'ok') !== nu.vist;
      if (aendret) {
        try { await linje(id, nu); } catch (err) { console.error('helbred: linjen kunne ikke skrives:', err instanceof Error ? err.message : err); }
        d.live?.notify(nuKanal);
      }
    });
  }

  const maaling = (h: Helbred): Maaling => ({ tid: d.nu().toISOString(), status: h.status, ...(h.udloeber ? { udloeber: h.udloeber } : {}) });

  const styring = {
    /** The remembered health of every source (call sites filter by what is connected). */
    laes: (): Promise<HelbredFil> => laesHelbredFil(d.dataDir),

    /** What a read through the registry came to: ok = the proof of fresh data; a failure asks the connector what is wrong, right away. */
    laesning: (id: string, ok: boolean): Promise<void> => spor((async () => {
      if (ok) return anvend(id, { tid: d.nu().toISOString(), status: 'ok', laest: true });
      const h = await d.register.helbredFor(id);
      if (!h) return;
      // The read failed, so a source that still says it works is failing all the same.
      await anvend(id, virker(h) ? { tid: d.nu().toISOString(), status: 'nede' } : maaling(h));
    })()),

    /** One health check of one connected source, folded in. */
    poll: (id: string): Promise<void> => spor((async () => {
      const h = await d.register.helbredFor(id);
      if (h) await anvend(id, maaling(h));
    })()),

    /** Every connected source once, and the state of a source that is no longer connected removed. */
    async pollAlle(): Promise<void> {
      const forbundne = await d.register.forbundneAlle();
      for (const k of forbundne) { try { await styring.poll(k.id); } catch (err) { console.error(`helbred: ${k.id}:`, err instanceof Error ? err.message : err); } }
      const ider = new Set(forbundne.map((k) => k.id));
      await efter(async () => {
        const alle = await laesHelbredFil(d.dataDir);
        const rest = Object.fromEntries(Object.entries(alle).filter(([id]) => ider.has(id)));
        if (Object.keys(rest).length !== Object.keys(alle).length) await skrivAtomisk(fil(d.dataDir), JSON.stringify({ kilder: rest }, null, 2));
      });
    },

    /** Waits until everything queued so far is written (tests; shutdown). */
    async tom(): Promise<void> {
      while (igang.size) await Promise.allSettled([...igang]);
      await efter(async () => undefined);
    },
  };
  return styring;
}

export type HelbredStyring = ReturnType<typeof lavHelbredStyring>;
