// "Hvad Clawco har gjort" (KC-0124): the audit lines in plain Danish (English: KC-0170) for the
// Kø panel. Pure: lines in, HTML out. Newest first, times in Copenhagen, the
// refusals marked `data-nej` so the filter "Det Clawco sagde nej til" can show
// only them (app.js toggles `data-kun-nej` on the list, CSS hides the rest).

import { html, type Markup } from './html.ts';
import { findRoom, UNIVERS_ID } from '../rooms/registry.ts';
import { erNej, type Revisionslinje } from '../graenser/revisionslog.ts';
import { klokke } from './friskhed.ts';
import { tekst } from './tekster.ts';

const dag = (d: Date): string => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
/** "14.05" in Danish, "14:05" in English, Copenhagen time (the one clock of friskhed.ts). */
export const klokkeKbh = klokke;

/** "14.05" today, "30. okt. 08.15" another day ("30 Oct 08:15" in English). */
export function hvornaar(tid: string, nu: Date): string {
  const d = new Date(tid);
  if (Number.isNaN(d.getTime())) return '';
  if (dag(d) === dag(nu)) return klokkeKbh(d);
  const dato = new Intl.DateTimeFormat(tekst().lokale, { timeZone: 'Europe/Copenhagen', day: 'numeric', month: 'short' }).format(d);
  return `${dato} ${klokkeKbh(d)}`;
}

function rumNavn(rum: string): string {
  const T = tekst();
  if (UNIVERS_ID.test(rum)) return T.rumUnivers;
  const r = findRoom(rum);
  return r ? (T.rum[r.id] ?? r.navn) : rum;
}

/** KC-0188: the support lines (kilde 'stoette'): who turned it on and off, each session and each page support opened. */
const STOETTE_PERSON = /^stoette:(\d{1,18})$/;
function stoetteTitel(e: Revisionslinje, navn: string): string {
  const T = tekst();
  const id = STOETTE_PERSON.exec(e.person)?.[1];
  const hvem = id ? T.stoetteMedarbejder(id) : T.stoetteHvem;
  const side = /^\/rum\/[a-z0-9-]+$/.test(e.rum) ? rumNavn(e.rum.slice(5)) : e.rum;
  switch (e.verb) {
    case 'stoette-givet': return T.stoetteGivet(navn);
    case 'stoette-start': return T.stoetteStart(hvem);
    case 'stoette-aabnet': return e.udfald === 'afvist' ? T.stoetteNej(hvem, side) : T.stoetteAabnet(hvem, side);
    case 'stoette-slut': return T.stoetteSlut(navn);
    case 'stoette-udloeb': return T.stoetteUdloeb;
    default: return T.stoetteHvem;
  }
}

function titel(e: Revisionslinje, navn: string): string {
  const T = tekst();
  if (e.kilde === 'stoette') return stoetteTitel(e, navn);
  if (e.udfald === 'stop') return T.trykkedeStop(navn);
  if (e.udfald === 'genoptag') return T.startedeIgen(navn);
  const rum = rumNavn(e.rum);
  if (e.udfald === 'afvist') return T.afvistTitel(rum, T.at[e.verb] ?? T.atUkendt);
  if (e.udfald === 'kraever-ja') return T.kraeverJaTitel(rum, T.at[e.verb] ?? T.atUkendt);
  return T.gjordeTitel(rum, T.gjorde[e.verb] ?? T.gjordeUkendt);
}

export function renderRevision(linjer: readonly Revisionslinje[], o: { nu: Date; navne: Readonly<Record<string, string>> }): Markup {
  const T = tekst();
  if (!linjer.length) return html`<p class="muted row">${T.revisionTom}</p>`;
  const ingenNej = !linjer.some(erNej);
  return html`<ul class="revision-liste">${linjer.map((e) => {
    const navn = o.navne[e.person] ?? e.person;
    const note = [erNej(e) || e.udfald === 'stop' || (e.kilde === 'stoette' && e.verb !== 'stoette-aabnet') ? e.hvorfor : '', T.kanal[e.kanal] ?? ''].filter(Boolean).join(' · ');
    return html`<li class="revision-row" data-revision-linje data-udfald="${e.udfald}"${erNej(e) ? html` data-nej` : ''}><span class="mono revision-tid">${hvornaar(e.tid, o.nu)}</span><span class="row-main"><span class="row-title">${titel(e, navn)}</span>${note ? html`<span class="row-note">${note}</span>` : ''}</span></li>`;
  })}</ul>${ingenNej ? html`<p class="row-note revision-ingen-nej" data-ingen-nej>${T.revisionIngenNej}</p>` : ''}`;
}
