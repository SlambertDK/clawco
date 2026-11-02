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
import { felter, KANAL_NAVN, samtaleNoegle, samtaler, valgte, type Samtale } from './valg.ts';

export const BESKEDER_ID = 'beskeder';
export const STANDARD_DAGE = 14;
const MAKS_LAESNING = 100;
const MAKS_CACHE = 1000;

export const cacheFil = (dataDir: string): string => path.join(dataDir, 'beskeder-clawco', 'laest.json');

const INGEN_KANAL = 'Clawco kan læse de beskeder, der når Hermes på Telegram, WhatsApp eller Signal, og vise dem, der kræver noget af dig, i Nu. '
  + 'Hermes skriver ingen beskeder til Clawco endnu: Hermes skal have en beskedkanal, og Clawcos beskedkrog skal være sat op hos Hermes. '
  + 'Clawco læser kun og svarer aldrig selv.';
const ERLIG = 'Clawco læser kun de samtaler, du vælger, og svarer aldrig selv. Andre samtaler ser hverken Hermes eller Clawco.';

const erObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const vis = (s: string): string => s.replace(/[<>]/g, '');

function opremsning(navne: string[]): string {
  const n = navne.map(vis);
  if (n.length <= 3) return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} og ${n.at(-1)}`;
  const rest = n.length - 3;
  return `${n.slice(0, 3).join(', ')} og ${rest} ${rest === 1 ? 'anden' : 'andre'}`;
}

function siden(iso: string, nu: Date): string {
  const min = Math.max(0, Math.round((nu.getTime() - Date.parse(iso)) / 60_000));
  if (min < 60) return `${min} min`;
  const t = Math.round(min / 60);
  return t < 48 ? `${t} ${t === 1 ? 'time' : 'timer'}` : `${Math.round(t / 24)} dage`;
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

export function beskederKilde(o: { dataDir: string; logDir?: string; kontakter?: () => Promise<Kontakt[]>; dage?: number }): Kilde {
  const logDir = o.logDir ?? path.join(o.dataDir, 'beskeder');
  const fil = cacheFil(o.dataDir);
  const vindueMs = Math.max(1, o.dage ?? STANDARD_DAGE) * 86_400_000;
  const kontakter = async (): Promise<Kontakt[]> => { try { return (await o.kontakter?.()) ?? []; } catch { return []; } };

  /** The cache cut to the chosen conversations and the window; written back only when that changed it. */
  async function ryd(valg: Map<string, DataZone>, nu: Date, nye: Besked[] = []): Promise<Besked[]> {
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
  }

  const loggen = async (): Promise<RaaBesked[] | null> => {
    try { return await laesLog(logDir); } catch { throw new KildeFejl(502, 'Hermes’ beskedlog kunne ikke læses.'); }
  };

  /** The channel of a chosen conversation that was missing at the last gateway start (no status file = unknown, not missing). */
  async function mistetKanal(log: RaaBesked[], valg: Map<string, DataZone>): Promise<Kanal | undefined> {
    const status = await laesStatus(logDir);
    if (!status) return undefined;
    return samtaler(log).find((s) => valg.has(s.noegle) && !status.kanaler.includes(s.kanal))?.kanal;
  }

  function kortTekst(liste: Samtale[], valg: Map<string, DataZone>): string {
    const valgteNavn = liste.filter((s) => valg.has(s.noegle)).map((s) => s.navn);
    const kanaler = [...new Set(liste.map((s) => KANAL_NAVN[s.kanal]))];
    const ser = `Hermes kan se ${liste.length} ${liste.length === 1 ? 'samtale' : 'samtaler'} på ${opremsning(kanaler)}: ${opremsning(liste.map((s) => s.navn))}.`;
    const laeser = valgteNavn.length ? `Clawco læser ${valgteNavn.length} af ${liste.length} samtaler: ${opremsning(valgteNavn)}.` : 'Vælg, hvilke Clawco må læse; grupper er fra, til du vælger dem.';
    return `${ser} ${laeser} ${ERLIG}`;
  }

  return {
    id: BESKEDER_ID, navn: 'Beskeder', slags: 'beskeder', zone: 'privat', auth: 'bridge', tillid: 'uklar',

    async read(ctx: KildeKontekst) {
      const valg = valgte(ctx.valg);
      const log = await loggen();
      if (!log) throw new KildeFejl(502, 'Hermes skriver ingen beskeder til Clawco endnu.');
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
      if (!log) return { titel: 'Beskeder', tekst: INGEN_KANAL, felter: [], handling: 'Forbind' };
      const liste = samtaler(log);
      if (!liste.length) return { titel: 'Beskeder', tekst: `Hermes har ikke modtaget nogen beskeder endnu. Skriv til Hermes på en af dine kanaler, så står samtalen her. ${ERLIG}`, felter: [], handling: 'Forbind' };
      return { titel: 'Beskeder', tekst: kortTekst(liste, valgte(ctx.valg)), felter: felter(liste), handling: 'Gem valget' };
    },

    async opsaet(ctx) {
      const log = await loggen();
      if (!log) throw new KildeFejl(400, 'Hermes skriver ingen beskeder til Clawco endnu. Sæt Clawcos beskedkrog op hos Hermes først.');
      const valg = valgte(ctx.valg);
      await ryd(valg, ctx.nu); // un-chosen conversations are forgotten at once, not at the next read
      const navne = samtaler(log).filter((s) => valg.has(s.noegle)).map((s) => s.navn);
      const tekst = navne.length ? `Clawco læser nu ${opremsning(navne)}.` : 'Clawco læser ingen samtaler endnu.';
      return { tekst, valg: Object.fromEntries(valg) };
    },

    async helbred(ctx): Promise<Helbred> {
      const log = await laesLog(logDir).catch(() => null);
      if (!log) return { status: 'nede', tekst: 'Hermes skriver ingen beskeder til Clawco endnu.' };
      const valg = valgte(ctx.valg);
      const valgteSamtaler = samtaler(log).filter((s) => valg.has(s.noegle));
      if (!valgteSamtaler.length) return { status: 'ok', tekst: 'Ingen samtaler er valgt.' };
      const mistet = await mistetKanal(log, valg);
      if (mistet) return { status: 'log-ind-igen', tekst: GENFORBIND_KANAL[mistet] };
      const sidst = valgteSamtaler.map((s) => s.sidst).sort().at(-1);
      return { status: 'ok', ...(sidst ? { tekst: `Seneste besked for ${siden(sidst, ctx.nu)} siden.` } : {}) };
    },

    async frakobl(): Promise<void> {
      await rm(path.dirname(fil), { recursive: true, force: true });
    },
  };
}
