// KC-0144 / KC-0227: the card "Skal jeg gøre det til en regel?" — ONE card, drawn by Nu and by Start. The words (Danish and
// English), the markup and the three answers live here and nowhere else: Ja is the one primary and only Henrik's own tap
// (data-regelforslag-ja), Ret reglen opens the chat with the proposal, Nej tak declines (data-regelforslag-nej). Both
// rooms' buttons are served by the same handler in public/app.js, which posts to /api/tillid/forslag/:id/godkend|afvis.
// Pure: a pending proposal in, Markup out; every text goes through the escaper.

import { html, type Markup } from './html.ts';
import { handlinger, knap, spoerg } from './sprog.ts';
import { visHoved } from './visuel.ts';
import { zoneChip, zoneData } from './zone.ts';
import { sprogNu } from './tekster.ts';
import type { Regelforslag } from '../tillid/forslag.ts';
import { TRIN, type Trin } from '../tillid/trin.ts';

/** Danish is the ladder's own words (src/tillid/trin.ts), derived and not retyped; English is ours. */
const da = {
  forslagElement: (titel: string): string => `Regelforslag: ${titel}`,
  forslagTilRegel: 'Forslag til en regel',
  skalDetVaereRegel: 'Skal jeg gøre det til en regel?',
  skalReglenPaaPause: 'Skal jeg sætte reglen på pause?',
  retReglen: 'Ret reglen',
  nejTak: 'Nej tak',
  jaRegel: 'Ja, gør det til en regel',
  jaPause: 'Ja, sæt den på pause',
  forslagFor: (titel: string): string => `Forslag: ${titel}`,
  trin: Object.fromEntries(TRIN.map((t) => [t.trin, { navn: t.navn, saetning: t.saetning }])) as Record<Trin, { navn: string; saetning: string }>,
  gaelder: (kilde: string, slags: string | undefined, trin: number, navn: string, saetning: string): string => `Gælder ${kilde}${slags ? ` · ${slags}` : ''} · Trin ${trin}, ${navn}: ${saetning}`,
  pauserSamtidig: (regel: string): string => `Et ja sætter samtidig ${regel} på pause.`,
  komFra: 'Kom fra: ',
  komFraSkjult: (titel: string): string => `søndagstjekket: «${titel}» skulle have været vist`,
  komFraKort: (art: 'ret' | 'ikke-relevant', titel: string): string => `dit ${art === 'ret' ? 'Ret' : 'Ikke relevant'} på «${titel}»`,
};

export type RegelforslagTekster = typeof da;

const en: RegelforslagTekster = {
  forslagElement: (titel) => `Rule proposal: ${titel}`,
  forslagTilRegel: 'Proposal for a rule',
  skalDetVaereRegel: 'Shall I make it a rule?',
  skalReglenPaaPause: 'Shall I pause the rule?',
  retReglen: 'Correct the rule',
  nejTak: 'No thanks',
  jaRegel: 'Yes, make it a rule',
  jaPause: 'Yes, pause it',
  forslagFor: (titel) => `Proposal: ${titel}`,
  trin: {
    0: { navn: 'look', saetning: 'Hermes may look and suggest, but does nothing by itself.' },
    1: { navn: 'sort', saetning: 'Hermes may sort and put things in Done, but never write in your files or create appointments.' },
    2: { navn: 'keep the ledger', saetning: 'Hermes may write lines in your ledger, each with Undo.' },
    3: { navn: 'prepare', saetning: 'Hermes may make drafts and prepare, but you send and use them yourself.' },
    4: { navn: 'act with undo', saetning: 'Hermes may act in your own systems, and you can undo.' },
  },
  gaelder: (kilde, slags, trin, navn, saetning) => `Applies to ${kilde}${slags ? ` · ${slags}` : ''} · Step ${trin}, ${navn}: ${saetning}`,
  pauserSamtidig: (regel) => `A yes pauses ${regel} at the same time.`,
  komFra: 'Came from: ',
  komFraSkjult: (titel) => `the Sunday check: "${titel}" should have been shown`,
  komFraKort: (art, titel) => `your ${art === 'ret' ? 'Correct' : 'Not relevant'} on "${titel}"`,
};

export const REGELFORSLAG_TEKSTER: { da: RegelforslagTekster; en: RegelforslagTekster } = { da, en };
const t = (): RegelforslagTekster => REGELFORSLAG_TEKSTER[sprogNu()];

/** Where a proposal came from: a Ret or Ikke relevant on a card, or (KC-0145) the Sunday sample. */
const kom = (f: Regelforslag): string => (f.kortId.startsWith('skjult:') ? t().komFraSkjult(f.kortTitel) : t().komFraKort(f.art, f.kortTitel));

/**
 * One pending proposal as a card. `maerke` is an extra attribute fragment for the card's root tag (Start's coverage mark,
 * ` data-regelforslag-start="<id>"`); it changes nothing else, so both rooms draw the same card.
 */
export function regelforslagKort(f: Regelforslag, maerke: Markup = html``): Markup {
  const T = t();
  const svar = handlinger(
    knap({ label: f.kunPause ? T.jaPause : T.jaRegel, slags: 'primaer', attrs: { 'data-regelforslag-ja': f.id } }),
    [spoerg(T.forslagFor(f.titel), T.retReglen), knap({ label: T.nejTak, attrs: { 'data-regelforslag-nej': f.id } })],
  );
  // KC-0145: the app's proposal to pause the rule that hid an item Henrik says he should have seen. Only his Ja pauses it.
  if (f.kunPause) {
    return html`<article class="card kort" data-regelforslag="${f.id}" data-regelforslag-pause="${f.pauser ?? ''}"${maerke} data-blok="beslutning" data-element="${T.forslagElement(f.titel)}"${zoneData(f)}>
    ${visHoved({ ikon: 'list-checks' }, T.skalReglenPaaPause, T.forslagTilRegel)}${zoneChip(f)}
    <p class="row-title">${f.titel}</p>
    <p class="betydning">${f.tekst}</p>
    <p class="row-note">${T.komFra}${kom(f)}</p>
    ${svar}
  </article>`;
  }
  const trin = T.trin[f.trin];
  return html`<article class="card kort" data-regelforslag="${f.id}"${maerke} data-blok="beslutning" data-element="${T.forslagElement(f.titel)}"${zoneData(f)}>
    ${visHoved({ ikon: 'list-checks' }, T.skalDetVaereRegel, T.forslagTilRegel)}${zoneChip(f)}
    <p class="row-title">${f.titel}</p>
    <p class="betydning">${f.tekst}</p>
    <p class="row-note">${T.gaelder(f.gaelder.kilde, f.gaelder.slags, f.trin, trin.navn, trin.saetning)}</p>
    ${f.pauser ? html`<p class="row-note">${T.pauserSamtidig(f.pauser)}</p>` : ''}
    <p class="row-note">${T.komFra}${kom(f)}</p>
    ${svar}
  </article>`;
}
