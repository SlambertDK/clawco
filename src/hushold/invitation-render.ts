// The owner's invitations in Husstanden (KC-0154): one card per pending
// invitation, and the page with the two ways to invite. Pure: data in, Markup
// out; every name and text through html`` (§4 r9). An own entry shows the steps
// the owner takes in Tailscale's admin, one open at a time (the same accordion as
// Start's connector steps) — Clawco never does them. A phone invitation shows
// the exact first message and the red Send (a message to another person,
// KC-0067), which needs a yes for exactly that text. No login or number is
// shown back: the screen never carries them (render.ts).

import { html, type Markup } from '../shell/html.ts';
import { handlinger, knap } from '../shell/sprog.ts';
import { tekst } from '../shell/tekster.ts';
import { husstandTekst } from './tekster.ts';
import type { Person } from '../identitet/husstand.ts';
import { KANAL_NAVN, KANALER } from './kanal.ts';
import { INVITER_ROLLER, invitationAf, MAX_PERSONER, vurderInvitation } from './invitation.ts';
import { klokkeVis } from './render.ts';
import type { Medlem } from './schema.ts';

/** `kanSende`: the app has a channel client (else the card says so instead of offering a Send that answers 503). */
export type InvitationVisning = { medlemmer: readonly Medlem[]; person: Person; kanSende: boolean };

function trin(id: string, navn: string): Markup {
  const T = husstandTekst();
  const t = T.trin(navn);
  return html`<div class="stack kilde-trin" data-invitation-trin="${id}">${t.map((tekst, i) => html`<details class="kilde-trin-et" name="invitation-${id}"${i === 0 ? html` open` : ''}><summary class="row-note">${T.trinAf(i + 1, t.length)}</summary><p>${tekst}</p></details>`)}</div>`;
}

function egenKort(m: Medlem): Markup {
  const T = husstandTekst();
  return html`<article class="card kort invitation" data-invitation="egen" data-invitation-medlem="${m.id}" data-element="${T.invitationElement(m.navn)}" data-datazone="husstand">
    <div class="kort-head"><span class="row-note">${T.egenIndgangRolle(tekst().rolle[m.rolle])}</span></div>
    <span class="row-title">${T.erInviteret(m.navn)}</span>
    <p class="row-note">${T.clawcoKender(m.navn)}</p>
    ${trin(m.id, m.navn)}
  </article>`;
}

function telefonKort(m: Medlem, v: InvitationVisning): Markup {
  const T = husstandTekst();
  const k = m.kanal!;
  const kanalNavn = KANAL_NAVN[k.kanal];
  const u = vurderInvitation(v.medlemmer, m.id, v.person);
  const krop = k.inviteret
    ? html`<p class="row-note" data-invitation-sendt>${T.inviterSendt(kanalNavn, klokkeVis(k.inviteret))}</p>`
    : u.ok
      ? v.kanSende
        ? html`<p class="row-note">${T.detFaar(m.navn, kanalNavn)}</p>
          <p class="row-note kanal-tekst" data-invitation-tekst="${m.id}">${u.tekst}</p>
          ${handlinger(undefined, [knap({ label: T.sendTil(m.navn, kanalNavn), slags: 'graense', attrs: { 'data-invitation-send': m.id, 'data-invitation-ja': u.jaId, 'data-status': T.statusSender } })])}`
        : html`<p class="row-note" data-invitation-ikke>${T.kanIkkeSendeHerfra}</p>`
      : html`<p class="row-note" data-invitation-ikke>${u.hvorfor}</p>`;
  return html`<article class="card kort invitation" data-invitation="telefon" data-invitation-medlem="${m.id}" data-element="${T.invitationElement(m.navn)}" data-datazone="husstand">
    <div class="kort-head"><span class="row-note">${T.kunTelefonRolle(tekst().rolle[m.rolle])}</span></div>
    <span class="row-title">${T.faarForespoergslerSomBeskeder(m.navn)}</span>
    ${krop}
  </article>`;
}

