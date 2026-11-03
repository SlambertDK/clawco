// KC-0170: the words of the news connector and of its fetcher, address guard and feed parser (which the Aula reader shares),
// Danish and English (the shape of src/kilder/tekster.ts). Every sentence here is fixed text: never a provider's own words
// (untrusted; a server may echo what it was sent), never an address. "RSS", "Atom" and "OPML" are format names and stay.

import { efterSprog } from '../tekst-hjaelp.ts';

const da = {
  navn: 'Nyhedskilder',
  felt: {
    adresser: 'Adressen på en nyhedskilde (RSS). Du kan indsætte flere, en på hver linje',
    opml: 'Eller en OPML-fil fra din gamle læser',
    feeds: 'Dine kilder',
  },
  intro: 'Indsæt adressen på en nyhedskilde, eller upload en OPML-fil fra din gamle læser, så står nyhederne i Nyheder, når de er relevante. '
    + 'Clawco læser kun overskrifter og korte resuméer og henter dem hver morgen. Der følger ingen kilder med: du vælger selv. '
    + 'Har du brugt en anden læser, finder du OPML-filen under eksport eller OPML i dens indstillinger.',
  handling: { tilfoej: 'Tilføj', tilfoejFlere: 'Tilføj flere' },
  antal: (n: number): string => `${n} ${n === 1 ? 'nyhedskilde' : 'nyhedskilder'}`,
  /** "A", "A og B", "A, B og C", "A, B, C og 2 andre". */
  og: 'og',
  anden: 'anden',
  andre: 'andre',
  ukendtKilde: 'Ukendt kilde',

  // the card and the health
  kortListe: (antal: string, navne: string): string => `${antal}: ${navne}.`,
  svarerIkkeNu: (navne: string): string => `${navne} svarer ikke lige nu.`,
  tilfoejFlereTekst: 'Indsæt flere adresser eller en OPML-fil for at tilføje flere.',
  ingenKilder: 'Der er ingen nyhedskilder endnu.',
  ingenSvarer: (navne: string): string => `Ingen af kilderne svarer: ${navne}.`,
  proverIgen: 'Prøver igen.',
  ingenSvarede: 'Ingen af dine nyhedskilder svarede.',
  svarIkkeNyhedskilde: 'Svaret er ikke en nyhedskilde.',
  kildenIkkeLaest: 'Kilden kunne ikke læses.',
  kildenUdenIndhold: 'Kilden svarede uden indhold.',

  // the setup and the list's changes
  tilfoejede: (antal: string): string => `Tilføjede ${antal}.`,
  fandtesAllerede: (n: number): string => `${n} fandtes allerede.`,
  sprangOver: (n: number): string => `Clawco sprang ${n} over, fordi adressen ikke kan bruges.`,
  forMange: (maks: number, n: number): string => `Højst ${maks} kilder: ${n} var for mange og blev ikke tilføjet.`,
  ialt: (antal: string): string => `I alt ${antal}.`,
  tilfoejedeEn: (navn: string, antal: string): string => `Tilføjede ${navn}. I alt ${antal}.`,
  fjernede: (navn: string, adresse: string, antal: string): string => `Fjernede ${navn} (${adresse}). I alt ${antal}.`,

  // refusals
  adresseFejl: (raa: string, hvorfor: string): string => `${raa}: ${hvorfor}`,
  adresseIkkeBrugbar: 'adressen kan ikke bruges.',
  adresseForLang: (raa: string): string => `${raa}: adressen er for lang.`,
  ikkeBrugbarSomKilde: (vaert: string, hvorfor: string): string => `${vaert} kunne ikke bruges som nyhedskilde: ${hvorfor}`,
  denKunneIkkeLaeses: 'den kunne ikke læses.',
  ingenKildeFundet: (vaert: string): string => `${vaert}: siden har ingen nyhedskilde, Clawco kan finde. Find feedets egen adresse, og indsæt den.`,
  forMangeAdresser: (maks: number): string => `Indsæt højst ${maks} adresser ad gangen. Har du mange, så brug en OPML-fil.`,
  opmlIkkeLaest: 'Filen kunne ikke læses som OPML. Eksportér den igen fra din læser.',
  indsaetAdresseEllerFil: 'Indsæt en adresse eller vælg en OPML-fil.',
  indsaetAdresse: 'Indsæt adressen på en nyhedskilde.',
  enAdresseAdGangen: 'Indsæt én adresse ad gangen. Har du mange, så brug en OPML-fil, når du forbinder.',
  hoejstKilder: (maks: number): string => `Højst ${maks} kilder. Fjern en, før du tilføjer en ny.`,
  harDuAllerede: (navn: string): string => `${navn} har du allerede.`,
  kildenFindesIkke: 'Den kilde findes ikke længere.',
  sidsteKilde: 'Det er din sidste kilde. Vil du ikke have flere, så frakobl Nyhedskilder.',

  // adresse.ts: the address guard
  intern: 'Adressen peger på en intern tjeneste, som Clawco ikke må kalde.',
  lokalt: 'Adressen peger på dit lokale netværk. Skriv den selv ind, hvis det er meningen.',
  lokaltHostet: 'Adressen peger på et lokalt netværk, som Clawco ikke kan nå herfra.',
  tomEllerLang: 'Adressen er tom eller for lang.',
  skalBegynde: 'Adressen skal begynde med http:// eller https://.',
  kanIkkeLaeses: 'Adressen kan ikke læses.',
  ingenLogin: 'Adressen må ikke indeholde brugernavn eller adgangskode.',
  mangerVaert: 'Adressen mangler et værtsnavn.',
  afvist: 'Adressen er afvist.',

  // hent.ts: the fetcher
  findesIkke: 'Adressen findes ikke eller kan ikke slås op.',
  ikkeITide: 'Kilden svarede ikke i tide.',
  kanIkkeNaas: 'Kilden kunne ikke nås.',
  svarKunneIkkeLaeses: 'Svaret kunne ikke læses.',
  svarede: (status: number): string => `Kilden svarede ${status}.`,
  forStor: 'Kilden er for stor.',
  ukendtKomprimering: 'Kilden bruger en ukendt komprimering.',
  hoererIkkeTil: 'Adressen hører ikke til den tjeneste, kilden må tale med.',
  adresseSkiftet: 'Adressen peger nu et andet sted end dengang du tilføjede den, så Clawco henter den ikke. Fjern kilden og tilføj den igen, hvis det er meningen.',
  forMangeOmdirigeringer: 'Kilden sender dig videre for mange gange.',
  omdirigeringUdenMaal: 'Kilden sender dig videre uden at sige hvorhen.',
  omdirigeringIkkeBrugbar: 'Kilden sender dig videre til en adresse, der ikke kan bruges.',
  omdirigeringForbudt: 'Kilden sender dig videre til en tjeneste, den ikke må tale med.',

  // parse.ts: the feed parser
  svarTomt: 'Svaret er tomt.',
  xmlEntiteter: 'Svaret bruger XML-entiteter og afvises.',
  ikkeGyldigXml: 'Svaret er ikke gyldig XML.',
  ikkeEnKilde: 'Svaret er ikke en nyhedskilde (RSS eller Atom).',
  ikkeOpml: 'Filen er ikke en OPML-fil.',
};

