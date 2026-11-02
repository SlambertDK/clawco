// Shared log helpers for renderers: the latest result per handling, so a
// room can show what Hermes answered inside the element that asked.

import type { LogEntry } from '../store/types.ts';
import { html, type Markup } from './html.ts';
import { tilstandChip } from './sprog.ts';

/** Newest non-undone entry per handlingId (log is newest first). */
export function senesteResultater(log: LogEntry[]): Map<string, LogEntry> {
  const m = new Map<string, LogEntry>();
  for (const e of [...log].sort((a, b) => b.tid.localeCompare(a.tid))) {
    if (!e.handlingId || e.fortrudt || m.has(e.handlingId)) continue;
    m.set(e.handlingId, e);
  }
  return m;
}

function klokke(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(':', '.');
}

export function resultatBoks(e: LogEntry): Markup {
  return html`<div class="resultat">${tilstandChip('ordnet', `Hermes · ${klokke(e.tid)}`)}<br>${e.tekst}</div>`;
}

const DOEGN = 24 * 60 * 60 * 1000;

/** Entries of the last 24 hours (the Fortryd window), order kept; unparseable times are dropped. */
export function dagensLog<T extends { tid: string }>(log: T[], now: Date): T[] {
  return log.filter((e) => {
    const t = new Date(e.tid).getTime();
    return !Number.isNaN(t) && now.getTime() - t <= DOEGN;
  });
}
