// KC-0193: the scenario runner both layers share. A layer (Verden) supplies a timeline per scenario: a
// BetalingsKlient that Sky reads through, a clock, and Stripe's side of each action; everything else is Sky's
// own code — the account, sikrKunde, byggCheckout (KC-0191), opsig (KC-0209), planlaeg/anvend (KC-0190) and
// every event through modtagWebhook (KC-0192), signed with a run-local secret. After each step the runner
// reads the entitlement row and the outbox and fails with the step, the expected and the actual state.
import { randomBytes } from 'node:crypto';
import type Stripe from 'stripe';
import { nyDb, antal } from '../../konto/hjaelp.ts';
import { findEllerOpretKonto } from '../../../src/konto/konto.ts';
import { sikrKunde } from '../../../src/abonnement/kunde.ts';
import { byggCheckout } from '../../../src/abonnement/checkout.ts';
import { anvend, lookupKey, planlaeg } from '../../../src/abonnement/opsaet.ts';
import { opsig } from '../../../src/abonnement/opsig.ts';
import { modtagWebhook, type WebhookDeps } from '../../../src/abonnement/webhook.ts';
import { hentRettigheder } from '../../../src/abonnement/synk.ts';
import { overGraense, type Rettighed } from '../../../src/abonnement/rettigheder.ts';
import { signerTestHaendelse } from '../../../src/abonnement/stripe-sdk.ts';
import { falskPost } from '../../../src/delt/post.ts';
import { fristGennemloeb } from '../../../src/abonnement/frist-job.ts';
import { FRIST_MAILS, type FristMail } from '../../../src/abonnement/frist.ts';
import type { Priser } from '../../../src/abonnement/priser.ts';
import type { BetalingsKlient } from '../../../src/abonnement/stripe-klient.ts';
import { beskrivHandling, type Forventning, type Scenarie, type Skridt, type TestBetalingsmiddel } from './scenarier.ts';

export const DAG_MS = 86_400_000;
/** Every "frem" goes this far past the boundary: Stripe acts once the clock is past it, not on it. */
export const MARGIN_MS = 3_600_000;

/** A raw event as Stripe would POST it: the body is signed and handed to the real handler. */
export type RaaHaendelse = { id: string; type: string; krop: string };

/** One scenario's own world: its customer, its clock, its subscription. */
export interface Tidslinje {
  readonly klient: BetalingsKlient;
  nu(): Date;
  /** Stripe's side of a completed trial Checkout built by byggCheckout. Returns the subscription id. */
  start(params: Stripe.Checkout.SessionCreateParams): Promise<string>;
  kort(kunde: string, betalingsmiddel: TestBetalingsmiddel): Promise<void>;
  frem(ms: number): Promise<void>;
  skiftPris(abonnement: string, prisId: string): Promise<void>;
  /** KC-0196: the customer's open invoices are charged again now (the Portal's "pay" once the card is fixed). */
  betal(kunde: string): Promise<void>;
  /** The customer's events since the last call, oldest first. */
  haendelser(kunde: string): Promise<RaaHaendelse[]>;
}

export interface Verden {
  readonly navn: 'falsk' | 'stripe';
  /** The run id (metadata clawco_tjek on everything a Stripe run creates). */
  readonly koersel: string;
  /** The run's price config; plan(id) maps a table plan id into it. */
  readonly priser: Priser;
  plan(id: string): string;
  /** Once before the scenarios (Stripe: the run's own products and prices). */
  forbered(): Promise<void>;
  tidslinje(scenarie: string): Promise<Tidslinje>;
  /** Removes what the run created (test clocks; the run's catalogue is archived). Lines for the output. */
  ryd(): Promise<string[]>;
}

/** The price config with every plan id prefixed: a Stripe run gets its own products and lookup keys, so it
 *  never touches the account's real catalogue (or the owner's own test data). Prefix '' is the config itself. */
export function koerselsPriser(p: Priser, prefiks: string): Priser {
  if (!prefiks) return p;
  return { ...p, planer: Object.fromEntries(Object.entries(p.planer).map(([id, plan]) => [`${prefiks}${id}`, plan])) };
}

export class ScenarieFejl extends Error {
  readonly scenarie: string;
  readonly trin: number;
  constructor(scenarie: string, trin: number, tekst: string) {
    super(`${scenarie} trin ${trin}: ${tekst}`);
    this.scenarie = scenarie;
    this.trin = trin;
  }
}

type Faktisk = { status: string; plan: string; medlemmerMax: number; skrivebeskyttet: boolean; opsiges: boolean; udbakke: number; over: boolean | null; sammePris: boolean; kunDubletter: boolean; mails: string[] };

const vis = (f: Pick<Faktisk, 'status' | 'plan' | 'medlemmerMax' | 'skrivebeskyttet' | 'opsiges' | 'udbakke'>): string =>
  `${f.status}/${f.plan} max ${f.medlemmerMax}${f.skrivebeskyttet ? ' skrivebeskyttet' : ''}${f.opsiges ? ' opsiges' : ''}, +${f.udbakke} i udbakken`;

