// KC-0146 "Hvad Clawco ved om dig": everything Clawco keeps, on one page —
// sources, rules (KC-0142), the people register (read-only), what is stored —
// with "Hent alt" and "Slet alt" at the bottom, and the confirmation view Slet
// alt needs. Pure: state in, HTML out, every text through the escaper (§4 r9).
// Slet alt's form posts natively (the server answers with a redirect); a rule's
// Slå fra / Slå til igen goes through app.js, which fetches the human-tap token
// first (KC-0123: the rules file changes only with a fresh tap).

import path from 'node:path';
import { html, type Markup } from '../shell/html.ts';
import { findRoom } from '../rooms/registry.ts';
import { PRODUKT } from '../shell/navn.ts';
import type { ReglerLaest } from './lager.ts';
import type { Oprindelse, Regel } from './regler.ts';
import { TRIN } from './trin.ts';
import type { Opgoer } from './brugermappe.ts';
import { ugeLinje, ugeSoejler, ugeVisning, type Ugetal } from './dagstal.ts';

export type VidenKilde = { id: string; navn: string; slags: string; zone?: string; forbundet: boolean };
export type VidenPerson = { navn: string; relation: string; sti: string };
export type Viden = {
  kilder: VidenKilde[];
  /** The rules file and what it holds; null = no vault, so no rules. */
  regler: { fil: string; laest: ReglerLaest } | null;
  /** The people register (its folder and who is in it); null = none chosen. */
  personer: { dir: string; liste: VidenPerson[] } | null;
  gemt: Opgoer;
  /** KC-0147: the last eight weeks of "things that required you", oldest first, the last one this week; absent = not counted on this install. */
  ugetal?: Ugetal[];
  /** Just deleted: the page says so. */
  slettet?: boolean;
};

const OPRINDELSE_TEKST: Record<Oprindelse, string> = { ret: 'Fra en rettelse', 'ikke-relevant': 'Fra "Ikke relevant"', haand: 'Skrevet i hånden', import: 'Importeret' };

