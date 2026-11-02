// Univers in the test world (KC-0068): Havvind Nord through the day — notes
// from the earlier meeting, the meeting at 11 prepared at 08.10 (so "Lige før
// et møde" and "Under mødet" show the meeting situation), and what the meeting
// decided — plus Huset, and one calendar meeting waiting for a univers. Built
// with the app's own element operations so every Fortryd is real. Lifted from
// the demo's historie.ts and dokumenter.ts (KC-0058).

import { anvendElementer, anvendForberedelse } from '../../rooms/univers/lager.ts';
import { beskrivAendring } from '../../rooms/univers/room.ts';
import { htmlTilTekst, type ForberedelseSvar, type Moede, type MoedeKandidat, type NyId, type NytElement, type UniversIndeks, type UniversState } from '../../rooms/univers/schema.ts';
import type { Fakta } from './fakta.ts';
import { isoDato } from './fakta.ts';
import { lokal, type LogPost } from './faelles.ts';
import { MOEDE_TITEL, NYHEDEN_TITEL } from './kilder.ts';

export const HAVVIND = 'havvind-nord';
export const HUSET = 'huset';
export const MOEDE_ID = 'moede-t3st0002';
const FORRIGE_ID = 'moede-t3st0001';
const KANDIDAT_ID = 'test-foraeldremoede';

export const TALEPUNKTER = [
  'Valget af kabeltracé: nordlig rute som udgangspunkt',
  'Tidsplanen: kabelleverandørens produktionsslot i december',
  'Hvem bærer meromkostningen ved den nordlige rute',
  'Næste skridt: Jonas bekræfter tilslutningspunktet',
] as const;

// ---------- The documents: one self-contained dark HTML file each, inline CSS, no scripts ----------

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CSS = `body{margin:0;background:#0E1210;color:#E8EDE9;font-family:Inter,system-ui,sans-serif;line-height:1.5}
section{box-sizing:border-box;width:100%;min-height:58vh;padding:52px 8vw;border-bottom:1px solid #26302B;display:flex;flex-direction:column;justify-content:center}
h1{font-size:2.5rem;margin:0 0 12px}h2{font-size:1.8rem;margin:0 0 14px;color:#7FD6A4}p,li{font-size:1.2rem;max-width:48rem}
.sub{color:#9FB0A6}.kolonner{display:flex;gap:24px;flex-wrap:wrap}.kasse{flex:1 1 260px;border:1px solid #26302B;border-radius:12px;padding:18px 22px;background:#141A17}
.kasse h3{margin:0 0 8px;font-size:1.25rem}.valgt{border-color:#7FD6A4}.tal{font-family:ui-monospace,Menlo,monospace;color:#7FD6A4}`;

/** A single dark page: a title and one section per entry. */
export function enkeltSide(titel: string, sektioner: { overskrift: string; punkter: string[] }[], under?: string): string {
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><title>${esc(titel)}</title><style>${CSS}</style></head><body>
<section><h1>${esc(titel)}</h1>${under ? `<p class="sub">${esc(under)}</p>` : ''}</section>
${sektioner.map((s) => `<section><h2>${esc(s.overskrift)}</h2><ul>${s.punkter.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></section>`).join('\n')}
</body></html>`;
}

function slidesHtml(f: Fakta): string {
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><title>Havvind Nord: valg af kabeltracé</title><style>${CSS}</style></head><body>
<section><h1>Havvind Nord: valg af kabeltracé</h1><p class="sub">Møde med Nordvik Energi, ${esc(f.lang(0))} klokken 11.00</p></section>
<section><h2>To ruter</h2><div class="kolonner">
<div class="kasse"><h3>Vestlig rute</h3><p><span class="tal">74 km</span>, kortest og billigst. Går gennem et beskyttet område og kræver en dispensation: op til fem måneder.</p></div>
<div class="kasse valgt"><h3>Nordlig rute</h3><p><span class="tal">82 km</span>, cirka 40 mio. kr. dyrere. Godkendt af myndighederne i morges; ingen dispensation.</p></div>
</div></section>
<section><h2>Tidsplanen</h2><ul><li>Kabelleverandøren holder et produktionsslot i december.</li><li>Slottet bliver kun holdt, hvis ruten er valgt inden ${esc(f.slotFrist)}.</li><li>Ellers rykker udlægningen et helt sæsonvindue.</li></ul></section>
<section><h2>Meromkostningen</h2><ul><li>Otte kilometer ekstra kabel: cirka 40 mio. kr.</li><li>Ingen aftale om fordelingen endnu.</li><li>Forslag: tag fordelingen på næste møde, når begge sider har regnet.</li></ul></section>
<section><h2>Næste skridt</h2><ul><li>Nordlig rute som udgangspunkt.</li><li>Jonas Berg bekræfter tilslutningspunktet senest ${esc(f.kort(7))}.</li><li>Opfølgning til Clara Holm i dag.</li></ul></section>
</body></html>`;
}

