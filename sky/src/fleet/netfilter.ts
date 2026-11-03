// KC-0273 (C2, Sky half): the tenant networks' host-side filter, without root in Sky. Every tenant network is a /24
// from one fixed pool (SKY_TENANT_POOL, default 10.200.0.0/16; read here, not in config.ts, which another ticket
// owns): tenant n gets <pool>.n.0/24 (n = 1..255, recorded on the tenant row, fleet/tilstand.ts tildelUndernet) and
// index 0 is the shared network of restore copies and release checks. deploy.sh runs sky/deploy/netfilter.sh <pool>
// as root (one sudoers entry) right after each restart: it filters the WHOLE pool and then writes a marker
// (/run/sky/netfilter.ok: the pool and a time). Sky never calls sudo. It reads the marker: `ok` when the marker's pool
// is the configured pool, `forældet` when it differs, `mangler` when absent (also after a reboot: /run is gone, and so
// are the rules). /health shows it, and no tenant container is started unless it is `ok` (kraevFilter).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const NETFILTER_SCRIPT = fileURLToPath(new URL('../../deploy/netfilter.sh', import.meta.url));
export const MARKOER = '/run/sky/netfilter.ok';
export const STANDARD_POOL = '10.200.0.0/16';
/** The /24s of a /16: 0 (shared) + 255 tenants. A host runs far fewer tenants (1 GB each), so this is no real limit. */
export const TENANT_UNDERNET_MAKS = 255;

export type TenantPool = { cidr: string; a: number; b: number };
export type Undernet = { subnet: string; gateway: string };
export type NetfilterTilstand = 'ok' | 'mangler' | 'forældet';
export type Vaern = { pool: TenantPool; tilstand(): Promise<NetfilterTilstand> };

const POOL = /^(\d{1,3})\.(\d{1,3})\.0\.0\/16$/;
const OKTET = /^(0|[1-9]\d{0,2})$/;

/** SKY_TENANT_POOL from env: a /16 inside 10/8, 172.16/12 or 192.168/16; else it throws naming the key. */
export function laesTenantPool(env: Record<string, string | undefined>): TenantPool {
  const v = (env['SKY_TENANT_POOL'] ?? '').trim() || STANDARD_POOL;
  const m = POOL.exec(v);
  const a = m && OKTET.test(m[1]!) ? Number(m[1]) : NaN;
  const b = m && OKTET.test(m[2]!) ? Number(m[2]) : NaN;
  const privat = a === 10 ? b <= 255 : a === 172 ? b >= 16 && b <= 31 : a === 192 && b === 168;
  if (!privat) throw new Error('SKY_TENANT_POOL er ugyldig: skal være et /16 i privat adresserum (fx 10.200.0.0/16)');
  return { cidr: v, a, b };
}

/** The /24 with index n of the pool and its gateway (.1, the host's side of the bridge). */
export function undernetFor(p: TenantPool, n: number): Undernet {
  if (!Number.isInteger(n) || n < 0 || n > TENANT_UNDERNET_MAKS) throw new Error(`undernet ${n} ligger uden for puljen`);
  return { subnet: `${p.a}.${p.b}.${n}.0/24`, gateway: `${p.a}.${p.b}.${n}.1` };
}

/** What the marker says about the configured pool. */
export async function netfilterTilstand(p: TenantPool, sti: string = MARKOER): Promise<NetfilterTilstand> {
  let tekst: string;
  try { tekst = await readFile(sti, 'utf8'); } catch { return 'mangler'; }
  const pool = /^pool=(.*)$/m.exec(tekst)?.[1]?.trim();
  return pool === p.cidr ? 'ok' : 'forældet';
}

/** Fail closed: no tenant container starts while the filter is not in place for this pool. */
export async function kraevFilter(v: Vaern): Promise<void> {
  const t = await v.tilstand();
  if (t !== 'ok') throw new Error(`værtsfiltret er ikke på plads (netfilter: ${t}): kør sky/deploy/deploy.sh, som sætter det med sudo netfilter.sh ${v.pool.cidr}, før en kunde startes`);
}