/** Runs one scenario from scratch: its own database, account and customer. Returns one line per step. */
export async function koerScenarie(v: Verden, sc: Scenarie, skriv: (linje: string) => void = () => {}): Promise<void> {
  const t = await v.tidslinje(sc.id);
  const db = await nyDb();
  const email = `betaling-tjek+${v.koersel}-${sc.id.toLowerCase()}@example.com`;
  const { konto } = await findEllerOpretKonto(db, email, t.nu());
  const kontoId = konto.id;
  const kunde = (await sikrKunde(db, t.klient, { kontoId, email, sprog: 'da', land: 'DK', nu: t.nu() })).stripeKunde;
  const hemmelighed = `whsec_tjek${randomBytes(16).toString('hex')}`;
  const webhook: WebhookDeps = { db, klient: t.klient, priser: v.priser, hemmelighed, nu: () => t.nu(), taeller: { afvist: 0 } };
  const koeb = {
    db, klient: t.klient, priser: v.priser, post: falskPost(), publicUrl: 'https://sky.example.com', nu: () => t.nu(),
    saelger: () => 'Sælger Eksempel', vilkaar: { version: 'tjek', url: () => 'https://sky.example.com/vilkaar' },
    kontakt: async () => ({ email, sprog: 'da' as const }),
  };
  const maxFor = (plan: string): number => (plan === 'ingen' ? 0 : v.priser.planer[v.plan(plan)]!.medlemmer);

  let abonnement: string | null = null;
  let startPris: string | null = null;
  const leveret: RaaHaendelse[] = [];
  let holdt: RaaHaendelse[] = [];
  const nuvaerende = async () => (await t.klient.listAbonnementer(kunde)).find((a) => a.id === abonnement) ?? null;

  for (const [i, s] of sc.skridt.entries()) {
    const trin = i + 1;
    const foer = await antal(db, 'abonnement.rettigheds_haendelser');
    const mailsFoer = koeb.post.udbakke.length;
    const behoever = (): string => {
      if (!abonnement) throw new ScenarieFejl(sc.id, trin, `${s.goer} kræver et abonnement (start først)`);
      return abonnement;
    };
    switch (s.goer) {
      case 'start': {
        const pris = await t.klient.prisForLookupKey(lookupKey(v.plan(s.plan), 'maaned'));
        if (!pris) throw new ScenarieFejl(sc.id, trin, `ingen aktiv pris for ${s.plan}`);
        const params = byggCheckout({
          kontoId, kunde, plan: v.plan(s.plan), interval: 'maaned', land: 'DK', sprog: 'da', valuta: 'dkk', skat: null, prisId: pris.id, proeve: true,
          publicUrl: koeb.publicUrl, juridisk: { vilkaarUrl: null, privatlivUrl: null, fortrydelsesTekst: null }, tilstand: t.klient.tilstand,
        }, v.priser);
        abonnement = await t.start(params);
        startPris = pris.id;
        break;
      }
      case 'kort': await t.kort(kunde, s.betalingsmiddel); break;
      case 'frem': await t.frem(s.dage * DAG_MS + MARGIN_MS); break;
      case 'skift': {
        const pris = await t.klient.prisForLookupKey(lookupKey(v.plan(s.plan), 'maaned'));
        if (!pris) throw new ScenarieFejl(sc.id, trin, `ingen aktiv pris for ${s.plan}`);
        await t.skiftPris(behoever(), pris.id);
        break;
      }
      case 'opsig': {
        behoever();
        const u = await opsig(koeb, { kontoId, email, sprog: 'da' });
        if (u.udfald !== 'opsagt') throw new ScenarieFejl(sc.id, trin, `opsig svarede ${u.udfald}, ikke opsagt`);
        break;
      }
      case 'ny-pris': {
        const id = v.plan(s.plan);
        const plan = v.priser.planer[id]!;
        const ny: Priser = { ...v.priser, planer: { ...v.priser.planer, [id]: { ...plan, maanedlig: { ...plan.maanedlig, dkk: plan.maanedlig.dkk + s.tillaegOere } } } };
        await anvend((await planlaeg(ny, t.klient)).skridt, t.klient);
        break;
      }
      case 'gentag': break;
      case 'betal': behoever(); await t.betal(kunde); break;
    }

    let nye = s.goer === 'gentag' ? [...leveret].reverse() : [...holdt, ...(await t.haendelser(kunde))];
    if (s.goer !== 'gentag') holdt = [];
    if (s.levering === 'hold') { holdt = nye; nye = []; }
    const runde = s.levering === 'omvendt-to-gange' ? [...nye].reverse().flatMap((h) => [h, h]) : nye;
    const svar: string[] = [];
    const log: string[] = [];
    const gemt = { log: console.log, error: console.error };
    console.log = (...a: unknown[]) => { log.push(a.map(String).join(' ')); };
    console.error = console.log;
    try {
      for (const h of runde) {
        const r = await modtagWebhook(webhook, Buffer.from(h.krop), signerTestHaendelse(h.krop, hemmelighed));
        if (r.status !== 200) throw new ScenarieFejl(sc.id, trin, `${h.type} gav ${r.status} ${r.svar}: ${log.slice(-2).join(' | ')}`);
        svar.push(r.svar);
      }
      // KC-0196: Sky's clock runs the grace job; here it runs once after every step.
      await fristGennemloeb(koeb);
    } finally {
      Object.assign(console, gemt);
    }
    if (s.goer !== 'gentag') leveret.push(...nye);

    const r: Rettighed = await hentRettigheder(db, kontoId, v.priser, t.nu());
    const ab = await nuvaerende();
    const faktisk: Faktisk = {
      status: r.status, plan: r.plan, medlemmerMax: r.medlemmerMax, skrivebeskyttet: r.skrivebeskyttet, opsiges: r.opsiges !== null,
      udbakke: (await antal(db, 'abonnement.rettigheds_haendelser')) - foer,
      over: s.forvent.medlemmer ? overGraense(r, s.forvent.medlemmer.antal, v.priser) !== null : null,
      sammePris: ab !== null && ab.prisId === startPris,
      kunDubletter: svar.includes('dublet') && svar.every((x) => x === 'dublet' || x === 'ignoreret'),
      mails: koeb.post.udbakke.slice(mailsFoer).map((b) => b.skabelon).filter((m) => (FRIST_MAILS as readonly string[]).includes(m)),
    };
    const fejl = afvigelser(s.forvent, faktisk, v.plan, maxFor);
    const linje = `${sc.id} trin ${trin} ${beskrivHandling(s)}${s.levering && s.levering !== 'normal' ? ` [${s.levering}]` : ''}: ${runde.length} hændelser → ${vis(faktisk)}`;
    if (fejl.length) {
      const advarsler = log.filter((l) => l.includes('ADVARSEL'));
      throw new ScenarieFejl(sc.id, trin, `${beskrivHandling(s)}: ${fejl.join('; ')}${advarsler.length ? ` (${advarsler.join(' | ')})` : ''}`);
    }
    skriv(`${linje} ✓`);
  }
}