function traceNotatHtml(f: Fakta): string {
  return enkeltSide('Tracé-notat: Havvind Nord', [
    { overskrift: 'Vestlig rute', punkter: ['74 kilometer fra landingspunktet til parken.', 'Går gennem et beskyttet område: dispensation kræves, miljøvurderingen anslår op til fem måneder.', 'Billigste løsning, men ikke godkendt.'] },
    { overskrift: 'Nordlig rute', punkter: ['82 kilometer, otte kilometer længere.', 'Cirka 40 mio. kr. dyrere end den vestlige.', 'Korridoren er godkendt; ingen dispensation.'] },
    { overskrift: 'Tilslutningspunktet', punkter: ['Samme landingspunkt for begge ruter.', 'Kan modtage 600 MW uden forstærkning; 800 MW kræver ny beregning (Jonas Berg).'] },
    { overskrift: 'Åbne punkter', punkter: ['Hvem bærer meromkostningen ved den nordlige rute?', `Bekræftelse af produktionsslottet i december; frist ${f.slotFrist}.`] },
  ], `Samlet efter tracé-workshoppen den ${f.forrigeKort}`);
}

// ---------- The meeting's preparation ----------

export const FORB_MAAL = 'Få kabeltracéet valgt, så Nordvik kan holde produktionsslottet i december, og få en dato fra Jonas på tilslutningspunktet.';

export function forberedelseSvar(f: Fakta, maal = FORB_MAAL): ForberedelseSvar {
  return {
    maal,
    deltagere: [
      { navn: 'Clara Holm', hvem: 'Projektleder hos Nordvik Energi; din kontakt i Havvind Nord', baggrund: 'Har ledet projektet siden starten. Fik i morges grønt lys til den nordlige kabelkorridor.', vil: 'have en beslutning i dag, så tidsplanen holder, og være sikker på produktionsslottet hos kabelleverandøren.' },
      { navn: 'Jonas Berg', hvem: 'Din kollega hos Vestnet; ansvarlig for tilslutningspunktet', baggrund: `Har regnet på kapaciteten ved landingspunktet og var med den ${f.forrigeKort}.`, vil: 'sikre, at nettet kan modtage effekten, før I binder jer til en rute.' },
    ],
    talepunkter: [...TALEPUNKTER],
    talepunktIkoner: ['route', 'calendar-clock', 'scale', 'zap'],
    opgaver: [
      { titel: 'Find tallet på meromkostningen ved den nordlige rute', note: 'Jonas har skønnet cirka 40 mio. kr.; bekræft før mødet.' },
      { titel: 'Bed Jonas om en dato for kapacitetstallene', note: 'Clara kommer til at spørge.' },
    ],
    praesentation: { titel: `Præsentation: ${MOEDE_TITEL}`, html: slidesHtml(f) },
  };
}

/** A meeting Hermes knows nothing about: a general preparation, with its guesses marked. */
export function genereltMoede(titel: string, deltagere: string[], onske: string | undefined): ForberedelseSvar {
  const maal = onske && !onske.startsWith('(ikke oplyst') ? onske : `Få mest muligt ud af mødet "${titel}" (gæt: Hermes kender ikke dit mål endnu).`;
  return {
    maal,
    deltagere: deltagere.map((navn) => ({ navn, hvem: 'Deltager (gæt: tjek kartoteket)', baggrund: 'Hermes har ikke mere om personen endnu.', vil: 'Sandsynligvis at høre dit udgangspunkt (gæt).' })),
    talepunkter: ['Åbn med, hvad du vil have ud af mødet', 'Spørg ind til, hvad den anden side har brug for', 'Aftal, hvem der gør hvad, og hvornår I mødes næste gang'],
    talepunktIkoner: ['target', 'message-circle', 'list-checks'],
    opgaver: [{ titel: 'Skriv de to spørgsmål ned, du vil stille', note: 'Så de ikke glemmes i samtalen.' }],
    praesentation: { titel: `Præsentation: ${titel}`, html: enkeltSide(titel, [{ overskrift: 'Hvorfor nu', punkter: ['Det er tid til at få afklaret, hvad der forventes.'] }, { overskrift: 'Næste skridt', punkter: ['Vi aftaler, hvem der gør hvad, og hvornår vi ses igen.'] }]) },
  };
}

// ---------- Havvind Nord through the day ----------

