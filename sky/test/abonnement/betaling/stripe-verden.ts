// KC-0193: the Stripe layer — test mode with test clocks. One clock per scenario; the customer is created on it
// (sikrKunde, through a client that adds the clock), the subscription from byggCheckout's own parameters (Checkout
// needs a person on Stripe's page, so the same parameters go to subscriptions.create), the card is a published
// test payment method id attached through the API. Events are polled from events.list (no tunnel) and handed to
// the real webhook handler. Hygiene: everything created carries metadata clawco_tjek=<run id> (a clock has no
// metadata, so its name carries it), the run owns its products and lookup keys (the account's catalogue is never
// touched), and ryd() deletes the run's clocks (which takes their customers and subscriptions with them) and
// archives the run's catalogue. Only TestureApi touches the network; tests inject a simulation of it.
import Stripe from 'stripe';
import { CLAWCO_MAERKE } from '../../../src/abonnement/stripe-klient.ts';
import type { AbonnementSnapshot, BetalingsKlient, CheckoutSession, Faktura, NyKunde, NyPris, NytProdukt, ProduktAendring, StripeKunde, StripePris, StripeProdukt, Tilstand } from '../../../src/abonnement/stripe-klient.ts';
import { laesPriser } from '../../../src/abonnement/priser.ts';
import { anvend, planlaeg } from '../../../src/abonnement/opsaet.ts';
import { DAG_MS, koerselsPriser, type RaaHaendelse, type Tidslinje, type Verden } from './koer.ts';

export const TJEK_NOEGLE = 'clawco_tjek';
/** A test clock's name: test clocks have no metadata, so the run id rides in the name. */
export const urNavn = (koersel: string, scenarie: string): string => `${TJEK_NOEGLE}=${koersel} ${scenarie}`;
/** Stripe refuses an advance past two intervals of the shortest subscription; we stay under one month. */
export const MAKS_SKRIDT_MS = 28 * DAG_MS;

export type TestUr = { id: string; status: string; frossetSek: number };
export type StripeRaaHaendelse = RaaHaendelse & { kunde: string | null };

/** The Stripe calls the test layer needs beyond BetalingsKlient (test clocks, attaching a test card, creating
 *  and changing a subscription, reading events). */
export interface TestureApi {
  opretUr(navn: string, frossetSek: number): Promise<TestUr>;
  hentUr(id: string): Promise<TestUr>;
  fremUr(id: string, tilSek: number): Promise<void>;
  sletUr(id: string): Promise<void>;
  listUre(): Promise<{ id: string; navn: string | null }[]>;
  opretKunde(params: Stripe.CustomerCreateParams, idempotensNoegle: string): Promise<{ id: string }>;
  /** Attaches a published test payment method and makes it the customer's default for invoices. */
  vedhaeftKort(kunde: string, betalingsmiddel: string): Promise<void>;
  opretAbonnement(params: Stripe.SubscriptionCreateParams, idempotensNoegle: string): Promise<{ id: string }>;
  /** The subscription's one item moves to `prisId`, with Stripe's default proration. */
  skiftPris(abonnement: string, prisId: string): Promise<void>;
  /** KC-0196: charges the customer's open invoices again now, with its current default payment method. */
  betalAabne(kunde: string): Promise<void>;
  /** Events created at or after `sidenSek`, oldest first. */
  haendelser(sidenSek: number): Promise<StripeRaaHaendelse[]>;
}

/** KC-0191's Checkout parameters as a subscription (what Checkout creates once the person presses the button). */
export function abonnementFraCheckout(p: Stripe.Checkout.SessionCreateParams, koersel: string): Stripe.SubscriptionCreateParams {
  const sd = p.subscription_data;
  if (!p.customer) throw new Error('Checkout-parametrene har ingen kunde');
  if (!sd?.trial_period_days) throw new Error('uden prøveperiode skal kortet indtastes på Stripes side; testlaget starter kun prøver');
  const ud: Stripe.SubscriptionCreateParams = {
    customer: p.customer,
    items: (p.line_items ?? []).map((l) => {
      if (!l.price) throw new Error('en linje uden pris');
      return { price: l.price, quantity: l.quantity ?? 1 };
    }),
    trial_period_days: sd.trial_period_days,
    payment_settings: { save_default_payment_method: 'on_subscription' },
    metadata: { ...(sd.metadata as Record<string, string> | undefined), [TJEK_NOEGLE]: koersel },
  };
  if (p.currency) ud.currency = p.currency;
  if (sd.trial_settings) ud.trial_settings = sd.trial_settings;
  return ud;
}

