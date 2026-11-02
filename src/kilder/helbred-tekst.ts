// The fixed words (Danish, and English by the language of the request, KC-0170) of a failing connection (KC-0139). A card says what is
// wrong from this table, keyed by (visible state, auth kind, slags) — never with
// a provider's own words (untrusted; a server may echo what it was sent).

import { efterSprog, sproglig } from './tekst-hjaelp.ts';
import type { Auth, Felt, Slags } from './types.ts';

/**
 * How long a successful read may stand as current, per slags. Reads happen when a room builds (Dagen once a day, Mail
 * at the frontload times), so the window is a day and a bit; past it the data is labelled old, whatever the health says.
 */
export const FRISKHEDSVINDUE_MS: Record<Slags, number> = {
  kalender: 30 * 3600_000, mail: 30 * 3600_000, nyheder: 30 * 3600_000, noter: 30 * 3600_000, beskeder: 30 * 3600_000,
};

/** The states that get a card (langsomt is shown quietly: it asks nothing of anyone). */
export type KortTilstand = 'snart-udloebet' | 'log-ind-igen' | 'nede';

/** One calm line of a card: the title, the sentence and (for the primary handling) the button's label. */
type Kortet = { titel: string; tekst: string; knap: string };
type Navn = { subj: string; obj: string };

// KC-0170: the fixed words in Danish and English. A card is chosen from this table by (visible state, auth kind, slags),
// never with a provider's own words. English has exactly Danish's keys (test/kilder/tekster.test.ts holds that).
const da = {
  navneord: {
    kalender: { subj: 'Din kalender', obj: 'din kalender' },
    mail: { subj: 'Din mail', obj: 'din mail' },
    noter: { subj: 'Dine noter', obj: 'dine noter' },
    nyheder: { subj: 'Dine nyheder', obj: 'dine nyheder' },
    beskeder: { subj: 'Dine beskeder', obj: 'dine beskeder' },
  } as Record<Slags, Navn>,
  /** The button of the one primary handling: what restarts this kind of connection. */
  knap: { oauth: 'Log ind igen', apikey: 'Indtast adgangskoden igen', bridge: 'Indtast adgangskoden igen', local: 'Vælg mappen igen' } as Record<Auth, string>,
  /** KC-0138: a message channel is linked at Hermes, not in Clawco — the one step that links each channel again. */
  genforbindKanal: {
    telegram: 'Telegram er ikke forbundet til Hermes. Tjek bot-nøglen i Hermes med "hermes gateway setup", og genstart Hermes.',
    whatsapp: 'WhatsApp er logget ud af Hermes. Kør "hermes whatsapp" på serveren, og scan QR-koden med telefonen igen.',
    signal: 'Signal er ikke forbundet til Hermes. Link Signal igen med "signal-cli link", og genstart Hermes.',
  } as Record<'telegram' | 'whatsapp' | 'signal', string>,
  /** KC-0138: messages come through Hermes' channels, so the words speak of Hermes and the button checks again. */
  beskeder: {
    knap: 'Tjek igen',
    'log-ind-igen': { titel: 'Hermes har mistet en af dine beskedkanaler', tekst: 'Forbind kanalen igen på serveren, hvor Hermes kører: WhatsApp med "hermes whatsapp" (scan QR-koden), Signal med "signal-cli link", Telegram med "hermes gateway setup". Genstart Hermes, så læser Clawco videre i de samtaler, du har valgt.' },
    nede: { titel: 'Dine beskeder svarer ikke', tekst: 'Hermes har ikke skrevet beskeder til Clawco i et stykke tid. Tjek, at Hermes kører.' },
    'snart-udloebet': { titel: 'Adgangen til dine beskeder udløber snart', tekst: 'Forbind kanalen igen hos Hermes, så dine beskeder ikke holder op med at virke.' },
  },
  /** KC-0235: a calendar kept by a private link (Aula's Ugekalender): the secret is a link, so the words speak of the link. */
  kalenderLink: {
    'log-ind-igen': { titel: 'Kalenderlinket virker ikke længere', tekst: 'Lav et nyt kalenderlink i Aula, og indsæt det her. Det kan være, at samtykket er trukket tilbage, eller at kommunen har slået synkronisering fra.', knap: 'Indsæt et nyt link' },
    nede: { titel: 'Din kalender svarer ikke', tekst: 'Clawco har ikke kunnet hente din kalender i et stykke tid. Indsæt linket igen; svarer den stadig ikke, er det hos udbyderen.', knap: 'Indsæt linket igen' },
    'snart-udloebet': { titel: 'Kalenderlinket udløber snart', tekst: 'Lav et nyt kalenderlink i Aula, og indsæt det her, så din kalender ikke holder op med at virke.', knap: 'Indsæt et nyt link' },
  },
  /** The general cards, by state: a function of the slags' words (and the primary button) so each sentence reads naturally. */
  logIndIgen: {
    oauth: ({ subj, obj }: Navn, knap: string): Kortet => ({ titel: `${subj} er logget ud`, tekst: `Clawco kan ikke hente ${obj}, før du har logget ind igen.`, knap }),
    lokal: ({ obj }: Navn, knap: string): Kortet => ({ titel: `Mappen med ${obj} kan ikke åbnes`, tekst: `Vælg mappen igen, så henter Clawco ${obj} igen.`, knap }),
    kode: ({ obj }: Navn, knap: string): Kortet => ({ titel: `Adgangskoden til ${obj} virker ikke længere`, tekst: `Skriv adgangskoden igen, så henter Clawco ${obj} igen.`, knap }),
  },
  nede: {
    lokal: ({ obj }: Navn, knap: string): Kortet => ({ titel: `Mappen med ${obj} er væk`, tekst: 'Clawco kan ikke finde mappen. Er den flyttet eller koblet fra, så vælg den igen.', knap }),
    andre: ({ subj, obj }: Navn, knap: string): Kortet => ({ titel: `${subj} svarer ikke`, tekst: `Clawco har ikke kunnet hente ${obj} i et stykke tid. Forbind igen; svarer den stadig ikke, er det hos udbyderen.`, knap }),
  },
  snartUdloebet: {
    oauth: ({ obj }: Navn, knap: string): Kortet => ({ titel: `Adgangen til ${obj} udløber snart`, tekst: `Log ind igen nu, så ${obj} ikke holder op med at virke.`, knap }),
    lokal: ({ obj }: Navn, knap: string): Kortet => ({ titel: `Adgangen til mappen med ${obj} udløber snart`, tekst: `Vælg mappen igen nu, så ${obj} ikke holder op med at virke.`, knap }),
    kode: ({ obj }: Navn, knap: string): Kortet => ({ titel: `Adgangskoden til ${obj} udløber snart`, tekst: `Skriv den igen nu, så ${obj} ikke holder op med at virke.`, knap }),
  },
};

