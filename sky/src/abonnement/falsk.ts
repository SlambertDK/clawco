// The in-memory BetalingsKlient (KC-0190): records every write with its idempotency key and behaves
// like Stripe where the setup depends on it — unique lookup keys with transfer, idempotent replays,
// only metadata.clawco products listed, archive instead of delete. Scripted failures via fejlNaeste.
// KC-0191/KC-0192: customers, Checkout sessions and subscriptions, with test helpers that play the
// person on Stripe's page (fuldfoerCheckout) and Stripe's own state changes (saetAbonnement, sletKunde).
// KC-0193: a time model, so the scenario table (sky/test/abonnement/betaling/) runs here as it does on Stripe's
// test clocks: spolFrem plays trial ends, renewals and period-end cancellations up to a moment; a test payment
// method decides each charge; every change is recorded as the event Stripe would send (haendelser()). A
// subscription is read with its price's current lookup key, as Stripe expands it.
import type Stripe from 'stripe';
import { CLAWCO_MAERKE, kontoIdFra } from './stripe-klient.ts';
import type { AbonnementSnapshot, BetalingsKlient, CheckoutSession, Faktura, Metadata, NyKunde, NyPortalSession, NyPris, NytProdukt, PortalKonfiguration, ProduktAendring, StripeKunde, StripePris, StripeProdukt, Tilstand } from './stripe-klient.ts';

export type FalskKald = {
  metode: 'opretProdukt' | 'opdaterProdukt' | 'opretPris' | 'arkiverPris' | 'opretKunde' | 'opretCheckout' | 'udloebCheckout' | 'opsigAbonnement' | 'opsigVedPeriodeslut' | 'opretPortal' | 'opretPortalKonfiguration' | 'opdaterPortalKonfiguration' | 'vedhaeftBetalingsmiddel' | 'skiftPris' | 'betalAabne';
  args: unknown;
  idempotensNoegle?: string;
};

type FalskKunde = { id: string; email: string; sprog: string; metadata: Record<string, string>; slettet: boolean };
type FalskSession = CheckoutSession & { params: Stripe.Checkout.SessionCreateParams };

const DAG_MS = 86_400_000;

/** An event as Stripe would POST it (the body is unsigned; the receiver signs it with its own test secret). */
export type FalskHaendelse = { id: string; type: string; kunde: string; krop: string };

/** Stripe's published test payment methods the model knows: true = every charge succeeds. */
export const TEST_BETALINGSMIDLER: Readonly<Record<string, boolean>> = { pm_card_visa: true, pm_card_chargeCustomerFail: false };


type Metode = keyof BetalingsKlient;

export class FalskBetalingsKlient implements BetalingsKlient {
  readonly tilstand: Tilstand;
  readonly kald: FalskKald[] = [];
  /** What kontoMangler answers; null = the key may not read account settings. */
  konto: string[] | null = [];
  private produkter = new Map<string, StripeProdukt>();
  private priser = new Map<string, StripePris>();
  private idempotens = new Map<string, { anmodning: string; svar: unknown }>();
  private fejl = new Map<string, string>();
  private naesteId = 1;
  private kunder = new Map<string, FalskKunde>();
  private sessioner = new Map<string, FalskSession>();
  private abonnementer = new Map<string, AbonnementSnapshot>();
  private fakturaer: (Faktura & { kunde: string })[] = [];
  /** KC-0195: Portal configurations, Clawco's and (via tilfoejPortalKonfiguration) the shared account's others. */
  private portaler = new Map<string, { aktiv: boolean; metadata: Metadata; params: Stripe.BillingPortal.ConfigurationCreateParams | null }>();
  private log: FalskHaendelse[] = [];
  private naesteHaendelse = 1;
  /** The customer's default payment method: whether charges succeed. */
  private betaler = new Map<string, boolean>();
  /** What the trial does at its end without a payment method (trial_settings.end_behavior). */
  private slutAdfaerd = new Map<string, string>();
  private readonly checkoutUrl: (id: string) => string;
  /** Development and smoke tests: what Stripe would send as a webhook after a change it made itself (a cancellation).
   *  Set by server.ts in SKY_DEV so the real handler hears about it, the way production does; null in unit tests. */
  haendelsesSink: ((type: string, kunde: string) => Promise<void>) | null = null;

