// KC-0236: Start's "Danmark-pakke" — one group that holds what is Danish about the product, today Aula (KC-0235's connect
// card, wrapped here, not copied: the registry's own data, the same form and button) beside Digital Post's step (KC-0233).
// Pure: data in, Markup out; every text through html``. Shown only while something in it is relevant (KC-0052: absent, not
// greyed out): the Aula card while no Aula source is connected and the person has not put it away ("Ikke nu", 30 days); the
// Digital Post step by its own rule. Nothing relevant: no markup at all, not even the heading. The wording "Danmark-pakke"
// is shared with Digital Post's step (its data-element starts with it). Admin UI copy: Claude's call, for review.

import { html, type Markup } from '../../shell/html.ts';
import type { KildeKortSyn } from '../module.ts';
import { forbindKort } from './kilderender.ts';
import { renderDigitalPostStart, type PostStartVisning } from './digitalpost.ts';
import { startTekst } from './tekster.ts';

export { PAKKE_KILDER, erPakkeKilde, utenPakke } from './trin.ts';

/** The group's Danish name (the product owner's word); the screen shows it in the language being rendered (startTekst().pakkeTitel). */
export const PAKKE_TITEL = 'Danmark-pakke';
/** Start's handling that puts the Aula card away (a setting; reaches neither Hermes nor Aula). */
export const AULA_IKKE_NU = 'aula-ikke-nu';

/** What Start is told while the Aula card is open: the connector's card as the registry gives it, and whether this is a laptop install. */
export type AulaStartVisning = { kort: KildeKortSyn; laptop?: boolean };

function aulaKort(v: AulaStartVisning): Markup {
  return html`<article class="card kort" data-blok="kort" data-pakke-aula data-element="${startTekst().pakkeTitel}: ${v.kort.navn}">${forbindKort(v.kort, { spring: false, ikkeNu: AULA_IKKE_NU, ...(v.laptop ? { laptop: true } : {}) })}</article>`;
}

/** The group, or nothing at all when neither card is relevant. */
export function renderDanmarkPakke(v: { aula?: AulaStartVisning | undefined; post?: PostStartVisning | undefined }): Markup {
  if (!v.aula && !v.post) return html``;
  const titel = startTekst().pakkeTitel;
  return html`<section class="stack" data-danmark-pakke data-gruppe="${titel}"><h3 class="eyebrow">${titel}</h3>${v.aula ? aulaKort(v.aula) : ''}${v.post ? renderDigitalPostStart(v.post) : ''}</section>`;
}
