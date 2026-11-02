// The consumer-rights rules of the subscription (KC-0209) as pure functions: the two consents on the statement,
// the 14-day withdrawal period, the proportional amount (Forbrugeraftaleloven § 25) and who is due a renewal
// reminder. The price text is built from config/priser.json here and nowhere else, so the statement, the button,
// the receipt and the withdrawal screen can never disagree (AGENTS §0 r6). No database, no Stripe, no clock.
import type { Priser } from './priser.ts';
import type { IntervalNavn } from './opsaet.ts';
import { F } from './forbrugerret-tekster.ts';
import { formatBeloeb, type Valuta } from './valuta.ts';

export type Sprog = 'da' | 'en';

export const FRIST_DAGE = 14;
/** The renewal reminder goes out this many days before an annual plan renews (a product choice, KC-0209). */
export const PAAMINDELSE_DAGE = 14;
const DAG_MS = 86_400_000;

/** The names of the two checkboxes on the statement. */
export const FELT = { vilkaar: 'vilkaar', straks: 'straks' } as const;

/** Both consents, from a submitted form: the terms box carries the version of the terms it was shown with and
 *  must equal the current one (an old page is not consent to the current terms); the start box carries "ja". */
export function samtykkerGivet(form: Record<string, unknown>, aktuelVersion: string): boolean {
  return form[FELT.vilkaar] === aktuelVersion && form[FELT.straks] === 'ja';
}

/** An amount in minor units (øre or cent) as text in its own currency: "79 kr." / "€10.60" (valuta.ts). */
export function beloeb(oere: number, sprog: Sprog, valuta: Valuta): string {
  return formatBeloeb(oere, valuta, sprog);
}

/** The price of a plan in the customer's currency (øre or cent) from the one price file; null for a plan that is not in it. */
export function planPris(priser: Priser, plan: string, interval: IntervalNavn, valuta: Valuta): number | null {
  if (!Object.hasOwn(priser.planer, plan)) return null;
  const p = priser.planer[plan]!;
  return (interval === 'aar' ? p.aarlig : p.maanedlig)[valuta];
}

/** "79 kr. om måneden" / "€10.60 per month". */
export function prisLinje(priser: Priser, plan: string, interval: IntervalNavn, sprog: Sprog, valuta: Valuta): string {
  const oere = planPris(priser, plan, interval, valuta);
  if (oere === null) throw new Error(`ukendt plan: ${plan}`);
  return prisLinjeAf(oere, interval, sprog, valuta);
}

/** The same line for an amount already stored (an order keeps the price it showed, with its currency). */
export function prisLinjeAf(oere: number, interval: IntervalNavn, sprog: Sprog, valuta: Valuta): string {
  const periode = sprog === 'da' ? (interval === 'aar' ? 'om året' : 'om måneden') : (interval === 'aar' ? 'per year' : 'per month');
  return `${beloeb(oere, sprog, valuta)} ${periode}`;
}

/** "måned" / "year": the period as one word for a sentence. */
export const periodeOrd = (interval: IntervalNavn, sprog: Sprog): string =>
  sprog === 'da' ? (interval === 'aar' ? 'år' : 'måned') : (interval === 'aar' ? 'year' : 'month');

/** "hver måned" / "hvert år" / "every month": the renewal rhythm in a sentence. */
export const hverPeriode = (interval: IntervalNavn, sprog: Sprog): string =>
  sprog === 'da' ? (interval === 'aar' ? 'hvert år' : 'hver måned') : (interval === 'aar' ? 'every year' : 'every month');

/** "den første måned" / "the first year": what the first payment covers. */
export const foerstePeriode = (interval: IntervalNavn, sprog: Sprog): string =>
  sprog === 'da' ? (interval === 'aar' ? 'det første år' : 'den første måned') : (interval === 'aar' ? 'the first year' : 'the first month');

/** A date as a person reads it, in Copenhagen time. */
export function dato(d: Date, sprog: Sprog): string {
  return d.toLocaleDateString(sprog === 'da' ? 'da-DK' : 'en-GB', { timeZone: 'Europe/Copenhagen', dateStyle: 'long' });
}

export function tidspunkt(d: Date, sprog: Sprog): string {
  return d.toLocaleString(sprog === 'da' ? 'da-DK' : 'en-GB', { timeZone: 'Europe/Copenhagen', dateStyle: 'long', timeStyle: 'short' });
}

