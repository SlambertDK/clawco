// A tenant's model token (KC-0264): the bearer token its Clawco sends to Sky's model proxy (POST /model/v1/messages).
// Derived, never drawn: HMAC-SHA256 under the tenant's `model` purpose key (afled.ts) over a generation number, so Sky can
// deliver the same token after every container start without ever storing it. Postgres holds only its SHA-256
// (hemmeligheder.model_token, migration 0019), which is what a request is looked up by. Rotation bumps the generation
// (the old token stops matching at once); deletion revokes the row for good. Delivered like the lager key: on stdin into
// the container's private tmpfs (levering.ts), never in argv, an env var, a log or the tenant's volume.
import { createHash, createHmac } from 'node:crypto';
import type { Database } from '../db/pool.ts';
import { afled } from './afled.ts';
import { NOEGLE_MAPPE, leverTilFil, type KoerselMedInput } from './levering.ts';
import type { Noeglering } from './masternoegle.ts';
import { hentDataNoegle } from './tenantnoegle.ts';

/** Where the tenant reads it (KC_MODEL_TOKEN_FIL): on the same private tmpfs as the lager key. */
export const MODEL_TOKEN_STI = `${NOEGLE_MAPPE}/model-token`;
const TOKEN = /^[A-Za-z0-9+/]{43}=$/;

const hash = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

async function udled(db: Database, r: Noeglering, tenant: string, generation: number): Promise<string> {
  const dek = await hentDataNoegle(db, r, tenant);
  const k = afled(dek, tenant, 'model');
  dek.oedelaeg();
  try {
    return createHmac('sha256', k.aaben()).update(`clawco-sky/model-token/v1\0${generation}`, 'utf8').digest('base64');
  } finally {
    k.oedelaeg();
  }
}

/** Makes the tenant's token row (generation 1) unless it has one, a revoked one included. Needs the tenant's data key. */
export async function sikrModelToken(db: Database, r: Noeglering, tenant: string, nu: Date): Promise<void> {
  const [findes] = await db.query('SELECT 1 FROM hemmeligheder.model_token WHERE tenant = $1', [tenant]);
  if (findes) return;
  const token = await udled(db, r, tenant, 1);
  await db.query('INSERT INTO hemmeligheder.model_token (tenant, hash, generation, oprettet) VALUES ($1, $2, 1, $3) ON CONFLICT (tenant) DO NOTHING', [tenant, hash(token), nu.toISOString()]);
}

/** The tenant's current token, for delivery. Throws when it has none. */
export async function modelToken(db: Database, r: Noeglering, tenant: string): Promise<string> {
  const [row] = await db.query<{ generation: number }>('SELECT generation FROM hemmeligheder.model_token WHERE tenant = $1', [tenant]);
  if (!row) throw new Error(`ingen modelnøgle for tenant ${tenant}`);
  return udled(db, r, tenant, Number(row.generation));
}

/** The tenant a bearer token belongs to, or null: unknown, malformed or revoked. */
export async function tenantForModelToken(db: Database, token: string): Promise<string | null> {
  if (!TOKEN.test(token)) return null;
  const [row] = await db.query<{ tenant: string }>('SELECT tenant FROM hemmeligheder.model_token WHERE hash = $1 AND tilbagekaldt IS NULL', [hash(token)]);
  return row?.tenant ?? null;
}

/** A new token for the tenant (the next generation). The caller delivers it; until then the tenant's calls get 401. */
export async function roterModelToken(db: Database, r: Noeglering, tenant: string, nu: Date): Promise<string> {
  const [row] = await db.query<{ generation: number }>('SELECT generation FROM hemmeligheder.model_token WHERE tenant = $1 AND tilbagekaldt IS NULL', [tenant]);
  if (!row) throw new Error(`ingen aktiv modelnøgle for tenant ${tenant}`);
  const generation = Number(row.generation) + 1;
  const token = await udled(db, r, tenant, generation);
  await db.query('UPDATE hemmeligheder.model_token SET hash = $2, generation = $3, roteret = $4 WHERE tenant = $1', [tenant, hash(token), generation, nu.toISOString()]);
  return token;
}

/** The tenant is deleted: its token never matches again. Idempotent (keeps the first date). */
export async function tilbagekaldModelToken(db: Database, tenant: string, nu: Date): Promise<void> {
  await db.query('UPDATE hemmeligheder.model_token SET tilbagekaldt = $2 WHERE tenant = $1 AND tilbagekaldt IS NULL', [tenant, nu.toISOString()]);
}

/** Pipes the token into the running container's tmpfs (gone with every stop, so this runs after every start). */
export async function leverModelToken(o: { koer: KoerselMedInput; container: string; token: string }): Promise<void> {
  if (!TOKEN.test(o.token)) throw new Error('ugyldig modelnøgle');
  await leverTilFil({ koer: o.koer, container: o.container, base64: o.token, sti: MODEL_TOKEN_STI });
}
