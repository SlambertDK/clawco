// HTML for the household universe (KC-0148): who is in it and what they are,
// and the shared week with whose each entry is. Pure: data in, Markup out;
// every name and title goes through html`` (§4 r9). Two bunker (KC-0064: one
// line per thing, one button per line). Never a login or a phone number — the
// go-between (KC-0153) uses those, the screen does not.

import { html, type Markup } from '../shell/html.ts';
import { medId, spoerg } from '../shell/sprog.ts';
import { idagKbh } from '../shell/tid.ts';
import { ROLLE_NAVN } from '../identitet/roller.ts';
import type { Person } from '../identitet/husstand.ts';
import type { Medlem } from './schema.ts';
import type { FaellesDag, FaellesPost } from './uge.ts';

/** `forespoergsler` (KC-0149): the person's own requests and the form to ask, drawn by foresp-render.ts; absent = none. */
export type HusstandVisning = { medlemmer: readonly Medlem[]; person: Person; uge: readonly FaellesDag[]; now: Date; forespoergsler?: Markup };

const TZ = 'Europe/Copenhagen';
const DAGE = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];
const MDR = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

function plusDag(dato: string, n: number): string {
  const d = new Date(`${dato}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function datoLinje(dato: string, now: Date): string {
  const idag = idagKbh(now);
  if (dato === idag) return 'I dag';
  if (dato === plusDag(idag, 1)) return 'I morgen';
  const d = new Date(`${dato}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dato;
  return `${DAGE[d.getUTCDay()]} ${d.getUTCDate()}. ${MDR[d.getUTCMonth()]}`;
}

export function klokke(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('da-DK', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(':', '.');
}

/** "Maja og Du", "Henrik, Maja og Ella"; nobody named = the whole household. */
function hvemTekst(p: FaellesPost, v: HusstandVisning): string {
  const navne = p.hvem.map((id) => (id === v.person.id ? 'Du' : v.medlemmer.find((m) => m.id === id)?.navn)).filter((n): n is string => Boolean(n));
  if (!navne.length) return 'Alle';
  return navne.length === 1 ? navne[0]! : `${navne.slice(0, -1).join(', ')} og ${navne.at(-1)}`;
}

function medlemRaekke(m: Medlem, v: HusstandVisning): Markup {
  const du = m.id === v.person.id;
  const note = [ROLLE_NAVN[m.rolle], m.relation ?? ''].filter(Boolean).join(' · ');
  return medId(`medlem:${m.id}`, html`<div class="row medlem" data-medlem="${m.id}" data-medlem-rolle="${m.rolle}" data-element="Husstanden: ${m.navn}">
    <span class="row-main"><span class="row-title">${m.navn}${du ? html` <span class="chip chip-muted">Du</span>` : ''}</span><span class="row-note">${note}</span></span>
    <span class="actions">${spoerg(`Husstanden: ${m.navn}`)}</span>
  </div>`);
}

function dagRaekke(d: FaellesDag, v: HusstandVisning): Markup {
  const label = datoLinje(d.dato, v.now);
  return medId(`husstand-uge:${d.dato}`, html`<div class="row faelles-dag" data-element="Fælles: ${label}" data-datazone="husstand">
    <span class="row-main">
      <span class="row-title">${label}</span>
      <span class="uge-aftaler">${d.poster.map((p) => {
        const tid = p.heldag ? 'hele dagen' : `${klokke(p.start)}${p.slut && klokke(p.slut) ? `–${klokke(p.slut)}` : ''}`;
        return html`<span class="uge-aftale" data-post-kilde="${p.kilde}" data-uge-hvem="${p.hvem.join(' ') || 'alle'}"><span class="mono muted">${tid}</span> ${p.titel} <span class="mono muted">· ${hvemTekst(p, v)}</span></span>`;
      })}</span>
    </span>
    <span class="actions">${spoerg(`Fælles: ${label}`)}</span>
  </div>`);
}

export function renderHusstand(v: HusstandVisning): Markup {
  const dage = v.uge.filter((d) => d.poster.length > 0);
  const antal = dage.reduce((n, d) => n + d.poster.length, 0);
  return html`
  <header class="room-head">
    <div><h1>Husstanden</h1><p class="muted">Det, der gælder jer alle. Din egen Nu, dine noter og din arbejds- og privatzone ser de andre aldrig.</p></div>
  </header>
  ${v.forespoergsler ?? ''}
  <section class="card card-list gruppe" data-blok="bunke" data-gruppe="Fælles uge" data-husstand-uge>
    <div class="card-head"><h2 class="eyebrow">Fælles uge</h2><span class="muted mono">${antal}</span></div>
    ${dage.length ? dage.map((d) => dagRaekke(d, v)) : html`<p class="muted row">Intet fælles i den kommende uge.</p>`}
  </section>

  <section class="card card-list gruppe" data-blok="bunke" data-gruppe="Hvem er med">
    <div class="card-head"><h2 class="eyebrow">Hvem er med</h2><span class="muted mono">${v.medlemmer.length}</span></div>
    ${v.medlemmer.map((m) => medlemRaekke(m, v))}
  </section>`;
}

/** A person for whom there is no household universe: a plain 404 main that names nobody. */
export function renderIkkeHer(): Markup {
  return html`<header class="room-head"><div><a class="muted" href="/rum/hjem">Til Nu</a><h1>Husstanden findes ikke her</h1><p class="muted">Der er ikke en husstand, du kan se, på denne installation.</p></div></header>`;
}
