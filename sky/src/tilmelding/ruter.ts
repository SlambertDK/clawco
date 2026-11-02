// The sign-up routes (KC-0198) on the account host. Thin: parse, check (Origin + CSRF on every POST), read the
// server state through seams, decide the step with trin.ts, render. tilmelding/ never imports konto/,
// abonnement/ or fleet/: login, profile, entitlement, Checkout, tenant and the fleet's retry are handed in by
// server.ts. Nothing here stores the step; every request derives it again.
import fs from 'node:fs';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { profilErKlar, samtykkeGyldigt, type Samtykke } from './samtykke.ts';
import { tilmeldingsTrin, visningsNoegle, type RettighedsStatus, type Tilstand, type Visning } from './trin.ts';
import { galleriSide, tilmeldingSide, type Faelles, type Interval, type PlanVisning, type SideInput, type Sprog } from './render.ts';
import { EKSEMPLER } from './eksempler.ts';

export type Profil = { land: string | null; sprog: Sprog | null; vilkaar: string | null; privatliv: string | null; oprettet: Date; tilmeldingMs: number | null };
/** The account's tenant as the flow needs it (the raw error is only ever a yes/no on screen). */
export type TenantVisning = { slug: string; tilstand: Tilstand; fejl: string | null; bestilt: Date; klar: Date | null };
type Indlogget = { kontoId: number; csrf: string };

export type TilmeldingDeps = {
  publicUrl: string;
  /** The public site the legal texts live on (default https://clawco.work). */
  sideUrl?: string;
  /** SKY_TILMELDING: invitation (closed beta, the default) or open. */
  tilstand: 'invitation' | 'open';
  dev: boolean;
  samtykke: Samtykke;
  /** Country codes an account can buy from (billing's list). */
  lande: readonly string[];
  /** The plans from config/priser.json, as shown. */
  planer: readonly PlanVisning[];
  /** KC-0194: billing's country → currency rule (kroner in Denmark, euro elsewhere), and config moms.aktiv. */
  valuta(land: string): 'dkk' | 'eur';
  moms: boolean;
  proeveDage: number;
  adgang: { login(c: Context): Promise<Indlogget | null>; beskyttet(c: Context, csrf: unknown): Promise<Indlogget | null> };
  profil: {
    hent(kontoId: number): Promise<Profil | null>;
    gem(kontoId: number, p: { land: string; sprog: Sprog; vilkaar: string; privatliv: string; nu: Date }): Promise<void>;
    noterTid(kontoId: number, klar: Date): Promise<void>;
  };
  rettighed(kontoId: number): Promise<{ status: RettighedsStatus; kilde: 'stripe' | 'gave' }>;
  /** False when the account has had a trial before (billing decides; the button says so). */
  harProeve(kontoId: number): Promise<boolean>;
  /** When Stripe says this Checkout Session is the account's and complete (the webhook may lag): whether it
   *  started a trial. null otherwise. */
  checkoutFuldfoert(kontoId: number, session: string): Promise<{ proeve: boolean } | null>;
  tenant(kontoId: number): Promise<TenantVisning | null>;
  /** Starts the account's provisioning now (idempotent, keyed on the account); never waits for it. */
  proevIgen(kontoId: number): Promise<void>;
  /** The way into a tenant: the gateway's /aabn with next /rum/start. */
  aabnUrl(slug: string): string;
  /** KC-0203's invitation codes; absent until they exist. */
  invitation?: (kontoId: number, kode: string) => Promise<boolean>;
  /** Where the slow-provisioning alert goes (E10's monitoring is the journal). */
  alarm?: (linje: string) => void;
  nu?: () => Date;
};

const KLIENT_JS = fs.readFileSync(new URL('../../public/tilmeld.js', import.meta.url), 'utf8');
const SESSION_ID = /^cs_[A-Za-z0-9_]{1,200}$/;
// Checkout is the only other origin a form here may lead to (the plan step's POST answers with a 303 there).
const CSP = "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://checkout.stripe.com; object-src 'none'";

const hoveder: MiddlewareHandler = async (c, next) => {
  await next();
  c.header('Content-Security-Policy', CSP);
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Content-Type-Options', 'nosniff');
  if (!c.res.headers.get('cache-control')) c.header('Cache-Control', 'no-store');
};

const erSprog = (v: unknown): v is Sprog => v === 'da' || v === 'en';

/** The page language: the account's once chosen, else ?sprog=, else the browser's first preference
 *  (Danish unless it prefers something else; no header = Danish). */
function sprogFor(c: Context, profil: Profil | null): Sprog {
  if (profil?.sprog) return profil.sprog;
  const q = c.req.query('sprog');
  if (erSprog(q)) return q;
  const foerste = (c.req.header('accept-language') ?? '').split(',')[0]?.trim().toLowerCase() ?? '';
  return !foerste || foerste.startsWith('da') ? 'da' : 'en';
}