  constructor(tilstand: Tilstand, start: { produkter?: StripeProdukt[]; priser?: StripePris[]; checkoutUrl?: (id: string) => string } = {}) {
    this.tilstand = tilstand;
    this.checkoutUrl = start.checkoutUrl ?? ((id) => `https://checkout.stripe.test/c/${id}`);
    for (const p of start.produkter ?? []) this.produkter.set(p.id, structuredClone(p));
    for (const p of start.priser ?? []) this.priser.set(p.id, structuredClone(p));
  }

  get skrivninger(): number {
    return this.kald.length;
  }

  /** Every price ever created, archived included (for tests). */
  allePriser(): StripePris[] {
    return [...this.priser.values()].map((p) => structuredClone(p));
  }

  fejlNaeste(metode: Metode, besked: string): void {
    this.fejl.set(metode, besked);
  }

  private tjekFejl(metode: Metode): void {
    const besked = this.fejl.get(metode);
    if (besked !== undefined) {
      this.fejl.delete(metode);
      throw new Error(besked);
    }
  }

  private gentag<T>(noegle: string, anmodning: unknown, lav: () => T): T {
    const a = JSON.stringify(anmodning);
    const tidligere = this.idempotens.get(noegle);
    if (tidligere) {
      if (tidligere.anmodning !== a) throw new Error(`idempotensnøglen ${noegle} er brugt til en anden anmodning`);
      return structuredClone(tidligere.svar) as T;
    }
    const svar = lav();
    this.idempotens.set(noegle, { anmodning: a, svar: structuredClone(svar) });
    return svar;
  }

  async listProdukter(): Promise<StripeProdukt[]> {
    this.tjekFejl('listProdukter');
    return [...this.produkter.values()].filter((p) => p.metadata[CLAWCO_MAERKE.noegle] === CLAWCO_MAERKE.vaerdi).map((p) => structuredClone(p));
  }

  async listPriser(produktId: string): Promise<StripePris[]> {
    this.tjekFejl('listPriser');
    return [...this.priser.values()].filter((p) => p.produkt === produktId).map((p) => structuredClone(p));
  }

  async opretProdukt(p: NytProdukt, idempotensNoegle: string): Promise<StripeProdukt> {
    this.tjekFejl('opretProdukt');
    this.kald.push({ metode: 'opretProdukt', args: structuredClone(p), idempotensNoegle });
    return this.gentag(idempotensNoegle, p, () => {
      if (this.produkter.has(p.id)) throw new Error(`produktet ${p.id} findes allerede`);
      const ny: StripeProdukt = { id: p.id, navn: p.navn, aktiv: true, metadata: { ...p.metadata } };
      this.produkter.set(ny.id, ny);
      return structuredClone(ny);
    });
  }

  async opdaterProdukt(id: string, aendring: ProduktAendring): Promise<StripeProdukt> {
    this.tjekFejl('opdaterProdukt');
    this.kald.push({ metode: 'opdaterProdukt', args: { id, ...structuredClone(aendring) } });
    const p = this.produkter.get(id);
    if (!p) throw new Error(`intet produkt ${id}`);
    if (aendring.navn !== undefined) p.navn = aendring.navn;
    if (aendring.aktiv !== undefined) p.aktiv = aendring.aktiv;
    if (aendring.metadata !== undefined) p.metadata = { ...p.metadata, ...aendring.metadata };
    return structuredClone(p);
  }

