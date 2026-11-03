// The account app's routes (KC-0177). Thin: parse, check (Origin, CSRF, freshness), call, render.
// Lives on SKY_PUBLIC_URL only (gate G7); cookies are host-only (__Host-), never Domain=.
import fs from 'node:fs';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Database } from '../db/pool.ts';
import type { Besked, Post } from '../delt/post.ts';
import type { Haendelser } from '../delt/haendelser.ts';
import { nytToken } from './token.ts';
import { hentKonto, type Konto } from './konto.ts';
import { anmodLink, bekraeftKode, bekraeftLink, grupperKode, kodeFraToken, linkTilstand, LINK_MS } from './maillink.ts';
import { opretSession, hentSession, afslutSession, sessioner, tilbagekald, erFrisk, tjekOrigin, tjekCsrf, enhedNavn, SESSION_DAGE, type Metode, type Session } from './session.ts';
import { registreringsMuligheder, gemRegistrering, loginMuligheder, verificerLogin, passkeys, fjernPasskey, type Rp } from './passkey.ts';
import { sletKonto, sletOversigt, type Husstand, type TenantAfvikler } from './slet.ts';
import { opretEksportLink, gyldigtEksportLink, bygEksport, EKSPORT_MS, type EksportKilder } from './eksport.ts';
import { EKSEMPLER } from './eksempler.ts';
import { erSpaerret, fejlNoegle, taelOp, FEJL_PR_IP } from './graenser.ts';
import { hjaelpMail, type HjaelpFelter } from './hjaelp.ts';
import { annuller, ejersTenant, forbered, findInvitation, gensend, pladser, send, sidsteInviterer, ventendeInvitationer, erInviterRolle, type Entitlements, type Udkast } from './invitation.ts';
import { accepter, fjernMedlem, forlad, medlemmer, medlemskabFor, skiftRolle, type HusstandKald, type MedlemskabDeps } from './medlemskab.ts';
import { afmeldMedToken, gyldigtAfmeldToken, saetTips, vilHaveTips } from './mailvalg.ts';
import { CSS, hjaelpVisning, logIndSide, type ClawcoVisning, tjekMailSide, linkSide, kontoSide, passkeySide, sletSide, slettetSide, udbakkeSide, hentAltSide, hentAltKlarSide, hentAltDoedSide, hentAltFejlSide, renderEksempel, galleriSide, husstandSide, invitationPreviewSide, invitationSide, type HusstandFelter, mailsSide, afmeldSide } from './render.ts';
import { T } from './tekster.ts';

export type KontoDeps = {
  db: Database;
  post: Post;
  /** The fake Post's outbox; shown at /dev/udbakke only when `dev` is on. */
  udbakke: Besked[] | null;
  rp: Rp;
  publicUrl: string;
  dev: boolean;
  husstand: Husstand;
  afvikler: TenantAfvikler;
  haendelser: Haendelser;
  /** Billing's one-line summary for /konto (KC-0191), wired in server.ts; konto never imports abonnement/. */
  abonnement?: (kontoId: number) => Promise<{ plan: string; tekst: string; handlinger?: { href: string; tekst: string }[] }>;
  /** Where the account's Clawco is (KC-0182), wired in server.ts from the fleet; konto never imports fleet/. */
  clawco?: (kontoId: number) => Promise<ClawcoVisning>;
  /** KC-0201: the facts "Få hjælp" puts in the mail (plan and state, versions, placement), wired in server.ts from billing and the
   *  fleet; konto never imports them. Absent = no help link on /konto and no /konto/hjaelp. The account number and the last
   *  error code are added here, never taken from the seam. */
  hjaelp?: (kontoId: number) => Promise<Omit<HjaelpFelter, 'kontoId' | 'sidsteFejl'>>;
  /** KC-0201: the public help page's address, shown on /konto/hjaelp when wired. */
  hjaelpSide?: string;
  /** KC-0206: what "Hent alt" adds besides the account rows (the owner's tenant export, billing), wired in server.ts. */
  eksport?: EksportKilder;
  /** KC-0184: households — the signed call to the tenant (gateway/kontrolkald.ts), the plan's limit (Entitlements), the
   *  gateway's membership cache and a tenant's public address, wired in server.ts; konto never imports gateway/ or
   *  abonnement/. Absent = no household pages (404). */
  medlemskab?: { kald: HusstandKald; entitlements: Entitlements; glem(slug: string): void; url(slug: string): string };
  nu?: () => Date;
};

