// "Lad support se med" (KC-0188, spec D15), the gateway's half. Three ways in, all here:
// - the owner's switch: the tenant's own card posts to <slug>/_sky/stoette (on) and /_sky/stoette/slaa-fra (off). The
//   gateway answers it itself, never forwarding: only the tenant's owner, only from the tenant's own origin. On: Sky
//   makes the grant (konto/stoette.ts through a seam), tells the tenant with a bevis only Sky can sign (signer.ts,
//   prefix s1.), then sends the owner a notice mail; if either fails, the grant is rolled back. Off: Sky revokes first
//   (the gateway stops at once), then tells the tenant.
// - the staff page on the account host (GET /personale, POST /personale/aabn): only staff logged in by passkey; a live
//   grant opens with a one-time code carrying the grant (gateway.kode.stoette_id), exchanged at /_sky/faa (proxy.ts).
// - every request of a support session (kind `stoette`, proxy.ts): the grant is asked again (no cache), only GET and
//   HEAD pass, and the tenant gets the support claims (sa, su, sn) beside the staff identity.
// gateway/ never imports konto/: the grant's functions arrive as seams from server.ts.
import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Hono, type Context } from 'hono';
import type { Database } from '../db/pool.ts';
import { html } from '../delt/html.ts';
import { side } from '../delt/side.ts';
import type { GatewayNoegle } from './noegle.ts';
import type { TenantKald } from './tenantkald.ts';
import { FAA, opretKode, tenantOrigin } from './login-vej.ts';

export const KONTAKT = '/_sky/stoette';
export const SLAA_FRA = '/_sky/stoette/slaa-fra';

/** The shape of a grant the gateway needs (konto/stoette.ts' Adgang fits it). */
export type StoetteAdgang = { id: number; slug: string; givet: Date; udloeber: Date; grund: string; personaleKontoId: number | null };
export type GivSvar = { ok: true; adgang: StoetteAdgang } | { ok: false; grund: 'ikke-ejer' | 'ugyldig-tid' | 'ugyldig-grund' };

export type StoetteSeams = {
  giv(a: { slug: string; kontoId: number; timer: unknown; grund: unknown; nu: Date }): Promise<GivSvar>;
  annuller(id: number, nu: Date): Promise<void>;
  tilbagekald(a: { slug: string; kontoId: number; nu: Date }): Promise<number[] | null>;
  gyldig(a: { id: number; slug: string; personaleKontoId: number; sessionId: number; nu: Date }): Promise<StoetteAdgang | null>;
  sessionStartet(a: { id: number; personaleKontoId: number; nu: Date }): Promise<void>;
  /** The notice mail to the owner (template stoette-startet). A throw rolls the grant back. */
  kvittering(kontoId: number, a: { timer: number; udloeber: Date }): Promise<void>;
  kald: Pick<TenantKald, 'stoetteStart' | 'stoetteSlut'>;
};

/** Plain Danish answers (the staff member's and the owner's own screens). */
export const TEKST = {
  kunSe: 'Support kan kun se med og kan ikke ændre noget i en kundes Clawco.',
  slut: 'Støtteadgangen er slut. Ejeren har slået den fra, eller tiden er gået.',
  ikkeAaben: 'Støtteadgangen er ikke åben længere, eller en anden fra support har den.',
  kunEjer: 'Kun ejeren kan slå support til og fra.',
  ugyldig: 'Vælg 1, 4 eller 24 timer, og skriv højst én linje på 120 tegn.',
  tenantNede: 'Din Clawco svarede ikke, så support blev ikke slået til. Prøv igen om lidt.',
  postNede: 'Clawco kunne ikke sende dig en kvittering på mail, så support blev ikke slået til. Prøv igen om lidt.',
  slaaetFraTenantNede: 'Support er slået fra og kan ikke komme ind. Din Clawco svarede ikke, så båndet kan stå lidt endnu.',
} as const;

export const sek = (d: Date): number => Math.floor(d.getTime() / 1000);
export const nySessionId = (): string => randomBytes(8).toString('hex');
export const timerAf = (a: Pick<StoetteAdgang, 'givet' | 'udloeber'>): number => Math.round((a.udloeber.getTime() - a.givet.getTime()) / 3_600_000);

/** A small form body (the switch's two fields); null when it is too big. */
export async function laesFormular(req: IncomingMessage, maks = 4096): Promise<URLSearchParams | null> {
  let krop = '';
  for await (const del of req) {
    krop += String(del);
    if (krop.length > maks) return null;
  }
  return new URLSearchParams(krop);
}

