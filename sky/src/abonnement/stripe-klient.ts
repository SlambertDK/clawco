// The payment seam (KC-0190): everything in abonnement/ talks to Stripe through BetalingsKlient
// only, the way the tenant talks to its agent through a client interface. Two implementations:
// stripe-sdk.ts (the official SDK) and falsk.ts (in memory, for tests). Test vs live mode is read
// from the key prefix, never from a flag a person can forget. The Stripe account is Henrik's
// personal one, shared with ShelfAtlas (G6), so live mode accepts restricted keys only (test mode
// also a standard sk_test_ key) and every Clawco object carries metadata.clawco = "ja".

import type Stripe from 'stripe';
import { FORTRYDELSES_TEKST } from './forbrugerret.ts';

export type Tilstand = 'test' | 'live';
export type Interval = 'month' | 'year';
export type Metadata = Record<string, string>;

/** The env name of the restricted key (sky's SKY_* convention, set with saet-hemmelighed.sh). */
export const NOEGLE_NAVN = 'SKY_STRIPE_SECRET_KEY';
/** The marker on every Clawco product and price in the shared account. */
export const CLAWCO_MAERKE = { noegle: 'clawco', vaerdi: 'ja' } as const;

/** `skatKode`: the product's Stripe tax code (KC-0194; set only once VAT is on), null when it has none. */
export type StripeProdukt = { id: string; navn: string; aktiv: boolean; metadata: Metadata; skatKode: string | null };
export type StripePris = {
  id: string;
  produkt: string;
  aktiv: boolean;
  lookupKey: string | null;
  /** unit_amount in øre. */
  dkk: number;
  /** currency_options.eur.unit_amount in cent; null when the price has no EUR option. */
  eur: number | null;
  interval: Interval;
  metadata: Metadata;
  /** KC-0194: tax_behavior "inclusive" on the price and its EUR option (only once moms.aktiv is true). */
  momsInkl: boolean;
};

export type NytProdukt = { id: string; navn: string; metadata: Metadata; skatKode: string | null };
export type ProduktAendring = { navn?: string; aktiv?: boolean; metadata?: Metadata; skatKode?: string };
export type NyPris = {
  produkt: string;
  /** The price's nickname in the dashboard. */
  navn: string;
  lookupKey: string;
  dkk: number;
  eur: number;
  interval: Interval;
  metadata: Metadata;
  /** Move the lookup key from the price that holds it (a changed amount). */
  transferLookupKey: boolean;
  /** KC-0194: VAT-inclusive (tax_behavior) in both currencies; false while moms.aktiv is false. */
  momsInkl: boolean;
};

/** A subscription as Stripe holds it right now (KC-0192 re-reads it on every webhook). `status` is
 *  Stripe's text as is, so an unknown future status reaches beregnRettigheder and fails closed. */
export type AbonnementSnapshot = {
  id: string;
  kunde: string;
  status: string;
  prisId: string | null;
  lookupKey: string | null;
  oprettet: Date;
  proeveStart: Date | null;
  proeveSlut: Date | null;
  periodeSlut: Date | null;
  opsigVedPeriodeslut: boolean;
  opsigesVed: Date | null;
  /** When the open invoice behind a failed payment was finalized; null when nothing is owed. */
  forfaldenSiden: Date | null;
  /** The price's metadata.clawco_plan (opsaet.ts sets it on every Clawco price). A config price change moves the
   *  lookup key to a new price; existing subscribers keep the old one, and this keeps their plan known (KC-0193 S7). */
  prisPlan: string | null;
  metadata: Metadata;
};

export type NyKunde = { kontoId: number; email: string; sprog: 'da' | 'en' };
/** `kontoId` from metadata.konto_id; null when absent (a deleted customer has no metadata). */
export type StripeKunde = { id: string; slettet: boolean; kontoId: number | null };

export type CheckoutSession = {
  id: string;
  url: string | null;
  status: 'open' | 'complete' | 'expired';
  kunde: string | null;
  /** From client_reference_id. */
  kontoId: number | null;
  abonnement: AbonnementSnapshot | null;
};

/** A verified webhook event, reduced to what the handler needs: the event says *which* customer
 *  changed, never what the new state is (that is re-read from Stripe). */
