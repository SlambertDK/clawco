// Hjem in the test world (KC-0068): Kuratoren's cards through the day — every
// card type, a card for Claude Code, a prompt to copy, and the three ledger
// situations of a bill (waiting for a ledger, written, and undone so it can be
// written again, KC-0066), for a subscription and for a purchase. Lifted from the demo's historie.ts (KC-0058); the
// bills and the pipeline lines are new against main.

import type { LogEntry } from '../../store/types.ts';
import { parseKuratorSvar, type Kort, type KuratorState, type RegnskabsStatus, type Regnskabslinje } from '../../rooms/hjem/kort.ts';
import { FORTRYD_FJERN, regnskabsfil } from '../../kurator/regnskab.ts';
import { FORTRYD_SENERE, senereTekst } from '../../kurator/senere.ts';
import type { DataZone } from '../../identitet/zoner.ts';
import type { Fakta } from './fakta.ts';
import { logFra, ugedagKort, type LogPost, type Raa } from './faelles.ts';
import { FEJL_KORT_TITEL, udviklingLog } from './udvikling.ts';
import { BESKEDER_FRA, clarasBesked, ellasBesked, majasBesked } from './kilder.ts';
import { knytBeskeder } from '../../kurator/beskeder.ts';
import { lavForslag, type ForslagFelter, type Regelforslag } from '../../tillid/forslag.ts';

const STROEM = 'regning:stroemmen-el';
const BREDBAAND = 'regning:bredbaandet-internet';
const LOEBEKLUB = 'regning:loebeklubben-kontingent';
const PAKKE = 'tjeneste:pakkeshoppen-pakke';
const VVS = 'regning:roervang-vvs-faktura';
const TANDLAEGE = 'regning:tandklinikken-tandrens';

export const FORTRYD_LOEB = 'Flyt kalenderaftalen "Løbetur" i dag tilbage til 17.00–17.50.';
export const FORTRYD_HENT = 'Slet kalenderaftalen "Hent Ella i SFO" i dag kl. 15.45.';
const fortrydBirthe = (lordag: string): string => `Slet kalenderaftalen "Fødselsdag hos Birthe" den ${lordag}.`;

/** The ledger line Hermes proposes for each bill. */
function linje(f: Fakta, leverandoer: string, beloeb: string, emne: string): Omit<Regnskabslinje, 'hvor'> {
  return { dato: f.dag, leverandoer, beloeb, valuta: 'DKK', periode: f.dag.slice(0, 7), art: 'abonnement', emne };
}

