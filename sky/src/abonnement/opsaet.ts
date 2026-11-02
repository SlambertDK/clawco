// Stripe as code (KC-0190): the products and prices in Stripe are a pure function of
// config/priser.json. planlaeg() builds the expected objects, compares them with what the client
// lists and returns the steps; anvend() runs them. Prices are immutable in Stripe, so a changed
// amount is a new price that takes over the lookup key, and the old one is archived. Nothing is
// ever deleted. Depends on the BetalingsKlient interface only.
import { createHash } from 'node:crypto';
import { laesPriser } from './priser.ts';
import type { Priser } from './priser.ts';
import { CLAWCO_MAERKE, NOEGLE_NAVN, skjulNoegler, tilstandFraNoegle } from './stripe-klient.ts';
import type { BetalingsKlient, Interval, Metadata, NytProdukt, ProduktAendring, StripePris, StripeProdukt } from './stripe-klient.ts';

export type IntervalNavn = 'maaned' | 'aar';
const INTERVALLER = [
  { navn: 'maaned', felt: 'maanedlig', stripe: 'month', tekst: 'måned' },
  { navn: 'aar', felt: 'aarlig', stripe: 'year', tekst: 'år' },
] as const;

/** Product ids and lookup keys carry the clawco- prefix: the Stripe account is shared (G6). */
export const produktId = (plan: string): string => `clawco-${plan}`;
export const lookupKey = (plan: string, interval: IntervalNavn): string => `clawco-${plan}-${interval}`;

export type ForventetProdukt = NytProdukt;
export type ForventetPris = { produkt: string; navn: string; lookupKey: string; dkk: number; eur: number; interval: Interval; metadata: Metadata };

export type Skridt =
  | { type: 'opret-produkt'; produkt: ForventetProdukt }
  | { type: 'opdater-produkt'; id: string; aendring: ProduktAendring }
  | { type: 'opret-pris'; pris: ForventetPris; erstatter: StripePris | null; idempotensNoegle: string }
  | { type: 'arkiver-pris'; pris: StripePris; grund: 'erstattet' | 'ikke i config' }
  | { type: 'arkiver-produkt'; id: string };

export type Opsaetning = { skridt: Skridt[]; uaendrede: number };

const maerke = (): Metadata => ({ [CLAWCO_MAERKE.noegle]: CLAWCO_MAERKE.vaerdi });

export function forventedeObjekter(p: Priser): { produkter: ForventetProdukt[]; priser: ForventetPris[] } {
  const produkter: ForventetProdukt[] = [];
  const priser: ForventetPris[] = [];
  for (const [id, plan] of Object.entries(p.planer)) {
    produkter.push({ id: produktId(id), navn: `Clawco ${plan.navn}`, metadata: { ...maerke(), clawco_plan: id } });
    for (const i of INTERVALLER) {
      // No tax behaviour while moms.aktiv is false (D17); KC-0194 decides it.
      priser.push({
        produkt: produktId(id),
        navn: `${plan.navn} pr. ${i.tekst}`,
        lookupKey: lookupKey(id, i.navn),
        dkk: plan[i.felt].dkk,
        eur: plan[i.felt].eur,
        interval: i.stripe,
        metadata: { ...maerke(), clawco_plan: id, clawco_interval: i.navn },
      });
    }
  }
  return { produkter, priser };
}

function noegle(art: string, indhold: unknown): string {
  return `clawco-opsaet-${art}-${createHash('sha256').update(JSON.stringify(indhold)).digest('hex').slice(0, 40)}`;
}

const sammeMetadata = (a: Metadata, b: Metadata): boolean => Object.entries(b).every(([k, v]) => a[k] === v);
const passer = (s: StripePris, f: ForventetPris): boolean => s.produkt === f.produkt && s.dkk === f.dkk && s.eur === f.eur && s.interval === f.interval;

