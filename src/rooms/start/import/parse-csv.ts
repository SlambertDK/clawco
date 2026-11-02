// KC-0129: a contacts CSV (Google Takeout / Google Contacts, English or Danish headers) → plain contacts. A real CSV
// reader (quotes, doubled quotes, newlines inside a quoted field); only the name, organisation, birthday and note
// columns are read. A file with no name column gives nothing.

import { KONTAKTER_MAKS, lavKontakt, type Kontakt } from './typer.ts';

const RAEKKER_MAKS = 20_000;

function raekker(tekst: string): string[][] {
  const ud: string[][] = [];
  let felt = '';
  let raekke: string[] = [];
  let citeret = false;
  const t = tekst.replace(/^﻿/, '');
  for (let i = 0; i < t.length && ud.length < RAEKKER_MAKS; i += 1) {
    const c = t[i];
    if (citeret) {
      if (c === '"') { if (t[i + 1] === '"') { felt += '"'; i += 1; } else citeret = false; } else felt += c;
    } else if (c === '"' && felt === '') citeret = true;
    else if (c === ',') { raekke.push(felt); felt = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i += 1;
      raekke.push(felt); felt = '';
      ud.push(raekke); raekke = [];
    } else felt += c;
  }
  if (felt !== '' || raekke.length) { raekke.push(felt); ud.push(raekke); }
  return ud;
}

const norm = (h: string): string => h.toLowerCase().replace(/\s+/g, ' ').trim();
const NAVN = ['name', 'navn', 'full name', 'fuldt navn'];
const FOERST = ['first name', 'given name', 'fornavn'];
const MELLEM = ['middle name', 'additional name', 'mellemnavn'];
const SIDST = ['last name', 'family name', 'efternavn'];
const ORG = ['organization name', 'organization 1 - name', 'organisation', 'organisation name', 'organisation 1 - name', 'virksomhed', 'firma', 'company'];
const DAG = ['birthday', 'fødselsdag', 'foedselsdag'];
const NOTE = ['notes', 'note', 'noter'];

export function parseCsv(tekst: string): Kontakt[] {
  const [hoved, ...krop] = raekker(tekst);
  if (!hoved) return [];
  const h = hoved.map(norm);
  const kol = (navne: string[]): number => h.findIndex((x) => navne.includes(x));
  const [iNavn, iFoerst, iMellem, iSidst, iOrg, iDag, iNote] = [NAVN, FOERST, MELLEM, SIDST, ORG, DAG, NOTE].map(kol) as [number, number, number, number, number, number, number];
  if (iNavn < 0 && iFoerst < 0 && iSidst < 0) return [];
  const ud: Kontakt[] = [];
  for (const r of krop) {
    if (ud.length >= KONTAKTER_MAKS) break;
    const v = (i: number): string => (i >= 0 ? (r[i] ?? '') : '');
    const navn = [v(iFoerst), v(iMellem), v(iSidst)].map((x) => x.trim()).filter(Boolean).join(' ') || v(iNavn);
    const k = lavKontakt({ navn, org: v(iOrg), foedselsdag: v(iDag), noter: v(iNote) });
    if (k) ud.push(k);
  }
  return ud;
}
