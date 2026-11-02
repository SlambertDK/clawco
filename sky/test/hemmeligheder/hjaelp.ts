// Test helpers for KC-0181: a master key ring from fresh random bytes, a migrated PGlite database,
// and every textual form a key could leak in (for the grep tests).
import { randomBytes } from 'node:crypto';
import { migrer } from '../../src/db/migrer.ts';
import type { Database } from '../../src/db/pool.ts';
import { laesMasternoegle, type Noeglering } from '../../src/hemmeligheder/masternoegle.ts';
import { pgliteDatabase } from '../pglite.ts';

export function nyKek(): string { return randomBytes(32).toString('base64'); }

export function ring(o: { kek?: string; version?: number; forrige?: string } = {}): Noeglering {
  const env: Record<string, string | undefined> = { SKY_MASTERNOEGLE: o.kek ?? nyKek() };
  if (o.version !== undefined) env['SKY_MASTERNOEGLE_VERSION'] = String(o.version);
  if (o.forrige !== undefined) env['SKY_MASTERNOEGLE_FORRIGE'] = o.forrige;
  return laesMasternoegle(env);
}

export async function migreretDb(): Promise<Database> {
  const db = await pgliteDatabase();
  await migrer(db);
  return db;
}

/** hex, base64 and base64url of the bytes: the shapes a key would take in a log line. */
export function former(b: Buffer): string[] {
  return [b.toString('hex'), b.toString('base64'), b.toString('base64url'), b.toString('base64').replace(/=+$/, '')];
}