/** Every card Kuratoren uses during the day, as Hermes writes it (KC-0059: each with its pictogram, headline and picture). */
function kortRaa(f: Fakta): Record<string, Raa> {
  const lordag = f.kort(f.loerdagPlus);
  // A picture holds at most six days: the six that end with, or include, Saturday.
  const start = Math.max(0, f.loerdagPlus - 5);
  const uge = Array.from({ length: 6 }, (_, i) => {
    const n = start + i;
    const navn = ugedagKort(f, n);
    return n === f.loerdagPlus ? { navn, fri: true, ikon: 'gift', valgt: true } : { navn, fri: ['lør', 'søn'].includes(navn) };
  });
  return {
    regn: {
      id: 'nyhed:regn-16-19', type: 'nyhed', titel: 'Regn kl. 16–19: flyt løbeturen til kl. 12.15',
      betyder: 'Prognosen lover styrtregn fra 16 til 19, lige når din faste løbetur (7 km) ligger kl. 17.00. Efter mødet er det tørt, og kalenderen er fri kl. 12.15.',
      grundlag: ['Vejrudsigt: regn kl. 16–19, 4–6 mm', 'Kalender: løbetur kl. 17.00; intet kl. 12.15–13.00'], kilder: ['https://example.org/vejr/i-dag'],
      anbefaling: 'Flyt løbeturen til kl. 12.15, så er du hjemme kl. 13 og har kl. 14 fri til opfølgningen.', prioritet: 2, gyldigTil: f.dag,
      handling: { label: 'Flyt løbet til kl. 12.15', instruktion: 'Flyt kalenderaftalen "Løbetur" i dag fra 17.00–17.50 til 12.15–13.00. Ændr intet andet.', fortryd: FORTRYD_LOEB },
      visuel: { ikon: 'cloud-rain', tone: 'adv', overskrift: 'Løb kl. 12.15 – regn fra 16', billede: { art: 'dagslinje', fra: 6, til: 22, zoner: [{ fra: '16:00', til: '19:00', slags: 'regn' }], punkter: [{ tid: '12:15', ikon: 'footprints', tekst: 'Løb', flyttetFra: '17:00' }, { tid: '15:45', ikon: 'backpack', tekst: 'Ella' }] } },
    },
    maja: {
      id: 'familie:maja-hente-ella', type: 'familie', titel: 'Maja har nattevagt: du henter Ella kl. 15.45',
      betyder: 'Maja har nattevagt hele ugen og sover til eftermiddag. Ella (8) går i SFO til 16.00, så det er dig, der henter hende kl. 15.45.',
      grundlag: ['Familiekalenderen: Maja, nattevagt hele ugen', 'SFO lukker kl. 16.00', 'Din kalender: intet efter kl. 15.00'], kilder: [],
      anbefaling: 'Læg afhentningen ind i kalenderen kl. 15.45, så minder jeg dig kl. 15.30.', prioritet: 1, gyldigTil: f.dag,
      handling: { label: 'Læg afhentning i kalenderen', instruktion: 'Opret en kalenderaftale i dag kl. 15.45–16.00: "Hent Ella i SFO", med en påmindelse kl. 15.30.', fortryd: FORTRYD_HENT },
      visuel: { ikon: 'backpack', overskrift: 'Du henter Ella 15.45', billede: { art: 'personer', personer: [{ navn: 'Maja', rolle: 'nattevagt' }, { navn: 'Ella', rolle: 'SFO til 16' }] } },
    },
    nordvik: {
      id: 'nyhed:nordvik-groent-lys', type: 'nyhed', titel: 'Nordvik får grønt lys til kabeltracé: relevant for mødet kl. 11',
      betyder: 'Myndighederne har godkendt Nordviks nordlige kabelkorridor. Den vestlige rute kræver stadig en dispensation. Det er præcis det valg, I tager kl. 11 med Clara.',
      grundlag: ['Nyheden i morges (Vindkraft Dagligt)', `Notat fra mødet ${f.forrigeKort}: valget blev udskudt`, 'Claras dagsorden: kabeltracéet er første punkt'], kilder: ['https://example.org/vindkraft/nordvik-groent-lys'],
      anbefaling: 'Gå ind i mødet med nordlig rute som udgangspunkt. Resuméet ligger i Nyheder.', prioritet: 2, gyldigTil: f.dag,
      visuel: { ikon: 'newspaper', tone: 'god', overskrift: 'Grønt lys til nordlig rute', billede: { art: 'dagslinje', fra: 6, til: 18, zoner: [], punkter: [{ tid: '07:00', ikon: 'newspaper', tekst: 'Nyheden' }, { tid: '11:00', ikon: 'users', tekst: 'Mødet' }] } },
    },
    fejl: {
      id: 'tjeneste:fejlvagten-natten', type: 'tjeneste', titel: FEJL_KORT_TITEL,
      betyder: 'Fejlvagten meldte tre fejl i nat, alle i Mail-rummet, når en mail mangler afsender. Intet er tabt, men rummet viste en tom side.',
      grundlag: ['Mail fra Fejlvagten kl. 05.02', 'Første fejl 02.14, sidste 04.51', 'Samme fejl alle tre gange'], kilder: [],
      anbefaling: 'Send den til Claude Code; det er en lille rettelse med en test.', prioritet: 3, gyldigTil: f.dag, mailId: 'Inbox:2505', udvikling: { projekt: 'kontrolcenter' },
      visuel: { ikon: 'triangle-alert', tone: 'adv', overskrift: '3 fejl i nat – send videre', billede: { art: 'prikker', antal: 3, ialt: 3, tekst: 'fejl i Mail' } },
    },
    stroem: {
      id: STROEM, type: 'regning', titel: 'Strømmen A/S: elregningen er skrevet i regnskabet',
      betyder: 'Elregningen på 612,50 kr. er 32 kr. højere end sidste måned. Jeg har skrevet den i det private regnskab; den trækkes automatisk.',
      grundlag: ['Mail fra Strømmen A/S i går kl. 19.45', 'Sidste måned: 580,00 kr.'], kilder: [],
      anbefaling: 'Intet at gøre; den betales automatisk.', prioritet: 5, gyldigTil: f.plus(3), mailId: 'Folders/Regninger:3104',
      regnskab: { hvor: 'privat', ...linje(f, 'Strømmen A/S', '612,50', 'Faktura: elforbrug') },
      visuel: { ikon: 'receipt', tone: 'rolig', overskrift: '32 kr. mere end sidst', billede: { art: 'beloeb', vaerdi: 612.5, graense: 580, enhed: 'kr.', tekst: 'Faktura', graenseTekst: 'Sidste måned' } },
    },
    bredbaand: {
      id: BREDBAAND, type: 'regning', titel: 'Bredbåndet: internetregningen – hvilket regnskab?',
      betyder: 'Internetregningen på 299 kr. kan høre til projektet (serveren kører på linjen) eller til det private budget. Jeg kan ikke afgøre det selv.',
      grundlag: ['Mail fra Bredbåndet', 'Samme beløb som sidste måned'], kilder: [],
      anbefaling: 'Vælg regnskab: privat, hvis serveren kun er en hobby, ellers projektet.', prioritet: 4, gyldigTil: f.plus(5), mailId: 'Folders/Regninger:2301',
      regnskab: { hvor: 'uklart', ...linje(f, 'Bredbåndet', '299,00', 'Faktura: internet') },
      visuel: { ikon: 'receipt', tone: 'adv', overskrift: 'Hvilket regnskab?', billede: { art: 'beloeb', vaerdi: 299, graense: 299, enhed: 'kr.', tekst: 'Faktura', graenseTekst: 'Sidste måned' } },
    },
    loebeklub: {
      id: LOEBEKLUB, type: 'regning', titel: 'Løbeklubben: halvårskontingent 450 kr.',
      betyder: 'Halvårskontingentet til løbeklubben er kommet. Det hører til det private budget.',
      grundlag: ['Mail fra Løbeklubben', 'Sidste halvår: 450,00 kr.'], kilder: [],
      anbefaling: 'Skriv den i det private regnskab.', prioritet: 5, gyldigTil: f.plus(6), mailId: 'Folders/Regninger:2302',
      regnskab: { hvor: 'privat', ...linje(f, 'Løbeklubben', '450,00', 'Kontingent: løbeklubben') },
      visuel: { ikon: 'piggy-bank', overskrift: 'Samme som sidst', billede: { art: 'beloeb', vaerdi: 450, graense: 450, enhed: 'kr.', tekst: 'Kontingent', graenseTekst: 'Sidst' } },
    },
    vvs: {
      id: VVS, type: 'regning', titel: 'Rørvang VVS: fakturaen er skrevet i regnskabet',
      betyder: `Fakturaen på 4.210 kr. for det nye blandingsbatteri matcher tilbuddet. Jeg har skrevet købet i det private regnskab; betalingen godkender du selv inden ${f.forfald}.`,
      grundlag: ['Mail fra Rørvang VVS, flyttet til Betalinger kl. 9.43', 'Tilbuddet: 4.210 kr.'], kilder: [],
      anbefaling: `Godkend betalingen i banken inden ${f.forfald}. Jeg betaler aldrig selv.`, prioritet: 6, gyldigTil: f.plus(7),
      regnskab: { hvor: 'privat', dato: f.dag, leverandoer: 'Rørvang VVS', beloeb: '4.210,00', valuta: 'DKK', art: 'koeb', emne: 'Faktura: nyt blandingsbatteri' },
      visuel: { ikon: 'receipt', tone: 'god', overskrift: 'Matcher tilbuddet', billede: { art: 'beloeb', vaerdi: 4210, graense: 4210, enhed: 'kr.', tekst: 'Faktura', graenseTekst: 'Tilbud' } },
    },
    // KC-0143: the night's bill in "Næste morgen", when the rules file is broken: Hermes proposes the line, the app does not write it.
    tandlaege: {
      id: TANDLAEGE, type: 'regning', titel: 'Tandklinikken: regning på 650 kr. for tandrens',
      betyder: 'Regningen for tandrensen i sidste uge kom i nat. Den hører til det private budget, men jeg har ikke skrevet den: reglerne kan ikke læses lige nu.',
      grundlag: ['Mail fra Tandklinikken i nat kl. 02.40', 'Beløbet matcher prislisten'], kilder: [],
      anbefaling: 'Skriv den i det private regnskab selv, eller ret reglerne, så klarer jeg den næste gang.', prioritet: 3, gyldigTil: f.plus(6), mailId: 'Folders/Regninger:2410',
      regnskab: { hvor: 'privat', dato: f.dag, leverandoer: 'Tandklinikken', beloeb: '650,00', valuta: 'DKK', art: 'koeb', emne: 'Faktura: tandrens' },
      visuel: { ikon: 'receipt', tone: 'adv', overskrift: 'Ikke skrevet: hvilken regel?' },
    },
    pakke: {
      id: PAKKE, type: 'tjeneste', titel: 'Pakkeshoppen: din pakke kan hentes',
      betyder: 'Pakken med regnjakken til Ella ligger klar i pakkeshoppen til og med i overmorgen.',
      grundlag: ['Mail fra Pakkeshoppen i går kl. 14.05'], kilder: [], anbefaling: 'Hent den på vej hjem fra SFO.', prioritet: 6, gyldigTil: f.plus(2),
      visuel: { ikon: 'map-pin', overskrift: 'Pakke klar til afhentning' },
    },
    hente: {
      id: 'familie:hent-ella-1545', type: 'familie', titel: 'Gå kl. 15.35: Ella kl. 15.45, regn fra kl. 16',
      betyder: 'SFO lukker kl. 16.00, og regnen kommer kl. 16. Går du kl. 15.35, er du dér 15.45 og hjemme, før det styrter ned.',
      grundlag: ['Kalender: Hent Ella i SFO kl. 15.45', 'Vejrudsigt: regn fra kl. 16'], kilder: [], anbefaling: 'Tag regnjakken i gangen, og gå kl. 15.35.', prioritet: 1, gyldigTil: f.dag,
      visuel: { ikon: 'umbrella', tone: 'adv', overskrift: 'Gå kl. 15.35', billede: { art: 'nedtaelling', minutter: 65, ialt: 120, tekst: 'Ella 15.45 · regn 16' } },
    },
    sikkerhed: {
      id: 'nyhed:markdown-sikkerhedshul', type: 'nyhed', titel: 'Sikkerhedshul i markdown-pakke: tjek kontrolcentret',
      betyder: 'En udbredt markdown-pakke kunne køre kode fra en ondsindet tekst i ældre versioner. Kontrolcentret viser tekst fra Hermes, så det er værd at tjekke, om pakken er med.',
      grundlag: ['Kodebladet i nat', 'Rettet i den nyeste version'], kilder: ['https://example.org/kode/markdown-hul'],
      anbefaling: 'Kopiér prompten til Claude Code, eller send kortet direkte.', prioritet: 3, gyldigTil: f.plus(3), udvikling: { projekt: 'kontrolcenter' },
      prompt: 'Tjek om kontrolcentret afhænger af den markdown-pakke, der er nævnt i Kodebladet i dag (direkte eller indirekte). Hvis ja: opdater til den rettede version, kør typecheck og tests, og fortæl hvad du ændrede.',
      visuel: { ikon: 'shield-check', tone: 'adv', overskrift: 'Tjek din kode for hullet', billede: { art: 'prikker', antal: 0, ialt: 1, tekst: 'projekter ramt' } },
    },
    birthe: {
      id: 'familie:birthe-foedselsdag', type: 'familie', titel: 'Maja spørger: fødselsdag hos Birthe lørdag kl. 14?',
      betyder: 'Maja har skrevet, at Birthe (din mor) fylder år, og at I er velkomne lørdag kl. 14. Din kalender er fri hele lørdagen.',
      grundlag: ['Besked fra Maja i aften', 'Din kalender: lørdag har ingen aftaler', 'I morgen: tog 07.12, ingen kollision'], kilder: [],
      anbefaling: 'Svar ja og reservér lørdag kl. 14.00–17.00. Jeg svarer ikke Maja; det gør du selv.', prioritet: 1, gyldigTil: f.plus(f.loerdagPlus),
      handling: { label: 'Reservér lørdag', instruktion: `Opret en kalenderaftale lørdag den ${lordag} kl. 14.00–17.00 med titlen "Fødselsdag hos Birthe".`, fortryd: fortrydBirthe(lordag) },
      visuel: { ikon: 'gift', tone: 'god', overskrift: 'Lørdag er fri – sig ja?', billede: { art: 'uge', dage: uge } },
    },
    // KC-0138: Ella's question on Signal, a chosen conversation — a card on one message: her name, no button.
    cykel: {
      id: 'familie:ella-cykel', type: 'familie', titel: 'Ella spørger: må hun cykle i skole i morgen?',
      betyder: 'Ella har skrevet på Signal, om hun må tage cyklen i skole i morgen. Regnen er ovre i aften, og i morgen er det tørt.',
      grundlag: ['Besked fra Ella i aften', 'Vejrudsigt: tørt i morgen formiddag'], kilder: [],
      anbefaling: 'Svar hende selv på Signal: ja, cyklen er fin i morgen.', prioritet: 2, gyldigTil: f.plus(1), beskedId: ellasBesked(f).id,
    },
    godnat: {
      id: 'nyhed:dagen-i-korte-traek', type: 'nyhed', titel: 'Godnat, Henrik: dagen i korte træk',
      betyder: 'I dag: 12 mails sorteret i nat, syv beslutninger klaret, løbeturen flyttet til tørvejr, mødet om Havvind Nord endte med nordlig rute, opfølgningen er gemt, og Ella blev hentet kl. 15.45.',
      grundlag: ['Mail: syv beslutninger, kun ét svar sendt, og det på dit tryk', 'Havvind Nord: to nye opgaver', 'Claude Code: to opgaver færdige i dag'], kilder: [],
      anbefaling: 'Sov godt. I morgen: tog 07.12 og stand-up kl. 9. Jeg sender intet til nogen.', prioritet: 2, gyldigTil: f.dag,
      visuel: { ikon: 'moon', overskrift: 'Godnat – dagen er lukket', billede: { art: 'dagslinje', fra: 6, til: 22, zoner: [{ fra: '11:00', til: '12:00', slags: 'optaget' }], punkter: [{ tid: '09:30', ikon: 'mail', tekst: 'Mail' }, { tid: '11:00', ikon: 'users', tekst: 'Møde' }, { tid: '12:15', ikon: 'footprints', tekst: 'Løb' }, { tid: '15:45', ikon: 'backpack', tekst: 'Ella' }, { tid: '20:30', ikon: 'gift', tekst: 'Lørdag' }] } },
    },
  };
}

