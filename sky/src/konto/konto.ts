// Accounts (KC-0177): one row per person, keyed by a lower-cased email. Made on the first used login
// link (sign-up); staff only by script (sky/scripts/goer-personale.ts), never by sign-up.
import type { Database } from '../db/pool.ts';

export type Konto = { id: number; email: string; personale: boolean; oprettet: Date };

type Raekke = { id: unknown; email: string; personale: boolean; oprettet: Date };
const somKonto = (r: Raekke): Konto => ({ id: Number(r.id), email: r.email, personale: r.personale, oprettet: new Date(r.oprettet) });

/** Trimmed, lower-cased address, or null when it cannot be one. */
export function normaliserEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  if (e.length > 254 || /[\u0000-\u001f\u007f]/.test(e)) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export async function hentKonto(db: Database, id: number): Promise<Konto | null> {
  const [r] = await db.query<Raekke>('SELECT id, email, personale, oprettet FROM konto WHERE id = $1 AND slettet_ved IS NULL', [id]);
  return r ? somKonto(r) : null;
}

export async function kontoForEmail(db: Database, email: string): Promise<Konto | null> {
  const [r] = await db.query<Raekke>('SELECT id, email, personale, oprettet FROM konto WHERE email = $1', [email]);
  return r ? somKonto(r) : null;
}

/** The account for `email`, created now if there is none. `ny` tells sign-up from login. */
export async function findEllerOpretKonto(db: Database, email: string, nu: Date): Promise<{ konto: Konto; ny: boolean }> {
  const [ny] = await db.query<Raekke>(
    'INSERT INTO konto (email, oprettet) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING RETURNING id, email, personale, oprettet',
    [email, nu.toISOString()],
  );
  if (ny) return { konto: somKonto(ny), ny: true };
  const k = await kontoForEmail(db, email);
  if (!k) throw new Error('kontoen forsvandt under oprettelse');
  return { konto: k, ny: false };
}

export type PersonalePasskey = { id: number; navn: string; oprettet: Date };
export type PersonaleUdfald = { udfald: 'ok' | 'ukendt' | 'ingen-passkey' | 'flere-passkeys'; passkeys: PersonalePasskey[] };

/** Makes an existing account staff (KC-0188). Needs a passkey first: staff never log in by link. Every passkey the account
 *  has becomes a staff login, so (KC-0272) they are returned to be named, and more than one is refused unless `alle`:
 *  an unknown device must not become a staff key unseen. A refusal changes nothing. */
export async function goerPersonale(db: Database, email: string, o: { alle?: boolean } = {}): Promise<PersonaleUdfald> {
  const k = await kontoForEmail(db, email);
  if (!k) return { udfald: 'ukendt', passkeys: [] };
  const rk = await db.query<{ id: unknown; navn: string; oprettet: Date }>('SELECT id, navn, oprettet FROM passkey WHERE konto_id = $1 ORDER BY id', [k.id]);
  const passkeys = rk.map((r) => ({ id: Number(r.id), navn: r.navn, oprettet: new Date(r.oprettet) }));
  if (!passkeys.length) return { udfald: 'ingen-passkey', passkeys };
  if (passkeys.length > 1 && !o.alle) return { udfald: 'flere-passkeys', passkeys };
  await db.query('UPDATE konto SET personale = true WHERE id = $1', [k.id]);
  return { udfald: 'ok', passkeys };
}