export type HelbredTekster = typeof da;

const en: HelbredTekster = {
  navneord: {
    kalender: { subj: 'Your calendar', obj: 'your calendar' },
    mail: { subj: 'Your mail', obj: 'your mail' },
    noter: { subj: 'Your notes', obj: 'your notes' },
    nyheder: { subj: 'Your news', obj: 'your news' },
    beskeder: { subj: 'Your messages', obj: 'your messages' },
  },
  knap: { oauth: 'Log in again', apikey: 'Enter the password again', bridge: 'Enter the password again', local: 'Choose the folder again' },
  genforbindKanal: {
    telegram: 'Telegram is not connected to Hermes. Check the bot key in Hermes with "hermes gateway setup", and restart Hermes.',
    whatsapp: 'WhatsApp is logged out of Hermes. Run "hermes whatsapp" on the server, and scan the QR code with your phone again.',
    signal: 'Signal is not connected to Hermes. Link Signal again with "signal-cli link", and restart Hermes.',
  },
  beskeder: {
    knap: 'Check again',
    'log-ind-igen': { titel: 'Hermes has lost one of your message channels', tekst: 'Connect the channel again on the server where Hermes runs: WhatsApp with "hermes whatsapp" (scan the QR code), Signal with "signal-cli link", Telegram with "hermes gateway setup". Restart Hermes, and Clawco keeps reading the conversations you chose.' },
    nede: { titel: 'Your messages are not answering', tekst: 'Hermes has not written messages to Clawco for a while. Check that Hermes is running.' },
    'snart-udloebet': { titel: 'Access to your messages expires soon', tekst: 'Connect the channel again at Hermes, so your messages do not stop working.' },
  },
  kalenderLink: {
    'log-ind-igen': { titel: 'The calendar link no longer works', tekst: 'Make a new calendar link in Aula, and paste it here. The consent may have been withdrawn, or the municipality may have turned synchronisation off.', knap: 'Paste a new link' },
    nede: { titel: 'Your calendar is not answering', tekst: 'Clawco has not been able to fetch your calendar for a while. Paste the link again; if it still does not answer, the fault is at the provider.', knap: 'Paste the link again' },
    'snart-udloebet': { titel: 'The calendar link expires soon', tekst: 'Make a new calendar link in Aula, and paste it here, so your calendar does not stop working.', knap: 'Paste a new link' },
  },
  logIndIgen: {
    oauth: ({ subj, obj }, knap) => ({ titel: `${subj} is logged out`, tekst: `Clawco cannot fetch ${obj} until you have logged in again.`, knap }),
    lokal: ({ obj }, knap) => ({ titel: `The folder with ${obj} cannot be opened`, tekst: `Choose the folder again, and Clawco fetches ${obj} again.`, knap }),
    kode: ({ obj }, knap) => ({ titel: `The password for ${obj} no longer works`, tekst: `Enter the password again, and Clawco fetches ${obj} again.`, knap }),
  },
  nede: {
    lokal: ({ obj }, knap) => ({ titel: `The folder with ${obj} is gone`, tekst: 'Clawco cannot find the folder. If it was moved or disconnected, choose it again.', knap }),
    andre: ({ subj, obj }, knap) => ({ titel: `${subj} is not answering`, tekst: `Clawco has not been able to fetch ${obj} for a while. Connect again; if it still does not answer, the fault is at the provider.`, knap }),
  },
  snartUdloebet: {
    oauth: ({ obj }, knap) => ({ titel: `Access to ${obj} expires soon`, tekst: `Log in again now, so ${obj} does not stop working.`, knap }),
    lokal: ({ obj }, knap) => ({ titel: `Access to the folder with ${obj} expires soon`, tekst: `Choose the folder again now, so ${obj} does not stop working.`, knap }),
    kode: ({ obj }, knap) => ({ titel: `The password for ${obj} expires soon`, tekst: `Enter it again now, so ${obj} does not stop working.`, knap }),
  },
};