/**
 * KC-0226: the message cards the two zone runs stand by, from the moment the conversations are chosen (the evening): one
 * in arbejde (Clara on Telegram), one in husstand (Maja on WhatsApp). Like any answer of a zone run they name no zone:
 * the run's zone is the card's. No handling — Clawco reads and never answers.
 */
type ZoneRun = 'arbejde' | 'husstand';
const ZONEKORT_MOMENTER: readonly number[] = [BESKEDER_FRA];
function zoneKortRaa(f: Fakta): Record<ZoneRun, Raa> {
  return {
    arbejde: {
      id: 'besked:arbejde-clara-ruten', type: 'familie', titel: 'Clara beder dig læse udkastet til ruten inden fredag',
      betyder: 'Clara har skrevet på Telegram, at udkastet til ruten for Havvind Nord ligger i fællesmappen, og at hun gerne vil have din gennemlæsning inden fredag.',
      grundlag: ['Besked fra Clara i aften', 'Havvind Nord: ruten er næste punkt'], kilder: [],
      anbefaling: 'Afsæt en halv time i morgen til at læse det, og skriv selv til Clara bagefter. Jeg svarer ikke Clara.', prioritet: 4, gyldigTil: f.plus(3), beskedId: clarasBesked(f).id,
    },
    husstand: {
      id: 'besked:husstand-maja-svoemning', type: 'familie', titel: 'Maja spørger: kan du køre Ella til svømning torsdag kl. 16.30?',
      betyder: 'Maja har skrevet på WhatsApp, at Ella har svømning torsdag kl. 16.30. Hun kan bytte vagt, hvis du ikke kan køre.',
      grundlag: ['Besked fra Maja i aften'], kilder: [],
      anbefaling: 'Svar Maja selv på WhatsApp, så hun ved, om hun skal bytte vagt.', prioritet: 3, gyldigTil: f.plus(3), beskedId: majasBesked(f).id,
    },
  };
}
const zoneBesked = (zone: ZoneRun, f: Fakta) => (zone === 'arbejde' ? clarasBesked(f) : majasBesked(f));

