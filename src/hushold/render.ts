// HTML for the household universe (KC-0148): who is in it and what they are,
// and the shared week with whose each entry is. Pure: data in, Markup out;
// every name and title goes through html`` (§4 r9). Two bunker (KC-0064: one
// line per thing, one button per line). Never a login or a phone number — the
// go-between (KC-0153) uses those, the screen does not.

import { html, type Markup } from '../shell/html.ts';
import { handlinger, knap, medId, spoerg } from '../shell/sprog.ts';
import { idagKbh } from '../shell/tid.ts';
import { ROLLER } from '../identitet/roller.ts';
import { tekst, type Sprog, sprogNu } from '../shell/tekster.ts';
import { HUSSTAND_TEKSTER, husstandTekst } from './tekster.ts';
import type { Person } from '../identitet/husstand.ts';
import type { Medlem } from './schema.ts';
import type { FaellesDag, FaellesPost } from './uge.ts';

/**
 * `forespoergsler` (KC-0149): the person's own requests and the form to ask, drawn by foresp-render.ts; absent = none.
 * KC-0154 (rettigheder.ts decides, this only draws): `faelles` false = a guest, who gets her requests and nothing of
 * the shared week or who is in it; `invitationer`: the owner's cards; `kanRette`: the owner's role and remove tools.
 */
export type HusstandVisning = { medlemmer: readonly Medlem[]; person: Person; uge: readonly FaellesDag[]; now: Date; forespoergsler?: Markup; faelles?: boolean; invitationer?: Markup; kanRette?: boolean };

const TZ = 'Europe/Copenhagen';