/** The client Sky reads through during a run: the real one, narrowed to the run's own catalogue and tagging what
 *  it creates; a customer is made on the scenario's test clock. */
export class KoerselsKlient implements BetalingsKlient {
  private readonly indre: BetalingsKlient;
  private readonly api: TestureApi;
  private readonly koersel: string;
  private readonly ur: string | null;
  constructor(a: { indre: BetalingsKlient; api: TestureApi; koersel: string; ur: string | null }) {
    this.indre = a.indre; this.api = a.api; this.koersel = a.koersel; this.ur = a.ur;
  }
  get tilstand(): Tilstand { return this.indre.tilstand; }
  private maerk<T extends { metadata: Record<string, string> }>(x: T): T { return { ...x, metadata: { ...x.metadata, [TJEK_NOEGLE]: this.koersel } }; }
  private noegle(n: string): string { return `${TJEK_NOEGLE}-${this.koersel}-${this.ur ?? 'katalog'}-${n}`; }

  async listProdukter(): Promise<StripeProdukt[]> { return (await this.indre.listProdukter()).filter((p) => p.metadata[TJEK_NOEGLE] === this.koersel); }
  listPriser(produktId: string): Promise<StripePris[]> { return this.indre.listPriser(produktId); }
  opretProdukt(p: NytProdukt, n: string): Promise<StripeProdukt> { return this.indre.opretProdukt(this.maerk(p), this.noegle(n)); }
  opdaterProdukt(id: string, a: ProduktAendring): Promise<StripeProdukt> { return this.indre.opdaterProdukt(id, a.metadata ? { ...a, metadata: { ...a.metadata, [TJEK_NOEGLE]: this.koersel } } : a); }
  opretPris(p: NyPris, n: string): Promise<StripePris> { return this.indre.opretPris(this.maerk(p), this.noegle(n)); }
  arkiverPris(id: string): Promise<void> { return this.indre.arkiverPris(id); }
  kontoMangler(): Promise<string[] | null> { return this.indre.kontoMangler(); }
  prisForLookupKey(k: string): Promise<StripePris | null> { return this.indre.prisForLookupKey(k); }
  async opretKunde(k: NyKunde, n: string): Promise<{ id: string }> {
    if (!this.ur) throw new Error('en kunde i et testtjek hører til et testur');
    return this.api.opretKunde({
      email: k.email, preferred_locales: [k.sprog], test_clock: this.ur,
      metadata: { [CLAWCO_MAERKE.noegle]: CLAWCO_MAERKE.vaerdi, konto_id: String(k.kontoId), [TJEK_NOEGLE]: this.koersel },
    }, this.noegle(n));
  }
  hentKunde(id: string): Promise<StripeKunde | null> { return this.indre.hentKunde(id); }
  opretCheckout(p: Stripe.Checkout.SessionCreateParams, n: string): Promise<CheckoutSession> { return this.indre.opretCheckout(p, this.noegle(n)); }
  hentCheckout(id: string): Promise<CheckoutSession | null> { return this.indre.hentCheckout(id); }
  udloebCheckout(id: string): Promise<void> { return this.indre.udloebCheckout(id); }
  listAbonnementer(kunde: string): Promise<AbonnementSnapshot[]> { return this.indre.listAbonnementer(kunde); }
  opsigAbonnement(id: string): Promise<void> { return this.indre.opsigAbonnement(id); }
  opsigVedPeriodeslut(id: string): Promise<void> { return this.indre.opsigVedPeriodeslut(id); }
  opretPortal(kunde: string, retur: string): Promise<{ url: string }> { return this.indre.opretPortal(kunde, retur); }
  listFakturaer(kunde: string): Promise<Faktura[]> { return this.indre.listFakturaer(kunde); }
}

