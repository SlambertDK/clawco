// The udviklingspipeline in the test world (KC-0068): what Henrik has sent to
// Claude Code, as Hjem shows it — every status of an opgave through the day, a
// question back, a done one and a rolled-back one (so the trust numbers,
// KC-0048, are not empty). New against main's udvikling/opgaver.ts; all
// fictional and never sent anywhere (the test world has no worker).

import type { Grundlag, Opgave, OpgaveStatus, Spoergsmaal } from '../../udvikling/opgaver.ts';
import { findProjekt } from '../../udvikling/projekter.ts';
import type { Fakta } from './fakta.ts';
import type { LogPost } from './faelles.ts';

const PROJEKT = 'kontrolcenter';
const REPO = findProjekt(PROJEKT)?.repo ?? PROJEKT;

export const FEJL_KORT_TITEL = 'Fejlvagten: tre nye fejl på kontrolcentret i nat';

type Trin = { status: OpgaveStatus; tid: string; ticket?: string; bevis?: string; grund?: string; spoergsmaal?: Omit<Spoergsmaal, 'stillet'>; svar?: string; tilbagerullet?: string };

/** One opgave as it stands after the last of `trin` that happened by now (ISO); undefined before it was sent. */
function opgave(id: string, saetning: string, oprettet: string, trin: Trin[], nu: string, grundlag: Grundlag | null = null): Opgave | undefined {
  if (oprettet > nu) return undefined;
  const o: Opgave = { id, projekt: PROJEKT, repo: REPO, saetning, grundlag, kilde: grundlag && grundlag.linjer.length ? 'kort' : 'chat', oprettet, opdateret: oprettet, status: 'sendt' };
  for (const t of trin) {
    if (t.tid > nu) break;
    o.status = t.status;
    o.opdateret = t.tid;
    if (t.ticket) o.ticket = t.ticket;
    if (t.bevis) o.bevis = t.bevis;
    if (t.grund) o.grund = t.grund;
    if (t.tilbagerullet) o.tilbagerullet = t.tilbagerullet;
    if (t.status === 'faerdig' && !o.faerdigTid) o.faerdigTid = t.tid;
    if (t.status !== 'parkeret') { delete o.spoergsmaal; delete o.svar; }
    if (t.spoergsmaal) o.spoergsmaal = { ...t.spoergsmaal, stillet: t.tid };
    if (t.svar) o.svar = { tekst: t.svar, tid: t.tid };
  }
  return o;
}

/** Every opgave that exists at `nu` (ISO), oldest first, as the udvikling room stores them. */
export function opgaver(f: Fakta, nu: string): Opgave[] {
  const fejlGrundlag: Grundlag = { titel: FEJL_KORT_TITEL, linjer: ['Tre fejl i nat, alle i Mail-rummet, når en mail mangler afsender.', 'Første gang 02.14, sidst 04.51.'], kilder: [] };
  const alle = [
    opgave('o-mailknapper', 'Gør knapperne i Mail større på telefonen', f.iso('20:15', -3), [
      { status: 'modtaget', tid: f.iso('20:20', -3), ticket: 'KC-0902' },
      { status: 'faerdig', tid: f.iso('21:05', -3), bevis: 'Typecheck og alle tests grønne; knapperne er 48 px høje på telefonbredde.' },
      { status: 'faerdig', tid: f.iso('08:30', -2), tilbagerullet: f.plus(-2), bevis: 'Rullet tilbage: Send blev skubbet ud over kanten på en lille telefon.' },
    ], nu),
    opgave('o-tidslinjeregn', 'Vis regnens tidsrum på tidslinjen i Dagen', f.iso('09:10', -2), [
      { status: 'modtaget', tid: f.iso('09:12', -2), ticket: 'KC-0901' },
      { status: 'i-gang', tid: f.iso('09:20', -2) },
      { status: 'faerdig', tid: f.iso('10:02', -2), bevis: 'Typecheck og alle tests grønne; regnen ses som en zone på tidslinjen på telefonbredde.' },
    ], nu),
    opgave('o-nyhedsorden', 'Sortér Nyheder efter, hvad der betyder noget for arbejdet', f.iso('16:00', -1), [
      { status: 'modtaget', tid: f.iso('16:05', -1), ticket: 'KC-0904' },
      { status: 'i-gang', tid: f.iso('16:30', -1) },
      { status: 'faerdig', tid: f.iso('09:10'), bevis: 'Typecheck og alle tests grønne; arbejdsbanen står øverst i Nyheder.' },
    ], nu),
    opgave('o-koepanel', 'Flyt Kø-panelet ind i menuen', f.iso('19:00', -1), [
      { status: 'modtaget', tid: f.iso('19:10', -1), ticket: 'KC-0905' },
      { status: 'parkeret', tid: f.iso('19:40', -1), grund: 'Kræver dit valg af, hvor i menuen panelet skal stå; se ticketten.' },
      // KC-0103: Henrik answers it late in the evening, so from then on nothing waits on him.
      { status: 'parkeret', tid: f.iso('21:50'), svar: 'Nederst i menuen' },
    ], nu),
    opgave('o-vejrhilsen', 'Læg dagens vejr i hilsenen på Hjem', f.iso('21:05', -1), [
      { status: 'modtaget', tid: f.iso('08:02'), ticket: 'KC-0903' },
      { status: 'i-gang', tid: f.iso('10:30') },
      { status: 'parkeret', tid: f.iso('14:05'), grund: 'Venter på dit valg.', spoergsmaal: { tekst: 'Skal vejret stå i hilsenen hele dagen eller kun om morgenen?', valg: ['Kun om morgenen', 'Hele dagen'] } },
      { status: 'parkeret', tid: f.iso('14:40'), svar: 'Kun om morgenen' },
      { status: 'faerdig', tid: f.iso('16:20'), bevis: 'Typecheck og alle tests grønne; vejret står i hilsenen indtil kl. 10.' },
    ], nu),
    opgave('o-natfejl', 'Ret de tre fejl fra i nat i Mail-rummet', f.iso('10:05'), [
      { status: 'modtaget', tid: f.iso('10:12'), ticket: 'KC-0906' },
      { status: 'i-gang', tid: f.iso('11:02') },
      { status: 'faerdig', tid: f.iso('13:30'), bevis: 'En mail uden afsender viser nu "(ukendt afsender)"; ny test dækker det.' },
    ], nu, fejlGrundlag),
  ];
  return alle.filter((o): o is Opgave => o !== undefined).sort((a, b) => a.oprettet.localeCompare(b.oprettet));
}

