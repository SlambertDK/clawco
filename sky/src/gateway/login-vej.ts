// The way in (KC-0183). A person without a valid tenant cookie is sent from <slug>.<basedomain> to Sky's own
// /aabn with the path they wanted (`next`, HMAC-signed so Sky only ever sends someone back where the gateway
// sent them from). Sky logs them in (KC-0177) if needed, checks membership, and sends them back to
// https://<slug>.<basedomain>/_sky/faa?kode=<one-time code>: 60 seconds, single use, bound to konto, Sky
// session and tenant, stored as SHA-256 only. The gateway (proxy.ts) exchanges it for the tenant cookie.
//
// KC-0272 (D1): a member's code is also bound to the browser that asked for it, the OAuth `state` way. The gateway's
// redirect to /aabn sets a random binding in a host-only cookie on the tenant host (BINDING_COOKIE) and puts only its
// SHA-256 (`b`) in the signed link; /aabn binds the code to `b`; /_sky/faa spends it only beside the cookie whose hash
// is `b`. A code minted in an attacker's browser therefore logs no other browser into the attacker's Clawco: the
// victim's browser never holds the attacker's binding, and a `__Host-` cookie cannot be planted from a sibling host.
// An /aabn link without `b` (the account page's button, an old link) issues no code: it sends the person to the
// tenant, whose gateway binds the browser and comes back. A staff member's support code (KC-0188) is not bound yet.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import type { Database } from '../db/pool.ts';
import { erSlug } from '../delt/slug.ts';
import type { GatewayNoegle } from './noegle.ts';
import type { RuteTabel } from './rute.ts';

export const KODE_MS = 60_000;
export const FAA = '/_sky/faa';

const hash = (kode: string): string => createHash('sha256').update(kode).digest('hex');
/** A member's code is stored as the hash of the code AND the browser's binding: only both together find the row. */
const bundetHash = (kode: string, b: string): string => createHash('sha256').update(`bundet\n${b}\n${kode}`).digest('hex');

/** KC-0272: the host-only cookie on the tenant host that binds a code to the browser that asked for it. */
export const BINDING_COOKIE = '__Host-sky-faa';
/** How long a browser keeps its binding: long enough to log in to Sky by mail link on the way. */
export const BINDING_SEK = 3600;
const B = /^[A-Za-z0-9_-]{43}$/;
export const nyBinding = (): string => randomBytes(32).toString('base64url');
/** What travels in the link and is bound to the code: the binding's SHA-256, never the binding itself. */
export const bindingHash = (v: string): string => createHash('sha256').update(v).digest('base64url');
export const erBinding = (v: unknown): v is string => typeof v === 'string' && B.test(v);

/** A path on the tenant's own host, or `/`: relative, never protocol-relative, no backslash or control
 *  characters (raw or percent-encoded), at most 2048 characters, never into /_sky/. */
