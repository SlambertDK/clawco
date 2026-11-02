// A tenant's slug (KC-0182): its name in <slug>.<basedomain>, in Docker names and in the signed identity
// header (KC_KONTO_TENANT). Random — `hus-` plus 8 base32 characters (40 bits) — and never derived from a
// name or an email, so it says nothing about who lives there. Uniqueness is the database's (UNIQUE slug);
// the caller draws again on a collision.
import { randomBytes } from 'node:crypto';
import { SLUG, RESERVEREDE, erSlug } from '../delt/slug.ts';

/** RFC 4648 base32, lower case: 5 random bytes are exactly 8 characters. */
const ALFABET = 'abcdefghijklmnopqrstuvwxyz234567';
export { SLUG, RESERVEREDE, erSlug };

export function nySlug(tilfaeldig: (n: number) => Uint8Array = randomBytes): string {
  const b = tilfaeldig(5);
  let bits = 0n;
  for (const x of b.subarray(0, 5)) bits = (bits << 8n) | BigInt(x);
  let ud = '';
  for (let i = 7; i >= 0; i--) ud += ALFABET[Number((bits >> BigInt(i * 5)) & 31n)];
  const s = `hus-${ud}`;
  if (!erSlug(s)) throw new Error('slug uden for formatet');
  return s;
}