/** The lines the pipeline leaves in Hjem's log (as udvikling/udvikling.ts writes them). */
export function udviklingLog(f: Fakta): LogPost[] {
  const sendt = 'Sendte til Claude Code (Kontrolcenter): ';
  return [
    { fra: 0, ved: f.iso('21:05', -1), kilde: 'henrik', tekst: `${sendt}Læg dagens vejr i hilsenen på Hjem` },
    { fra: 1, hhmm: '08:02', kilde: 'system', tekst: 'Claude Code: modtaget som KC-0903 — Læg dagens vejr i hilsenen på Hjem' },
    { fra: 1, hhmm: '09:10', kilde: 'system', tekst: 'Claude Code: KC-0904 er færdig — Sortér Nyheder efter, hvad der betyder noget for arbejdet' },
    { fra: 2, hhmm: '10:05', kilde: 'henrik', tekst: `${sendt}Ret de tre fejl fra i nat i Mail-rummet` },
    { fra: 2, hhmm: '10:12', kilde: 'system', tekst: 'Claude Code: modtaget som KC-0906 — Ret de tre fejl fra i nat i Mail-rummet' },
    { fra: 2, hhmm: '10:30', kilde: 'system', tekst: 'Claude Code: KC-0903 er i gang — Læg dagens vejr i hilsenen på Hjem' },
    { fra: 3, hhmm: '11:02', kilde: 'system', tekst: 'Claude Code: KC-0906 er i gang — Ret de tre fejl fra i nat i Mail-rummet' },
    { fra: 4, hhmm: '13:30', kilde: 'system', tekst: 'Claude Code: KC-0906 er færdig — Ret de tre fejl fra i nat i Mail-rummet' },
    { fra: 4, hhmm: '14:05', kilde: 'system', tekst: 'Claude Code: KC-0903 er parkeret — Læg dagens vejr i hilsenen på Hjem' },
    { fra: 4, hhmm: '14:05', kilde: 'system', tekst: 'Claude Code spørger (KC-0903): Skal vejret stå i hilsenen hele dagen eller kun om morgenen?' },
    { fra: 5, hhmm: '14:40', kilde: 'henrik', tekst: 'Svarede Claude Code (KC-0903): Kun om morgenen' },
    { fra: 5, hhmm: '16:20', kilde: 'system', tekst: 'Claude Code: KC-0903 er færdig — Læg dagens vejr i hilsenen på Hjem' },
    { fra: 6, hhmm: '21:50', kilde: 'henrik', tekst: 'Svarede Claude Code (KC-0905): Nederst i menuen' },
  ];
}
