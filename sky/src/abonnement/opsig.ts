// "Opsig" (KC-0209): cancel the running subscription at the end of the paid period, from the account page, with one
// confirmation and no contact with anyone. Access stays until the period ends (Stripe's cancel_at_period_end); the
// entitlement turns "opsiges" when Stripe's webhook says so, like any other change. Nothing is refunded and nothing
// is deleted. A paused subscription has no paid period to keep, so it is ended at once. The confirmation is on screen
// (the route) and by mail (here); a mail that fails does not undo the cancellation.
import type { AbonnementSnapshot } from './stripe-klient.ts';
import { hentKundeRaekke } from './kunde.ts';
import { planFraAbonnement, vaelgAbonnement } from './rettigheder.ts';
import { dato, type Sprog } from './forbrugerret.ts';
import { kontoLink, produktNavn, sendMail, type KoebDeps } from './kvittering.ts';

const LEVENDE = new Set(['trialing', 'active', 'past_due', 'unpaid', 'paused']);

/** The account's running subscription (the live one that decides), or null: none, or billing is not set up. */
export async function levendeAbonnement(d: Pick<KoebDeps, 'db' | 'klient'>, kontoId: number): Promise<AbonnementSnapshot | null> {
  if (!d.klient) return null;
  const k = await hentKundeRaekke(d.db, kontoId);
  if (!k) return null;
  return vaelgAbonnement((await d.klient.listAbonnementer(k.stripeKunde)).filter((a) => LEVENDE.has(a.status)));
}

const slutter = (a: AbonnementSnapshot, nu: Date): Date => a.opsigesVed ?? (a.opsigVedPeriodeslut ? a.periodeSlut : null) ?? a.periodeSlut ?? nu;
const alleredeOpsagt = (a: AbonnementSnapshot): boolean => a.opsigVedPeriodeslut || a.opsigesVed !== null;

export type OpsigOversigt = { art: 'klar'; slutter: Date } | { art: 'allerede'; slutter: Date } | { art: 'intet' };

/** What the confirmation screen says before anything happens. */
export async function opsigOversigt(d: KoebDeps, kontoId: number): Promise<OpsigOversigt> {
  const a = await levendeAbonnement(d, kontoId);
  if (!a) return { art: 'intet' };
  return { art: alleredeOpsagt(a) ? 'allerede' : 'klar', slutter: slutter(a, d.nu()) };
}

export type OpsigUdfald = { udfald: 'opsagt'; slutter: Date; mail: boolean } | { udfald: 'allerede'; slutter: Date } | { udfald: 'intet' };

/** Cancels at period end. A Stripe failure throws with nothing changed (the route says so and the person can press again). */
export async function opsig(d: KoebDeps, a: { kontoId: number; email: string; sprog: Sprog }): Promise<OpsigUdfald> {
  const klient = d.klient;
  const ab = await levendeAbonnement(d, a.kontoId);
  if (!klient || !ab) return { udfald: 'intet' };
  const nu = d.nu();
  if (alleredeOpsagt(ab)) return { udfald: 'allerede', slutter: slutter(ab, nu) };
  const straks = ab.status === 'paused';
  if (straks) await klient.opsigAbonnement(ab.id); else await klient.opsigVedPeriodeslut(ab.id);
  const slut = straks ? nu : slutter({ ...ab, opsigVedPeriodeslut: true }, nu);
  console.log(`sky abonnement: konto ${a.kontoId} opsagde abonnement ${ab.id}${straks ? ' (på pause: afsluttet nu)' : ' (slutter ved periodens udgang)'}`);
  const plan = planFraAbonnement(ab, d.priser);
  const mail = await sendMail(d, {
    til: a.email, skabelon: 'opsigelse', sprog: a.sprog,
    data: { saelger: d.saelger(a.sprog), produkt: plan ? produktNavn(d, plan) : 'Clawco Sky', slutter: dato(slut, a.sprog), link: kontoLink(d) },
  }, a.kontoId);
  return { udfald: 'opsagt', slutter: slut, mail };
}