/** What Hermes answers to a Kuratoren run over one other zone at moment `n`: that zone's message card in the evening, else nothing (the card is retired). */
export function zoneKuratorRaa(zone: ZoneRun, n: number, f: Fakta): Raa {
  return { kort: ZONEKORT_MOMENTER.includes(n) ? [zoneKortRaa(f)[zone]] : [], vurderinger: [], intet: [] };
}

/** Which cards Kuratoren stands by at each moment (moment index → card keys, in prioritet order). */
const KORT_NOEGLER: string[][] = [
  ['maja', 'regn', 'nordvik', 'fejl', 'stroem', 'bredbaand', 'loebeklub'],
  ['maja', 'nordvik', 'fejl', 'bredbaand', 'stroem', 'loebeklub', 'pakke'],
  ['nordvik', 'bredbaand', 'loebeklub', 'vvs'],
  ['nordvik', 'bredbaand', 'loebeklub', 'vvs'],
  ['hente', 'sikkerhed', 'bredbaand', 'loebeklub', 'vvs'],
  ['birthe', 'cykel', 'godnat', 'vvs'],
  // KC-0103: late evening and the next morning — Birthe is handled (its handling is in the log), the day is closed (no Godnat).
  ['birthe', 'vvs'],
  ['birthe', 'vvs', 'tandlaege'], // KC-0143: the night's bill, not written (the rules file is broken this morning)
  ['birthe', 'vvs'], // KC-0124: "Sat på pause" — the next morning, paused
];
/** The moment from which the VVS card is put away (Senere). */
const SENERE_FRA = 3;
const KURATOR_TID = ['06:25', '09:05', '10:15', '10:15', '12:05', '19:28', '22:15', '22:15'];

