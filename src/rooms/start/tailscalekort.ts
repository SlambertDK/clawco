// KC-0161: the Tailscale card in Start — where the user is on the way to reaching Clawco from the phone, and the
// ONE next step. Pure: a TsSyn in, Markup out; every text through html``. Plain Danish: Tailscale and "tailnet" are
// explained where they appear, no other technical word is used. The one button (klar) is a red button
// (data-kraever-ja: a human tap, bound to this port) that runs the one command the card shows first.
// Never Funnel (public exposure): the card never offers it and says so if Tailscale reports it on.
// Admin UI copy: Claude's call, marked for the product owner's review.

import { html, type Markup } from '../../shell/html.ts';
import { tilstandChip } from '../../shell/sprog.ts';
import { delKommando, type TsSyn, type TsTilstand } from '../../shell/tailscale.ts';

/** What Tailscale's free plan covers (tailscale.com/pricing, checked 2026-11-02: "Up to 6 users"). */
export const FAMILIE_GRAENSE = 6;

export type TailscaleVisning = { syn: TsSyn; kanDele: boolean };

const HENT = 'https://tailscale.com/download';
const ADMIN_BRUGERE = 'https://login.tailscale.com/admin/users';

const CHIP: Record<TsTilstand, [Parameters<typeof tilstandChip>[0], string]> = {
  mangler: ['kraever', 'Mangler'],
  'ikke-logget-ind': ['kraever', 'Log ind'],
  slukket: ['kraever', 'Slukket'],
  klar: ['kraever', 'Klar til deling'],
  delt: ['ordnet', 'Delt'],
  laptop: ['rolig', 'Kun denne maskine'],
  ukendt: ['rolig', 'Ukendt'],
};

/** Which states ask for something after the journey is Done (then Start only shows when a source is worth adding). */
export function visTailscaleKort(s: TsSyn, faerdig: boolean): boolean {
  if (!faerdig) return true;
  return s.offentlig === true || s.tilstand === 'mangler' || s.tilstand === 'ikke-logget-ind' || s.tilstand === 'slukket' || s.tilstand === 'klar';
}

const FORKLARING = html`Tailscale er et gratis program, der giver dine egne enheder et privat net sammen (kaldet et tailnet), så ingen andre kan komme ind.`;
const VAAGEN = html`Husk: kun når laptoppen er vågen, kan telefonen nå Clawco.`;
const ORD: Record<number, string> = { 3: 'tre', 5: 'fem', 6: 'seks', 10: 'ti' };

function invitation(): Markup {
  return html`<div class="tailscale-invitation" data-tailscale-invitation>
    <p class="row-title">Invitér familien</p>
    <p class="row-note">Hver person installerer Tailscale, tager imod din invitation og åbner så den samme adresse. Du inviterer i Tailscales egen administration; det er gratis op til ${ORD[FAMILIE_GRAENSE] ?? String(FAMILIE_GRAENSE)} personer.</p>
    <div class="actions"><a class="btn btn-ghost" href="${ADMIN_BRUGERE}" target="_blank" rel="noopener noreferrer">Åbn Tailscales administration</a></div>
  </div>`;
}

