// KC-0138: Beskeder — messages that reach Hermes on Telegram, WhatsApp or Signal (spec §3 step 4, D6, D8). Path B
// (docs/superpowers/specs/2026-11-01-beskeder-gateway-fund.md): Hermes' gateway hook appends each inbound message to
// <data dir>/beskeder/indgaaende.jsonl; this connector reads that file and nothing else.
//
// Invariants (§0 r2/r7): read-only and opt-in. A message is shaped (besked.ts) and kept only when its conversation
// has a zone chosen on the card; un-choosing deletes that conversation's messages from Clawco's cache (Hermes' log is
// the user's own and is never touched). The cache (<data dir>/beskeder-clawco/laest.json) keeps chosen messages for
// a bounded window (`dage`, default 14) and is written atomically. No verbs, no act(): nothing here can send.

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { erDataZone, type DataZone } from '../../identitet/zoner.ts';
import { GENFORBIND_KANAL } from '../helbred-tekst.ts';
import { KildeFejl, type Besked, type Helbred, type Kilde, type KildeKontekst, type KildeKort } from '../types.ts';
import { tilBesked, type Kontakt } from './besked.ts';
import { laesLog, laesStatus, type Kanal, type RaaBesked } from './jsonl.ts';
import { beskederTekst } from './tekster.ts';
import { felter, KANAL_NAVN, nytValg, samtaleNoegle, samtaler, valgte, type Samtale } from './valg.ts';

export const BESKEDER_ID = 'beskeder';
export const STANDARD_DAGE = 14;
const MAKS_LAESNING = 100;
const MAKS_CACHE = 1000;

export const cacheFil = (dataDir: string): string => path.join(dataDir, 'beskeder-clawco', 'laest.json');

const erObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const vis = (s: string): string => s.replace(/[<>]/g, '');

function opremsning(navne: string[]): string {
  const t = beskederTekst();
  const n = navne.map(vis);
  if (n.length <= 3) return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} ${t.og} ${n.at(-1)}`;
  const rest = n.length - 3;
  return `${n.slice(0, 3).join(', ')} ${t.og} ${rest} ${rest === 1 ? t.anden : t.andre}`;
}

function siden(iso: string, nu: Date): string {
  const w = beskederTekst();
  const min = Math.max(0, Math.round((nu.getTime() - Date.parse(iso)) / 60_000));
  if (min < 60) return w.min(min);
  const t = Math.round(min / 60);
  return t < 48 ? w.timer(t) : w.dage(Math.round(t / 24));
}

async function laesCache(fil: string): Promise<Besked[]> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(fil, 'utf8')); } catch { return []; }
  if (!erObj(raw) || !Array.isArray(raw['beskeder'])) return [];
  return raw['beskeder'].filter((b): b is Besked => erObj(b) && typeof b['id'] === 'string' && typeof b['samtaleId'] === 'string' && typeof b['tid'] === 'string' && erDataZone(b['zone']));
}

async function skrivCache(fil: string, beskeder: Besked[]): Promise<void> {
  await mkdir(path.dirname(fil), { recursive: true });
  const tmp = `${fil}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify({ beskeder }), 'utf8');
  await rename(tmp, fil);
}

/** KC-0224: one conversation as the Kø panel lists it: its name, channel and kind, whether Clawco reads it and in which zone. */
export type SamtaleVisning = { noegle: string; navn: string; kanal: string; gruppe: boolean; valgt: boolean; zone?: DataZone };

/** KC-0224: Beskeder with the two functions that change the choice after the connection (the registry's aendreValg writes the result). */
export type BeskederKilde = Kilde & {
  samtalerMedValg(valg: Readonly<Record<string, string>>): Promise<SamtaleVisning[]>;
  vaelgSamtaler(noegler: readonly string[], ctx: KildeKontekst): Promise<{ tekst: string; valg: Record<string, string>; samtaler: SamtaleVisning[] }>;
};