/** What Hermes answers to a Kuratoren run at moment `n`. */
export function kuratorRaa(n: number, f: Fakta): Raa {
  const kort = kortRaa(f);
  return {
    kort: (KORT_NOEGLER[n] ?? []).map((k) => kort[k]),
    vurderinger: [],
    intet: [{ titel: 'Nyhedsbrev fra Havvindsforum', hvorfor: 'Ingen handling' }, { titel: 'Banken: opdatering af vilkår', hvorfor: 'Intet at gøre' }],
  };
}

/**
 * KC-0144: what the scripted Hermes proposes when Henrik's Ret or Ikke relevant names a pattern ("altid", "aldrig", "hver gang"):
 * a rule for the slags of mail the card was about. The app validates it like any answer; the cap is 1 here (no rule covers these).
 */
export function regelforslagTil(kortTitel: string): ForslagFelter {
  if (/pakke/i.test(kortTitel)) return { titel: 'Pakkemails lægges i Pakker', tekst: 'Mails om pakker, der kan hentes, lægger jeg i mappen Pakker. Jeg svarer og sletter intet.', trin: 1, gaelder: { kilde: 'mail', slags: 'pakke' } };
  if (/kontingent|klub/i.test(kortTitel)) return { titel: 'Kontingenter lægges i Ordnet', tekst: 'Kontingenter og faste regninger fra foreninger lægger jeg i Ordnet, når de ligner sidste gang.', trin: 1, gaelder: { kilde: 'mail', slags: 'kontingent' } };
  return { titel: 'Tilbud lægges i Ordnet', tekst: 'Tilbud og reklamer fra butikker lægger jeg i Ordnet uden at vise dem.', trin: 1, gaelder: { kilde: 'mail', slags: 'tilbud' } };
}