type Forloeb = { stadier: [UniversState, UniversState, UniversState]; log: LogPost[] };

/** Stage 0 before the preparation, 1 after it (08.10) and the news note (08.15), 2 after the meeting (12.05). */
export function havvindForloeb(f: Fakta): Forloeb {
  const teller: Record<string, number> = {};
  const nyId: NyId = (p) => `${p}-${(0xa1000 + (teller[p] = (teller[p] ?? 0) + 1)).toString(16).padStart(8, '0')}`;
  const tidl = (hhmm: string): string => isoDato(f.forrige, hhmm);
  const deltagere = [{ navn: 'Clara Holm' }, { navn: 'Jonas Berg' }];
  const forrige: Moede = { id: FORRIGE_ID, kilde: 'kalender', eventId: 'test-trace-workshop', titel: `Tracé-workshop ${f.forrigeKort}`, start: tidl('10:00'), slut: tidl('11:30'), sted: 'Mødelokale 2', deltagere };
  const idag: Moede = { id: MOEDE_ID, kilde: 'kalender', eventId: 'test-havvind-11', titel: MOEDE_TITEL, start: f.iso('11:00'), slut: f.iso('12:00'), sted: 'Mødelokale 2', deltagere };
  const trace = traceNotatHtml(f);
  const s0: UniversState = {
    dokumenter: [{ zone: 'privat', id: 'dok-0a110001', titel: 'Tracé-notat: de to ruter', html: trace, tekst: htmlTilTekst(trace), versioner: [], moedeId: FORRIGE_ID, oprettet: tidl('12:10'), aendret: tidl('12:10') }],
    noter: [
      { zone: 'privat', id: 'note-0a110001', titel: `Notat fra mødet ${f.forrigeKort}`, oprettet: tidl('11:40'), tekst: 'Clara lagde de to ruter frem: vestlig 74 km med dispensation, nordlig 82 km og cirka 40 mio. kr. dyrere. Jonas: tilslutningspunktet kan modtage 600 MW uden forstærkning; 800 MW kræver ny beregning, og tallene følger. Clara: slottet hos kabelleverandøren er bundet til en frist; misser vi den, rykker udlægningen et sæsonvindue. Beslutningen blev udskudt. Henrik hælder mod den nordlige rute, hvis Jonas kan stå inde for tilslutningspunktet.' },
      { zone: 'privat', id: 'note-0a110002', titel: `Claras krav fra ${f.forrigeKort}`, oprettet: tidl('11:55'), tekst: 'Clara vil have en afgørelse af kabeltracéet, før slottet i december udløber, og en skriftlig bekræftelse fra leverandøren. Hun forventer ikke, at Vestnet bærer hele meromkostningen, men vil have fordelingen på dagsordenen.' },
    ],
    opgaver: [
      { id: 'opg-0a110001', titel: 'Indhent miljøvurdering af den vestlige rute', note: 'Modtaget: dispensationen kan tage op mod fem måneder.', status: 'faerdig' },
      { id: 'opg-0a110002', titel: 'Få kabelleverandørens bekræftelse på produktionsslottet', note: 'Clara: slottet er bundet til en frist om to uger. Står stadig åben.', status: 'igang' },
    ],
    moeder: [forrige, idag], hermesStatus: 'Klar',
  };
  const r1 = anvendForberedelse(s0, MOEDE_ID, forberedelseSvar(f), new Date(f.iso('08:10')), nyId);
  const nyhed: NytElement[] = [{ type: 'note', zone: 'privat', titel: `Nyhed: ${NYHEDEN_TITEL}`, tekst: 'Myndighederne har godkendt Nordviks nordlige kabelkorridor. Den vestlige rute kræver stadig en dispensation. Det er det valg, I tager kl. 11 med Clara: nordlig rute er den godkendte.' }];
  const r2 = anvendElementer({ ...r1.state, hermesStatus: `Forberedte "${MOEDE_TITEL}"` }, nyhed, new Date(f.iso('08:15')), nyId);
  const efter: NytElement[] = [
    { type: 'note', zone: 'privat', titel: 'Mødet i dag: nordlig rute som udgangspunkt', tekst: `Enige om den nordlige rute som udgangspunkt. Jonas bekræfter tilslutningspunktet inden for en uge (senest ${f.kort(7)}). Fordelingen af meromkostningen (cirka 40 mio. kr.) tages på næste møde. Clara skal have besked samme dag, så hun kan holde produktionsslottet i december.` },
    { type: 'opgave', titel: 'Send opfølgning til Clara Holm om nordlig rute', note: 'Skal ud i dag; udkast ligger i Skrive.' },
    { type: 'opgave', titel: 'Få Jonas til at bekræfte kapaciteten i tilslutningspunktet', note: `Senest ${f.kort(7)}.` },
  ];
  const r3 = anvendElementer({ ...r2.state, hermesStatus: 'Noterede mødet i Havvind Nord' }, efter, new Date(f.iso('12:05')), nyId);
  const forb = forberedelseSvar(f);
  const dele = `${forb.talepunkter.length} talepunkter, ${forb.opgaver.length} opgaver, en præsentation`;
  return {
    stadier: [s0, { ...r2.state, hermesStatus: `Forberedte "${MOEDE_TITEL}"` }, { ...r3.state, hermesStatus: 'Noterede mødet i Havvind Nord' }],
    log: [
      { fra: 0, ved: tidl('12:15'), kilde: 'hermes', tekst: `Hermes lavede 1 dokument og 2 noter: "Tracé-notat: de to ruter", "Notat fra mødet ${f.forrigeKort}" og 1 til.` },
      { fra: 1, hhmm: '08:10', kilde: 'hermes', tekst: `Hermes forberedte mødet "${MOEDE_TITEL}": ${dele}.`, handlingId: `forbered-${MOEDE_ID}`, fortryd: lokal(r1.fortryd) },
      { fra: 1, hhmm: '08:15', kilde: 'hermes', tekst: beskrivAendring(r2.beroert), fortryd: lokal(r2.fortryd) },
      { fra: 4, hhmm: '12:05', kilde: 'hermes', tekst: beskrivAendring(r3.beroert), fortryd: lokal(r3.fortryd) },
    ],
  };
}

