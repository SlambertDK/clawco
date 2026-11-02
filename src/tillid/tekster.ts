// KC-0170: the words of the trust pages ("Hvad Clawco ved om dig", "Slet alt", the week's number) and of the rules file's
// own header, Danish and English (the shape of src/kilder/tekster.ts): plain text or small functions, escaped by whoever
// renders them, read at render time through the language of the request, English with exactly Danish's keys
// (test/tillid/tekster.test.ts). The product's name comes in as an argument, from `PRODUKT`.
// Not here, on purpose: the parts of a Hermes prompt (prompt.ts, REGELFORSLAG_TEKST), the operator's own messages (a rules
// file that cannot be read keeps its Danish reason in the data; the page and the rules block of a Hermes prompt translate the
// known ones through `ulaeseligHvorfor`, KC-0242), the rules
// file's own syntax (the keys trin, gaelder, oprindelse, status, naeste-id and the origins ret, haand, import are the
// file's format), the starter rules written into Henrik's own file (start.ts) and the Danish detector of subjects in
// kilder/danmark.

import { sprogNu } from '../store/sprog.ts';

type Par = readonly [een: string, flere: string];

/** Why a rules file cannot be read, as the code keeps it: Danish, because it goes into Hermes' prompt (prompt.ts). The page translates these. */
export const ULAESELIG = {
  aabne: 'filen kunne ikke åbnes',
  laese: 'filen kunne ikke læses',
  naesteMangler: 'linjen "naeste-id: R-…" mangler øverst i filen',
  naesteFlere: 'linjen "naeste-id" står mere end én gang',
  naesteForm: 'linjen "naeste-id" skal have formen R-0001',
} as const;

