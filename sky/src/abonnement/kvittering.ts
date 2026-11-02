// The purchase receipt (KC-0209) and the mails of the consumer-rights flow. When a webhook has been handled for an
// account, efterKoeb asks Stripe whether the account's open orders completed, ties each to its subscription (the day
// the agreement began) and sends one receipt: seller (read from the terms), product, price without VAT, period, how to
// cancel, how to withdraw, and the accepted terms version with a link. A mail failure never fails the webhook and never
// loses the receipt: the claim is released and the next event tries again. Mails never carry a card number.
import type { Database } from '../db/pool.ts';
import type { Besked, Post } from '../delt/post.ts';
import type { Priser } from './priser.ts';
import type { BetalingsKlient } from './stripe-klient.ts';
import { skjulNoegler } from './stripe-klient.ts';
import { F } from './forbrugerret-tekster.ts';
import { beloeb, dato, fristSidsteDag, periodeOrd, prisLinjeAf, type Sprog } from './forbrugerret.ts';
import { frigivKvittering, knytBestilling, paataagKvittering, udenKvittering, type Bestilling } from './bestilling.ts';

export type Kontakt = { email: string; sprog: Sprog };

/** What every flow of the consumer-rights bundle needs; wired in server.ts, faked in tests. */
export type KoebDeps = {
  db: Database;
  /** null when billing is not set up: nothing to ask Stripe. */
  klient: BetalingsKlient | null;
  priser: Priser;
  post: Post;
  publicUrl: string;
  nu: () => Date;
  /** The seller's identity in the language, read from the terms (delt/saelger.ts); never a literal. */
  saelger: (sprog: Sprog) => string;
  /** The current terms: the version a purchase records and where that text is read. */
  vilkaar: { version: string; url: (sprog: Sprog) => string };
  /** The account's address and language; null for an account that no longer has one. Wired from konto, never imported. */
  kontakt: (kontoId: number) => Promise<Kontakt | null>;
};

export const produktNavn = (d: Pick<KoebDeps, 'priser'>, plan: string): string => d.priser.planer[plan]?.navn ?? plan;
export const kontoLink = (d: Pick<KoebDeps, 'publicUrl'>): string => new URL('/konto', d.publicUrl).href;
const fejlTekst = (err: unknown): string => skjulNoegler((err as { kode?: string; message?: string }).kode ?? (err as Error).message);

/** Sends one mail; true when the provider took it. Failures are logged without address or data. */
export async function sendMail(d: Pick<KoebDeps, 'post'>, b: Besked, kontoId: number): Promise<boolean> {
  try {
    await d.post.send(b);
    return true;
  } catch (err) {
    console.error(`sky abonnement: ${b.skabelon}-mail til konto ${kontoId} kunne ikke sendes: ${fejlTekst(err)}`);
    return false;
  }
}

/** The one line that says what the person pays and for how long, from the price the order kept. */
export const prisTekst = (b: Pick<Bestilling, 'prisOere' | 'interval' | 'valuta'>, sprog: Sprog, moms: boolean): string => F[sprog].pris(prisLinjeAf(b.prisOere, b.interval, sprog, b.valuta), moms);

function kvitteringBesked(d: KoebDeps, b: Bestilling, k: Kontakt, s: { proeveSlut: Date | null; periodeSlut: Date | null }): Besked {
  const t = F[k.sprog];
  const betaling = b.proeve
    ? t.kvitteringProeve(dato(s.proeveSlut ?? s.periodeSlut ?? d.nu(), k.sprog))
    : t.kvitteringBetalt(beloeb(b.prisOere, k.sprog, b.valuta), s.periodeSlut ? dato(s.periodeSlut, k.sprog) : periodeOrd(b.interval, k.sprog));
  return {
    til: k.email, skabelon: 'kvittering', sprog: k.sprog,
    data: {
      saelger: d.saelger(k.sprog), produkt: produktNavn(d, b.plan), pris: prisTekst(b, k.sprog, d.priser.moms.aktiv), betaling,
      fortrydfrist: dato(fristSidsteDag(b.startet ?? d.nu()), k.sprog), vilkaarversion: b.vilkaarVersion, vilkaarlink: d.vilkaar.url(k.sprog), link: kontoLink(d),
    },
  };
}

/** After a webhook for the account: tie finished orders to their subscriptions and send the receipts not yet sent. */
export async function efterKoeb(d: KoebDeps, kontoId: number): Promise<void> {
  if (!d.klient) return;
  const nu = d.nu();
  for (const b of await udenKvittering(d.db, kontoId, nu)) {
    try {
      const s = await d.klient.hentCheckout(b.checkoutSession);
      // Only this account's own, finished Checkout: a session id is never trusted on its own.
      if (!s || s.status !== 'complete' || !s.abonnement || s.kontoId !== kontoId) continue;
      if (!b.stripeAbonnement) await knytBestilling(d.db, b.id, s.abonnement.id, s.abonnement.oprettet);
      const ny = { ...b, stripeAbonnement: s.abonnement.id, startet: b.startet ?? s.abonnement.oprettet };
      const k = await d.kontakt(kontoId);
      if (!k) continue; // no address left to write to; nothing is claimed, so nothing is lost
      if (!(await paataagKvittering(d.db, b.id, nu))) continue;
      const sendt = await sendMail(d, kvitteringBesked(d, ny, k, { proeveSlut: s.abonnement.proeveSlut, periodeSlut: s.abonnement.periodeSlut }), kontoId);
      if (!sendt) await frigivKvittering(d.db, b.id);
    } catch (err) {
      console.error(`sky abonnement: kvittering for konto ${kontoId} fejlede (prøves igen ved næste hændelse): ${fejlTekst(err)}`);
    }
  }
}