/** KC-0144: the words that make the scripted Hermes see a pattern in Henrik's Ret or Ikke relevant. */
export const MOENSTER = /altid|aldrig|hver gang/i;

/**
 * KC-0144: the proposals the app holds from the moment Henrik closed the parcel card (10.40, Ikke relevant): one pending
 * (the card "Skal jeg gøre det til en regel?", until the afternoon), and one he declined this morning (never shown; it
 * keeps the same content from coming back for 30 days).
 */
function regelforslagNu(n: number, f: Fakta): Regelforslag[] {
  if (n < 2) return [];
  const afvist: Regelforslag = {
    ...lavForslag({ titel: 'Løbeturen flyttes ved regn', tekst: 'Regner det, flytter jeg løbeturen til tørvejr uden at spørge.', trin: 2, gaelder: { kilde: 'kalender', slags: 'regnvejr' } }, { kort: { id: 'nyhed:regn-16-19', titel: 'Regn kl. 16–19: flyt løbeturen til kl. 12.15' }, art: 'ret', nu: new Date(f.iso('06:45')) }),
    status: 'afvist', afgjort: f.iso('06:50'),
  };
  const ventende = lavForslag(regelforslagTil('Pakkeshoppen: din pakke kan hentes'), { kort: { id: PAKKE, titel: 'Pakkeshoppen: din pakke kan hentes' }, art: 'ikke-relevant', nu: new Date(f.iso('10:41')) });
  // The afternoon (Eftermiddag) and later: Henrik has answered; nothing waits (Alt er ordnet at night).
  return n <= 4 ? [afvist, ventende] : [afvist, { ...ventende, status: 'afvist', afgjort: f.iso('14:00') }];
}

