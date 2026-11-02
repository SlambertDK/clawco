// The real BetalingsKlient (KC-0190) over the official `stripe` SDK — the only file in Sky that
// imports it at runtime (others may import its types). Mode comes from the key (tilstandFraNoegle); only restricted keys are accepted. The
// mapping functions are pure and tested; the network calls are exercised against Henrik's Stripe
// test account only (parked until he pastes the key).
import Stripe from 'stripe';
import { CLAWCO_MAERKE, kontoIdFra, tilstandFraNoegle } from './stripe-klient.ts';
import type { AbonnementSnapshot, BetaltFaktura, SkatIndstillinger, BetalingsKlient, CheckoutSession, Faktura, NyKunde, NyPortalSession, NyPris, NytProdukt, PortalKonfiguration, ProduktAendring, StripeHaendelse, StripeKunde, StripePris, StripeProdukt, Tilstand } from './stripe-klient.ts';

export function tilPrisParams(p: NyPris): Stripe.PriceCreateParams {
  // KC-0194 (G6): no tax_behavior while moms.aktiv is false; once on, both currencies are VAT-inclusive.
  return {
    product: p.produkt,
    nickname: p.navn,
    currency: 'dkk',
    unit_amount: p.dkk,
    ...(p.momsInkl ? { tax_behavior: 'inclusive' as const } : {}),
    currency_options: { eur: { unit_amount: p.eur, ...(p.momsInkl ? { tax_behavior: 'inclusive' as const } : {}) } },
    recurring: { interval: p.interval },
    lookup_key: p.lookupKey,
    transfer_lookup_key: p.transferLookupKey,
    metadata: p.metadata,
  };
}

/** A price that is not a plain monthly/yearly DKK amount gets dkk = -1, so it never matches a
 *  config price and is replaced or archived. */
export function fraStripePris(x: Stripe.Price): StripePris {
  const r = x.recurring;
  const interval = r?.interval === 'year' ? 'year' : 'month';
  const vores = x.currency === 'dkk' && x.unit_amount !== null && r !== null && r.interval_count === 1 && (r.interval === 'month' || r.interval === 'year');
  return {
    id: x.id,
    produkt: typeof x.product === 'string' ? x.product : x.product.id,
    aktiv: x.active,
    lookupKey: x.lookup_key,
    dkk: vores ? x.unit_amount! : -1,
    eur: x.currency_options?.['eur']?.unit_amount ?? null,
    interval,
    metadata: { ...x.metadata },
    momsInkl: x.tax_behavior === 'inclusive' && (x.currency_options?.['eur'] === undefined || x.currency_options['eur'].tax_behavior === 'inclusive'),
  };
}

export function fraStripeProdukt(x: Stripe.Product): StripeProdukt {
  return { id: x.id, navn: x.name, aktiv: x.active, metadata: { ...x.metadata }, skatKode: id(x.tax_code) };
}

/** Public business details the setup cannot set (Henrik's legal entity, D17), named when unset. */
export function kontoHuller(konto: Stripe.Account): string[] {
  const b = konto.business_profile;
  const huller: [string, unknown][] = [['Virksomhedsnavn', b?.name], ['Support-e-mail', b?.support_email], ['Supportadresse', b?.support_address], ['Hjemmeside', b?.url]];
  return huller.filter(([, v]) => !v).map(([navn]) => navn);
}

const dato = (sek: number | null | undefined): Date | null => (typeof sek === 'number' ? new Date(sek * 1000) : null);
const id = (v: string | { id: string } | null | undefined): string | null => (v == null ? null : typeof v === 'string' ? v : v.id);

/** API endive: the price and the current period live on the subscription item, not the subscription. */
export function fraStripeAbonnement(s: Stripe.Subscription): AbonnementSnapshot {
  const item = s.items.data[0];
  const faktura = typeof s.latest_invoice === 'object' && s.latest_invoice !== null ? s.latest_invoice : null;
  return {
    id: s.id,
    kunde: id(s.customer)!,
    status: s.status,
    prisId: item?.price.id ?? null,
    lookupKey: item?.price.lookup_key ?? null,
    oprettet: new Date(s.created * 1000),
    proeveStart: dato(s.trial_start),
    proeveSlut: dato(s.trial_end),
    periodeSlut: dato(item?.current_period_end),
    opsigVedPeriodeslut: s.cancel_at_period_end,
    opsigesVed: dato(s.cancel_at),
    forfaldenSiden: faktura?.status === 'open' ? dato(faktura.status_transitions.finalized_at) : null,
    prisPlan: item?.price.metadata?.['clawco_plan'] ?? null,
    metadata: { ...s.metadata },
  };
}

/** KC-0206: the invoice fields Hent alt shows. */
export function fraStripeFaktura(f: Stripe.Invoice): Faktura {
  const moms = (f.total_taxes ?? []).reduce((sum, t) => sum + t.amount, 0);
  return { id: f.id ?? '', nummer: f.number ?? null, oprettet: new Date(f.created * 1000), beloeb: f.total, valuta: f.currency, status: f.status ?? null, url: f.hosted_invoice_url ?? null, moms };
}

