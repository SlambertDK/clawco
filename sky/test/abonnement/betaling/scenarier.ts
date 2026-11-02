// KC-0193: the one scenario table (AGENTS §0 r8). Both layers run exactly this list: the fake client in
// `npm test` (scenarier.test.ts) and Stripe's test mode with test clocks (`npm run betaling:tjek`). Each step
// is an action, how its events are delivered, and what the entitlement row and the outbox must say after it.
// Plans are the config's plan ids; the member limit is read from config/priser.json, never written here.
// Card data never appears: only Stripe's published test payment method ids, sent through the API.
import type { RettighedsStatus } from '../../../src/abonnement/rettigheder.ts';
import type { FristMail } from '../../../src/abonnement/frist.ts';

/** Stripe's published test payment methods (no card number ever typed). KC-0196: pm_card_chargeCustomerFail attaches
 *  to the customer and then declines every charge. */
export type TestBetalingsmiddel = 'pm_card_visa' | 'pm_card_chargeCustomerFail';

export type Handling =
  /** A trial through KC-0191's Checkout parameters (no card in the trial, config proeve.kort = false). */
  | { goer: 'start'; plan: string }
  | { goer: 'kort'; betalingsmiddel: TestBetalingsmiddel }
  /** Time passes; the runner adds a margin past the boundary (Stripe acts at the second, not before). */
  | { goer: 'frem'; dage: number }
  /** Plan change with proration (Stripe's default), the way the Portal does it. */
  | { goer: 'skift'; plan: string }
  /** "Opsig" (KC-0209): cancel at period end through opsig.ts. */
  | { goer: 'opsig' }
  /** The plan's monthly price changes in config (KC-0190), applied with the setup's own planlaeg/anvend. */
  | { goer: 'ny-pris'; plan: string; tillaegOere: number }
  /** Every event delivered so far in this scenario, again, newest first. */
  | { goer: 'gentag' }
  /** KC-0196: the open invoices are charged again now with the current card (what the Portal does once it is fixed). */
  | { goer: 'betal' };

/** normal: in order, once. hold: kept back and delivered with the next step's events (late delivery).
 *  omvendt-to-gange: held and new events together, newest first, each twice. */
export type Levering = 'normal' | 'hold' | 'omvendt-to-gange';

export type Forventning = {
  status: RettighedsStatus;
  /** A config plan id, or "ingen". */
  plan: string;
  skrivebeskyttet: boolean;
  /** True when the row carries a cancellation date. */
  opsiges: boolean;
  /** New rows in the outbox (abonnement.rettigheds_haendelser) during this step. */
  udbakke: number;
  /** With this many members (the owner counted), is the account over its limit? Nobody is ever removed. */
  medlemmer?: { antal: number; over: boolean };
  /** The subscription still bills the price it started on. */
  sammePris?: true;
  /** Every handled event in this step was answered "dublet" (a type Sky does not handle is answered "ignoreret"). */
  kunDubletter?: true;
  /** KC-0196: the grace mails sent during this step (the runner runs the grace job after the step's events, as
   *  Sky's clock does). Absent = none. */
  mails?: FristMail[];
  /** KC-0194: the customer's newest paid invoice is in this currency, at the plan's monthly amount in it from
   *  config/priser.json, and carries VAT exactly when moms.aktiv is true (no tax line while VAT is off, G6). */
  faktura?: { valuta: 'dkk' | 'eur' };
};

export type Skridt = Handling & { levering?: Levering; forvent: Forventning };
/** `land`: the account's billing country (KC-0198), which decides the currency (KC-0194); DK when absent. */
export type Scenarie = { id: string; navn: string; land?: string; skridt: Skridt[] };

const proeve = (plan = 'sky-solo'): Forventning => ({ status: 'proeve', plan, skrivebeskyttet: false, opsiges: false, udbakke: 0 });
const aktiv = (plan = 'sky-solo'): Forventning => ({ status: 'aktiv', plan, skrivebeskyttet: false, opsiges: false, udbakke: 0 });
const forfalden = (skrivebeskyttet = false): Forventning => ({ status: 'forfalden', plan: 'sky-solo', skrivebeskyttet, opsiges: false, udbakke: 0 });

/** Start a Solo trial, attach the test card, let the trial end: the paid, active starting point of S4–S7. The first
 *  invoice is paid in the currency of the scenario's country (KC-0194). */
const betaltSolo = (valuta: 'dkk' | 'eur' = 'dkk'): Skridt[] => [
  { goer: 'start', plan: 'sky-solo', forvent: { ...proeve(), udbakke: 1 } },
  { goer: 'kort', betalingsmiddel: 'pm_card_visa', forvent: proeve() },
  { goer: 'frem', dage: 14, forvent: { ...aktiv(), udbakke: 1, faktura: { valuta } } },
];

