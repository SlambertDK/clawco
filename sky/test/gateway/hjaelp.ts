// Shared gateway test setup: a migrated PGlite database with an owner and a stranger (each with a live Sky
// session), one tenant in `klar` at a given address, a clock that moves only when told, and the gateway key
// from the KC-0179 vectors (so a signature can be checked with the tenant's own public key).
import { readFileSync } from 'node:fs';
import { nyDb, ur, type Ur } from '../konto/hjaelp.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { opretSession } from '../../src/konto/session.ts';
import { bestil, skift } from '../../src/fleet/tilstand.ts';
import type { Database } from '../../src/db/pool.ts';

const V = JSON.parse(readFileSync(new URL('../fixtures/konto-vektorer.json', import.meta.url), 'utf8')) as {
  noegler: Record<string, { froe: string; offentlig: string; id: string }>;
};
const [FOERSTE] = Object.values(V.noegler);
/** The first vector key: seed as base64url (the SKY_GATEWAY_SIGNERINGSNOEGLE form) and its public key. */
export const FROE = Buffer.from(FOERSTE!.froe, 'hex').toString('base64url');
export const OFFENTLIG = FOERSTE!.offentlig;

export type Opsat = {
  db: Database; ur: Ur; slug: string;
  ejer: { id: number; email: string; sessionId: number };
  fremmed: { id: number; email: string; sessionId: number };
};

export async function opsaet(adresse = 'http://127.0.0.1:1'): Promise<Opsat> {
  const db = await nyDb();
  const u = ur();
  const person = async (email: string) => {
    const { konto } = await findEllerOpretKonto(db, email, u.nu());
    const { session } = await opretSession(db, { kontoId: konto.id, metode: 'passkey', enhed: '', nu: u.nu() });
    return { id: konto.id, email, sessionId: session.id };
  };
  const ejer = await person('ejer@example.test');
  const fremmed = await person('fremmed@example.test');
  const t = await bestil(db, { kontoId: ejer.id, driver: 'lokal', nu: u.nu(), nySlug: () => 'hus-abcdefgh' });
  await skift(db, t.slug, ['bestilt'], 'klar', u.nu(), { adresse });
  return { db, ur: u, slug: t.slug, ejer, fremmed };
}
