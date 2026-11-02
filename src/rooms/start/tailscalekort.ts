// KC-0161: the Tailscale card in Start — where the user is on the way to reaching Clawco from the phone, and the
// ONE next step. Pure: a TsSyn in, Markup out; every text through html``. Plain words (Danish or English, Start's table): Tailscale and "tailnet" are
// explained where they appear, no other technical word is used. The one button (klar) is a red button
// (data-kraever-ja: a human tap, bound to this port) that runs the one command the card shows first.
// Never Funnel (public exposure): the card never offers it and says so if Tailscale reports it on.
// Admin UI copy: Claude's call, marked for the product owner's review.

import { html, type Markup } from '../../shell/html.ts';
import { tilstandChip } from '../../shell/sprog.ts';
import { delKommando, type TsSyn, type TsTilstand } from '../../shell/tailscale.ts';
import { startTekst } from './tekster.ts';

/** What Tailscale's free plan covers (tailscale.com/pricing, checked 2026-11-02: "Up to 6 users"). */
export const FAMILIE_GRAENSE = 6;

export type TailscaleVisning = { syn: TsSyn; kanDele: boolean };

const HENT = 'https://tailscale.com/download';
const ADMIN_BRUGERE = 'https://login.tailscale.com/admin/users';

/** The chip's tone per state; its words are Start's table (startTekst().ts.chip). */
const TONE: Record<TsTilstand, Parameters<typeof tilstandChip>[0]> = {
  mangler: 'kraever', 'ikke-logget-ind': 'kraever', slukket: 'kraever', klar: 'kraever', delt: 'ordnet', laptop: 'rolig', ukendt: 'rolig',
};

/** Which states ask for something after the journey is Done (then Start only shows when a source is worth adding). */
export function visTailscaleKort(s: TsSyn, faerdig: boolean): boolean {
  if (!faerdig) return true;
  return s.offentlig === true || s.tilstand === 'mangler' || s.tilstand === 'ikke-logget-ind' || s.tilstand === 'slukket' || s.tilstand === 'klar';
}

function invitation(): Markup {
  const T = startTekst().ts;
  return html`<div class="tailscale-invitation" data-tailscale-invitation>
    <p class="row-title">${T.inviterTitel}</p>
    <p class="row-note">${T.inviterTekst(T.ord(FAMILIE_GRAENSE))}</p>
    <div class="actions"><a class="btn btn-ghost" href="${ADMIN_BRUGERE}" target="_blank" rel="noopener noreferrer">${T.aabenAdmin}</a></div>
  </div>`;
}

function indhold(v: TailscaleVisning): Markup {
  const s = v.syn;
  const T = startTekst().ts;
  switch (s.tilstand) {
    case 'mangler':
      return html`<p>${T.forklaring} ${T.ikkeInstalleret}</p>
        <p class="row-note" data-tailscale-naeste>${T.manglerNaeste}</p>
        <div class="actions"><a class="btn btn-primary" href="${HENT}" target="_blank" rel="noopener noreferrer">${T.hentTailscale}</a></div>`;
    case 'ikke-logget-ind':
      return html`<p>${T.ikkeLoggetInd} ${s.laptop ? T.udenLogin : ''}</p>
        <p class="row-note" data-tailscale-naeste>${T.ikkeLoggetIndNaeste}</p>`;
    case 'slukket':
      return html`<p>${T.slukket}</p>
        <p class="row-note" data-tailscale-naeste>${T.slukketNaeste}</p>`;
    case 'klar': {
      const kommando = delKommando(s.port);
      return html`<p>${T.klar} ${s.laptop ? T.vaagen : ''}</p>
        <p class="row-note" data-tailscale-naeste>${T.klarNaeste}</p>
        <pre class="mono" data-tailscale-kommando>${kommando}</pre>
        ${v.kanDele
          ? html`<div class="actions"><button type="button" class="btn btn-primary" data-aktion="tailscale-del" data-arg="${JSON.stringify({ port: s.port })}" data-kraever-ja data-status="${T.deler}">${T.delKnap}</button></div>`
          : html`<p class="row-note">${T.ejerenDeler}</p>`}`;
    }
    case 'delt': {
      if (s.offentlig) {
        return html`<p data-tailscale-offentlig>${T.offentlig}</p>
          <p class="row-note" data-tailscale-naeste>${T.lukFoer}<span class="mono">tailscale serve reset</span>${T.lukEfter}</p>`;
      }
      const adresse = s.adresse
        ? html`<p class="row-note" data-tailscale-naeste>${T.aabnAdresse}</p>
          <div class="row"><span class="row-main"><span class="row-title mono" data-tailscale-adresse>${s.adresse}</span></span><button type="button" class="btn btn-ghost" data-kopier="${s.adresse}">${T.kopier}</button></div>`
        : html`<p class="row-note" data-tailscale-naeste>${T.ingenAdresse}</p>`;
      return html`<p>${T.delt} ${s.laptop ? T.vaagen : ''}</p>
        ${adresse}
        ${s.laptop ? '' : invitation()}`;
    }
    case 'laptop':
      return html`<p>${T.laptop}</p>
        <p class="row-note" data-tailscale-naeste>${T.laptopFoer} ${T.forklaring} ${T.laptopEfter}</p>
        <div class="actions"><a class="btn btn-ghost" href="${HENT}" target="_blank" rel="noopener noreferrer">${T.hentTailscale}</a></div>`;
    case 'ukendt':
      return html`<p>${T.ukendt}</p>
        <p class="row-note" data-tailscale-naeste>${T.ukendtNaeste}</p>`;
  }
}

export function renderTailscaleKort(v: TailscaleVisning): Markup {
  const T = startTekst().ts;
  return html`<article class="card kort tailscale-kort" data-blok="kort" data-tailscale="${v.syn.tilstand}" data-element="${T.element}">
    <div class="kort-head">${tilstandChip(TONE[v.syn.tilstand], T.chip[v.syn.tilstand])}<span class="row-title">${T.titel}</span></div>
    ${indhold(v)}
  </article>`;
}