export type StripeVerdenValg = {
  api: TestureApi;
  /** The real client (StripeBetalingsKlient over the test key). */
  indre: BetalingsKlient;
  koersel: string;
  /** Wall clock (a new test clock starts here). */
  nu?: () => Date;
  vent?: (ms: number) => Promise<void>;
  /** How long a clock may take to reach "ready" after an advance. */
  urFrist?: number;
};

const sek = (d: Date): number => Math.floor(d.getTime() / 1000);

export function stripeVerden(v: StripeVerdenValg): Verden {
  const nu = v.nu ?? (() => new Date());
  const vent = v.vent ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const urFrist = v.urFrist ?? 180_000;
  const prefiks = `tjek-${v.koersel}-`;
  const priser = koerselsPriser(laesPriser(), prefiks);
  const ure: string[] = [];
  const startSek = sek(nu()) - 60;
  let katalog = false;
  const katalogKlient = new KoerselsKlient({ indre: v.indre, api: v.api, koersel: v.koersel, ur: null });

  async function venteTilKlar(id: string): Promise<TestUr> {
    for (let brugt = 0; ; brugt += 2000) {
      const u = await v.api.hentUr(id);
      if (u.status === 'ready') return u;
      if (u.status === 'internal_failure') throw new Error(`testuret ${id} fejlede hos Stripe (internal_failure)`);
      if (brugt >= urFrist) throw new Error(`testuret ${id} blev ikke klar inden for ${urFrist / 1000} s (status ${u.status})`);
      await vent(2000);
    }
  }

  return {
    navn: 'stripe',
    koersel: v.koersel,
    priser,
    plan: (id) => `${prefiks}${id}`,
    async forbered() {
      if (v.indre.tilstand !== 'test') throw new Error('betalingstjekket kører kun i Stripes testtilstand');
      katalog = true;
      await anvend((await planlaeg(priser, katalogKlient)).skridt, katalogKlient);
    },
    async tidslinje(scenarie): Promise<Tidslinje> {
      const u = await v.api.opretUr(urNavn(v.koersel, scenarie), sek(nu()));
      ure.push(u.id);
      let frosset = u.frossetSek;
      const klient = new KoerselsKlient({ indre: v.indre, api: v.api, koersel: v.koersel, ur: u.id });
      const set = new Set<string>();
      return {
        klient,
        nu: () => new Date(frosset * 1000),
        start: async (params) => (await v.api.opretAbonnement(abonnementFraCheckout(params, v.koersel), `${TJEK_NOEGLE}-${v.koersel}-${scenarie}-abonnement`)).id,
        kort: (kunde, pm) => v.api.vedhaeftKort(kunde, pm),
        async frem(ms) {
          let tilbage = Math.ceil(ms / 1000);
          while (tilbage > 0) {
            const skridt = Math.min(tilbage, MAKS_SKRIDT_MS / 1000);
            await v.api.fremUr(u.id, frosset + skridt);
            frosset = (await venteTilKlar(u.id)).frossetSek;
            tilbage -= skridt;
          }
        },
        skiftPris: (abonnement, prisId) => v.api.skiftPris(abonnement, prisId),
        betal: (kunde) => v.api.betalAabne(kunde),
        async haendelser(kunde) {
          // Stripe writes events shortly after the clock is ready: read until two reads in a row bring nothing new.
          const nye: RaaHaendelse[] = [];
          let tomme = 0;
          for (let runde = 0; runde < 15 && tomme < 2; runde++) {
            if (runde > 0) await vent(2000);
            const fundet = (await v.api.haendelser(startSek)).filter((h) => h.kunde === kunde && !set.has(h.id));
            for (const h of fundet) { set.add(h.id); nye.push({ id: h.id, type: h.type, krop: h.krop }); }
            tomme = fundet.length ? 0 : tomme + 1;
          }
          return nye;
        },
      };
    },
    async ryd() {
      const linjer: string[] = [];
      const fejl: string[] = [];
      let slettet = 0;
      for (const id of ure) {
        try { await v.api.sletUr(id); slettet++; } catch (e) { fejl.push(`testur ${id.slice(0, 14)}…: ${(e as Error).message}`); }
      }
      linjer.push(`Oprydning: ${slettet} af ${ure.length} testure slettet (deres kunder og abonnementer med dem)`);
      if (katalog) {
        try {
          let arkiveret = 0;
          for (const p of await katalogKlient.listProdukter()) {
            for (const x of await katalogKlient.listPriser(p.id)) if (x.aktiv) { await katalogKlient.arkiverPris(x.id); arkiveret++; }
            if (p.aktiv) { await katalogKlient.opdaterProdukt(p.id, { aktiv: false }); arkiveret++; }
          }
          linjer.push(`Oprydning: kørslens katalog arkiveret (${arkiveret} produkter og priser; Stripe sletter aldrig en brugt pris)`);
        } catch (e) { fejl.push(`katalog: ${(e as Error).message}`); }
      }
      if (fejl.length) throw new Error(`oprydningen fejlede: ${fejl.join('; ')}`);
      return linjer;
    },
  };
}

