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
import { tekst as skalTekst } from '../shell/tekster.ts';
import type { ReglerLaest } from './lager.ts';
import type { Oprindelse, Regel } from './regler.ts';
import { tillidTekst, flertal } from './tekster.ts';
import { trinNavn } from './trin.ts';
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

const oprindelse = (art: Oprindelse): string => tillidTekst().oprindelse[art] ?? art;

/** "512 B", "2,0 kB", "1,4 MB" (a decimal point in English). */
export function stoerrelse(bytes: number): string {
  const komma = tillidTekst().decimal;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', komma)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', komma)} MB`;
}

/** The name of a room or of a store that is not one, as the page names it (store/aabnet.ts keeps when each room was opened). */
function rumNavn(id: string): string {
  const T = tillidTekst();
  const u = /^univers-(.+)$/.exec(id);
  if (u) return T.univers(u[1] as string);
  const rum = findRoom(id);
  return (rum ? skalTekst().rum[rum.id] ?? rum.navn : undefined) ?? T.lagerNavn[id] ?? id;
}

function kilderDel(v: Viden): Markup {
  const T = tillidTekst();
  const forbundne = v.kilder.filter((k) => k.forbundet);
  return html`<section class="card" data-viden-del="kilder"><h2 class="eyebrow">${T.kilder}</h2>${forbundne.length
    ? html`<ul class="card-list">${forbundne.map((k) => html`<li class="row" data-viden-kilde="${k.id}"><span class="row-main"><span class="row-title">${k.navn}</span><span class="row-note">${T.slags[k.slags] ?? k.slags}${k.zone ? ` · ${T.zone[k.zone] ?? k.zone}` : ''}</span></span></li>`)}</ul>`
    : html`<p class="muted">${T.ingenKilder}</p>`}</section>`;
}

function regelRaekke(r: Regel): Markup {
  const T = tillidTekst();
  // KC-0143: a rule for every source (`*`) is said in words, so a wide rule is never mistaken for a narrow one.
  const kilde = r.gaelder.kilde === '*' ? html`<span class="chip tilstand-kraever" data-regel-alt>${T.gaelderAlt}</span>` : html`${r.gaelder.kilde}`;
  const gaelder = r.gaelder.slags ? html`${kilde} / ${r.gaelder.slags}` : kilde;
  const pause = r.status === 'pause';
  const knap = pause
    ? html`<form method="post" action="/api/tillid/regler/${r.id}/aktiv" class="viden-form" data-regel-form="${r.id}:aktiv"><button type="submit" class="btn btn-ghost" data-regel-skift="aktiv">${T.slaaTilIgen}</button></form>`
    : html`<form method="post" action="/api/tillid/regler/${r.id}/pause" class="viden-form" data-regel-form="${r.id}:pause"><button type="submit" class="btn btn-ghost" data-regel-skift="pause">${T.slaaFra}</button></form>`;
  return html`<li class="row" data-regel="${r.id}" data-regel-status="${r.status}" data-regel-trin="${r.trin}"><span class="row-main"><span class="row-title"><span class="mono">${r.id}</span> · ${r.titel}</span><span class="row-note">${T.trinLinje(r.trin, trinNavn(r.trin))}${gaelder}</span><span class="row-note">${oprindelse(r.oprindelse.art)} ${r.oprindelse.dato}${pause ? T.paaPause : ''}</span></span>${knap}</li>`;
}

function reglerDel(v: Viden): Markup {
  const T = tillidTekst();
  if (!v.regler) return html`<section class="card" data-viden-del="regler"><h2 class="eyebrow">${T.regler}</h2><p class="muted">${T.ingenRegler}</p></section>`;
  const { fil, laest } = v.regler;
  const sti = html`<p class="row-note">${T.filen}<span class="mono" data-regler-fil>${fil}</span></p>`;
  const aendret = laest.tilstand !== 'mangler' && laest.aendretUdenfor ? html`<p class="row-note" data-regler-aendret>${T.filenAendret(PRODUKT)}</p>` : '';
  let indhold: Markup;
  if (laest.tilstand === 'mangler') indhold = html`<p class="muted">${T.ingenRegler}</p>`;
  else if (laest.tilstand === 'ulaeselig') indhold = html`<p class="muted" data-regler="ulaeselig">${T.filenUlaeselig(T.ulaeseligHvorfor[laest.hvorfor] ?? laest.hvorfor)}</p>`;
  else {
    const { regler, ugyldige } = laest.saet;
    indhold = html`${regler.length ? html`<ul class="card-list">${regler.map(regelRaekke)}</ul>` : html`<p class="muted">${T.ingenRegler}</p>`}${ugyldige.length ? html`<p class="row-note">${T.afsnitForkerte(flertal(ugyldige.length, 'afsnit'), ugyldige.map((u) => u.overskrift).join(', '))}</p>` : ''}`;
  }
  return html`<section class="card" data-viden-del="regler"><h2 class="eyebrow">${T.regler}</h2>${indhold}${aendret}${sti}</section>`;
}

function personerDel(v: Viden): Markup {
  const T = tillidTekst();
  const p = v.personer;
  const liste = p && p.liste.length
    ? html`<ul class="card-list">${p.liste.map((x) => {
      const fil = path.join(p.dir, ...x.sti.split('/'));
      return html`<li class="row" data-viden-person><span class="row-main"><a class="row-title" href="obsidian://open?path=${encodeURIComponent(fil)}">${x.navn}</a><span class="row-note">${x.relation} · <span class="mono">${x.sti}</span></span></span></li>`;
    })}</ul><p class="row-note">${T.personerNoter}<span class="mono">${p.dir}</span>${T.personerLaeser(PRODUKT)}</p>`
    : html`<p class="muted">${p ? T.registerTomt : T.ingetRegister}</p>`;
  return html`<section class="card" data-viden-del="personer"><h2 class="eyebrow">${T.personer}</h2>${liste}</section>`;
}

/** KC-0147: the week's number and eight weeks of bars. On a phone only the line shows (CSS hides the figure). */
function ugetalDel(v: Viden): Markup {
  if (!v.ugetal) return html``;
  const T = tillidTekst();
  const visning = ugeVisning(v.ugetal, 'denne');
  const indhold = visning
    ? html`${ugeLinje(visning, { hjaelp: true })}${ugeSoejler(v.ugetal)}`
    : html`<p class="muted">${T.ugetalKommer(PRODUKT)}</p>`;
  return html`<section class="card" data-viden-del="ugetal"><h2 class="eyebrow">${T.ugetal}</h2>${indhold}</section>`;
}

function gemtDel(v: Viden): Markup {
  const T = tillidTekst();
  const g = v.gemt;
  const tom = !g.rum.length && !g.clawco.length && !g.andre && !g.noegler;
  if (tom) return html`<section class="card" data-viden-del="gemt"><h2 class="eyebrow">${T.gemt}</h2><p class="muted">${T.ingetGemt(PRODUKT)}</p></section>`;
  return html`<section class="card" data-viden-del="gemt"><h2 class="eyebrow">${T.gemt}</h2>
    ${g.rum.length ? html`<ul class="card-list">${g.rum.map((r) => html`<li class="row" data-viden-rum="${r.id}"><span class="row-main"><span class="row-title">${rumNavn(r.id)}</span><span class="row-note">${T.iLoggen(flertal(r.log, 'linje'), flertal(r.chat, 'besked'), stoerrelse(r.bytes))}</span></span></li>`)}</ul>` : ''}
    ${g.clawco.length ? html`<p class="row-note">${T.filerIClawcoFoer(flertal(g.clawco.length, 'fil'))}${g.clawco.map((s, i) => html`${i ? ', ' : ''}<span class="mono">${s.replace(/^vault\/Clawco\//, '')}</span>`)}.</p>` : ''}
    ${g.andre ? html`<p class="row-note">${T.andreFiler(flertal(g.andre, 'andenFil'), PRODUKT)}</p>` : ''}
    ${g.noegler ? html`<p class="row-note">${T.noeglerFiler(flertal(g.noegler, 'fil'))}</p>` : ''}
    <p class="row-note">${T.ialt(stoerrelse(g.bytes))}</p></section>`;
}

export function renderViden(v: Viden): Markup {
  const T = tillidTekst();
  return html`<div class="viden" data-viden>
<header class="room-head"><div><h1>${T.overskrift(PRODUKT)}</h1><p class="muted">${T.underoverskrift(PRODUKT)}</p></div></header>
${v.slettet ? html`<div class="card" data-slettet role="status"><strong>${T.alleSlettet}</strong><p class="row-note">${T.tomOgForfra(PRODUKT)}</p></div>` : ''}
${kilderDel(v)}
${reglerDel(v)}
${personerDel(v)}
${ugetalDel(v)}
${/* "Skjult i denne uge" (count + the Sunday sample) comes with KC-0145; until it is built the section is gone, not greyed (KC-0052). */ ''}
${gemtDel(v)}
<div class="actions viden-knapper"><a class="btn" href="/api/tillid/eksport" download data-viden-hent>${T.hentAlt}</a><a class="btn btn-graense" href="/viden/slet-alt" data-viden-slet>${T.sletAlt}</a></div>
</div>`;
}

/** The confirmation Slet alt needs: exactly what goes, Hent alt først, and the typed word on a red button. */
export function renderSletAlt(v: Viden, o: { fejl?: string } = {}): Markup {
  const T = tillidTekst();
  const g = v.gemt;
  const fil = v.regler && v.regler.laest.tilstand !== 'mangler' ? v.regler.fil : '';
  const linjer: Markup[] = [
    ...g.rum.map((r) => html`<li>${T.rumLinje(rumNavn(r.id), flertal(r.log, 'linje'), flertal(r.chat, 'besked'))}</li>`),
    ...(fil ? [html`<li>${T.reglerneFoer}<span class="mono">${fil}</span></li>`] : []),
    ...(g.clawco.length ? [html`<li>${T.filerIClawco(flertal(g.clawco.length, 'fil'))}</li>`] : []),
    ...(g.andre ? [html`<li>${T.andreFilerKort(flertal(g.andre, 'andenFil'), PRODUKT)}</li>`] : []),
    ...(g.noegler ? [html`<li>${T.noeglerFilerKort(flertal(g.noegler, 'fil'))}</li>`] : []),
  ];
  return html`<div class="viden" data-viden>
<header class="room-head"><div><a class="muted" href="/viden">${T.tilbage}</a><h1>${T.sletAlt}</h1><p class="muted">${T.kanIkkeFortrydes}</p></div></header>
<section class="card" data-slet-alt="bekraeft">
  <h2 class="eyebrow">${T.detBlivSlettet}</h2>
  ${linjer.length ? html`<ul class="viden-liste">${linjer}</ul>` : html`<p class="muted">${T.ingetGemt(PRODUKT)}</p>`}
  <p class="row-note">${T.blivLiggende}</p>
  <div class="actions"><a class="btn" href="/api/tillid/eksport" download data-viden-hent>${T.hentAltFoerst}</a></div>
  <form method="post" action="/api/tillid/slet-alt" class="viden-form" data-slet-alt="form">
    ${o.fejl ? html`<p class="row-note" role="alert" data-slet-alt-fejl>${o.fejl}</p>` : ''}
    <label class="field"><span class="row-note">${T.skrivOrd}</span><input name="bekraeft" type="text" required autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="10" data-uden-stemme></label>
    <div class="actions"><button type="submit" class="btn btn-graense">${T.sletAlt}</button></div>
  </form>
</section>
</div>`;
}
