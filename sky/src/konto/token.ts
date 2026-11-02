// Secrets that log someone in (link tokens, session ids): 32 random bytes out, SHA-256 in the database.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function nytToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison of two strings (CSRF tokens, binding hashes). */
export function ensTokens(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