function afvigelser(f: Forventning, a: Faktisk, plan: (id: string) => string, maxFor: (plan: string) => number): string[] {
  const forventet = { status: f.status, plan: f.plan === 'ingen' ? 'ingen' : plan(f.plan), medlemmerMax: maxFor(f.plan), skrivebeskyttet: f.skrivebeskyttet, opsiges: f.opsiges, udbakke: f.udbakke };
  const ud: string[] = [];
  if (forventet.status !== a.status || forventet.plan !== a.plan || forventet.medlemmerMax !== a.medlemmerMax || forventet.skrivebeskyttet !== a.skrivebeskyttet || forventet.opsiges !== a.opsiges || forventet.udbakke !== a.udbakke) {
    ud.push(`forventet ${vis(forventet)}, fik ${vis(a)}`);
  }
  if (f.medlemmer && a.over !== f.medlemmer.over) ud.push(`med ${f.medlemmer.antal} medlemmer forventet ${f.medlemmer.over ? 'over' : 'inden for'} grænsen, fik det modsatte`);
  if (f.sammePris && !a.sammePris) ud.push('abonnementet betaler ikke længere den pris, det startede på');
  if (f.kunDubletter && !a.kunDubletter) ud.push('forventet at hver levering var en dublet');
  const mails: FristMail[] = f.mails ?? [];
  if (mails.join() !== a.mails.join()) ud.push(`forventet fristmails [${mails.join(', ')}], fik [${a.mails.join(', ')}]`);
  return ud;
}

export type Resultat = { id: string; ok: boolean; fejl: string | null };

/** Every scenario in order; one failing scenario does not stop the next (the output shows the whole table). */
export async function koerAlle(v: Verden, scenarier: readonly Scenarie[], skriv: (linje: string) => void): Promise<Resultat[]> {
  const ud: Resultat[] = [];
  for (const sc of scenarier) {
    try {
      await koerScenarie(v, sc, skriv);
      ud.push({ id: sc.id, ok: true, fejl: null });
      skriv(`${sc.id} grøn: ${sc.navn}`);
    } catch (e) {
      const besked = e instanceof Error ? e.message : String(e);
      ud.push({ id: sc.id, ok: false, fejl: besked });
      skriv(`${sc.id} RØD: ${besked}`);
    }
  }
  return ud;
}

/** The steps a dry run shows (no network). */
export function beskrivSkridt(s: Skridt): string {
  const f = s.forvent;
  return `${beskrivHandling(s)}${s.levering && s.levering !== 'normal' ? ` [${s.levering}]` : ''} → ${f.status}/${f.plan}${f.skrivebeskyttet ? ' skrivebeskyttet' : ''}${f.opsiges ? ' opsiges' : ''}, +${f.udbakke} i udbakken${f.mails?.length ? `, mail: ${f.mails.join(', ')}` : ''}`;
}