/** Which stage of Havvind Nord is on disk at moment `n`. */
export const havvindStadie = (n: number): 0 | 1 | 2 => (n >= 4 ? 2 : n >= 1 ? 1 : 0);

export function husetState(n: number, f: Fakta): UniversState {
  const efter = n >= 2;
  return {
    dokumenter: [],
    noter: [{ zone: 'privat', id: 'note-0b220001', titel: 'Eltavlen i kælderen', tekst: 'Tavlen er gammel og har otte grupper. Elektrikeren anbefaler ny tavle med fejlstrømsafbryder.', oprettet: f.iso('20:10', -12) }],
    opgaver: [
      { id: 'opg-0b220001', titel: 'Få tilbud på ny eltavle', note: 'Tilbud modtaget: 18.400 kr. inkl. moms.', status: 'faerdig' },
      { id: 'opg-0b220002', titel: 'Betal VVS-fakturaen til Rørvang VVS', note: efter ? `4.210 kr., forfald ${f.forfald}. Ligger i Betalinger; godkend den i din bank.` : `4.210 kr., forfald ${f.forfald}. Matcher tilbuddet.`, status: 'aaben' },
      ...(efter ? [{ id: 'opg-0b220003', titel: 'Afvent ny pris uden de to ekstra grupper', note: 'Kladden til Lysnet El-service ligger i Drafts; prisen gælder til fredag.', status: 'igang' as const }] : []),
    ],
    moeder: [],
  };
}

/** The index: two universes, and (until Henrik hid it at 10.30) a calendar meeting waiting for a univers. */
export function universIndeks(n: number, f: Fakta): UniversIndeks {
  const kandidat: MoedeKandidat = { eventId: KANDIDAT_ID, titel: 'Forældremøde i 2.b', start: f.iso('19:00', 2), slut: f.iso('20:30', 2), sted: 'Skolen, lokale 12', deltagere: [{ navn: 'Maja' }] };
  return {
    univers: [
      { id: HAVVIND, navn: 'Havvind Nord', om: 'Eksportkablet til havmølleparken: tracé, tidsplan og tilslutning. Med Nordvik Energi.', oprettet: f.iso('09:00', -30) },
      { id: HUSET, navn: 'Huset', om: 'Eltavle, VVS og alt andet, der skal ordnes derhjemme.', oprettet: f.iso('20:05', -20) },
    ],
    nyeMoeder: n >= 2 ? [] : [kandidat], skjulteMoeder: n >= 2 ? [KANDIDAT_ID] : [],
  };
}

export const UNIVERS_LOG = (): LogPost[] => [
  { fra: 0, plus: -30, hhmm: '09:00', kilde: 'henrik', tekst: 'Oprettede universet "Havvind Nord".' },
  { fra: 0, plus: -20, hhmm: '20:05', kilde: 'henrik', tekst: 'Oprettede universet "Huset".' },
  { fra: 2, hhmm: '10:30', kilde: 'henrik', tekst: 'Skjulte mødet "Forældremøde i 2.b": det hører ikke til et univers.' },
];
