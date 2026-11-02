// The welcome mails' job (KC-0200). Which mail an account is owed is velkomst.ts (pure); this reads the inputs fresh on
// every pass — the entitlement, the Clawco's klar time, the tips choice (so a "no thanks" counts at send time) — and
// sends each owed mail once, remembered in udsendte_mails (KC-0196's table and its claim: the claim is written before
// the send, given back if the send fails, and a claim whose send never finished is taken again after a while). It runs
// on a clock in server.ts; the welcome therefore goes out within one interval of the Clawco becoming klar. The fleet,
// the account's address, the tips choice and support's mailbox come in as seams wired in server.ts (billing imports
// neither konto/ nor fleet/). Nothing here changes the entitlement, stops or deletes anything.
import type { Besked } from '../delt/post.ts';
import { erSendt, frigivMail, markerSendt, paatagMail, type MailNoegle } from '../delt/udsendte.ts';
import { dato, type Sprog } from './forbrugerret.ts';
import { kontoLink, sendMail, type Kontakt, type KoebDeps } from './kvittering.ts';
import { abonnementLink } from './frist-job.ts';
import type { Rettighed } from './rettigheder.ts';
import { skjulNoegler } from './stripe-klient.ts';
import { hentRettigheder } from './synk.ts';
import { hvilkeMailsSkalUd, KOM_I_GANG_TIL_MS, VELKOMST_MAILS, type VelkomstMail } from './velkomst.ts';

export type VelkomstDeps = Pick<KoebDeps, 'db' | 'priser' | 'post' | 'publicUrl' | 'nu' | 'kontakt' | 'saelger'> & {
  /** The account's own Clawco once it is klar: since when, and where it opens. Null while it is not. From the fleet. */
  clawco: (kontoId: number) => Promise<{ klarVed: Date; link: string } | null>;
  /** Owners whose Clawco became klar since `siden` (the welcome's and the tips mail's windows). From the fleet. */
  nyligtKlare: (siden: Date) => Promise<number[]>;
  /** Whether the account wants the tips mail, and a fresh one-click unsubscribe link for it. From konto (mailvalg.ts). */
  tips: (kontoId: number) => Promise<boolean>;
  afmeldLink: (kontoId: number, sprog: Sprog) => Promise<string>;
  /** Support's mailbox (the reply-to of every welcome mail) and the response-time sentence (config/hjaelp.json). */
  hjaelp: { postkasse: string; svartid: (sprog: Sprog) => string };
};

/** One welcome mail per account, ever: the key of its udsendte_mails row. */
const ENESTE = 'eneste';
const noegle = (kontoId: number, slags: VelkomstMail): MailNoegle => ({ kontoId, slags, noegle: ENESTE });

/** The welcome's line about the subscription: the trial's end (and that no card is needed, when the config says so). */
const ABONNEMENT: Record<Sprog, { proeve: (dato: string, kort: boolean) => string; andet: string }> = {
  da: {
    proeve: (d, kort) => `Din gratis prøve slutter ${d}.${kort ? '' : ' Du skal ikke give et kort.'} Vælger du ikke en plan inden da, sættes dit abonnement på pause, og intet bliver slettet.`,
    andet: 'Du kan altid se dit abonnement på din kontoside.',
  },
  en: {
    proeve: (d, kort) => `Your free trial ends on ${d}.${kort ? '' : ' You do not need to give a card.'} If you do not choose a plan by then, your subscription is paused, and nothing is deleted.`,
    andet: 'You can always see your subscription on your account page.',
  },
};

function abonnementLinje(d: Pick<VelkomstDeps, 'priser'>, r: Rettighed, sprog: Sprog): string {
  const t = ABONNEMENT[sprog];
  if (r.kilde === 'stripe' && r.status === 'proeve' && r.proeveSlutter) return t.proeve(dato(new Date(r.proeveSlutter), sprog), d.priser.proeve.kort);
  return t.andet;
}

async function besked(d: VelkomstDeps, mail: VelkomstMail, kontoId: number, k: Kontakt, r: Rettighed, clawco: { link: string } | null): Promise<Besked> {
  const faelles = { til: k.email, sprog: k.sprog, svarTil: d.hjaelp.postkasse };
  const saelger = d.saelger(k.sprog);
  if (mail === 'velkomst') {
    return { ...faelles, skabelon: 'velkomst', data: { link: clawco!.link, abonnement: abonnementLinje(d, r, k.sprog), hjaelp: d.hjaelp.postkasse, svartid: d.hjaelp.svartid(k.sprog), konto: kontoLink(d), saelger } };
  }
  if (mail === 'kom-i-gang') {
    const afmeld = await d.afmeldLink(kontoId, k.sprog);
    return { ...faelles, skabelon: 'kom-i-gang', afmeld, data: { link: new URL('/rum/start', clawco!.link).href, afmeld, hjaelp: d.hjaelp.postkasse, saelger } };
  }
  return { ...faelles, skabelon: 'proeve-slutter', data: { dato: dato(new Date(r.proeveSlutter!), k.sprog), link: abonnementLink(d), saelger } };
}