  async opretPris(p: NyPris, idempotensNoegle: string): Promise<StripePris> {
    this.tjekFejl('opretPris');
    this.kald.push({ metode: 'opretPris', args: structuredClone(p), idempotensNoegle });
    return this.gentag(idempotensNoegle, p, () => {
      if (!this.produkter.has(p.produkt)) throw new Error(`intet produkt ${p.produkt}`);
      const holder = [...this.priser.values()].find((x) => x.lookupKey === p.lookupKey);
      if (holder) {
        if (!p.transferLookupKey) throw new Error(`lookup_key ${p.lookupKey} er allerede brugt af en anden pris`);
        holder.lookupKey = null;
      }
      const ny: StripePris = { id: `price_falsk_${this.naesteId++}`, produkt: p.produkt, aktiv: true, lookupKey: p.lookupKey, dkk: p.dkk, eur: p.eur, interval: p.interval, metadata: { ...p.metadata } };
      this.priser.set(ny.id, ny);
      return structuredClone(ny);
    });
  }

  async arkiverPris(id: string): Promise<void> {
    this.tjekFejl('arkiverPris');
    this.kald.push({ metode: 'arkiverPris', args: { id } });
    const p = this.priser.get(id);
    if (!p) throw new Error(`ingen pris ${id}`);
    p.aktiv = false;
  }

  async kontoMangler(): Promise<string[] | null> {
    this.tjekFejl('kontoMangler');
    return this.konto === null ? null : [...this.konto];
  }

  async prisForLookupKey(lookupKey: string): Promise<StripePris | null> {
    this.tjekFejl('prisForLookupKey');
    const p = [...this.priser.values()].find((x) => x.aktiv && x.lookupKey === lookupKey);
    return p ? structuredClone(p) : null;
  }

  async opretKunde(k: NyKunde, idempotensNoegle: string): Promise<{ id: string }> {
    this.tjekFejl('opretKunde');
    this.kald.push({ metode: 'opretKunde', args: { kontoId: k.kontoId, sprog: k.sprog }, idempotensNoegle });
    return this.gentag(idempotensNoegle, k, () => {
      const ny: FalskKunde = { id: `cus_falsk_${this.naesteId++}`, email: k.email, sprog: k.sprog, metadata: { [CLAWCO_MAERKE.noegle]: CLAWCO_MAERKE.vaerdi, konto_id: String(k.kontoId) }, slettet: false };
      this.kunder.set(ny.id, ny);
      return { id: ny.id };
    });
  }

  async hentKunde(id: string): Promise<StripeKunde | null> {
    this.tjekFejl('hentKunde');
    const k = this.kunder.get(id);
    if (!k) return null;
    return k.slettet ? { id, slettet: true, kontoId: null } : { id, slettet: false, kontoId: kontoIdFra(k.metadata['konto_id']) };
  }

  private session(s: FalskSession): CheckoutSession {
    const { params: _params, ...ud } = structuredClone(s);
    if (ud.abonnement) { const a = this.abonnementer.get(ud.abonnement.id); ud.abonnement = a ? this.medPris(a) : null; }
    return ud;
  }

  async opretCheckout(params: Stripe.Checkout.SessionCreateParams, idempotensNoegle: string): Promise<CheckoutSession> {
    this.tjekFejl('opretCheckout');
    this.kald.push({ metode: 'opretCheckout', args: structuredClone(params), idempotensNoegle });
    const id = this.gentag(idempotensNoegle, params, () => {
      const kunde = params.customer ? this.kunder.get(params.customer) : undefined;
      if (!kunde || kunde.slettet) throw new Error(`ingen kunde ${params.customer ?? ''}`);
      for (const l of params.line_items ?? []) if (!l.price || !this.priser.get(l.price)?.aktiv) throw new Error(`ingen aktiv pris ${l.price ?? ''}`);
      const sid = `cs_falsk_${this.naesteId++}`;
      this.sessioner.set(sid, { id: sid, url: this.checkoutUrl(sid), status: 'open', kunde: kunde.id, kontoId: kontoIdFra(params.client_reference_id), abonnement: null, params: structuredClone(params) });
      return sid;
    });
    return this.session(this.sessioner.get(id)!);
  }

