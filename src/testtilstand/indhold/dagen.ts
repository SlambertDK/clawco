// Dagen in the test world (KC-0068): what Hermes answers when Dagen is built
// at each moment, and the room's log. Lifted from the demo's historie.ts
// (KC-0058) and moved onto the six moments; the meeting is at 11.

import type { LogEntry } from '../../store/types.ts';
import { parseDagenState, type DagenState } from '../../rooms/dagen/schema.ts';
import { type Fakta } from './fakta.ts';
import { logFra, type Raa } from './faelles.ts';
import { MOEDE_TITEL, NYHEDEN_TITEL } from './kilder.ts';

export const OPFOELGNING = 'Opfølgning: Havvind Nord';

/** Which build of Dagen is on screen at each moment: A the 07.05 build, B after the meeting was prepared, C after the meeting, G the evening. */
const FASE = ['A', 'B', 'B', 'B', 'C', 'G'] as const;
type Fase = (typeof FASE)[number];
const BYGGET: Record<Fase, string> = { A: '07:05', B: '09:25', C: '12:05', G: '19:25' };

export const FORTRYD_FORBERED = 'Fjern forberedelsen af mødet fra universet Havvind Nord igen.';
export const FORTRYD_UDKAST = `Fjern udkastet "${OPFOELGNING}" fra Skrive igen.`;
export const FORTRYD_LAESEMAPPE = 'Fjern dagsordenen fra læsemappen og slet påmindelsen kl. 07.35.';
export const FORTRYD_BESKED = 'Slet udkastet til beskeden til Maja om afhentningen.';

const MORGENAVIS = (): Raa[] => [
  { titel: NYHEDEN_TITEL, hvorfor: 'Relevant for mødet kl. 11: godkendelsen gælder kun den nordlige korridor.', kilde: 'Vindkraft Dagligt', url: 'https://example.org/vindkraft/nordvik-groent-lys' },
  { titel: 'Negative elpriser rammer havvind-økonomien', hvorfor: 'Kan blive et argument, når I fordeler meromkostningen ved den nordlige rute.', kilde: 'Netbladet', url: 'https://example.org/net/negative-elpriser' },
  { titel: 'Kabelfabrik øger kapaciteten om to år', hvorfor: 'Flere slots på sigt, men ikke i år; slottet i december er stadig Claras hensyn.', kilde: 'Vindkraft Dagligt', url: 'https://example.org/vindkraft/kabelfabrik' },
  { titel: 'Nye regler for tilslutning af havvind', hvorfor: 'Kan ramme Jonas\' beregning af tilslutningspunktet.', kilde: 'Netbladet', url: 'https://example.org/net/tilslutning' },
  { titel: 'Kraftig regn over Jylland fra klokken 16', hvorfor: 'Derfor er løbeturen flyttet til kl. 12.15, og Ella hentes, før regnen kommer.', kilde: 'Vejrstationen', url: 'https://example.org/vejr/regn-jylland' },
];

const LOEB_NOTE = 'Flyttet fra 17.00, fordi det regner kl. 16–19.';
const KAL = {
  tog: (): Raa => ({ tid: '07.42', slut: '08.20', titel: 'Tog til kontoret', note: 'Læs Claras dagsorden på turen.', status: 'klar' }),
  standup: (): Raa => ({ tid: '09.00', slut: '09.15', titel: 'Stand-up: programmet', note: 'Aflyst i dag; næste stand-up er i morgen.', status: 'aflyst' }),
  moede: (note: string, handling?: Raa): Raa => ({ tid: '11.00', slut: '12.00', titel: MOEDE_TITEL, note, status: 'klar', ...(handling ? { handling } : {}) }),
  loeb: (): Raa => ({ tid: '12.15', slut: '13.00', titel: 'Løbetur (7 km rundt om søen)', note: LOEB_NOTE, status: 'flyttet' }),
  ledig: (): Raa => ({ tid: '14.00', slut: '15.00', titel: 'Ledig tid', note: 'Passer til opfølgningen efter mødet.', status: 'klar' }),
  opfoelgning: (note: string): Raa => ({ tid: '14.00', slut: '15.00', titel: 'Opfølgning til Clara', note, status: 'klar' }),
  // KC-0066/0067: a draft to someone else is a graense handling — Hermes only drafts, Henrik sends.
  hente: (medBesked: boolean): Raa => ({ tid: '15.45', slut: '16.00', titel: 'Hent Ella i SFO', note: 'Maja har nattevagt. SFO lukker 16.00.', status: 'klar',
    ...(medBesked ? { handling: { id: 'kal-besked-maja', label: 'Skriv til Maja', instruktion: 'Lav et udkast til en kort besked til Maja om, at du henter Ella kl. 15.45, og læg det i dine udkast. Send ikke.', fortryd: FORTRYD_BESKED, tilAndre: true } } : {}) }),
};

