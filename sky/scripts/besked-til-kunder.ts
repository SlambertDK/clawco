// A free-text notice to affected customers through Sky's own mailer (KC-0230, docs/beredskab/README.md, art. 34 and the
// 48 hours of the data processing agreement). This is the OWNER'S tool: it runs only when a human has said yes to this
// text and these recipients (AGENTS.md §9: no agent sends mail to other people on its own). Claude may run it over ssh,
// but only after Henrik's explicit yes in chat, and only after the dry run below has been read.
//   node --env-file=/srv/sky/.env sky/scripts/besked-til-kunder.ts <fil.md> --slug hus-… [hus-… …]   the owners of those tenants
//   node --env-file=/srv/sky/.env sky/scripts/besked-til-kunder.ts <fil.md> --alle                    every account with a live entitlement
//   … add --send to send: the text is shown, and nothing leaves until "SEND" is typed on stdin. Without --send: a dry run.
// <fil.md> is the filled template docs/beredskab/skabeloner/kunder.da.md or kunder.en.md (see laesBeskedFil: no field left
// in square brackets, no markup, at most 4000 characters). The script prints the number of recipients, the text once and the
// file's sha256, never an address. One mail per recipient with the sender and the reply-to of Sky's other mails; a mail is
// recorded per (account, file) in udsendte_mails, so a rerun after a failure reaches only those who did not get it.
// Exit 0 done (or dry run), 1 refused or some mails failed, 2 usage.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import type { Database } from '../src/db/pool.ts';
import { PostFejl, type Post, type PostFejlKode, type Sprog } from '../src/delt/post.ts';
import { frigivMail, markerSendt, paatagMail } from '../src/delt/udsendte.ts';
import { MAKS_TEKST } from '../src/delt/skabeloner/index.ts';
import { HJAELP } from '../src/konto/hjaelp.ts';

const BRUG = 'brug: besked-til-kunder.ts <fil.md> (--slug hus-… [hus-… …] | --alle) [--send]';
const MAKS_EMNE = 150;
const SLAGS = 'driftsbesked';
/** The accounts that are being served: a trial, an active or an overdue subscription (not paused, cancelled or none). */
const LEVENDE = ['proeve', 'aktiv', 'forfalden'];
/** Failures that will repeat for every recipient: stop at once instead of trying them all. */
const SYSTEMFEJL = new Set<PostFejlKode>(['ingen-udbyder', 'noegle', 'domaene', 'region', 'sporing']);

/** A refusal in plain Danish: the operator reads the message as written. */
export class BeskedFejl extends Error {}

export type Beskedtekst = { emne: string; tekst: string; sprog: Sprog };

const EMNELINJE = /^(?:\*\*(Emne|Subject):\*\*|(Emne|Subject):)[ \t]*(.*)$/;
const PLADSHOLDER = /\[[^[\]\n]+\]/;
const STYRETEGN = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\u202A-\u202E\u2066-\u2069]/;

/** The filled template as a mail: the subject from the `**Emne:**` (or `**Subject:**`) line, the text from what follows it
 *  (the title and the note above the subject are for the writer and are not sent). Pure; refuses anything unfinished. */
