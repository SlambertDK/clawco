// The subscription routes (KC-0191, KC-0192). Thin: parse, check, call, render. Billing never imports
// konto/: the login (with Origin + CSRF) and the household role arrive as seams wired in server.ts.
// Checkout only ever starts a Stripe page; nothing is charged until a person presses Stripe's button,
// and the entitlement is written by the webhook alone (never by the way back from Stripe).
import { createHash } from 'node:crypto';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Database } from '../db/pool.ts';
import type { Post } from '../delt/post.ts';
import type { Priser } from './priser.ts';
import type { BetalingsKlient, StripeHaendelse } from './stripe-klient.ts';
import { skjulNoegler } from './stripe-klient.ts';
import { lookupKey, type IntervalNavn } from './opsaet.ts';
import { byggCheckout, type Juridisk } from './checkout.ts';
import { erLand } from './lande.ts';
import { hentKundeRaekke, kontoensCheckout, saetAabenCheckout, sikrKunde } from './kunde.ts';
import { hentRettigheder } from './synk.ts';
import { overGraense } from './rettigheder.ts';
import { modtagWebhook, type WebhookDeps } from './webhook.ts';
import { beskedSide, ejerSide, planSide, statusSide, type Valg } from './render.ts';
import { T } from './tekster.ts';
import { F } from './forbrugerret-tekster.ts';
import { planPris, samtykkerGivet, type Sprog } from './forbrugerret.ts';
import { bekraeftSide, besked, fortrudtAlleredeSide, fortrudtSide, fortrydIntetSide, fortrydSide, fortrydUdloebetSide, intetAtOpsigeSide, opsagtAlleredeSide, opsagtSide, opsigSide } from './forbrugerret-render.ts';
import { efterKoeb, type Kontakt, type KoebDeps } from './kvittering.ts';
import { opretBestilling } from './bestilling.ts';
import { opsig, opsigOversigt } from './opsig.ts';
import { fortryd, fortrydOversigt } from './fortryd.ts';
import { kontoHandlinger } from './handlinger.ts';
import { fristForKonto } from './frist-job.ts';

/** The logged-in person, as konto's session sees it. */
export type Indlogget = { kontoId: number; email: string; sprog: 'da' | 'en'; csrf: string };

export type Adgang = {
  login(c: Context): Promise<Indlogget | null>;
  /** Logged in, our Origin, and the session's CSRF token (konto's gate for state-changing POSTs). */
  beskyttet(c: Context, csrf: unknown): Promise<Indlogget | null>;
};

export type AbonnementDeps = {
  db: Database;
  /** null when SKY_STRIPE_SECRET_KEY is unset (and not in development): every billing route is 503. */
  klient: BetalingsKlient | null;
  priser: Priser;
  publicUrl: string;
  juridisk: Juridisk;
  webhookHemmelighed: string | null;
  adgang: Adgang;
  /** The account's household place (KC-0154/KC-0184); null = no household, the account is its own owner. */
  husstand: (kontoId: number) => Promise<{ rolle: 'ejer' | 'medlem'; antal: number } | null>;
  /** KC-0220: may this account choose a plan now? Only where the sign-up flow shows its plan step (open sign-up and
   *  the profile with the current consents); otherwise the plan page and Checkout send it to /tilmeld. Required, so
   *  no wiring can leave the gate open. */
  tilPlan: (kontoId: number) => Promise<boolean>;
  /** KC-0209 (consumer rights), all wired in server.ts so billing imports neither konto/ nor the legal texts' reader:
   *  the mail seam (receipts, cancellation, withdrawal), the seller's identity read from the terms (delt/saelger.ts),
   *  the current terms (the version a purchase records and its public address), and the account's address and language. */
  post: Post;
  saelger: (sprog: Sprog) => string;
  vilkaar: { version: string; url: (sprog: Sprog) => string };
  kontakt: (kontoId: number) => Promise<Kontakt | null>;
  nu?: () => Date;
  taeller?: { afvist: number };
  verificer?: (raw: Uint8Array, signatur: string, hemmelighed: string) => StripeHaendelse;
};