const klokke = (d: Date): string => new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(':', '.');

export type StoetteSideDeps = {
  db: Database;
  publicUrl: string;
  basedomain: string;
  noegle: GatewayNoegle | null;
  /** Who is logged in to Sky as staff by passkey (server.ts: konto's session + konto/stoette.ts' erPersonale). */
  personale(c: Context): Promise<{ kontoId: number; sessionId: number; csrf: string } | 'ikke-logget-ind' | null>;
  /** The same for a POST: also Origin and the session's CSRF token. */
  personaleBeskyttet(c: Context, csrf: unknown): Promise<{ kontoId: number; sessionId: number } | null>;
  aktive(nu: Date): Promise<StoetteAdgang[]>;
  aabn(a: { id: number; personaleKontoId: number; sessionId: number; nu: Date }): Promise<StoetteAdgang | null>;
  nu?: () => Date;
};

const CSP = "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https: http://localhost:* http://*.localhost:*; object-src 'none'";

/** The staff page on the account host: the grants that are on now, each with "Åbn med støtteadgang". */
export function stoetteVejRuter(d: StoetteSideDeps): Hono {
  const app = new Hono();
  const nu = d.nu ?? (() => new Date());
  app.use('/personale', async (c, next) => { await next(); c.header('Content-Security-Policy', CSP); c.header('Cache-Control', 'no-store'); c.header('Referrer-Policy', 'same-origin'); c.header('X-Content-Type-Options', 'nosniff'); });
  app.use('/personale/*', async (c, next) => { await next(); c.header('Cache-Control', 'no-store'); c.header('X-Content-Type-Options', 'nosniff'); });

  app.get('/personale', async (c) => {
    const l = await d.personale(c);
    if (l === 'ikke-logget-ind') return c.redirect(`/log-ind?til=${encodeURIComponent('/personale')}`, 303);
    if (!l) return c.text('Kun for Clawco-personale, logget ind med passkey.', 403);
    const aktive = await d.aktive(nu());
    const liste = aktive.length
      ? html`<ul class="liste">${aktive.map((a) => html`<li data-stoette-adgang="${a.id}"><span><strong>${a.slug}</strong> · til kl. ${klokke(a.udloeber)}${a.grund ? html`<br><small>${a.grund}</small>` : ''}${a.personaleKontoId !== null && a.personaleKontoId !== l.kontoId ? html`<br><small>En anden fra support har den.</small>` : ''}</span>${a.personaleKontoId === null || a.personaleKontoId === l.kontoId ? html`<form class="inline" method="post" action="/personale/aabn"><input type="hidden" name="id" value="${a.id}"><input type="hidden" name="csrf" value="${l.csrf}"><button type="submit" class="primaer lille">Åbn med støtteadgang</button></form>` : ''}</li>`)}</ul>`
      : html`<p class="daempet">Ingen kunde har slået "Lad support se med" til lige nu.</p>`;
    return c.html(side('Støtteadgang', html`<h1>Støtteadgang</h1><p class="daempet">Du ser kun de Clawco'er, hvis ejer selv har slået "Lad support se med" til. Du kan kun se, ikke ændre noget, og alt du åbner, står i kundens log.</p><section>${liste}</section>`, { csrf: l.csrf }));
  });

  app.post('/personale/aabn', async (c) => {
    const f = (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>;
    const l = await d.personaleBeskyttet(c, f['csrf']);
    if (!l) return c.text('Forbudt', 403);
    const id = Number(f['id']);
    if (!Number.isSafeInteger(id) || id <= 0) return c.text(TEKST.ikkeAaben, 403);
    const a = await d.aabn({ id, personaleKontoId: l.kontoId, sessionId: l.sessionId, nu: nu() });
    if (!a) return c.text(TEKST.ikkeAaben, 403);
    if (!d.noegle) return c.text('Adgangen til Clawco er ikke sat op endnu.', 503);
    const kode = await opretKode(d.db, { kontoId: l.kontoId, sessionId: l.sessionId, slug: a.slug, naeste: '/rum/hjem', nu: nu(), stoetteId: a.id });
    c.header('Referrer-Policy', 'no-referrer');
    return c.redirect(`${tenantOrigin(a.slug, d.publicUrl, d.basedomain)}${FAA}?kode=${kode}`, 303);
  });
  return app;
}
