// The public status feed (KC-0189): GET /status.json on the Sky app host, read by the status page (KC-0175).
// Invariant (AGENTS §0 r2, §4): derived data only. The tenants are a percentage and a count of buckets, never a list;
// no slug, tenant id, account id, email, node name or address appears anywhere (a test greps a 50-tenant feed for
// them). A component without a fresh pass — the poller stopped, Sky restarted, a probe failed — is `nedsat`, never a
// stale or invented `ok`. Cached for 30 seconds; CORS open for the status page's origin only (SKY_STATUS_ORIGIN).
import { Hono } from 'hono';
import type { Database } from '../../db/pool.ts';
import { haendelserTilFeed, type FeedHaendelse } from './haendelse.ts';
import { oppetid90, senestePass } from './historik.ts';
import { KERNE, NAVNE } from './komponenter.ts';
import { POLL_MS } from './poller.ts';
import { andelSund, KOMPONENTER, type Antal, type KomponentId, type Status } from './vurder.ts';

/** A pass older than this is not current: its components show as nedsat. */
export const FRISK_MS = 3 * POLL_MS;
export const CACHE_MS = 30_000;

export type FeedKomponent = { id: KomponentId; navn: string; status: Status; oppetid90d: number | null; andelSund?: number | null; antal?: Antal };
export type Feed = { opdateret: string; samlet: Status; komponenter: FeedKomponent[]; haendelser: FeedHaendelse[] };

/** nede when a core component (login, adgang, the tenants) is nede; else nedsat when anything is not ok. */
export function samlet(k: { id: string; status: Status }[]): Status {
  if (k.some((x) => x.status === 'nede' && (KERNE as readonly string[]).includes(x.id))) return 'nede';
  return k.every((x) => x.status === 'ok') && k.length ? 'ok' : 'nedsat';
}

export async function byggFeed(db: Database, nu: Date): Promise<Feed> {
  const pas = await senestePass(db);
  const alder = pas ? nu.getTime() - pas.tid.getTime() : Infinity;
  const frisk = pas !== null && alder >= -POLL_MS && alder <= FRISK_MS;
  const oppe = await oppetid90(db, nu);
  const komponenter = KOMPONENTER.map((id): FeedKomponent => {
    const k: FeedKomponent = { id, navn: NAVNE[id], status: frisk ? (pas.komponenter.get(id) ?? 'nedsat') : 'nedsat', oppetid90d: oppe[id] };
    if (id === 'clawco') {
      const antal: Antal = frisk ? { ...pas.antal } : { sund: 0, traeg: 0, syg: 0, opdaterer: 0 };
      k.andelSund = andelSund(antal);
      k.antal = antal;
    }
    return k;
  });
  return { opdateret: (pas?.tid ?? nu).toISOString(), samlet: samlet(komponenter), komponenter, haendelser: await haendelserTilFeed(db, nu) };
}

/** One build per `ttlMs`, shared by concurrent requests; a failed build is not kept. */
export function feedCache(o: { bygg: () => Promise<Feed>; nu?: () => number; ttlMs?: number }): () => Promise<Feed> {
  const nu = o.nu ?? Date.now;
  const ttl = o.ttlMs ?? CACHE_MS;
  let gemt: { til: number; feed: Promise<Feed> } | null = null;
  return () => {
    if (gemt && nu() < gemt.til) return gemt.feed;
    const feed = o.bygg();
    const denne = { til: nu() + ttl, feed };
    gemt = denne;
    feed.catch(() => { if (gemt === denne) gemt = null; });
    return feed;
  };
}

/** SKY_STATUS_ORIGIN: the status page's origin (https://host, no path), or null (no CORS header: same origin only). */
export function statusOrigin(env: Record<string, string | undefined>): string | null {
  const v = (env['SKY_STATUS_ORIGIN'] ?? '').trim();
  if (!v) return null;
  let u: URL;
  try { u = new URL(v); } catch { throw new Error('SKY_STATUS_ORIGIN er ugyldig: skal være en adresse som https://status.eksempel.dk — Sky starter ikke'); }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.origin !== v.replace(/\/$/, '')) throw new Error('SKY_STATUS_ORIGIN er ugyldig: kun protokol og værtsnavn, ingen sti — Sky starter ikke');
  return u.origin;
}

export type StatusDeps = { feed: () => Promise<Feed>; origin: string | null };

export function statusRuter(o: StatusDeps): Hono {
  const app = new Hono();
  app.get('/status.json', async (c) => {
    const cors: Record<string, string> = o.origin ? { 'access-control-allow-origin': o.origin, vary: 'origin' } : {};
    let f: Feed;
    try { f = await o.feed(); } catch {
      console.error('sky status: feedet kunne ikke bygges');
      return c.json({ fejl: 'status kan ikke hentes lige nu' }, 503, { ...cors, 'cache-control': 'no-store' });
    }
    return c.json(f, 200, { ...cors, 'cache-control': `public, max-age=${CACHE_MS / 1000}`, 'x-content-type-options': 'nosniff' });
  });
  return app;
}
