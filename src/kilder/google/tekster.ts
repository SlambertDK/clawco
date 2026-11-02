// KC-0170: what the Google connectors say, Danish and English (the shape of src/kilder/tekster.ts): the steps of making
// one's own Google app, the refusals of the OAuth exchange, and the sentences the calendar and Gmail connectors share. The
// names in quotation marks in a step ("Clients", "Create client", "Publish app") are the Google Cloud console's own words
// (the console is English whatever language Clawco speaks), so they stay as they are in both tables.

import { efterSprog } from '../tekst-hjaelp.ts';

const da = {
  // opsaet.ts: the steps
  klientTrinMedAdresse: 'Under "Clients": tryk "Create client", vælg "Web application", og indsæt denne adresse under "Authorized redirect URIs".',
  klientTrinUdenAdresse: 'Under "Clients": tryk "Create client" og vælg "Web application". Clawco kender ikke sin egen adresse endnu (KC_ADRESSE), så adressen, Google skal sende dig tilbage til, kan ikke vises. Ejeren skal sætte den først.',
  trinProjekt: 'Åbn console.cloud.google.com med din egen Google-konto, og lav et nyt projekt, fx "Clawco".',
  trinApi: (api: string): string => `Gå til "APIs & Services" og "Library", søg efter "${api}", og tryk "Enable".`,
  trinBranding: 'Gå til "Google Auth platform" og "Branding", tryk "Get started", giv appen et navn og din mail, og vælg "External" som målgruppe.',
  trinTestbruger: 'Under "Audience": tilføj din egen Google-konto som testbruger.',
  trinScope: 'Under "Data Access": tryk "Add or remove scopes", og tilføj denne tilladelse.',
  trinPublicer: 'Under "Audience": tryk "Publish app", så adgangen ikke udløber efter syv dage. Google kalder appen ikke godkendt; det er i orden, når det er din egen app til dig selv.',
  trinNoegler: 'Kopiér klient-id og klienthemmelighed fra "Clients", og sæt dem ind herunder.',
  tilfoejMedAdresse: 'Google-appen kender endnu kun den første forbindelses returadresse. Åbn din klient under "Clients" i "Google Auth platform", og tilføj denne adresse under "Authorized redirect URIs".',
  tilfoejUdenAdresse: 'Google-appen skal kende denne forbindelses returadresse under "Authorized redirect URIs", men Clawco kender ikke sin egen adresse endnu (KC_ADRESSE). Ejeren skal sætte den først.',

  // oauth.ts: the exchange
  googleUtilgaengelig: 'Google kunne ikke nås. Prøv igen om lidt.',
  adgangenTrukketTilbage: 'Google har trukket adgangen tilbage eller ladet den udløbe. Log ind med Google igen.',
  ukendtKlient: 'Google kender ikke Clawcos nøgle til kalenderen. Tjek klient-id og hemmelighed.',
  googleFejl: (status: number): string => `Google svarede med fejl ${status}.`,
  ingenAdgangSendt: 'Google sendte ingen adgang.',
  ingenVarigAdgang: 'Google gav ikke en varig adgang. Prøv at logge ind igen.',
  kalenderMangler: 'Clawco fik ikke lov til at se kalenderen. Log ind igen, og sæt flueben ved kalenderen.',
  kalenderFormeget: 'Google gav mere end læseadgang til kalenderen. Clawco tager kun imod læseadgang.',
  mailMangler: 'Clawco fik ikke lov til at læse din mail. Log ind igen, og sæt flueben ved mail.',
  mailFormeget: 'Google gav mere end mail og din adresse. Clawco tager kun imod det, den bad om.',

  // what the calendar and Gmail connectors share
  appIkkeSat: 'Google-appen er ikke sat op endnu: klient-id og klienthemmelighed mangler. Følg trinene på kortet.',
  ingenAdresse: 'Clawco kender ikke sin egen adresse (KC_ADRESSE), så Google ikke kan sende dig tilbage. Ejeren skal sætte den først.',
  loginIkkeBekraeftet: 'Login med Google kunne ikke bekræftes. Prøv igen.',
  klientIdEtiket: 'Klient-id',
  klientHemmelighedEtiket: 'Klienthemmelighed',
  appMangler: 'Google-appen mangler klient-id eller klienthemmelighed.',
};

export type GoogleTekster = typeof da;

const en: GoogleTekster = {
  klientTrinMedAdresse: 'Under "Clients": press "Create client", choose "Web application", and paste this address under "Authorized redirect URIs".',
  klientTrinUdenAdresse: 'Under "Clients": press "Create client" and choose "Web application". Clawco does not know its own address yet (KC_ADRESSE), so the address Google should send you back to cannot be shown. The owner has to set it first.',
  trinProjekt: 'Open console.cloud.google.com with your own Google account, and make a new project, e.g. "Clawco".',
  trinApi: (api) => `Go to "APIs & Services" and "Library", search for "${api}", and press "Enable".`,
  trinBranding: 'Go to "Google Auth platform" and "Branding", press "Get started", give the app a name and your email, and choose "External" as the audience.',
  trinTestbruger: 'Under "Audience": add your own Google account as a test user.',
  trinScope: 'Under "Data Access": press "Add or remove scopes", and add this permission.',
  trinPublicer: 'Under "Audience": press "Publish app", so the access does not expire after seven days. Google calls the app unverified; that is fine when it is your own app for yourself.',
  trinNoegler: 'Copy the client id and client secret from "Clients", and paste them in below.',
  tilfoejMedAdresse: 'The Google app only knows the first connection\'s return address so far. Open your client under "Clients" in "Google Auth platform", and add this address under "Authorized redirect URIs".',
  tilfoejUdenAdresse: 'The Google app has to know this connection\'s return address under "Authorized redirect URIs", but Clawco does not know its own address yet (KC_ADRESSE). The owner has to set it first.',

  googleUtilgaengelig: 'Google could not be reached. Try again in a moment.',
  adgangenTrukketTilbage: 'Google has withdrawn the access or let it expire. Log in with Google again.',
  ukendtKlient: 'Google does not recognise Clawco\'s key for the calendar. Check the client id and secret.',
  googleFejl: (status) => `Google answered with error ${status}.`,
  ingenAdgangSendt: 'Google sent no access.',
  ingenVarigAdgang: 'Google did not give a lasting access. Try logging in again.',
  kalenderMangler: 'Clawco was not allowed to see the calendar. Log in again, and tick the calendar.',
  kalenderFormeget: 'Google gave more than read access to the calendar. Clawco only accepts read access.',
  mailMangler: 'Clawco was not allowed to read your mail. Log in again, and tick mail.',
  mailFormeget: 'Google gave more than mail and your address. Clawco only accepts what it asked for.',

  appIkkeSat: 'The Google app is not set up yet: the client id and client secret are missing. Follow the steps on the card.',
  ingenAdresse: 'Clawco does not know its own address (KC_ADRESSE), so Google cannot send you back. The owner has to set it first.',
  loginIkkeBekraeftet: 'Logging in with Google could not be confirmed. Try again.',
  klientIdEtiket: 'Client id',
  klientHemmelighedEtiket: 'Client secret',
  appMangler: 'The Google app is missing the client id or the client secret.',
};

export const GOOGLE_TEKSTER = { da, en };
export const googleTekst = (): GoogleTekster => efterSprog(GOOGLE_TEKSTER);
