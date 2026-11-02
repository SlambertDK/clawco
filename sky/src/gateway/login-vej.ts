// The way in (KC-0183). A person without a valid tenant cookie is sent from <slug>.<basedomain> to Sky's own
// /aabn with the path they wanted (`next`, HMAC-signed so Sky only ever sends someone back where the gateway
// sent them from). Sky logs them in (KC-0177) if needed, checks membership, and sends them back to
// https://<slug>.<basedomain>/_sky/faa?kode=<one-time code>: 60 seconds, single use, bound to konto, Sky
// session and tenant, stored as SHA-256 only. The gateway (proxy.ts) exchanges it for the tenant cookie.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import type { Database } from '../db/pool.ts';
import { erSlug } from '../delt/slug.ts';
import type { GatewayNoegle } from './noegle.ts';
import type { RuteTabel } from './rute.ts';

export const KODE_MS = 60_000;
export const FAA = '/_sky/faa';

const hash = (kode: string): string => createHash('sha256').update(kode).digest('hex');

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

export function signerNaeste(n: Buffer, slug: string, naeste: string): string {
  return createHmac('sha256', n).update(`${slug}\n${naeste}`).digest('base64url');
}

function tjekSignatur(n: Buffer, slug: string, naeste: string, s: string): boolean {
  const ventet = Buffer.from(signerNaeste(n, slug, naeste));
  const givet = Buffer.from(s);
  return givet.length === ventet.length && timingSafeEqual(givet, ventet);
}

/** The tenant's own origin: its slug under the base domain, with the scheme and port of Sky's public URL. */
export function tenantOrigin(slug: string, publicUrl: string, basedomain: string): string {
  const u = new URL(publicUrl);
  return `${u.protocol}//${slug}.${basedomain}${u.port ? `:${u.port}` : ''}`;
}

export function loginUrl(o: { publicUrl: string; noegle: GatewayNoegle; slug: string; naeste: string }): string {
  const u = new URL('/aabn', new URL(o.publicUrl).origin);
  u.searchParams.set('t', o.slug);
  u.searchParams.set('n', o.naeste);
  u.searchParams.set('s', signerNaeste(o.noegle.naeste, o.slug, o.naeste));
  return u.href;
}

export async function opretKode(db: Database, a: { kontoId: number; sessionId: number; slug: string; naeste: string; nu: Date }): Promise<string> {
  // Spent and expired codes are worthless; clear them as we go (the table stays small).
  await db.query('DELETE FROM gateway.kode WHERE udloeber < $1', [new Date(a.nu.getTime() - 3_600_000).toISOString()]);
  const kode = randomBytes(32).toString('base64url');
  await db.query(
    'INSERT INTO gateway.kode (hash, konto_id, session_id, slug, naeste, oprettet, udloeber) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [hash(kode), a.kontoId, a.sessionId, a.slug, sikkerNaeste(a.naeste), a.nu.toISOString(), new Date(a.nu.getTime() + KODE_MS).toISOString()],
  );
  return kode;
}

/** Spends the code for this tenant: who it was for and where they were going, or null (unknown, spent, expired,
 *  another tenant's). A single conditional UPDATE, so two concurrent exchanges cannot both succeed. */
export async function indloesKode(db: Database, kode: string, slug: string, nu: Date): Promise<{ kontoId: number; sessionId: number; naeste: string } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(kode)) return null;
  const [r] = await db.query<{ konto_id: unknown; session_id: unknown; naeste: string }>(
    `UPDATE gateway.kode SET brugt = $3 WHERE hash = $1 AND slug = $2 AND brugt IS NULL AND udloeber > $3
     RETURNING konto_id, session_id, naeste`, [hash(kode), slug, nu.toISOString()]);
  return r ? { kontoId: Number(r.konto_id), sessionId: Number(r.session_id), naeste: r.naeste } : null;
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
    if (!erSlug(slug) || !tjekSignatur(d.noegle.naeste, slug, naeste, c.req.query('s') ?? '')) return tekst(c, 400, 'Linket er ugyldigt.');
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
      const kode = await opretKode(d.db, { kontoId: l.kontoId, sessionId: l.sessionId, slug, naeste: sikkerNaeste(naeste), nu: nu() });
      c.header('Cache-Control', 'no-store');
      c.header('Referrer-Policy', 'no-referrer');
      return c.redirect(`${tenantOrigin(slug, d.publicUrl, d.basedomain)}${FAA}?kode=${kode}`, 303);
    } catch (err) {
      console.error('sky gateway: /aabn fejlede:', (err as Error).message);
      return tekst(c, 503, 'Prøv igen om lidt.');
    }
  });
  return app;
}