export function laesBeskedFil(raa: string): Beskedtekst {
  const linjer = raa.replace(/\r\n?/g, '\n').split('\n');
  const i = linjer.findIndex((l) => EMNELINJE.test(l.trim()));
  if (i < 0) throw new BeskedFejl('filen har ingen emnelinje: skriv "**Emne:** …" (eller "**Subject:** …") som i skabelonen');
  const m = EMNELINJE.exec(linjer[i]!.trim())!;
  const emne = m[3]!.trim();
  // A "## Heading" is a plain line in the mail (the mail has no headings).
  const tekst = linjer.slice(i + 1).map((l) => l.replace(/^##+\s+/, '').trimEnd()).join('\n').trim();
  if (!emne) throw new BeskedFejl('emnet er tomt');
  if (emne.length > MAKS_EMNE) throw new BeskedFejl(`emnet er for langt (${emne.length} tegn, højst ${MAKS_EMNE})`);
  if (!tekst) throw new BeskedFejl('beskeden har ingen tekst under emnelinjen');
  if (tekst.length > MAKS_TEKST) throw new BeskedFejl(`teksten er for lang (${tekst.length} tegn, højst ${MAKS_TEKST})`);
  for (const [hvor, t] of [['emnet', emne], ['teksten', tekst]] as const) {
    const felt = PLADSHOLDER.exec(t);
    if (felt) throw new BeskedFejl(`beskeden er ikke udfyldt: ${felt[0]} står stadig i ${hvor} (felter i firkantede parenteser skal erstattes, og et markdown-link kan ikke bruges)`);
    if (/[<>]|\{\{|\}\}/.test(t)) throw new BeskedFejl(`${hvor} indeholder markup (< > eller {{ }}): skriv almindelig tekst`);
  }
  if (STYRETEGN.test(emne) || STYRETEGN.test(tekst)) throw new BeskedFejl('beskeden indeholder usynlige styretegn: skriv den igen som almindelig tekst');
  return { emne, tekst, sprog: m[1] === 'Subject' ? 'en' : 'da' };
}

type Modtager = { kontoId: number; email: string };
export type Modtagere = { slugs: string[] } | { alle: true };

/** The recipients, deduplicated by account. Refuses the whole list on a slug that is unknown or has no owner to write to. */
async function findModtagere(db: Database, m: Modtagere): Promise<Modtager[]> {
  if ('alle' in m) {
    const r = await db.query<{ id: unknown; email: string }>(
      `SELECT k.id, k.email FROM konto k JOIN abonnement.rettigheder r ON r.konto_id = k.id
        WHERE k.slettet_ved IS NULL AND k.email IS NOT NULL AND r.status = ANY($1::text[]) ORDER BY k.id`, [LEVENDE]);
    if (!r.length) throw new BeskedFejl('ingen modtagere: ingen konto har et abonnement i gang');
    return r.map((x) => ({ kontoId: Number(x.id), email: x.email }));
  }
  const slugs = [...new Set(m.slugs)];
  if (!slugs.length) throw new BeskedFejl('ingen modtagere: angiv mindst ét kunde-id med --slug, eller brug --alle');
  const ud = new Map<number, Modtager>();
  for (const slug of slugs) {
    if (!/^hus-[a-z2-7]{8}$/.test(slug)) throw new BeskedFejl(`${slug} er ikke et kunde-id (hus- og otte tegn)`);
    const [r] = await db.query<{ id: unknown; email: string | null }>(
      'SELECT k.id, k.email FROM flaade.tenant t JOIN konto k ON k.id = t.ejer_konto_id WHERE t.slug = $1', [slug]);
    if (!r) throw new BeskedFejl(`kunde-id'et findes ikke: ${slug}`);
    if (!r.email) throw new BeskedFejl(`ejeren af ${slug} har slettet sin konto: der er ingen at skrive til`);
    ud.set(Number(r.id), { kontoId: Number(r.id), email: r.email });
  }
  return [...ud.values()];
}

export type Resultat = {
  /** Everyone the text was meant for. */
  modtagere: number;
  sendt: number;
  /** Not delivered: refused by the provider, or not tried because a failure that repeats stopped the run. */
  fejlede: number;
  /** Already had this very file (a rerun): left alone. */
  sprunget: number;
};

export type Valg = {
  /** The path of the filled template. */
  fil: string;
  modtagere: Modtagere;
  send: boolean;
  nu: Date;
  /** Asked after the text is shown and before anything is sent; false refuses. The command line asks for "SEND" on stdin. */
  bekraeft?: () => Promise<boolean>;
  /** Where the lines go (default stdout). */
  ud?: (linje: string) => void;
};

export async function beskedTilKunder(db: Database, post: Post, o: Valg): Promise<Resultat> {
  const ud = o.ud ?? ((l: string) => console.log(l));
  let raa: Buffer;
  try { raa = fs.readFileSync(o.fil); } catch { throw new BeskedFejl(`filen kan ikke læses: ${o.fil}`); }
  const b = laesBeskedFil(raa.toString('utf8'));
  const sha = createHash('sha256').update(raa).digest('hex');
  const modtagere = await findModtagere(db, o.modtagere);

  ud(`Modtagere: ${modtagere.length} ${modtagere.length === 1 ? 'modtager' : 'modtagere'}`);
  ud(`Emne: ${b.emne}`);
  ud('--- teksten ---');
  ud(b.tekst);
  ud('--- slut ---');
  ud(`Filens sha256: ${sha}`);
  if (!o.send) {
    ud('Prøvekørsel: der er ikke sendt noget. Tilføj --send for at sende (kræver Henriks ja til netop denne tekst og disse modtagere).');
    return { modtagere: modtagere.length, sendt: 0, fejlede: 0, sprunget: 0 };
  }
  if (o.bekraeft && !(await o.bekraeft())) throw new BeskedFejl('afbrudt: der er ikke sendt noget');

  const noegle = `sha-${sha.slice(0, 32)}`;
  const r: Resultat = { modtagere: modtagere.length, sendt: 0, fejlede: 0, sprunget: 0 };
  const koder = new Map<PostFejlKode, number>();
  let standset: PostFejlKode | null = null;
  for (const m of modtagere) {
    const nogle = { kontoId: m.kontoId, slags: SLAGS, noegle };
    if (!(await paatagMail(db, nogle, o.nu))) { r.sprunget++; continue; }
    try {
      await post.send({ til: m.email, skabelon: 'driftsbesked', sprog: b.sprog, svarTil: HJAELP.postkasse, data: { titel: b.emne, tekst: b.tekst } });
      await markerSendt(db, nogle, o.nu);
      r.sendt++;
    } catch (err) {
      await frigivMail(db, nogle);
      const kode: PostFejlKode = err instanceof PostFejl ? err.kode : 'udbyder';
      koder.set(kode, (koder.get(kode) ?? 0) + 1);
      if (SYSTEMFEJL.has(kode)) { standset = kode; break; }
    }
  }
  r.fejlede = r.modtagere - r.sendt - r.sprunget;
  if (standset) ud(`Standset efter en fejl, der gentager sig for alle (${standset}): ret den, og kør kommandoen igen. De, der allerede har fået beskeden, springes over.`);
  else if (r.fejlede) ud('Nogle mails blev afvist: kør kommandoen igen. De, der allerede har fået beskeden, springes over.');
  if (koder.size) ud(`Fejlkoder: ${[...koder].map(([k, n]) => `${k} ${n}`).join(', ')}`);
  // One summary line in the format of Sky's other log lines: counts, the time and the file's hash, never an address.
  ud(`sky besked: ${r.modtagere} modtagere, ${r.sendt} sendt, ${r.fejlede} fejlede, ${r.sprunget} sprunget, fil sha256 ${sha}, ${o.nu.toISOString()}`);
  return r;
}

type Args = { fil: string; modtagere: Modtagere; send: boolean };

function laesArgs(argv: string[]): Args | null {
  const fil = argv[0];
  if (!fil || fil.startsWith('--')) return null;
  const slugs: string[] = [];
  let alle = false;
  let send = false;
  let iSlug = false;
  for (const a of argv.slice(1)) {
    if (a === '--alle') { alle = true; iSlug = false; } else if (a === '--send') { send = true; iSlug = false; } else if (a === '--slug') iSlug = true;
    else if (!a.startsWith('--') && iSlug) slugs.push(a);
    else return null;
  }
  if (alle === (slugs.length > 0) || (iSlug && !slugs.length)) return null;
  return { fil, modtagere: alle ? { alle: true } : { slugs }, send };
}

/** The whole command: 0 done or dry run, 1 refused (nothing, or not everything, sent), 2 usage. */
export async function kommando(argv: string[], db: Database, post: Post, nu: Date, ud: (linje: string) => void, bekraeft: () => Promise<boolean>): Promise<number> {
  const a = laesArgs(argv);
  if (!a) { ud(BRUG); return 2; }
  try {
    const r = await beskedTilKunder(db, post, { fil: a.fil, modtagere: a.modtagere, send: a.send, nu, bekraeft, ud });
    return r.fejlede ? 1 : 0;
  } catch (err) {
    if (!(err instanceof BeskedFejl)) throw err;
    ud(`afvist: ${err.message}`);
    return 1;
  }
}

if (import.meta.main) {
  const { laesConfig } = await import('../src/config.ts');
  const { pgDatabase } = await import('../src/db/pool.ts');
  const { postFraEnv } = await import('../src/delt/post-udbyder.ts');
  const config = laesConfig(process.env);
  const db = pgDatabase(config.databaseUrl);
  try {
    if (config.dev) console.log('SKY_DEV=1: mailerne er falske, der sendes ikke rigtig post.');
    const bekraeft = async (): Promise<boolean> => {
      const { createInterface } = await import('node:readline/promises');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try { return (await rl.question('Skriv SEND for at sende beskeden til modtagerne ovenfor: ')).trim() === 'SEND'; } finally { rl.close(); }
    };
    process.exitCode = await kommando(process.argv.slice(2), db, postFraEnv(process.env, config), new Date(), (l) => console.log(l), bekraeft);
  } finally { await db.close(); }
}
