// KC-0078: how fresh a built room is, as a small quiet phrase in the room
// header. "opdateret 07.05" when Hermes built it today, "fra i går 07.05" /
// "fra tirsdag 07.05" / "fra 24. okt. 07.05" (warning tone) when it is older.
// Pure: `now` is injected (the test world shifts it), and the day is always
// the Copenhagen day, never the process time zone.

import { html, type Markup } from './html.ts';
import { FRISKHEDSVINDUE_MS } from '../kilder/helbred-tekst.ts';

const TZ = 'Europe/Copenhagen';

export const dagStr = (d: Date): string => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
export const klokke = (d: Date): string => new Intl.DateTimeFormat('da-DK', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(':', '.');
const dagNr = (s: string): number => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) / 86_400_000;

/** The freshness phrase for a room built at `genereret`; empty markup when the time is unusable. */
export function friskhed(genereret: string, now: Date): Markup {
  const d = new Date(genereret);
  if (!genereret || Number.isNaN(d.getTime())) return html``;
  const dage = Math.round(dagNr(dagStr(now)) - dagNr(dagStr(d)));
  const tid = klokke(d);
  if (dage <= 0) return html`<span class="friskhed">opdateret ${tid}</span>`;
  const naar = dage === 1
    ? 'i går'
    : dage < 7
      ? new Intl.DateTimeFormat('da-DK', { timeZone: TZ, weekday: 'long' }).format(d)
      : new Intl.DateTimeFormat('da-DK', { timeZone: TZ, day: 'numeric', month: 'short' }).format(d);
  return html`<span class="friskhed friskhed-gammel">fra ${naar} ${tid}</span>`;
}

/** The phrase as a header-subtitle tail (" · opdateret 07.05"); empty when there is nothing to show. */
export function friskhedEfter(genereret: string, now: Date): Markup {
  const f = friskhed(genereret, now);
  return f.s ? html` · ${f}` : html``;
}

/** KC-0139: what a room or Nu knows about the source its elements were read from. `ok`: the source works now (ok or snart-udloebet). */
export type KildeFriskhed = { slags: string; sidstLaest?: string; ok: boolean };

const laestTid = (f: KildeFriskhed): Date | null => {
  const d = new Date(f.sidstLaest ?? '');
  return f.sidstLaest && !Number.isNaN(d.getTime()) ? d : null;
};

/**
 * The invariant of KC-0139: elements are fresh only while the source works AND its last successful read is inside the
 * slags' freshness window. Never read (or an unreadable time) is not fresh.
 */
export function erFrisk(f: KildeFriskhed, now: Date): boolean {
  const d = laestTid(f);
  const vindue = (FRISKHEDSVINDUE_MS as Record<string, number | undefined>)[f.slags];
  return f.ok && d !== null && vindue !== undefined && now.getTime() - d.getTime() <= vindue;
}

/** "i går 16.20", "tirsdag 16.20", "24. okt. 16.20" — or just "16.20" today. */
function naarTekst(d: Date, now: Date): string {
  const dage = Math.round(dagNr(dagStr(now)) - dagNr(dagStr(d)));
  const tid = klokke(d);
  if (dage <= 0) return tid;
  const naar = dage === 1 ? 'i går' : dage < 7 ? new Intl.DateTimeFormat('da-DK', { timeZone: TZ, weekday: 'long' }).format(d) : new Intl.DateTimeFormat('da-DK', { timeZone: TZ, day: 'numeric', month: 'short' }).format(d);
  return `${naar} ${tid}`;
}

/**
 * "Sidst hentet 07.05" while fresh; "ikke opdateret siden i går 16.20" when not (the elements shown are the last good
 * ones, labelled); empty when the source was never read and works (nothing to say yet).
 */
export function kildeFriskhed(f: KildeFriskhed, now: Date): Markup {
  const d = laestTid(f);
  if (erFrisk(f, now) && d) return html`<span class="friskhed" data-sidst-hentet>Sidst hentet ${naarTekst(d, now)}</span>`;
  if (d) return html`<span class="friskhed friskhed-gammel" data-ikke-opdateret>ikke opdateret siden ${naarTekst(d, now)}</span>`;
  return f.ok ? html`` : html`<span class="friskhed friskhed-gammel" data-ikke-opdateret>ikke hentet endnu</span>`;
}

/** The source phrase as a header-subtitle tail (" · Sidst hentet 07.05"); empty when there is nothing to say. */
export function kildeFriskhedEfter(f: KildeFriskhed | null | undefined, now: Date): Markup {
  const m = f ? kildeFriskhed(f, now) : html``;
  return m.s ? html` · ${m}` : html``;
}
