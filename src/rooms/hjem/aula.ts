// KC-0236, the Danmark-pakke's Aula element in Nu: a school or kindergarten event that is today or tomorrow, one element per
// event — "I dag: <title> (<institution>, <time>)" — gone once it is over (KC-0052: not greyed out), and nothing at all while
// nothing is due. Pure: the week as the Aula connector reads it (KalenderData) in, markup out; every text through the escaper.
//
// Children as subjects (findings note Q5): only what the connector already keeps — title, time, place and the institution
// (the calendar's name). Titles are teacher-typed text and may name a child: untrusted, so escaped, never put in a log line.
//
// The element has no handling: no button, no instruction, no ask control — Clawco reads the week and shows it, nothing more
// (AGENTS §9). It is in the household zone (the shared week's), and WHO sees it is the server's call (src/hushold/rettigheder.ts
// `maaSe`, the same check as the week's), so this file has no role list of its own. Danish in both screen languages: Aula is a
// Danish service and this is the Danmark-pakke's own wording (as Digital Post's card).

import { html, type Markup } from '../../shell/html.ts';
import { type Element } from '../../shell/sprog.ts';
import { visHoved } from '../../shell/visuel.ts';
import { zoneData } from '../../shell/zone.ts';
import type { DataZone } from '../../identitet/zoner.ts';

/** One event as Nu keeps it: nothing beyond what the shared week shows. */
export type AulaHaendelse = { id: string; titel: string; start: string; slut?: string; heldag: boolean; institution?: string; sted?: string };
/** What Nu is told about Aula (absent = nothing due: no element, no group). */
/** `zone`: the zone the connection was made in (the household's unless the owner chose otherwise); default husstand. */
export type AulaVisning = { haendelser: AulaHaendelse[]; zone?: DataZone };

export const AULA_GRUPPE = 'Aula';
export const AULA_ID = 'aula:';
/** More events than this fold into one line that points at the week. */
export const AULA_MAKS = 3;
/** An event with no end is over this long after it starts. */
const UDEN_SLUT_MS = 60 * 60_000;

const TZ = 'Europe/Copenhagen';
const dagKbh = (d: Date): string => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const klokkeKbh = (d: Date): string => new Intl.DateTimeFormat('da-DK', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d).replace(':', '.');
const DATO = /^\d{4}-\d{2}-\d{2}$/;
const plusDage = (dato: string, n: number): string => {
  const [y, m, d] = dato.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

const erObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const s = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Which of the two days an event belongs to now, or null when it is not for Nu (not due, over, or not a time). */
function dagFor(h: AulaHaendelse, nu: Date): 'i-dag' | 'i-morgen' | null {
  const idag = dagKbh(nu);
  const imorgen = plusDage(idag, 1);
  if (h.heldag) {
    const fra = h.start.slice(0, 10);
    const til = DATO.test((h.slut ?? '').slice(0, 10)) ? (h.slut as string).slice(0, 10) : plusDage(fra, 1); // the end date of an all-day event is exclusive
    if (fra <= idag && idag < til) return 'i-dag';
    return fra <= imorgen && imorgen < til ? 'i-morgen' : null;
  }
  const start = Date.parse(h.start);
  if (Number.isNaN(start)) return null;
  const slut = h.slut && !Number.isNaN(Date.parse(h.slut)) ? Date.parse(h.slut) : start + UDEN_SLUT_MS;
  if (slut <= nu.getTime()) return null;
  const dag = dagKbh(new Date(start));
  return dag === idag ? 'i-dag' : dag === imorgen ? 'i-morgen' : null;
}

/** The events of a week (the connector's KalenderData, untrusted) that are for Nu now: today and tomorrow, not over; the day's order. */
export function aulaHaendelser(data: unknown, nu: Date): AulaHaendelse[] {
  const dage = erObj(data) && Array.isArray(data['days']) ? data['days'] : [];
  const set = new Set<string>();
  const ud: AulaHaendelse[] = [];
  for (const d of dage) {
    for (const e of erObj(d) && Array.isArray(d['events']) ? d['events'] : []) {
      if (!erObj(e)) continue;
      const titel = s(e['title'], 120);
      const start = s(e['start'], 40);
      if (!titel || !start) continue;
      const id = s(e['id'], 200) || `${titel}|${start}`;
      if (set.has(id)) continue;
      const h: AulaHaendelse = { id, titel, start, heldag: e['all_day'] === true };
      const slut = s(e['end'], 40); if (slut) h.slut = slut;
      const inst = s(e['calendar'], 80); if (inst) h.institution = inst;
      const sted = s(e['location'], 120); if (sted) h.sted = sted;
      if (dagFor(h, nu) === null) continue;
      set.add(id);
      ud.push(h);
    }
  }
  const tid = (h: AulaHaendelse): number => (h.heldag ? -Infinity : Date.parse(h.start));
  return ud.sort((a, b) => (dagFor(a, nu) === dagFor(b, nu) ? 0 : dagFor(a, nu) === 'i-dag' ? -1 : 1) || (tid(a) === tid(b) ? 0 : tid(a) < tid(b) ? -1 : 1));
}

const dagOrd = { 'i-dag': 'I dag', 'i-morgen': 'I morgen' } as const;

function enHaendelse(h: AulaHaendelse, dag: 'i-dag' | 'i-morgen', zone: DataZone): Markup {
  const tid = h.heldag ? 'hele dagen' : `kl. ${klokkeKbh(new Date(h.start))}`;
  const linje = `${dagOrd[dag]}: ${h.titel} (${[h.institution, tid].filter(Boolean).join(', ')})`;
  return html`<article class="card kort" data-blok="kort" data-aula-kort="${h.id}" data-aula-dag="${dag}"${zoneData({ zone })} data-element="Aula: ${h.titel}">
    ${visHoved({ ikon: 'backpack' }, linje, AULA_GRUPPE)}
    ${h.sted ? html`<p class="row-note" data-aula-sted>${h.sted}</p>` : ''}
  </article>`;
}

function flere(n: number, zone: DataZone): Markup {
  return html`<article class="card kort" data-blok="kort" data-aula-kort="flere"${zoneData({ zone })} data-element="Aula: flere begivenheder">
    ${visHoved({ ikon: 'backpack' }, `${String(n)} flere i dag og i morgen`, AULA_GRUPPE)}
    <p class="row-note"><a href="/rum/husstand">Se den fælles uge</a></p>
  </article>`;
}

/** The elements Nu draws under "Aula": one per event (the first AULA_MAKS, then one line for the rest), none when nothing is due. */
export function aulaElementer(v: AulaVisning | undefined, nu: Date): Element[] {
  if (!v || v.haendelser.length === 0) return [];
  const vist = v.haendelser.flatMap((h) => { const dag = dagFor(h, nu); return dag ? [{ h, dag }] : []; });
  const zone = v.zone ?? 'husstand';
  const ud: Element[] = vist.slice(0, AULA_MAKS).map(({ h, dag }) => ({ id: `${AULA_ID}${h.id}`, html: enHaendelse(h, dag, zone) }));
  if (vist.length > AULA_MAKS) ud.push({ id: `${AULA_ID}flere`, html: flere(vist.length - AULA_MAKS, zone) });
  return ud;
}
