// GET /health: is Sky running, does the database answer, which version. No secrets, no tenant data,
// and never the database's own error text (it can carry a host or user name).
import type { Database } from './db/pool.ts';

export type Helbred = { ok: boolean; sha: string; uptimeSec: number; db: { ok: boolean; version: number | null }; flaade?: string; noegler?: 'ok' | 'mangler'; gateway?: 'ok' | 'mangler'; noegleskift?: 'forberedt'; netfilter?: 'ok' | 'mangler' | 'forældet' };

/** flaade: the fleet driver's name (KC-0182), when SKY_FLAADE chose one. noegler (KC-0181): whether the master key
 *  is loaded — one word, never a value; with a fleet, `mangler` makes /health 503 (no tenant can be started). */
/** gateway (KC-0183): whether the gateway's signing key is loaded — one word; with a fleet, `mangler` makes /health
 *  503 (every tenant host answers 503 without it). */
/** noegleskift (KC-0217): `forberedt` while SKY_KONTO_PUBKEY_NY is set — Sky hands tenants the next public key, so the
 *  operator can see the fleet is ready for step 3 of the rotation (gateway/README.md). Not a fault: ok is unaffected. */
/** netfilter (KC-0273): the marker deploy.sh's netfilter.sh leaves (fleet/netfilter.ts): `ok` = the host-side filter
 *  covers the configured tenant pool, `forældet` = it covers another pool, `mangler` = none (also after a reboot).
 *  Visible, not a 503: Sky answers, but no tenant container is started until it is `ok`. */
export type HelbredDeps = { db: Database; sha: string; startet: number; nu?: () => number; timeoutMs?: number; flaade?: string; noegler?: 'ok' | 'mangler'; gateway?: 'ok' | 'mangler'; noegleskift?: 'forberedt'; netfilter?: 'ok' | 'mangler' | 'forældet' };

async function dbVersion(db: Database, timeoutMs: number): Promise<number | null> {
  let stop: NodeJS.Timeout | undefined;
  const frist = new Promise<never>((_, afvis) => { stop = setTimeout(() => afvis(new Error('timeout')), timeoutMs); });
  try {
    const [r] = await Promise.race([db.query<{ version: number | null }>('SELECT max(version) AS version FROM schema_version'), frist]);
    return r?.version ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(stop);
  }
}

export async function helbred(d: HelbredDeps): Promise<Helbred> {
  const version = await dbVersion(d.db, d.timeoutMs ?? 2000);
  const dbOk = version !== null;
  const noeglerOk = !(d.flaade && d.noegler === 'mangler');
  const gatewayOk = !(d.flaade && d.gateway === 'mangler');
  const h: Helbred = { ok: dbOk && noeglerOk && gatewayOk, sha: d.sha, uptimeSec: Math.round(((d.nu ?? Date.now)() - d.startet) / 1000), db: { ok: dbOk, version } };
  if (d.flaade) h.flaade = d.flaade;
  if (d.noegler) h.noegler = d.noegler;
  if (d.gateway) h.gateway = d.gateway;
  if (d.noegleskift) h.noegleskift = d.noegleskift;
  if (d.netfilter) h.netfilter = d.netfilter;
  return h;
}
