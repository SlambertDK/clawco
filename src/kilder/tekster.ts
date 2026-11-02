// KC-0170: the words of the connector framework itself — the registry's refusals and log lines, the one secret module's
// refusals and the read check — Danish and English, in the shape of src/rooms/mail/tekster.ts: plain text or small
// functions, read at call time through the language of the request (never at load), English with exactly Danish's keys
// (the type and test/kilder/tekster.test.ts hold that). A refusal is a KildeFejl whose message a route sends as `error`.
// Not here, on purpose: the operator's own messages (a broken kilder.json, a connector registered wrongly, console lines),
// which are written for whoever runs the installation and stay Danish.

import { efterSprog } from './tekst-hjaelp.ts';

const da = {
  /** The slags in a log line ("forbandt Mail (mail)"): the id itself in Danish. */
  slags: { kalender: 'kalender', mail: 'mail', noter: 'noter', nyheder: 'nyheder', beskeder: 'beskeder' } as Record<string, string>,

  // register.ts: what a connect body may carry
  feltetSkalVaereObjekt: 'felter skal være et objekt',
  ukendtFelt: (navn: string): string => `ukendt felt: ${navn}`,
  feltMangler: (etiket: string): string => `${etiket} mangler`,
  feltUgyldigt: (etiket: string): string => `${etiket} er ugyldig`,
  feltIkkeEtAfValgene: (etiket: string): string => `${etiket} er ikke et af valgene`,
  ugyldigForespoergsel: 'ugyldig forespørgsel',
  ukendtZone: 'ukendt zone',

  // register.ts: a connection by name
  ukendtForbindelse: 'Ukendt forbindelse',
  kunneIkkeLaeses: (navn: string): string => `${navn} kunne ikke læses`,
  forkertSlags: (navn: string, slags: string): string => `${navn} svarede med noget andet end ${slags}`,
  ugyldigeValg: (navn: string): string => `${navn} svarede med ugyldige valg`,
  kunneIkkeSaettesOp: (navn: string): string => `${navn} kunne ikke sættes op`,
  ikkeForbundet: (navn: string): string => `${navn} er ikke forbundet`,
  virkerIkkeNu: (navn: string): string => `${navn} virker ikke lige nu`,
  afvisteForbindelsen: (navn: string): string => `${navn} afviste forbindelsen`,
  kunneIkkeAendres: (navn: string): string => `${navn} kunne ikke ændres`,
  kanIkke: (navn: string, handling: string): string => `${navn} kan ikke ${handling}`,
  forbindelsenIkkeBekraeftet: 'Forbindelsen kunne ikke bekræftes. Prøv at forbinde igen.',
  ingenKode: 'Udbyderen sendte ingen kode tilbage.',

  // register.ts: the lines of the connections' log
  logForbandt: (hvem: string, navn: string, slags: string, opsat: string): string => `${hvem} forbandt ${navn} (${slags}).${opsat ? ` ${opsat}` : ''}`,
  logAendrede: (hvem: string, navn: string, hvad: string): string => `${hvem} ændrede ${navn}: ${hvad}`,
  logFrakoblede: (hvem: string, navn: string, slags: string): string => `${hvem} frakoblede ${navn} (${slags}); adgangen er fjernet.`,

  // hemmeligheder.ts: the one secret module (no message carries a value)
  hemmelighed: {
    kunneIkkeSkrive: (fil: string, kode: string): string => `kunne ikke skrive ${fil}: ${kode}`,
    kunneIkkeLaese: (fil: string, kode: string): string => `kunne ikke læse ${fil}: ${kode}`,
    vaerdiUbrugelig: (noegle: string): string => `værdien til ${noegle} er tom, for lang eller har tegn, der ikke kan stå i filen`,
    noegleForbudt: (noegle: string): string => `${noegle} er ikke en nøgle, Clawco må sætte`,
    noegleForbudtAgent: (noegle: string): string => `${noegle} er ikke en nøgle, Clawco må give agenten`,
    ugyldigtKildeId: 'ugyldigt kilde-id',
    ugyldigtFelt: (felt: string): string => `ugyldigt felt i hemmeligheden: ${felt}`,
    kunneIkkeLaeses: (kilde: string): string => `hemmeligheden til ${kilde} kunne ikke læses`,
    ikkeGyldig: (kilde: string): string => `hemmeligheden til ${kilde} er ikke gyldig`,
    kunneIkkeFjernes: (kilde: string): string => `hemmeligheden til ${kilde} kunne ikke fjernes`,
  },
};

