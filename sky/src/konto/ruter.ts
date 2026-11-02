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
import { anmodLink, bekraeftLink, findLink, LINK_MS } from './maillink.ts';
import { opretSession, hentSession, afslutSession, sessioner, tilbagekald, erFrisk, tjekOrigin, tjekCsrf, enhedNavn, SESSION_DAGE, type Metode, type Session } from './session.ts';
import { registreringsMuligheder, gemRegistrering, loginMuligheder, verificerLogin, passkeys, fjernPasskey, type Rp } from './passkey.ts';
import { sletKonto, sletOversigt, type Husstand, type TenantAfvikler } from './slet.ts';
import { opretEksportLink, gyldigtEksportLink, bygEksport, EKSPORT_MS, type EksportKilder } from './eksport.ts';
import { EKSEMPLER } from './eksempler.ts';
import { erSpaerret, fejlNoegle, taelOp, FEJL_PR_IP } from './graenser.ts';
import { hjaelpMail, type HjaelpFelter } from './hjaelp.ts';
import { CSS, hjaelpVisning, logIndSide, type ClawcoVisning, tjekMailSide, linkSide, kontoSide, passkeySide, sletSide, slettetSide, udbakkeSide, hentAltSide, hentAltKlarSide, hentAltDoedSide, hentAltFejlSide, renderEksempel, galleriSide } from './render.ts';
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
  abonnement?: (kontoId: number) => Promise<{ plan: string; tekst: string }>;
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
  nu?: () => Date;
};

const SESSION = 'sky';
const BINDING = 'sky-binding';
/** KC-0198: where a mail link asked for from the sign-up flow lands; lives as long as the link. */
const TIL_COOKIE = 'sky-til';
const KLIENT_JS = fs.readFileSync(new URL('../../public/konto.js', import.meta.url), 'utf8');
/** Where a login may send the person on; anything else goes to /konto (no open redirect). Besides our own
 *  pages, the gateway's /aabn (KC-0183) with its query: a same-origin path whose own signature is checked there. */
const TIL = new Set(['/konto', '/konto/passkeys', '/konto/slet', '/konto/abonnement', '/konto/hent-alt', '/konto/hjaelp']);
const AABN = /^\/aabn\?[A-Za-z0-9_.~%=&+-]{1,3000}$/;
/** KC-0198: the sign-up flow, with its own query (plan, interval, language) only. */
const TILMELD = /^\/tilmeld(\?[A-Za-z0-9_.~%=&+-]{1,300})?$/;
const sikkerTil = (v: unknown): string => (typeof v === 'string' && (TIL.has(v) || AABN.test(v) || TILMELD.test(v)) ? v : '/konto');

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
    return c.html(linkSide({ token: t, gyldig: await findLink(d.db, t, nu()), ...(til.startsWith('/tilmeld') ? { nytLink: til } : {}) }));
  });

  app.post('/log-ind/link/bekraeft', async (c) => {
    if (!tjekOrigin(c.req.header('origin'), d.publicUrl)) return forbudt(c);
    const f = await formular(c);
    const t = typeof f['t'] === 'string' ? f['t'] : '';
    const r = await bekraeftLink(d.db, { token: t, binding: getCookie(c, BINDING, 'host') ?? '', ip: klientIp(c), nu: nu() });
    if (!r) return c.html(linkSide({ token: '', gyldig: false, afvist: true }), 400);
    deleteCookie(c, BINDING, { prefix: 'host' });
    const til = sikkerTil(getCookie(c, TIL_COOKIE, 'host'));
    deleteCookie(c, TIL_COOKIE, { prefix: 'host' });
    await logIndSom(c, r.kontoId, 'link');
    return c.redirect(til, 303);
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
    }));
  });

  // --- Få hjælp (KC-0201): the text the mail will carry, readable before it is sent ----------------------
  app.get('/konto/hjaelp', async (c) => {
    if (!d.hjaelp) return c.text('Ikke fundet', 404);
    const l = await login(c);
    if (!l) return c.redirect('/log-ind?til=/konto/hjaelp', 303);
    const fejl = c.req.query('fejl');
    const felter: HjaelpFelter = { ...(await d.hjaelp(l.konto.id)), kontoId: l.konto.id, ...(fejl ? { sidsteFejl: fejl } : {}) };
    return c.html(hjaelpVisning({ mail: hjaelpMail(felter), ...(d.hjaelpSide ? { hjaelpSide: d.hjaelpSide } : {}) }));
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
