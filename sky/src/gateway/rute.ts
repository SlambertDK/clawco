// The gateway's routing (KC-0183): which Host goes where, and the route table — the fleet's own tenant rows
// (KC-0182) in state `klar`, slug → private address and owner. Cached a few seconds and invalidated at once by
// the fleet's iGateway/udAfGateway hooks; membership is cached at most 30 seconds, and `glem` (also called when a
// member is removed or leaves, KC-0184) drops it at once. A database error is never
// answered from a guess: it propagates and the gateway answers 503.
import type { Database } from '../db/pool.ts';
import { erSlug } from '../delt/slug.ts';

export type VaertsArt = { art: 'sky' } | { art: 'tenant'; slug: string } | { art: 'ingen' };

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** The host name of a Host header: lower case, no port, no trailing dot. */
export function vaertsnavn(host: string | undefined): string {
  let h = (host ?? '').trim().toLowerCase();
  if (h.startsWith('[')) h = h.slice(0, h.indexOf(']') + 1);
  else h = h.replace(/:\d*$/, '');
  return h.replace(/\.$/, '');
}

/** The account host (and loopback, where deploy.sh reads /health) is Sky itself; one valid slug label directly
 *  under the base domain is a tenant; everything else is nobody — the same 404 whether a slug exists or not. */
export function vaertsArt(host: string | undefined, o: { kontoVaert: string; basedomain: string }): VaertsArt {
  const h = vaertsnavn(host);
  if (!h) return { art: 'ingen' };
  if (h === o.kontoVaert.toLowerCase() || LOOPBACK.has(h)) return { art: 'sky' };
  const hale = `.${o.basedomain.toLowerCase()}`;
  if (!h.endsWith(hale)) return { art: 'ingen' };
  const slug = h.slice(0, -hale.length);
  return erSlug(slug) ? { art: 'tenant', slug } : { art: 'ingen' };
}

/** `opdateres`: the tenant's container is being replaced (KC-0186): the gateway shows "Opdaterer, et øjeblik". */
export type Rute = { slug: string; adresse: string; ejerKontoId: number; opdateres: boolean };
export type RuteTabel = { find(slug: string): Promise<Rute | null>; medlem(slug: string, kontoId: number): Promise<boolean>; glem(slug: string): void };

export function ruteTabel(o: { db: Database; nu?: () => number; ttlMs?: number; medlemTtlMs?: number }): RuteTabel {
  const nu = o.nu ?? Date.now;
  const ttl = o.ttlMs ?? 5_000;
  const medlemTtl = Math.min(o.medlemTtlMs ?? 30_000, 30_000);
  const ruter = new Map<string, { r: Rute | null; til: number }>();
  const medlemmer = new Map<string, { ja: boolean; til: number }>();

  return {
    async find(slug) {
      const c = ruter.get(slug);
      if (c && c.til > nu()) return c.r;
      const [x] = await o.db.query<{ adresse: string | null; ejer_konto_id: unknown; opdateres: boolean }>(
        "SELECT adresse, ejer_konto_id, opdateres IS NOT NULL AS opdateres FROM flaade.tenant WHERE slug = $1 AND tilstand = 'klar'", [slug]);
      const r = x?.adresse ? { slug, adresse: x.adresse, ejerKontoId: Number(x.ejer_konto_id), opdateres: x.opdateres === true } : null;
      ruter.set(slug, { r, til: nu() + ttl });
      return r;
    },
    // The owner, and (KC-0184) every account with a membership row for this tenant; a deleted account is nobody.
    async medlem(slug, kontoId) {
      const n = `${slug} ${kontoId}`;
      const c = medlemmer.get(n);
      if (c && c.til > nu()) return c.ja;
      const r = await o.db.query(
        `SELECT 1 FROM flaade.tenant t JOIN konto k ON k.id = $2 AND k.slettet_ved IS NULL
          WHERE t.slug = $1 AND t.tilstand = 'klar'
            AND (t.ejer_konto_id = $2 OR EXISTS (SELECT 1 FROM medlemskab m WHERE m.tenant_id = t.slug AND m.konto_id = $2))`, [slug, kontoId]);
      const ja = r.length === 1;
      medlemmer.set(n, { ja, til: nu() + medlemTtl });
      return ja;
    },
    glem(slug) {
      ruter.delete(slug);
      for (const n of medlemmer.keys()) if (n.startsWith(`${slug} `)) medlemmer.delete(n);
    },
  };
}