export function tilmeldingRuter(d: TilmeldingDeps): Hono {
  const app = new Hono();
  const nu = d.nu ?? (() => new Date());
  const alarm = d.alarm ?? ((l: string) => console.error(`sky tilmelding: ${l}`));
  const meldt = new Set<string>();
  const planIder = new Set(d.planer.map((p) => p.id));

  for (const sti of ['/tilmeld', '/tilmeld/*', '/tilmeld.js', '/api/tilmelding/*', '/dev/tilmelding', '/dev/tilmelding/*']) app.use(sti, hoveder);
  const smaa = bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.text('For stor', 413) });
  const formular = async (c: Context): Promise<Record<string, unknown>> => (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>;

  /** Plan and interval from the pricing page's link (KC-0199), only when they are real. */
  const valg = (v: Record<string, unknown>): { plan: string | null; interval: Interval | null } => ({
    plan: typeof v['plan'] === 'string' && planIder.has(v['plan']) ? v['plan'] : null,
    interval: v['interval'] === 'maaned' || v['interval'] === 'aar' ? v['interval'] : null,
  });
  const medValg = (sti: string, v: { plan: string | null; interval: Interval | null }, sprog?: Sprog): string => {
    const q = new URLSearchParams();
    if (v.plan) q.set('plan', v.plan);
    if (v.interval) q.set('interval', v.interval);
    if (sprog) q.set('sprog', sprog);
    const s = q.toString();
    return s ? `${sti}?${s}` : sti;
  };

  const profilKlar = (p: Profil | null): boolean => profilErKlar(p, d.samtykke);
  /** KC-0204: the profile was done and consent given once (a version is recorded), but not to the current texts. */
  const genaccept = (p: Profil): boolean => !!p.land && !!p.sprog && (p.vilkaar !== null || p.privatliv !== null) && !samtykkeGyldigt(p, d.samtykke);

  /** Everything the step depends on, read now; side effects that follow from it (timing, the alert). */
  async function tilstand(l: Indlogget, session: string | null): Promise<{ v: Visning; profil: Profil | null; tenant: TenantVisning | null; betaling: { proeve: boolean } | null }> {
    const profil = await d.profil.hent(l.kontoId);
    const r = await d.rettighed(l.kontoId);
    const levende = r.status === 'proeve' || r.status === 'aktiv';
    const betaling = !levende && session !== null && SESSION_ID.test(session) ? await d.checkoutFuldfoert(l.kontoId, session) : null;
    const betalt = betaling !== null;
    const tenant = await d.tenant(l.kontoId);
    const v = tilmeldingsTrin(profil ? { profilKlar: profilKlar(profil), genaccept: genaccept(profil) } : null, { ...r, betalt }, tenant ? { tilstand: tenant.tilstand, fejl: tenant.fejl !== null, bestilt: tenant.bestilt } : null, { tilstand: d.tilstand, nu: nu() });
    if (tenant?.klar && profil && profil.tilmeldingMs === null) await d.profil.noterTid(l.kontoId, tenant.klar);
    if (v.trin === 'klargoering' && v.status === 'langsom' && tenant && !meldt.has(tenant.slug)) {
      meldt.add(tenant.slug);
      alarm(`ADVARSEL konto ${l.kontoId}: ${tenant.slug} er ikke klar ${Math.round((nu().getTime() - tenant.bestilt.getTime()) / 1000)} s efter bestilling (står i ${tenant.tilstand})`);
    }
    return { v, profil, tenant, betaling };
  }

  async function vis(c: Context, l: Indlogget, s: Faelles['sprog'], v: Visning, profil: Profil | null, tenant: TenantVisning | null, ekstra: { mangler?: boolean; svar?: 'ikke-endnu' | 'ukendt'; betaling?: { proeve: boolean } | null } = {}): Promise<string> {
    const f: Faelles = { sprog: s, csrf: l.csrf, tilstand: d.tilstand, ...(d.sideUrl ? { sideUrl: d.sideUrl } : {}) };
    const q = c.req.query();
    let side: SideInput;
    switch (v.trin) {
      case 'profil': side = { visning: v, lande: d.lande, land: profil?.land ?? null, valgtSprog: profil?.sprog ?? null, samtykke: d.samtykke, mangler: ekstra.mangler ?? false, behold: valg(q) }; break;
      case 'samtykke': side = { visning: v, samtykke: d.samtykke, mangler: ekstra.mangler ?? false }; break;
      case 'invitation': side = { visning: v, svar: ekstra.svar ?? null }; break;
      case 'plan': {
        // The plan step comes after the profile, so the country is known; the statement page re-derives the currency from it.
        const land = profil?.land ?? '';
        side = { visning: v, planer: d.planer, proeveDage: d.proeveDage, valg: valg(q), land, valuta: land ? d.valuta(land) : 'dkk', moms: d.moms, proeve: await d.harProeve(l.kontoId), afbrudt: q['afbrudt'] === '1' };
        break;
      }
      case 'betaling': side = { visning: v, proeve: ekstra.betaling?.proeve ?? false, session: c.req.query('session') ?? '' }; break;
      case 'aabn': side = { visning: v, aabnUrl: d.aabnUrl(tenant!.slug) }; break;
      case 'klargoering': side = { visning: v }; break;
      case 'abonnement': side = { visning: v }; break;
      case 'slettes': side = { visning: v }; break;
      case 'konto': side = { visning: v, til: '/tilmeld' }; break;
    }
    return tilmeldingSide(f, side);
  }

  app.get('/tilmeld.js', (c) => c.body(KLIENT_JS, 200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=300' }));

  app.get('/tilmeld', async (c) => {
    const l = await d.adgang.login(c);
    if (!l) {
      const s = sprogFor(c, null);
      const q = c.req.query('sprog');
      return c.html(tilmeldingSide({ sprog: s, csrf: null, tilstand: d.tilstand }, { visning: { trin: 'konto' }, til: medValg('/tilmeld', valg(c.req.query()), erSprog(q) ? q : undefined) }));
    }
    const { v, profil, tenant, betaling } = await tilstand(l, c.req.query('session') ?? null);
    return c.html(await vis(c, l, sprogFor(c, profil), v, profil, tenant, { betaling }));
  });

  app.post('/tilmeld/profil', smaa, async (c) => {
    const f = await formular(c);
    const l = await d.adgang.beskyttet(c, f['csrf']);
    if (!l) return c.text('Forbudt', 403);
    const { land, sprog, vilkaar, privatliv } = f;
    const gyldig = typeof land === 'string' && d.lande.includes(land) && erSprog(sprog)
      && vilkaar === d.samtykke.vilkaar.version && privatliv === d.samtykke.privatliv.version;
    if (!gyldig) {
      const profil = await d.profil.hent(l.kontoId);
      return c.html(await vis(c, l, sprogFor(c, profil), { trin: 'profil' }, profil, null, { mangler: true }), 400);
    }
    await d.profil.gem(l.kontoId, { land, sprog, vilkaar, privatliv, nu: nu() });
    return c.redirect(medValg('/tilmeld', valg(f)), 303);
  });

  // KC-0204: accepting a newer version. Country and language stay as they were; only the two versions change.
  app.post('/tilmeld/samtykke', smaa, async (c) => {
    const f = await formular(c);
    const l = await d.adgang.beskyttet(c, f['csrf']);
    if (!l) return c.text('Forbudt', 403);
    const profil = await d.profil.hent(l.kontoId);
    if (!profil || !profil.land || !profil.sprog) return c.redirect('/tilmeld', 303);
    if (f['vilkaar'] !== d.samtykke.vilkaar.version || f['privatliv'] !== d.samtykke.privatliv.version) {
      return c.html(await vis(c, l, sprogFor(c, profil), { trin: 'samtykke' }, profil, null, { mangler: true }), 400);
    }
    await d.profil.gem(l.kontoId, { land: profil.land, sprog: profil.sprog, vilkaar: d.samtykke.vilkaar.version, privatliv: d.samtykke.privatliv.version, nu: nu() });
    return c.redirect('/tilmeld', 303);
  });

  app.post('/tilmeld/invitation', smaa, async (c) => {
    const f = await formular(c);
    const l = await d.adgang.beskyttet(c, f['csrf']);
    if (!l) return c.text('Forbudt', 403);
    const { v, profil, tenant } = await tilstand(l, null);
    if (v.trin !== 'invitation') return c.redirect('/tilmeld', 303);
    if (!d.invitation) return c.html(await vis(c, l, sprogFor(c, profil), v, profil, tenant, { svar: 'ikke-endnu' }));
    const kode = typeof f['kode'] === 'string' ? f['kode'].trim().slice(0, 64) : '';
    if (kode && await d.invitation(l.kontoId, kode)) return c.redirect('/tilmeld', 303);
    return c.html(await vis(c, l, sprogFor(c, profil), v, profil, tenant, { svar: 'ukendt' }), 400);
  });

  app.get('/api/tilmelding/status', async (c) => {
    const l = await d.adgang.login(c);
    if (!l) return c.json({ noegle: 'konto' }, 401);
    const { v } = await tilstand(l, c.req.query('session') ?? null);
    return c.json({ noegle: visningsNoegle(v) });
  });

  app.post('/api/tilmelding/igen', smaa, async (c) => {
    const l = await d.adgang.beskyttet(c, (await formular(c))['csrf']);
    if (!l) return c.text('Forbudt', 403);
    const { v } = await tilstand(l, null);
    if (v.trin === 'klargoering') await d.proevIgen(l.kontoId);
    return c.redirect('/tilmeld', 303);
  });

  if (d.dev) {
    // Development only: every state's test data (eksempler.ts), without provisioning anything.
    app.get('/dev/tilmelding', (c) => c.html(galleriSide(Object.keys(EKSEMPLER))));
    app.get('/dev/tilmelding/:navn', (c) => {
      const e = Object.hasOwn(EKSEMPLER, c.req.param('navn')) ? EKSEMPLER[c.req.param('navn')] : undefined;
      if (!e) return c.text('Ikke fundet', 404);
      const q = c.req.query('sprog');
      return c.html(tilmeldingSide({ ...e.faelles, sprog: erSprog(q) ? q : e.faelles.sprog, poll: false }, e.side));
    });
  }

  return app;
}
