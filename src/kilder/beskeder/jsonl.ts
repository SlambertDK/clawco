// KC-0138 (Path B, docs/superpowers/specs/2026-11-01-beskeder-gateway-fund.md): the inbound log Hermes' gateway
// hook (deploy/hermes/beskeder-hook.py) appends to under <dir>/indgaaende.jsonl, rotated to indgaaende.jsonl.1,
// and the status file it writes when the gateway starts (which channels came up). Only these two files are read;
// whatever a line carries beyond the declared fields is dropped here. A line without its newline is one Hermes
// is still writing: it is left for the next read, never parsed half.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const KANALER = ['telegram', 'whatsapp', 'signal'] as const;
export type Kanal = (typeof KANALER)[number];
export const erKanal = (v: unknown): v is Kanal => typeof v === 'string' && (KANALER as readonly string[]).includes(v);

export const LOG_FIL = 'indgaaende.jsonl';
export const STATUS_FIL = 'status.json';

/** One inbound message as the hook wrote it. `samtale`/`afsender` are the platform's own ids (often a phone number). */
export type RaaBesked = {
  kanal: Kanal; samtale: string; gruppe: boolean; afsender: string; tid: string; tekst: string;
  samtaleNavn?: string; afsenderNavn?: string; vedhaeftning?: { navn: string; type: string }[];
};
export type GatewayStatus = { kanaler: Kanal[]; tid: string };

const MAKS_ID = 200;
const MAKS_NAVN = 120;
const MAKS_TEKST = 4000;
const erObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const tekstFelt = (v: unknown, maks: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, maks) : undefined);

function enLinje(raw: unknown): RaaBesked | null {
  if (!erObj(raw) || !erKanal(raw['kanal'])) return null;
  const samtale = tekstFelt(raw['samtale'], MAKS_ID);
  const afsender = tekstFelt(raw['afsender'], MAKS_ID);
  const tid = typeof raw['tid'] === 'string' && !Number.isNaN(Date.parse(raw['tid'])) ? new Date(raw['tid']).toISOString() : undefined;
  if (!samtale || !afsender || !tid || typeof raw['tekst'] !== 'string') return null;
  const ud: RaaBesked = { kanal: raw['kanal'], samtale, gruppe: raw['gruppe'] === true, afsender, tid, tekst: raw['tekst'].slice(0, MAKS_TEKST) };
  const samtaleNavn = tekstFelt(raw['samtaleNavn'], MAKS_NAVN);
  const afsenderNavn = tekstFelt(raw['afsenderNavn'], MAKS_NAVN);
  if (samtaleNavn) ud.samtaleNavn = samtaleNavn;
  if (afsenderNavn) ud.afsenderNavn = afsenderNavn;
  if (Array.isArray(raw['vedhaeftning'])) {
    const v = raw['vedhaeftning'].filter(erObj).slice(0, 10)
      .map((a) => ({ navn: tekstFelt(a['navn'], MAKS_NAVN) ?? 'vedhæftning', type: tekstFelt(a['type'], 80) ?? 'ukendt' }));
    if (v.length) ud.vedhaeftning = v;
  }
  return ud;
}

/** The complete lines of a log text, in order; a malformed line is skipped and counted. */
export function parseLinjer(tekst: string): { poster: RaaBesked[]; sprunget: number } {
  const slut = tekst.lastIndexOf('\n');
  const hele = slut === -1 ? '' : tekst.slice(0, slut);
  const poster: RaaBesked[] = [];
  let sprunget = 0;
  for (const l of hele.split('\n')) {
    if (!l.trim()) continue;
    let raw: unknown;
    try { raw = JSON.parse(l); } catch { sprunget += 1; continue; }
    const p = enLinje(raw);
    if (p) poster.push(p); else sprunget += 1;
  }
  return { poster, sprunget };
}

async function laesValgfri(fil: string): Promise<string | null> {
  try { return await readFile(fil, 'utf8'); } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** The rotated log, then the current one. null = Hermes has written no log here (no hook installed yet). */
export async function laesLog(dir: string): Promise<RaaBesked[] | null> {
  const gammel = await laesValgfri(path.join(dir, `${LOG_FIL}.1`));
  const ny = await laesValgfri(path.join(dir, LOG_FIL));
  if (gammel === null && ny === null) return null;
  return [...parseLinjer(gammel ?? '').poster, ...parseLinjer(ny ?? '').poster];
}

/** The channels of the last gateway start; null when there is none or it cannot be read. */
export async function laesStatus(dir: string): Promise<GatewayStatus | null> {
  let raw: unknown;
  try { raw = JSON.parse((await laesValgfri(path.join(dir, STATUS_FIL))) ?? 'null'); } catch { return null; }
  if (!erObj(raw) || !Array.isArray(raw['platforms']) || typeof raw['tid'] !== 'string' || Number.isNaN(Date.parse(raw['tid']))) return null;
  return { kanaler: raw['platforms'].filter(erKanal), tid: raw['tid'] };
}
