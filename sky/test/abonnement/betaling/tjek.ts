// `npm run betaling:tjek [-- --dry-run]` (KC-0193): the scenario table against Stripe's test mode with test clocks.
// Wiring is scripts/betaling-tjek.mjs; the logic is here so it is tested. Invariants: only a test key runs (a
// live or unknown key exits 1 before anything is built); the key comes from KC_STRIPE_SECRET_KEY only and is
// never printed; the run's test clocks are deleted at the end and on failure; --dry-run prints the plan with no
// network. Output: one line per step, counts, ids truncated.
import { randomBytes } from 'node:crypto';
import { StripeBetalingsKlient } from '../../../src/abonnement/stripe-sdk.ts';
import { skjulNoegler } from '../../../src/abonnement/stripe-klient.ts';
import { SCENARIER, UDESTAAENDE, type Scenarie } from './scenarier.ts';
import { beskrivSkridt, koerAlle, type Verden } from './koer.ts';
import { stripeTestureApi, stripeVerden, tjekUre, TJEK_NOEGLE, urNavn, type TestureApi } from './stripe-verden.ts';

export const NOEGLE_NAVN = 'KC_STRIPE_SECRET_KEY';

/** Test mode only: a standard or restricted test key. Anything else (live, publishable, malformed) is refused. */
export const erTestNoegle = (n: string): boolean => /^(sk|rk)_test_[A-Za-z0-9]+$/.test(n);

/** A run id: sortable, short, [a-z0-9-] (it goes into product ids, lookup keys and clock names). */
export function nyKoersel(nu: Date = new Date()): string {
  return `${nu.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', 't')}-${randomBytes(3).toString('hex')}`;
}

/** What a run does, without doing it (the dry run's output; also the list both layers must agree on). */
export function planTekst(koersel: string, scenarier: readonly Scenarie[] = SCENARIER): string[] {
  const ud = [
    `Betalingstjek, kørsel ${koersel} — Stripes testtilstand med testure (tør kørsel: intet sendes)`,
    `Opretter: kørslens egne produkter og priser (clawco-tjek-${koersel}-…), ét testur pr. scenarie (navn "${urNavn(koersel, 'S…')}"), kunde og abonnement på uret; alt med metadata ${TJEK_NOEGLE}=${koersel}`,
  ];
  for (const sc of scenarier) {
    ud.push(`${sc.id} ${sc.navn}`);
    for (const [i, s] of sc.skridt.entries()) ud.push(`  ${i + 1}. ${beskrivSkridt(s)}`);
  }
  for (const [id, hvem] of Object.entries(UDESTAAENDE)) ud.push(`(${id} kommer med ${hvem})`);
  ud.push('Rydder op: sletter kørslens testure (kunder og abonnementer følger med) og arkiverer kørslens katalog — også når et trin fejler');
  return ud;
}

export type TjekKoersel = {
  argv: string[];
  env: Record<string, string | undefined>;
  skriv: (linje: string) => void;
  /** Tests inject the Stripe side; default: the SDK over the key. */
  lavStripe?: (noegle: string) => { api: TestureApi; verden: (koersel: string) => Verden };
  koersel?: string;
  ur?: () => number;
};

function standardStripe(noegle: string): { api: TestureApi; verden: (koersel: string) => Verden } {
  const api = stripeTestureApi(noegle);
  const indre = new StripeBetalingsKlient(noegle);
  return { api, verden: (koersel) => stripeVerden({ api, indre, koersel }) };
}

/** Returns the exit code. */
export async function koerBetalingsTjek(k: TjekKoersel): Promise<number> {
  const noegle = (k.env[NOEGLE_NAVN] ?? '').trim();
  const skjul = (t: string): string => skjulNoegler(noegle.length > 3 ? t.split(noegle).join('[skjult]') : t);
  const ukendte = k.argv.filter((a) => a !== '--dry-run');
  if (ukendte.length) { k.skriv(`Fejl: ukendt argument (kun --dry-run findes)`); return 1; }
  const tor = k.argv.includes('--dry-run');
  if (noegle && !erTestNoegle(noegle)) {
    k.skriv(`Afvist: ${NOEGLE_NAVN} er ikke en testnøgle (sk_test_ eller rk_test_). Betalingstjekket rører aldrig rigtige penge.`);
    return 1;
  }
  const koersel = k.koersel ?? nyKoersel();
  if (tor) { for (const l of planTekst(koersel)) k.skriv(l); return 0; }
  if (!noegle) { k.skriv(`Fejl: ${NOEGLE_NAVN} mangler (en Stripe-testnøgle, sk_test_ eller rk_test_)`); return 1; }

  const ur = k.ur ?? (() => Date.now());
  const start = ur();
  let kode = 0;
  let stripe: { api: TestureApi; verden: (koersel: string) => Verden };
  let verden: Verden;
  try {
    stripe = (k.lavStripe ?? standardStripe)(noegle);
    verden = stripe.verden(koersel);
  } catch (e) {
    k.skriv(`Fejl: ${skjul((e as Error).message)}`);
    return 1;
  }
  k.skriv(`Betalingstjek, kørsel ${koersel} — Stripes testtilstand med testure`);
  let foer: number | null = null;
  try {
    foer = await tjekUre(stripe.api);
    k.skriv(`Testure fra tidligere tjek før kørslen: ${foer}`);
    await verden.forbered();
    const r = await koerAlle(verden, SCENARIER, (l) => k.skriv(skjul(l)));
    const groenne = r.filter((x) => x.ok).length;
    k.skriv(`${groenne} af ${r.length} scenarier grønne (${r.map((x) => `${x.id} ${x.ok ? 'grøn' : 'RØD'}`).join(', ')})`);
    if (groenne !== r.length) kode = 1;
  } catch (e) {
    k.skriv(`Fejl: ${skjul((e as Error).message)}`);
    kode = 1;
  } finally {
    try {
      for (const l of await verden.ryd()) k.skriv(l);
      const efter = await tjekUre(stripe.api);
      k.skriv(`Testure fra tjek efter oprydning: ${efter}${foer !== null ? ` (før: ${foer})` : ''}`);
      if (foer !== null && efter > foer) { k.skriv('Fejl: der er flere tjek-testure end før kørslen'); kode = 1; }
    } catch (e) {
      k.skriv(`Fejl: ${skjul((e as Error).message)}`);
      kode = 1;
    }
  }
  k.skriv(`Kørsel ${koersel}: ${kode === 0 ? 'grøn' : 'RØD'} på ${Math.round((ur() - start) / 1000)} s`);
  return kode;
}