const da = {
  /** The decimal separator of a file size ("2,0 kB"). */
  decimal: ',',
  /** A count with its noun: `en` for one, `flere` otherwise. */
  navneord: { linje: ['linje', 'linjer'], besked: ['besked', 'beskeder'], fil: ['fil', 'filer'], andenFil: ['anden fil', 'andre filer'], afsnit: ['afsnit', 'afsnit'] } as Record<string, Par>,
  /** A source's slags and a data zone in the Kilder list: the id itself in Danish. */
  slags: { kalender: 'kalender', mail: 'mail', noter: 'noter', nyheder: 'nyheder', beskeder: 'beskeder' } as Record<string, string>,
  zone: { privat: 'privat', arbejde: 'arbejde', husstand: 'husstand' } as Record<string, string>,
  lagerNavn: { nav: 'Hvornår du åbnede rummene' } as Record<string, string>,
  univers: (slug: string): string => `Univers: ${slug}`,

  // the page
  overskrift: (produkt: string): string => `Hvad ${produkt} ved om dig`,
  underoverskrift: (produkt: string): string => `Alt, hvad ${produkt} har gemt om dig, samlet ét sted.`,
  alleSlettet: 'Alt er slettet',
  tomOgForfra: (produkt: string): string => `${produkt} er tom og starter forfra. Din vault og dine egne noter er der stadig.`,
  kilder: 'Kilder',
  ingenKilder: 'Ingen kilder er koblet til.',
  regler: 'Regler',
  ingenRegler: 'Ingen regler endnu.',
  filen: 'Filen: ',
  filenAendret: (produkt: string): string => `Filen er ændret uden for ${produkt}. Det er helt i orden; reglerne læses, som de står i filen nu.`,
  filenUlaeselig: (hvorfor: string): string => `Filen kan ikke læses (${hvorfor}). Indtil den er rettet, må Hermes kun se og foreslå.`,
  /** What a rules file can be unreadable for, as the code keeps it (Danish, for Hermes' prompt), in the words of the page. */
  ulaeseligHvorfor: Object.fromEntries(Object.values(ULAESELIG).map((v) => [v, v])) as Record<string, string>,
  afsnitForkerte: (antal: string, overskrifter: string): string => `${antal} i filen er skrevet forkert og følges ikke: ${overskrifter}.`,
  gaelderAlt: 'gælder alt',
  slaaTilIgen: 'Slå til igen',
  slaaFra: 'Slå fra',
  trinLinje: (trin: number, navn: string): string => `Trin ${trin} · Hermes må ${navn} · `,
  paaPause: ' · på pause',
  oprindelse: { ret: 'Fra en rettelse', 'ikke-relevant': 'Fra "Ikke relevant"', haand: 'Skrevet i hånden', import: 'Importeret' } as Record<string, string>,
  personer: 'Personer',
  personerNoter: 'Personerne er dine egne noter i ',
  personerLaeser: (produkt: string): string => `. ${produkt} læser dem kun.`,
  registerTomt: 'Personregisteret er tomt.',
  ingetRegister: 'Der er ikke valgt noget personregister.',
  ugetal: 'Ting der krævede dig',
  ugetalKommer: (produkt: string): string => `Tallet kommer, når ${produkt} har talt en dag.`,
  gemt: 'Gemt',
  ingetGemt: (produkt: string): string => `${produkt} har ikke gemt noget.`,
  iLoggen: (linjer: string, beskeder: string, stoerrelse: string): string => `${linjer} i loggen · ${beskeder} · ${stoerrelse}`,
  filerIClawcoFoer: (antal: string): string => `${antal} i Clawco-mappen i din vault: `,
  andreFiler: (antal: string, produkt: string): string => `${antal}: forbindelser, indstillinger og hvad ${produkt} har gjort.`,
  noeglerFiler: (antal: string): string => `${antal} med nøgler og logins til dine kilder. De kommer ikke med i Hent alt.`,
  ialt: (stoerrelse: string): string => `I alt ${stoerrelse}.`,
  hentAlt: 'Hent alt',
  sletAlt: 'Slet alt',

  // Slet alt's confirmation
  tilbage: 'Tilbage',
  kanIkkeFortrydes: 'Det kan ikke fortrydes.',
  detBlivSlettet: 'Det bliver slettet',
  rumLinje: (navn: string, linjer: string, beskeder: string): string => `${navn}: ${linjer} i loggen og ${beskeder}`,
  reglerneFoer: 'Reglerne: ',
  filerIClawco: (antal: string): string => `${antal} i Clawco-mappen i din vault`,
  andreFilerKort: (antal: string, produkt: string): string => `${antal}: forbindelser, indstillinger og hvad ${produkt} har gjort`,
  noeglerFilerKort: (antal: string): string => `${antal} med nøgler og logins til dine kilder`,
  blivLiggende: 'Bliver liggende: din vault og dine egne noter, også personerne i personregisteret.',
  hentAltFoerst: 'Hent alt først',
  skrivOrd: 'Skriv SLET for at bekræfte',

  // the week's number (dagstal.ts)
  denneUge: 'I denne uge',
  sidsteUge: 'Sidste uge',
  iUge: (nr: number): string => `I uge ${nr}`,
  sidsteUgeNavn: 'sidste uge',
  ugenFoer: 'ugen før',
  ugeNavn: (nr: number): string => `uge ${nr}:`,
  foersteUge: (a: number): string => `Første uge: ${a} om dagen. Sammenligning kommer næste uge.`,
  ugeLinje: (start: string, a: number, sidste: string, fortryd: number, steg: string, faldt: string): string => `${start} krævede i snit ${a} ting dig om dagen ${sidste}. Fortryd: ${fortryd}${steg}.${faldt}`,
  fortrydForrige: (navn: string, n: number): string => ` (${navn} ${n})`,
  detErFaldet: ' Det er faldet, uden at Fortryd steg.',
  hjaelp: 'Sådan tæller vi: en ting tæller for en dag, hvis den stod under Kræver dig på noget tidspunkt den dag, og kun én gang den dag. Fortryd er de handlinger, du fortrød i ugen. Tallet skal falde, uden at Fortryd stiger.',
  ugeTal: (nr: number, tal: string): string => `uge ${nr}: ${tal}`,
  soejlerAlt: (tekst: string): string => `Ting der krævede dig om dagen, uge for uge: ${tekst}`,

  // slet.ts
  sletRod: (rod: string): string => `Slet alt sletter kun i en datamappe, ikke ${rod}`,
  ingenMappe: '(ingen mappe)',
  dataErVault: 'Datamappen er også din vault; Slet alt sletter ikke dine noter',
  sletRevision: 'Slet alt: ejeren bekræftede med SLET',

  // the rules file's own header (regler.ts)
  reglerTitel: '# Regler for Clawco',
  indledning: (trin: string): string => `Det, Hermes må gøre af sig selv. Én regel pr. afsnit: overskriften har reglens faste nummer, så trin (${trin}), hvad den gælder for, hvor den kom fra og om den er aktiv eller på pause; derefter din egen tekst. Du må rette i filen. En regel, der er skrevet forkert, bliver ikke fulgt. Rør ikke linjen naeste-id: den sørger for, at et nummer aldrig bruges to gange.`,

  // forslag.ts: the app's own proposal to pause a rule
  pauseTitel: (titel: string): string => `Sæt «${titel}» på pause`,
  pauseTekst: (id: string, kort: string): string => `Reglen ${id} skjulte «${kort}», som du ville have set. På pause følger Hermes den ikke, før du tænder den igen.`,
};

