// Passkeys (KC-0177, spec D12): WebAuthn through @simplewebauthn/server; we never parse WebAuthn
// ourselves. Challenges are single-use rows (5 minutes), consumed when the library checks them.
// Login is "discoverable" (no email first); user verification (fingerprint, face, PIN) is required.
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { Database } from '../db/pool.ts';

export const UDFORDRING_MS = 5 * 60_000;

/** The relying party: id = the Sky host (gate G7), origin = SKY_PUBLIC_URL's origin. */
export type Rp = { id: string; navn: string; origin: string };

export type PasskeyVisning = { id: number; navn: string; oprettet: Date; sidstBrugt: Date | null };

type Formaal = 'registrering' | 'login';

async function gemUdfordring(db: Database, udfordring: string, formaal: Formaal, kontoId: number | null, nu: Date): Promise<void> {
  await db.query('DELETE FROM udfordring WHERE udloeber < $1', [nu.toISOString()]);
  await db.query('INSERT INTO udfordring (udfordring, formaal, konto_id, udloeber) VALUES ($1, $2, $3, $4)',
    [udfordring, formaal, kontoId, new Date(nu.getTime() + UDFORDRING_MS).toISOString()]);
}

/** expectedChallenge for the library: true once, for an unexpired challenge of this purpose (and account). */
function forbrug(db: Database, formaal: Formaal, kontoId: number | null, nu: Date) {
  return async (udfordring: string): Promise<boolean> => {
    const r = await db.query(
      `DELETE FROM udfordring WHERE udfordring = $1 AND formaal = $2 AND konto_id IS NOT DISTINCT FROM $3 AND udloeber > $4 RETURNING 1`,
      [udfordring, formaal, kontoId, nu.toISOString()],
    );
    return r.length === 1;
  };
}

export async function registreringsMuligheder(db: Database, rp: Rp, konto: { id: number; email: string }, nu: Date): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const eksisterende = await db.query<{ credential_id: string; transports: string[] }>('SELECT credential_id, transports FROM passkey WHERE konto_id = $1', [konto.id]);
  const o = await generateRegistrationOptions({
    rpName: rp.navn,
    rpID: rp.id,
    userName: konto.email,
    userID: new TextEncoder().encode(`konto-${konto.id}`),
    attestationType: 'none',
    excludeCredentials: eksisterende.map((p) => ({ id: p.credential_id, transports: p.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    timeout: UDFORDRING_MS,
  });
  await gemUdfordring(db, o.challenge, 'registrering', konto.id, nu);
  return o;
}

/** Verifies a registration answer for this account and stores the passkey. False on any failure. */
export async function gemRegistrering(db: Database, rp: Rp, kontoId: number, svar: unknown, navn: string, nu: Date): Promise<boolean> {
  let v;
  try {
    v = await verifyRegistrationResponse({
      response: svar as RegistrationResponseJSON,
      expectedChallenge: forbrug(db, 'registrering', kontoId, nu),
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true,
    });
  } catch {
    return false;
  }
  if (!v.verified) return false;
  const c = v.registrationInfo.credential;
  const r = await db.query(
    `INSERT INTO passkey (konto_id, credential_id, public_key, taeller, transports, navn, oprettet)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (credential_id) DO NOTHING RETURNING id`,
    [kontoId, c.id, Buffer.from(c.publicKey).toString('base64url'), c.counter, c.transports ?? [], (navn.trim() || 'Passkey').slice(0, 60), nu.toISOString()],
  );
  return r.length === 1;
}

export async function loginMuligheder(db: Database, rp: Rp, nu: Date): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const o = await generateAuthenticationOptions({ rpID: rp.id, userVerification: 'required', timeout: UDFORDRING_MS });
  await gemUdfordring(db, o.challenge, 'login', null, nu);
  return o;
}

/** Verifies a login assertion. The account, or null (unknown key, replay, counter regression, …). */
export async function verificerLogin(db: Database, rp: Rp, svar: unknown, nu: Date): Promise<{ kontoId: number } | null> {
  const id = typeof svar === 'object' && svar !== null ? (svar as { id?: unknown }).id : undefined;
  if (typeof id !== 'string' || !id) return null;
  const [p] = await db.query<{ id: unknown; konto_id: unknown; public_key: string; taeller: unknown; transports: string[] }>(
    `SELECT p.id, p.konto_id, p.public_key, p.taeller, p.transports FROM passkey p JOIN konto k ON k.id = p.konto_id
      WHERE p.credential_id = $1 AND k.slettet_ved IS NULL`,
    [id],
  );
  if (!p) return null;
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response: svar as AuthenticationResponseJSON,
      expectedChallenge: forbrug(db, 'login', null, nu),
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: { id, publicKey: new Uint8Array(Buffer.from(p.public_key, 'base64url')), counter: Number(p.taeller), transports: p.transports },
      requireUserVerification: true,
    });
  } catch {
    return null;
  }
  if (!v.verified) return null;
  // The library rejects a counter that did not grow; the conditional update also closes the race of
  // two assertions with the same counter arriving at once. Authenticators that keep 0 stay at 0.
  const ny = v.authenticationInfo.newCounter;
  const r = await db.query('UPDATE passkey SET taeller = $2, sidst_brugt = $3 WHERE id = $1 AND (taeller < $2 OR $2 = 0) RETURNING 1', [p.id, ny, nu.toISOString()]);
  return r.length === 1 ? { kontoId: Number(p.konto_id) } : null;
}

export async function passkeys(db: Database, kontoId: number): Promise<PasskeyVisning[]> {
  const rk = await db.query<{ id: unknown; navn: string; oprettet: Date; sidst_brugt: Date | null }>(
    'SELECT id, navn, oprettet, sidst_brugt FROM passkey WHERE konto_id = $1 ORDER BY oprettet, id', [kontoId]);
  return rk.map((r) => ({ id: Number(r.id), navn: r.navn, oprettet: new Date(r.oprettet), sidstBrugt: r.sidst_brugt ? new Date(r.sidst_brugt) : null }));
}

/** Removes one passkey of this account. Staff keep at least one (they cannot log in by link). */
export async function fjernPasskey(db: Database, kontoId: number, id: number): Promise<'ok' | 'sidste-personale' | 'ukendt'> {
  return db.transaction(async (tx) => {
    const [k] = await tx.query<{ personale: boolean; n: number }>(
      `SELECT k.personale, (SELECT count(*)::int FROM passkey WHERE konto_id = k.id) AS n FROM konto k
        WHERE k.id = $1 AND EXISTS (SELECT 1 FROM passkey WHERE id = $2 AND konto_id = k.id) FOR UPDATE`,
      [kontoId, id],
    );
    if (!k) return 'ukendt';
    if (k.personale && k.n <= 1) return 'sidste-personale';
    await tx.query('DELETE FROM passkey WHERE id = $1 AND konto_id = $2', [id, kontoId]);
    return 'ok';
  });
}
