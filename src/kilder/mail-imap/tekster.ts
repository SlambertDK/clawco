// KC-0170: the words of the IMAP mail connector, Danish and English (the shape of src/kilder/tekster.ts): the card and its
// field labels, the two declared verbs, the refusals and the sentences an action answers, the fixed failure sentences
// (FEJLTEKST in fejl.ts reads from here) and the service names. Provider names (Proton, Bridge, Fastmail, iCloud, Gmail) and
// protocol words (TLS, STARTTLS, IMAP, INBOX, Archive) stay as they are in both tables. The folder-name pattern in imap.ts
// that recognises Danish trash folders is a matcher, not a text, and stays.

import { efterSprog } from '../tekst-hjaelp.ts';

const da = {
  navn: 'Mail',
  tjenester: { 'proton-bridge': 'Proton (via Bridge)', fastmail: 'Fastmail', icloud: 'iCloud', gmail: 'Gmail (app-adgangskode)', anden: 'Anden mailudbyder' },

  felt: {
    tjeneste: 'Din mailtjeneste',
    adresse: 'Din mailadresse',
    adgangskode: 'App-adgangskode (med Proton: adgangskoden, Bridge viser, ikke din Proton-adgangskode)',
    server: 'Serveradresse (kun ved Anden mailudbyder)',
    sikkerhed: 'Kryptering (kun ved Anden mailudbyder)',
    port: 'Port (kun hvis din udbyder eller Bridge bruger en anden)',
    fingeraftryk: 'Bridge-certifikatets fingeraftryk (Clawco udfylder det selv første gang)',
    tls: 'TLS (port 993)',
    starttls: 'STARTTLS (port 143)',
  },
  intro: 'Clawco læser afsender, emne og dato på dine nyeste mails, aldrig selve brevene. '
    + 'Når du trykker, kan Clawco flytte en mail til en anden mappe i kontoen og gemme et svar som kladde; Clawco sender og sletter aldrig noget. '
    + 'Vælg din mailtjeneste, skriv din mailadresse og en app-adgangskode, som du laver hos din mailudbyder. '
    + 'Bruger du Proton, skal Proton Mail Bridge køre på maskinen, og adgangskoden er den, Bridge viser, ikke din Proton-adgangskode.',
  verber: {
    flyt: 'Flytter en mail til en anden mappe i din mailkonto, fx arkivet. Aldrig til papirkurven eller spam.',
    kladde: 'Gemmer et svar som kladde i din kladdemappe. Clawco sender det aldrig.',
  },
  handling: { forbind: 'Forbind', forbindIgen: 'Forbind igen', skiftKonto: 'Skift konto' },

  // the card by state
  loginIgen: (fejl: string): string => `${fejl} Skriv adgangskoden igen, og tryk Forbind igen.`,
  kontoen: (bruger: string, tjeneste: string): string => `Mailkontoen ${bruger} hos ${tjeneste}.`,
  talIndbakke: (ulaeste: string, flag: number): string => `${ulaeste} i indbakken; ${flag} af de nyeste er markeret med flag.`,
  fingeraftrykTekst: (fp: string): string => `Bridge-certifikatets fingeraftryk: ${fp}.`,
  kunLaes: 'Clawco læser kun afsender, emne og dato. Når du trykker, flytter Clawco en mail eller gemmer et svar som kladde; Clawco sender og sletter aldrig noget.',
  ulaeste: (n: number): string => `${n} ${n === 1 ? 'ulæst' : 'ulæste'}`,
  sidstLaestUnderMinut: 'Sidst læst for under et minut siden.',
  sidstLaest: (min: number): string => `Sidst læst for ${min} ${min === 1 ? 'minut' : 'minutter'} siden.`,
  ikkeSatOp: 'Mailkontoen er ikke sat op.',

  // opsaet / act answers
  forbundetTil: (tjeneste: string, bruger: string, ulaeste: string): string => `Forbundet til ${tjeneste} som ${bruger}: ${ulaeste} i indbakken.`,
  pinGemt: (pin: string): string => ` Bridge-certifikatets fingeraftryk ${pin} er gemt.`,
  mailenFlyttet: (til: string): string => `Mailen er flyttet til ${til}.`,
  kladdenLigger: (mappe: string): string => `Kladden ligger i ${mappe}. Clawco har ikke sendt den.`,

  // refusals
  handlingenMangler: 'Handlingen mangler sine oplysninger.',
  ukendtOplysning: (n: string): string => `Ukendt oplysning: ${n}.`,
  oplysningenMangler: (n: string): string => `Oplysningen ${n} mangler.`,
  mailIdUgyldigt: 'Mailens id er ugyldigt.',
  mappenavnUgyldigt: 'Mappens navn er ugyldigt.',
  kladdeTekstKrav: (maks: number): string => `Kladden skal have en tekst på højst ${maks} tegn.`,
  adgangskodenMangler: 'Adgangskoden mangler. Forbind mailen igen.',
  mailKanIkke: (navn: string): string => `Mail kan ikke ${navn}.`,
  skrivAdgangskode: 'Skriv din app-adgangskode.',
  fingeraftrykUgyldigt: 'Fingeraftrykket er ugyldigt.',
  vaelgTjeneste: 'Vælg din mailtjeneste.',
  skrivAdresse: 'Skriv din mailadresse.',
  skrivServer: 'Skriv adressen på din mailserver.',
  serverUgyldig: 'Serveradressen er ugyldig.',
  serverIkkeHostet: 'Den mailserver kan Clawco ikke bruge her. Her kan Clawco kun nå mailservere på internettet.',
  portUgyldig: 'Porten skal være et tal mellem 1 og 65535.',
  ingenMove: 'Din mailudbyder kan ikke flytte mails direkte, så Clawco lader mailen ligge.',
  mappeFindesIkke: (mappe: string): string => `Mappen ${mappe} findes ikke i din mailkonto.`,
  maalFindesIkke: (mappe: string): string => `Mappen ${mappe} findes ikke i din mailkonto, og Clawco opretter ikke mapper.`,
  forbudtMaal: 'Clawco flytter aldrig mail til papirkurven, spam eller andre særlige mapper.',
  ligger: (mappe: string): string => `Mailen ligger allerede i ${mappe}.`,
  liggerIkkeI: (mappe: string): string => `Mailen ligger ikke længere i ${mappe}.`,
  ingenKladdemappe: 'Mailkontoen har ingen kladdemappe, så Clawco kan ikke gemme kladden.',
  liggerIkkeIndbakke: 'Mailen ligger ikke længere i indbakken.',
  ingenAfsender: 'Mailen har ingen afsender, Clawco kan skrive en kladde til.',
  kontoAdresseUgyldig: 'Mailkontoens adresse er ugyldig.',
  /** The subject of a saved draft when the mail had none. */
  udenEmne: '(uden emne)',

  // the fixed failure sentences (fejl.ts)
  fejl: {
    adgangskode: 'Forkert adgangskode. Brug en app-adgangskode fra din mailudbyder; med Proton er det adgangskoden, Bridge viser.',
    bridge: 'Bridge kører ikke. Start Proton Mail Bridge på denne maskine, og prøv igen.',
    svarer: 'Mailserveren svarer ikke. Tjek serveradressen og din internetforbindelse.',
    certifikat: 'Mailserverens certifikat kunne ikke bekræftes, så Clawco forbinder ikke.',
    pin: 'Bridge-certifikatet er et andet end sidst. Har du selv geninstalleret Bridge, så forbind igen.',
    kryptering: 'Mailserveren tilbyder ikke kryptering, så Clawco forbinder ikke.',
    ukendt: 'Mailen kunne ikke hentes.',
  },
};

