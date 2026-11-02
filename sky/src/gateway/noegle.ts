// The gateway's key (KC-0183): SKY_GATEWAY_SIGNERINGSNOEGLE, the 32-byte Ed25519 seed as base64url. It signs
// Clawco-Konto (signer.ts, KC-0179); two HMAC keys are derived from it with HKDF, one for the tenant cookie
// and one for the login path's `next`, so one secret serves all three without any reuse across purposes.
// Missing or wrong → no key, and every tenant host answers 503 (fail closed, AGENTS §0 r7); the message
// names the key, never its value. The name leaves the environment, so no child process ever inherits it.
import { hkdfSync, type KeyObject } from 'node:crypto';
import { noegleFraFroe } from './signer.ts';

export const NOEGLE_NAVN = 'SKY_GATEWAY_SIGNERINGSNOEGLE';

export type GatewayNoegle = { privat: KeyObject; offentlig: string; id: string; cookie: Buffer; naeste: Buffer };

const afled = (froe: Buffer, formaal: string): Buffer => Buffer.from(hkdfSync('sha256', froe, Buffer.alloc(0), `clawco-gateway-${formaal}`, 32));

/** `kontoPubkey`: SKY_KONTO_PUBKEY when the fleet hands one to tenants — the key must be its private half,
 *  or every tenant would refuse every request. */
export function laesGatewayNoegle(env: Record<string, string | undefined>, kontoPubkey: string | null): { noegle: GatewayNoegle | null; fejl: string | null } {
  const raa = (env[NOEGLE_NAVN] ?? '').trim();
  delete env[NOEGLE_NAVN];
  if (!raa) return { noegle: null, fejl: `${NOEGLE_NAVN} mangler: gatewayen svarer 503 for alle kundeadresser` };
  const froe = Buffer.from(raa, 'base64url');
  if (!/^[A-Za-z0-9_-]{43}$/.test(raa) || froe.length !== 32) return { noegle: null, fejl: `${NOEGLE_NAVN} er ugyldig: skal være 32 bytes som base64url uden udfyldning (43 tegn)` };
  const k = noegleFraFroe(froe);
  if (kontoPubkey !== null && kontoPubkey !== k.offentlig) return { noegle: null, fejl: `${NOEGLE_NAVN} passer ikke til SKY_KONTO_PUBKEY: kunderne ville afvise hver anmodning` };
  return { noegle: { ...k, cookie: afled(froe, 'cookie'), naeste: afled(froe, 'naeste') }, fejl: null };
}
