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
import { ROLLE_NAVN } from '../identitet/roller.ts';
import type { Person } from '../identitet/husstand.ts';
import { KANAL_NAVN, KANALER } from './kanal.ts';
import { INVITER_ROLLER, invitationAf, MAX_PERSONER, vurderInvitation } from './invitation.ts';
import { klokke } from './render.ts';
import type { Medlem } from './schema.ts';

/** `kanSende`: the app has a channel client (else the card says so instead of offering a Send that answers 503). */
export type InvitationVisning = { medlemmer: readonly Medlem[]; person: Person; kanSende: boolean };

function trin(id: string, navn: string): Markup {
  const t = [
    'Åbn Tailscales admin-side på login.tailscale.com/admin/machines, og find den maskine, Clawco kører på.',
    'Tryk på de tre prikker ud for maskinen, og vælg Share.',
    `Skriv den e-mail, du gav ${navn} her, og send invitationen fra Tailscale.`,
    `Når ${navn} har sagt ja i Tailscale, åbner hun Clawco på den samme adresse som dig. Så står hun her som kommet ind.`,
  ];
  return html`<div class="stack kilde-trin" data-invitation-trin="${id}">${t.map((tekst, i) => html`<details class="kilde-trin-et" name="invitation-${id}"${i === 0 ? html` open` : ''}><summary class="row-note">Trin ${String(i + 1)} af ${String(t.length)}</summary><p>${tekst}</p></details>`)}</div>`;
}

function egenKort(m: Medlem): Markup {
  return html`<article class="card kort invitation" data-invitation="egen" data-invitation-medlem="${m.id}" data-element="Invitation: ${m.navn}" data-datazone="husstand">
    <div class="kort-head"><span class="row-note">Egen indgang · ${ROLLE_NAVN[m.rolle]}</span></div>
    <span class="row-title">${m.navn} er inviteret</span>
    <p class="row-note">Clawco kender ${m.navn}, når hun kommer. Adgangen giver du selv i Tailscale:</p>
    ${trin(m.id, m.navn)}
  </article>`;
}

function telefonKort(m: Medlem, v: InvitationVisning): Markup {
  const k = m.kanal!;
  const kanalNavn = KANAL_NAVN[k.kanal];
  const u = vurderInvitation(v.medlemmer, m.id, v.person);
  const krop = k.inviteret
    ? html`<p class="row-note" data-invitation-sendt>Sendt på ${kanalNavn} kl. ${klokke(k.inviteret)}. Clawco sender ikke mere, før hun svarer ja.</p>`
    : u.ok
      ? v.kanSende
        ? html`<p class="row-note">Det får ${m.navn} på ${kanalNavn}:</p>
          <p class="row-note kanal-tekst" data-invitation-tekst="${m.id}">${u.tekst}</p>
          ${handlinger(undefined, [knap({ label: `Send til ${m.navn} på ${kanalNavn}`, slags: 'graense', attrs: { 'data-invitation-send': m.id, 'data-invitation-ja': u.jaId, 'data-status': 'sender' } })])}`
        : html`<p class="row-note" data-invitation-ikke>Clawco kan ikke sende beskeder herfra endnu.</p>`
      : html`<p class="row-note" data-invitation-ikke>${u.hvorfor}</p>`;
  return html`<article class="card kort invitation" data-invitation="telefon" data-invitation-medlem="${m.id}" data-element="Invitation: ${m.navn}" data-datazone="husstand">
    <div class="kort-head"><span class="row-note">Kun telefonnummer · ${ROLLE_NAVN[m.rolle]}</span></div>
    <span class="row-title">${m.navn} får forespørgsler som beskeder</span>
    ${krop}
  </article>`;
}