/** KC-0131: Kuratoren in the cold start — a fresh install that reads only the calendar has the one card the calendar (and the weather) gives. */
export const koldKuratorRaa = (f: Fakta): Raa => ({ kort: [kortRaa(f)['regn']], vurderinger: [], intet: [] });

const status = (k: Kort, hvor: 'privat', s: RegnskabsStatus['status']): RegnskabsStatus =>
  ({ hvor, status: s, zone: 'privat', ...(k.regnskab ? { leverandoer: k.regnskab.leverandoer, beloeb: k.regnskab.beloeb, valuta: k.regnskab.valuta } : {}) });

/**
 * KC-0117: the zone of each seeded card. The scripted Hermes answer (kortRaa) names none (a Kuratoren run reads the
 * privat zone), so the stored state carries the zones: one work card, one family card, every other card privat. All
 * are the owner's (no `ejer`), so the test world's owner sees them all.
 */
const KORT_ZONE: Record<string, DataZone> = { 'nyhed:nordvik-groent-lys': 'arbejde', 'familie:maja-hente-ella': 'husstand' };
const medZone = (k: Kort): Kort => ({ ...k, zone: KORT_ZONE[k.id] ?? 'privat' });

/**
 * Kuratoren's state at moment `n`: Hermes' cards plus what the app did to the bills — Strømmen written at 06.25,
 * Løbeklubben written at 06.26 and undone by Henrik at 07.00 (so it can be written again, and the undone line is among
 * Hjem's newest), Bredbåndet waiting for a ledger until Henrik chose the private one at 10.10, Rørvang VVS (a purchase)
 * written at 10.15. The ledger file itself lives in the vault (`fil` is relative).
 */
export function hjemState(n: number, f: Fakta): KuratorState {
  const svar = parseKuratorSvar(kuratorRaa(n, f));
  const fil = regnskabsfil('vault', 'privat');
  const regnskab: Record<string, RegnskabsStatus> = {};
  const alle = parseKuratorSvar({ kort: Object.values(kortRaa(f)) }).nye;
  const af = (id: string): Kort => alle.find((k) => k.id === id) as Kort;
  regnskab[STROEM] = status(af(STROEM), 'privat', 'skrevet');
  regnskab[LOEBEKLUB] = status(af(LOEBEKLUB), 'privat', 'fortrudt');
  const valgt = (k: Kort): Kort => ({ ...k, regnskab: { hvor: 'privat', ...(k.regnskabForslag as Omit<Regnskabslinje, 'hvor'>) }, skrevet: { hvor: 'privat', fil }, regnskabUklart: false });
  if (n >= 2) regnskab[BREDBAAND] = { ...status(valgt(af(BREDBAAND)), 'privat', 'skrevet') };
  if (n >= 2) regnskab[VVS] = status(af(VVS), 'privat', 'skrevet');
  // KC-0138: the sender line of a card on a message is the app's, set as a Kuratoren run sets it.
  const kort = knytBeskeder(svar.nye, [ellasBesked(f)], []).map((k): Kort => {
    if (k.id === STROEM || k.id === VVS) return { ...k, skrevet: { hvor: 'privat', fil } };
    if (k.id === BREDBAAND && n >= 2) return valgt(k);
    if (k.id === TANDLAEGE) return { ...k, kraeverRegel: true }; // KC-0143: what skrivRegninger leaves when no rule covers the row
    return k;
  });
  // KC-0096: from 11.05 the Rørvang VVS card is put away until tomorrow 07.00 (Henrik pressed Senere → I morgen): off screen, uncounted.
  const udsatKort = (n >= SENERE_FRA ? kort.map((k) => (k.id === VVS ? { ...k, udsatTil: f.iso('07:00', 1) } : k)) : kort).map(medZone);
  // KC-0226: what the two zone runs stored — a card on one message each, the zone set as parseKuratorSvar sets it for the run's zone.
  const zoneKort = (['arbejde', 'husstand'] as const).flatMap((z): Kort[] => knytBeskeder(parseKuratorSvar(zoneKuratorRaa(z, n, f), z).nye, [zoneBesked(z, f)], []));
  const state: KuratorState = { kort: [...udsatKort, ...zoneKort], intet: svar.intet, afvist: [], sete: [], sidst: f.iso(KURATOR_TID[n] ?? '07:10'), regnskab };
  const forslag = regelforslagNu(n, f);
  if (forslag.length) state.regelforslag = forslag;
  if (n >= 2) {
    state.afvist = [PAKKE];
    state.lukket = [{ id: PAKKE, titel: 'Pakkeshoppen: din pakke kan hentes', grund: 'Maja henter den i morgen', dato: f.iso('10:40'), zone: 'privat' }];
  }
  return state;
}

