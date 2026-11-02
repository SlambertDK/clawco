// KC-0233, the Danmark-pakke's card in Nu: "Der er kommet ny Digital Post". App-driven, like the beta's cards — it shows
// only while the server says there is an unseen notice, never needs Hermes, and is gone once marked (KC-0052: not
// greyed out). Pure: data in, HTML out, every text through the escaper.
//
// The card holds exactly ONE link (the viewer the person chose, a fixed front page the server resolved; never an address
// taken from a mail) and ONE button ("Set den"). It has no handling, no instruction and no ask control: Clawco never
// opens, answers or pays anything from a letter (AGENTS §9). The copy is Danish in both screen languages: Digital Post is
// a Danish service and this is the Danmark-pakke's own wording.
//
// The subject appears only in its short form and only when it says more than "you have new post" (the server leaves
// the generic ones out: `emne` is null then); the notification's own text is KC-0234, not here.

import { html, type Markup } from '../../shell/html.ts';
import { handlinger, knap, type Element } from '../../shell/sprog.ts';
import { visHoved } from '../../shell/visuel.ts';
import { zoneData } from '../../shell/zone.ts';
import type { Person } from '../../identitet/husstand.ts';

/** What Nu is told about Digital Post (the server builds it for the owner only, from src/danmark/vindue.ts). */
export type PostVisning =
  | { slags: 'notitser'; notitser: { id: string; modtaget: string; afsender: string; emne: string | null }[]; viser: { navn: string; url: string } }
  | { slags: 'kan-ikke-se'; viser: { navn: string; url: string } };

export const POST_GRUPPE = 'Digital Post';
/** More notices than this fold into one card. */
export const POST_ENKELTE_MAKS = 3;
export const POST_ID = 'post:';
const TITEL = 'Ny Digital Post';
const STAAENDE = 'Clawco ser kun notifikationen: hverken brevet eller mailens tekst. Du åbner selv brevet i Digital Post.';

const dato = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('da-DK', { day: 'numeric', month: 'long', timeZone: 'Europe/Copenhagen' });
};
const fra = (afsender: string, iso: string): string => [`fra ${afsender}`, dato(iso)].filter(Boolean).join(', ');

type Viser = { navn: string; url: string };
const aabn = (v: Viser): Markup => html`<a class="btn btn-primary" href="${v.url}" target="_blank" rel="noopener noreferrer" data-post-viser>Åbn ${v.navn}</a>`;

function enKort(n: Extract<PostVisning, { slags: 'notitser' }>['notitser'][number], v: Viser): Markup {
  return html`<article class="card kort" data-blok="kort" data-post-kort="${n.id}"${zoneData({ zone: 'privat' })} data-element="${TITEL}">
    ${visHoved({ ikon: 'mail' }, TITEL, POST_GRUPPE)}
    <p class="betydning">Der er kommet ny Digital Post (${fra(n.afsender, n.modtaget)})</p>
    ${n.emne ? html`<p class="row-note" data-post-emne>${n.emne}</p>` : ''}
    <p class="row-note">${STAAENDE}</p>
    <div class="actions">${aabn(v)}${knap({ label: 'Set den', attrs: { 'data-post-set': n.id } })}</div>
  </article>`;
}

function samletKort(n: Extract<PostVisning, { slags: 'notitser' }>['notitser'], v: Viser): Markup {
  const nyeste = n[0]!; // the server sends the newest first
  return html`<article class="card kort" data-blok="kort" data-post-kort="samlet"${zoneData({ zone: 'privat' })} data-element="${TITEL}">
    ${visHoved({ ikon: 'mail' }, TITEL, POST_GRUPPE)}
    <p class="betydning">Der er kommet ${String(n.length)} nye breve i Digital Post (seneste ${fra(nyeste.afsender, nyeste.modtaget)})</p>
    <p class="row-note">${STAAENDE}</p>
    <div class="actions">${aabn(v)}${knap({ label: 'Set dem', attrs: { 'data-post-set-alle': '' } })}</div>
  </article>`;
}

function kanIkkeSe(v: Viser): Markup {
  return html`<article class="card kort" data-blok="kort" data-post-kort="kan-ikke-se"${zoneData({ zone: 'privat' })} data-element="${TITEL}">
    ${visHoved({ ikon: 'mail', tone: 'adv' }, TITEL, POST_GRUPPE)}
    <p class="betydning">Clawco kan ikke se, om der er ny Digital Post lige nu.</p>
    <p class="row-note">Det er din mail, Clawco ikke kan læse. Tjek selv din Digital Post, indtil den virker igen.</p>
    <div class="actions">${aabn(v)}</div>
  </article>`;
}

/** The elements Nu draws under "Digital Post": the owner's only (zone privat), none when there is nothing to say. */
export function postElementer(v: PostVisning | undefined, person: Person | undefined): Element[] {
  if (!v || (person && person.rolle !== 'ejer')) return [];
  if (v.slags === 'kan-ikke-se') return [{ id: `${POST_ID}kan-ikke-se`, html: kanIkkeSe(v.viser) }];
  if (v.notitser.length === 0) return [];
  if (v.notitser.length > POST_ENKELTE_MAKS) return [{ id: `${POST_ID}samlet`, html: samletKort(v.notitser, v.viser) }];
  return v.notitser.map((n) => ({ id: `${POST_ID}${n.id}`, html: enKort(n, v.viser) }));
}