/** Live states: such an account goes to the Portal, never to a second Checkout. */
const LEVENDE = new Set(['trialing', 'active', 'past_due', 'unpaid', 'paused']);
const VISES = new Set(['proeve', 'aktiv', 'forfalden', 'pause']);
/** Double clicks and two tabs within this window reuse one Checkout Session (Stripe idempotency). */
const VINDUE_MS = 10 * 60_000;
const SESSION_ID = /^cs_[A-Za-z0-9_]{1,200}$/;
const CSP = "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://checkout.stripe.com https://billing.stripe.com; object-src 'none'";

/** What the receipt, "Opsig", "Fortryd aftale" and the reminder need, from billing's own deps. */
export function koebDeps(d: AbonnementDeps): KoebDeps {
  return { db: d.db, klient: d.klient, priser: d.priser, post: d.post, publicUrl: d.publicUrl, nu: d.nu ?? (() => new Date()), saelger: d.saelger, vilkaar: d.vilkaar, kontakt: d.kontakt };
}

export function webhookDeps(d: AbonnementDeps): WebhookDeps {
  const w: WebhookDeps = {
    db: d.db, klient: d.klient, priser: d.priser, hemmelighed: d.webhookHemmelighed, nu: d.nu ?? (() => new Date()), taeller: d.taeller ?? { afvist: 0 },
    // KC-0209: when a purchase has gone through, tie it to its order and send the receipt. KC-0196: then the mail the
    // account's grace stage owes (a failed payment's first mail goes out within the webhook's round trip).
    efter: async (kontoId) => {
      const k = koebDeps(d);
      try { await efterKoeb(k, kontoId); } finally { await fristForKonto(k, kontoId); }
    },
  };
  if (d.verificer) w.verificer = d.verificer;
  return w;
}

/** Billing's response headers. Registered per path, never on '*': app.route() would carry a '*'
 *  middleware onto konto's pages and widen their form-action. */
export const sikkerhedsHoveder: MiddlewareHandler = async (c, next) => {
  await next();
  // form-action must allow the 303 to Stripe's pages: Chrome applies it to a form POST's redirect.
  c.header('Content-Security-Policy', CSP);
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Content-Type-Options', 'nosniff');
  if (!c.res.headers.get('cache-control')) c.header('Cache-Control', 'no-store');
};