  async hentCheckout(id: string): Promise<CheckoutSession | null> {
    this.tjekFejl('hentCheckout');
    const s = this.sessioner.get(id);
    return s ? this.session(s) : null;
  }

  /** The parameters a session was created with (for tests and the dev page). */
  checkoutParams(id: string): Stripe.Checkout.SessionCreateParams | null {
    const s = this.sessioner.get(id);
    return s ? structuredClone(s.params) : null;
  }

  async udloebCheckout(id: string): Promise<void> {
    this.tjekFejl('udloebCheckout');
    this.kald.push({ metode: 'udloebCheckout', args: { id } });
    const s = this.sessioner.get(id);
    if (!s) throw new Error(`ingen session ${id}`);
    if (s.status === 'complete') throw new Error(`sessionen ${id} er gennemført (complete) og kan ikke udløbe`);
    s.status = 'expired';
  }

  /** Test helper: the person presses the button on Stripe's page. Returns the success URL. */
  fuldfoerCheckout(id: string, nu: Date): string {
    const s = this.sessioner.get(id);
    if (!s) throw new Error(`ingen session ${id}`);
    if (s.status !== 'open') throw new Error(`sessionen ${id} er ${s.status === 'expired' ? 'udløbet' : 'gennemført'}`);
    const p = s.params;
    const pris = this.priser.get(p.line_items?.[0]?.price ?? '');
    const dage = p.subscription_data?.trial_period_days;
    const proeveSlut = dage ? new Date(nu.getTime() + dage * DAG_MS) : null;
    const periode = new Date(nu);
    if (pris?.interval === 'year') periode.setUTCFullYear(periode.getUTCFullYear() + 1); else periode.setUTCMonth(periode.getUTCMonth() + 1);
    const ab: AbonnementSnapshot = {
      id: `sub_falsk_${this.naesteId++}`, kunde: s.kunde!, status: dage ? 'trialing' : 'active', prisId: pris?.id ?? null, lookupKey: pris?.lookupKey ?? null,
      oprettet: new Date(nu), proeveStart: dage ? new Date(nu) : null, proeveSlut, periodeSlut: proeveSlut ?? periode,
      opsigVedPeriodeslut: false, opsigesVed: null, forfaldenSiden: null, prisPlan: pris?.metadata['clawco_plan'] ?? null, metadata: { ...(p.subscription_data?.metadata as Record<string, string> | undefined) },
    };
    this.abonnementer.set(ab.id, ab);
    this.slutAdfaerd.set(ab.id, p.subscription_data?.trial_settings?.end_behavior?.missing_payment_method ?? 'create_invoice');
    s.status = 'complete';
    s.abonnement = structuredClone(ab);
    this.udsend('checkout.session.completed', ab.kunde, { id, object: 'checkout.session' });
    this.udsend('customer.subscription.created', ab.kunde, { id: ab.id, object: 'subscription' });
    return (p.success_url ?? '').replace('{CHECKOUT_SESSION_ID}', id);
  }

  async listAbonnementer(kunde: string): Promise<AbonnementSnapshot[]> {
    this.tjekFejl('listAbonnementer');
    return [...this.abonnementer.values()].filter((a) => a.kunde === kunde).map((a) => this.medPris(a));
  }

  /** As Stripe expands it: the lookup key is the one the price holds now (a config change moves it away). */
  private medPris(a: AbonnementSnapshot): AbonnementSnapshot {
    const ud = structuredClone(a);
    const pris = a.prisId === null ? undefined : this.priser.get(a.prisId);
    if (pris) { ud.lookupKey = pris.lookupKey; ud.prisPlan = pris.metadata['clawco_plan'] ?? null; }
    return ud;
  }

  /** Test helper: Stripe changed a subscription (a payment failed, a plan changed, …). */
  saetAbonnement(a: AbonnementSnapshot): void {
    this.abonnementer.set(a.id, structuredClone(a));
  }

