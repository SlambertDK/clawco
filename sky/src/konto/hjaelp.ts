// "Få hjælp" (KC-0201): the mail the account app offers, with the technical facts a helper needs and nothing else.
// Pure: fields in, text and a mailto: link out. The link works without JavaScript and the person reads and edits the
// text before sending. Two rules make it safe to extend (AGENTS §0 r2):
//   1. The allowlist is a type. HjaelpFelter names every field that may ever reach the mail, and LINJER must say how
//      each one is written (a mapped type over the same keys), so a new field is a type error until it is handled here.
//      The builder reads only those keys, so a caller cannot smuggle anything else in, whatever it passes.
//   2. Every value is scrubbed to a plain alphabet and cut short, so no line break, address or markup in a value can
//      add a line, a header or a recipient.
// Never room content, chat, source names, mail subjects or the account's email (the mail carries the sender itself).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const HJAELPEFIL = fileURLToPath(new URL('../../../config/hjaelp.json', import.meta.url));

export type Hjaelpeindstillinger = { postkasse: string; svarHverdage: number; sikkerhedSvarHverdage: number };

const ADRESSE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** Validates the parsed config/hjaelp.json. Throws naming the key (fail closed: Sky does not start on a bad file). */
export function tolkHjaelp(raa: unknown): Hjaelpeindstillinger {
  const o = (typeof raa === 'object' && raa !== null ? raa : {}) as Record<string, unknown>;
  const fejl = (n: string, hvad: string) => new Error(`config/hjaelp.json: ${n} ${hvad}`);
  const postkasse = o['postkasse'];
  if (typeof postkasse !== 'string' || !ADRESSE.test(postkasse)) throw fejl('postkasse', 'skal være én mailadresse');
  for (const n of ['svarHverdage', 'sikkerhedSvarHverdage'] as const) {
    const v = o[n];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 30) throw fejl(n, 'skal være et helt tal fra 1 til 30 (hverdage)');
  }
  return { postkasse, svarHverdage: o['svarHverdage'] as number, sikkerhedSvarHverdage: o['sikkerhedSvarHverdage'] as number };
}

export function laesHjaelp(sti: string = HJAELPEFIL): Hjaelpeindstillinger {
  return tolkHjaelp(JSON.parse(fs.readFileSync(sti, 'utf8')));
}

/** The mailbox and the response times, read once. */
export const HJAELP: Hjaelpeindstillinger = laesHjaelp();

/** The response-time sentence: the one wording the help page, the account app and the plan description share
 *  (the site's table holds the same sentence; test/site-hjaelp.test.ts compares them). */
export function svartid(sprog: 'da' | 'en', hverdage: number = HJAELP.svarHverdage): string {
  if (sprog === 'da') return `Vi svarer inden for ${hverdage} hverdage.`;
  return `We answer within ${hverdage} working ${hverdage === 1 ? 'day' : 'days'}.`;
}

/** The only facts that may go into the mail. Add a field here and TypeScript asks for its line in LINJER. */
export type HjaelpFelter = {
  /** The account's number (not its email). */
  kontoId: number;
  /** A plan id from config/priser.json, or "ingen". */
  plan: string;
  /** The entitlement's state (proeve, aktiv, forfalden, pause, opsagt, ingen). */
  status: string;
  skrivebeskyttet: boolean;
  /** The control plane's version. */
  version: string;
  /** The control plane's commit. */
  sha: string;
  /** The commit the account's own Clawco runs, "ingen" before there is one. */
  release: string;
  /** Where the account's Clawco runs (the fleet driver today). */
  placering: string;
  /** The last error code the app showed, when there is one and it looks like a code. */
  sidsteFejl?: string;
};

type Linje<K extends keyof HjaelpFelter> = { navn: string; vaerdi: (v: NonNullable<HjaelpFelter[K]>) => string };

const tekst = (v: string) => v;
const LINJER: { [K in keyof HjaelpFelter]-?: Linje<K> } = {
  kontoId: { navn: 'Konto', vaerdi: (v) => String(Math.trunc(v)) },
  plan: { navn: 'Plan', vaerdi: tekst },
  status: { navn: 'Status', vaerdi: tekst },
  skrivebeskyttet: { navn: 'Skrivebeskyttet', vaerdi: (v) => (v ? 'ja' : 'nej') },
  version: { navn: 'Version', vaerdi: tekst },
  sha: { navn: 'Kode', vaerdi: tekst },
  release: { navn: 'Din Clawco kører kode', vaerdi: tekst },
  placering: { navn: 'Placering', vaerdi: tekst },
  sidsteFejl: { navn: 'Sidste fejlkode', vaerdi: tekst },
};

/** The allowlist as a list, in the order the lines appear (the test pins it, so adding a field is a conscious act). */
export const HJAELP_FELTER = Object.keys(LINJER) as (keyof HjaelpFelter)[];

const VAERDI_MAKS = 60;
const FEJLKODE = /^[A-Za-z0-9_.-]{1,40}$/;
/** Plain alphabet only; everything else (line breaks, "@", "<", "&", "=", spaces) is dropped, then the value is cut. */
const rens = (v: string): string => v.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, VAERDI_MAKS);

/** A mailto: URL stays under this many characters: Outlook and some web clients cut or refuse longer ones. */
export const MAKS_MAILTO = 1800;

const EMNE = 'Hjælp til Clawco';
const INTRO = ['Skriv her, hvad der er galt:', '', ''];
const OVERSKRIFT = '-- Tekniske oplysninger (du kan læse og rette dem) --';
const BUND = [
  '------',
  'Her står aldrig indholdet af din Clawco, din chat, dine kilder eller dine mails.',
  'Send os aldrig din modelnøgle, en adgangskode eller et kort.',
];

export type HjaelpMail = { til: string; emne: string; tekst: string; mailto: string };

function byg(f: HjaelpFelter, medFejlkode: boolean): HjaelpMail {
  const linjer: string[] = [];
  for (const k of HJAELP_FELTER) {
    if (k === 'sidsteFejl' && (!medFejlkode || typeof f.sidsteFejl !== 'string' || !FEJLKODE.test(f.sidsteFejl))) continue;
    const l = LINJER[k] as Linje<typeof k>;
    const v = f[k];
    if (v === undefined || v === null) continue;
    linjer.push(`${l.navn}: ${rens(l.vaerdi(v as never))}`);
  }
  const brod = [...INTRO, OVERSKRIFT, ...linjer, ...BUND].join('\r\n');
  const til = HJAELP.postkasse;
  return { til, emne: EMNE, tekst: brod, mailto: `mailto:${til}?subject=${encodeURIComponent(EMNE)}&body=${encodeURIComponent(brod)}` };
}

/** The draft for the one mailbox. Over `maks` characters the optional last-error line goes first. */
export function hjaelpMail(f: HjaelpFelter, opt: { maks?: number } = {}): HjaelpMail {
  const maks = opt.maks ?? MAKS_MAILTO;
  const fuld = byg(f, true);
  return fuld.mailto.length < maks ? fuld : byg(f, false);
}