export const HELBRED_TEKSTER = { da, en };
const T = (): HelbredTekster => efterSprog(HELBRED_TEKSTER);

/** The button of the one primary handling: what restarts this kind of connection. */
export const KNAP: Record<Auth, string> = sproglig({ da: da.knap, en: en.knap });

/**
 * KC-0138: a message channel is linked at Hermes, not in Clawco — the one step that links each channel again, in the
 * app's own words (commands from hermes-agent's source: docs/superpowers/specs/2026-11-01-beskeder-gateway-fund.md).
 */
export const GENFORBIND_KANAL: Record<'telegram' | 'whatsapp' | 'signal', string> = sproglig({ da: da.genforbindKanal, en: en.genforbindKanal });

/** KC-0138: messages come through Hermes' channels, so the words speak of Hermes and the button checks again. */
function beskederTekst(vist: KortTilstand): Kortet {
  const b = T().beskeder;
  return { ...b[vist], knap: b.knap };
}

/** KC-0235: a calendar kept by a private link (Aula's Ugekalender): the secret is a link, so the words speak of the link. */
const kalenderLinkTekst = (vist: KortTilstand): Kortet => T().kalenderLink[vist];

/** The card's title, one calm sentence and the primary button's label, from the fixed table. */
export function kortTekst(vist: KortTilstand, auth: Auth, slags: Slags): Kortet {
  if (slags === 'beskeder' && auth === 'bridge') return beskederTekst(vist);
  if (slags === 'kalender' && auth === 'apikey') return kalenderLinkTekst(vist);
  const t = T();
  const navn = t.navneord[slags];
  const knap = t.knap[auth];
  const lokal = auth === 'local';
  if (vist === 'log-ind-igen') return t.logIndIgen[auth === 'oauth' ? 'oauth' : lokal ? 'lokal' : 'kode'](navn, knap);
  if (vist === 'nede') return t.nede[lokal ? 'lokal' : 'andre'](navn, knap);
  return t.snartUdloebet[auth === 'oauth' ? 'oauth' : lokal ? 'lokal' : 'kode'](navn, knap);
}

/** A field of the reconnect form: `skjult` = sent along as it was stored, not shown. */
export type GenforbindFelt = { navn: string; etiket: string; type: Felt['type']; paakraevet: boolean; maks?: number; muligheder?: { vaerdi: string; etiket: string }[]; vaerdi?: string; skjult: boolean };

/** A pinned certificate fingerprint is never offered again: a changed certificate must be trusted anew (mail-imap). */
const IKKE_IGEN = new Set(['fingeraftryk']);

/**
 * The reconnect form from the connector's own card and the options stored at the first connect: secrets and folders
 * are asked again, a stored option goes along unseen, and a required field with no stored value is asked too.
 */
export function genforbindFelter(felter: readonly Felt[], valg: Readonly<Record<string, string>>): GenforbindFelt[] {
  const ud: GenforbindFelt[] = [];
  for (const f of felter) {
    if (IKKE_IGEN.has(f.navn)) continue;
    const gemt = Object.hasOwn(valg, f.navn) ? valg[f.navn] : undefined;
    const faelles = { navn: f.navn, etiket: f.etiket, type: f.type, paakraevet: f.paakraevet, ...(f.maks ? { maks: f.maks } : {}), ...(f.muligheder ? { muligheder: f.muligheder } : {}) };
    if (f.type === 'hemmelig') ud.push({ ...faelles, skjult: false });
    else if (f.type === 'mappe') ud.push({ ...faelles, ...(gemt ? { vaerdi: gemt } : {}), skjult: false });
    else if (gemt) ud.push({ ...faelles, vaerdi: gemt, skjult: true });
    else if (f.paakraevet) ud.push({ ...faelles, skjult: false });
  }
  return ud;
}

/** The one spoken sentence of a broken source — only for log-ind-igen and nede; null for everything else (the voice stays quiet). */
export function stemmeSaetning(vist: string, auth: Auth, slags: Slags): string | null {
  return vist === 'log-ind-igen' || vist === 'nede' ? `${kortTekst(vist, auth, slags).titel}.` : null;
}
