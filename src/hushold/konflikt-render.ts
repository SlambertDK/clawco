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
import { andenIKonflikt, erPartIKonflikt, konfliktStatus, type Konflikt, type KonfliktTekst, type KonfliktValg } from './konflikt.ts';
import type { PersonId } from './ressource.ts';
import type { Medlem } from './schema.ts';
import { klokkeVis } from './render.ts';
import { husstandTekst } from './tekster.ts';

type Hvem = { person: PersonId; medlemmer: readonly Medlem[] };
const navnAf = (v: Hvem, id: string): string => (id === v.person ? husstandTekst().du(true) : v.medlemmer.find((m) => m.id === id)?.navn ?? husstandTekst().ukendtMedlem);
const navnIkkeDu = (medlemmer: readonly Medlem[], id: string): string => medlemmer.find((m) => m.id === id)?.navn ?? husstandTekst().ukendtMedlem;
/** The thing a weekend card is about, as a word in a sentence ("Nora", "den store bil"). */
const hvadBehov = (k: Konflikt): string => (k.behov.slags === 'barn' ? k.behov.navn : husstandTekst().iSaet(k.behov.navn));
/** "9", "9.30", "14" (English "9:30"): the clock the way a person says it. */
const hel = (iso: string): string => klokkeVis(iso).replace(/^0/, '').replace(/[.:]00$/, '');

/** An option's label: by name for both viewers (never "du"), so the two cards cannot differ. */
export function konfliktValgTekst(k: Konflikt, v: KonfliktValg, medlemmer: readonly Medlem[]): string {
  const T = husstandTekst();
  if (v.slags === 'tredje') return T.findEnTredje;
  return T.tagerTing(navnIkkeDu(medlemmer, v.hvem), hvadBehov(k));
}

/**
 * The words of the card in the language being rendered: Hermes' phrasing when it gave one (`k.tekst`, as it is), else
 * what each has and the question, composed from the table (the same words as konflikt.ts' konfliktResume in Danish,
 * which the log line and Hermes' prompt keep using).
 */
export function konfliktTekstVis(k: Konflikt, medlemmer: readonly Medlem[]): KonfliktTekst {
  if (k.tekst) return k.tekst;
  const T = husstandTekst();
  const dag = T.ugedage[new Date(`${k.dag}T12:00:00Z`).getUTCDay()] ?? k.dag;
  const dele = k.blokke.map((b) => T.konfliktDel(navnIkkeDu(medlemmer, b.hvem), b.titel, hel(b.start), hel(b.slut)));
  return { resume: T.konfliktResume(dag, dele), spoergsmaal: k.behov.slags === 'barn' ? T.hvemHarBarnet(k.behov.navn) : T.hvemTagerTing(hvadBehov(k)) };
}

/** `lørdag kl. 11.00–13.00` / `Saturday at 11:00–13:00` — the time of the request, the day in words (the Nu line). */
export const tidSagVis = (k: Pick<Konflikt, 'tid' | 'dag'>): string => {
  const T = husstandTekst();
  return T.tidSag(T.midt(T.ugedage[new Date(`${k.dag}T12:00:00Z`).getUTCDay()] ?? k.dag), klokkeVis(k.tid.start), klokkeVis(k.tid.slut));
};

export function konfliktKort(v: { k: Konflikt; forespoergsler: readonly Forespoergsel[]; person: PersonId; medlemmer: readonly Medlem[]; now: Date }): Markup {
  const T = husstandTekst();
  const { k } = v;
  const status = konfliktStatus(k, v.forespoergsler, v.now);
  if (!erPartIKonflikt(k, v.person) || (status !== 'aaben' && status !== 'venter')) return html``;
  const tekst = konfliktTekstVis(k, v.medlemmer);
  const f = k.forespId ? v.forespoergsler.find((x) => x.id === k.forespId) : undefined;
  const venterTekst = status === 'venter' && f
    ? (f.fra === v.person ? T.duHarSpurgt(navnAf(v, andenIKonflikt(k, v.person))) : T.harSpurgtDig(navnAf(v, f.fra)))
    : '';
  const knapper = status === 'aaben' ? k.valg.map((valg) => knap({
    label: konfliktValgTekst(k, valg, v.medlemmer), slags: 'graense', attrs: { 'data-aktion': 'konflikt-valg', 'data-arg': JSON.stringify({ id: k.id, valg: valg.id }), 'data-konflikt-valg': valg.id, 'data-status': T.statusSpoerger },
  })) : [];
  return html`<article class="card kort konflikt" data-blok="beslutning" data-konflikt="${k.id}" data-konflikt-status="${status}" data-konflikt-behov="${k.behov.slags}" data-element="${T.weekendElement(k.behov.navn)}" data-datazone="husstand">
    <div class="kort-head">${tilstandChip('kraever', T.weekend)}<span class="row-note">${T.fraHusstanden}</span></div>
    <span class="row-title" data-konflikt-spoergsmaal>${tekst.spoergsmaal}</span>
    <p class="row-note" data-konflikt-resume>${tekst.resume}</p>
    ${venterTekst ? html`<p class="row-note" data-konflikt-venter>${venterTekst}</p>` : ''}
    ${handlinger(undefined, knapper)}
  </article>`;
}

/** The person's own open weekend cards (nobody else sees one). */
export function konfliktSektion(v: { konflikter: readonly Konflikt[]; forespoergsler: readonly Forespoergsel[]; person: PersonId; medlemmer: readonly Medlem[]; now: Date }): Markup {
  const T = husstandTekst();
  const egne = v.konflikter.filter((k) => erPartIKonflikt(k, v.person) && ['aaben', 'venter'].includes(konfliktStatus(k, v.forespoergsler, v.now)));
  if (!egne.length) return html``;
  return html`<div class="stack gruppe" data-gruppe="${T.weekend}"><div class="card-head"><h2 class="eyebrow">${T.weekend}</h2><span class="muted mono">${egne.length}</span></div>${egne.map((k) => konfliktKort({ ...v, k }))}</div>`;
}
