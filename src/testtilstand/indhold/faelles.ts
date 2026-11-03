// Small helpers the test world's rooms share (KC-0068). Lifted from the demo's
// historie.ts (KC-0058).

import type { Kilde, LogEntry } from '../../store/types.ts';
import type { Fortryd } from '../../rooms/univers/lager.ts';
import type { Kuvert } from '../typer.ts';
import type { Fakta } from './fakta.ts';
import { indhold } from './sprogindhold.ts';

export type Raa = Record<string, unknown>;

/**
 * One line of a room's log, with the first moment it exists at (`fra`, the index in MOMENT_TABEL). `ved` pins an
 * explicit instant (earlier days); `fortrudt` marks it undone from moment `fra` at Copenhagen time `hhmm`.
 */
export type LogPost = {
  fra: number; hhmm?: string; plus?: number; ved?: string; kilde: Kilde; tekst: string; handlingId?: string; fortryd?: string;
  fortrudt?: { fra: number; hhmm: string };
  /** KC-0226: the zone of the line (a Kuratoren run over arbejde or husstand); absent = privat. */
  zone?: 'arbejde' | 'husstand';
};

export function logFra(rum: string, poster: LogPost[], n: number, f: Fakta): LogEntry[] {
  const ud = poster.flatMap((p, i): LogEntry[] => {
    if (p.fra > n) return [];
    const e: LogEntry = { id: `test-${rum}-${String(i + 1).padStart(2, '0')}`, tid: p.ved ?? f.iso(p.hhmm ?? '00:00', p.plus ?? 0), kilde: p.kilde, tekst: p.tekst };
    if (p.handlingId) e.handlingId = p.handlingId;
    if (p.fortryd) e.fortryd = p.fortryd;
    if (p.zone) e.zone = p.zone;
    if (p.fortrudt && p.fortrudt.fra <= n) e.fortrudt = f.iso(p.fortrudt.hhmm);
    return [e];
  });
  return ud.sort((a, b) => a.tid.localeCompare(b.tid));
}

export const lokal = (fortryd: Fortryd): string => `lokal:${JSON.stringify(fortryd)}`;
export const fenced = (tekst: string, json: unknown): string => `${tekst}\n\`\`\`json\n${JSON.stringify(json)}\n\`\`\``;

export function kuvert(id: string, emne: string, navn: string, dato: string, o: { laest?: boolean; vedhaeft?: boolean } = {}): Kuvert {
  const adresse = `${navn.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'afsender'}@example.org`;
  return {
    id, subject: emne, from: [{ name: navn, email: adresse }], to: [{ name: null, email: 'henrik@example.org' }], date: dato,
    flags: o.laest ? [{ raw: '\\Seen', iana: 'seen' }] : [], 'has-attachment': Boolean(o.vedhaeft), size: 4200,
    'message-id': `<${id}@example.org>`, 'in-reply-to': null,
  };
}

/** The weekday (0 = Sunday) of day `n` after the story's day. */
const ugedagNr = (f: Fakta, n: number): number => new Date(`${f.plus(n)}T12:00:00Z`).getUTCDay();
/** The weekday's letters in the language being rendered (KC-0244: the front page's English screens). */
export const ugedagKort = (f: Fakta, n: number): string => indhold().ugedage[ugedagNr(f, n)] ?? '';
/** Whether day `n` is a Saturday or a Sunday. */
export const erWeekend = (f: Fakta, n: number): boolean => [0, 6].includes(ugedagNr(f, n));