function ugen(f: Fakta, fase: Fase): Raa[] {
  const ud: Raa[] = [];
  if (f.loerdagPlus !== 1) {
    ud.push({ dato: f.plus(1), note: 'Toget går 07.12, og kl. 9 er der stand-up. Maja er hjemme fra nattevagt kl. 7.', aftaler: [
      { tid: '07.12', slut: '07.50', titel: 'Tog til kontoret', kalender: 'Henrik' }, { tid: '09.00', slut: '09.15', titel: 'Stand-up: programmet', kalender: 'Henrik' },
    ] });
  }
  ud.push({
    dato: f.plus(f.loerdagPlus),
    note: fase === 'G' ? 'Ingen aftaler endnu. Maja har foreslået fødselsdag hos Birthe kl. 14; svaret venter i Hjem.' : 'Ingen aftaler: lørdag er fri.',
    aftaler: [],
  });
  return ud;
}

/** KC-0059: a pictogram and a short label per calendar post, by title. */
const KAL_VIS: [RegExp, string, string][] = [
  [/^Tog/, 'train-front', 'Tog'], [/^Stand-up/, 'briefcase', 'Stand-up'], [/Havvind Nord/, 'users', 'Møde'], [/^Løbetur/, 'footprints', 'Løb'],
  [/^Ledig/, 'coffee', 'Fri'], [/^Opfølgning/, 'pen-line', 'Opfølgning'], [/^Hent Ella/, 'backpack', 'Ella'], [/^Ella i seng/, 'moon', 'Seng'], [/^Maja/, 'heart', 'Maja'],
];
const ANBEFALING_VIS: Record<Fase, [string, string]> = {
  A: ['train-front', 'Læs dagsordenen i toget'], B: ['users', 'Nordlig rute som udgangspunkt'], C: ['pen-line', 'Skriv opfølgningen kl. 14'], G: ['gift', 'Svar Maja om lørdag'],
};
const ZONER: Record<Fase, Raa[]> = {
  A: [{ fra: '11:00', til: '12:00', slags: 'optaget' }, { fra: '16:00', til: '19:00', slags: 'regn' }],
  B: [{ fra: '11:00', til: '12:00', slags: 'optaget' }, { fra: '16:00', til: '19:00', slags: 'regn' }],
  C: [{ fra: '12:00', til: '15:30', slags: 'sol' }, { fra: '16:00', til: '19:00', slags: 'regn' }],
  G: [{ fra: '20:30', til: '22:00', slags: 'fri' }],
};

/** What Hermes answers when Dagen is built at moment `n` (the exact JSON the room validates), with its pictograms and the picture of the day. */
export function dagenRaa(n: number, f: Fakta): Raa {
  const fase = FASE[n] ?? 'A';
  const raa = dagenTekst(fase, f);
  // KC-0117: every seeded post is privat, explicitly (the test world's one source zone).
  const kalender = (raa['kalender'] as Raa[]).map((k): Raa => { const v = KAL_VIS.find(([re]) => re.test(String(k['titel']))); return { ...k, zone: 'privat', ...(v ? { ikon: v[1] } : {}) }; });
  const morgenavis = (raa['morgenavis'] as Raa[]).map((n) => ({ ...n, zone: 'privat' }));
  const punkter = kalender.flatMap((k) => {
    const v = KAL_VIS.find(([re]) => re.test(String(k['titel'])));
    const tid = String(k['tid']).replace('.', ':');
    if (!v || Number(tid.slice(0, 2)) < 6 || k['status'] === 'aflyst') return [];
    return [{ tid, ikon: v[1], tekst: v[2], ...(k['status'] === 'flyttet' ? { flyttetFra: '17:00' } : {}) }];
  }).slice(0, 6);
  const billede = { art: 'dagslinje', fra: 6, til: 22, zoner: ZONER[fase], punkter };
  const [ikon, overskrift] = ANBEFALING_VIS[fase];
  return { ...raa, kalender, morgenavis, anbefaling: { ...(raa['anbefaling'] as Raa), ikon, overskrift }, visuel: { ikon: 'sunrise', billede } };
}

