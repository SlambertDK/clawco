// The Checkout Session parameters (KC-0191): a pure function of account, plan, interval, country and
// language. Typed by the pinned SDK, so a misspelt Stripe field fails the typecheck.
// Invariants: no card in the trial and an unpaid trial pauses (nothing is cancelled or deleted by
// billing, KC-0196); the price is the one Stripe holds under the config's lookup key (never a
// hardcoded id); konto_id and plan ride along in metadata so the webhook (KC-0192) never guesses.
import type Stripe from 'stripe';
import type { Priser } from './priser.ts';
import type { Tilstand } from './stripe-klient.ts';
import type { IntervalNavn } from './opsaet.ts';
import { erLand } from './lande.ts';
import { VILKAAR } from './tekster.ts';
import { CLAWCO_MAERKE } from './stripe-klient.ts';

/** KC-0174 owns the public terms URLs; the withdrawal sentence (KC-0209) comes from forbrugerret.ts, one per language.
 *  Live payment is refused while any of the three is missing. */
export type Juridisk = { vilkaarUrl: string | null; privatlivUrl: string | null; fortrydelsesTekst: Record<'da' | 'en', string> | null };

export type CheckoutInput = {
  kontoId: number;
  /** The account's Stripe customer id. */
  kunde: string;
  plan: string;
  interval: IntervalNavn;
  /** ISO 3166 code from the account, never from IP geolocation. */
  land: string;
  sprog: 'da' | 'en';
  /** KC-0194 decides currency and tax; until then the caller passes 'dkk' and null. */
  valuta: 'dkk' | 'eur';
  skat: null;
  /** The active price under lookupKey(plan, interval). */
  prisId: string;
  /** False when the account has had a trial before (no trial farming). */
  proeve: boolean;
  publicUrl: string;
  juridisk: Juridisk;
  tilstand: Tilstand;
  /** Where Stripe sends the person back (KC-0198): the subscription page (default) or the sign-up flow. */
  retur?: 'konto' | 'tilmelding';
};

export function byggCheckout(a: CheckoutInput, priser: Priser): Stripe.Checkout.SessionCreateParams {
  if (!Object.hasOwn(priser.planer, a.plan)) throw new Error(`ukendt plan: ${a.plan}`);
  if (a.interval !== 'maaned' && a.interval !== 'aar') throw new Error(`ukendt interval: ${String(a.interval)}`);
  if (!erLand(a.land)) throw new Error(`ukendt land: ${a.land}`);
  const { vilkaarUrl, privatlivUrl, fortrydelsesTekst } = a.juridisk;
  const juraKlar = vilkaarUrl !== null && privatlivUrl !== null && fortrydelsesTekst !== null;
  if (a.tilstand === 'live' && !juraKlar) throw new Error('live-betaling afvist: vilkår, privatlivspolitik og fortrydelsestekst mangler (KC-0174)');

  const besked = vilkaarUrl !== null && privatlivUrl !== null
    ? [VILKAAR[a.sprog](vilkaarUrl, privatlivUrl), fortrydelsesTekst?.[a.sprog]].filter(Boolean).join(' ')
    : VILKAAR.udkast[a.sprog];
  const metadata = { [CLAWCO_MAERKE.noegle]: CLAWCO_MAERKE.vaerdi, konto_id: String(a.kontoId), plan: a.plan, interval: a.interval, land: a.land };
  // The sign-up flow keeps the country on the account, so its way back carries only the plan choice.
  const tilmelding = a.retur === 'tilmelding';
  const afbrudt = new URL(tilmelding ? '/tilmeld' : '/konto/abonnement', a.publicUrl);
  for (const [k, v] of Object.entries(tilmelding ? { plan: a.plan, interval: a.interval, afbrudt: '1' } : { plan: a.plan, interval: a.interval, land: a.land, afbrudt: '1' })) afbrudt.searchParams.set(k, v);

  const proeve = a.proeve && priser.proeve.dage > 0;
  return {
    mode: 'subscription',
    customer: a.kunde,
    client_reference_id: String(a.kontoId),
    line_items: [{ price: a.prisId, quantity: 1 }],
    locale: a.sprog,
    currency: a.valuta,
    // A card only when the config asks for one in the trial, or when there is no trial.
    payment_method_collection: proeve && !priser.proeve.kort ? 'if_required' : 'always',
    subscription_data: proeve
      ? { trial_period_days: priser.proeve.dage, trial_settings: { end_behavior: { missing_payment_method: 'pause' } }, metadata }
      : { metadata },
    metadata,
    consent_collection: { terms_of_service: 'required' },
    custom_text: { terms_of_service_acceptance: { message: besked } },
    success_url: `${new URL(tilmelding ? '/tilmeld' : '/api/abonnement/tilbage', a.publicUrl).href}?session={CHECKOUT_SESSION_ID}`,
    cancel_url: afbrudt.href,
  };
}
