// KC-0203: "Hvad deler jeg?" — the page of what the closed beta would send next, in plain words and as the exact
// JSON the pull route answers right now, with the one switch. Pure: data in, HTML out (every text through the escaper).
// Danish and English in the shape of the other tables; the JSON is shown as it is (it is the contract).

import { html, type Markup } from '../shell/html.ts';
import { handlinger, knap, tilstandChip } from '../shell/sprog.ts';
import { sprogNu } from '../shell/tekster.ts';
import { PRODUKT } from '../shell/navn.ts';

const da = {
  overskrift: 'Hvad deler jeg?',
  intro: `Du er med i den lukkede beta. Her ser du præcis, hvilke tal ${PRODUKT} kan give til Henrik. Han henter dem selv; ${PRODUKT} sender intet af sig selv.`,
  til: 'Deling af tal er slået til',
  fra: 'Deling af tal er slået fra',
  listeTitel: 'Det er de tal, der kan sendes',
  linjer: [
    'hvor lang tid der gik til det første nyttige element',
    'hvor mange ting der krævede dig per dag (kun tal)',
    'dine feedback-svar (dem du selv har sendt)',
  ],
  aldrig: 'Aldrig: indholdet af dine mails, kalender, noter eller chat, og ingen navne eller adresser.',
  altidFeedback: 'Dine feedback-svar kommer med, selv når deling er slået fra: dem sendte du selv, med vilje.',
  nuTitel: 'Sådan ser det ud lige nu',
  hvisTitel: 'Hvis du slår deling til, kommer også dette med',
  slaaTil: 'Del disse tal',
  slaaFra: 'Stop deling',
  virkerStraks: 'Det virker med det samme: næste gang Henrik henter, får han kun det, der står her.',
  tilbage: 'Tilbage til Nu',
};
const en: typeof da = {
  overskrift: 'What am I sharing?',
  intro: `You are in the closed beta. Here you see exactly which numbers ${PRODUKT} can give to Henrik. He fetches them himself; ${PRODUKT} sends nothing on its own.`,
  til: 'Sharing numbers is on',
  fra: 'Sharing numbers is off',
  listeTitel: 'These are the numbers that can be sent',
  linjer: [
    'how long it took to reach the first useful element',
    'how many things needed you per day (numbers only)',
    'your feedback answers (the ones you sent yourself)',
  ],
  aldrig: 'Never: the content of your mail, calendar, notes or chat, and no names or addresses.',
  altidFeedback: 'Your feedback answers are included even when sharing is off: you sent those yourself, on purpose.',
  nuTitel: 'This is what it looks like right now',
  hvisTitel: 'If you switch sharing on, this is added',
  slaaTil: 'Share these numbers',
  slaaFra: 'Stop sharing',
  virkerStraks: 'It takes effect at once: the next time Henrik fetches, he gets only what is shown here.',
  tilbage: 'Back to Now',
};
export const BETA_SIDE_TEKSTER = { da, en };
const t = (): typeof da => BETA_SIDE_TEKSTER[sprogNu()];

export type DelingData = {
  samtykke: boolean;
  /** The answer as it would go now (JSON text, pretty). */
  nu: string;
  /** With consent off: what switching on would add (the numbers part of the answer); absent when consent is on. */
  hvis?: string;
};

export function renderDeling(d: DelingData): Markup {
  const x = t();
  return html`<header class="room-head"><div><h1>${x.overskrift}</h1><p class="muted">${x.intro}</p></div></header>
  <section class="card" data-beta-deling data-beta-tilstand="${d.samtykke ? 'til' : 'fra'}">
    <p>${tilstandChip(d.samtykke ? 'ordnet' : 'rolig', d.samtykke ? x.til : x.fra)}</p>
    <h2 class="eyebrow">${x.listeTitel}</h2>
    <ul>${x.linjer.map((l) => html`<li>${l}</li>`)}</ul>
    <p class="row-note">${x.aldrig}</p>
    <p class="row-note">${x.altidFeedback}</p>
    <h2 class="eyebrow">${x.nuTitel}</h2>
    <pre class="mono" data-beta-json>${d.nu}</pre>
    ${d.hvis !== undefined ? html`<h2 class="eyebrow">${x.hvisTitel}</h2><pre class="mono" data-beta-json-hvis>${d.hvis}</pre>` : ''}
    ${handlinger(d.samtykke ? undefined : knap({ label: x.slaaTil, slags: 'primaer', attrs: { 'data-beta-samtykke': 'ja' } }), d.samtykke ? [knap({ label: x.slaaFra, attrs: { 'data-beta-samtykke': 'nej' } })] : [])}
    <p class="row-note">${x.virkerStraks}</p>
    <p><a href="/rum/hjem">${x.tilbage}</a></p>
  </section>`;
}