export const SCENARIER: readonly Scenarie[] = [
  {
    id: 'S1',
    navn: 'prøve uden kort → dag 14 → pause (skrivebeskyttet)',
    // KC-0196 owns the grace stages; today the read-only flag is the one rettigheder.ts sets for "pause".
    skridt: [
      { goer: 'start', plan: 'sky-solo', forvent: { ...proeve(), udbakke: 1 } },
      { goer: 'frem', dage: 14, forvent: { status: 'pause', plan: 'sky-solo', skrivebeskyttet: true, opsiges: false, udbakke: 1, mails: ['proeve-slut'] } },
    ],
  },
  {
    id: 'S2',
    navn: 'prøve → testkort via API → første faktura betalt → aktiv',
    skridt: betaltSolo(),
  },
  {
    id: 'S3',
    navn: 'kortet afvises → forfalden → påmindelse dag 7 → skrivebeskyttet dag 14 → nyt kort, fakturaen betales → aktiv',
    // The day numbers are config/priser.json's (paamindelseVedFejl 7, fristVedFejl 14). Read-only is the flag KC-0192
    // computes; it carries no mail of its own, and nothing is deleted at any step.
    skridt: [
      { goer: 'start', plan: 'sky-solo', forvent: { ...proeve(), udbakke: 1 } },
      { goer: 'kort', betalingsmiddel: 'pm_card_chargeCustomerFail', forvent: proeve() },
      { goer: 'frem', dage: 14, forvent: { ...forfalden(), udbakke: 1, mails: ['betaling-fejlet'] } },
      { goer: 'frem', dage: 7, forvent: { ...forfalden(), mails: ['betaling-paamindelse'] } },
      { goer: 'frem', dage: 7, forvent: forfalden(true) },
      // A new card alone pays nothing; the open invoice is paid when it is charged again.
      { goer: 'kort', betalingsmiddel: 'pm_card_visa', forvent: forfalden(true) },
      { goer: 'betal', forvent: { ...aktiv(), udbakke: 1 } },
    ],
  },
  {
    id: 'S4',
    navn: 'opsig ved periodens slut → aktiv til slutningen → opsagt',
    skridt: [
      ...betaltSolo(),
      { goer: 'opsig', forvent: { ...aktiv(), opsiges: true, udbakke: 1 } },
      { goer: 'frem', dage: 15, forvent: { ...aktiv(), opsiges: true } },
      { goer: 'frem', dage: 20, forvent: { status: 'opsagt', plan: 'ingen', skrivebeskyttet: true, opsiges: false, udbakke: 1 } },
    ],
  },
  {
    id: 'S5',
    navn: 'Solo → Husstand med prorering; Husstand → Solo med 4 medlemmer → over grænsen, ingen fjernes',
    skridt: [
      ...betaltSolo(),
      { goer: 'skift', plan: 'sky-husstand', forvent: { ...aktiv('sky-husstand'), udbakke: 1, medlemmer: { antal: 4, over: false } } },
      { goer: 'skift', plan: 'sky-solo', forvent: { ...aktiv(), udbakke: 1, medlemmer: { antal: 4, over: true } } },
    ],
  },
  {
    id: 'S6',
    navn: 'samme hændelse to gange og i forkert rækkefølge',
    skridt: [
      { goer: 'start', plan: 'sky-solo', forvent: { ...proeve(), udbakke: 1 } },
      { goer: 'kort', betalingsmiddel: 'pm_card_visa', forvent: proeve() },
      // The trial ends, but its events arrive late: the entitlement moves only on an event, never by itself.
      { goer: 'frem', dage: 14, levering: 'hold', forvent: proeve() },
      // The late events and the cancellation's, newest first, each twice: one outbox row, the final state.
      { goer: 'opsig', levering: 'omvendt-to-gange', forvent: { ...aktiv(), opsiges: true, udbakke: 1 } },
      { goer: 'gentag', forvent: { ...aktiv(), opsiges: true, kunDubletter: true } },
    ],
  },
  {
    id: 'S7',
    navn: 'prisen ændres i config → eksisterende abonnent beholder den gamle pris',
    skridt: [
      ...betaltSolo(),
      { goer: 'ny-pris', plan: 'sky-solo', tillaegOere: 1000, forvent: { ...aktiv(), sammePris: true } },
      // The renewal is billed on the old (now archived) price, and the entitlement still follows Stripe.
      { goer: 'frem', dage: 31, forvent: { ...aktiv(), udbakke: 1, sammePris: true } },
      { goer: 'opsig', forvent: { ...aktiv(), opsiges: true, udbakke: 1, sammePris: true } },
    ],
  },
  {
    id: 'S8',
    navn: 'kunde i Tyskland → betaler i euro til prisfilens europris; ingen momslinje, mens moms er slået fra (G6)',
    // KC-0194: the currency follows the account's country (EUR outside Denmark). Henrik is not VAT-registered, so
    // Stripe Tax is off and the invoice carries no tax line; with moms.aktiv true the same step expects one.
    land: 'DE',
    skridt: betaltSolo('eur'),
  },
];

/** The ticket's scenarios that are not in the table yet, and the ticket that adds each one (to the table, in
 *  both layers at once). A scenario is in exactly one of the two places; scenarier.test.ts checks it. */
export const UDESTAAENDE: Readonly<Record<string, string>> = {};

/** The ticket's full list (KC-0193): S1–S8. */
export const ALLE_IDER = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'] as const;

/** One Danish line for a step's action (output and failure messages). */
export function beskrivHandling(h: Handling): string {
  switch (h.goer) {
    case 'start': return `start prøve på ${h.plan}`;
    case 'kort': return `vedhæft ${h.betalingsmiddel}`;
    case 'frem': return `${h.dage} dage frem`;
    case 'skift': return `skift til ${h.plan}`;
    case 'opsig': return 'opsig ved periodens slut';
    case 'ny-pris': return `ny pris på ${h.plan} (+${h.tillaegOere / 100} kr)`;
    case 'gentag': return 'alle hændelser igen';
    case 'betal': return 'åbne fakturaer betales med det nye kort';
  }
}