const SESSION = 'sky';
const BINDING = 'sky-binding';
/** KC-0198: where a mail link asked for from the sign-up flow lands; lives as long as the link. */
const TIL_COOKIE = 'sky-til';
const KLIENT_JS = fs.readFileSync(new URL('../../public/konto.js', import.meta.url), 'utf8');
/** Where a login may send the person on; anything else goes to /konto (no open redirect). Besides our own
 *  pages, the gateway's /aabn (KC-0183) with its query: a same-origin path whose own signature is checked there. */
const TIL = new Set(['/konto', '/konto/passkeys', '/konto/slet', '/konto/abonnement', '/konto/hent-alt', '/konto/hjaelp', '/konto/husstand', '/konto/mails', '/personale']); // KC-0188: the staff page
const AABN = /^\/aabn\?[A-Za-z0-9_.~%=&+-]{1,3000}$/;
/** KC-0198: the sign-up flow, with its own query (plan, interval, language) only. */
const TILMELD = /^\/tilmeld(\?[A-Za-z0-9_.~%=&+-]{1,300})?$/;
/** KC-0184: an invitation's own page, back after logging in with the invited address. */
const INVITATION = /^\/invitation\?t=[A-Za-z0-9_-]{43}$/;
const sikkerTil = (v: unknown): string => (typeof v === 'string' && (TIL.has(v) || AABN.test(v) || TILMELD.test(v) || INVITATION.test(v)) ? v : '/konto');

