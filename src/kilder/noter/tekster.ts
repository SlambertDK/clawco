// KC-0170: the words of the notes connector and of the people and profile writers beside it, Danish and English (the shape
// of src/kilder/tekster.ts). The names of the vault's own folders and files (00-Indbakke, 40-Mennesker/People, Clawco,
// Clawco/Om mig.md) are a contract with the user's folder and with the code that compares the profile template, so they
// stay as they are in both tables; so does the template text written into that file (PROFIL_SKABELON in vault.ts).
// "Obsidian" is a product name.

import { efterSprog } from '../tekst-hjaelp.ts';

const da = {
  navn: 'Noter',
  kiraNavn: 'Noter i din vault',
  kiraTekst: 'Obsidian-vaulten, Clawco allerede gemmer i: indbakken og kartoteket over mennesker.',
  /** "a", "a og b", "a, b og c". */
  og: 'og',
  handling: { vaelgMappe: 'Vælg mappe', vaelgIgen: 'Vælg mappen igen', skiftMappe: 'Skift mappe', forbind: 'Forbind' },
  felt: {
    opsaetning: 'Hvor skal dine noter ligge?',
    ny: 'Lav en ny mappe til mig',
    eksisterende: 'Jeg har allerede en Obsidian-vault',
    mappe: 'Mappe',
  },

  // the card by state
  ikkeValgtTekst: 'Et sted til det, du vil huske: gemte tekster, et kartotek med én fil pr. menneske, du kender, og en note om dig. Alt er almindelige tekstfiler, du selv kan åbne og rette. '
    + 'En ny mappe lægger Clawco i Clawco/Vault i din hjemmemappe. Vælger du din Obsidian-vault, tilføjer Clawco kun mapperne 00-Indbakke, 40-Mennesker/People og Clawco, hvis de mangler, og rører ikke dine noter.',
  fundet: (n: number): string => ` Clawco fandt ${n} Obsidian-${n === 1 ? 'vault' : 'vaults'} på maskinen.`,
  manglerTekst: (mappe: string): string => `Mappen kan ikke findes: ${mappe}. Er drevet koblet fra, så sæt det i igen. Ellers vælg mappen igen.`,
  nyTekst: (mappe: string): string => `Dine noter ligger i din nye mappe ${mappe}. Det er almindelige tekstfiler, du selv kan åbne og rette.`,
  eksisterendeTekst: (mappe: string): string => `Clawco bruger din Obsidian-vault ${mappe}: gemte tekster i 00-Indbakke, kartoteket i 40-Mennesker/People og Clawcos egne filer i Clawco.`,

  // health and refusals
  mappenFindesIkke: 'Mappen kan ikke findes.',
  kanIkkeSkrive: 'Clawco kan ikke skrive i mappen.',
  vaelgVault: 'Vælg din vault, eller skriv stien til den.',
  skrivHeleStien: 'Skriv hele stien til mappen.',
  brugerMappe: (rod: string): string => `Bruger ${rod}; der manglede ingen mapper.`,
  lavede: (rod: string, lagt: string): string => `Lavede ${rod} med ${lagt}.`,
  tilfoejede: (lagt: string, rod: string): string => `Tilføjede ${lagt} i ${rod}.`,
  filHvorMappen: 'Der ligger en fil, hvor mappen skal være.',
  mappenIkkeTom: 'Mappen er ikke tom. Vælg en tom mappe, eller vælg den som din eksisterende vault.',

  // sti.ts
  ugyldigSti: 'Ugyldig sti.',
  stiIMappen: 'Stien skal ligge i mappen.',
  stiUd: 'Stien peger ud af mappen.',
  ugyldigtFilnavn: 'Navnet kan ikke bruges som filnavn.',

  // profil.ts
  ugyldigProfiltekst: 'Ugyldig profiltekst.',
  kunProfilen: 'Kun profilen kan fjernes her.',

  // personer.ts
  /** The names of a person's fields in a refusal (Danish: the field's own id). */
  personFelt: { relation: 'relation', org: 'org', foedselsdag: 'foedselsdag', kilde: 'kilde', importeret: 'importeret' } as Record<string, string>,
  ukendtZone: 'Ukendt zone.',
  ugyldigt: (felt: string): string => `Ugyldig ${felt}.`,
  relationenMangler: 'Relationen mangler.',
  ugyldigTekst: 'Ugyldig tekst.',
  listeUnderSig: (noegle: string): string => `${noegle} har en liste under sig, og Clawco retter den ikke blindt. Ret filen selv.`,
  personenFindesIkke: 'Personen findes ikke længere i din mappe.',
  ikkeRenTekst: 'Filen er ikke ren tekst, så Clawco kan ikke sætte den tilbage præcis. Ret den selv.',
  forStorTilFortryd: 'Filen er for stor til, at en ændring kan fortrydes sikkert. Ret den selv.',
  filenAendret: 'Filen blev ændret, mens Clawco arbejdede. Intet er skrevet; prøv igen.',
  kunOpdateret: 'Kun en opdateret persons fil kan sættes tilbage.',
  kunPersonFil: 'Kun en persons fil kan fjernes.',
};