/** The owner's pending invitations and the way to invite one more (while there is room). Empty when there is nothing. */
export function invitationSektion(v: InvitationVisning): Markup {
  const T = husstandTekst();
  const ventende = v.medlemmer.filter((m) => m.id !== v.person.id && invitationAf(m) !== null);
  const plads = v.medlemmer.length < MAX_PERSONER;
  if (!ventende.length && !plads) return html``;
  return html`<div class="stack gruppe" data-gruppe="${T.invitationer}">
    <div class="card-head"><h2 class="eyebrow">${T.invitationer}</h2><span class="muted mono">${ventende.length}</span></div>
    ${ventende.map((m) => (invitationAf(m) === 'egen' ? egenKort(m) : telefonKort(m, v)))}
    ${plads ? html`<p class="row"><a class="btn btn-ghost" href="/rum/husstand/inviter" data-invitation-ny>${T.inviterEnTilHusstanden}</a></p>` : ''}
  </div>`;
}

const rolleValg = (navn: string): Markup =>
  html`<select name="${navn}">${INVITER_ROLLER.map((r) => html`<option value="${r}"${r === 'medlem' ? html` selected` : ''}>${tekst().rolle[r]}</option>`)}</select>`;

/**
 * The page with the two ways to invite. `enebruger`: no household file yet — the owner names himself too, and the
 * household is written with him as its owner by the login Tailscale gives Clawco.
 */
export function renderInviter(v: { enebruger: boolean; plads: boolean }): Markup {
  const T = husstandTekst();
  const mitNavn = v.enebruger ? html`<label class="field"><span class="row-note">${T.ditNavn}</span><input name="mitNavn" type="text" maxlength="80" required></label>` : '';
  const hoved = html`<header class="room-head"><div><a class="muted" href="/rum/hjem">${T.tilNu}</a><h1>${T.inviterEnTilHusstanden}</h1><p class="muted">${T.hunSerDetIDeler}</p></div></header>`;
  if (!v.plads) return html`${hoved}<p class="muted row">${T.hoejstPersoner(MAX_PERSONER)}</p>`;
  return html`${hoved}
  <section class="card stack" data-invitation-form="egen">
    <h2 class="eyebrow">${T.egenIndgang}</h2>
    <p class="row-note">${T.egenIndgangTekst}</p>
    <form id="inviter-egen" class="stack nyt-form" method="post" autocomplete="off">
      <input type="hidden" name="slags" value="egen">
      ${mitNavn}
      <label class="field"><span class="row-note">${T.navn}</span><input name="navn" type="text" maxlength="80" required></label>
      <label class="field"><span class="row-note">${T.hendesEmail}</span><input name="login" type="email" maxlength="200" required></label>
      <label class="field"><span class="row-note">${T.rolle}</span>${rolleValg('rolle')}</label>
    </form>
    ${handlinger(knap({ label: T.inviter, slags: 'primaer', attrs: { 'data-aktion': 'inviter', 'data-form': 'inviter-egen', 'data-status': T.statusInviterer } }))}
  </section>
  <section class="card stack" data-invitation-form="telefon">
    <h2 class="eyebrow">${T.kunTelefon}</h2>
    <p class="row-note">${T.kunTelefonTekst}</p>
    <form id="inviter-telefon" class="stack nyt-form" method="post" autocomplete="off">
      <input type="hidden" name="slags" value="telefon">
      ${mitNavn}
      <label class="field"><span class="row-note">${T.navn}</span><input name="navn" type="text" maxlength="80" required></label>
      <label class="field"><span class="row-note">${T.kanal}</span><select name="kanal">${KANALER.map((k) => html`<option value="${k}">${KANAL_NAVN[k]}</option>`)}</select></label>
      <label class="field"><span class="row-note">${T.nummer}</span><input name="handle" type="text" maxlength="24" required inputmode="tel"></label>
      <label class="field"><span class="row-note">${T.rolle}</span>${rolleValg('rolle')}</label>
    </form>
    ${handlinger(knap({ label: T.inviter, slags: 'primaer', attrs: { 'data-aktion': 'inviter', 'data-form': 'inviter-telefon', 'data-status': T.statusInviterer } }))}
  </section>`;
}