function erLoopback(a: string): boolean {
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

/** The client's address. Sky listens on 127.0.0.1 behind its TLS edge, which appends X-Forwarded-For;
 *  only then is the header trusted, and only its last entry (the one our edge wrote). */
function klientIp(c: Context): string {
  let fjern = '';
  try { fjern = getConnInfo(c).remote.address ?? ''; } catch { /* no socket (app.request in tests) */ }
  if (erLoopback(fjern)) {
    const sidste = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim();
    if (sidste) return sidste;
  }
  return fjern || 'ukendt';
}

export type Login = { session: Session; konto: Konto };

/** Who is logged in, and the gate for state-changing POSTs (Origin + the session's CSRF token).
 *  Exported so server.ts can hand the same checks to abonnement/ without an import between them. */
export function kontoAdgang(d: KontoDeps): { login(c: Context): Promise<Login | null>; beskyttet(c: Context, csrf: unknown): Promise<Login | null> } {
  const nu = d.nu ?? (() => new Date());
  async function login(c: Context): Promise<Login | null> {
    const token = getCookie(c, SESSION, 'host') ?? '';
    const session = await hentSession(d.db, token, nu());
    if (!session) return null;
    const konto = await hentKonto(d.db, session.kontoId);
    if (!konto) return null;
    if (session.forlaenget) saetSession(c, token);
    return { session, konto };
  }
  async function beskyttet(c: Context, csrf: unknown): Promise<Login | null> {
    if (!tjekOrigin(c.req.header('origin'), d.publicUrl)) return null;
    const l = await login(c);
    return l && tjekCsrf(l.session, typeof csrf === 'string' ? csrf : undefined) ? l : null;
  }
  return { login, beskyttet };
}

function saetSession(c: Context, token: string): void {
  setCookie(c, SESSION, token, { prefix: 'host', httpOnly: true, sameSite: 'Lax', maxAge: SESSION_DAGE * 86_400 });
}

export function kontoRuter(d: KontoDeps): Hono {
  const app = new Hono();
  const nu = d.nu ?? (() => new Date());
  const { login, beskyttet } = kontoAdgang(d);

  app.use('*', async (c, next) => {
    await next();
    c.header('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
    // same-origin: the link's token never leaves in a Referer, yet our own POSTs keep a real Origin
    // (no-referrer makes Chrome send 'Origin: null', which the Origin check refuses).
    c.header('Referrer-Policy', 'same-origin');
    c.header('X-Content-Type-Options', 'nosniff');
    if (!c.res.headers.get('cache-control')) c.header('Cache-Control', 'no-store');
  });
  app.use('*', bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.text('For stor', 413) }));

  const forbudt = (c: Context) => c.text('Forbudt', 403);

  /** A fresh session for this browser; the browser's previous one (any account) ends. */
  async function logIndSom(c: Context, kontoId: number, metode: Metode): Promise<void> {
    await afslutSession(d.db, getCookie(c, SESSION, 'host') ?? '');
    const { token } = await opretSession(d.db, { kontoId, metode, enhed: enhedNavn(c.req.header('user-agent')), nu: nu() });
    saetSession(c, token);
  }

  const formular = async (c: Context): Promise<Record<string, unknown>> => (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>;
  const jsonKrop = async (c: Context): Promise<Record<string, unknown>> => {
    const v: unknown = await c.req.json().catch(() => ({}));
    return typeof v === 'object' && v !== null ? v as Record<string, unknown> : {};
  };

  app.get('/sky.css', (c) => c.body(CSS, 200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=300' }));
  app.get('/konto.js', (c) => c.body(KLIENT_JS, 200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=300' }));
  app.get('/', (c) => c.redirect('/konto', 303));

  // --- Log in ---------------------------------------------------------------------------------
  app.get('/log-ind', (c) => c.html(logIndSide({ til: sikkerTil(c.req.query('til')) })));

  app.post('/log-ind/link', async (c) => {
    if (!tjekOrigin(c.req.header('origin'), d.publicUrl)) return forbudt(c);
    const f = await formular(c);
    const binding = getCookie(c, BINDING, 'host') || nytToken();
    setCookie(c, BINDING, binding, { prefix: 'host', httpOnly: true, sameSite: 'Lax', maxAge: LINK_MS / 1000 });
    // The link is bound to this browser, so where it lands can ride in a cookie of this browser too.
    const til = sikkerTil(f['til']);
    if (til !== '/konto') setCookie(c, TIL_COOKIE, til, { prefix: 'host', httpOnly: true, sameSite: 'Lax', maxAge: LINK_MS / 1000 });
    else deleteCookie(c, TIL_COOKIE, { prefix: 'host' });
    await anmodLink({ db: d.db, post: d.post, publicUrl: d.publicUrl }, { email: f['email'], binding, ip: klientIp(c), nu: nu() });
    return c.html(tjekMailSide());
  });

  app.get('/log-ind/link', async (c) => {
    const t = c.req.query('t') ?? '';
    const til = sikkerTil(getCookie(c, TIL_COOKIE, 'host'));
    const nytLink = til.startsWith('/tilmeld') ? { nytLink: til } : {};
    // KC-0246: in the browser that asked, the button as always; in any other (the phone that opened the mail) the code to type in
    // the first window. Looking never spends anything, so a mail scanner's GET burns neither the link nor the code.
    const tilstand = await linkTilstand(d.db, t, getCookie(c, BINDING, 'host') ?? '', nu());
    if (tilstand === 'anden-browser') return c.html(linkSide({ token: '', gyldig: true, kode: grupperKode(kodeFraToken(t)), ...nytLink }));
    return c.html(linkSide({ token: t, gyldig: tilstand === 'her', ...nytLink }));
  });

  /** A proven login (link or code): the binding and the landing cookie are spent, a fresh session starts, and the person goes on. */
  async function fuldfoerLogin(c: Context, kontoId: number, metode: Metode): Promise<Response> {
    deleteCookie(c, BINDING, { prefix: 'host' });
    const til = sikkerTil(getCookie(c, TIL_COOKIE, 'host'));
    deleteCookie(c, TIL_COOKIE, { prefix: 'host' });
    await logIndSom(c, kontoId, metode);
    return c.redirect(til, 303);
  }

  app.post('/log-ind/link/bekraeft', async (c) => {
    if (!tjekOrigin(c.req.header('origin'), d.publicUrl)) return forbudt(c);
    const f = await formular(c);
    const t = typeof f['t'] === 'string' ? f['t'] : '';
    const r = await bekraeftLink(d.db, { token: t, binding: getCookie(c, BINDING, 'host') ?? '', ip: klientIp(c), nu: nu() });
    if (!r) return c.html(linkSide({ token: '', gyldig: false, afvist: true }), 400);
    return fuldfoerLogin(c, r.kontoId, 'link');
  });

  // KC-0246: the code from the same mail, typed in the browser that asked for it. POST only (the code is never in a URL), the same
  // Origin check and per-IP failure budget as the link, the same browser binding; maillink.ts holds the rest of the rules.
  app.post('/log-ind/kode', async (c) => {
    if (!tjekOrigin(c.req.header('origin'), d.publicUrl)) return forbudt(c);
    const f = await formular(c);
    const r = await bekraeftKode(d.db, { kode: f['kode'], binding: getCookie(c, BINDING, 'host') ?? '', ip: klientIp(c), nu: nu() });
    if (r.ok) return fuldfoerLogin(c, r.kontoId, 'link');
    return c.html(tjekMailSide({ fejl: r.grund }), r.grund === 'for-mange' ? 429 : 400);
  });

  app.post('/log-ind/passkey/muligheder', async (c) => {
    if (!tjekOrigin(c.req.header('origin'), d.publicUrl)) return forbudt(c);
    return c.json(await loginMuligheder(d.db, d.rp, nu()));
  });

  app.post('/log-ind/passkey', async (c) => {
    if (!tjekOrigin(c.req.header('origin'), d.publicUrl)) return forbudt(c);
    const ip = klientIp(c);
    if (await erSpaerret(d.db, fejlNoegle(ip), FEJL_PR_IP, nu())) return c.json({ fejl: 'for-mange-forsoeg' }, 429);
    const b = await jsonKrop(c);
    const r = await verificerLogin(d.db, d.rp, b['svar'], nu());
    if (!r) {
      await taelOp(d.db, fejlNoegle(ip), FEJL_PR_IP, nu());
      return c.json({ fejl: 'afvist' }, 401);
    }
    await logIndSom(c, r.kontoId, 'passkey');
    return c.json({ til: sikkerTil(b['til']) });
  });

  app.post('/log-ud', async (c) => {
    const l = await beskyttet(c, (await formular(c))['csrf']);
    if (!l) return forbudt(c);
    await afslutSession(d.db, getCookie(c, SESSION, 'host') ?? '');
    deleteCookie(c, SESSION, { prefix: 'host' });
    return c.redirect('/log-ind', 303);
  });

  // --- The account ----------------------------------------------------------------------------
  app.get('/konto', async (c) => {
    const l = await login(c);
    if (!l) return c.redirect('/log-ind', 303);
    return c.html(kontoSide({
      email: l.konto.email, csrf: l.session.csrf, nuvaerendeId: l.session.id,
      passkeyAntal: (await passkeys(d.db, l.konto.id)).length, sessioner: await sessioner(d.db, l.konto.id, nu()),
      ...(d.abonnement ? { abonnement: await d.abonnement(l.konto.id) } : {}),
      ...(d.clawco ? { clawco: await d.clawco(l.konto.id) } : {}),
      ...(d.hjaelp ? { hjaelp: { mailto: hjaelpMail({ ...(await d.hjaelp(l.konto.id)), kontoId: l.konto.id }).mailto } } : {}),
      ...(d.medlemskab ? { husstand: true } : {}),
    }));
  });

  // --- Husstand (KC-0184): invite by mail with the owner's own click, members, roles, leaving -------------
  if (d.medlemskab) {
    const ms = d.medlemskab;
    const md: MedlemskabDeps = { db: d.db, kald: ms.kald, entitlements: ms.entitlements, glem: ms.glem };
    const inv = { db: d.db, publicUrl: d.publicUrl, entitlements: ms.entitlements, post: d.post };
    const fejl = (g: string): string => T.husstandFejl[g] ?? T.husstandFejl['ukendt']!;
    type Status = 200 | 400 | 403 | 404 | 409 | 429 | 502 | 503;

    async function husstand(c: Context, l: Login, o: { besked?: string; fejl?: string; felter?: HusstandFelter; status?: Status } = {}) {
      const t = await ejersTenant(d.db, l.konto.id);
      const a = { csrf: l.session.csrf, ...(o.besked ? { besked: o.besked } : {}), ...(o.fejl ? { fejl: o.fejl } : {}) };
      if (t) {
        return c.html(husstandSide({ ...a, visning: {
          art: 'ejer', url: ms.url(t.slug), medlemmer: await medlemmer(d.db, t.slug), invitationer: await ventendeInvitationer(d.db, t.slug, nu()),
          pladser: await pladser(inv, t.slug, nu()), felter: o.felter ?? { inviterer: await sidsteInviterer(d.db, l.konto.id) },
        } }), o.status ?? 200);
      }
      const m = await medlemskabFor(d.db, l.konto.id);
      return c.html(husstandSide({ ...a, visning: m ? { art: 'medlem', url: ms.url(m.tenantId), rolle: m.rolle, navn: m.navn } : { art: 'ingen' } }), o.status ?? 200);
    }
    const statusFor = (g: string): Status => (g === 'ikke-ejer' ? 403 : g === 'fuld' || g === 'ventende' || g === 'allerede-med' || g === 'ukendt' ? 409 : g === 'for-mange' ? 429 : g === 'post-fejl' ? 502 : g === 'tenant-nede' ? 503 : 400);
    const preview = (c: Context, l: Login, u: Udkast) => c.html(invitationPreviewSide({ csrf: l.session.csrf, id: u.id, token: u.token, til: u.til, emne: u.mail.emne, tekst: u.mail.tekst }));
    const id = (c: Context): number => (/^\d{1,18}$/.test(c.req.param('id') ?? '') ? Number(c.req.param('id')) : -1);
    const maks = async (kontoId: number): Promise<number> => {
      const t = await ejersTenant(d.db, kontoId);
      return t ? (await pladser(inv, t.slug, nu())).max : 1;
    };

    app.get('/konto/husstand', async (c) => {
      const l = await login(c);
      if (!l) return c.redirect('/log-ind?til=/konto/husstand', 303);
      const ok = T.husstandOk[c.req.query('ok') ?? ''];
      return husstand(c, l, ok ? { besked: ok } : {});
    });

    // Step 1: the exact mail, nothing sent.
    app.post('/konto/husstand/inviter', async (c) => {
      const f = await formular(c);
      const l = await beskyttet(c, f['csrf']);
      if (!l) return forbudt(c);
      const r = await forbered(inv, { ejerKontoId: l.konto.id, email: f['email'], navn: f['navn'], rolle: f['rolle'], inviterer: f['inviterer'], nu: nu() });
      if (r.ok) return preview(c, l, r.udkast);
      const felter: HusstandFelter = { email: String(f['email'] ?? ''), navn: String(f['navn'] ?? ''), rolle: erInviterRolle(f['rolle']) ? f['rolle'] : 'medlem', inviterer: String(f['inviterer'] ?? '') };
      return husstand(c, l, { fejl: r.grund === 'fuld' ? T.husstandFuld(r.max ?? 1) : fejl(r.grund), felter, status: statusFor(r.grund) });
    });

    // Step 2: the owner's own click sends what he saw.
    app.post('/konto/husstand/inviter/send', async (c) => {
      const f = await formular(c);
      const l = await beskyttet(c, f['csrf']);
      if (!l) return forbudt(c);
      const r = await send(inv, { ejerKontoId: l.konto.id, id: /^\d{1,18}$/.test(String(f['id'] ?? '')) ? Number(f['id']) : -1, token: f['t'], nu: nu() });
      if (r === 'sendt') return c.redirect('/konto/husstand?ok=sendt', 303);
      return husstand(c, l, { fejl: r === 'fuld' ? T.husstandFuld(await maks(l.konto.id)) : fejl(r), status: statusFor(r) });
    });

    app.post('/konto/husstand/invitationer/:id/igen', async (c) => {
      const l = await beskyttet(c, (await formular(c))['csrf']);
      if (!l) return forbudt(c);
      const r = await gensend(inv, { ejerKontoId: l.konto.id, id: id(c), nu: nu() });
      if (r.ok) return preview(c, l, r.udkast);
      return husstand(c, l, { fejl: r.grund === 'fuld' ? T.husstandFuld(await maks(l.konto.id)) : fejl(r.grund), status: statusFor(r.grund) });
    });

    app.post('/konto/husstand/invitationer/:id/annuller', async (c) => {
      const l = await beskyttet(c, (await formular(c))['csrf']);
      if (!l) return forbudt(c);
      const r = await annuller(d.db, { ejerKontoId: l.konto.id, id: id(c), nu: nu() });
      return r === 'ok' ? c.redirect('/konto/husstand?ok=annulleret', 303) : husstand(c, l, { fejl: fejl(r), status: statusFor(r) });
    });

    app.post('/konto/husstand/medlemmer/:id/rolle', async (c) => {
      const f = await formular(c);
      const l = await beskyttet(c, f['csrf']);
      if (!l) return forbudt(c);
      const rolle = f['rolle'];
      if (!erInviterRolle(rolle)) return husstand(c, l, { fejl: fejl('rolle'), status: 400 });
      const r = await skiftRolle(md, { ejerKontoId: l.konto.id, medlemKontoId: id(c), rolle });
      return r === 'ok' ? c.redirect('/konto/husstand?ok=rolle', 303) : husstand(c, l, { fejl: fejl(r), status: statusFor(r) });
    });

    app.post('/konto/husstand/medlemmer/:id/fjern', async (c) => {
      const l = await beskyttet(c, (await formular(c))['csrf']);
      if (!l) return forbudt(c);
      const r = await fjernMedlem(md, { ejerKontoId: l.konto.id, medlemKontoId: id(c) });
      return r === 'ok' ? c.redirect('/konto/husstand?ok=fjernet', 303) : husstand(c, l, { fejl: fejl(r), status: statusFor(r) });
    });

    app.post('/konto/husstand/forlad', async (c) => {
      const l = await beskyttet(c, (await formular(c))['csrf']);
      if (!l) return forbudt(c);
      const r = await forlad(md, { kontoId: l.konto.id });
      return r === 'tenant-nede' ? husstand(c, l, { fejl: fejl(r), status: 503 }) : c.redirect('/konto/husstand', 303);
    });

    // The invited person: GET shows (mail scanners only GET), POST accepts.
    app.get('/invitation', async (c) => {
      const t = c.req.query('t') ?? '';
      const aaben = await findInvitation(d.db, t, nu());
      if (!aaben) return c.html(invitationSide({ art: 'nej', tekst: T.invitationUgyldig }), 404);
      const l = await login(c);
      if (!l) return c.html(invitationSide({ art: 'log-ind', til: `/invitation?t=${t}` }));
      if (l.konto.email !== aaben.email) return c.html(invitationSide({ art: 'nej', tekst: T.invitationAndenEmail }), 403);
      return c.html(invitationSide({ art: 'aaben', csrf: l.session.csrf, token: t, inviterer: aaben.inviterer, rolle: aaben.rolle }));
    });

    app.post('/invitation', async (c) => {
      const f = await formular(c);
      const l = await beskyttet(c, f['csrf']);
      if (!l) return forbudt(c);
      const r = await accepter(md, { token: f['t'], kontoId: l.konto.id, nu: nu() });
      if (r.udfald === 'ok' || r.udfald === 'allerede-medlem') return c.html(invitationSide({ art: 'med', url: r.tenantId ? ms.url(r.tenantId) : null }));
      const NEJ: Record<string, [string, Status]> = {
        ugyldig: [T.invitationUgyldig, 404], 'anden-email': [T.invitationAndenEmail, 403], 'anden-husstand': [T.invitationAndenHusstand, 409],
        'ejer-selv': [T.invitationEjerSelv, 409], fuld: [T.invitationFuld, 409], 'tenant-nede': [fejl('tenant-nede'), 503],
      };
      const [tekst, status] = NEJ[r.udfald] ?? [T.invitationUgyldig, 404];
      return c.html(invitationSide({ art: 'nej', tekst }), status);
    });
  }

  // --- Få hjælp (KC-0201): the text the mail will carry, readable before it is sent ----------------------
  app.get('/konto/hjaelp', async (c) => {
    if (!d.hjaelp) return c.text('Ikke fundet', 404);
    const l = await login(c);
    if (!l) return c.redirect('/log-ind?til=/konto/hjaelp', 303);
    const fejl = c.req.query('fejl');
    const felter: HjaelpFelter = { ...(await d.hjaelp(l.konto.id)), kontoId: l.konto.id, ...(fejl ? { sidsteFejl: fejl } : {}) };
    return c.html(hjaelpVisning({ mail: hjaelpMail(felter), ...(d.hjaelpSide ? { hjaelpSide: d.hjaelpSide } : {}) }));
  });

  // --- KC-0200: the tips mail can be turned off (service mails cannot) ----------------------------------------------
  app.get('/konto/mails', async (c) => {
    const l = await login(c);
    if (!l) return c.redirect('/log-ind?til=/konto/mails', 303);
    return c.html(mailsSide({ csrf: l.session.csrf, tips: await vilHaveTips(d.db, l.konto.id), gemt: c.req.query('gemt') === '1' }));
  });

  app.post('/konto/mails', async (c) => {
    const f = await formular(c);
    const l = await beskyttet(c, f['csrf']);
    if (!l) return forbudt(c);
    await saetTips(d.db, l.konto.id, f['tips'] !== 'nej', nu());
    return c.redirect('/konto/mails?gemt=1', 303);
  });

  // The tips mail's unsubscribe link (RFC 8058). The token is the only key: no login, no Origin (the mail client's
  // one-click POST comes from elsewhere). A GET only shows the button, since link scanners fetch every link in a mail.
  const afmeldSprog = (c: Context): 'da' | 'en' | null => {
    const s = c.req.query('sprog') ?? 'da';
    return s === 'da' || s === 'en' ? s : null;
  };
  app.get('/post/afmeld', async (c) => {
    const sprog = afmeldSprog(c);
    const t = c.req.query('t') ?? '';
    if (!sprog || !(await gyldigtAfmeldToken(d.db, t))) return c.html(afmeldSide({ sprog: sprog ?? 'da', tilstand: 'ugyldig' }), 404);
    const u = new URL(c.req.url);
    return c.html(afmeldSide({ sprog, tilstand: 'spoerg', handling: `${u.pathname}${u.search}` }));
  });
  app.post('/post/afmeld', async (c) => {
    const sprog = afmeldSprog(c);
    if (!sprog || !(await afmeldMedToken(d.db, c.req.query('t') ?? '', nu()))) return c.html(afmeldSide({ sprog: sprog ?? 'da', tilstand: 'ugyldig' }), 404);
    return c.html(afmeldSide({ sprog, tilstand: 'faerdig' }));
  });

  app.post('/konto/sessioner/:id/afslut', async (c) => {
    const l = await beskyttet(c, (await formular(c))['csrf']);
    if (!l) return forbudt(c);
    await tilbagekald(d.db, l.konto.id, Number(c.req.param('id')));
    return c.redirect('/konto', 303);
  });

  const BESKEDER: Record<string, string> = { tilfoejet: T.passkeyTilfoejet, fjernet: T.passkeyFjernet, sidste: T.sidstePersonale };

  app.get('/konto/passkeys', async (c) => {
    const l = await login(c);
    if (!l) return c.redirect('/log-ind?til=/konto/passkeys', 303);
    const besked = BESKEDER[c.req.query('ok') ?? ''];
    return c.html(passkeySide({ csrf: l.session.csrf, frisk: erFrisk(l.session, nu()), passkeys: await passkeys(d.db, l.konto.id), ...(besked ? { besked } : {}) }));
  });

  app.post('/konto/passkeys/ny/muligheder', async (c) => {
    const l = await beskyttet(c, c.req.header('x-csrf'));
    if (!l) return forbudt(c);
    if (!erFrisk(l.session, nu())) return c.json({ fejl: 'ikke-frisk' }, 403);
    return c.json(await registreringsMuligheder(d.db, d.rp, l.konto, nu()));
  });

  app.post('/konto/passkeys/ny', async (c) => {
    const l = await beskyttet(c, c.req.header('x-csrf'));
    if (!l) return forbudt(c);
    if (!erFrisk(l.session, nu())) return c.json({ fejl: 'ikke-frisk' }, 403);
    const b = await jsonKrop(c);
    const ok = await gemRegistrering(d.db, d.rp, l.konto.id, b['svar'], typeof b['navn'] === 'string' ? b['navn'] : '', nu());
    return ok ? c.json({ til: '/konto/passkeys?ok=tilfoejet' }) : c.json({ fejl: 'afvist' }, 400);
  });

  app.post('/konto/passkeys/:id/fjern', async (c) => {
    const l = await beskyttet(c, (await formular(c))['csrf']);
    if (!l) return forbudt(c);
    if (!erFrisk(l.session, nu())) return c.redirect('/konto/passkeys', 303);
    const r = await fjernPasskey(d.db, l.konto.id, Number(c.req.param('id')));
    return c.redirect(r === 'ok' ? '/konto/passkeys?ok=fjernet' : r === 'sidste-personale' ? '/konto/passkeys?ok=sidste' : '/konto/passkeys', 303);
  });

  // --- Hent alt (KC-0206): a 24-hour link for this account; the zip is built when it is opened ----------
  app.get('/konto/hent-alt', async (c) => {
    const l = await login(c);
    if (!l) return c.redirect('/log-ind?til=/konto/hent-alt', 303);
    return c.html(hentAltSide({ csrf: l.session.csrf, frisk: erFrisk(l.session, nu()) }));
  });

  app.post('/konto/hent-alt', async (c) => {
    const l = await beskyttet(c, (await formular(c))['csrf']);
    if (!l) return forbudt(c);
    if (!erFrisk(l.session, nu())) return c.html(hentAltSide({ csrf: l.session.csrf, frisk: false }), 403);
    const t = await opretEksportLink(d.db, l.konto.id, nu());
    return c.html(hentAltKlarSide({ csrf: l.session.csrf, link: `/konto/hent-alt/fil?t=${t}`, udloeber: new Date(nu().getTime() + EKSPORT_MS) }));
  });

  app.get('/konto/hent-alt/fil', async (c) => {
    const l = await login(c);
    if (!l) return c.redirect('/log-ind?til=/konto/hent-alt', 303);
    if (!(await gyldigtEksportLink(d.db, c.req.query('t') ?? '', l.konto.id, nu()))) return c.html(hentAltDoedSide(), 404);
    let zip: Buffer;
    try {
      zip = await bygEksport({ db: d.db, husstand: d.husstand, kilder: d.eksport ?? {} }, l.konto.id, nu());
    } catch (err) {
      console.error('sky konto: Hent alt kunne ikke laves:', (err as Error).message);
      return c.html(hentAltFejlSide(), 503);
    }
    const dato = nu().toLocaleDateString('sv-SE', { timeZone: 'Europe/Copenhagen' });
    return c.body(new Uint8Array(zip), 200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="clawco-${dato}.zip"`, 'cache-control': 'no-store' });
  });

  // --- Delete ---------------------------------------------------------------------------------
  app.get('/konto/slet', async (c) => {
    const l = await login(c);
    if (!l) return c.redirect('/log-ind?til=/konto/slet', 303);
    const oversigt = await sletOversigt(d, l.konto.id);
    if (!oversigt) return c.redirect('/log-ind', 303);
    return c.html(sletSide({ csrf: l.session.csrf, frisk: erFrisk(l.session, nu()), oversigt }));
  });

  app.post('/konto/slet', async (c) => {
    const f = await formular(c);
    const l = await beskyttet(c, f['csrf']);
    if (!l) return forbudt(c);
    const oversigt = await sletOversigt(d, l.konto.id);
    if (!oversigt) return c.redirect('/log-ind', 303);
    let r;
    try {
      r = await sletKonto(d, { kontoId: l.konto.id, session: l.session, emailBekraeftelse: f['email'], nu: nu() });
    } catch (err) {
      console.error('sky konto: sletning fejlede, intet slettet:', (err as Error).message);
      return c.html(sletSide({ csrf: l.session.csrf, frisk: true, oversigt, fejl: T.sletFejl }), 503);
    }
    if (r === 'slettet') {
      deleteCookie(c, SESSION, { prefix: 'host' });
      return c.html(slettetSide());
    }
    if (r === 'forkert-email') return c.html(sletSide({ csrf: l.session.csrf, frisk: true, oversigt, fejl: T.sletForkertEmail }), 400);
    if (r === 'ikke-frisk') return c.html(sletSide({ csrf: l.session.csrf, frisk: false, oversigt }), 403);
    return c.redirect('/log-ind', 303);
  });

  // --- Development only -----------------------------------------------------------------------
  if (d.dev && d.udbakke) {
    const udbakke = d.udbakke;
    app.get('/dev/udbakke', (c) => c.html(udbakkeSide(udbakke)));
  }
  if (d.dev) {
    // KC-0206: every export and delete screen with its test data (eksempler.ts), without an account.
    app.get('/dev/konto', (c) => c.html(galleriSide(Object.keys(EKSEMPLER))));
    app.get('/dev/konto/:navn', (c) => {
      const e = EKSEMPLER[c.req.param('navn')];
      return e ? c.html(renderEksempel(e)) : c.text('Ikke fundet', 404);
    });
  }

  return app;
}