export async function planlaeg(p: Priser, klient: BetalingsKlient): Promise<Opsaetning> {
  const forventet = forventedeObjekter(p);
  const iStripe = new Map((await klient.listProdukter()).map((x) => [x.id, x] as const));
  const historik = new Map<string, StripePris[]>();
  for (const id of new Set([...iStripe.keys(), ...forventet.produkter.map((x) => x.id)])) {
    historik.set(id, iStripe.has(id) ? await klient.listPriser(id) : []);
  }

  const skridt: Skridt[] = [];
  let uaendrede = 0;

  for (const f of forventet.produkter) {
    const s: StripeProdukt | undefined = iStripe.get(f.id);
    if (!s) { skridt.push({ type: 'opret-produkt', produkt: f }); continue; }
    const aendring: ProduktAendring = {};
    if (s.navn !== f.navn) aendring.navn = f.navn;
    if (!s.aktiv) aendring.aktiv = true;
    if (!sammeMetadata(s.metadata, f.metadata)) aendring.metadata = f.metadata;
    if (Object.keys(aendring).length) skridt.push({ type: 'opdater-produkt', id: f.id, aendring });
    else uaendrede++;
  }

  const beholdt = new Set<string>();
  const arkiver: Skridt[] = [];
  for (const f of forventet.priser) {
    const priser = historik.get(f.produkt) ?? [];
    const aktiv = priser.find((x) => x.aktiv && x.lookupKey === f.lookupKey);
    if (aktiv && passer(aktiv, f)) { beholdt.add(aktiv.id); uaendrede++; continue; }
    // The key hashes the product's whole price history, so a reverted amount or a re-added plan
    // never replays an earlier create within Stripe's 24-hour idempotency window.
    const idem = noegle('pris', { f, historik: priser.map((x) => [x.id, x.aktiv]) });
    skridt.push({ type: 'opret-pris', pris: f, erstatter: aktiv ?? null, idempotensNoegle: idem });
    if (aktiv) { beholdt.add(aktiv.id); arkiver.push({ type: 'arkiver-pris', pris: aktiv, grund: 'erstattet' }); }
  }
  for (const priser of historik.values()) {
    for (const x of priser) if (x.aktiv && !beholdt.has(x.id)) arkiver.push({ type: 'arkiver-pris', pris: x, grund: 'ikke i config' });
  }
  skridt.push(...arkiver);

  const forventedeIds = new Set(forventet.produkter.map((x) => x.id));
  for (const s of iStripe.values()) if (s.aktiv && !forventedeIds.has(s.id)) skridt.push({ type: 'arkiver-produkt', id: s.id });

  return { skridt, uaendrede };
}

export async function anvend(skridt: Skridt[], klient: BetalingsKlient): Promise<void> {
  for (const s of skridt) {
    switch (s.type) {
      case 'opret-produkt': await klient.opretProdukt(s.produkt, noegle('produkt', s.produkt)); break;
      case 'opdater-produkt': await klient.opdaterProdukt(s.id, s.aendring); break;
      case 'opret-pris': await klient.opretPris({ ...s.pris, transferLookupKey: true }, s.idempotensNoegle); break;
      case 'arkiver-pris': await klient.arkiverPris(s.pris.id); break;
      case 'arkiver-produkt': await klient.opdaterProdukt(s.id, { aktiv: false }); break;
    }
  }
}

