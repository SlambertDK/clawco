// KC-0128: the first value without the agent (spec §3 "value before
// completeness"). Built purely from what a source's first read returned — no
// model call — so something real stands in Nu seconds after connecting, while
// Hermes still rebuilds the room. Invariant (AGENTS §0 r2): every word comes
// from data actually read; the read is untrusted (spec D6), so it is parsed
// defensively here and every text goes through the escaper when rendered.
// Start imports nothing from src/kilder: the read arrives as { slags, hentet,
// data } and is checked field by field.

import { html, type Markup } from '../../shell/html.ts';
import { dagStr, friskhed, klokke, kildeFriskhed, type KildeFriskhed } from '../../shell/friskhed.ts';
import { visHoved, type IkonNavn } from '../../shell/visuel.ts';
import { spoerg } from '../../shell/sprog.ts';
import { zoneChip, zoneData } from '../../shell/zone.ts';
import type { Zoneret } from '../../identitet/zoner.ts';

/** A preview: which source, its one-line headline and detail, and when the source was read. */
export type Forhaandsvisning = { kildeId: string; navn: string; slags: string; titel: string; linje: string; hentet: string } & Zoneret;
export type KildeNavn = { id: string; navn: string; slags: string };
export type RaaLaesning = { slags: string; hentet: string; data: unknown };

const IKON: Record<string, IkonNavn> = { kalender: 'calendar', mail: 'mail', noter: 'file-text', nyheder: 'newspaper', beskeder: 'message-circle' };
const TEKST_MAKS = 120;

/** The stable element id of a source's preview, in Nu and in Start (the curated cards replace it, never beside it). */
export const forhaandsvisningId = (kildeId: string): string => `forhaandsvisning-${kildeId}`;

const erObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const tekst = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, TEKST_MAKS) : '');
const liste = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const flertal = (n: number, en: string, flere: string): string => `${n} ${n === 1 ? en : flere}`;
/** "a", "a og b", "a, b og c". */
const opremsning = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} og ${xs.at(-1)}`);

function kalender(data: unknown, nu: Date): { titel: string; linje: string } {
  const idag = dagStr(nu);
  const dage = erObj(data) ? liste(data['days']) : [];
  const events = dage.filter((d) => erObj(d) && d['date'] === idag).flatMap((d) => liste((d as Record<string, unknown>)['events'])).filter(erObj);
  if (!events.length) return { titel: 'Ingen aftaler i dag', linje: 'Kalenderen er forbundet. Hermes kigger på de næste dage.' };
  const titel = flertal(events.length, 'aftale i dag', 'aftaler i dag');
  const tidsat = events
    .filter((e) => e['all_day'] !== true && typeof e['start'] === 'string' && !Number.isNaN(Date.parse(e['start'])))
    .sort((a, b) => Date.parse(a['start'] as string) - Date.parse(b['start'] as string));
  const foerst = tidsat[0];
  if (foerst) return { titel, linje: `Første kl. ${klokke(new Date(foerst['start'] as string))}: ${tekst(foerst['title']) || '(uden titel)'}` };
  return { titel, linje: `Hele dagen: ${tekst(events[0]?.['title']) || '(uden titel)'}` };
}

function mail(data: unknown): { titel: string; linje: string } {
  const kuverter = liste(data).filter(erObj);
  const ulaeste = kuverter.filter((k) => k['laest'] !== true);
  if (!ulaeste.length) return { titel: 'Ingen ulæste', linje: `${flertal(kuverter.length, 'mail', 'mails')} læst, alle er læst.` };
  const tid = (k: Record<string, unknown>): number => { const t = Date.parse(String(k['modtaget'] ?? '')); return Number.isNaN(t) ? 0 : t; };
  const afsendere: string[] = [];
  for (const k of [...ulaeste].sort((a, b) => tid(b) - tid(a))) {
    const fra = tekst(k['fra']);
    if (fra && !afsendere.includes(fra)) afsendere.push(fra);
    if (afsendere.length === 3) break;
  }
  return { titel: flertal(ulaeste.length, 'ulæst', 'ulæste'), linje: afsendere.length ? `De nyeste fra ${opremsning(afsendere)}` : '' };
}

function andre(slags: string, data: unknown): { titel: string; linje: string } {
  if (slags === 'noter') {
    const noter = erObj(data) ? liste(data['noter']).filter(erObj) : [];
    const personer = erObj(data) ? liste(data['personer']) : [];
    return { titel: `${flertal(noter.length, 'note', 'noter')} og ${flertal(personer.length, 'menneske', 'mennesker')}`, linje: noter[0] ? `Senest: ${tekst(noter[0]['titel'])}` : '' };
  }
  if (slags === 'nyheder') {
    const nyheder = erObj(data) ? liste(data['nyheder']).filter(erObj) : [];
    return { titel: flertal(nyheder.length, 'nyhed', 'nyheder'), linje: nyheder[0] ? `Den nyeste: ${tekst(nyheder[0]['titel'])}` : '' };
  }
  const beskeder = liste(data).filter(erObj);
  const ulaeste = beskeder.filter((b) => b['laest'] !== true);
  const fra = [...new Set(ulaeste.map((b) => (erObj(b['afsender']) ? tekst(b['afsender']['navn']) : '')).filter(Boolean))].slice(0, 3);
  return { titel: flertal(ulaeste.length, 'ulæst besked', 'ulæste beskeder'), linje: fra.length ? `Fra ${opremsning(fra)}` : '' };
}

/** The preview of one source's first read. Pure; a malformed read gives the empty sentence of its slags, never a throw. */
export function byggForhaandsvisning(k: KildeNavn, l: RaaLaesning, nu: Date): Forhaandsvisning {
  const { titel, linje } = k.slags === 'kalender' ? kalender(l.data, nu) : k.slags === 'mail' ? mail(l.data) : andre(k.slags, l.data);
  return { kildeId: k.id, navn: k.navn, slags: k.slags, titel, linje, hentet: typeof l.hentet === 'string' ? l.hentet : '' };
}

/** The preview as a normal kort element (Nu and Start): source tag, freshness line, Ret. */
export function renderForhaandsvisning(f: Forhaandsvisning, now: Date, gammel?: KildeFriskhed): Markup {
  return html`<article class="card kort forhaandsvisning" data-blok="kort" data-forhaandsvisning="${f.kildeId}" data-kilde="${f.kildeId}"${zoneData(f)} data-element="Kortet: ${f.titel}">
    ${visHoved({ ikon: IKON[f.slags] ?? 'sparkles' }, f.titel, `Fra ${f.navn}`)}${zoneChip(f)}
    ${f.linje ? html`<p class="betydning">${f.linje}</p>` : ''}
    <p class="row-note">Første kig, før Hermes har tænkt · ${gammel ? kildeFriskhed(gammel, now) : friskhed(f.hentet, now)}</p>
    <div class="actions"><span class="vis-smaa">${spoerg(`Kortet: ${f.titel}`, 'Ret')}</span></div>
  </article>`;
}