  async opsigAbonnement(id: string): Promise<void> {
    this.tjekFejl('opsigAbonnement');
    this.kald.push({ metode: 'opsigAbonnement', args: { id } });
    const a = this.abonnementer.get(id);
    if (!a) throw new Error(`intet abonnement ${id}`);
    a.status = 'canceled';
    this.udsend('customer.subscription.deleted', a.kunde, { id: a.id, object: 'subscription' });
    await this.haendelsesSink?.('customer.subscription.deleted', a.kunde);
  }

  async opsigVedPeriodeslut(id: string): Promise<void> {
    this.tjekFejl('opsigVedPeriodeslut');
    this.kald.push({ metode: 'opsigVedPeriodeslut', args: { id } });
    const a = this.abonnementer.get(id);
    if (!a) throw new Error(`intet abonnement ${id}`);
    a.opsigVedPeriodeslut = true;
    this.udsend('customer.subscription.updated', a.kunde, { id: a.id, object: 'subscription' });
    await this.haendelsesSink?.('customer.subscription.updated', a.kunde);
  }

  // --- KC-0193: the time model ---------------------------------------------------------------------------

  private udsend(type: string, kunde: string, objekt: { id: string; object: string }): void {
    const id = `evt_falsk_${this.naesteHaendelse++}`;
    const data = objekt.object === 'customer' ? { id: kunde, object: 'customer' } : { ...objekt, customer: kunde };
    this.log.push({ id, type, kunde, krop: JSON.stringify({ id, object: 'event', type, data: { object: data } }) });
  }

  /** Every event so far, oldest first. */
  haendelser(): FalskHaendelse[] {
    return structuredClone(this.log);
  }

  /** Test helper: the customer's default payment method becomes one of Stripe's published test ids (through the API,
   *  never a card number). */
  vedhaeftBetalingsmiddel(kunde: string, betalingsmiddel: string): void {
    this.kald.push({ metode: 'vedhaeftBetalingsmiddel', args: { kunde, betalingsmiddel } });
    if (!this.kunder.has(kunde)) throw new Error(`ingen kunde ${kunde}`);
    const betaler = TEST_BETALINGSMIDLER[betalingsmiddel];
    if (betaler === undefined || !Object.hasOwn(TEST_BETALINGSMIDLER, betalingsmiddel)) throw new Error(`ukendt testbetalingsmiddel ${betalingsmiddel}`);
    this.betaler.set(kunde, betaler);
    const pm = `pm_falsk_${this.naesteId++}`;
    this.udsend('payment_method.attached', kunde, { id: pm, object: 'payment_method' });
    this.udsend('customer.updated', kunde, { id: kunde, object: 'customer' });
  }

  /** Test helper: a plan change (the Portal's); takes effect at once. The amounts are Stripe's arithmetic, not modelled. */
  skiftPris(abonnementId: string, prisId: string): void {
    this.kald.push({ metode: 'skiftPris', args: { abonnementId, prisId } });
    const a = this.abonnementer.get(abonnementId);
    if (!a) throw new Error(`intet abonnement ${abonnementId}`);
    const pris = this.priser.get(prisId);
    if (!pris?.aktiv) throw new Error(`ingen aktiv pris ${prisId}`);
    a.prisId = pris.id;
    a.lookupKey = pris.lookupKey;
    a.prisPlan = pris.metadata['clawco_plan'] ?? null;
    this.udsend('customer.subscription.updated', a.kunde, { id: a.id, object: 'subscription' });
  }