export function hjemLog(f: Fakta, n: number): LogEntry[] {
  const poster: LogPost[] = [
    { fra: 0, hhmm: '06:25', kilde: 'hermes', tekst: 'Kuratoren læste de 12 sorterede mails og regnvarslet og lagde syv kort øverst.' },
    { fra: 0, hhmm: '06:25', kilde: 'hermes', tekst: 'Skrev Strømmen A/S 612,50 DKK ind i det private regnskab', handlingId: `regnskab:${STROEM}`, fortryd: FORTRYD_FJERN },
    { fra: 0, hhmm: '06:26', kilde: 'hermes', tekst: 'Skrev Løbeklubben 450,00 DKK ind i det private regnskab', handlingId: `regnskab:${LOEBEKLUB}`, fortryd: FORTRYD_FJERN, fortrudt: { fra: 0, hhmm: '07:00' } },
    { fra: 0, hhmm: '06:41', kilde: 'hermes', tekst: 'Løbeturen ligger nu kl. 12.15–13.00 i kalenderen. Der er tørvejr midt på dagen.', handlingId: 'nyhed:regn-16-19:h', fortryd: FORTRYD_LOEB },
    { fra: 1, hhmm: '07:25', kilde: 'hermes', tekst: 'Afhentningen kl. 15.45 ligger i kalenderen med en påmindelse kl. 15.30.', handlingId: 'familie:maja-hente-ella:h', fortryd: FORTRYD_HENT },
    { fra: 1, hhmm: '09:05', kilde: 'hermes', tekst: 'Kuratoren: et kort om en pakke; resten står ved magt.' },
    { fra: 2, hhmm: '10:10', kilde: 'henrik', tekst: 'Skrev Bredbåndet 299,00 DKK ind i det private regnskab', handlingId: `regnskab:${BREDBAAND}`, fortryd: FORTRYD_FJERN },
    { fra: 2, hhmm: '10:15', kilde: 'hermes', tekst: 'Skrev Rørvang VVS 4.210,00 DKK ind i det private regnskab', handlingId: `regnskab:${VVS}`, fortryd: FORTRYD_FJERN },
    { fra: SENERE_FRA, hhmm: '11:05', kilde: 'henrik', tekst: senereTekst('morgen', 'Rørvang VVS: fakturaen er skrevet i regnskabet'), handlingId: `senere:${VVS}`, fortryd: FORTRYD_SENERE },
    { fra: 2, hhmm: '10:40', kilde: 'henrik', tekst: 'Lukkede "Pakkeshoppen: din pakke kan hentes": Maja henter den i morgen' },
    { fra: 2, hhmm: '10:41', kilde: 'hermes', tekst: 'Gemt i min hukommelse: Maja henter pakken. Jeg tager den ikke op igen.' },
    { fra: 4, hhmm: '12:05', kilde: 'hermes', tekst: 'Kuratoren: afhentningen af Ella kl. 15.45 og et sikkerhedshul er lagt øverst.' },
    { fra: 5, hhmm: '19:28', kilde: 'hermes', tekst: 'Kuratoren: Maja har spurgt om lørdag; kortet er lagt øverst.' },
    { fra: 6, hhmm: '21:40', kilde: 'hermes', tekst: `Fødselsdag hos Birthe ligger lørdag den ${f.kort(f.loerdagPlus)} kl. 14.00–17.00 i kalenderen.`, handlingId: 'familie:birthe-foedselsdag:h', fortryd: fortrydBirthe(f.kort(f.loerdagPlus)) },
    { fra: 6, hhmm: '22:15', kilde: 'hermes', tekst: 'Kuratoren: dagen er lukket; intet nyt kræver dig.' },
    ...udviklingLog(f),
    // KC-0226: the two zone runs of the evening, each line named by its zone (and so seen only by who may see the zone).
    { fra: BESKEDER_FRA, hhmm: '19:28', kilde: 'hermes', tekst: 'Kuratoren (Arbejde): et kort fra beskeder er lagt øverst.', zone: 'arbejde' },
    { fra: BESKEDER_FRA, hhmm: '19:28', kilde: 'hermes', tekst: 'Kuratoren (Husstand): et kort fra beskeder er lagt øverst.', zone: 'husstand' },
  ];
  return logFra('hjem', poster, n, f);
}
