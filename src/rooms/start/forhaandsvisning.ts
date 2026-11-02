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
import { startTekst } from './tekster.ts';

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
/** "a", "a og b", "a, b og c" ("and" in English). */
const opremsning = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${startTekst().fv.og} ${xs.at(-1)}`);

function kalender(data: unknown, nu: Date): { titel: string; linje: string } {
  const T = startTekst().fv;
  const idag = dagStr(nu);
  const dage = erObj(data) ? liste(data['days']) : [];
  const events = dage.filter((d) => erObj(d) && d['date'] === idag).flatMap((d) => liste((d as Record<string, unknown>)['events'])).filter(erObj);
  if (!events.length) return { titel: T.ingenAftaler, linje: T.kalenderForbundet };
  const titel = T.aftaler(events.length);
  const tidsat = events
    .filter((e) => e['all_day'] !== true && typeof e['start'] === 'string' && !Number.isNaN(Date.parse(e['start'])))
    .sort((a, b) => Date.parse(a['start'] as string) - Date.parse(b['start'] as string));
  const foerst = tidsat[0];
  if (foerst) return { titel, linje: T.foerstKl(klokke(new Date(foerst['start'] as string)), tekst(foerst['title']) || T.udenTitel) };
  return { titel, linje: T.heleDagen(tekst(events[0]?.['title']) || T.udenTitel) };
}

function mail(data: unknown): { titel: string; linje: string } {
  const T = startTekst().fv;
  const kuverter = liste(data).filter(erObj);
  const ulaeste = kuverter.filter((k) => k['laest'] !== true);
  if (!ulaeste.length) return { titel: T.ingenUlaeste, linje: T.mailsLaest(kuverter.length) };
  const tid = (k: Record<string, unknown>): number => { const t = Date.parse(String(k['modtaget'] ?? '')); return Number.isNaN(t) ? 0 : t; };
  const afsendere: string[] = [];
  for (const k of [...ulaeste].sort((a, b) => tid(b) - tid(a))) {
    const fra = tekst(k['fra']);
    if (fra && !afsendere.includes(fra)) afsendere.push(fra);
    if (afsendere.length === 3) break;
  }
  return { titel: T.ulaeste(ulaeste.length), linje: afsendere.length ? T.nyesteFra(opremsning(afsendere)) : '' };
}

function andre(slags: string, data: unknown): { titel: string; linje: string } {
  const T = startTekst().fv;
  if (slags === 'noter') {
    const noter = erObj(data) ? liste(data['noter']).filter(erObj) : [];
    const personer = erObj(data) ? liste(data['personer']) : [];
    return { titel: T.noterOgMennesker(noter.length, personer.length), linje: noter[0] ? T.senest(tekst(noter[0]['titel'])) : '' };
  }
  if (slags === 'nyheder') {
    const nyheder = erObj(data) ? liste(data['nyheder']).filter(erObj) : [];
    return { titel: T.nyheder(nyheder.length), linje: nyheder[0] ? T.denNyeste(tekst(nyheder[0]['titel'])) : '' };
  }
  const beskeder = liste(data).filter(erObj);
  const ulaeste = beskeder.filter((b) => b['laest'] !== true);
  const fra = [...new Set(ulaeste.map((b) => (erObj(b['afsender']) ? tekst(b['afsender']['navn']) : '')).filter(Boolean))].slice(0, 3);
  return { titel: T.ulaesteBeskeder(ulaeste.length), linje: fra.length ? T.fra(opremsning(fra)) : '' };
}

/** The preview of one source's first read. Pure; a malformed read gives the empty sentence of its slags, never a throw. */
export function byggForhaandsvisning(k: KildeNavn, l: RaaLaesning, nu: Date): Forhaandsvisning {
  const { titel, linje } = k.slags === 'kalender' ? kalender(l.data, nu) : k.slags === 'mail' ? mail(l.data) : andre(k.slags, l.data);
  return { kildeId: k.id, navn: k.navn, slags: k.slags, titel, linje, hentet: typeof l.hentet === 'string' ? l.hentet : '' };
}

/** The preview as a normal kort element (Nu and Start): source tag, freshness line, Ret. */
export function renderForhaandsvisning(f: Forhaandsvisning, now: Date, gammel?: KildeFriskhed): Markup {
  const T = startTekst().fv;
  return html`<article class="card kort forhaandsvisning" data-blok="kort" data-forhaandsvisning="${f.kildeId}" data-kilde="${f.kildeId}"${zoneData(f)} data-element="${T.kortet(f.titel)}">
    ${visHoved({ ikon: IKON[f.slags] ?? 'sparkles' }, f.titel, T.fraKilde(f.navn))}${zoneChip(f)}
    ${f.linje ? html`<p class="betydning">${f.linje}</p>` : ''}
    <p class="row-note">${T.foersteKig} · ${gammel ? kildeFriskhed(gammel, now) : friskhed(f.hentet, now)}</p>
    <div class="actions"><span class="vis-smaa">${spoerg(T.kortet(f.titel), T.ret)}</span></div>
  </article>`;
}