/** Accounts that may be owed a welcome mail: Stripe trials (the trial-ending mail needs no klar Clawco) and owners
 *  whose Clawco became klar within the tips mail's window. Never a deleted account. */
export async function kontiTilVelkomst(d: Pick<VelkomstDeps, 'db' | 'nu' | 'nyligtKlare'>): Promise<number[]> {
  const proever = await d.db.query<{ konto_id: unknown }>(
    "SELECT r.konto_id FROM abonnement.rettigheder r JOIN konto k ON k.id = r.konto_id WHERE r.kilde = 'stripe' AND r.status = 'proeve' AND k.slettet_ved IS NULL",
  );
  const klare = await d.nyligtKlare(new Date(d.nu().getTime() - KOM_I_GANG_TIL_MS));
  const levende = klare.length
    ? new Set((await d.db.query<{ id: unknown }>('SELECT id FROM konto WHERE id = ANY($1::bigint[]) AND slettet_ved IS NULL', [klare])).map((x) => Number(x.id)))
    : new Set<number>();
  const alle = new Set([...proever.map((x) => Number(x.konto_id)), ...klare.filter((id) => levende.has(id))]);
  return [...alle].sort((a, b) => a - b);
}

/** Sends the mails the account is owed now, each once. A refused send is given back and tried on the next pass. */
export async function velkomstForKonto(d: VelkomstDeps, kontoId: number): Promise<{ sendt: number; fejl: number }> {
  const nu = d.nu();
  let sendt = 0;
  let fejl = 0;
  const k = await d.kontakt(kontoId);
  if (!k) return { sendt, fejl }; // no address left (a deleted account): nothing is claimed, nothing is owed
  const r = await hentRettigheder(d.db, kontoId, d.priser, nu);
  const clawco = await d.clawco(kontoId);
  const udsendte = new Set<VelkomstMail>();
  for (const m of VELKOMST_MAILS) if (await erSendt(d.db, noegle(kontoId, m))) udsendte.add(m);
  const tips = await d.tips(kontoId);
  for (const mail of hvilkeMailsSkalUd(nu, { klarVed: clawco?.klarVed ?? null, slettet: false, tips }, r, udsendte)) {
    const m = noegle(kontoId, mail);
    if (!(await paatagMail(d.db, m, nu))) continue;
    if (!(await sendMail(d, await besked(d, mail, kontoId, k, r, clawco), kontoId))) {
      await frigivMail(d.db, m);
      fejl++;
      continue;
    }
    await markerSendt(d.db, m, nu);
    sendt++;
    console.log(`sky abonnement: ${mail}-mail sendt til konto ${kontoId}`);
  }
  return { sendt, fejl };
}

/** One pass over every candidate. One account's failure never stops the others. */
export async function velkomstGennemloeb(d: VelkomstDeps): Promise<{ sendt: number; fejl: number }> {
  let sendt = 0;
  let fejl = 0;
  for (const id of await kontiTilVelkomst(d)) {
    try {
      const u = await velkomstForKonto(d, id);
      sendt += u.sendt;
      fejl += u.fejl;
    } catch (err) {
      fejl++;
      console.error(`sky abonnement: velkomst for konto ${id} fejlede (prøves igen ved næste gennemløb): ${skjulNoegler((err as Error).message)}`);
    }
  }
  return { sendt, fejl };
}

/** A pass now, then every `interval` ms; passes never overlap. */
export function velkomstLoekke(d: VelkomstDeps, o: { interval: number }): { stop(): void; gennemloeb(): Promise<void> } {
  let igang: Promise<void> | null = null;
  const koer = async (): Promise<void> => {
    try {
      const u = await velkomstGennemloeb(d);
      if (u.sendt || u.fejl) console.log(`sky abonnement: velkomst-gennemløb: ${u.sendt} mails sendt, ${u.fejl} fejl`);
    } catch (err) {
      console.error(`sky abonnement: velkomst-gennemløbet fejlede: ${skjulNoegler((err as Error).message)}`);
    }
  };
  const gennemloeb = (): Promise<void> => {
    igang ??= koer().finally(() => { igang = null; });
    return igang;
  };
  void gennemloeb();
  const t = setInterval(() => { void gennemloeb(); }, o.interval);
  t.unref();
  return { stop: () => { clearInterval(t); }, gennemloeb };
}