/** KC-0206: one invoice as "Hent alt" lists it (amount in minor units). */
export type Faktura = { id: string; nummer: string | null; oprettet: Date; beloeb: number; valuta: string; status: string | null; url: string | null;
  /** KC-0194: the invoice's VAT in minor units (the sum of its tax lines; 0 while VAT is off). */
  moms?: number };
/** KC-0194: a paid invoice anywhere in the account, for the revenue watch (amount paid in minor units). */
export type BetaltFaktura = { beloeb: number; valuta: string; betalt: Date };
/** KC-0194: Stripe Tax's own status (`aktiv` = it can calculate) and the fields it says are missing. */
export type SkatIndstillinger = { aktiv: boolean; mangler: string[] };

export type StripeHaendelse = { id: string; type: string; kunde: string | null };

/** KC-0195: a customer-portal configuration as the setup compares it (metadata.clawco_konfig fingerprints the content). */
export type PortalKonfiguration = { id: string; aktiv: boolean; metadata: Metadata };
export type NyPortalSession = { kunde: string; returUrl: string; konfiguration: string; sprog: 'da' | 'en' };

/** The env name of the webhook signing secret (whsec_…). */
export const WEBHOOK_NOEGLE_NAVN = 'SKY_STRIPE_WEBHOOK_SECRET';

/** "7" → 7; anything that is not a plain positive integer → null. */
export function kontoIdFra(v: unknown): number | null {
  return typeof v === 'string' && /^[1-9]\d{0,15}$/.test(v) ? Number(v) : null;
}

export interface BetalingsKlient {
  readonly tilstand: Tilstand;
  /** Every product marked metadata.clawco = "ja", active or archived. */
  listProdukter(): Promise<StripeProdukt[]>;
  /** Every price of one product, archived included (the setup's idempotency keys hash this history). */
  listPriser(produktId: string): Promise<StripePris[]>;
  opretProdukt(p: NytProdukt, idempotensNoegle: string): Promise<StripeProdukt>;
  opdaterProdukt(id: string, aendring: ProduktAendring): Promise<StripeProdukt>;
  opretPris(p: NyPris, idempotensNoegle: string): Promise<StripePris>;
  /** Stripe never deletes a price that was used; we never delete at all, we archive. */
  arkiverPris(id: string): Promise<void>;
  /** Account settings the setup cannot set and finds unset (names only); null when the key may not read them. */
  kontoMangler(): Promise<string[] | null>;

  // --- KC-0191/KC-0192: customers, Checkout, subscriptions, Portal --------------------------------
  /** The active price holding this lookup key, or null (setup not run). */
  prisForLookupKey(lookupKey: string): Promise<StripePris | null>;
  opretKunde(k: NyKunde, idempotensNoegle: string): Promise<{ id: string }>;
  /** null when Stripe does not know the id. */
  hentKunde(id: string): Promise<StripeKunde | null>;
  opretCheckout(params: Stripe.Checkout.SessionCreateParams, idempotensNoegle: string): Promise<CheckoutSession>;
  /** With its subscription expanded; null when Stripe does not know the id. */
  hentCheckout(id: string): Promise<CheckoutSession | null>;
  udloebCheckout(id: string): Promise<void>;
  /** Every subscription of the customer, any status (canceled included). */
  listAbonnementer(kunde: string): Promise<AbonnementSnapshot[]>;
  /** Cancels now (the account was deleted). Nothing is deleted in Stripe. */
  opsigAbonnement(id: string): Promise<void>;
  /** KC-0209 "Opsig": the subscription ends when the paid period does (cancel_at_period_end); access stays until then.
   *  Never refunds anything: money back is a task for the owner, never code (AGENTS §9). */
  opsigVedPeriodeslut(id: string): Promise<void>;
  /** KC-0195: a Portal session on Clawco's own configuration (never the shared account's default), in the account's
   *  language. Created per click, never cached, never logged. */
  opretPortal(a: NyPortalSession): Promise<{ url: string }>;
  /** KC-0195: every Portal configuration marked metadata.clawco = "ja", active or not (ShelfAtlas' are never listed). */
  listPortalKonfigurationer(): Promise<PortalKonfiguration[]>;
  opretPortalKonfiguration(params: Stripe.BillingPortal.ConfigurationCreateParams, idempotensNoegle: string): Promise<PortalKonfiguration>;
  opdaterPortalKonfiguration(id: string, params: Stripe.BillingPortal.ConfigurationUpdateParams): Promise<PortalKonfiguration>;
  /** KC-0206: every invoice of the customer, newest first (for Hent alt). */
  listFakturaer(kunde: string): Promise<Faktura[]>;
  /** KC-0194: every invoice in the account paid at or after `siden`, any customer (the VAT threshold is the seller's,
   *  and the account is Henrik's own, shared with ShelfAtlas). Amounts only, nothing about the customer. */
  listBetalteFakturaer(siden: Date): Promise<BetaltFaktura[]>;
  /** KC-0194: Stripe Tax's status; null when the key may not read it. */
  skatIndstillinger(): Promise<SkatIndstillinger | null>;
}

