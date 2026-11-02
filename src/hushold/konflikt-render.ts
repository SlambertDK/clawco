// The Saturday card (KC-0152; anatomy KC-0064: the existing beslutning block, from a neutral sender). Pure: data in,
// Markup out; every name and calendar title through html`` (§4 r9).
//
// The card is the same for both adults: the same words, the same three options in the same order, none first and
// none blue (a pick goes to the other person, so each button is red, KC-0067). Only the status line while a request
// waits is personal ("Du har spurgt …" / "… har spurgt dig"). A third member, a settled card and a past one render
// nothing — it is gone, not greyed out (KC-0052).

import { html, type Markup } from '../shell/html.ts';
import { handlinger, knap, tilstandChip } from '../shell/sprog.ts';
import type { Forespoergsel } from './foresp.ts';
import { andenIKonflikt, erPartIKonflikt, konfliktResume, konfliktStatus, ukendt, type Konflikt, type KonfliktValg } from './konflikt.ts';
import { iSaetning, type PersonId } from './ressource.ts';
import type { Medlem } from './schema.ts';

type Hvem = { person: PersonId; medlemmer: readonly Medlem[] };
const navnAf = (v: Hvem, id: string): string => (id === v.person ? 'Du' : v.medlemmer.find((m) => m.id === id)?.navn ?? ukendt);
const navnIkkeDu = (medlemmer: readonly Medlem[], id: string): string => medlemmer.find((m) => m.id === id)?.navn ?? ukendt;

/** An option's label: by name for both viewers (never "du"), so the two cards cannot differ. */
export function konfliktValgTekst(k: Konflikt, v: KonfliktValg, medlemmer: readonly Medlem[]): string {
  if (v.slags === 'tredje') return 'Find en tredje';
  const hvad = k.behov.slags === 'barn' ? k.behov.navn : iSaetning(k.behov.navn);
  return `${navnIkkeDu(medlemmer, v.hvem)} tager ${hvad}`;
}

export function konfliktKort(v: { k: Konflikt; forespoergsler: readonly Forespoergsel[]; person: PersonId; medlemmer: readonly Medlem[]; now: Date }): Markup {
  const { k } = v;
  const status = konfliktStatus(k, v.forespoergsler, v.now);
  if (!erPartIKonflikt(k, v.person) || (status !== 'aaben' && status !== 'venter')) return html``;
  const tekst = konfliktResume(k, v.medlemmer);
  const f = k.forespId ? v.forespoergsler.find((x) => x.id === k.forespId) : undefined;
  const venterTekst = status === 'venter' && f
    ? (f.fra === v.person ? `Du har spurgt ${navnAf(v, andenIKonflikt(k, v.person))}. Venter på svar.` : `${navnAf(v, f.fra)} har spurgt dig. Svar på forespørgslen.`)
    : '';
  const knapper = status === 'aaben' ? k.valg.map((valg) => knap({
    label: konfliktValgTekst(k, valg, v.medlemmer), slags: 'graense', attrs: { 'data-aktion': 'konflikt-valg', 'data-arg': JSON.stringify({ id: k.id, valg: valg.id }), 'data-konflikt-valg': valg.id, 'data-status': 'spørger' },
  })) : [];
  return html`<article class="card kort konflikt" data-blok="beslutning" data-konflikt="${k.id}" data-konflikt-status="${status}" data-konflikt-behov="${k.behov.slags}" data-element="Weekend: ${k.behov.navn}" data-datazone="husstand">
    <div class="kort-head">${tilstandChip('kraever', 'Weekend')}<span class="row-note">Fra Husstanden</span></div>
    <span class="row-title" data-konflikt-spoergsmaal>${tekst.spoergsmaal}</span>
    <p class="row-note" data-konflikt-resume>${tekst.resume}</p>
    ${venterTekst ? html`<p class="row-note" data-konflikt-venter>${venterTekst}</p>` : ''}
    ${handlinger(undefined, knapper)}
  </article>`;
}

/** The person's own open weekend cards (nobody else sees one). */
export function konfliktSektion(v: { konflikter: readonly Konflikt[]; forespoergsler: readonly Forespoergsel[]; person: PersonId; medlemmer: readonly Medlem[]; now: Date }): Markup {
  const egne = v.konflikter.filter((k) => erPartIKonflikt(k, v.person) && ['aaben', 'venter'].includes(konfliktStatus(k, v.forespoergsler, v.now)));
  if (!egne.length) return html``;
  return html`<div class="stack gruppe" data-gruppe="Weekend"><div class="card-head"><h2 class="eyebrow">Weekend</h2><span class="muted mono">${egne.length}</span></div>${egne.map((k) => konfliktKort({ ...v, k }))}</div>`;
}