function plusDag(dato: string, n: number): string {
  const d = new Date(`${dato}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * "I dag", "I morgen", "Lørdag 7. nov". Danish unless `sprog` says otherwise: Hermes' prompt calls it without one;
 * everything a person reads (screens, log lines, titles) passes the language being served (KC-0170, `datoVis`).
 */
export function datoLinje(dato: string, now: Date, sprog: Sprog = 'da'): string {
  const T = HUSSTAND_TEKSTER[sprog];
  const idag = idagKbh(now);
  if (dato === idag) return T.iDag;
  if (dato === plusDag(idag, 1)) return T.iMorgen;
  const d = new Date(`${dato}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dato;
  return T.dato(T.ugedage[d.getUTCDay()]!, d.getUTCDate(), T.maaneder[d.getUTCMonth()]!);
}

/** "16.30" (Danish, the default) or "16:30" (English), Copenhagen time. */
export function klokke(iso: string, sprog: Sprog = 'da'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (sprog === 'en') return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return new Intl.DateTimeFormat('da-DK', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(':', '.');
}

/** A date line and clock for the screen in the language being rendered. */
export const datoVis = (dato: string, now: Date): string => datoLinje(dato, now, sprogNu());
export const klokkeVis = (iso: string): string => klokke(iso, sprogNu());

/** "Maja og Du", "Henrik, Maja og Ella" (English: "Maja and you"); `du` marks the reader herself. Empty = ''. */
export function opremsning(poster: readonly { navn: string; du: boolean }[]): string {
  const T = husstandTekst();
  const n = poster.map((p, i) => (p.du ? T.du(i === 0) : p.navn));
  return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} ${T.og} ${n.at(-1)}`;
}

/** "I dag kl. 16.00–17.00" in the language being rendered; the time of a request or a booking. */
export const tidsrumVis = (dato: string, fra: string, til: string, now: Date): string => husstandTekst().tidsrum(datoVis(dato, now), klokkeVis(fra), klokkeVis(til));

/** "Maja og Du", "Henrik, Maja og Ella"; nobody named = the whole household. */
function hvemTekst(p: FaellesPost, v: HusstandVisning): string {
  const T = husstandTekst();
  const poster = p.hvem.map((id) => (id === v.person.id ? { navn: '', du: true } : { navn: v.medlemmer.find((m) => m.id === id)?.navn ?? '', du: false })).filter((x) => x.du || x.navn);
  return poster.length ? opremsning(poster) : T.alle;
}

function medlemRaekke(m: Medlem, v: HusstandVisning): Markup {
  const T = husstandTekst();
  const du = m.id === v.person.id;
  const note = [tekst().rolle[m.rolle], m.relation ?? ''].filter(Boolean).join(' · ');
  return medId(`medlem:${m.id}`, html`<div class="row medlem" data-medlem="${m.id}" data-medlem-rolle="${m.rolle}" data-element="${T.husstandenElement(m.navn)}">
    <span class="row-main"><span class="row-title">${m.navn}${du ? html` <span class="chip chip-muted">${T.du(true)}</span>` : ''}</span><span class="row-note">${note}</span>${v.kanRette && !du ? medlemRet(m) : ''}</span>
    <span class="actions">${spoerg(T.husstandenElement(m.navn))}</span>
  </div>`);
}

/** KC-0154, the owner's tools on another member's line: her role, and removing her (red: it ends her access). */
function medlemRet(m: Medlem): Markup {
  const T = husstandTekst();
  const form = `rolle-${m.id}`;
  return html`<details class="medlem-ret" data-medlem-ret="${m.id}"><summary class="row-note">${T.ret}</summary>
    <form id="${form}" class="stack nyt-form" method="post" autocomplete="off">
      <input type="hidden" name="id" value="${m.id}">
      <label class="field"><span class="row-note">${T.rolle}</span><select name="rolle">${ROLLER.map((r) => html`<option value="${r}"${r === m.rolle ? html` selected` : ''}>${tekst().rolle[r]}</option>`)}</select></label>
    </form>
    ${handlinger(undefined, [
      knap({ label: T.gemRolle, attrs: { 'data-aktion': 'rolle', 'data-form': form, 'data-status': T.statusGemmer } }),
      knap({ label: T.fjernFraHusstanden, slags: 'graense', attrs: { 'data-aktion': 'fjern-medlem', 'data-arg': JSON.stringify({ id: m.id }), 'data-confirm': T.fjernBekraeft(m.navn), 'data-status': T.statusFjerner } }),
    ])}
  </details>`;
}

function dagRaekke(d: FaellesDag, v: HusstandVisning): Markup {
  const T = husstandTekst();
  const label = datoVis(d.dato, v.now);
  return medId(`husstand-uge:${d.dato}`, html`<div class="row faelles-dag" data-element="${T.faellesElement(label)}" data-datazone="husstand">
    <span class="row-main">
      <span class="row-title">${label}</span>
      <span class="uge-aftaler">${d.poster.map((p) => {
        const tid = p.heldag ? T.heleDagen : `${klokkeVis(p.start)}${p.slut && klokkeVis(p.slut) ? `–${klokkeVis(p.slut)}` : ''}`;
        return html`<span class="uge-aftale" data-post-kilde="${p.kilde}" data-uge-hvem="${p.hvem.join(' ') || 'alle'}"><span class="mono muted">${tid}</span> ${p.titel} <span class="mono muted">· ${hvemTekst(p, v)}</span>${p.institution ? html` <span class="mono muted" data-uge-institution>· ${p.institution}</span>` : ''}</span>`;
      })}</span>
    </span>
    <span class="actions">${spoerg(T.faellesElement(label))}</span>
  </div>`);
}

export function renderHusstand(v: HusstandVisning): Markup {
  const T = husstandTekst();
  const dage = v.uge.filter((d) => d.poster.length > 0);
  const antal = dage.reduce((n, d) => n + d.poster.length, 0);
  if (v.faelles === false) {
    return html`
  <header class="room-head">
    <div><h1>${T.rumNavn}</h1><p class="muted">${T.gaestIntro}</p></div>
  </header>
  ${v.forespoergsler ?? ''}`;
  }
  return html`
  <header class="room-head">
    <div><h1>${T.rumNavn}</h1><p class="muted">${T.ejerIntro}</p></div>
  </header>
  ${v.invitationer ?? ''}
  ${v.forespoergsler ?? ''}
  <section class="card card-list gruppe" data-blok="bunke" data-gruppe="${T.faellesUge}" data-husstand-uge>
    <div class="card-head"><h2 class="eyebrow">${T.faellesUge}</h2><span class="muted mono">${antal}</span></div>
    ${dage.length ? dage.map((d) => dagRaekke(d, v)) : html`<p class="muted row">${T.intetFaelles}</p>`}
  </section>

  <section class="card card-list gruppe" data-blok="bunke" data-gruppe="${T.hvemErMed}">
    <div class="card-head"><h2 class="eyebrow">${T.hvemErMed}</h2><span class="muted mono">${v.medlemmer.length}</span></div>
    ${v.medlemmer.map((m) => medlemRaekke(m, v))}
  </section>`;
}

/** A person for whom there is no household universe: a plain 404 main that names nobody. */
export function renderIkkeHer(): Markup {
  const T = husstandTekst();
  return html`<header class="room-head"><div><a class="muted" href="/rum/hjem">${T.tilNu}</a><h1>${T.ikkeHerTitel}</h1><p class="muted">${T.ikkeHerTekst}</p></div></header>`;
}
