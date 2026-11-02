// Clawco Sky, the control plane (KC-0176). Thin: parse, call, render. Runs on its own EU server,
// never on a tenant machine; shares no code with src/ (sky/test/aftryk.test.ts holds that).
import path from 'node:path';
import http, { type IncomingMessage, type ServerResponse, type RequestListener } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getRequestListener } from '@hono/node-server';
import { laesConfig, laesKopiConfig, type KopiConfig, type SkyConfig } from './config.ts';
import { pgDatabase, type Database } from './db/pool.ts';
import { migrer } from './db/migrer.ts';
import { helbred } from './helbred.ts';
import { gitSha, skyVersion } from './delt/sha.ts';
import { falskPost } from './delt/post.ts';
import { postFraEnv } from './delt/post-udbyder.ts';
import { haendelser } from './delt/haendelser.ts';
import { randomBytes } from 'node:crypto';
import { kontoAdgang, kontoRuter, type KontoDeps } from './konto/ruter.ts';
import { ingenAfvikler, ingenHusstand } from './konto/slet.ts';
import type { Flaade } from './fleet/flaade.ts';
import { lokalFlaade, koerProces } from './fleet/lokal.ts';
import { hetznerFlaade } from './fleet/hetzner.ts';
import { flaadeAfvikler, flaadeHusstand, clawcoFor } from './fleet/afvikler.ts';
import { hentSundhed } from './fleet/provisioner.ts';
import { laase } from './fleet/tilstand.ts';
import { afstemLoekke, type AfstemDeps } from './fleet/afstem.ts';
import { ingenKryptering } from './fleet/kryptering.ts';
import { laesMasternoegle, MASTERNOEGLE_NAVNE, type Noeglering } from './hemmeligheder/masternoegle.ts';
import { flaadeNoegler, ingenMasternoegle } from './hemmeligheder/flaade.ts';
import { koerMedInput, noegleRunFlag } from './hemmeligheder/levering.ts';
import { destruktionsLoekke } from './hemmeligheder/dagligt.ts';
import { laesOmkostninger } from './delt/omkostninger.ts';
import { abonnementRuter, koebDeps, webhookDeps, type AbonnementDeps } from './abonnement/ruter.ts';
import { fristLoekke } from './abonnement/frist-job.ts';
import { valutaForLand } from './abonnement/valuta.ts';
import { omsaetningsVagt } from './abonnement/omsaetning.ts';
import { velkomstLoekke, type VelkomstDeps } from './abonnement/velkomst-job.ts';
import type { KoebDeps } from './abonnement/kvittering.ts';
import { nytAfmeldLink, vilHaveTips } from './konto/mailvalg.ts';
import { HJAELP, svartid } from './konto/hjaelp.ts';
import { devStripeRuter, devHaendelser } from './abonnement/dev.ts';
import { kontoHandlinger } from './abonnement/handlinger.ts';
import { laesSaelgere } from './delt/saelger.ts';
import { laesBetaling, type BetalingsKlient } from './abonnement/stripe-klient.ts';
import { StripeBetalingsKlient } from './abonnement/stripe-sdk.ts';
import { FalskBetalingsKlient } from './abonnement/falsk.ts';
import { anvend, planlaeg } from './abonnement/opsaet.ts';
import { opsaetPortal, portalReturUrl } from './abonnement/portal.ts';
import { laesPriser } from './abonnement/priser.ts';
import { opsigVedSletning } from './abonnement/kunde.ts';
import { hentRettigheder, kontiMedAdgang } from './abonnement/synk.ts';
import { kontoResume } from './abonnement/render.ts';
import { laesGatewayNoegle, type GatewayNoegle } from './gateway/noegle.ts';
import { ruteTabel, vaertsArt, type RuteTabel } from './gateway/rute.ts';
import { loginVejRuter, type LoginVejDeps } from './gateway/login-vej.ts';
import { gateway } from './gateway/proxy.ts';
import { stoetteVejRuter, type StoetteSeams, type StoetteSideDeps } from './gateway/stoette-vej.ts';
import { aabnStoette, aktiveStoetter, annullerStoette, erPersonale, givStoette, noterUdloebne, sendStoetteKvittering, sessionStartet, stoetteGyldig, tilbagekaldStoette } from './konto/stoette.ts';
import { tenantKald, type TenantKald } from './gateway/tenantkald.ts';
import { kontrolKald } from './gateway/kontrolkald.ts';
import { betaForTenant, indloes } from './beta/invitationer.ts';
import { betaIndloesDeps } from './betaforbind.ts';
import { hentLoekke } from './beta/hent.ts';
import { noterSet } from './beta/set.ts';
import { husstandensEjer, medlemskabHusstand } from './konto/medlemskab.ts';
import type { Entitlements } from './konto/invitation.ts';
import { abonnementEksport } from './abonnement/eksport.ts';
import { hentKonto } from './konto/konto.ts';
import { loginUrl, tenantOrigin } from './gateway/login-vej.ts';
import { tilmeldingRuter, type TilmeldingDeps } from './tilmelding/ruter.ts';
import { JURIDISK_MAPPE, laesSamtykke, profilErKlar, samtykkeGyldigt } from './tilmelding/samtykke.ts';
import { stopPaaSignal } from './delt/stop.ts';
import { gemProfil, hentProfil, noterTilmeldingstid } from './konto/profil.ts';
import { LANDE } from './abonnement/lande.ts';
import { hentKundeRaekke, kontoensCheckout } from './abonnement/kunde.ts';
import { klargoerKonto } from './fleet/afstem.ts';
import { hentTenant, klareTilUdrulning, noterKoersel, provisioneringerSiden, saetHold, saetOpdateres, tenantForEjer, tenanterTilKopi, nyligtKlareEjere } from './fleet/tilstand.ts';
import { koerBinaer, lokalKopiNode, type KoerselBinaer } from './fleet/kopi.ts';
import { kopiNoegler, slettedeNoegler } from './hemmeligheder/kopi.ts';
import { lokalKopiLager, r2KopiLager } from './drift/backup/lager.ts';
import { lokalBilledKoerer } from './fleet/udgave-koerer.ts';
import type { UdrulDeps } from './drift/udrulning/typer.ts';
import { pgDump } from './drift/backup/pgdump.ts';
import { kopiLoekke } from './drift/backup/loekke.ts';
import type { ProeveDeps } from './drift/backup/proeve.ts';
import type { KopiNode } from './drift/backup/typer.ts';
import { skyFejlrapport, type Fejlrapport } from './delt/fejlrapport.ts';
import { alarmer, alarmLoekke, alarmModtager, alarmSignaler } from './drift/alarm.ts';
import { byggFeed, feedCache, statusOrigin, statusRuter, type StatusDeps } from './drift/helbred/feed.ts';
import { adgangsProbe, maaltPost, type KomponentDeps } from './drift/helbred/komponenter.ts';
import { noterPost } from './drift/helbred/historik.ts';
import { pollerLoekke } from './drift/helbred/poller.ts';