/** Test or live, from the key prefix. Throws naming the key, never showing its value. */
export function tilstandFraNoegle(noegle: string | undefined): Tilstand {
  if (noegle === undefined || !noegle.trim()) throw new Error(`${NOEGLE_NAVN} mangler — se sky/.env.example`);
  if (noegle !== noegle.trim()) throw new Error(`${NOEGLE_NAVN} er ugyldig: har mellemrum før eller efter`);
  // Test mode may use a standard key (nothing real can be charged); live only a restricted one.
  if (/^sk_live_/.test(noegle)) throw new Error(`${NOEGLE_NAVN} er en fuld hemmelig live-nøgle; brug en begrænset nøgle (rk_live_) til Clawco`);
  const m = /^(?:rk_(test|live)|sk_(test))_[A-Za-z0-9]+$/.exec(noegle);
  if (!m) throw new Error(`${NOEGLE_NAVN} er ugyldig: skal begynde med sk_test_, rk_test_ eller rk_live_`);
  return m[1] === 'live' ? 'live' : 'test';
}

export type BetalingsConfig = {
  noegle: string | null;
  webhookHemmelighed: string | null;
  /** The terms and privacy URLs come from the environment (unset = live Checkout refuses, checkout.ts); the
   *  withdrawal sentence is the one text of the consumer-rights flow (KC-0209, forbrugerret.ts). */
  juridisk: { vilkaarUrl: string | null; privatlivUrl: string | null; fortrydelsesTekst: Record<'da' | 'en', string> | null };
};

/** Billing's keys, read once at start. All optional (unset = billing answers 503); a set but
 *  malformed one stops Sky, and the error names the key, never its value. */
export function laesBetaling(env: Record<string, string | undefined>): BetalingsConfig {
  const v = (k: string): string | null => (env[k] ?? '').trim() || null;
  const noegle = v(NOEGLE_NAVN);
  if (noegle !== null) tilstandFraNoegle(env[NOEGLE_NAVN]);
  const webhookHemmelighed = v(WEBHOOK_NOEGLE_NAVN);
  if (webhookHemmelighed !== null && !/^whsec_[A-Za-z0-9]+$/.test(webhookHemmelighed)) throw new Error(`${WEBHOOK_NOEGLE_NAVN} er ugyldig: skal begynde med whsec_`);
  const url = (k: string): string | null => {
    const u = v(k);
    if (u === null) return null;
    let ok = false;
    try { ok = new URL(u).protocol === 'https:'; } catch { /* reported below */ }
    if (!ok) throw new Error(`${k} er ugyldig: skal være en https-adresse`);
    return u;
  };
  return { noegle, webhookHemmelighed, juridisk: { vilkaarUrl: url('SKY_VILKAAR_URL'), privatlivUrl: url('SKY_PRIVATLIV_URL'), fortrydelsesTekst: FORTRYDELSES_TEKST } };
}

/** Masks every Stripe secret (sk_/rk_ keys, webhook secrets) in free text, e.g. an SDK error. */
export function skjulNoegler(tekst: string): string {
  return tekst.replace(/\b(sk|rk)_(test|live)_[A-Za-z0-9*]+/g, '$1_$2_[skjult]').replace(/\bwhsec_[A-Za-z0-9]+/g, 'whsec_[skjult]');
}
