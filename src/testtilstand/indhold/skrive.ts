// Skrive in the test world (KC-0068): empty until the meeting is over, then
// the follow-up to Clara with two proposals (one new paragraph, one rewrite);
// by evening one proposal is used and the text is saved in Obsidian. Lifted
// from the demo's historie.ts (KC-0058).

import type { LogEntry } from '../../store/types.ts';
import { tomtState, type Dokument, type Forslag, type SkriveState } from '../../rooms/skrive/schema.ts';
import type { Fakta } from './fakta.ts';
import { logFra } from './faelles.ts';
import { OPFOELGNING } from './dagen.ts';

export function opfoelgningAfsnit(f: Fakta): string[] {
  return [
    'Hej Clara. Tak for et godt og konkret møde i dag.',
    'Vi lander på den nordlige rute som udgangspunkt. Den er otte kilometer længere, men den er godkendt, og den kræver ingen dispensation. Det beskytter produktionsslottet i december, som var dit største hensyn.',
    `Jonas bekræfter kapaciteten i tilslutningspunktet senest ${f.kort(7)}. Jeg vender tilbage til dig samme dag, så du kan give leverandøren besked. Venlig hilsen Henrik`,
  ];
}

export const OPFOELGNING_KILDER = (f: Fakta): string[] => [`Notat fra mødet ${f.forrigeKort}`, 'Mødet i dag: nordlig rute som udgangspunkt (Havvind Nord)'];

const DOK_ID = 'dok-t3st0001';
const NY_A3 = (f: Fakta): string => `Jonas bekræfter kapaciteten i tilslutningspunktet (600 eller 800 MW) senest ${f.kort(7)}. Jeg skriver til dig samme dag, så du kan give leverandøren besked. Venlig hilsen Henrik`;
const filnavn = (f: Fakta): string => `${f.dag} ${OPFOELGNING.replace(/[\\/:*?"<>|]+/g, '-')}.md`;

export function skriveState(n: number, f: Fakta): SkriveState {
  if (n < 4) return tomtState();
  const afsnit = opfoelgningAfsnit(f).map((tekst, i) => ({ id: `a${i + 1}`, tekst }));
  const dok: Dokument = {
    id: DOK_ID, titel: OPFOELGNING, brief: 'Opfølgning til Clara Holm efter mødet i dag: nordlig rute som udgangspunkt, tidsplanen og næste skridt.',
    afsnit, kilder: OPFOELGNING_KILDER(f), oprettet: f.iso('12:10'), aendret: f.iso('12:10'),
  };
  const indsaet: Forslag = {
    id: 'f-t3st0001', dokId: DOK_ID, afsnitId: null, efterId: 'a2',
    ny: 'Vi mangler stadig at aftale, hvem der bærer meromkostningen på cirka 40 millioner kroner. Jeg foreslår, at vi tager den på næste møde, når begge sider har regnet.',
    hvorfor: 'Mødet endte uden en aftale om fordelingen; Clara bør vide, at den stadig er åben.', tid: f.iso('12:11'),
  };
  const konkret: Forslag = { id: 'f-t3st0002', dokId: DOK_ID, afsnitId: 'a3', ny: NY_A3(f), hvorfor: 'Tal i stedet for vage ord.', tid: f.iso('14:20') };
  if (n === 4) return { dokumenter: [dok], aktivt: DOK_ID, hermesStatus: `Skriver med på "${OPFOELGNING}"`, forslag: [indsaet, konkret] };
  // Evening: the rewrite of a3 is used (14.45), the new paragraph was turned down, and the text is saved in Obsidian (15.00).
  const brugt: Dokument = { ...dok, afsnit: afsnit.map((a) => (a.id === 'a3' ? { ...a, tekst: NY_A3(f) } : a)), aendret: f.iso('14:45'), gemtSom: filnavn(f) };
  return { dokumenter: [brugt], aktivt: DOK_ID, hermesStatus: 'Klar til at skrive', forslag: [] };
}

export function skriveLog(f: Fakta, n: number): LogEntry[] {
  const gammelA3 = opfoelgningAfsnit(f)[2] ?? '';
  return logFra('skrive', [
    { fra: 4, hhmm: '12:10', kilde: 'hermes', tekst: `Skrev udkastet "${OPFOELGNING}" (3 afsnit).` },
    { fra: 5, hhmm: '14:45', kilde: 'henrik', tekst: `Brugte Hermes' forslag til afsnit 3 i "${OPFOELGNING}".`, handlingId: 'brug-f-t3st0002', fortryd: `lokal:${JSON.stringify({ dokId: DOK_ID, afsnitId: 'a3', tekst: gammelA3 })}` },
    { fra: 5, hhmm: '15:00', kilde: 'system', tekst: `Gemte "${OPFOELGNING}" i Obsidian-indbakken (${filnavn(f)}).` },
  ], n, f);
}