export type DevStripe = Parameters<typeof devStripeRuter>[0];
export type SkyDeps = { db: Database; sha: string; startet: number; konto?: KontoDeps; abonnement?: AbonnementDeps; dev?: DevStripe | null; flaade?: string; noegler?: 'ok' | 'mangler'; gateway?: 'ok' | 'mangler'; noegleskift?: 'forberedt'; loginVej?: LoginVejDeps; tilmelding?: TilmeldingDeps; stoetteSide?: StoetteSideDeps ; fejlrapport?: Fejlrapport; status?: StatusDeps };

export function createSkyApp(deps: SkyDeps): Hono {
  const app = new Hono();
  // KC-0187: an unexpected error is reported, scrubbed (delt/fejlrapport-kerne.ts), with the route template only.
  // An HTTPException is an answer, not a bug: it keeps Hono's own response.
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err); // as Hono's default handler: the journal on Sky's own server keeps the full error
    deps.fejlrapport?.rapporter(err, { rute: c.req.routePath, status: 500 });
    return c.text('Internal Server Error', 500);
  });
  app.get('/health', async (c) => {
    const h = await helbred({ db: deps.db, sha: deps.sha, startet: deps.startet, ...(deps.flaade ? { flaade: deps.flaade } : {}), ...(deps.noegler ? { noegler: deps.noegler } : {}), ...(deps.gateway ? { gateway: deps.gateway } : {}), ...(deps.noegleskift ? { noegleskift: deps.noegleskift } : {}) });
    return c.json(h, h.ok ? 200 : 503);
  });
  // KC-0189: the public status feed (counts only); its handler ends the chain like /health.
  if (deps.status) app.route('/', statusRuter(deps.status));
  // Billing first: its handlers end the chain, so konto's '*' middleware (64 KB body limit, its own
  // CSP) never runs on the webhook or the plan pages.
  if (deps.abonnement) app.route('/', abonnementRuter(deps.abonnement));
  if (deps.dev) app.route('/', devStripeRuter(deps.dev));
  // KC-0183: /aabn, the account host's half of the way into a tenant (its handler ends the chain too).
  if (deps.loginVej) app.route('/', loginVejRuter(deps.loginVej));
  // KC-0188: the staff page (/personale): only staff logged in by passkey; it opens a customer's grant, nothing else.
  if (deps.stoetteSide) app.route('/', stoetteVejRuter(deps.stoetteSide));
  // KC-0198: sign-up, before konto too (its pages allow Checkout as a form target; konto's CSP does not).
  if (deps.tilmelding) app.route('/', tilmeldingRuter(deps.tilmelding));
  if (deps.konto) app.route('/', kontoRuter(deps.konto));
  return app;
}

/** KC-0181: Sky's master key from the environment, as a ring, or why there is none (a message naming the key,
 *  never a value). Reading it removes the key names from `env`, so child processes never inherit them. */
export type Noegler = { ring: Noeglering | null; fejl: string | null };
export function noeglering(env: Record<string, string | undefined>): Noegler {
  try { return { ring: laesMasternoegle(env), fejl: null }; } catch (err) {
    for (const n of MASTERNOEGLE_NAVNE) delete env[n]; // an invalid value must not reach child processes either
    return { ring: null, fejl: (err as Error).message };
  }
}

/** KC-0212: the fleet SKY_FLAADE picks; null = none (deprovisioning keeps refusing). No paid customers are read
 *  yet, so the hetzner driver sees MRR 0 and refuses (D18). Volumes are not encrypted at rest on the lokal driver
 *  (no root on kira-home for LUKS): the tenant's model keys are, in its own key file (KC-0181). */
export function flaadeFra(config: SkyConfig, db?: Database): Flaade | null {
  const f = config.flaade;
  // KC-0203: a beta household's container is told so (and what it consented to); `db` absent = nobody is a beta.
  if (f.driver === 'lokal') return lokalFlaade({ koer: koerProces, billede: f.billede, netvaerk: f.netvaerk, kontoPubkey: f.kontoPubkey, kontoPubkeyNy: f.kontoPubkeyNy, skyUrl: config.publicUrl, kryptering: ingenKryptering(), noegleFlag: noegleRunFlag(), ...(db ? { beta: async (slug: string) => { const b = await betaForTenant(db, slug); return b ? { samtykke: b.samtykke } : null; } } : {}) });
  if (f.driver === 'hetzner') return hetznerFlaade({ omkostninger: () => laesOmkostninger(), mrr: () => 0 });
  return null;
}

/** KC-0217: `forberedt` while a key rotation is prepared (SKY_KONTO_PUBKEY_NY set with the lokal fleet), shown on /health. */
export function noegleskiftFra(config: SkyConfig): 'forberedt' | undefined {
  return config.flaade.driver === 'lokal' && config.flaade.kontoPubkeyNy ? 'forberedt' : undefined;
}

/** The edge hooks (KC-0183): the gateway's route table is the fleet's own rows, so putting a tenant in or out of
 *  the gateway is invalidating its cache at once — and, on the way out, dropping its unspent one-time codes. */
export type Kant = Pick<AfstemDeps, 'iGateway' | 'udAfGateway'>;
export function kant(db: Database, ruter: RuteTabel): Kant {
  return {
    iGateway: async ({ slug }) => { ruter.glem(slug); },
    udAfGateway: async (slug) => {
      ruter.glem(slug);
      await db.query('DELETE FROM gateway.kode WHERE slug = $1', [slug]);
    },
  };
}

