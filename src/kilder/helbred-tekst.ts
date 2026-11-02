// The fixed Danish words of a failing connection (KC-0139). A card says what is
// wrong from this table, keyed by (visible state, auth kind, slags) — never with
// a provider's own words (untrusted; a server may echo what it was sent).

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

const NAVNEORD: Record<Slags, { subj: string; obj: string }> = {
  kalender: { subj: 'Din kalender', obj: 'din kalender' },
  mail: { subj: 'Din mail', obj: 'din mail' },
  noter: { subj: 'Dine noter', obj: 'dine noter' },
  nyheder: { subj: 'Dine nyheder', obj: 'dine nyheder' },
  beskeder: { subj: 'Dine beskeder', obj: 'dine beskeder' },
};

/** The button of the one primary handling: what restarts this kind of connection. */
export const KNAP: Record<Auth, string> = { oauth: 'Log ind igen', apikey: 'Indtast adgangskoden igen', bridge: 'Indtast adgangskoden igen', local: 'Vælg mappen igen' };

/**
 * KC-0138: a message channel is linked at Hermes, not in Clawco — the one step that links each channel again, in the
 * app's own words (commands from hermes-agent's source: docs/superpowers/specs/2026-11-01-beskeder-gateway-fund.md).
 */
export const GENFORBIND_KANAL: Record<'telegram' | 'whatsapp' | 'signal', string> = {
  telegram: 'Telegram er ikke forbundet til Hermes. Tjek bot-nøglen i Hermes med "hermes gateway setup", og genstart Hermes.',
  whatsapp: 'WhatsApp er logget ud af Hermes. Kør "hermes whatsapp" på serveren, og scan QR-koden med telefonen igen.',
  signal: 'Signal er ikke forbundet til Hermes. Link Signal igen med "signal-cli link", og genstart Hermes.',
};

/** KC-0138: messages come through Hermes' channels, so the words speak of Hermes and the button checks again. */
function beskederTekst(vist: KortTilstand): { titel: string; tekst: string; knap: string } {
  const knap = 'Tjek igen';
  if (vist === 'log-ind-igen') return { titel: 'Hermes har mistet en af dine beskedkanaler', tekst: 'Forbind kanalen igen på serveren, hvor Hermes kører: WhatsApp med "hermes whatsapp" (scan QR-koden), Signal med "signal-cli link", Telegram med "hermes gateway setup". Genstart Hermes, så læser Clawco videre i de samtaler, du har valgt.', knap };
  if (vist === 'nede') return { titel: 'Dine beskeder svarer ikke', tekst: 'Hermes har ikke skrevet beskeder til Clawco i et stykke tid. Tjek, at Hermes kører.', knap };
  return { titel: 'Adgangen til dine beskeder udløber snart', tekst: 'Forbind kanalen igen hos Hermes, så dine beskeder ikke holder op med at virke.', knap };
}

/** KC-0235: a calendar kept by a private link (Aula's Ugekalender): the secret is a link, so the words speak of the link. */
function kalenderLinkTekst(vist: KortTilstand): { titel: string; tekst: string; knap: string } {
  if (vist === 'log-ind-igen') return { titel: 'Kalenderlinket virker ikke længere', tekst: 'Lav et nyt kalenderlink i Aula, og indsæt det her. Det kan være, at samtykket er trukket tilbage, eller at kommunen har slået synkronisering fra.', knap: 'Indsæt et nyt link' };
  if (vist === 'nede') return { titel: 'Din kalender svarer ikke', tekst: 'Clawco har ikke kunnet hente din kalender i et stykke tid. Indsæt linket igen; svarer den stadig ikke, er det hos udbyderen.', knap: 'Indsæt linket igen' };
  return { titel: 'Kalenderlinket udløber snart', tekst: 'Lav et nyt kalenderlink i Aula, og indsæt det her, så din kalender ikke holder op med at virke.', knap: 'Indsæt et nyt link' };
}

/** The card's title, one calm sentence and the primary button's label, from the fixed table. */
export function kortTekst(vist: KortTilstand, auth: Auth, slags: Slags): { titel: string; tekst: string; knap: string } {
  if (slags === 'beskeder' && auth === 'bridge') return beskederTekst(vist);
  if (slags === 'kalender' && auth === 'apikey') return kalenderLinkTekst(vist);
  const { subj, obj } = NAVNEORD[slags];
  const knap = KNAP[auth];
  const lokal = auth === 'local';
  if (vist === 'log-ind-igen') {
    if (auth === 'oauth') return { titel: `${subj} er logget ud`, tekst: `Clawco kan ikke hente ${obj}, før du har logget ind igen.`, knap };
    if (lokal) return { titel: `Mappen med ${obj} kan ikke åbnes`, tekst: `Vælg mappen igen, så henter Clawco ${obj} igen.`, knap };
    return { titel: `Adgangskoden til ${obj} virker ikke længere`, tekst: `Skriv adgangskoden igen, så henter Clawco ${obj} igen.`, knap };
  }
  if (vist === 'nede') {
    if (lokal) return { titel: `Mappen med ${obj} er væk`, tekst: 'Clawco kan ikke finde mappen. Er den flyttet eller koblet fra, så vælg den igen.', knap };
    return { titel: `${subj} svarer ikke`, tekst: `Clawco har ikke kunnet hente ${obj} i et stykke tid. Forbind igen; svarer den stadig ikke, er det hos udbyderen.`, knap };
  }
  if (auth === 'oauth') return { titel: `Adgangen til ${obj} udløber snart`, tekst: `Log ind igen nu, så ${obj} ikke holder op med at virke.`, knap };
  if (lokal) return { titel: `Adgangen til mappen med ${obj} udløber snart`, tekst: `Vælg mappen igen nu, så ${obj} ikke holder op med at virke.`, knap };
  return { titel: `Adgangskoden til ${obj} udløber snart`, tekst: `Skriv den igen nu, så ${obj} ikke holder op med at virke.`, knap };
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