export function abonnementRuter(d: AbonnementDeps): Hono {
  const app = new Hono();
  const nu = d.nu ?? (() => new Date());
  const webhook = webhookDeps(d);

  app.use('/konto/abonnement', sikkerhedsHoveder);
  app.use('/konto/abonnement/*', sikkerhedsHoveder);
  app.use('/api/abonnement/*', sikkerhedsHoveder);

  const formular = async (c: Context): Promise<Record<string, unknown>> => (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>;
  const smaa = bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.text('For stor', 413) });
  const ikkeKlar = (c: Context) => c.html(beskedSide(T.ikkeKlarTitel, T.ikkeKlarTekst), 503);
  const fejl = (c: Context, err: unknown) => {
    console.error(`sky abonnement: Stripe-kald fejlede: ${skjulNoegler((err as Error).message)}`);
    return c.html(beskedSide(T.fejlTitel, T.fejlTekst, { href: '/konto/abonnement', tekst: T.vaelgPlan }), 502);
  };

  const valg = (v: Record<string, unknown>): Valg => {
    const plan = typeof v['plan'] === 'string' && Object.hasOwn(d.priser.planer, v['plan']) ? v['plan'] : null;
    const interval = v['interval'] === 'maaned' || v['interval'] === 'aar' ? v['interval'] as IntervalNavn : null;
    const land = erLand(v['land']) ? v['land'] : null;
    return { plan, interval, land };
  };

  async function harProeve(kontoId: number, alle: { proeveStart: Date | null }[]): Promise<boolean> {
    const k = await hentKundeRaekke(d.db, kontoId);
    return !(k?.proeveBrugt ?? false) && !alle.some((a) => a.proeveStart !== null);
  }

  // --- The plan page, or the subscription's status ----------------------------------------------
  app.get('/konto/abonnement', async (c) => {
    const l = await d.adgang.login(c);
    if (!l) return c.redirect('/log-ind?til=/konto/abonnement', 303);
    const h = await d.husstand(l.kontoId);
    if (h?.rolle === 'medlem') return c.html(ejerSide(), 403);
    const r = await hentRettigheder(d.db, l.kontoId, d.priser, nu());
    if (VISES.has(r.status) || r.kilde === 'gave') {
      const kunde = await hentKundeRaekke(d.db, l.kontoId);
      return c.html(statusSide({ csrf: l.csrf, rettighed: r, priser: d.priser, overGraense: overGraense(r, h?.antal ?? 1, d.priser), portal: kunde !== null && d.klient !== null, handlinger: await kontoHandlinger(d.db, l.kontoId, r, nu()) }));
    }
    if (!(await d.tilPlan(l.kontoId))) return c.redirect('/tilmeld', 303);
    const kunde = await hentKundeRaekke(d.db, l.kontoId);
    const q = valg(c.req.query());
    return c.html(planSide({
      csrf: l.csrf, priser: d.priser, valg: { ...q, land: q.land ?? kunde?.land ?? null },
      proeve: !(kunde?.proeveBrugt ?? false), afbrudt: c.req.query('afbrudt') === '1',
    }));
  });

  // --- The statement before the pay button (KC-0209) ---------------------------------------------
  /** The statement for a valid choice. `proeve`: whether the account would get the trial (what the page then promises). */
  function bekraeftHtml(l: Indlogget, v: { plan: string; interval: IntervalNavn; land: string }, retur: 'konto' | 'tilmelding', proeve: boolean, fejl?: 'mangler' | 'aendret'): string {
    const plan = d.priser.planer[v.plan]!;
    const q = new URLSearchParams(retur === 'tilmelding' ? { plan: v.plan, interval: v.interval } : { plan: v.plan, interval: v.interval, land: v.land });
    return bekraeftSide({
      sprog: l.sprog, csrf: l.csrf, plan: { id: v.plan, navn: plan.navn, medlemmer: plan.medlemmer }, interval: v.interval, land: v.land,
      prisOere: planPris(d.priser, v.plan, v.interval)!, proeve, proeveDage: d.priser.proeve.dage, vilkaar: { version: d.vilkaar.version, url: d.vilkaar.url(l.sprog) },
      retur, tilbage: `${retur === 'tilmelding' ? '/tilmeld' : '/konto/abonnement'}?${q.toString()}`, ...(fejl ? { fejl } : {}),
    });
  }
  const faarProeve = (kunde: { proeveBrugt: boolean } | null): boolean => !(kunde?.proeveBrugt ?? false) && d.priser.proeve.dage > 0;

  app.get('/konto/abonnement/bekraeft', async (c) => {
    const l = await d.adgang.login(c);
    if (!l) return c.redirect('/log-ind?til=/konto/abonnement', 303);
    if ((await d.husstand(l.kontoId))?.rolle === 'medlem') return c.html(ejerSide(), 403);
    const r = await hentRettigheder(d.db, l.kontoId, d.priser, nu());
    if (VISES.has(r.status) || r.kilde === 'gave') return c.redirect('/konto/abonnement', 303);
    if (!(await d.tilPlan(l.kontoId))) return c.redirect('/tilmeld', 303);
    const v = valg(c.req.query());
    if (!v.plan || !v.interval || !v.land) return c.redirect('/konto/abonnement', 303);
    const kunde = await hentKundeRaekke(d.db, l.kontoId);
    return c.html(bekraeftHtml(l, { plan: v.plan, interval: v.interval, land: v.land }, c.req.query('retur') === 'tilmelding' ? 'tilmelding' : 'konto', faarProeve(kunde)));
  });

  // --- Checkout ---------------------------------------------------------------------------------
  app.post('/api/abonnement/checkout', smaa, async (c) => {
    const f = await formular(c);
    const l = await d.adgang.beskyttet(c, f['csrf']);
    if (!l) return c.text('Forbudt', 403);
    if (!d.klient) return ikkeKlar(c);
    const klient = d.klient;
    if ((await d.husstand(l.kontoId))?.rolle === 'medlem') return c.html(ejerSide(), 403);
    if (!(await d.tilPlan(l.kontoId))) return c.redirect('/tilmeld', 303);
    const v = valg(f);
    if (!v.plan || !v.interval || !v.land) {
      const kunde = await hentKundeRaekke(d.db, l.kontoId);
      return c.html(planSide({ csrf: l.csrf, priser: d.priser, valg: v, proeve: !(kunde?.proeveBrugt ?? false), afbrudt: false, fejl: T.ugyldigtValg }), 400);
    }
    const { plan, interval, land } = v as { plan: string; interval: IntervalNavn; land: string };
    const retur = f['retur'] === 'tilmelding' ? 'tilmelding' : 'konto';
    const prisOere = planPris(d.priser, plan, interval)!;
    // KC-0209: nothing happens without both boxes (the terms at their current version, and the immediate start with the
    // loss of the withdrawal right explained). Checked first, before anything is read from or written to Stripe.
    if (!samtykkerGivet(f, d.vilkaar.version)) {
      return c.html(bekraeftHtml(l, { plan, interval, land }, retur, faarProeve(await hentKundeRaekke(d.db, l.kontoId)), 'mangler'), 400);
    }
    try {
      const fandtes = await hentKundeRaekke(d.db, l.kontoId);
      const alle = fandtes ? await klient.listAbonnementer(fandtes.stripeKunde) : [];
      if (fandtes && alle.some((a) => LEVENDE.has(a.status))) {
        const p = await klient.opretPortal(fandtes.stripeKunde, new URL('/konto/abonnement', d.publicUrl).href);
        return c.redirect(p.url, 303);
      }
      const pris = await klient.prisForLookupKey(lookupKey(plan, interval));
      if (!pris) {
        console.error(`sky abonnement: ingen aktiv pris med lookup key ${lookupKey(plan, interval)} i Stripe — kør npm run stripe:opsaet`);
        return ikkeKlar(c);
      }
      // The price Stripe will charge is the price the statement showed (both from the one price file); never charge what was not shown.
      if (pris.dkk !== prisOere) {
        console.error(`sky abonnement: Stripe-prisen ${lookupKey(plan, interval)} er ${pris.dkk} øre, men config/priser.json siger ${prisOere}: Checkout afvist — kør npm run stripe:opsaet`);
        return ikkeKlar(c);
      }
      const proeve = await harProeve(l.kontoId, alle);
      const proeveAktiv = proeve && d.priser.proeve.dage > 0;
      // What the page said is what happens: a price or a trial that changed since the page was shown is shown again.
      if ((typeof f['pris'] === 'string' && f['pris'] !== String(prisOere)) || (typeof f['proeve'] === 'string' && f['proeve'] !== (proeveAktiv ? '1' : '0'))) {
        return c.html(bekraeftHtml(l, { plan, interval, land }, retur, proeveAktiv, 'aendret'), 409);
      }
      // Built before the customer exists, so a refusal (live mode without terms) creates nothing in Stripe.
      let params;
      try {
        params = byggCheckout({
          kontoId: l.kontoId, kunde: '', plan, interval, land, sprog: l.sprog, valuta: 'dkk', skat: null,
          prisId: pris.id, proeve, publicUrl: d.publicUrl, juridisk: d.juridisk, tilstand: klient.tilstand,
          retur,
        }, d.priser);
      } catch (err) {
        console.error(`sky abonnement: Checkout afvist: ${(err as Error).message}`);
        return ikkeKlar(c);
      }
      const kunde = await sikrKunde(d.db, klient, { kontoId: l.kontoId, email: l.email, sprog: l.sprog, land, nu: nu() });
      params.customer = kunde.stripeKunde;
      const vindue = Math.floor(nu().getTime() / VINDUE_MS);
      const idem = `clawco-checkout-${createHash('sha256').update([l.kontoId, plan, interval, land, proeve, vindue].join('|')).digest('hex').slice(0, 40)}`;
      const session = await klient.opretCheckout(params, idem);
      if (kunde.aabenCheckout && kunde.aabenCheckout !== session.id) {
        await klient.udloebCheckout(kunde.aabenCheckout).catch(() => { /* already complete or expired */ });
      }
      await saetAabenCheckout(d.db, l.kontoId, session.id);
      // The order: the price shown, the terms version and when both boxes were ticked (the session id makes a double click one order).
      await opretBestilling(d.db, { kontoId: l.kontoId, checkoutSession: session.id, plan, interval, prisOere, proeve: proeveAktiv, vilkaarVersion: d.vilkaar.version, sprog: l.sprog, nu: nu() });
      if (!session.url) throw new Error(`Checkout Session ${session.id} har ingen url`);
      return c.redirect(session.url, 303);
    } catch (err) {
      return fejl(c, err);
    }
  });

  // --- Back from Stripe ---------------------------------------------------------------------------
  app.get('/api/abonnement/tilbage', async (c) => {
    const l = await d.adgang.login(c);
    if (!l) return c.redirect('/log-ind?til=/konto/abonnement', 303);
    if (!d.klient) return ikkeKlar(c);
    const ukendt = () => c.html(beskedSide(T.ukendtTitel, T.ukendtTekst), 404);
    const id = c.req.query('session') ?? '';
    if (!SESSION_ID.test(id)) return ukendt();
    let s;
    // Never trust the query string: the session must be this account's, by customer and by reference.
    try { s = await kontoensCheckout(d.db, d.klient, l.kontoId, id); } catch (err) { return fejl(c, err); }
    if (!s) return ukendt();
    const vaelg = { href: '/konto/abonnement', tekst: T.vaelgPlan };
    if (s.status !== 'complete') return c.html(beskedSide(T.tilbageAabenTitel, T.tilbageAabenTekst, vaelg));
    // Provisioning (KC-0198) takes over from here; the entitlement arrives by webhook.
    if (s.abonnement?.status === 'trialing') return c.html(beskedSide(T.tilbageProeveTitel, T.tilbageProeveTekst(s.abonnement.proeveSlut?.toISOString() ?? null)));
    return c.html(beskedSide(T.tilbageAktivTitel, T.tilbageAktivTekst));
  });

  // --- Opsig and Fortryd aftale (KC-0209): one confirmation each, reachable from the account page ----------
  const koeb = koebDeps(d);
  /** Both pages are the owner's; a logged-out person is sent to log in and lands back on the subscription page. */
  async function ejer(c: Context): Promise<{ l: Indlogget } | { svar: Response }> {
    const l = await d.adgang.login(c);
    if (!l) return { svar: c.redirect('/log-ind?til=/konto/abonnement', 303) };
    if ((await d.husstand(l.kontoId))?.rolle === 'medlem') return { svar: c.html(ejerSide(), 403) };
    return { l };
  }
  const stripeFejl = (c: Context, sprog: Sprog, titel: string, tekst: string, err: unknown) => {
    console.error(`sky abonnement: ${titel} fejlede: ${skjulNoegler((err as Error).message)}`);
    return c.html(besked(sprog, titel, tekst, { fejl: true }), 502);
  };

  app.get('/konto/abonnement/opsig', async (c) => {
    const e = await ejer(c);
    if ('svar' in e) return e.svar;
    try {
      const o = await opsigOversigt(koeb, e.l.kontoId);
      if (o.art === 'intet') return c.html(intetAtOpsigeSide(e.l.sprog));
      return c.html(o.art === 'allerede' ? opsagtAlleredeSide(e.l.sprog, o.slutter) : opsigSide({ sprog: e.l.sprog, csrf: e.l.csrf, slutter: o.slutter }));
    } catch (err) { return stripeFejl(c, e.l.sprog, F[e.l.sprog].opsigTitel, F[e.l.sprog].opsigFejl, err); }
  });

  app.post('/api/abonnement/opsig', smaa, async (c) => {
    const l = await d.adgang.beskyttet(c, (await formular(c))['csrf']);
    if (!l) return c.text('Forbudt', 403);
    if ((await d.husstand(l.kontoId))?.rolle === 'medlem') return c.html(ejerSide(), 403);
    try {
      const r = await opsig(koeb, { kontoId: l.kontoId, email: l.email, sprog: l.sprog });
      if (r.udfald === 'intet') return c.html(intetAtOpsigeSide(l.sprog));
      return c.html(r.udfald === 'allerede' ? opsagtAlleredeSide(l.sprog, r.slutter) : opsagtSide(l.sprog, r.slutter, r.mail));
    } catch (err) { return stripeFejl(c, l.sprog, F[l.sprog].opsigTitel, F[l.sprog].opsigFejl, err); }
  });

  app.get('/konto/abonnement/fortryd', async (c) => {
    const e = await ejer(c);
    if ('svar' in e) return e.svar;
    const o = await fortrydOversigt(koeb, e.l.kontoId);
    const sprog = e.l.sprog;
    if (o.art === 'klar') return c.html(fortrydSide({ sprog, csrf: e.l.csrf, frist: o.frist, proeve: o.proeve, brugteDage: o.brugteDage, periodeDage: o.periodeDage, beholdOere: o.beholdOere, tilbageOere: o.tilbageOere }));
    if (o.art === 'udloebet') return c.html(fortrydUdloebetSide(sprog, o.frist));
    if (o.art === 'allerede') return c.html(fortrudtAlleredeSide(sprog, o.tid));
    return c.html(fortrydIntetSide(sprog));
  });

  app.post('/api/abonnement/fortryd', smaa, async (c) => {
    const l = await d.adgang.beskyttet(c, (await formular(c))['csrf']);
    if (!l) return c.text('Forbudt', 403);
    if ((await d.husstand(l.kontoId))?.rolle === 'medlem') return c.html(ejerSide(), 403);
    try {
      const r = await fortryd(koeb, { kontoId: l.kontoId, email: l.email, sprog: l.sprog });
      if (r.art === 'fortrudt') return c.html(fortrudtSide({ sprog: l.sprog, tid: r.tid, tilbageOere: r.tilbageOere, mail: r.mail }));
      if (r.art === 'allerede') return c.html(fortrudtAlleredeSide(l.sprog, r.tid));
      if (r.art === 'udloebet') return c.html(fortrydUdloebetSide(l.sprog, r.frist));
      return c.html(fortrydIntetSide(l.sprog));
    } catch (err) { return stripeFejl(c, l.sprog, F[l.sprog].fortrydSideTitel, F[l.sprog].fortrydFejl, err); }
  });

  // --- The Portal (KC-0195 configures it) -------------------------------------------------------
  app.post('/api/abonnement/portal', smaa, async (c) => {
    const l = await d.adgang.beskyttet(c, (await formular(c))['csrf']);
    if (!l) return c.text('Forbudt', 403);
    if (!d.klient) return ikkeKlar(c);
    if ((await d.husstand(l.kontoId))?.rolle === 'medlem') return c.html(ejerSide(), 403);
    const kunde = await hentKundeRaekke(d.db, l.kontoId);
    if (!kunde) return c.redirect('/konto/abonnement', 303);
    try {
      return c.redirect((await d.klient.opretPortal(kunde.stripeKunde, new URL('/konto/abonnement', d.publicUrl).href)).url, 303);
    } catch (err) {
      return fejl(c, err);
    }
  });

  // --- Stripe's webhook (no Origin, no session: the signature is the authentication) -----------
  app.post('/api/abonnement/webhook', bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.text('For stor', 413) }), async (c) => {
    const raw = new Uint8Array(await c.req.arrayBuffer());
    const r = await modtagWebhook(webhook, raw, c.req.header('stripe-signature'));
    return c.text(r.svar, r.status);
  });

  return app;
}