/** KC-0182: everything the fleet's provisioning, deprovisioning and reconciler share — one fleet and one
 *  per-tenant lock per process. null without a fleet. The edge hooks come from the gateway (KC-0183; no-ops when
 *  none is handed in); who may have a tenant comes from billing (an active plan or a trial). */
export function flaadeDeps(config: SkyConfig, db: Database, ring: Noeglering | null = null, k: Kant | null = null, kald: TenantKald | null = null): AfstemDeps | null {
  const flaade = flaadeFra(config, db);
  if (!flaade) return null;
  const nu = () => new Date();
  // KC-0181: every tenant has a data key before its container exists and gets its lager key after each start.
  // Without a master key this seam refuses, so nothing is started (and main refuses to start Sky at all).
  const noegler = ring ? flaadeNoegler({ db, ring, koer: koerMedInput, nu }) : ingenMasternoegle({ db, koer: koerMedInput, nu });
  return {
    db, flaade, noegler, billede: config.flaade.driver === 'lokal' ? config.flaade.billede : null, laas: laase(),
    sundhed: (adresse) => hentSundhed(adresse),
    iGateway: k?.iGateway ?? (async () => {}),
    udAfGateway: k?.udAfGateway ?? (async () => {}),
    // KC-0206: the tenant's own Slet alt as its owner before the volume goes (best effort in afprovisioner.ts).
    ...(kald ? { toem: async (slug: string, adresse: string) => {
      const t = await hentTenant(db, slug);
      const ejer = t ? await hentKonto(db, t.ejerKontoId) : null;
      if (!t || !ejer) throw new Error('ejeren findes ikke længere, så Clawco kan ikke tømmes som ejer');
      await kald.sletAlt({ slug, adresse, kontoId: ejer.id, email: ejer.email });
    } } : {}),
    berettigede: () => kontiMedAdgang(db),
    nu,
    vent: (ms) => new Promise((r) => { setTimeout(r, ms).unref(); }),
  };
}

/** The account app's seams. Mail (KC-0178): Resend when SKY_RESEND_API_KEY is set, else Post refuses (fail closed);
 *  SKY_DEV=1 uses the fake Post with an outbox page. Households (KC-0184) are wired in forbind (membership needs the gateway key); deprovisioning
 *  goes through the fleet SKY_FLAADE picks (KC-0212), else it refuses. The event bus is passed in so
 *  billing can listen on the same one. */
export function kontoDeps(config: SkyConfig, db: Database, h = haendelser(), fl: AfstemDeps | null = flaadeDeps(config, db), env: Record<string, string | undefined> = process.env): KontoDeps {
  const fake = config.dev ? falskPost() : null;
  return {
    db,
    post: fake ?? postFraEnv(env, config),
    udbakke: fake?.udbakke ?? null,
    rp: { id: config.rpId, navn: 'Clawco', origin: new URL(config.publicUrl).origin },
    publicUrl: config.publicUrl,
    dev: config.dev,
    // The fleet's table says an account owns a tenant; forbind replaces this with the membership-aware one (KC-0184).
    husstand: fl ? flaadeHusstand({ db, basedomain: config.basedomain, reserve: ingenHusstand() }) : ingenHusstand(),
    afvikler: fl ? flaadeAfvikler(fl) : ingenAfvikler(),
    haendelser: h,
    ...(fl ? { clawco: clawcoFor({ db, basedomain: config.basedomain }) } : {}),
    // KC-0201: the public help page lives on the product's own domain (not in local development).
    ...(config.dev ? {} : { hjaelpSide: `https://${config.basedomain}/hjaelp` }),
  };
}

/** konto and abonnement wired together without importing each other (KC-0191/KC-0192): one event bus,
 *  konto's login and household handed to billing as seams, billing's summary handed to /konto.
 *  The Stripe client: the real one when SKY_STRIPE_SECRET_KEY is set; with SKY_DEV=1 and no key the
 *  fake one holding the config's prices (and the dev Checkout page); otherwise none, and billing
 *  answers 503 (fail closed). */
/** KC-0198: the sign-up flow's seams — konto's login and profile, billing's entitlement and Checkout, the
 *  fleet's tenant and retry, the gateway's way in — wired here so none of those modules imports another. */
export function tilmeldingDeps(o: { config: SkyConfig; db: Database; adgang: ReturnType<typeof kontoAdgang>; abonnement: AbonnementDeps; flaade: AfstemDeps | null; gateway: GatewayNoegle | null }): TilmeldingDeps {
  const { config, db, abonnement: ab, flaade: fl } = o;
  const somLogin = (l: Awaited<ReturnType<typeof o.adgang.login>>) => (l ? { kontoId: l.konto.id, csrf: l.session.csrf } : null);
  return {
    publicUrl: config.publicUrl, sideUrl: `https://${config.basedomain}`, tilstand: config.tilmelding, dev: config.dev,
    samtykke: laesSamtykke(),
    lande: LANDE.map((l) => l.kode),
    planer: Object.entries(ab.priser.planer).map(([id, p]) => ({ id, navn: p.navn, medlemmer: p.medlemmer, maaned: p.maanedlig, aar: p.aarlig })),
    // KC-0194: billing's rule, so the plan step shows the currency Checkout will charge in.
    valuta: (land) => valutaForLand(ab.priser, land),
    moms: ab.priser.moms.aktiv,
    proeveDage: ab.priser.proeve.dage,
    adgang: { login: async (c) => somLogin(await o.adgang.login(c)), beskyttet: async (c, csrf) => somLogin(await o.adgang.beskyttet(c, csrf)) },
    profil: { hent: (id) => hentProfil(db, id), gem: (id, p) => gemProfil(db, id, p), noterTid: (id, klar) => noterTilmeldingstid(db, id, klar) },
    rettighed: async (id) => {
      const e = await tenantForEjer(db, id) ? null : await husstandensEjer(db, id);
      const r = await hentRettigheder(db, e?.ejerKontoId ?? id, ab.priser, new Date());
      return { status: r.status, kilde: r.kilde };
    },
    harProeve: async (id) => !((await hentKundeRaekke(db, id))?.proeveBrugt ?? false),
    checkoutFuldfoert: async (id, session) => {
      if (!ab.klient) return null;
      let s;
      try { s = await kontoensCheckout(db, ab.klient, id, session); } catch { return null; }
      return s?.status === 'complete' ? { proeve: s.abonnement?.status === 'trialing' } : null;
    },
    // KC-0184: a household member's Clawco is the household's, under its owner's plan.
    tenant: async (id) => {
      const e = await tenantForEjer(db, id) ? null : await husstandensEjer(db, id);
      const t = e ? await hentTenant(db, e.tenantId) : await tenantForEjer(db, id);
      return t ? { slug: t.slug, tilstand: t.tilstand, fejl: t.fejl, bestilt: t.tider.bestilt ?? new Date(0), klar: t.tider.klar ?? null } : null;
    },
    proevIgen: async (id) => {
      if (!fl) return;
      // Not awaited: provisioning can take a minute; the page polls. Failures are recorded on the tenant row.
      void klargoerKonto(fl, id).catch((err: Error) => { console.error(`sky tilmelding: prøv igen for konto ${id} fejlede: ${err.message}`); });
    },
    // KC-0203: a live code spends itself and gives this account the beta gift; the box next to it is the measures' consent.
    invitation: (id, kode, valg) => indloes(betaIndloesDeps(db, ab.priser), id, kode, new Date(), { samtykke: valg.betaSamtykke }),
    aabnUrl: (slug) => (o.gateway ? loginUrl({ publicUrl: config.publicUrl, noegle: o.gateway, slug, naeste: '/rum/start' }) : `${tenantOrigin(slug, config.publicUrl, config.basedomain)}/rum/start`),
  };
}