function indhold(v: TailscaleVisning): Markup {
  const s = v.syn;
  switch (s.tilstand) {
    case 'mangler':
      return html`<p>${FORKLARING} Det er ikke installeret på den her maskine.</p>
        <p class="row-note" data-tailscale-naeste>Hent Tailscale, installér det, og kom tilbage hertil.</p>
        <div class="actions"><a class="btn btn-primary" href="${HENT}" target="_blank" rel="noopener noreferrer">Hent Tailscale</a></div>`;
    case 'ikke-logget-ind':
      return html`<p>Tailscale er installeret, men du er ikke logget ind. ${s.laptop ? html`Uden login kan telefonen ikke nå Clawco.` : ''}</p>
        <p class="row-note" data-tailscale-naeste>Åbn Tailscale, og log ind (det er gratis). Kom så tilbage hertil.</p>`;
    case 'slukket':
      return html`<p>Tailscale er installeret, men slukket lige nu, så telefonen kan ikke nå Clawco.</p>
        <p class="row-note" data-tailscale-naeste>Tænd Tailscale, og kom så tilbage hertil.</p>`;
    case 'klar': {
      const kommando = delKommando(s.port);
      return html`<p>Du er logget ind på Tailscale. Næste skridt er at dele Clawco på dit tailnet, det vil sige et privat net kun for dine egne enheder: så kan dine egne enheder, og ingen andre, åbne Clawco. ${s.laptop ? VAAGEN : ''}</p>
        <p class="row-note" data-tailscale-naeste>Knappen kører præcis denne ene tekstlinje for dig på den her maskine. Den åbner ikke for internettet.</p>
        <pre class="mono" data-tailscale-kommando>${kommando}</pre>
        ${v.kanDele
          ? html`<div class="actions"><button type="button" class="btn btn-primary" data-aktion="tailscale-del" data-arg="${JSON.stringify({ port: s.port })}" data-kraever-ja data-status="deler Clawco">Del Clawco på dit tailnet</button></div>`
          : html`<p class="row-note">Ejeren deler Clawco.</p>`}`;
    }
    case 'delt': {
      if (s.offentlig) {
        return html`<p data-tailscale-offentlig>Pas på: Tailscale har åbnet Clawco for hele internettet, ikke kun for dit private net. Det er ikke meningen.</p>
          <p class="row-note" data-tailscale-naeste>Luk det igen: skriv <span class="mono">tailscale serve reset</span> i Terminal på den her maskine (det fjerner alle delinger), og del så Clawco igen her.</p>`;
      }
      const adresse = s.adresse
        ? html`<p class="row-note" data-tailscale-naeste>Åbn denne adresse på telefonen, når Tailscale er tændt dér:</p>
          <div class="row"><span class="row-main"><span class="row-title mono" data-tailscale-adresse>${s.adresse}</span></span><button type="button" class="btn btn-ghost" data-kopier="${s.adresse}">Kopiér</button></div>`
        : html`<p class="row-note" data-tailscale-naeste>Clawco kan ikke læse adressen herfra. Åbn Tailscale, og se, hvad den her maskine hedder.</p>`;
      return html`<p>Clawco er delt på dit tailnet, det vil sige et privat net kun for dine egne enheder. ${s.laptop ? VAAGEN : ''}</p>
        ${adresse}
        ${s.laptop ? '' : invitation()}`;
    }
    case 'laptop':
      return html`<p>Clawco kører kun på den her bærbare. Uden Tailscale kan telefonen ikke nå Clawco; med Tailscale kan den, men kun når den bærbare er vågen.</p>
        <p class="row-note" data-tailscale-naeste>Vil du bruge telefonen alligevel? ${FORKLARING} Hent det her.</p>
        <div class="actions"><a class="btn btn-ghost" href="${HENT}" target="_blank" rel="noopener noreferrer">Hent Tailscale</a></div>`;
    case 'ukendt':
      return html`<p>Clawco kan ikke se, hvordan Tailscale har det lige nu, og vil ikke gætte.</p>
        <p class="row-note" data-tailscale-naeste>Åbn Tailscale selv, og se, om den er tændt og logget ind. Åbn så Start igen.</p>`;
  }
}

export function renderTailscaleKort(v: TailscaleVisning): Markup {
  const [tone, tekst] = CHIP[v.syn.tilstand];
  return html`<article class="card kort tailscale-kort" data-blok="kort" data-tailscale="${v.syn.tilstand}" data-element="Tailscale: nå Clawco fra telefonen">
    <div class="kort-head">${tilstandChip(tone, tekst)}<span class="row-title">Nå Clawco fra telefonen</span></div>
    ${indhold(v)}
  </article>`;
}
