// "Hvad Clawco har gjort" (KC-0124): the audit lines in plain Danish for the
// Kø panel. Pure: lines in, HTML out. Newest first, times in Copenhagen, the
// refusals marked `data-nej` so the filter "Det Clawco sagde nej til" can show
// only them (app.js toggles `data-kun-nej` on the list, CSS hides the rest).

import { html, type Markup } from './html.ts';
import { findRoom, UNIVERS_ID } from '../rooms/registry.ts';
import { erNej, type Kanal, type Revisionslinje } from '../graenser/revisionslog.ts';

/** What Clawco did, past tense, per verb (graenser/verber.ts). */
const GJORDE: Record<string, string> = {
  laes: 'læste og byggede rummet', sorter: 'sorterede', bogfoer: 'skrev det ned', forbered: 'forberedte',
  'udfoer-med-fortryd': 'udførte en handling, du kan fortryde', 'send-til-andre': 'skrev til andre', slet: 'slettede noget',
  betal: 'betalte', 'kopier-paa-tvaers': 'kopierede mellem zonerne',
};
/** The same, as "at …" after "sagde nej til" / "ventede på dit ja til". */
const AT: Record<string, string> = {
  laes: 'læse', sorter: 'sortere', bogfoer: 'skrive det ned', forbered: 'forberede', 'udfoer-med-fortryd': 'udføre en handling',
  'send-til-andre': 'skrive til andre', slet: 'slette noget', betal: 'betale', 'kopier-paa-tvaers': 'kopiere mellem zonerne',
};
const KANAL: Record<Kanal, string> = { knap: 'fra en knap', stemme: 'fra stemmen', chat: 'fra chatten', agent: 'fra Hermes', planlagt: 'planlagt' };

const dag = (d: Date): string => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
export const klokkeKbh = (d: Date): string => new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(':', '.');

/** "14.05" today, "30. okt. 08.15" another day. */
export function hvornaar(tid: string, nu: Date): string {
  const d = new Date(tid);
  if (Number.isNaN(d.getTime())) return '';
  if (dag(d) === dag(nu)) return klokkeKbh(d);
  const dato = new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', day: 'numeric', month: 'short' }).format(d);
  return `${dato} ${klokkeKbh(d)}`;
}

function rumNavn(rum: string): string {
  if (UNIVERS_ID.test(rum)) return 'Univers';
  return findRoom(rum)?.navn ?? rum;
}

function titel(e: Revisionslinje, navn: string): string {
  if (e.udfald === 'stop') return `${navn} trykkede Stop alt`;
  if (e.udfald === 'genoptag') return `${navn} startede Clawco igen`;
  const rum = rumNavn(e.rum);
  if (e.udfald === 'afvist') return `${rum}: sagde nej til at ${AT[e.verb] ?? 'gøre noget, der ikke har et navn'}`;
  if (e.udfald === 'kraever-ja') return `${rum}: ventede på dit ja til at ${AT[e.verb] ?? 'gøre noget, der ikke har et navn'}`;
  return `${rum}: ${GJORDE[e.verb] ?? 'gjorde noget'}`;
}

export function renderRevision(linjer: readonly Revisionslinje[], o: { nu: Date; navne: Readonly<Record<string, string>> }): Markup {
  if (!linjer.length) return html`<p class="muted row">Clawco har ikke gjort noget endnu.</p>`;
  const ingenNej = !linjer.some(erNej);
  return html`<ul class="revision-liste">${linjer.map((e) => {
    const navn = o.navne[e.person] ?? e.person;
    const note = [erNej(e) || e.udfald === 'stop' ? e.hvorfor : '', KANAL[e.kanal] ?? ''].filter(Boolean).join(' · ');
    return html`<li class="revision-row" data-revision-linje data-udfald="${e.udfald}"${erNej(e) ? html` data-nej` : ''}><span class="mono revision-tid">${hvornaar(e.tid, o.nu)}</span><span class="row-main"><span class="row-title">${titel(e, navn)}</span>${note ? html`<span class="row-note">${note}</span>` : ''}</span></li>`;
  })}</ul>${ingenNej ? html`<p class="row-note revision-ingen-nej" data-ingen-nej>Clawco har ikke sagt nej til noget af det seneste.</p>` : ''}`;
}