/** KC-0194: a paid invoice for the revenue watch: amount paid, currency and when; null when it has no paid time. */
export function fraBetaltFaktura(f: Stripe.Invoice): BetaltFaktura | null {
  const betalt = dato(f.status_transitions?.paid_at);
  return f.status === 'paid' && betalt ? { beloeb: f.amount_paid, valuta: f.currency, betalt } : null;
}

/** KC-0195: a Portal configuration as the setup compares it. */
export function fraStripePortalKonfiguration(c: Stripe.BillingPortal.Configuration): PortalKonfiguration {
  return { id: c.id, aktiv: c.active, metadata: { ...(c.metadata ?? {}) } };
}

export function fraStripeCheckout(s: Stripe.Checkout.Session): CheckoutSession {
  const status: CheckoutSession['status'] = s.status === 'complete' ? 'complete' : s.status === 'expired' ? 'expired' : 'open';
  return {
    id: s.id,
    url: s.url,
    status,
    kunde: id(s.customer),
    kontoId: kontoIdFra(s.client_reference_id),
    abonnement: typeof s.subscription === 'object' && s.subscription !== null ? fraStripeAbonnement(s.subscription) : null,
  };
}

/** Checks the Stripe-Signature header against the raw bytes with the SDK's default tolerance (300 s);
 *  throws on any mismatch. Static in the SDK, so no API key is involved. */
export function verificerWebhook(raw: Uint8Array, signatur: string, hemmelighed: string): StripeHaendelse {
  const e = Stripe.webhooks.constructEvent(raw, signatur, hemmelighed);
  const o = e.data.object as { id?: string; object?: string; customer?: string | { id: string } | null };
  const kunde = o.object === 'customer' ? (o.id ?? null) : id(o.customer);
  return { id: e.id, type: e.type, kunde };
}

/** A Stripe-Signature header for `krop` (the SDK's test helper). Development's fake Checkout uses it to
 *  deliver a signed event through the real handler; never used against Stripe. */
export function signerTestHaendelse(krop: string, hemmelighed: string): string {
  return Stripe.webhooks.generateTestHeaderString({ payload: krop, secret: hemmelighed });
}

const findesIkke = (e: unknown): boolean => e instanceof Stripe.errors.StripeInvalidRequestError && e.code === 'resource_missing';

export class StripeBetalingsKlient implements BetalingsKlient {
  readonly tilstand: Tilstand;
  private readonly stripe: Stripe;

  constructor(noegle: string) {
    this.tilstand = tilstandFraNoegle(noegle);
    this.stripe = new Stripe(noegle, { maxNetworkRetries: 2, appInfo: { name: 'clawco-sky' } });
  }

  async listProdukter(): Promise<StripeProdukt[]> {
    const ud: StripeProdukt[] = [];
    for await (const p of this.stripe.products.list({ limit: 100 })) {
      if (p.metadata[CLAWCO_MAERKE.noegle] === CLAWCO_MAERKE.vaerdi) ud.push(fraStripeProdukt(p));
    }
    return ud;
  }

  async listPriser(produktId: string): Promise<StripePris[]> {
    const ud: StripePris[] = [];
    // Both states explicitly: the listing's default is documented as active prices only.
    for (const active of [true, false]) {
      for await (const x of this.stripe.prices.list({ product: produktId, active, limit: 100, expand: ['data.currency_options'] })) ud.push(fraStripePris(x));
    }
    return ud;
  }

  async opretProdukt(p: NytProdukt, idempotensNoegle: string): Promise<StripeProdukt> {
    return fraStripeProdukt(await this.stripe.products.create({ id: p.id, name: p.navn, metadata: p.metadata, ...(p.skatKode ? { tax_code: p.skatKode } : {}) }, { idempotencyKey: idempotensNoegle }));
  }

  async opdaterProdukt(id: string, a: ProduktAendring): Promise<StripeProdukt> {
    const params: Stripe.ProductUpdateParams = {};
    if (a.navn !== undefined) params.name = a.navn;
    if (a.aktiv !== undefined) params.active = a.aktiv;
    if (a.metadata !== undefined) params.metadata = a.metadata;
    if (a.skatKode !== undefined) params.tax_code = a.skatKode;
    return fraStripeProdukt(await this.stripe.products.update(id, params));
  }

  async opretPris(p: NyPris, idempotensNoegle: string): Promise<StripePris> {
    return fraStripePris(await this.stripe.prices.create({ ...tilPrisParams(p), expand: ['currency_options'] }, { idempotencyKey: idempotensNoegle }));
  }

  async arkiverPris(id: string): Promise<void> {
    await this.stripe.prices.update(id, { active: false });
  }

  async kontoMangler(): Promise<string[] | null> {
    try {
      return kontoHuller(await this.stripe.accounts.retrieveCurrent());
    } catch (e) {
      // A restricted key without "Account: read" may not see these; the checklist covers them.
      if (e instanceof Stripe.errors.StripePermissionError) return null;
      throw e;
    }
  }