  /** Test helper: time reaches `til` (for one customer, like a test clock, or all). Every boundary on the way is
   *  played in time order: a trial ends, a period renews (a charge), a cancellation at period end takes effect. */
  spolFrem(til: Date, kunde?: string): void {
    for (;;) {
      let naeste: { a: AbonnementSnapshot; ved: Date } | null = null;
      for (const a of this.abonnementer.values()) {
        if (kunde !== undefined && a.kunde !== kunde) continue;
        const ved = a.status === 'trialing' ? a.proeveSlut : a.status === 'active' || a.status === 'past_due' ? a.periodeSlut : null;
        if (ved && ved.getTime() <= til.getTime() && (!naeste || ved.getTime() < naeste.ved.getTime())) naeste = { a, ved };
      }
      if (!naeste) return;
      this.overgang(naeste.a, naeste.ved);
    }
  }

  private overgang(a: AbonnementSnapshot, ved: Date): void {
    const objekt = { id: a.id, object: 'subscription' };
    if (a.opsigVedPeriodeslut || (a.opsigesVed !== null && a.opsigesVed.getTime() <= ved.getTime())) {
      a.status = 'canceled';
      this.udsend('customer.subscription.deleted', a.kunde, objekt);
      return;
    }
    const betaler = this.betaler.get(a.kunde);
    if (a.status === 'trialing' && betaler === undefined) {
      const adfaerd = this.slutAdfaerd.get(a.id) ?? 'create_invoice';
      if (adfaerd === 'pause') {
        a.status = 'paused';
        this.udsend('customer.subscription.paused', a.kunde, objekt);
        this.udsend('customer.subscription.updated', a.kunde, objekt);
        return;
      }
      if (adfaerd === 'cancel') {
        a.status = 'canceled';
        this.udsend('customer.subscription.deleted', a.kunde, objekt);
        return;
      }
    }
    // A charge for the next period (no payment method = it fails, as create_invoice would).
    const pris = a.prisId === null ? undefined : this.priser.get(a.prisId);
    const periode = new Date(ved);
    if (pris?.interval === 'year') periode.setUTCFullYear(periode.getUTCFullYear() + 1); else periode.setUTCMonth(periode.getUTCMonth() + 1);
    a.periodeSlut = periode;
    const faktura = `in_falsk_${this.naesteId++}`;
    const ok = betaler === true;
    this.fakturaer.push({ id: faktura, nummer: null, oprettet: new Date(ved), beloeb: pris?.dkk ?? 0, valuta: 'dkk', status: ok ? 'paid' : 'open', url: null, kunde: a.kunde });
    if (ok) {
      a.status = 'active';
      a.forfaldenSiden = null;
      this.udsend('invoice.paid', a.kunde, { id: faktura, object: 'invoice' });
    } else {
      a.status = 'past_due';
      a.forfaldenSiden = a.forfaldenSiden ?? new Date(ved);
      this.udsend('invoice.payment_failed', a.kunde, { id: faktura, object: 'invoice' });
    }
    this.udsend('customer.subscription.updated', a.kunde, objekt);
  }

  /** Test helper (KC-0196): the customer's open invoices are charged again now with its current payment method (what
   *  the Portal does once the card is fixed). Paid: a past_due subscription is active again. Declined: one more failure. */
  betalAabne(kunde: string): void {
    this.kald.push({ metode: 'betalAabne', args: { kunde } });
    const aabne = this.fakturaer.filter((f) => f.kunde === kunde && f.status === 'open');
    if (this.betaler.get(kunde) !== true) {
      for (const f of aabne) this.udsend('invoice.payment_failed', kunde, { id: f.id, object: 'invoice' });
      return;
    }
    for (const f of aabne) { f.status = 'paid'; this.udsend('invoice.paid', kunde, { id: f.id, object: 'invoice' }); }
    for (const a of this.abonnementer.values()) {
      if (a.kunde !== kunde || (a.status !== 'past_due' && a.status !== 'unpaid')) continue;
      a.status = 'active';
      a.forfaldenSiden = null;
      this.udsend('customer.subscription.updated', kunde, { id: a.id, object: 'subscription' });
    }
  }