/** KC-0185: the backup job's seams — R2 (the copy store), the lokal fleet's node, the key envelope, pg_dump —
 *  wired here (and by sky/scripts/sikkerhedskopi.ts) so drift/ imports none of those modules. Off (deps null, with
 *  the reason) without R2 keys or without the master key. Without a lokal fleet only Sky's database is copied. */
export function kopiFra(o: { config: SkyConfig; db: Database; ring: Noeglering | null; kopi: KopiConfig | null; fetch?: typeof fetch; koer?: KoerselBinaer }): { deps: ProeveDeps | null; grund: string | null } {
  if (!o.kopi) return { deps: null, grund: 'sikkerhedskopier er slået fra: SKY_R2_* er ikke sat' };
  if (!o.ring) return { deps: null, grund: 'sikkerhedskopier er slået fra: SKY_MASTERNOEGLE mangler (kopierne kan ikke krypteres)' };
  const koer = o.koer ?? koerBinaer;
  const f = o.config.flaade;
  const nej = (): Promise<never> => Promise.reject(new Error('ingen flåde (SKY_FLAADE er ikke lokal): ingen kundediske at kopiere'));
  const node: KopiNode = f.driver === 'lokal'
    ? lokalKopiNode({ koer, billede: f.billede, netvaerk: f.netvaerk, kontoPubkey: f.kontoPubkey, skyUrl: o.config.publicUrl, noegleFlag: noegleRunFlag() })
    : { pak: nej, udpak: nej, start: nej, pakGendannet: nej, fjern: nej };
  const k = o.kopi;
  return {
    grund: null,
    deps: {
      db: o.db,
      lager: r2KopiLager({ kontoId: k.kontoId, jurisdiktion: k.jurisdiktion, bucket: k.bucket, noegleId: k.noegleId, hemmelighed: k.hemmelighed(), ...(o.fetch ? { fetch: o.fetch } : {}) }),
      node,
      noegler: kopiNoegler({ db: o.db, ring: o.ring }),
      dump: pgDump({ databaseUrl: o.config.databaseUrl, koer }),
      tenanter: () => tenanterTilKopi(o.db),
      slettedeNoegler: () => slettedeNoegler(o.db),
      nu: () => new Date(),
      sundhed: (adresse) => hentSundhed(adresse),
      vent: (ms) => new Promise((r) => { setTimeout(r, ms).unref(); }),
      testTenant: k.testTenant,
    },
  };
}

/** KC-0186: the rollout's seams — the lokal fleet (upgrade on the same volume), the key delivery, the tenant rows, the
 *  image runner of the compatibility check, and the restore points' store: R2 when it is set up, else the local
 *  directory store (on the host: a restore point, not an offsite backup). Wired here and used by sky/scripts/udrul.ts
 *  only (the rollout is an operator command, never a loop in the Sky process). Off without a lokal fleet or a master key. */
export function udrulFra(o: { config: SkyConfig; db: Database; ring: Noeglering | null; kopi: KopiConfig | null; lokaleKopier: string; log?: (linje: string) => void }): { deps: UdrulDeps | null; grund: string | null; lager: 'r2' | 'lokal' } {
  const f = o.config.flaade;
  const lager = o.kopi ? 'r2' : 'lokal';
  if (f.driver !== 'lokal') return { deps: null, grund: 'udrulning kræver SKY_FLAADE=lokal', lager };
  if (!o.ring) return { deps: null, grund: 'udrulning kræver SKY_MASTERNOEGLE (genopretningspunkter krypteres, nøglen leveres efter hver start)', lager };
  const { db, ring } = o;
  const flaade = flaadeFra(o.config, o.db)!;
  const k = o.kopi;
  return {
    grund: null,
    lager,
    deps: {
      db,
      flaade,
      noegler: flaadeNoegler({ db, ring, koer: koerMedInput, nu: () => new Date() }),
      tenanter: {
        klare: () => klareTilUdrulning(db),
        saetHold: (slug, hold) => saetHold(db, slug, hold),
        opdateres: (slug, ja) => saetOpdateres(db, slug, ja ? new Date() : null),
        noterKoersel: (slug, x) => noterKoersel(db, slug, x, new Date()),
      },
      koerer: lokalBilledKoerer({ koer: koerProces, netvaerk: f.netvaerk, kontoPubkey: f.kontoPubkey, skyUrl: o.config.publicUrl, noegleFlag: noegleRunFlag() }),
      kopi: {
        node: lokalKopiNode({ koer: koerBinaer, billede: f.billede, netvaerk: f.netvaerk, kontoPubkey: f.kontoPubkey, skyUrl: o.config.publicUrl, noegleFlag: noegleRunFlag() }),
        noegler: kopiNoegler({ db, ring }),
      },
      lagre: {
        r2: k ? r2KopiLager({ kontoId: k.kontoId, jurisdiktion: k.jurisdiktion, bucket: k.bucket, noegleId: k.noegleId, hemmelighed: k.hemmelighed() }) : null,
        lokal: lokalKopiLager(o.lokaleKopier),
      },
      sundhed: (adresse) => hentSundhed(adresse),
      nu: () => new Date(),
      // A held timer (not unref'd): in the foreground command it is what keeps the process alive mid-upgrade.
      vent: (ms) => new Promise((r) => { setTimeout(r, ms); }),
      ...(o.log ? { log: o.log } : {}),
    },
  };
}