export type KilderTekster = typeof da;

const en: KilderTekster = {
  slags: { kalender: 'calendar', mail: 'mail', noter: 'notes', nyheder: 'news', beskeder: 'messages' },

  feltetSkalVaereObjekt: 'fields must be an object',
  ukendtFelt: (navn) => `unknown field: ${navn}`,
  feltMangler: (etiket) => `${etiket} is missing`,
  feltUgyldigt: (etiket) => `${etiket} is not valid`,
  feltIkkeEtAfValgene: (etiket) => `${etiket} is not one of the choices`,
  ugyldigForespoergsel: 'invalid request',
  ukendtZone: 'unknown zone',

  ukendtForbindelse: 'Unknown connection',
  kunneIkkeLaeses: (navn) => `${navn} could not be read`,
  forkertSlags: (navn, slags) => `${navn} answered with something other than ${slags}`,
  ugyldigeValg: (navn) => `${navn} answered with invalid options`,
  kunneIkkeSaettesOp: (navn) => `${navn} could not be set up`,
  ikkeForbundet: (navn) => `${navn} is not connected`,
  virkerIkkeNu: (navn) => `${navn} is not working right now`,
  afvisteForbindelsen: (navn) => `${navn} refused the connection`,
  kunneIkkeAendres: (navn) => `${navn} could not be changed`,
  kanIkke: (navn, handling) => `${navn} cannot ${handling}`,
  forbindelsenIkkeBekraeftet: 'The connection could not be confirmed. Try connecting again.',
  ingenKode: 'The provider sent no code back.',

  logForbandt: (hvem, navn, slags, opsat) => `${hvem} connected ${navn} (${slags}).${opsat ? ` ${opsat}` : ''}`,
  logAendrede: (hvem, navn, hvad) => `${hvem} changed ${navn}: ${hvad}`,
  logFrakoblede: (hvem, navn, slags) => `${hvem} disconnected ${navn} (${slags}); the access is removed.`,

  hemmelighed: {
    kunneIkkeSkrive: (fil, kode) => `could not write ${fil}: ${kode}`,
    kunneIkkeLaese: (fil, kode) => `could not read ${fil}: ${kode}`,
    vaerdiUbrugelig: (noegle) => `the value for ${noegle} is empty, too long or has characters that cannot be in the file`,
    noegleForbudt: (noegle) => `${noegle} is not a key Clawco may set`,
    noegleForbudtAgent: (noegle) => `${noegle} is not a key Clawco may give the agent`,
    ugyldigtKildeId: 'invalid source id',
    ugyldigtFelt: (felt) => `invalid field in the secret: ${felt}`,
    kunneIkkeLaeses: (kilde) => `the secret for ${kilde} could not be read`,
    ikkeGyldig: (kilde) => `the secret for ${kilde} is not valid`,
    kunneIkkeFjernes: (kilde) => `the secret for ${kilde} could not be removed`,
  },
};

export const KILDER_TEKSTER = { da, en };

/** The framework's words in the language of the request. */
export const kilderTekst = (): KilderTekster => efterSprog(KILDER_TEKSTER);
/** A slags in the words of the language of the request (Danish: its id). */
export const slagsNavn = (slags: string): string => kilderTekst().slags[slags] ?? slags;