export type TillidTekster = typeof da;

const en: TillidTekster = {
  decimal: '.',
  navneord: { linje: ['line', 'lines'], besked: ['message', 'messages'], fil: ['file', 'files'], andenFil: ['other file', 'other files'], afsnit: ['section', 'sections'] },
  slags: { kalender: 'calendar', mail: 'mail', noter: 'notes', nyheder: 'news', beskeder: 'messages' },
  zone: { privat: 'private', arbejde: 'work', husstand: 'household' },
  lagerNavn: { nav: 'When you opened the rooms' },
  univers: (slug) => `Universe: ${slug}`,

  overskrift: (produkt) => `What ${produkt} knows about you`,
  underoverskrift: (produkt) => `Everything ${produkt} has saved about you, in one place.`,
  alleSlettet: 'Everything is deleted',
  tomOgForfra: (produkt) => `${produkt} is empty and starts over. Your vault and your own notes are still there.`,
  kilder: 'Sources',
  ingenKilder: 'No sources are connected.',
  regler: 'Rules',
  ingenRegler: 'No rules yet.',
  filen: 'The file: ',
  filenAendret: (produkt) => `The file was changed outside ${produkt}. That is perfectly fine; the rules are read as they stand in the file now.`,
  filenUlaeselig: (hvorfor) => `The file cannot be read (${hvorfor}). Until it is fixed, Hermes may only look and suggest.`,
  ulaeseligHvorfor: {
    [ULAESELIG.aabne]: 'the file could not be opened',
    [ULAESELIG.laese]: 'the file could not be read',
    [ULAESELIG.naesteMangler]: 'the line "naeste-id: R-…" is missing at the top of the file',
    [ULAESELIG.naesteFlere]: 'the line "naeste-id" appears more than once',
    [ULAESELIG.naesteForm]: 'the line "naeste-id" must have the form R-0001',
  },
  afsnitForkerte: (antal, overskrifter) => `${antal} in the file are written wrongly and are not followed: ${overskrifter}.`,
  gaelderAlt: 'applies to everything',
  slaaTilIgen: 'Turn on again',
  slaaFra: 'Turn off',
  trinLinje: (trin, navn) => `Step ${trin} · Hermes may ${navn} · `,
  paaPause: ' · paused',
  oprindelse: { ret: 'From a correction', 'ikke-relevant': 'From "Not relevant"', haand: 'Written by hand', import: 'Imported' },
  personer: 'People',
  personerNoter: 'The people are your own notes in ',
  personerLaeser: (produkt) => `. ${produkt} only reads them.`,
  registerTomt: 'The people register is empty.',
  ingetRegister: 'No people register is chosen.',
  ugetal: 'Things that needed you',
  ugetalKommer: (produkt) => `The number comes when ${produkt} has counted a day.`,
  gemt: 'Saved',
  ingetGemt: (produkt) => `${produkt} has not saved anything.`,
  iLoggen: (linjer, beskeder, stoerrelse) => `${linjer} in the log · ${beskeder} · ${stoerrelse}`,
  filerIClawcoFoer: (antal) => `${antal} in the Clawco folder in your vault: `,
  andreFiler: (antal, produkt) => `${antal}: connections, settings and what ${produkt} has done.`,
  noeglerFiler: (antal) => `${antal} with keys and logins to your sources. They are not part of Download everything.`,
  ialt: (stoerrelse) => `${stoerrelse} in all.`,
  hentAlt: 'Download everything',
  sletAlt: 'Delete everything',

  tilbage: 'Back',
  kanIkkeFortrydes: 'This cannot be undone.',
  detBlivSlettet: 'What will be deleted',
  rumLinje: (navn, linjer, beskeder) => `${navn}: ${linjer} in the log and ${beskeder}`,
  reglerneFoer: 'The rules: ',
  filerIClawco: (antal) => `${antal} in the Clawco folder in your vault`,
  andreFilerKort: (antal, produkt) => `${antal}: connections, settings and what ${produkt} has done`,
  noeglerFilerKort: (antal) => `${antal} with keys and logins to your sources`,
  blivLiggende: 'What stays: your vault and your own notes, also the people in the people register.',
  hentAltFoerst: 'Download everything first',
  skrivOrd: 'Type DELETE to confirm',

  denneUge: 'This week',
  sidsteUge: 'Last week',
  iUge: (nr) => `In week ${nr}`,
  sidsteUgeNavn: 'last week',
  ugenFoer: 'the week before',
  ugeNavn: (nr) => `week ${nr}:`,
  foersteUge: (a) => `First week: ${a} a day. A comparison comes next week.`,
  ugeLinje: (start, a, sidste, fortryd, steg, faldt) => `${start}, on average ${a} things needed you a day ${sidste}. Undo: ${fortryd}${steg}.${faldt}`,
  fortrydForrige: (navn, n) => ` (${navn} ${n})`,
  detErFaldet: ' It has fallen without Undo rising.',
  hjaelp: 'How we count: a thing counts for a day if it stood under Needs you at any time that day, and only once that day. Undo is the actions you undid during the week. The number should fall without Undo rising.',
  ugeTal: (nr, tal) => `week ${nr}: ${tal}`,
  soejlerAlt: (tekst) => `Things that needed you per day, week by week: ${tekst}`,

  sletRod: (rod) => `Delete everything only deletes in a data folder, not ${rod}`,
  ingenMappe: '(no folder)',
  dataErVault: 'The data folder is also your vault; Delete everything does not delete your notes',
  sletRevision: 'Delete everything: the owner confirmed with DELETE',

  reglerTitel: '# Rules for Clawco',
  indledning: (trin) => `What Hermes may do on its own. One rule per section: the heading has the rule's fixed number, then step (${trin}), what it applies to, where it came from and whether it is active or paused; then your own text. You may edit the file. A rule that is written wrongly is not followed. Do not touch the line naeste-id: it makes sure a number is never used twice.`,

  pauseTitel: (titel) => `Pause «${titel}»`,
  pauseTekst: (id, kort) => `The rule ${id} hid «${kort}», which you wanted to see. While paused, Hermes does not follow it until you turn it on again.`,
};

export const TILLID_TEKSTER = { da, en };
/** The trust pages' words in the language of the request (Danish when none is set). */
export const tillidTekst = (): TillidTekster => TILLID_TEKSTER[sprogNu()];
/** A count with its noun ("1 linje", "3 linjer"). */
export const flertal = (n: number, noegle: string): string => {
  const [een, flere] = tillidTekst().navneord[noegle] ?? [noegle, noegle];
  return `${n} ${n === 1 ? een : flere}`;
};