/** KC-0189: the status components' seams — Sky's own health and an account lookup (login), the canary route through
 *  Sky's own listener (adgang; the intern cohort's tenant first, never the public edge), the fleet's rows (provisioning,
 *  copy scopes) — wired here so drift/ imports none of fleet/, konto/ or gateway/. */
export function helbredKomponenter(o: { config: SkyConfig; db: Database; sha: string; startet: number; flaadeKlar: boolean; kopierSlaaetTil: boolean; flaade?: string; noegler?: 'ok' | 'mangler'; gateway?: 'ok' | 'mangler' }): KomponentDeps {
  const { config, db } = o;
  return {
    db,
    sky: async () => (await helbred({ db, sha: o.sha, startet: o.startet, ...(o.flaade ? { flaade: o.flaade } : {}), ...(o.noegler ? { noegler: o.noegler } : {}), ...(o.gateway ? { gateway: o.gateway } : {}) })).ok,
    konto: async () => { await db.query('SELECT id FROM konto LIMIT 1'); return true; },
    adgang: adgangsProbe({
      port: config.port,
      vaert: async () => {
        const k = await klareTilUdrulning(db);
        const kanari = k.find((t) => t.hold === 'intern') ?? k.find((t) => t.hold === 'kanari') ?? k[0];
        return kanari ? `${kanari.slug}.${config.basedomain}` : null;
      },
    }),
    kontoOrigin: new URL(config.publicUrl).origin,
    provisioneringer: (siden) => provisioneringerSiden(db, siden),
    flaadeKlar: o.flaadeKlar,
    kopierSlaaetTil: o.kopierSlaaetTil,
    kopiTenanter: () => tenanterTilKopi(db),
  };
}

/** KC-0200: the welcome mails' seams — billing's own deps, the fleet's klar time and the Clawco's address (the same link
 *  /konto shows, clawcoFor), konto's tips choice and unsubscribe link, and support's mailbox as the reply-to. */
export function velkomstDeps(o: { db: Database; basedomain: string; koeb: KoebDeps }): VelkomstDeps {
  const { db, koeb: k } = o;
  const link = clawcoFor({ db, basedomain: o.basedomain });
  return {
    db, priser: k.priser, post: k.post, publicUrl: k.publicUrl, nu: k.nu, kontakt: k.kontakt, saelger: k.saelger,
    clawco: async (kontoId) => {
      const t = await tenantForEjer(db, kontoId);
      const c = await link(kontoId);
      return t?.tilstand === 'klar' && t.tider.klar && c && 'url' in c ? { klarVed: t.tider.klar, link: c.url } : null;
    },
    nyligtKlare: (siden) => nyligtKlareEjere(db, siden),
    tips: (kontoId) => vilHaveTips(db, kontoId),
    afmeldLink: (kontoId, sprog) => nytAfmeldLink(db, { kontoId, publicUrl: k.publicUrl, sprog, nu: k.nu() }),
    hjaelp: { postkasse: HJAELP.postkasse, svartid: (sprog) => svartid(sprog) },
  };
}

export type GatewayForbindelse = { noegle: GatewayNoegle | null; fejl: string | null; status: 'ok' | 'mangler'; ruter: RuteTabel; loginVej: LoginVejDeps; stoette: StoetteSeams; stoetteSide: StoetteSideDeps };

