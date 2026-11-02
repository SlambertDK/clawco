// What the test world's Hermes says in a chat (KC-0068): keyword-matched per
// moment, in every room, in the spoken style the voice reads aloud (two to
// four sentences, no lists, no markdown). Pure text; svar.ts adds the JSON
// blocks the rooms parse (a moved run, shorter paragraphs) from the signals
// returned here. Rewritten from the demo's samtale.ts (KC-0058) for six moments.

import type { Fakta } from './fakta.ts';

export type ChatResultat = {
  tekst: string;
  /** Which intent answered, or "kontekst" / "fallback". */
  art: string;
  /** "flyt løbeturen": the run's new start and end, "HH.MM". */
  flyt?: { tid: string; slut: string };
  /** "gør den kortere": the room should add proposals. */
  kortere?: boolean;
};

type Ctx = { n: number; f: Fakta; rum: string; t: string };
type Intent = { art: string; matcher: (c: Ctx) => boolean; svar: (c: Ctx) => string | ChatResultat };

const har = (c: Ctx, re: RegExp): boolean => re.test(c.t);
/** The answer for moment n from six (one per moment). */
const lige = (n: number, ...alle: string[]): string => alle[Math.min(n, alle.length - 1)] ?? '';

/** "flyt den til 17.30" → "17.30"; a bare "17" → "17.00". */
function klokkeslaet(besked: string): string {
  const m = /(\d{1,2})(?:\s*[.:]\s*(\d{2}))?/.exec(besked);
  if (!m) return '17.00';
  const h = Math.min(23, Number(m[1]));
  return `${String(h).padStart(2, '0')}.${m[2] ?? '00'}`;
}