const kr = (oere: number): string => `${(oere / 100).toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const beloeb = (dkk: number, eur: number | null): string => `${kr(dkk)} kr / ${eur === null ? 'ingen EUR' : `${kr(eur)} EUR`}`;

/** One Danish line per step: object names, ids and amounts only (never a key). */
export function beskriv(skridt: Skridt[]): string[] {
  return skridt.map((s) => {
    switch (s.type) {
      case 'opret-produkt': return `Opret produkt ${s.produkt.id} (${s.produkt.navn})`;
      case 'opdater-produkt': return `Opdatér produkt ${s.id}: ${Object.keys(s.aendring).join(', ')}`;
      case 'opret-pris': {
        const ny = `${s.pris.lookupKey}: ${beloeb(s.pris.dkk, s.pris.eur)} pr. ${s.pris.interval === 'month' ? 'måned' : 'år'}`;
        return s.erstatter
          ? `Ny pris ${ny} (afløser ${beloeb(s.erstatter.dkk, s.erstatter.eur)}; eksisterende abonnenter beholder den gamle pris, til de skifter plan)`
          : `Opret pris ${ny}`;
      }
      case 'arkiver-pris': return `Arkivér pris ${s.pris.id} (${s.pris.lookupKey ?? 'uden lookup key'}, ${s.grund})`;
      case 'arkiver-produkt': return `Arkivér produkt ${s.id} (ikke i config)`;
    }
  });
}

/** The per-run yes for live mode (invariant 2): never in .env, set on the command line for one run. */
export const LIVE_OK_NAVN = 'SKY_STRIPE_LIVE_OK';

/** Settings Stripe's API does not expose; changing them is a change to Henrik's account (his yes, per setting). */
export const IKKE_LAESBARE = [
  'Vilkår-URL i Checkout (offentlige vilkår)',
  'Kunde-e-mails (kvitteringer, mislykkede betalinger)',
  'Smart Retries',
  'Annullér abonnement, når alle forsøg er mislykkedes',
  'Momsregistrering (først med KC-0194)',
] as const;

export type OpsaetKoersel = {
  argv: string[];
  env: Record<string, string | undefined>;
  skriv: (linje: string) => void;
  lavKlient: (noegle: string) => BetalingsKlient;
  priser?: Priser;
};

/** `npm run stripe:opsaet [-- --anvend]`. Returns the exit code. Everything that can be refused is
 *  refused before the first Stripe write (fail closed, AGENTS §0 r7); output carries names, ids and
 *  amounts only, and any key in an error text is masked. */
export async function koerOpsaet(k: OpsaetKoersel): Promise<number> {
  const noegle = k.env[NOEGLE_NAVN];
  const skjul = (t: string): string => skjulNoegler(noegle && noegle.length > 3 ? t.split(noegle).join('[skjult]') : t);
  try {
    const ukendte = k.argv.filter((a) => a !== '--anvend');
    if (ukendte.length) throw new Error(`ukendt argument: ${ukendte.join(' ')} (kun --anvend findes)`);
    const anvendNu = k.argv.includes('--anvend');
    const priser = k.priser ?? laesPriser();
    const tilstand = tilstandFraNoegle(noegle);
    if (anvendNu && tilstand === 'live') {
      if (priser.status !== 'godkendt') throw new Error('live-tilstand afvist: priserne i config/priser.json har status "udkast" — Henrik skal sige ja først (KC-0169)');
      if (k.env[LIVE_OK_NAVN] !== 'ja') throw new Error(`live-tilstand afvist: sæt ${LIVE_OK_NAVN}=ja for netop denne kørsel, efter Henriks ja i chatten`);
    }
    const klient = k.lavKlient(noegle!);
    if (klient.tilstand !== tilstand) throw new Error(`klienten er i ${klient.tilstand}-tilstand, men nøglen er en ${tilstand}-nøgle`);

    k.skriv(`Stripe-opsætning — ${tilstand}-tilstand, ${anvendNu ? 'anvender ændringer' : 'tør kørsel'}; prisfilen har status "${priser.status}"`);
    const plan = await planlaeg(priser, klient);
    for (const l of beskriv(plan.skridt)) k.skriv(`  ${l}`);
    k.skriv(`${plan.skridt.length} ændringer, ${plan.uaendrede} uændrede`);

    if (anvendNu && plan.skridt.length) {
      await anvend(plan.skridt, klient);
      const efter = await planlaeg(priser, klient);
      if (efter.skridt.length) throw new Error(`Stripe svarer ikke til prisfilen efter kørslen (${efter.skridt.length} ændringer tilbage)`);
      k.skriv('Kontrol: Stripe svarer nu til prisfilen (0 ændringer tilbage).');
    } else if (!anvendNu && plan.skridt.length) {
      k.skriv('Tør kørsel: intet er ændret. Kør "npm run stripe:opsaet -- --anvend" for at anvende.');
    }

    const mangler = await klient.kontoMangler();
    k.skriv('Indstillinger i Stripe-kontoen, som opsætningen ikke sætter (Henriks ja pr. indstilling):');
    if (mangler === null) k.skriv('  Nøglen kan ikke læse kontoens firmaoplysninger — tjek dem i Dashboard.');
    else k.skriv(mangler.length ? `  Ikke udfyldt: ${mangler.join(', ')}` : '  Firmaoplysningerne er udfyldt.');
    k.skriv(`  Kan ikke læses via API'et, tjek i Dashboard: ${IKKE_LAESBARE.join('; ')}`);
    return 0;
  } catch (e) {
    k.skriv(`Fejl: ${skjul(e instanceof Error ? e.message : String(e))}`);
    k.skriv('Ingen halv tilstand, som en ny kørsel ikke retter: kør igen, når fejlen er løst.');
    return 1;
  }
}