export async function forbind(config: SkyConfig, db: Database, env: Record<string, string | undefined>, n: Noegler = noeglering(env)): Promise<{ konto: KontoDeps; abonnement: AbonnementDeps; dev: DevStripe | null; flaade: AfstemDeps | null; noegler: 'ok' | 'mangler'; noeglefejl: string | null; gateway: GatewayForbindelse; adgang: ReturnType<typeof kontoAdgang>; tilmelding: TilmeldingDeps }> {
  // KC-0183: the gateway's signing key (removed from env here); with the lokal fleet it must be the private half
  // of the SKY_KONTO_PUBKEY every tenant is given.
  const gk = laesGatewayNoegle(env, config.flaade.driver === 'lokal' ? config.flaade.kontoPubkey : null);
  const ruter = ruteTabel({ db });
  // KC-0206: Sky reaches a tenant's own Hent alt / Slet alt as its owner with the gateway's key (none = refused).
  const kald = tenantKald({ noegle: gk.noegle });
  const flaade = flaadeDeps(config, db, n.ring, kant(db, ruter), kald);
  const konto = kontoDeps(config, db, haendelser(), flaade, env);
  // KC-0189: every mail's outcome (a code, never a recipient) feeds the status page's mail component.
  konto.post = maaltPost(konto.post, (r) => noterPost(db, r));
  const betaling = laesBetaling(env);
  const priser = laesPriser();
  // KC-0184: households. The plan's limit is the owner's entitlement (KC-0192: medlemmerMax while it is a trial or
  // active; otherwise the owner alone). The tenant is changed only by the signed control call (gateway/kontrolkald.ts),
  // and only from the membership code behind the owner's own click or a member's own "Forlad".
  const entitlements: Entitlements = {
    medlemmer: async (slug) => {
      const t = await hentTenant(db, slug);
      if (!t) return 1;
      const r = await hentRettigheder(db, t.ejerKontoId, priser, new Date());
      return r.status === 'proeve' || r.status === 'aktiv' ? Math.max(1, r.medlemmerMax) : 1;
    },
  };
  const husstandKald = kontrolKald({ noegle: gk.noegle });
  // The invitation pages stay off (404) until SKY_HUSSTAND_INVITATIONER=1: the published terms v1.0 (vilkår §3,
  // privatlivspolitik §9) say invitations and child members do not exist yet and that the terms change first.
  if ((env['SKY_HUSSTAND_INVITATIONER'] ?? '').trim() === '1') {
    konto.medlemskab = { kald: husstandKald, entitlements, glem: (slug) => ruter.glem(slug), url: (slug) => `${tenantOrigin(slug, config.publicUrl, config.basedomain)}/` };
  }
  konto.husstand = medlemskabHusstand({ db, kald: husstandKald, entitlements, glem: (slug) => ruter.glem(slug) });
  let klient: BetalingsKlient | null = null;
  let falsk: FalskBetalingsKlient | null = null;
  let hemmelighed = betaling.webhookHemmelighed;
  if (betaling.noegle) {
    klient = new StripeBetalingsKlient(betaling.noegle);
  } else if (config.dev) {
    falsk = new FalskBetalingsKlient('test', { checkoutUrl: (id) => new URL(`/dev/stripe/checkout/${id}`, config.publicUrl).href });
    await anvend((await planlaeg(priser, falsk)).skridt, falsk);
    await opsaetPortal(priser, falsk, portalReturUrl(config.publicUrl));
    klient = falsk;
    // The fake signs its own events; a fresh secret per process, never configured, never logged.
    hemmelighed ??= `whsec_dev${randomBytes(18).toString('hex')}`;
  }
  const adgang = kontoAdgang(konto);
  // The account's language from sign-up (KC-0198) goes to Stripe (Checkout's locale); Danish until chosen.
  const somIndlogget = async (l: Awaited<ReturnType<typeof adgang.login>>) => (l && l.konto.email ? { kontoId: l.konto.id, email: l.konto.email, sprog: (await hentProfil(db, l.konto.id))?.sprog ?? 'da', csrf: l.session.csrf } : null);
  const samtykke = laesSamtykke();
  const saelgere = laesSaelgere(JURIDISK_MAPPE);
  // KC-0204: the gateway lets an account into its Clawco only on the current texts (read once at start).
  const samtykkeOk = async (kontoId: number): Promise<boolean> => samtykkeGyldigt(await hentProfil(db, kontoId), samtykke);
  const abonnement: AbonnementDeps = {
    db, klient, priser, publicUrl: config.publicUrl, juridisk: betaling.juridisk, webhookHemmelighed: hemmelighed,
    adgang: { login: async (c) => somIndlogget(await adgang.login(c)), beskyttet: async (c, csrf) => somIndlogget(await adgang.beskyttet(c, csrf)) },
    husstand: async (kontoId) => {
      const t = await konto.husstand.forKonto(kontoId);
      if (!t) return null;
      // KC-0195: a member sees the owner's plan read-only; the owner is the tenant's.
      const ejerKontoId = t.rolle === 'ejer' ? kontoId : (await hentTenant(db, t.tenantId))?.ejerKontoId ?? null;
      return { rolle: t.rolle, antal: t.medlemmer.length + 1, ejerKontoId };
    },
    tilPlan: async (kontoId) => config.tilmelding === 'open' && profilErKlar(await hentProfil(db, kontoId), samtykke),
    // KC-0209: mail (receipts, cancellation, withdrawal), the seller read from the terms (a Sky that cannot name its seller
    // does not start), the terms version a purchase records (the same record KC-0204 keeps) and the account's address.
    post: konto.post,
    saelger: (sprog) => saelgere[sprog],
    vilkaar: { version: samtykke.vilkaar.version, url: (sprog) => `https://${config.basedomain}${sprog === 'en' ? '/en' : ''}${samtykke.vilkaar.sti}` },
    kontakt: async (kontoId) => {
      const k = await hentKonto(db, kontoId);
      return k?.email ? { email: k.email, sprog: (await hentProfil(db, kontoId))?.sprog ?? 'da' } : null;
    },
  };
  konto.abonnement = async (kontoId) => {
    const r = await hentRettigheder(db, kontoId, priser, new Date());
    return kontoResume(r, priser, await kontoHandlinger(db, kontoId, r, new Date()));
  };
  // KC-0201: the facts "Få hjælp" puts in the mail. Billing's entitlement and the fleet's row, handed to konto as one seam
  // (konto never imports either); the account number and the last error code are added by konto itself.
  const sha = gitSha();
  const version = skyVersion();
  konto.hjaelp = async (kontoId) => {
    const r = await hentRettigheder(db, kontoId, priser, new Date());
    const t = await tenantForEjer(db, kontoId);
    return { plan: r.plan, status: r.status, skrivebeskyttet: r.skrivebeskyttet, version, sha, release: t?.release ?? 'ingen', placering: t?.driver ?? 'ingen' };
  };
  // KC-0206: what Hent alt adds to the account rows — the owner's own Clawco export (only once it is klar) and billing.
  konto.eksport = {
    tenant: async (kontoId) => {
      const t = await tenantForEjer(db, kontoId);
      const k = await hentKonto(db, kontoId);
      if (!t || t.tilstand !== 'klar' || !t.adresse || !k) return null;
      return kald.eksport({ slug: t.slug, adresse: t.adresse, kontoId, email: k.email });
    },
    abonnement: (kontoId) => abonnementEksport({ db, klient, priser }, kontoId, new Date()),
  };
  opsigVedSletning(konto.haendelser, { db, klient });
  const dev = falsk ? { klient: falsk, priser, publicUrl: config.publicUrl, webhook: webhookDeps(abonnement) } : null;
  // The fake Stripe tells the real webhook handler about its own cancellations, the way Stripe does.
  if (falsk && dev) devHaendelser(falsk, dev.webhook);
  const loginVej: LoginVejDeps = {
    db, publicUrl: config.publicUrl, basedomain: config.basedomain, noegle: gk.noegle, ruter,
    login: async (c) => { const l = await adgang.login(c); return l ? { kontoId: l.konto.id, sessionId: l.session.id } : null; },
    samtykkeOk,
  };
  // KC-0188: "Lad support se med". The grant lives in konto/stoette.ts; the gateway gets it as seams (gateway/ never
  // imports konto/). givStoette is wired here and nowhere else: only the owner's switch on the tenant's own page
  // (gateway/stoette-vej.ts) turns support on; never sign-up, the fleet, billing or a script (a test holds this).
  const stoette: StoetteSeams = {
    giv: (a) => givStoette(db, a),
    annuller: (id, nu) => annullerStoette(db, id, nu),
    tilbagekald: (a) => tilbagekaldStoette(db, a),
    gyldig: (a) => stoetteGyldig(db, a),
    sessionStartet: (a) => sessionStartet(db, a),
    kvittering: (kontoId, a) => sendStoetteKvittering({ db, post: konto.post }, kontoId, a),
    kald,
  };
  const somPersonale = async (l: Awaited<ReturnType<typeof adgang.login>>) =>
    (l && await erPersonale(db, { kontoId: l.konto.id, sessionId: l.session.id, nu: new Date() }) ? { kontoId: l.konto.id, sessionId: l.session.id, csrf: l.session.csrf } : null);
  const stoetteSide: StoetteSideDeps = {
    db, publicUrl: config.publicUrl, basedomain: config.basedomain, noegle: gk.noegle,
    personale: async (c) => { const l = await adgang.login(c); return l ? somPersonale(l) : 'ikke-logget-ind'; },
    personaleBeskyttet: async (c, csrf) => somPersonale(await adgang.beskyttet(c, csrf)),
    aktive: (nu) => aktiveStoetter(db, nu),
    aabn: (a) => aabnStoette(db, a),
  };
  const gw: GatewayForbindelse = { noegle: gk.noegle, fejl: gk.fejl, status: gk.noegle ? 'ok' : 'mangler', ruter, loginVej, stoette, stoetteSide };
  const tilmelding = tilmeldingDeps({ config, db, adgang, abonnement, flaade, gateway: gk.noegle });
  return { konto, abonnement, dev, flaade, noegler: n.ring ? 'ok' : 'mangler', noeglefejl: n.fejl, gateway: gw, adgang, tilmelding };
}