/** The owner's pending invitations and the way to invite one more (while there is room). Empty when there is nothing. */
export function invitationSektion(v: InvitationVisning): Markup {
  const ventende = v.medlemmer.filter((m) => m.id !== v.person.id && invitationAf(m) !== null);
  const plads = v.medlemmer.length < MAX_PERSONER;
  if (!ventende.length && !plads) return html``;
  return html`<div class="stack gruppe" data-gruppe="Invitationer">
    <div class="card-head"><h2 class="eyebrow">Invitationer</h2><span class="muted mono">${ventende.length}</span></div>
    ${ventende.map((m) => (invitationAf(m) === 'egen' ? egenKort(m) : telefonKort(m, v)))}
    ${plads ? html`<p class="row"><a class="btn btn-ghost" href="/rum/husstand/inviter" data-invitation-ny>Inviter en til husstanden</a></p>` : ''}
  </div>`;
}

const rolleValg = (navn: string): Markup =>
  html`<select name="${navn}">${INVITER_ROLLER.map((r) => html`<option value="${r}"${r === 'medlem' ? html` selected` : ''}>${ROLLE_NAVN[r]}</option>`)}</select>`;

/**
 * The page with the two ways to invite. `enebruger`: no household file yet — the owner names himself too, and the
 * household is written with him as its owner by the login Tailscale gives Clawco.
 */
export function renderInviter(v: { enebruger: boolean; plads: boolean }): Markup {
  const mitNavn = v.enebruger ? html`<label class="field"><span class="row-note">Dit navn (det står i invitationen)</span><input name="mitNavn" type="text" maxlength="80" required></label>` : '';
  const hoved = html`<header class="room-head"><div><a class="muted" href="/rum/hjem">Til Nu</a><h1>Inviter en til husstanden</h1><p class="muted">Hun ser det, I deler. Din egen Nu, dine noter og din arbejds- og privatzone ser hun aldrig.</p></div></header>`;
  if (!v.plads) return html`${hoved}<p class="muted row">Husstanden kan højst have ${String(MAX_PERSONER)} personer.</p>`;
  return html`${hoved}
  <section class="card stack" data-invitation-form="egen">
    <h2 class="eyebrow">Egen indgang</h2>
    <p class="row-note">Hun får sin egen Nu i Clawco. Du giver hende adgang i Tailscale bagefter; Clawco viser dig hvordan.</p>
    <form id="inviter-egen" class="stack nyt-form" method="post" autocomplete="off">
      <input type="hidden" name="slags" value="egen">
      ${mitNavn}
      <label class="field"><span class="row-note">Navn</span><input name="navn" type="text" maxlength="80" required></label>
      <label class="field"><span class="row-note">Hendes e-mail i Tailscale</span><input name="login" type="email" maxlength="200" required></label>
      <label class="field"><span class="row-note">Rolle</span>${rolleValg('rolle')}</label>
    </form>
    ${handlinger(knap({ label: 'Inviter', slags: 'primaer', attrs: { 'data-aktion': 'inviter', 'data-form': 'inviter-egen', 'data-status': 'inviterer' } }))}
  </section>
  <section class="card stack" data-invitation-form="telefon">
    <h2 class="eyebrow">Kun telefonnummer</h2>
    <p class="row-note">Hun skal ikke installere noget. Forespørgsler kommer som beskeder, og du læser selv den første, før den sendes.</p>
    <form id="inviter-telefon" class="stack nyt-form" method="post" autocomplete="off">
      <input type="hidden" name="slags" value="telefon">
      ${mitNavn}
      <label class="field"><span class="row-note">Navn</span><input name="navn" type="text" maxlength="80" required></label>
      <label class="field"><span class="row-note">Kanal</span><select name="kanal">${KANALER.map((k) => html`<option value="${k}">${KANAL_NAVN[k]}</option>`)}</select></label>
      <label class="field"><span class="row-note">Nummer med landekode (Telegram: hendes id)</span><input name="handle" type="text" maxlength="24" required inputmode="tel"></label>
      <label class="field"><span class="row-note">Rolle</span>${rolleValg('rolle')}</label>
    </form>
    ${handlinger(knap({ label: 'Inviter', slags: 'primaer', attrs: { 'data-aktion': 'inviter', 'data-form': 'inviter-telefon', 'data-status': 'inviterer' } }))}
  </section>`;
}