/** "512 B", "2,0 kB", "1,4 MB". */
export function stoerrelse(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

const flertal = (n: number, en: string, flere: string): string => `${n} ${n === 1 ? en : flere}`;

/** Stores in rum/ that are not rooms, by their plain name (store/aabnet.ts keeps when each room was opened). */
const LAGER_NAVN: Record<string, string> = { nav: 'Hvornår du åbnede rummene' };

function rumNavn(id: string): string {
  const u = /^univers-(.+)$/.exec(id);
  return u ? `Univers: ${u[1]}` : findRoom(id)?.navn ?? LAGER_NAVN[id] ?? id;
}

function kilderDel(v: Viden): Markup {
  const forbundne = v.kilder.filter((k) => k.forbundet);
  return html`<section class="card" data-viden-del="kilder"><h2 class="eyebrow">Kilder</h2>${forbundne.length
    ? html`<ul class="card-list">${forbundne.map((k) => html`<li class="row" data-viden-kilde="${k.id}"><span class="row-main"><span class="row-title">${k.navn}</span><span class="row-note">${k.slags}${k.zone ? ` · ${k.zone}` : ''}</span></span></li>`)}</ul>`
    : html`<p class="muted">Ingen kilder er koblet til.</p>`}</section>`;
}

function regelRaekke(r: Regel): Markup {
  // KC-0143: a rule for every source (`*`) is said in words, so a wide rule is never mistaken for a narrow one.
  const kilde = r.gaelder.kilde === '*' ? html`<span class="chip tilstand-kraever" data-regel-alt>gælder alt</span>` : html`${r.gaelder.kilde}`;
  const gaelder = r.gaelder.slags ? html`${kilde} / ${r.gaelder.slags}` : kilde;
  const pause = r.status === 'pause';
  const knap = pause
    ? html`<form method="post" action="/api/tillid/regler/${r.id}/aktiv" class="viden-form" data-regel-form="${r.id}:aktiv"><button type="submit" class="btn btn-ghost" data-regel-skift="aktiv">Slå til igen</button></form>`
    : html`<form method="post" action="/api/tillid/regler/${r.id}/pause" class="viden-form" data-regel-form="${r.id}:pause"><button type="submit" class="btn btn-ghost" data-regel-skift="pause">Slå fra</button></form>`;
  return html`<li class="row" data-regel="${r.id}" data-regel-status="${r.status}" data-regel-trin="${r.trin}"><span class="row-main"><span class="row-title"><span class="mono">${r.id}</span> · ${r.titel}</span><span class="row-note">Trin ${r.trin} · Hermes må ${TRIN.find((t) => t.trin === r.trin)?.navn ?? ''} · ${gaelder}</span><span class="row-note">${OPRINDELSE_TEKST[r.oprindelse.art]} ${r.oprindelse.dato}${pause ? ' · på pause' : ''}</span></span>${knap}</li>`;
}

function reglerDel(v: Viden): Markup {
  if (!v.regler) return html`<section class="card" data-viden-del="regler"><h2 class="eyebrow">Regler</h2><p class="muted">Ingen regler endnu.</p></section>`;
  const { fil, laest } = v.regler;
  const sti = html`<p class="row-note">Filen: <span class="mono" data-regler-fil>${fil}</span></p>`;
  const aendret = laest.tilstand !== 'mangler' && laest.aendretUdenfor ? html`<p class="row-note" data-regler-aendret>Filen er ændret uden for ${PRODUKT}. Det er helt i orden; reglerne læses, som de står i filen nu.</p>` : '';
  let indhold: Markup;
  if (laest.tilstand === 'mangler') indhold = html`<p class="muted">Ingen regler endnu.</p>`;
  else if (laest.tilstand === 'ulaeselig') indhold = html`<p class="muted" data-regler="ulaeselig">Filen kan ikke læses (${laest.hvorfor}). Indtil den er rettet, må Hermes kun se og foreslå.</p>`;
  else {
    const { regler, ugyldige } = laest.saet;
    indhold = html`${regler.length ? html`<ul class="card-list">${regler.map(regelRaekke)}</ul>` : html`<p class="muted">Ingen regler endnu.</p>`}${ugyldige.length ? html`<p class="row-note">${flertal(ugyldige.length, 'afsnit', 'afsnit')} i filen er skrevet forkert og følges ikke: ${ugyldige.map((u) => u.overskrift).join(', ')}.</p>` : ''}`;
  }
  return html`<section class="card" data-viden-del="regler"><h2 class="eyebrow">Regler</h2>${indhold}${aendret}${sti}</section>`;
}

function personerDel(v: Viden): Markup {
  const p = v.personer;
  const liste = p && p.liste.length
    ? html`<ul class="card-list">${p.liste.map((x) => {
      const fil = path.join(p.dir, ...x.sti.split('/'));
      return html`<li class="row" data-viden-person><span class="row-main"><a class="row-title" href="obsidian://open?path=${encodeURIComponent(fil)}">${x.navn}</a><span class="row-note">${x.relation} · <span class="mono">${x.sti}</span></span></span></li>`;
    })}</ul><p class="row-note">Personerne er dine egne noter i <span class="mono">${p.dir}</span>. ${PRODUKT} læser dem kun.</p>`
    : html`<p class="muted">${p ? 'Personregisteret er tomt.' : 'Der er ikke valgt noget personregister.'}</p>`;
  return html`<section class="card" data-viden-del="personer"><h2 class="eyebrow">Personer</h2>${liste}</section>`;
}

/** KC-0147: the week's number and eight weeks of bars. On a phone only the line shows (CSS hides the figure). */
function ugetalDel(v: Viden): Markup {
  if (!v.ugetal) return html``;
  const visning = ugeVisning(v.ugetal, 'denne');
  const indhold = visning
    ? html`${ugeLinje(visning, { hjaelp: true })}${ugeSoejler(v.ugetal)}`
    : html`<p class="muted">Tallet kommer, når ${PRODUKT} har talt en dag.</p>`;
  return html`<section class="card" data-viden-del="ugetal"><h2 class="eyebrow">Ting der krævede dig</h2>${indhold}</section>`;
}

function gemtDel(v: Viden): Markup {
  const g = v.gemt;
  const tom = !g.rum.length && !g.clawco.length && !g.andre && !g.noegler;
  if (tom) return html`<section class="card" data-viden-del="gemt"><h2 class="eyebrow">Gemt</h2><p class="muted">${PRODUKT} har ikke gemt noget.</p></section>`;
  return html`<section class="card" data-viden-del="gemt"><h2 class="eyebrow">Gemt</h2>
    ${g.rum.length ? html`<ul class="card-list">${g.rum.map((r) => html`<li class="row" data-viden-rum="${r.id}"><span class="row-main"><span class="row-title">${rumNavn(r.id)}</span><span class="row-note">${flertal(r.log, 'linje', 'linjer')} i loggen · ${flertal(r.chat, 'besked', 'beskeder')} · ${stoerrelse(r.bytes)}</span></span></li>`)}</ul>` : ''}
    ${g.clawco.length ? html`<p class="row-note">${flertal(g.clawco.length, 'fil', 'filer')} i Clawco-mappen i din vault: ${g.clawco.map((s, i) => html`${i ? ', ' : ''}<span class="mono">${s.replace(/^vault\/Clawco\//, '')}</span>`)}.</p>` : ''}
    ${g.andre ? html`<p class="row-note">${flertal(g.andre, 'anden fil', 'andre filer')}: forbindelser, indstillinger og hvad ${PRODUKT} har gjort.</p>` : ''}
    ${g.noegler ? html`<p class="row-note">${flertal(g.noegler, 'fil', 'filer')} med nøgler og logins til dine kilder. De kommer ikke med i Hent alt.</p>` : ''}
    <p class="row-note">I alt ${stoerrelse(g.bytes)}.</p></section>`;
}

export function renderViden(v: Viden): Markup {
  return html`<div class="viden" data-viden>
<header class="room-head"><div><h1>Hvad ${PRODUKT} ved om dig</h1><p class="muted">Alt, hvad ${PRODUKT} har gemt om dig, samlet ét sted.</p></div></header>
${v.slettet ? html`<div class="card" data-slettet role="status"><strong>Alt er slettet</strong><p class="row-note">${PRODUKT} er tom og starter forfra. Din vault og dine egne noter er der stadig.</p></div>` : ''}
${kilderDel(v)}
${reglerDel(v)}
${personerDel(v)}
${ugetalDel(v)}
${/* "Skjult i denne uge" (count + the Sunday sample) comes with KC-0145; until it is built the section is gone, not greyed (KC-0052). */ ''}
${gemtDel(v)}
<div class="actions viden-knapper"><a class="btn" href="/api/tillid/eksport" download data-viden-hent>Hent alt</a><a class="btn btn-graense" href="/viden/slet-alt" data-viden-slet>Slet alt</a></div>
</div>`;
}

/** The confirmation Slet alt needs: exactly what goes, Hent alt først, and the typed word on a red button. */
export function renderSletAlt(v: Viden, o: { fejl?: string } = {}): Markup {
  const g = v.gemt;
  const fil = v.regler && v.regler.laest.tilstand !== 'mangler' ? v.regler.fil : '';
  const linjer: Markup[] = [
    ...g.rum.map((r) => html`<li>${rumNavn(r.id)}: ${flertal(r.log, 'linje', 'linjer')} i loggen og ${flertal(r.chat, 'besked', 'beskeder')}</li>`),
    ...(fil ? [html`<li>Reglerne: <span class="mono">${fil}</span></li>`] : []),
    ...(g.clawco.length ? [html`<li>${flertal(g.clawco.length, 'fil', 'filer')} i Clawco-mappen i din vault</li>`] : []),
    ...(g.andre ? [html`<li>${flertal(g.andre, 'anden fil', 'andre filer')}: forbindelser, indstillinger og hvad ${PRODUKT} har gjort</li>`] : []),
    ...(g.noegler ? [html`<li>${flertal(g.noegler, 'fil', 'filer')} med nøgler og logins til dine kilder</li>`] : []),
  ];
  return html`<div class="viden" data-viden>
<header class="room-head"><div><a class="muted" href="/viden">Tilbage</a><h1>Slet alt</h1><p class="muted">Det kan ikke fortrydes.</p></div></header>
<section class="card" data-slet-alt="bekraeft">
  <h2 class="eyebrow">Det bliver slettet</h2>
  ${linjer.length ? html`<ul class="viden-liste">${linjer}</ul>` : html`<p class="muted">${PRODUKT} har ikke gemt noget.</p>`}
  <p class="row-note">Bliver liggende: din vault og dine egne noter, også personerne i personregisteret.</p>
  <div class="actions"><a class="btn" href="/api/tillid/eksport" download data-viden-hent>Hent alt først</a></div>
  <form method="post" action="/api/tillid/slet-alt" class="viden-form" data-slet-alt="form">
    ${o.fejl ? html`<p class="row-note" role="alert" data-slet-alt-fejl>${o.fejl}</p>` : ''}
    <label class="field"><span class="row-note">Skriv SLET for at bekræfte</span><input name="bekraeft" type="text" required autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="10" data-uden-stemme></label>
    <div class="actions"><button type="submit" class="btn btn-graense">Slet alt</button></div>
  </form>
</section>
</div>`;
}