/** KC-0183: Sky's one listener, dispatching on Host (the tunnel forwards the account host and *.<basedomain>
 *  here): the account host and loopback → the account app; <slug>.<basedomain> → the gateway; anything else → a
 *  plain 404 that says nothing about which names exist. */
export function fordeler(o: { kontoVaert: string; basedomain: string; sky: RequestListener; gateway: (req: IncomingMessage, res: ServerResponse, slug: string) => void }): RequestListener {
  return (req, res) => {
    const a = vaertsArt(req.headers.host, o);
    if (a.art === 'sky') { o.sky(req, res); return; }
    if (a.art === 'tenant') { o.gateway(req, res, a.slug); return; }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('Ikke fundet.');
  };
}

export async function main(): Promise<void> {
  const startet = Date.now();
  let config;
  let statusSide: string | null;
  try { config = laesConfig(process.env); statusSide = statusOrigin(process.env); } catch (err) {
    console.error(`sky: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }
  // KC-0181: with a fleet, no master key means no start (AGENTS §0 r7) — before anything connects or spawns.
  const noegler = noeglering(process.env);
  if (config.flaade.driver !== 'ingen' && !noegler.ring) {
    console.error(`sky: ${noegler.fejl}`);
    process.exitCode = 1;
    return;
  }
  // KC-0185: read (and remove from the environment) the R2 credentials before any child process is started.
  const kopiConfig = laesKopiConfig(process.env);
  // KC-0187 (D16): error reports, always on with a DSN; read (and removed from env) before any child process starts.
  const fejl = skyFejlrapport(process.env, { release: gitSha() });
  console.log(`sky: ${fejl.grund}`);
  const db = pgDatabase(config.databaseUrl);
  try {
    const m = await migrer(db);
    console.log(`sky: database på version ${m.version}${m.anvendt.length ? ` (anvendt nu: ${m.anvendt.join(', ')})` : ''}`);
  } catch (err) {
    console.error(`sky: migrering fejlede — starter ikke: ${(err as Error).message}`);
    await db.close();
    process.exitCode = 1;
    return;
  }
  if (config.dev) console.log('sky: SKY_DEV=1 — falsk post, udbakken ligger på /dev/udbakke (aldrig i produktion)');
  let f;
  try { f = await forbind(config, db, process.env, noegler); } catch (err) {
    console.error(`sky: ${(err as Error).message}`);
    await db.close();
    process.exitCode = 1;
    return;
  }
  console.log(`sky: betaling ${f.abonnement.klient ? `${f.abonnement.klient.tilstand}-tilstand${f.dev ? ' (falsk Stripe, Checkout på /dev/stripe)' : ''}` : 'ikke sat op (SKY_STRIPE_SECRET_KEY mangler): betalingssider svarer 503'}`);
  // KC-0182: the reconciler orders, resumes and cleans up tenants — a pass now (resuming anything a restart
  // interrupted), then every 15 s.
  const loekke = f.flaade ? afstemLoekke(f.flaade, { interval: 15_000 }) : null;
  console.log(`sky: flåde ${f.flaade ? `${f.flaade.flaade.navn}${f.flaade.billede ? ` (billede ${f.flaade.billede})` : ''}` : 'ingen (SKY_FLAADE ikke sat): ingen kunde får en beholder'}`);
  // KC-0181: the daily purge of keys whose 30 days have passed (crypto-shredding of a deleted tenant).
  const destruktion = destruktionsLoekke(db);
  // KC-0185: the nightly copies and the monthly restore drill (a pass now, then every 5 min; see planlaeg.ts).
  const kopi = kopiFra({ config, db, ring: noegler.ring, kopi: kopiConfig.kopi });
  const kopiStop = kopi.deps ? kopiLoekke(kopi.deps).stop : () => {};
  console.log(`sky: ${kopi.deps ? `sikkerhedskopier til R2 (${kopiConfig.kopi!.bucket}${kopiConfig.kopi!.jurisdiktion ? `, ${kopiConfig.kopi!.jurisdiktion}` : ''}) hver nat, 30 dage` : (kopiConfig.fejl ?? kopi.grund)}`);
  console.log(`sky: nøgler ${f.noegler === 'ok' ? 'masternøgle indlæst' : 'ingen masternøgle (ingen flåde, så intet kræver den)'}`);
  console.log(`sky: tilmelding ${config.tilmelding === 'open' ? 'åben (planvalg og Checkout med prøve)' : 'kun med invitation (lukket beta)'} på ${new URL(config.publicUrl).origin}/tilmeld`);
  console.log(`sky: gateway ${f.gateway.noegle ? `nøgle indlæst (id ${f.gateway.noegle.id}), kunder på *.${config.basedomain}` : `${f.gateway.fejl}`}`);
  // KC-0187: the alert rules every 5 min on the signals Sky has (backups, drills, rollouts), by mail to SKY_ALARM_TIL.
  const til = alarmModtager(process.env);
  const regler = alarmer({ post: f.konto.post, til, rapport: fejl.rapport });
  // KC-0194 (G6): the revenue watch rides the same rules (moms-graense): paid invoices over 12 months, read from Stripe at most every 6 h.
  const omsaetning = omsaetningsVagt({ klient: f.abonnement.klient, priser: f.abonnement.priser });
  const alarm = alarmLoekke({
    signaler: async (nu) => {
      const o = await omsaetning(nu);
      return { ...(await alarmSignaler(db, nu)), ...(o ? { omsaetning: o } : {}) };
    },
    alarm: regler, rapport: fejl.rapport, interval: 5 * 60_000,
  });
  // KC-0196: the grace stages' mails (day 7 needs no event; day 0 also goes out from the webhook). A pass now, then every 15 min.
  const fristJob = fristLoekke(koebDeps(f.abonnement), { interval: 15 * 60_000 });
  // KC-0200: the welcome mails (welcome when the Clawco is klar, tips on day 3, trial ending on day 12). Every 5 min.
  const velkomstJob = velkomstLoekke(velkomstDeps({ db, basedomain: config.basedomain, koeb: koebDeps(f.abonnement) }), { interval: 5 * 60_000 });
  console.log(`sky: alarmer ${til ? 'mailes til driftsadressen (SKY_ALARM_TIL)' : 'kun i loggen og fejlrapporten (SKY_ALARM_TIL ikke sat)'}`);
  // KC-0189: every minute each klar tenant's /health over the private network, the status components, and the
  // `tenant-usund` rule fed from the syg streaks (same rules instance, so an alert is never sent twice). Started once
  // the listener is up: the canary check asks Sky's own port.
  const fl = f.flaade ? { flaade: f.flaade.flaade.navn } : {};
  let helbredLoekke: { stop(): void } | null = null;
  const startHelbred = () => pollerLoekke({
    db,
    tenanter: () => klareTilUdrulning(db),
    sundhed: (adresse) => hentSundhed(adresse),
    komponenter: helbredKomponenter({ config, db, sha: gitSha(), startet, flaadeKlar: f.flaade !== null && f.noegler === 'ok', kopierSlaaetTil: kopi.deps !== null, noegler: f.noegler, gateway: f.gateway.status, ...fl }),
    usunde: async (liste, nu) => { await regler.vurder({ usunde: liste }, nu); },
    nu: () => new Date(),
    rapport: fejl.rapport,
  });
  console.log(`sky: status på ${new URL(config.publicUrl).origin}/status.json${statusSide ? ` (CORS for ${statusSide})` : ' (SKY_STATUS_ORIGIN ikke sat: ingen CORS)'}`);
  const status: StatusDeps = { feed: feedCache({ bygg: () => byggFeed(db, new Date()) }), origin: statusSide, side: `${statusSide ?? new URL(config.publicUrl).origin}/status`, feedUrl: `${new URL(config.publicUrl).origin}/status.atom` };
  const skyApp = createSkyApp({ db, sha: gitSha(), startet, konto: f.konto, abonnement: f.abonnement, dev: f.dev, noegler: f.noegler, gateway: f.gateway.status, ...(noegleskiftFra(config) ? { noegleskift: 'forberedt' as const } : {}), loginVej: f.gateway.loginVej, tilmelding: f.tilmelding, fejlrapport: fejl.rapport, stoetteSide: f.gateway.stoetteSide, status, ...fl });
  const gw = gateway({ db, publicUrl: config.publicUrl, basedomain: config.basedomain, noegle: f.gateway.noegle, ruter: f.gateway.ruter, samtykkeOk: f.gateway.loginVej.samtykkeOk, stoette: f.gateway.stoette, noterSet: noterSet({ db }) });
  // KC-0203: once a day (a pass at start) the klar beta tenants are asked for their consented measures over the signed
  // control call; a pass with no beta household is one query.
  const maalKald = kontrolKald({ noegle: f.gateway.noegle, timeoutMs: 10_000 });
  const betaMaal = hentLoekke({ db, hent: (t, sti) => maalKald.hent(t, sti) });
  // KC-0188: Sky's log records each support grant's expiry once (the gateway already refuses it by clock on every request).
  const udloeb = setInterval(() => {
    noterUdloebne(db, new Date())
      .then((ud) => { for (const a of ud) console.log(`sky stoette: udloebet ${a.slug} adgang=${a.id} personale=${a.personaleKontoId ?? '-'}`); })
      .catch((err: Error) => { console.error(`sky stoette: udløb kunne ikke noteres: ${err.message}`); });
  }, 60_000);
  udloeb.unref();
  const server = http.createServer(fordeler({ kontoVaert: new URL(config.publicUrl).hostname, basedomain: config.basedomain, sky: getRequestListener(skyApp.fetch), gateway: gw }));
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`Clawco Sky lytter på http://127.0.0.1:${config.port}`);
    helbredLoekke = startHelbred();
  });
  // KC-0221: never wait on an open stream; 5 s for busy requests, then exit (a timer or a proxy socket left
  // open must not keep Sky alive past systemd's stop timeout).
  const stop = () => {
    void stopPaaSignal({ server, frist: 5_000, foer: () => { loekke?.stop(); destruktion.stop(); kopiStop(); clearInterval(udloeb); alarm.stop(); fristJob.stop(); helbredLoekke?.stop(); velkomstJob.stop(); betaMaal.stop(); }, efter: () => db.close() })
      .then((kode) => process.exit(kode));
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