/** Clocks left by betaling:tjek runs (any run): the before/after count of the ticket's verification. */
export async function tjekUre(api: TestureApi): Promise<number> {
  return (await api.listUre()).filter((u) => u.navn?.startsWith(`${TJEK_NOEGLE}=`)).length;
}

/** The network side, over the official SDK. Thin on purpose: every decision is in stripeVerden above. */
export function stripeTestureApi(noegle: string): TestureApi {
  const stripe = new Stripe(noegle, { maxNetworkRetries: 2, appInfo: { name: 'clawco-betaling-tjek' } });
  const ur = (u: Stripe.TestHelpers.TestClock): TestUr => ({ id: u.id, status: u.status, frossetSek: u.frozen_time });
  return {
    opretUr: async (navn, frossetSek) => ur(await stripe.testHelpers.testClocks.create({ frozen_time: frossetSek, name: navn })),
    hentUr: async (id) => ur(await stripe.testHelpers.testClocks.retrieve(id)),
    fremUr: async (id, tilSek) => { await stripe.testHelpers.testClocks.advance(id, { frozen_time: tilSek }); },
    sletUr: async (id) => { await stripe.testHelpers.testClocks.del(id); },
    listUre: async () => {
      const ud: { id: string; navn: string | null }[] = [];
      for await (const u of stripe.testHelpers.testClocks.list({ limit: 100 })) ud.push({ id: u.id, navn: u.name ?? null });
      return ud;
    },
    opretKunde: async (params, n) => ({ id: (await stripe.customers.create(params, { idempotencyKey: n })).id }),
    vedhaeftKort: async (kunde, pm) => {
      const p = await stripe.paymentMethods.attach(pm, { customer: kunde });
      await stripe.customers.update(kunde, { invoice_settings: { default_payment_method: p.id } });
    },
    opretAbonnement: async (params, n) => ({ id: (await stripe.subscriptions.create(params, { idempotencyKey: n })).id }),
    skiftPris: async (abonnement, prisId) => {
      const s = await stripe.subscriptions.retrieve(abonnement);
      const item = s.items.data[0];
      if (!item) throw new Error(`abonnementet ${abonnement} har ingen linje`);
      await stripe.subscriptions.update(abonnement, { items: [{ id: item.id, price: prisId }], proration_behavior: 'create_prorations' });
    },
    betalAabne: async (kunde) => {
      for await (const f of stripe.invoices.list({ customer: kunde, status: 'open', limit: 100 })) await stripe.invoices.pay(f.id);
    },
    haendelser: async (sidenSek) => {
      const ud: StripeRaaHaendelse[] = [];
      for await (const e of stripe.events.list({ created: { gte: sidenSek }, limit: 100 })) {
        const o = e.data.object as { id?: string; object?: string; customer?: string | { id: string } | null };
        const kunde = o.object === 'customer' ? (o.id ?? null) : typeof o.customer === 'string' ? o.customer : (o.customer?.id ?? null);
        ud.push({ id: e.id, type: e.type, kunde, krop: JSON.stringify(e) });
      }
      return ud.reverse();
    },
  };
}