function dagenTekst(fase: Fase, f: Fakta): Raa {
  const base = { dato: f.dag, morgenavis: MORGENAVIS(), ugen: ugen(f, fase) };
  const regn = 'Regn kl. 16–19, 9 °C';
  switch (fase) {
    case 'A': return {
      ...base, vejr: regn, hermesStatus: 'Holder øje med regn og mødet',
      treLinjer: [
        'Kl. 11.00 er der møde om Havvind Nord med Clara Holm og Jonas Berg; kabeltracéet er det åbne punkt, og Nordvik fik i morges grønt lys til den nordlige rute.',
        'Det regner kl. 16–19, så løbeturen er flyttet til kl. 12.15, og kl. 14.00 er ledig.',
        'Maja har nattevagt, så du henter Ella kl. 15.45; toget går 07.42, og Claras dagsorden venter i din mail.',
      ],
      anbefaling: {
        tekst: 'Læs Claras dagsorden i toget kl. 07.42, så du går ind i mødet kl. 11 med tracé-valget klart.',
        handling: { id: 'anb-laes-dagsorden', label: 'Læg i læsemappen', instruktion: 'Gem Claras dagsorden (mail 2401) som PDF i læsemappen på telefonen og sæt en påmindelse kl. 07.35. Send ikke noget.', fortryd: FORTRYD_LAESEMAPPE },
      },
      kalender: [
        KAL.tog(), KAL.standup(),
        KAL.moede('Med Clara Holm og Jonas Berg i Mødelokale 2. Kabeltracéet er det åbne punkt.', { id: 'kal-forbered-moedet', label: 'Forbered mødet', instruktion: `Saml notaterne fra mødet ${f.forrigeKort} og tracé-notatet i universet Havvind Nord, og lav talepunkter og en kort præsentation til mødet kl. 11.`, fortryd: FORTRYD_FORBERED }),
        KAL.loeb(), KAL.ledig(), KAL.hente(true),
      ],
    };
    case 'B': return {
      ...base, vejr: regn, hermesStatus: 'Holder øje med mødet',
      treLinjer: [
        'Mødet om Havvind Nord er kl. 11.00 med Clara Holm og Jonas Berg; talepunkter og slides ligger klar i universet.',
        'Kl. 12.15 er der løb, og kl. 14.00 er ledig til opfølgningen.',
        'Maja har nattevagt, så du henter Ella kl. 15.45; det regner fra kl. 16.',
      ],
      anbefaling: { tekst: 'Gå ind i mødet kl. 11 med nordlig rute som udgangspunkt, og bed Jonas bekræfte tilslutningspunktet. Talepunkterne ligger klar.' },
      kalender: [KAL.standup(), KAL.moede('Forberedt: fire talepunkter og slides i Havvind Nord. Kabeltracéet er det åbne punkt.'), KAL.loeb(), KAL.ledig(), KAL.hente(true)],
    };
    case 'C': return {
      ...base, vejr: regn, hermesStatus: 'Holder øje med opfølgningen',
      treLinjer: [
        'Mødet er slut: nordlig rute er udgangspunktet, og Jonas bekræfter tilslutningspunktet inden for en uge.',
        'Kl. 12.15 er der løb, og kl. 14.00 er fri, så opfølgningen til Clara kan skrives, mens mødet er friskt.',
        'Maja har nattevagt; du henter Ella kl. 15.45, og det regner fra kl. 16.',
      ],
      anbefaling: {
        tekst: 'Skriv opfølgningen til Clara kl. 14 — kalenderen er fri.',
        handling: { id: 'anb-lav-udkast', label: 'Lav udkast til opfølgningen', instruktion: 'Skriv første udkast til opfølgningen til Clara Holm i Skrive ud fra mødet i dag: nordlig rute, tidsplanen og næste skridt. Gem det som udkast; send ikke noget.', fortryd: FORTRYD_UDKAST },
      },
      kalender: [KAL.loeb(), KAL.opfoelgning('Udkastet ligger i Skrive. Intet er sendt.'), KAL.hente(false)],
    };
    default: return {
      ...base, vejr: 'Tørt, 6 °C', hermesStatus: 'Venter på dit svar om lørdag',
      treLinjer: ['Ella er hentet, og opfølgningen til Clara ligger som udkast.', 'Maja har foreslået fødselsdag hos Birthe lørdag kl. 14; svaret venter i Hjem.', 'I morgen går toget 07.12.'],
      anbefaling: { tekst: 'Svar Maja om lørdag: kalenderen er fri kl. 14, og reservationen ligger klar i Hjem.' },
      kalender: [{ tid: '20.00', slut: '20.30', titel: 'Ella i seng', note: 'Godnat-historie: kapitel 7.', status: 'klar' }, { tid: '21.00', slut: '07.00', titel: 'Maja: nattevagt', note: 'Maja går på arbejde.', status: 'klar' }],
    };
  }
}