export function sikkerNaeste(v: unknown): string {
  if (typeof v !== 'string' || v.length > 2048 || !v.startsWith('/') || v.startsWith('//')) return '/';
  if (/[\\\u0000-\u001f\u007f]|%(0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(v)) return '/';
  let u: URL;
  try { u = new URL(v, 'http://x.invalid'); } catch { return '/'; }
  if (u.origin !== 'http://x.invalid' || u.pathname === '/_sky' || u.pathname.startsWith('/_sky/')) return '/';
  return v;
}

/** `b` (KC-0272): the browser's binding hash, signed too, so a link cannot be re-bound to another browser. */
export function signerNaeste(n: Buffer, slug: string, naeste: string, b?: string): string {
  return createHmac('sha256', n).update(b === undefined ? `${slug}\n${naeste}` : `b1\n${slug}\n${naeste}\n${b}`).digest('base64url');
}

function tjekSignatur(n: Buffer, slug: string, naeste: string, s: string, b?: string): boolean {
  const ventet = Buffer.from(signerNaeste(n, slug, naeste, b));
  const givet = Buffer.from(s);
  return givet.length === ventet.length && timingSafeEqual(givet, ventet);
}

/** The tenant's own origin: its slug under the base domain, with the scheme and port of Sky's public URL. */
export function tenantOrigin(slug: string, publicUrl: string, basedomain: string): string {
  const u = new URL(publicUrl);
  return `${u.protocol}//${slug}.${basedomain}${u.port ? `:${u.port}` : ''}`;
}

/** `binding` (KC-0272): the browser's own binding (the cookie value); only its hash goes in the link. */
export function loginUrl(o: { publicUrl: string; noegle: GatewayNoegle; slug: string; naeste: string; binding?: string }): string {
  const u = new URL('/aabn', new URL(o.publicUrl).origin);
  const b = o.binding === undefined ? undefined : bindingHash(o.binding);
  u.searchParams.set('t', o.slug);
  u.searchParams.set('n', o.naeste);
  if (b !== undefined) u.searchParams.set('b', b);
  u.searchParams.set('s', signerNaeste(o.noegle.naeste, o.slug, o.naeste, b));
  return u.href;
}

/** `stoetteId` (KC-0188): a staff member's code from the staff page names the support grant it opens. `binding`
 *  (KC-0272): the asking browser's binding hash; a member's code is never made without one. */
export async function opretKode(db: Database, a: { kontoId: number; sessionId: number; slug: string; naeste: string; nu: Date; stoetteId?: number; binding?: string }): Promise<string> {
  if (a.stoetteId === undefined && !erBinding(a.binding)) throw new Error('en kode til et medlem kræver browserens binding');
  // Spent and expired codes are worthless; clear them as we go (the table stays small).
  await db.query('DELETE FROM gateway.kode WHERE udloeber < $1', [new Date(a.nu.getTime() - 3_600_000).toISOString()]);
  const kode = randomBytes(32).toString('base64url');
  await db.query(
    'INSERT INTO gateway.kode (hash, konto_id, session_id, slug, naeste, oprettet, udloeber, stoette_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [a.binding !== undefined ? bundetHash(kode, a.binding) : hash(kode), a.kontoId, a.sessionId, a.slug, sikkerNaeste(a.naeste), a.nu.toISOString(), new Date(a.nu.getTime() + KODE_MS).toISOString(), a.stoetteId ?? null],
  );
  return kode;
}

/** Spends the code for this tenant: who it was for and where they were going, or null (unknown, spent, expired,
 *  another tenant's, or — KC-0272 — presented without the binding hash of the browser that asked for it; only a
 *  support code is unbound). A single conditional UPDATE, so two concurrent exchanges cannot both succeed. */
export async function indloesKode(db: Database, kode: string, slug: string, nu: Date, binding?: string): Promise<{ kontoId: number; sessionId: number; naeste: string; stoetteId?: number } | null> {
  if (!B.test(kode)) return null;
  const bundet = erBinding(binding) ? bundetHash(kode, binding) : null;
  const [r] = await db.query<{ konto_id: unknown; session_id: unknown; naeste: string; stoette_id: unknown }>(
    `UPDATE gateway.kode SET brugt = $3 WHERE (hash = $4 OR (hash = $1 AND stoette_id IS NOT NULL)) AND slug = $2 AND brugt IS NULL AND udloeber > $3
     RETURNING konto_id, session_id, naeste, stoette_id`, [hash(kode), slug, nu.toISOString(), bundet]);
  if (!r) return null;
  return { kontoId: Number(r.konto_id), sessionId: Number(r.session_id), naeste: r.naeste, ...(r.stoette_id === null || r.stoette_id === undefined ? {} : { stoetteId: Number(r.stoette_id) }) };
}

export type LoginVejDeps = {
  db: Database;
  publicUrl: string;
  basedomain: string;
  noegle: GatewayNoegle | null;
  ruter: RuteTabel;
  /** Who is logged in to Sky (konto's session, handed in by server.ts: gateway/ never imports konto/). */
  login(c: Context): Promise<{ kontoId: number; sessionId: number } | null>;
  /** KC-0204: has the account accepted the CURRENT consent versions? If not, /aabn sends it to accept first. A throw
   *  is a 503 with no code issued. */
  samtykkeOk(kontoId: number): Promise<boolean>;
  nu?: () => Date;
};

const tekst = (c: Context, status: 400 | 403 | 404 | 503, t: string) => {
  c.header('Cache-Control', 'no-store');
  return c.text(t, status);
};

/** Sky's half: GET /aabn on the account host. */
export function loginVejRuter(d: LoginVejDeps): Hono {
  const app = new Hono();
  const nu = d.nu ?? (() => new Date());
  app.get('/aabn', async (c) => {
    if (!d.noegle) return tekst(c, 503, 'Adgangen til Clawco er ikke sat op endnu.');
    const slug = c.req.query('t') ?? '';
    const naeste = c.req.query('n') ?? '';
    const b = c.req.query('b');
    if (!erSlug(slug) || (b !== undefined && !erBinding(b)) || !tjekSignatur(d.noegle.naeste, slug, naeste, c.req.query('s') ?? '', b)) return tekst(c, 400, 'Linket er ugyldigt.');
    try {
      const l = await d.login(c);
      if (!l) {
        c.header('Cache-Control', 'no-store');
        return c.redirect(`/log-ind?til=${encodeURIComponent(`/aabn?${new URL(c.req.url).searchParams.toString()}`)}`, 303);
      }
      if (!(await d.ruter.find(slug))) return tekst(c, 404, 'Ikke fundet.');
      if (!(await d.ruter.medlem(slug, l.kontoId))) return tekst(c, 403, 'Du har ikke adgang til denne Clawco.');
      if (!(await d.samtykkeOk(l.kontoId))) {
        c.header('Cache-Control', 'no-store');
        return c.redirect('/tilmeld', 303);
      }
      c.header('Cache-Control', 'no-store');
      // KC-0272: no binding, no code — the tenant's gateway binds this browser and sends it back here.
      if (b === undefined) return c.redirect(`${tenantOrigin(slug, d.publicUrl, d.basedomain)}${sikkerNaeste(naeste)}`, 303);
      const kode = await opretKode(d.db, { kontoId: l.kontoId, sessionId: l.sessionId, slug, naeste: sikkerNaeste(naeste), nu: nu(), binding: b });
      c.header('Referrer-Policy', 'no-referrer');
      return c.redirect(`${tenantOrigin(slug, d.publicUrl, d.basedomain)}${FAA}?kode=${kode}`, 303);
    } catch (err) {
      console.error('sky gateway: /aabn fejlede:', (err as Error).message);
      return tekst(c, 503, 'Prøv igen om lidt.');
    }
  });
  return app;
}