  /** Test helper: the customer is deleted in Stripe; its subscriptions are canceled. */
  sletKunde(id: string): void {
    const k = this.kunder.get(id);
    if (!k) throw new Error(`ingen kunde ${id}`);
    k.slettet = true;
    k.metadata = {};
    for (const a of this.abonnementer.values()) if (a.kunde === id) a.status = 'canceled';
  }

  /** Test helper (KC-0206): Stripe issued an invoice to `kunde`. */
  tilfoejFaktura(f: Faktura & { kunde: string }): void {
    this.fakturaer.push(structuredClone(f));
  }

  async listFakturaer(kunde: string): Promise<Faktura[]> {
    this.tjekFejl('listFakturaer');
    return this.fakturaer.filter((f) => f.kunde === kunde).map(({ kunde: _k, ...f }) => structuredClone(f)).sort((a, b) => b.oprettet.getTime() - a.oprettet.getTime());
  }

  async opretPortal(a: NyPortalSession): Promise<{ url: string }> {
    this.tjekFejl('opretPortal');
    this.kald.push({ metode: 'opretPortal', args: { ...a } });
    if (!this.kunder.has(a.kunde)) throw new Error(`ingen kunde ${a.kunde}`);
    if (!this.portaler.get(a.konfiguration)?.aktiv) throw new Error(`ingen aktiv portalkonfiguration ${a.konfiguration}`);
    return { url: `https://billing.stripe.test/p/${a.kunde}` };
  }

  private portal(id: string): PortalKonfiguration {
    const p = this.portaler.get(id)!;
    return { id, aktiv: p.aktiv, metadata: { ...p.metadata } };
  }

  async listPortalKonfigurationer(): Promise<PortalKonfiguration[]> {
    this.tjekFejl('listPortalKonfigurationer');
    return [...this.portaler.entries()].filter(([, p]) => p.metadata[CLAWCO_MAERKE.noegle] === CLAWCO_MAERKE.vaerdi).map(([id]) => this.portal(id));
  }

  async opretPortalKonfiguration(params: Stripe.BillingPortal.ConfigurationCreateParams, idempotensNoegle: string): Promise<PortalKonfiguration> {
    this.tjekFejl('opretPortalKonfiguration');
    this.kald.push({ metode: 'opretPortalKonfiguration', args: structuredClone(params), idempotensNoegle });
    const id = this.gentag(idempotensNoegle, params, () => {
      const ny = `bpc_falsk_${this.naesteId++}`;
      this.portaler.set(ny, { aktiv: true, metadata: { ...(params.metadata as Metadata | undefined) }, params: structuredClone(params) });
      return ny;
    });
    return this.portal(id);
  }

  async opdaterPortalKonfiguration(id: string, params: Stripe.BillingPortal.ConfigurationUpdateParams): Promise<PortalKonfiguration> {
    this.tjekFejl('opdaterPortalKonfiguration');
    this.kald.push({ metode: 'opdaterPortalKonfiguration', args: { id, ...structuredClone(params) } });
    const p = this.portaler.get(id);
    if (!p) throw new Error(`ingen portalkonfiguration ${id}`);
    const { active, ...resten } = params;
    if (active !== undefined) p.aktiv = active;
    if (resten.features) p.params = structuredClone(resten) as Stripe.BillingPortal.ConfigurationCreateParams;
    if (resten.metadata) p.metadata = { ...p.metadata, ...(resten.metadata as Metadata) };
    return this.portal(id);
  }

  /** Test helper (KC-0195): a configuration someone else made in the shared account (or a stray Clawco one). */
  tilfoejPortalKonfiguration(a: { metadata: Metadata }): string {
    const id = `bpc_falsk_${this.naesteId++}`;
    this.portaler.set(id, { aktiv: true, metadata: { ...a.metadata }, params: null });
    return id;
  }

  /** Test helper (KC-0195): the parameters a configuration holds now. */
  portalParams(id: string): Stripe.BillingPortal.ConfigurationCreateParams | null {
    const p = this.portaler.get(id)?.params;
    return p ? structuredClone(p) : null;
  }
}