export type NoterTekster = typeof da;

const en: NoterTekster = {
  navn: 'Notes',
  kiraNavn: 'Notes in your vault',
  kiraTekst: 'The Obsidian vault Clawco already saves in: the inbox and the register of people.',
  og: 'and',
  handling: { vaelgMappe: 'Choose folder', vaelgIgen: 'Choose the folder again', skiftMappe: 'Change folder', forbind: 'Connect' },
  felt: {
    opsaetning: 'Where should your notes be?',
    ny: 'Make a new folder for me',
    eksisterende: 'I already have an Obsidian vault',
    mappe: 'Folder',
  },

  ikkeValgtTekst: 'A place for what you want to remember: saved texts, a register with one file per person you know, and a note about you. Everything is ordinary text files you can open and edit yourself. '
    + 'A new folder is put by Clawco in Clawco/Vault in your home folder. If you choose your Obsidian vault, Clawco only adds the folders 00-Indbakke, 40-Mennesker/People and Clawco if they are missing, and does not touch your notes.',
  fundet: (n) => ` Clawco found ${n} Obsidian ${n === 1 ? 'vault' : 'vaults'} on the machine.`,
  manglerTekst: (mappe) => `The folder cannot be found: ${mappe}. If the drive is disconnected, plug it in again. Otherwise choose the folder again.`,
  nyTekst: (mappe) => `Your notes are in your new folder ${mappe}. They are ordinary text files you can open and edit yourself.`,
  eksisterendeTekst: (mappe) => `Clawco uses your Obsidian vault ${mappe}: saved texts in 00-Indbakke, the register in 40-Mennesker/People and Clawco's own files in Clawco.`,

  mappenFindesIkke: 'The folder cannot be found.',
  kanIkkeSkrive: 'Clawco cannot write in the folder.',
  vaelgVault: 'Choose your vault, or type the path to it.',
  skrivHeleStien: 'Type the whole path to the folder.',
  brugerMappe: (rod) => `Using ${rod}; no folders were missing.`,
  lavede: (rod, lagt) => `Made ${rod} with ${lagt}.`,
  tilfoejede: (lagt, rod) => `Added ${lagt} in ${rod}.`,
  filHvorMappen: 'There is a file where the folder should be.',
  mappenIkkeTom: 'The folder is not empty. Choose an empty folder, or choose it as your existing vault.',

  ugyldigSti: 'Invalid path.',
  stiIMappen: 'The path must be inside the folder.',
  stiUd: 'The path points out of the folder.',
  ugyldigtFilnavn: 'The name cannot be used as a file name.',

  ugyldigProfiltekst: 'Invalid profile text.',
  kunProfilen: 'Only the profile can be removed here.',

  personFelt: { relation: 'relation', org: 'organisation', foedselsdag: 'birthday', kilde: 'source', importeret: 'imported' },
  ukendtZone: 'Unknown zone.',
  ugyldigt: (felt) => `Invalid ${felt}.`,
  relationenMangler: 'The relation is missing.',
  ugyldigTekst: 'Invalid text.',
  listeUnderSig: (noegle) => `${noegle} has a list under it, and Clawco does not correct it blindly. Edit the file yourself.`,
  personenFindesIkke: 'The person is no longer in your folder.',
  ikkeRenTekst: 'The file is not plain text, so Clawco cannot put it back exactly. Edit it yourself.',
  forStorTilFortryd: 'The file is too large for a change to be undone safely. Edit it yourself.',
  filenAendret: 'The file was changed while Clawco was working. Nothing was written; try again.',
  kunOpdateret: 'Only the file of an updated person can be put back.',
  kunPersonFil: 'Only a person\'s file can be removed.',
};

export const NOTER_TEKSTER = { da, en };
export const noterTekst = (): NoterTekster => efterSprog(NOTER_TEKSTER);
