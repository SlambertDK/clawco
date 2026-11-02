// KC-0170 slice 3: what a person reads from the identity layer: the "no access" refusals of identitet.ts (the page and the
// JSON error a stranger gets), and what the owner reads when "Lad support se med" is switched on or off and refuses: the
// refusals of stoette.ts, the reason a signed proof (bevis) was not good, and the words about a damaged stoette.json (the
// slaa-fra route answers them as a 403 the owner sees). Danish is what the code said before, byte for byte; English has exactly
// its keys, read at call time. The language comes from src/store/sprog.ts (identitet/ never imports shell/).
//
// Stays Danish on purpose, because a person never reads it in the browser: konto.ts (the startup configuration errors for
// the operator, thrown before any page exists, and the `grund` of a refused Clawco-Konto header, which is logged and
// never answered).

import { sprogNu } from '../store/sprog.ts';

const da = {
  // The refusals of identitet.ts (the `hvorfor` of an AfvistAdgang; shell/adgang.ts draws it).
  tailnetKun: 'Clawco kan kun åbnes fra dit eget Tailscale-net, ikke fra internettet.',
  ukendtPerson: 'Clawco ved ikke, hvem du er. Åbn siden over Tailscale fra din egen enhed.',
  ikkeInviteret: 'Du er ikke inviteret endnu. Bed ejeren af husstanden om en invitation.',
  husstandUlaeselig: 'Husstanden kunne ikke læses, så Clawco ved ikke, hvem du er. Ejeren skal rette husstand.json.',
  kontoUkendt: 'Clawco ved ikke, hvem du er.',
  kunEjerenTil: 'Kun ejeren kan slå support til.',
  kunViaSky: 'Support kan kun slås til gennem Clawco Sky.',
  ikkeSlaaetTil: (grund: string): string => `Support blev ikke slået til: ${grund}.`,
  kunEjerenFra: 'Kun ejeren kan slå support fra.',
  // The reason a bevis was refused (the `grund` of verificerBevis, quoted in ikkeSlaaetTil).
  bevisForkertForm: 'beviset har forkert form',
  ukendtNoegle: 'ukendt nøgle-id',
  signaturHolderIkke: 'signaturen holder ikke',
  bevisIkkeJson: 'beviset er ikke JSON',
  andenTenant: 'en anden tenant',
  bevisForGammelt: 'beviset er for gammelt',
  ugyldigVarighed: 'ugyldig varighed',
  alleredeUdloebet: 'allerede udløbet',
  ugyldigGrund: 'ugyldig grund',
  // The record on disk, when it cannot be trusted.
  filIkkeObjekt: 'stoette.json er ikke et objekt',
  filUkendtFelt: 'stoette.json har et ukendt felt',
  filUgyldigtId: 'stoette.json: ugyldigt id',
  filUgyldigTid: 'stoette.json: ugyldig tid',
  filUgyldigVarighed: 'stoette.json: ugyldig varighed',
  filUgyldigGrund: 'stoette.json: ugyldig grund',
  filUgyldigeSessioner: 'stoette.json: ugyldige sessioner',
  filKunneIkkeLaeses: (aarsag: string): string => `stoette.json kunne ikke læses: ${aarsag}`,
  filIkkeJson: 'stoette.json er ikke gyldig JSON',
};
const en: typeof da = {
  tailnetKun: 'Clawco can only be opened from your own Tailscale network, not from the internet.',
  ukendtPerson: 'Clawco does not know who you are. Open the page over Tailscale from your own device.',
  ikkeInviteret: 'You have not been invited yet. Ask the owner of the household for an invitation.',
  husstandUlaeselig: 'The household could not be read, so Clawco does not know who you are. The owner needs to fix husstand.json.',
  kontoUkendt: 'Clawco does not know who you are.',
  kunEjerenTil: 'Only the owner can switch support on.',
  kunViaSky: 'Support can only be switched on through Clawco Sky.',
  ikkeSlaaetTil: (grund: string): string => `Support was not switched on: ${grund}.`,
  kunEjerenFra: 'Only the owner can switch support off.',
  bevisForkertForm: 'the proof has the wrong form',
  ukendtNoegle: 'unknown key id',
  signaturHolderIkke: 'the signature does not hold',
  bevisIkkeJson: 'the proof is not JSON',
  andenTenant: 'another tenant',
  bevisForGammelt: 'the proof is too old',
  ugyldigVarighed: 'invalid duration',
  alleredeUdloebet: 'already expired',
  ugyldigGrund: 'invalid reason',
  filIkkeObjekt: 'stoette.json is not an object',
  filUkendtFelt: 'stoette.json has an unknown field',
  filUgyldigtId: 'stoette.json: invalid id',
  filUgyldigTid: 'stoette.json: invalid time',
  filUgyldigVarighed: 'stoette.json: invalid duration',
  filUgyldigGrund: 'stoette.json: invalid reason',
  filUgyldigeSessioner: 'stoette.json: invalid sessions',
  filKunneIkkeLaeses: (aarsag: string): string => `stoette.json could not be read: ${aarsag}`,
  filIkkeJson: 'stoette.json is not valid JSON',
};
export const IDENTITET_TEKSTER = { da, en };
export const identitetTekst = (): typeof da => IDENTITET_TEKSTER[sprogNu()];
