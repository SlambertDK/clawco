// KC-0242: fixed inputs for the three Danish leftovers of what Hermes reads: the rules block of a rules file that cannot
// be read (tillid/prompt.ts, one case per reason), the words of where a hidden item came from in the Sunday check's run
// (kurator/kortprompt.ts) and the weekend card's fixed sentences (hushold/konflikt.ts). `rester(DA)` is rendered with no
// language chosen and inside medSprog('da', ...) and held byte for byte to the files in test/fixtures/sprog-rester-tillid/,
// captured from the code BEFORE the words moved into the language tables. `rester(EN)` has the same cases over English
// content, so an English render shows only the words the code itself owns. Change a golden only when the Danish copy
// changes on purpose.

import { reglerTilPrompt } from '../../src/tillid/prompt.ts';
import { ULAESELIG } from '../../src/tillid/tekster.ts';
import { buildSkjultRun } from '../../src/kurator/kortprompt.ts';
import { konfliktResume, nytKonflikt, weekendKonflikter, type Blok, type Konflikt } from '../../src/hushold/konflikt.ts';
import type { Medlem, Ressource } from '../../src/hushold/schema.ts';

export type Indhold = { ejer: string; voksen: string; barn: string; titelA: string; titelB: string; bil: string; skjult: string };

export const DA: Indhold = { ejer: 'Henrik', voksen: 'Rikke', barn: 'Nora', titelA: 'cykeltur', titelB: 'kaffe med Anne', bil: 'Den store bil', skjult: 'Nyhedsbrev' };
export const EN: Indhold = { ejer: 'Henrik', voksen: 'Maja', barn: 'Nora', titelA: 'football match', titelB: 'coffee with Anne', bil: 'The big car', skjult: 'Newsletter' };

const NOW = new Date('2026-11-01T10:00:00Z');
const NU = new Date('2026-11-03T06:30:00Z');
const LOERDAG = '2026-11-07';

const medlemmerAf = (i: Indhold): Medlem[] => [
  { id: 'henrik', navn: i.ejer, rolle: 'ejer', tailnetLogin: 'henrik@example.com' },
  { id: 'maja', navn: i.voksen, rolle: 'medlem', tailnetLogin: 'maja@example.com' },
  { id: 'nora', navn: i.barn, rolle: 'barn' },
];
const blok = (hvem: string, fra: string, til: string, titel?: string): Blok =>
  ({ hvem, start: `${LOERDAG}T${fra}:00+01:00`, slut: `${LOERDAG}T${til}:00+01:00`, med: [hvem], ...(titel ? { titel } : {}) });

/** A weekend card for the household of `i`: a child to cover (`barn`) or a booked resource, with or without shared titles. */
function konflikt(i: Indhold, slags: 'barn' | 'ressource', medTitler: boolean, halvTime = false): Konflikt {
  const medlemmer = medlemmerAf(i);
  const voksne = medlemmer.slice(0, 2);
  const bil: Ressource = { id: 'bil', navn: i.bil, slags: 'bil', ejere: [], kalender: [{ id: 'b1', ressourceId: 'bil', af: 'henrik', start: `${LOERDAG}T08:00:00+01:00`, slut: `${LOERDAG}T16:00:00+01:00`, titel: 'x' }] };
  const blokke = [blok('henrik', halvTime ? '09:30' : '09:00', '14:00', medTitler ? i.titelA : undefined), blok('maja', '11:00', halvTime ? '13:30' : '13:00', medTitler ? i.titelB : undefined)];
  const h = slags === 'barn' ? { medlemmer, ressourcer: [] } : { medlemmer: voksne, ressourcer: [bil] };
  return nytKonflikt({ id: 'k1', nu: NU, kandidat: weekendKonflikter(blokke, h, [LOERDAG])[0]! });
}

export type Tilfaelde = Record<string, () => string>;

export function rester(i: Indhold): Tilfaelde {
  const ud: Tilfaelde = {};
  for (const [navn, hvorfor] of Object.entries(ULAESELIG)) ud[`ulaeselig-${navn}`] = () => `${reglerTilPrompt({ tilstand: 'ulaeselig', hvorfor, aendretUdenfor: false })}\n`;
  ud['ulaeselig-ukendt'] = () => `${reglerTilPrompt({ tilstand: 'ulaeselig', hvorfor: 'some other reason', aendretUdenfor: false })}\n`;
  for (const kilde of ['kuratoren', 'mail', 'andet']) {
    ud[`skjult-${kilde}`] = () => { const r = buildSkjultRun({ titel: i.skjult, kilde }, undefined, NOW, undefined); return `=== instructions ===\n${r.instructions.replace(/\b[0-9a-f]{24}\b/g, 'GRAENSE')}\n=== input ===\n${r.input.replace(/\b[0-9a-f]{24}\b/g, 'GRAENSE')}\n`; };
  }
  const fast = (k: Konflikt, m: Medlem[]): string => { const r = konfliktResume(k, m); return `${r.resume}\n${r.spoergsmaal}\n`; };
  ud['konflikt-barn-titler'] = () => fast(konflikt(i, 'barn', true), medlemmerAf(i));
  ud['konflikt-barn-optaget'] = () => fast(konflikt(i, 'barn', false), medlemmerAf(i));
  ud['konflikt-barn-halve-timer'] = () => fast(konflikt(i, 'barn', true, true), medlemmerAf(i));
  ud['konflikt-ressource-optaget'] = () => fast(konflikt(i, 'ressource', false), medlemmerAf(i));
  ud['konflikt-ukendt-medlem'] = () => fast(konflikt(i, 'barn', false), medlemmerAf(i).slice(0, 1));
  return ud;
}