export type RssTekster = typeof da;

const en: RssTekster = {
  navn: 'News sources',
  felt: {
    adresser: 'The address of a news source (RSS). You can paste several, one on each line',
    opml: 'Or an OPML file from your old reader',
    feeds: 'Your sources',
  },
  intro: 'Paste the address of a news source, or upload an OPML file from your old reader, and the news appears in News when it is relevant. '
    + 'Clawco only reads headlines and short summaries and fetches them every morning. No sources come with it: you choose yourself. '
    + 'If you have used another reader, you find the OPML file under export or OPML in its settings.',
  handling: { tilfoej: 'Add', tilfoejFlere: 'Add more' },
  antal: (n) => `${n} ${n === 1 ? 'news source' : 'news sources'}`,
  og: 'and',
  anden: 'other',
  andre: 'others',
  ukendtKilde: 'Unknown source',

  kortListe: (antal, navne) => `${antal}: ${navne}.`,
  svarerIkkeNu: (navne) => `${navne} is not answering right now.`,
  tilfoejFlereTekst: 'Paste more addresses or an OPML file to add more.',
  ingenKilder: 'There are no news sources yet.',
  ingenSvarer: (navne) => `None of the sources are answering: ${navne}.`,
  proverIgen: 'Trying again.',
  ingenSvarede: 'None of your news sources answered.',
  svarIkkeNyhedskilde: 'The answer is not a news source.',
  kildenIkkeLaest: 'The source could not be read.',
  kildenUdenIndhold: 'The source answered without content.',

  tilfoejede: (antal) => `Added ${antal}.`,
  fandtesAllerede: (n) => `${n} already existed.`,
  sprangOver: (n) => `Clawco skipped ${n}, because the address cannot be used.`,
  forMange: (maks, n) => `At most ${maks} sources: ${n} were too many and were not added.`,
  ialt: (antal) => `${antal} in all.`,
  tilfoejedeEn: (navn, antal) => `Added ${navn}. ${antal} in all.`,
  fjernede: (navn, adresse, antal) => `Removed ${navn} (${adresse}). ${antal} in all.`,

  adresseFejl: (raa, hvorfor) => `${raa}: ${hvorfor}`,
  adresseIkkeBrugbar: 'the address cannot be used.',
  adresseForLang: (raa) => `${raa}: the address is too long.`,
  ikkeBrugbarSomKilde: (vaert, hvorfor) => `${vaert} could not be used as a news source: ${hvorfor}`,
  denKunneIkkeLaeses: 'it could not be read.',
  ingenKildeFundet: (vaert) => `${vaert}: the page has no news source Clawco can find. Find the feed's own address, and paste it.`,
  forMangeAdresser: (maks) => `Paste at most ${maks} addresses at a time. If you have many, use an OPML file.`,
  opmlIkkeLaest: 'The file could not be read as OPML. Export it again from your reader.',
  indsaetAdresseEllerFil: 'Paste an address or choose an OPML file.',
  indsaetAdresse: 'Paste the address of a news source.',
  enAdresseAdGangen: 'Paste one address at a time. If you have many, use an OPML file when you connect.',
  hoejstKilder: (maks) => `At most ${maks} sources. Remove one before you add a new one.`,
  harDuAllerede: (navn) => `You already have ${navn}.`,
  kildenFindesIkke: 'That source no longer exists.',
  sidsteKilde: 'It is your last source. If you do not want any more, disconnect News sources.',

  intern: 'The address points at an internal service, which Clawco may not call.',
  lokalt: 'The address points at your local network. Type it in yourself if that is the intention.',
  lokaltHostet: 'The address points at a local network, which Clawco cannot reach from here.',
  tomEllerLang: 'The address is empty or too long.',
  skalBegynde: 'The address must begin with http:// or https://.',
  kanIkkeLaeses: 'The address cannot be read.',
  ingenLogin: 'The address must not contain a username or password.',
  mangerVaert: 'The address is missing a host name.',
  afvist: 'The address is refused.',

  findesIkke: 'The address does not exist or cannot be looked up.',
  ikkeITide: 'The source did not answer in time.',
  kanIkkeNaas: 'The source could not be reached.',
  svarKunneIkkeLaeses: 'The answer could not be read.',
  svarede: (status) => `The source answered ${status}.`,
  forStor: 'The source is too large.',
  ukendtKomprimering: 'The source uses an unknown compression.',
  hoererIkkeTil: 'The address does not belong to the service the source may talk to.',
  adresseSkiftet: 'The address now points somewhere other than when you added it, so Clawco does not fetch it. Remove the source and add it again if that is the intention.',
  forMangeOmdirigeringer: 'The source sends you on too many times.',
  omdirigeringUdenMaal: 'The source sends you on without saying where.',
  omdirigeringIkkeBrugbar: 'The source sends you on to an address that cannot be used.',
  omdirigeringForbudt: 'The source sends you on to a service it may not talk to.',

  svarTomt: 'The answer is empty.',
  xmlEntiteter: 'The answer uses XML entities and is refused.',
  ikkeGyldigXml: 'The answer is not valid XML.',
  ikkeEnKilde: 'The answer is not a news source (RSS or Atom).',
  ikkeOpml: 'The file is not an OPML file.',
};

export const RSS_TEKSTER = { da, en };
export const rssTekst = (): RssTekster => efterSprog(RSS_TEKSTER);