export type ImapTekster = typeof da;

const en: ImapTekster = {
  navn: 'Mail',
  tjenester: { 'proton-bridge': 'Proton (via Bridge)', fastmail: 'Fastmail', icloud: 'iCloud', gmail: 'Gmail (app password)', anden: 'Another mail provider' },

  felt: {
    tjeneste: 'Your mail service',
    adresse: 'Your email address',
    adgangskode: 'App password (with Proton: the password Bridge shows, not your Proton password)',
    server: 'Server address (only for Another mail provider)',
    sikkerhed: 'Encryption (only for Another mail provider)',
    port: 'Port (only if your provider or Bridge uses another)',
    fingeraftryk: 'The Bridge certificate\'s fingerprint (Clawco fills it in itself the first time)',
    tls: 'TLS (port 993)',
    starttls: 'STARTTLS (port 143)',
  },
  intro: 'Clawco reads the sender, subject and date of your newest mails, never the letters themselves. '
    + 'When you press, Clawco can move a mail to another folder in the account and save a reply as a draft; Clawco never sends or deletes anything. '
    + 'Choose your mail service, type your email address and an app password, which you make at your mail provider. '
    + 'If you use Proton, Proton Mail Bridge has to run on the machine, and the password is the one Bridge shows, not your Proton password.',
  verber: {
    flyt: 'Moves a mail to another folder in your mail account, e.g. the archive. Never to the trash or spam.',
    kladde: 'Saves a reply as a draft in your drafts folder. Clawco never sends it.',
  },
  handling: { forbind: 'Connect', forbindIgen: 'Connect again', skiftKonto: 'Change account' },

  loginIgen: (fejl) => `${fejl} Type the password again, and press Connect again.`,
  kontoen: (bruger, tjeneste) => `The mail account ${bruger} at ${tjeneste}.`,
  talIndbakke: (ulaeste, flag) => `${ulaeste} in the inbox; ${flag} of the newest are marked with a flag.`,
  fingeraftrykTekst: (fp) => `The Bridge certificate's fingerprint: ${fp}.`,
  kunLaes: 'Clawco only reads the sender, subject and date. When you press, Clawco moves a mail or saves a reply as a draft; Clawco never sends or deletes anything.',
  ulaeste: (n) => `${n} unread`,
  sidstLaestUnderMinut: 'Last read less than a minute ago.',
  sidstLaest: (min) => `Last read ${min} ${min === 1 ? 'minute' : 'minutes'} ago.`,
  ikkeSatOp: 'The mail account is not set up.',

  forbundetTil: (tjeneste, bruger, ulaeste) => `Connected to ${tjeneste} as ${bruger}: ${ulaeste} in the inbox.`,
  pinGemt: (pin) => ` The Bridge certificate's fingerprint ${pin} is saved.`,
  mailenFlyttet: (til) => `The mail was moved to ${til}.`,
  kladdenLigger: (mappe) => `The draft is in ${mappe}. Clawco has not sent it.`,

  handlingenMangler: 'The action is missing its details.',
  ukendtOplysning: (n) => `Unknown detail: ${n}.`,
  oplysningenMangler: (n) => `The detail ${n} is missing.`,
  mailIdUgyldigt: 'The mail\'s id is not valid.',
  mappenavnUgyldigt: 'The folder\'s name is not valid.',
  kladdeTekstKrav: (maks) => `The draft must have a text of at most ${maks} characters.`,
  adgangskodenMangler: 'The password is missing. Connect the mail again.',
  mailKanIkke: (navn) => `Mail cannot ${navn}.`,
  skrivAdgangskode: 'Type your app password.',
  fingeraftrykUgyldigt: 'The fingerprint is not valid.',
  vaelgTjeneste: 'Choose your mail service.',
  skrivAdresse: 'Type your email address.',
  skrivServer: 'Type the address of your mail server.',
  serverUgyldig: 'The server address is not valid.',
  serverIkkeHostet: 'Clawco cannot use that mail server here. Here Clawco can only reach mail servers on the internet.',
  portUgyldig: 'The port must be a number between 1 and 65535.',
  ingenMove: 'Your mail provider cannot move mails directly, so Clawco leaves the mail where it is.',
  mappeFindesIkke: (mappe) => `The folder ${mappe} does not exist in your mail account.`,
  maalFindesIkke: (mappe) => `The folder ${mappe} does not exist in your mail account, and Clawco does not create folders.`,
  forbudtMaal: 'Clawco never moves mail to the trash, spam or other special folders.',
  ligger: (mappe) => `The mail is already in ${mappe}.`,
  liggerIkkeI: (mappe) => `The mail is no longer in ${mappe}.`,
  ingenKladdemappe: 'The mail account has no drafts folder, so Clawco cannot save the draft.',
  liggerIkkeIndbakke: 'The mail is no longer in the inbox.',
  ingenAfsender: 'The mail has no sender Clawco can write a draft to.',
  kontoAdresseUgyldig: 'The mail account\'s address is not valid.',
  udenEmne: '(no subject)',

  fejl: {
    adgangskode: 'Wrong password. Use an app password from your mail provider; with Proton it is the password Bridge shows.',
    bridge: 'Bridge is not running. Start Proton Mail Bridge on this machine, and try again.',
    svarer: 'The mail server is not answering. Check the server address and your internet connection.',
    certifikat: 'The mail server\'s certificate could not be verified, so Clawco does not connect.',
    pin: 'The Bridge certificate is different from last time. If you reinstalled Bridge yourself, connect again.',
    kryptering: 'The mail server does not offer encryption, so Clawco does not connect.',
    ukendt: 'The mail could not be fetched.',
  },
};

export const IMAP_TEKSTER = { da, en };
export const imapTekst = (): ImapTekster => efterSprog(IMAP_TEKSTER);