/** Midnight at the start of a Copenhagen calendar day, as an instant (the offset is read for that day, so summer and winter time are right). */
function koebenhavnMidnat(aar: number, maaned: number, dag: number): Date {
  const forskydning = (t: number): number => {
    const dele = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(new Date(t)).map((p) => [p.type, Number(p.value)]));
    return Date.UTC(dele['year']!, dele['month']! - 1, dele['day']!, dele['hour']!, dele['minute']!, dele['second']!) - t;
  };
  const lokal = Date.UTC(aar, maaned, dag);
  let t = lokal - forskydning(lokal);
  t = lokal - forskydning(t);
  return new Date(t);
}

/** The withdrawal period ends at midnight (Copenhagen) after the 14th day from the one the agreement began: a started
 *  day counts as a whole one, so a person is never refused on a technicality of the hour (a clock change can move it by an hour). */
export function fristSlut(startet: Date): Date {
  const dele = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(startet).map((p) => [p.type, Number(p.value)]));
  return koebenhavnMidnat(dele['year']!, dele['month']! - 1, dele['day']! + FRIST_DAGE + 1);
}

/** The last day a withdrawal can be made, as a date a person reads ("til og med …"). */
export const fristSidsteDag = (startet: Date): Date => new Date(fristSlut(startet).getTime() - 1);

/** A withdrawal is open while the period runs. A clock a little behind the start is not a refusal. */
export function fortrydTilladt(startet: Date, nu: Date): boolean {
  return nu.getTime() < fristSlut(startet).getTime();
}

/** One period on from `start`, UTC, clamping to the last day of a shorter month (31 January + 1 month = 28 February). */
export function plusPeriode(start: Date, interval: IntervalNavn): Date {
  const aar = start.getUTCFullYear() + (interval === 'aar' ? 1 : 0);
  const maaned = start.getUTCMonth() + (interval === 'aar' ? 0 : 1);
  const sidste = new Date(Date.UTC(aar, maaned + 1, 0)).getUTCDate();
  const ud = new Date(start);
  ud.setUTCDate(1);
  ud.setUTCFullYear(aar, maaned, Math.min(start.getUTCDate(), sidste));
  return ud;
}

/** § 25: after a withdrawal the person pays for what was delivered until then, in proportion to the whole
 *  period. A started day counts as a whole day, at least one; everything else goes back. Whole øre only. */
export function forholdsmaessig(a: { prisOere: number; interval: IntervalNavn; startet: Date; nu: Date }): { periodeDage: number; brugteDage: number; beholdOere: number; tilbageOere: number } {
  const slut = plusPeriode(a.startet, a.interval);
  const periodeDage = Math.round((slut.getTime() - a.startet.getTime()) / DAG_MS);
  const brugteDage = Math.min(periodeDage, Math.max(1, Math.ceil((a.nu.getTime() - a.startet.getTime()) / DAG_MS)));
  const beholdOere = Math.round((a.prisOere * brugteDage) / periodeDage);
  return { periodeDage, brugteDage, beholdOere, tilbageOere: a.prisOere - beholdOere };
}

/** The Stripe terms-checkbox sentence about the withdrawal (checkout.ts `fortrydelsesTekst`), in both languages. */
export const FORTRYDELSES_TEKST: Record<Sprog, string> = { da: F.da.stripeFortryd, en: F.en.stripeFortryd };

// --- Renewal reminder: who is due ----------------------------------------------------------------
export type FornyelseRaekke = {
  bestillingId: number;
  kontoId: number;
  abonnement: string;
  interval: IntervalNavn;
  /** The entitlement's status (rettigheder.ts). */
  status: string;
  periodeSlutter: Date | null;
  /** When it is cancelled to end, or null. */
  opsiges: Date | null;
  /** The period end a reminder was last sent for. */
  paamindetFor: Date | null;
};

/** Active annual plans that renew within `dage` days, are not cancelled and have not been reminded for this
 *  period. Monthly plans get no reminder, a trial or a paused plan renews nothing. Pure: the caller sends. */
export function paamindelseForfald(raekker: readonly FornyelseRaekke[], nu: Date, dage: number = PAAMINDELSE_DAGE): FornyelseRaekke[] {
  return raekker.filter((r) => {
    if (r.interval !== 'aar' || r.status !== 'aktiv' || r.opsiges !== null || r.periodeSlutter === null) return false;
    const slut = r.periodeSlutter.getTime();
    if (nu.getTime() >= slut || nu.getTime() < slut - dage * DAG_MS) return false;
    return r.paamindetFor === null || r.paamindetFor.getTime() !== slut;
  });
}
