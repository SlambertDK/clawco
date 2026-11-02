// The in-memory BetalingsKlient (KC-0190): records every write with its idempotency key and behaves
// like Stripe where the setup depends on it — unique lookup keys with transfer, idempotent replays,
// only metadata.clawco products listed, archive instead of delete. Scripted failures via fejlNaeste.
// KC-0191/KC-0192: customers, Checkout sessions and subscriptions, with test helpers that play the
// person on Stripe's page (fuldfoerCheckout) and Stripe's own state changes (saetAbonnement, sletKunde).
import type Stripe from 'stripe';
import { CLAWCO_MAERKE, kontoIdFra } from './stripe-klient.ts';
import type { AbonnementSnapshot, BetalingsKlient, CheckoutSession, Faktura, NyKunde, NyPris, NytProdukt, ProduktAendring, StripeKunde, StripePris, StripeProdukt, Tilstand } from './stripe-klient.ts';

export type FalskKald = {
  metode: 'opretProdukt' | 'opdaterProdukt' | 'opretPris' | 'arkiverPris' | 'opretKunde' | 'opretCheckout' | 'udloebCheckout' | 'opsigAbonnement' | 'opretPortal';
  args: unknown;
  idempotensNoegle?: string;
};

type FalskKunde = { id: string; email: string; sprog: string; metadata: Record<string, string>; slettet: boolean };
type FalskSession = CheckoutSession & { params: Stripe.Checkout.SessionCreateParams };

const DAG_MS = 86_400_000;

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
  private readonly checkoutUrl: (id: string) => string;

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
    if (ud.abonnement) ud.abonnement = structuredClone(this.abonnementer.get(ud.abonnement.id) ?? null);
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
      opsigVedPeriodeslut: false, opsigesVed: null, forfaldenSiden: null, metadata: { ...(p.subscription_data?.metadata as Record<string, string> | undefined) },
    };
    this.abonnementer.set(ab.id, ab);
    s.status = 'complete';
    s.abonnement = structuredClone(ab);
    return (p.success_url ?? '').replace('{CHECKOUT_SESSION_ID}', id);
  }

  async listAbonnementer(kunde: string): Promise<AbonnementSnapshot[]> {
    this.tjekFejl('listAbonnementer');
    return [...this.abonnementer.values()].filter((a) => a.kunde === kunde).map((a) => structuredClone(a));
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

  async opretPortal(kunde: string, returUrl: string): Promise<{ url: string }> {
    this.tjekFejl('opretPortal');
    this.kald.push({ metode: 'opretPortal', args: { kunde, returUrl } });
    if (!this.kunder.has(kunde)) throw new Error(`ingen kunde ${kunde}`);
    return { url: `https://billing.stripe.test/p/${kunde}` };
  }
}