export function beskederKilde(o: { dataDir: string; logDir?: string; kontakter?: () => Promise<Kontakt[]>; dage?: number }): BeskederKilde {
  const logDir = o.logDir ?? path.join(o.dataDir, 'beskeder');
  const fil = cacheFil(o.dataDir);
  const vindueMs = Math.max(1, o.dage ?? STANDARD_DAGE) * 86_400_000;
  const kontakter = async (): Promise<Kontakt[]> => { try { return (await o.kontakter?.()) ?? []; } catch { return []; } };

  // KC-0224: the choice as the last change or setup left it, so a read that began before an un-choosing (and so holds the
  // old options) can never put the conversation back in the cache; cache work runs one at a time. Null until the first
  // change in this process: then the options of the read are the truth (a restart reads kilder.json, written first).
  let gaeldende: Map<string, DataZone> | null = null;
  let kaede: Promise<unknown> = Promise.resolve();
  const serielt = <T,>(f: () => Promise<T>): Promise<T> => { const n = kaede.then(f, f); kaede = n.catch(() => undefined); return n; };

  /** The cache cut to the chosen conversations and the window; written back only when that changed it. */
  const ryd = (valgFraKald: Map<string, DataZone>, nu: Date, nye: Besked[] = []): Promise<Besked[]> => serielt(async () => {
    const valg = gaeldende ?? valgFraKald;
    const gamle = await laesCache(fil);
    const graense = nu.getTime() - vindueMs;
    const set = new Map<string, Besked>();
    for (const b of [...gamle, ...nye]) {
      const zone = valg.get(b.samtaleId);
      if (!zone || Date.parse(b.tid) < graense || !b.id) continue;
      const foer = set.get(b.id);
      set.set(b.id, { ...b, zone, laest: foer?.laest ?? b.laest });
    }
    const ud = [...set.values()].sort((a, b) => b.tid.localeCompare(a.tid)).slice(0, MAKS_CACHE);
    const aendret = ud.length !== gamle.length || ud.some((b, i) => b.id !== gamle[i]?.id || b.zone !== gamle[i]?.zone);
    if (aendret || nye.length) {
      if (ud.length) await skrivCache(fil, ud);
      else await rm(fil, { force: true });
    }
    return ud;
  });

  const loggen = async (): Promise<RaaBesked[] | null> => {
    try { return await laesLog(logDir); } catch { throw new KildeFejl(502, beskederTekst().loggenKunneIkkeLaeses); }
  };

  /** The channel of a chosen conversation that was missing at the last gateway start (no status file = unknown, not missing). */
  async function mistetKanal(log: RaaBesked[], valg: Map<string, DataZone>): Promise<Kanal | undefined> {
    const status = await laesStatus(logDir);
    if (!status) return undefined;
    return samtaler(log).find((s) => valg.has(s.noegle) && !status.kanaler.includes(s.kanal))?.kanal;
  }

  function kortTekst(liste: Samtale[], valg: Map<string, DataZone>): string {
    const t = beskederTekst();
    const valgteNavn = liste.filter((s) => valg.has(s.noegle)).map((s) => s.navn);
    const kanaler = [...new Set(liste.map((s) => KANAL_NAVN[s.kanal]))];
    const ser = t.ser(liste.length, opremsning(kanaler), opremsning(liste.map((s) => s.navn)));
    const laeser = valgteNavn.length ? t.laeser(valgteNavn.length, liste.length, opremsning(valgteNavn)) : t.vaelg;
    return t.kortSamlet(ser, laeser, t.erlig);
  }

  const visning = (liste: Samtale[], v: Map<string, DataZone>): SamtaleVisning[] => liste.map((s) => {
    const zone = v.get(s.noegle);
    return { noegle: s.noegle, navn: s.navn, kanal: KANAL_NAVN[s.kanal], gruppe: s.gruppe, valgt: zone !== undefined, ...(zone ? { zone } : {}) };
  });

  return {
    id: BESKEDER_ID, get navn() { return beskederTekst().navn; }, slags: 'beskeder', zone: 'privat', auth: 'bridge', tillid: 'uklar',

    async read(ctx: KildeKontekst) {
      const valg = valgte(ctx.valg);
      const log = await loggen();
      if (!log) throw new KildeFejl(502, beskederTekst().ingenBeskederEndnu);
      // A chosen conversation whose channel did not come up at the last gateway start is not being read: say so, never "ok".
      const mistet = await mistetKanal(log, valg);
      if (mistet) throw new KildeFejl(502, GENFORBIND_KANAL[mistet]);
      const graense = ctx.nu.getTime() - vindueMs;
      const folk = valg.size ? await kontakter() : [];
      const nye: Besked[] = [];
      for (const r of log) {
        const zone = valg.get(samtaleNoegle(r.kanal, r.samtale));
        if (!zone || Date.parse(r.tid) < graense) continue; // un-chosen: never shaped, never stored
        nye.push(tilBesked(r, { kontakter: folk, zone }));
      }
      const beskeder = await ryd(valg, ctx.nu, nye);
      return { slags: 'beskeder', hentet: ctx.nu.toISOString(), uklar: true, data: beskeder.slice(0, MAKS_LAESNING) };
    },

    async kort(ctx): Promise<KildeKort> {
      const log = await loggen().catch(() => null);
      const t = beskederTekst();
      if (!log) return { titel: t.navn, tekst: t.ingenKanal, felter: [], handling: t.handling.forbind };
      const liste = samtaler(log);
      if (!liste.length) return { titel: t.navn, tekst: t.ingenBeskeder(t.erlig), felter: [], handling: t.handling.forbind };
      return { titel: t.navn, tekst: kortTekst(liste, valgte(ctx.valg)), felter: felter(liste), handling: t.handling.gemValget };
    },

    async opsaet(ctx) {
      const log = await loggen();
      if (!log) throw new KildeFejl(400, beskederTekst().saetKrogOp);
      const valg = valgte(ctx.valg);
      gaeldende = valg;
      await ryd(valg, ctx.nu); // un-chosen conversations are forgotten at once, not at the next read
      const navne = samtaler(log).filter((s) => valg.has(s.noegle)).map((s) => s.navn);
      const tekst = navne.length ? beskederTekst().laeserNu(opremsning(navne)) : beskederTekst().laeserIngen;
      return { tekst, valg: Object.fromEntries(valg) };
    },

    /** KC-0224: every conversation the log shows, each with whether it is chosen (the panel's list; no text, no ids). */
    async samtalerMedValg(valg) {
      return visning(samtaler((await loggen().catch(() => null)) ?? []), valgte(valg));
    },

    /** KC-0224: the choice after the connection. An unknown key is a 400; an un-chosen conversation is forgotten at once (the same purge as the card's). */
    async vaelgSamtaler(noegler, ctx) {
      const log = await loggen();
      if (!log) throw new KildeFejl(502, beskederTekst().ingenBeskederEndnu);
      const liste = samtaler(log);
      const nyt = nytValg(liste, valgte(ctx.valg), noegler, ctx.zone);
      if (!nyt) throw new KildeFejl(400, beskederTekst().ukendtSamtale);
      gaeldende = nyt;
      await ryd(nyt, ctx.nu);
      const tekst = beskederTekst().laeserNuAf(nyt.size, liste.length);
      return { tekst, valg: Object.fromEntries(nyt), samtaler: visning(liste, nyt) };
    },

    async helbred(ctx): Promise<Helbred> {
      const log = await laesLog(logDir).catch(() => null);
      if (!log) return { status: 'nede', tekst: beskederTekst().ingenBeskederEndnu };
      const valg = valgte(ctx.valg);
      const valgteSamtaler = samtaler(log).filter((s) => valg.has(s.noegle));
      if (!valgteSamtaler.length) return { status: 'ok', tekst: beskederTekst().ingenValgt };
      const mistet = await mistetKanal(log, valg);
      if (mistet) return { status: 'log-ind-igen', tekst: GENFORBIND_KANAL[mistet] };
      const sidst = valgteSamtaler.map((s) => s.sidst).sort().at(-1);
      return { status: 'ok', ...(sidst ? { tekst: beskederTekst().seneste(siden(sidst, ctx.nu)) } : {}) };
    },

    async frakobl(): Promise<void> {
      gaeldende = null;
      await rm(path.dirname(fil), { recursive: true, force: true });
    },
  };
}