const INTENTS: Intent[] = [
  // KC-0126: in Start the chat is the agent in a guided mode — every sentence there is about the journey.
  {
    art: 'start',
    matcher: (c) => c.rum === 'start',
    svar: () => 'Svar på det øverste kort: skriv hvad du hedder, vælg sprog, og om du er alene eller en husstand. Når det virker, bliver kortet Klaret, og det næste trin står øverst.',
  },
  // KC-0148: Husstanden's week, as the family calendar (indhold/husstand.ts) has it.
  {
    art: 'husstand',
    matcher: (c) => c.rum === 'husstand' && har(c, /uge|husstand|familie|vi\b/),
    svar: () => 'I dag er der fællesspisning kl. 18. I morgen har Ella svømning kl. 16.30, og i overmorgen er der forældremøde i 2.B kl. 19 for dig og Maja. Om fire dage kommer Farmor på besøg hele dagen.',
  },
  // KC-0077: the sentences the empty chat offers as buttons (shell/forslag.ts).
  {
    art: 'venter',
    matcher: (c) => har(c, /\bventer på mig\b/),
    svar: (c) => lige(c.n,
      'Syv mails venter på dig i Mail, og mødet klokken 11 med Clara og Jonas skal forberedes. Resten kan vente.',
      'Syv mails venter, og Clara vil have svar på, om du kommer klokken 11. Mødet er forberedt.',
      'Intet haster: alle mails er klaret. Mødet begynder om ti minutter.',
      'Intet venter på dig lige nu. Du sidder i mødet, og det slutter klokken 12.',
      'Opfølgningen til Clara ligger i Skrive med to forslag, og du skal hente Ella klokken 15.35.',
      'Kun ét: Maja har spurgt om lørdag, og det svarer du selv.',
      'Intet venter på dig. Alt er ordnet, og lørdag hos Birthe står i kalenderen.',
      'Kun én ting: Dagen blev ikke bygget i morges. Tryk "Byg Dagen nu" i Dagen.',
      'Kun én ting: Dagen blev ikke bygget i morges. Tryk "Byg Dagen nu" i Dagen.',
      'Intet haster. Lørdag i næste uge har Maja kursus og den store bil fra 9 til 13; sig til i Husstanden, hvis du skal bruge den.'),
  },
  {
    art: 'kan-vente',
    matcher: (c) => har(c, /\bkan vente\b/),
    svar: () => 'Elektrikerens tilbud kan vente til fredag, og vindbrevet kan afmeldes, når som helst du vil. Mødet med Clara og Jonas kan ikke vente.',
  },
  {
    art: 'ledig-tid',
    matcher: (c) => har(c, /hvornår har jeg tid|ledig tid|ledigt/),
    svar: (c) => (c.n < 4
      ? 'Det mest ledige hul er klokken 13 til 14, efter løbeturen. Klokken 14 er der opfølgning, og du henter Ella klokken 15.45.'
      : 'Resten af dagen er fri, på nær at du henter Ella klokken 15.35. Det regner fra klokken 16.'),
  },
  {
    art: 'nyhederne',
    matcher: (c) => har(c, /betyder.*nyhed|nyhederne for mig/),
    svar: () => 'Vigtigst for dig er grønt lys til den nordlige korridor: den er udgangspunktet i dagens møde med Clara. Resten er baggrund, du kan lade ligge.',
  },
  {
    art: 'univers-status',
    matcher: (c) => c.rum.startsWith('univers') && har(c, /gang i|åbent her|følge op på/),
    svar: () => 'I Havvind Nord er mødet klokken 11 det næste, og opfølgningen til Clara er den åbne opgave. Resten ligger roligt.',
  },
  {
    art: 'kortere',
    matcher: (c) => har(c, /kortere|stram|forkort/),
    svar: (c) => (c.rum === 'skrive'
      ? { tekst: 'Her er et kortere bud på de længste afsnit. Brug dem, du kan lide.', art: 'kortere', kortere: true }
      : 'Det gør jeg i Skrive, hvor udkastet ligger. Sig "jeg vil skrive", så åbner jeg det.'),
  },
  {
    art: 'flyt',
    matcher: (c) => har(c, /flyt/) && har(c, /løb/),
    svar: (c) => {
      const tid = klokkeslaet(c.t);
      const [h, m] = tid.split('.').map(Number);
      const slut = `${String(Math.min(23, (h ?? 17) + 1)).padStart(2, '0')}.${String(m ?? 0).padStart(2, '0')}`;
      const regn = (h ?? 0) >= 16 && (h ?? 0) < 19 ? ' Husk, at det regner fra klokken 16 til 19.' : '';
      return { tekst: `Løbeturen ligger nu klokken ${tid}.${regn}`, art: 'flyt', flyt: { tid, slut } };
    },
  },
  {
    art: 'sidst',
    matcher: (c) => har(c, /sidst|sidste (møde|gang)|tidligere møde/),
    svar: (c) => (c.n < 4
      ? `Sidst var den ${c.f.forrigeKort}, hvor I gennemgik begge kabeltracéer. Beslutningen blev udskudt: Clara skulle have en afklaring, før slottet hos kabelleverandøren udløber, og Jonas lovede kapacitetstal. Siden er den nordlige rute blevet godkendt.`
      : `I dag klokken 11 blev I enige om den nordlige rute som udgangspunkt. Sidste gang, den ${c.f.forrigeKort}, blev valget udskudt, fordi Jonas manglede kapacitetstal.`),
  },
  {
    art: 'bekymring',
    matcher: (c) => har(c, /bekymr|nervøs|bange|går hun op i/),
    svar: (c) => (c.n < 4
      ? 'Claras største bekymring er produktionsslottet i december. Hvis ruten ikke er valgt om knap to uger, mister Nordvik slottet, og udlægningen rykker et helt sæsonvindue. Derfor vil hun have et svar på kabeltracéet i dag.'
      : 'Hendes største bekymring var produktionsslottet i december. Med den nordlige rute som udgangspunkt er den afværget, hvis Jonas bekræfter tilslutningspunktet inden for en uge.'),
  },
  {
    art: 'moede',
    matcher: (c) => har(c, /kom der ud af|blev vi enige|besluttet|resultat|konklusion|referat|mødet/),
    svar: (c) => lige(c.n,
      'Mødet er klokken 11 med Clara og Jonas om Havvind Nord. Tryk Forbered mødet i Dagen, så samler jeg talepunkter og slides.',
      'Mødet klokken 11 er forberedt: fire talepunkter og slides ligger i Havvind Nord. Gå ind med nordlig rute som udgangspunkt.',
      'Mødet begynder om ti minutter i Mødelokale 2. Gå ind med nordlig rute som udgangspunkt, og få en dato fra Jonas på tilslutningspunktet.',
      'Mødet er i gang og slutter klokken 12. Hold fast i den nordlige rute, og få en dato fra Jonas på tilslutningspunktet.',
      'I blev enige om den nordlige rute som udgangspunkt. Jonas bekræfter tilslutningspunktet inden for en uge, og fordelingen af meromkostningen tager I på næste møde. Opfølgningen til Clara ligger i Skrive.',
      'Mødet endte med nordlig rute, og opfølgningen til Clara er gemt. Jonas bekræfter tilslutningspunktet inden for en uge.'),
  },
  {
    art: 'elektriker',
    matcher: (c) => har(c, /elektriker|eltavle|tilbud|lysnet/),
    svar: (c) => (c.n < 2
      ? 'Svar, at du gerne vil have en pris uden de to ekstra grupper, så du kan sammenligne. Tilbuddet er på 18.400 kroner, 2.600 over dit budget, og prisen gælder til fredag. Udkastet ligger i Mail; tryk Gem som kladde, så sender jeg intet.'
      : 'Kladden til elektrikeren ligger i Drafts. Du bad om en pris uden de to ekstra grupper, og tilbuddet på 18.400 kroner gælder til fredag.'),
  },
  {
    art: 'regnskab',
    matcher: (c) => har(c, /regnskab|bredbånd|løbeklub|kontingent|elregning/),
    svar: (c) => lige(c.n,
      'Elregningen er skrevet i det private regnskab. Løbeklubbens kontingent fortrød du, så det kan skrives igen med ét tryk, og internetregningen ved jeg ikke, hvor hører til; vælg regnskab på kortet i Hjem.',
      'Elregningen står i det private regnskab. Løbeklubben fortrød du, så den kan skrives igen med ét tryk, og internetregningen venter på dit valg af regnskab.',
      'Internetregningen og VVS-fakturaen står nu i det private regnskab; du kan flytte dem med ét tryk. Løbeklubben er ikke skrevet, fordi du fortrød den.',
      'Internetregningen og VVS-fakturaen står i det private regnskab, og løbeklubben venter på, at du skriver den igen.',
      'Internetregningen og VVS-fakturaen står i det private regnskab. Løbeklubben er stadig ikke skrevet; kortet i Hjem kan skrive den igen.',
      'Fire regninger i dag: elregningen, internetregningen og VVS-fakturaen står i det private regnskab, og løbeklubbens kontingent fortrød du.'),
  },
  {
    art: 'vvs',
    matcher: (c) => har(c, /vvs|blandingsbatteri|rørvang|faktura/),
    svar: (c) => (c.n < 2
      ? `VVS-fakturaen er på 4.210 kroner og matcher tilbuddet, så den kan betales. Den forfalder ${c.f.forfald}. Jeg betaler aldrig selv, men jeg kan lægge den i Betalinger, så godkender du den.`
      : `Fakturaen på 4.210 kroner ligger i Betalinger med forfald ${c.f.forfald}. Betalingen godkender du selv i din bank; jeg rører ikke ved pengene.`),
  },
  {
    art: 'claude-code',
    matcher: (c) => har(c, /claude|ticket|udvikling|opgave/),
    svar: (c) => lige(c.n,
      'Claude Code har modtaget din opgave om vejret i hilsenen i aften, og Nyhedernes sortering er i gang. Kø-panelet er parkeret: det venter på dit valg af plads i menuen.',
      'Sorteringen i Nyheder er færdig, og vejret i hilsenen er modtaget. Fejlkortet fra i nat kan du sende til Claude Code med ét tryk.',
      'Fejlene fra i nat er sendt til Claude Code og modtaget. Vejret i hilsenen er i gang.',
      'Både fejlene og vejret i hilsenen er i gang hos Claude Code.',
      'Fejlene fra i nat er rettet. Claude Code spørger om vejret i hilsenen: hele dagen eller kun om morgenen? Svaret står i Hjem.',
      'Alt er landet i dag: fejlene fra i nat og vejret i hilsenen. Kø-panelet venter stadig på dit valg.'),
  },
  {
    art: 'loerdag',
    matcher: (c) => har(c, /lørdag|weekend|birthe|fødselsdag|fri\b/),
    svar: (c) => (c.n < 5
      ? 'Lørdag er helt fri i kalenderen. Der er intet planlagt endnu.'
      : 'Ja, lørdag er helt fri. Maja har foreslået fødselsdag hos Birthe klokken 14; tryk Reservér lørdag på kortet i Hjem, så lægger jeg det i kalenderen. Svaret til Maja giver du selv.'),
  },
  {
    art: 'tilbage',
    matcher: (c) => har(c, /løb|tilbage|hjemme/),
    svar: (c) => (c.n < 4
      ? 'Løbeturen ligger klokken 12.15 og er slut klokken 13, så du er tilbage i god tid til opfølgningen klokken 14.'
      : 'Løbeturen er overstået for i dag. I morgen er der tørvejr hele dagen.'),
  },
  {
    art: 'mangler',
    matcher: (c) => har(c, /mangler|hente|ella|sfo/),
    svar: (c) => (c.n < 5
      ? 'Du henter Ella i SFO klokken 15.45, fordi Maja har nattevagt. Det regner fra klokken 16, så tag regnjakken i gangen.'
      : 'Ella er hentet og ligger i seng. Der mangler kun dit svar til Maja om lørdag.'),
  },
  {
    art: 'dag',
    matcher: (c) => har(c, /godmorgen|god morgen|i dag|planen|overblik|program/),
    svar: (c) => lige(c.n,
      'Godmorgen, Henrik. Klokken 11 er der møde med Clara og Jonas om Havvind Nord. Det regner fra 16 til 19, så løbeturen er flyttet til klokken 12.15, og du henter Ella klokken 15.45. Syv mails venter i Mail.',
      'Mødet klokken 11 er forberedt, og syv mails venter på dig lige nu. Løbet ligger klokken 12.15, opfølgningen klokken 14, og Ella hentes 15.45.',
      'Om ti minutter er der møde om Havvind Nord. Alle mails er klaret. Bagefter er der løb klokken 12.15 og opfølgningen klokken 14.',
      'Du sidder i mødet nu, og det slutter klokken 12. Bagefter er der løb, opfølgningen til Clara klokken 14 og Ella klokken 15.45.',
      'Opfølgningen til Clara ligger i Skrive med to forslag. Klokken 15.35 skal du gå efter Ella; det regner fra 16.',
      'Resten af dagen er din. Ella er hentet, opfølgningen er gemt, og i morgen går toget 07.12. Maja har spurgt om lørdag.'),
  },
  {
    art: 'vigtigst',
    // "Hvad skal jeg nu?" asks the same thing: the one next move at this moment.
    matcher: (c) => har(c, /vigtigst|haster|prioritet|(skal|gør) jeg nu|hvad (så )?nu|næste skridt/),
    svar: (c) => lige(c.n,
      'Det vigtigste i dag er mødet klokken 11 om Havvind Nord. Læs Claras dagsorden i toget.',
      'Svar Clara først: hun vil vide, om du kommer klokken 11, og udkastet er klar. Elektrikeren kan vente til fredag.',
      'Mødet om ti minutter. Gå ind med nordlig rute som udgangspunkt.',
      'At få en aftale om kabeltracéet, før I går fra hinanden.',
      'Opfølgningen til Clara, og at gå efter Ella klokken 15.35.',
      'At svare Maja om lørdag. Ellers intet.',
      'Ingenting. Gå i seng; i morgen går toget 07.12.',
      'At få Dagen bygget: morgenbygningen nåede det ikke. Tryk "Byg Dagen nu", så har du overblikket om et par minutter.',
      'At starte Clawco igen: Maja trykkede Stop alt klokken 7.52. Tryk "Start igen" øverst, når du har set, hvad der skete.',
      'At få bilen til lørdag i næste uge på plads: Maja har den store bil 9 til 13 til et kursus. Skriv i Husstanden, hvornår du skal bruge den.',
      'At få kalenderen tilbage: den er logget ud, så Dagen mangler ugen. Tryk "Log ind igen" på kortet under Forbindelser.',
      'At få mailen i gang igen: Clawco kan ikke nå den, og listen i Mail er fra i går aftes. Skriv adgangskoden igen på kortet under Forbindelser.',
      'At logge ind på kalenderen igen i dag, så den ikke holder op med at virke i morgen aften. Kortet under Forbindelser har knappen.',
      'Intet haster: Gmail er koblet, og dine ulæste mails står i Nu. Clawco læser kun afsender, emne og tid.',
      'At logge ind med Google igen: din Gmail er logget ud, så Clawco kan ikke læse den. Tryk "Log ind igen" på kortet under Forbindelser.',
      'Intet haster: sidste uge krævede i snit 6 ting dig om dagen, ugen før 7. Ugens tal står øverst i Nu.',
      'At få weekenden på plads: du og Maja er begge optaget lørdag, og Ella skal have en voksen. Kortet i Husstanden er det samme hos jer begge; vælg, hvem der tager hende.',
      'Søndagstjekket: fire af de fem ting, jeg skjulte i ugen, venter på dit Rigtigt eller Skulle have vist mig det. Det tager et minut.',
      'At svare på, om vi skal stoppe søndagstjekket: tre uger i træk var alt det, jeg skjulte, rigtigt.'),
  },
  {
    art: 'hvem',
    matcher: (c) => har(c, /clara|jonas|maja|nordvik/),
    svar: () => 'Clara Holm er projektleder hos Nordvik Energi og din kontakt i Havvind Nord. Jonas Berg er din kollega og ansvarlig for tilslutningspunktet. Maja har nattevagt hele ugen.',
  },
  {
    art: 'godnat',
    matcher: (c) => har(c, /godnat|god nat|sov godt/),
    svar: () => 'Godnat, Henrik. I morgen går toget 07.12, og klokken 9 er der stand-up. Jeg sender intet til nogen i nat.',
  },
];

/** The chat answer in room `rum` at moment `n`. `kontekst` is the element Henrik points at ("Om: …"), if any. */
export function chatSvar(rum: string, n: number, besked: string, f: Fakta, kontekst?: string): ChatResultat {
  const c: Ctx = { n, f, rum, t: besked.toLowerCase() };
  for (const i of INTENTS) {
    if (!i.matcher(c)) continue;
    const s = i.svar(c);
    return typeof s === 'string' ? { tekst: s, art: i.art } : s;
  }
  if (kontekst) return { tekst: `Om ${kontekst.slice(0, 80)}: det hænger sammen med resten af dagen, og jeg har intet at tilføje lige nu. Spørg gerne mere konkret.`, art: 'kontekst' };
  return { tekst: 'Det har jeg ikke noget godt svar på i testtilstanden. Spørg om dagen, mødet, mails, regnskabet eller Claude Code.', art: 'fallback' };
}