  async prisForLookupKey(lookupKey: string): Promise<StripePris | null> {
    const r = await this.stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1, expand: ['data.currency_options'] });
    const x = r.data[0];
    return x ? fraStripePris(x) : null;
  }

  async opretKunde(k: NyKunde, idempotensNoegle: string): Promise<{ id: string }> {
    const c = await this.stripe.customers.create({
      email: k.email,
      preferred_locales: [k.sprog],
      metadata: { [CLAWCO_MAERKE.noegle]: CLAWCO_MAERKE.vaerdi, konto_id: String(k.kontoId) },
    }, { idempotencyKey: idempotensNoegle });
    return { id: c.id };
  }

  async hentKunde(kundeId: string): Promise<StripeKunde | null> {
    try {
      const c = await this.stripe.customers.retrieve(kundeId);
      if ('deleted' in c && c.deleted) return { id: c.id, slettet: true, kontoId: null };
      return { id: c.id, slettet: false, kontoId: kontoIdFra((c as Stripe.Customer).metadata['konto_id']) };
    } catch (e) {
      if (findesIkke(e)) return null;
      throw e;
    }
  }

  async opretCheckout(params: Stripe.Checkout.SessionCreateParams, idempotensNoegle: string): Promise<CheckoutSession> {
    return fraStripeCheckout(await this.stripe.checkout.sessions.create(params, { idempotencyKey: idempotensNoegle }));
  }

  async hentCheckout(sessionId: string): Promise<CheckoutSession | null> {
    try {
      return fraStripeCheckout(await this.stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription', 'subscription.latest_invoice'] }));
    } catch (e) {
      if (findesIkke(e)) return null;
      throw e;
    }
  }

  async udloebCheckout(sessionId: string): Promise<void> {
    await this.stripe.checkout.sessions.expire(sessionId);
  }

  async listAbonnementer(kunde: string): Promise<AbonnementSnapshot[]> {
    const ud: AbonnementSnapshot[] = [];
    for await (const s of this.stripe.subscriptions.list({ customer: kunde, status: 'all', limit: 100, expand: ['data.latest_invoice'] })) ud.push(fraStripeAbonnement(s));
    return ud;
  }

  async opsigAbonnement(abonnementId: string): Promise<void> {
    await this.stripe.subscriptions.cancel(abonnementId);
  }

  async opsigVedPeriodeslut(abonnementId: string): Promise<void> {
    await this.stripe.subscriptions.update(abonnementId, { cancel_at_period_end: true });
  }

  async opretPortal(a: NyPortalSession): Promise<{ url: string }> {
    const p = await this.stripe.billingPortal.sessions.create({ customer: a.kunde, return_url: a.returUrl, configuration: a.konfiguration, locale: a.sprog });
    return { url: p.url };
  }

  async listPortalKonfigurationer(): Promise<PortalKonfiguration[]> {
    const ud: PortalKonfiguration[] = [];
    for await (const c of this.stripe.billingPortal.configurations.list({ limit: 100 })) {
      if (c.metadata?.[CLAWCO_MAERKE.noegle] === CLAWCO_MAERKE.vaerdi) ud.push(fraStripePortalKonfiguration(c));
    }
    return ud;
  }

  async opretPortalKonfiguration(params: Stripe.BillingPortal.ConfigurationCreateParams, idempotensNoegle: string): Promise<PortalKonfiguration> {
    return fraStripePortalKonfiguration(await this.stripe.billingPortal.configurations.create(params, { idempotencyKey: idempotensNoegle }));
  }

  async opdaterPortalKonfiguration(id: string, params: Stripe.BillingPortal.ConfigurationUpdateParams): Promise<PortalKonfiguration> {
    return fraStripePortalKonfiguration(await this.stripe.billingPortal.configurations.update(id, params));
  }

  async listFakturaer(kunde: string): Promise<Faktura[]> {
    const ud: Faktura[] = [];
    for await (const f of this.stripe.invoices.list({ customer: kunde, limit: 100 })) ud.push(fraStripeFaktura(f));
    return ud;
  }

  async listBetalteFakturaer(siden: Date): Promise<BetaltFaktura[]> {
    const ud: BetaltFaktura[] = [];
    // Listed by creation (the API's filter); an invoice is paid after it is created, so a month's margin finds every
    // invoice paid since `siden`, and the paid time decides.
    const fra = Math.floor(siden.getTime() / 1000) - 31 * 86_400;
    for await (const f of this.stripe.invoices.list({ status: 'paid', created: { gte: fra }, limit: 100 })) {
      const b = fraBetaltFaktura(f);
      if (b && b.betalt.getTime() >= siden.getTime()) ud.push(b);
    }
    return ud;
  }

  async skatIndstillinger(): Promise<SkatIndstillinger | null> {
    try {
      const s = await this.stripe.tax.settings.retrieve();
      return { aktiv: s.status === 'active', mangler: s.status_details.pending?.missing_fields ?? [] };
    } catch (e) {
      if (e instanceof Stripe.errors.StripePermissionError) return null;
      throw e;
    }
  }
}