/** Hermes' status line (Dagen's) after the evening (KC-0103): the evening's "waits on lørdag" is answered by then. Seed and rebuild both use it. */
export const STATUS_EFTER_AFTEN: Readonly<Record<string, string>> = { 'sent-aften': 'Klar til i morgen', 'naeste-morgen': 'Venter på at bygge Dagen', pause: 'Venter på at bygge Dagen' };

/** Dagen exists from its 07.05 build, so at every moment. */
export const dagenState = (n: number, f: Fakta): DagenState => parseDagenState(dagenRaa(n, f), new Date(f.iso(BYGGET[FASE[n] ?? 'A'])));

export function dagenLog(f: Fakta, n: number): LogEntry[] {
  const aftaler = (m: number): number => dagenState(m, f).kalender.length;
  return logFra('dagen', [
    { fra: 0, hhmm: '07:05', kilde: 'hermes', tekst: `Hermes byggede Dagen (${aftaler(0)} aftaler, 5 nyheder).` },
    { fra: 1, hhmm: '07:20', kilde: 'hermes', tekst: 'Claras dagsorden ligger som PDF i læsemappen, og påmindelsen er sat til kl. 07.35. Intet er sendt.', handlingId: 'anb-laes-dagsorden', fortryd: FORTRYD_LAESEMAPPE },
    { fra: 1, hhmm: '08:10', kilde: 'hermes', tekst: 'Forberedte mødet kl. 11 i universet Havvind Nord: fire talepunkter og en præsentation.', handlingId: 'kal-forbered-moedet', fortryd: FORTRYD_FORBERED },
    { fra: 1, hhmm: '09:25', kilde: 'hermes', tekst: 'Opdaterede Dagen: mødet kl. 11 er forberedt.' },
    { fra: 2, hhmm: '10:20', kilde: 'hermes', tekst: 'Udkastet til beskeden til Maja ligger i dine udkast. Intet er sendt; det gør du selv.', handlingId: 'kal-besked-maja', fortryd: FORTRYD_BESKED },
    { fra: 4, hhmm: '12:05', kilde: 'hermes', tekst: `Opdaterede Dagen efter mødet (${aftaler(4)} aftaler, 5 nyheder).` },
    { fra: 4, hhmm: '12:10', kilde: 'hermes', tekst: `Lagde udkastet "${OPFOELGNING}" i Skrive: tre afsnit ud fra mødet. Intet er sendt.`, handlingId: 'anb-lav-udkast', fortryd: FORTRYD_UDKAST },
    { fra: 5, hhmm: '19:25', kilde: 'hermes', tekst: 'Opdaterede Dagen til aftenen.' },
  ], n, f);
}
