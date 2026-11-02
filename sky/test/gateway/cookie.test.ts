// KC-0183: the tenant cookie's signed token and the gateway key. A token for tenant A never works on B; a
// tampered token is nothing; an expired one is refreshed only while the Sky session lives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE, TOKEN_MS, udstedToken, laesToken, sessionLever, cookieFra, saetCookie, sletCookie } from '../../src/gateway/cookie.ts';
import { laesGatewayNoegle } from '../../src/gateway/noegle.ts';
import { afslutSession, tilbagekald } from '../../src/konto/session.ts';
import { FROE, OFFENTLIG, opsaet } from './hjaelp.ts';

const N = Buffer.alloc(32, 7);
const NU = new Date('2026-10-31T10:00:00.000Z');
const P = { t: 'hus-abcdefgh', k: 4, s: 9, e: 'ejer@example.test' };

test('a token reads back on its own tenant', () => {
  const r = laesToken(N, udstedToken(N, P, NU), 'hus-abcdefgh', NU);
  assert.ok(r.ok);
  assert.deepEqual({ t: r.p.t, k: r.p.k, s: r.p.s, e: r.p.e }, P);
  assert.equal(r.udloebet, false);
});

test('a token for tenant A is rejected on tenant B', () => {
  assert.deepEqual(laesToken(N, udstedToken(N, P, NU), 'hus-bbbbbbbb', NU), { ok: false });
});

test('a tampered payload, a tampered signature, another key or garbage is rejected', () => {
  const t = udstedToken(N, P, NU);
  const [v, payload, sig] = t.split('.') as [string, string, string];
  const anden = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), k: 5 })).toString('base64url');
  for (const x of [`${v}.${anden}.${sig}`, `${v}.${payload}.${sig.slice(0, -2)}AA`, udstedToken(Buffer.alloc(32, 8), P, NU), '', 'v1..', undefined, `${t}.x`]) {
    assert.deepEqual(laesToken(N, x, 'hus-abcdefgh', NU), { ok: false }, String(x));
  }
});

test('after 15 minutes the token is expired (still read, so it can be refreshed against the session)', () => {
  const t = udstedToken(N, P, NU);
  assert.equal(TOKEN_MS, 15 * 60_000);
  const lige = laesToken(N, t, 'hus-abcdefgh', new Date(NU.getTime() + TOKEN_MS - 1));
  const efter = laesToken(N, t, 'hus-abcdefgh', new Date(NU.getTime() + TOKEN_MS));
  assert.ok(lige.ok && !lige.udloebet);
  assert.ok(efter.ok && efter.udloebet);
});

test('sessionLever: the email while the Sky session lives; null after log out, revoke or account deletion', async () => {
  const o = await opsaet();
  const p = { s: o.ejer.sessionId, k: o.ejer.id };
  assert.equal(await sessionLever(o.db, p, o.ur.nu()), 'ejer@example.test');
  assert.equal(await sessionLever(o.db, { s: o.ejer.sessionId, k: o.fremmed.id }, o.ur.nu()), null, 'another account’s session');
  assert.ok(await tilbagekald(o.db, o.ejer.id, o.ejer.sessionId));
  assert.equal(await sessionLever(o.db, p, o.ur.nu()), null);

  const f = { s: o.fremmed.sessionId, k: o.fremmed.id };
  await o.db.query('UPDATE konto SET email = NULL, slettet_ved = now() WHERE id = $1', [o.fremmed.id]);
  assert.equal(await sessionLever(o.db, f, o.ur.nu()), null);
  await afslutSession(o.db, 'findes-ikke');
});

test('sessionLever: null once the session has expired', async () => {
  const o = await opsaet();
  o.ur.frem(31 * 86_400_000);
  assert.equal(await sessionLever(o.db, { s: o.ejer.sessionId, k: o.ejer.id }, o.ur.nu()), null);
});

test('the cookie is host-only, Secure, HttpOnly, SameSite=Lax; reading picks our cookie out of the header', () => {
  assert.equal(COOKIE, '__Host-clawco');
  const s = saetCookie('abc');
  assert.match(s, /^__Host-clawco=abc; /);
  for (const del of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax']) assert.ok(s.split('; ').includes(del), del);
  assert.doesNotMatch(s, /Domain=/i);
  assert.match(sletCookie(), /^__Host-clawco=; .*Max-Age=0/);
  assert.equal(cookieFra('a=1; __Host-clawco=tok; b=2'), 'tok');
  assert.equal(cookieFra('a=1'), undefined);
  assert.equal(cookieFra(undefined), undefined);
});

test('the gateway key from SKY_GATEWAY_SIGNERINGSNOEGLE: loaded, and the name removed from the environment', () => {
  const env: Record<string, string | undefined> = { SKY_GATEWAY_SIGNERINGSNOEGLE: FROE };
  const r = laesGatewayNoegle(env, OFFENTLIG);
  assert.equal(r.fejl, null);
  assert.equal(r.noegle?.offentlig, OFFENTLIG);
  assert.equal(r.noegle?.cookie.length, 32);
  assert.notDeepEqual(r.noegle?.cookie, r.noegle?.naeste);
  assert.equal('SKY_GATEWAY_SIGNERINGSNOEGLE' in env, false);
});

test('a missing, malformed or mismatched key gives no key and a message naming it, never the value', () => {
  const kort = Buffer.alloc(16, 1).toString('base64url');
  for (const [env, pub] of [[{}, null], [{ SKY_GATEWAY_SIGNERINGSNOEGLE: kort }, null], [{ SKY_GATEWAY_SIGNERINGSNOEGLE: '!!' }, null], [{ SKY_GATEWAY_SIGNERINGSNOEGLE: FROE }, 'A'.repeat(43)]] as const) {
    const e = { ...env } as Record<string, string | undefined>;
    const r = laesGatewayNoegle(e, pub);
    assert.equal(r.noegle, null);
    assert.match(r.fejl ?? '', /SKY_GATEWAY_SIGNERINGSNOEGLE/);
    assert.ok(!(r.fejl ?? '').includes(FROE));
    assert.equal('SKY_GATEWAY_SIGNERINGSNOEGLE' in e, false);
  }
});
