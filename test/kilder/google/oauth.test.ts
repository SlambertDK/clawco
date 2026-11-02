// KC-0133: the Google OAuth pieces — PKCE (RFC 7636), the consent URL, the
// code exchange against a real local HTTP stub (form-encoded, with the
// verifier and the same redirect URI), refresh, revoke, and the error
// classification the health check relies on (invalid_grant = log in again).
// Fail closed: no refresh token or the wrong scope is a refusal, never a
// stored empty credential.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ENDPOINTS, GoogleFejl, KALENDER_KRAV, MAIL_KRAV, SCOPE_ADRESSE, SCOPE_KALENDER, SCOPE_MAIL, adresseFraIdToken, byttKode, fletScopes, scopesFra, forny, lavVerifier, samtykkeUrl, tilbagekald, udfordring, type Hent } from '../../../src/kilder/google/oauth.ts';
import { KildeFejl } from '../../../src/kilder/types.ts';

const KLIENT = { id: 'klient-123.apps.googleusercontent.com', hemmelighed: 'hemmelig-klientnoegle' };
const TILBAGE = 'https://kontrol.example.ts.net/api/kilder/google-kalender/tilbage';

type Kald = { url: string; metode: string; type: string; krop: URLSearchParams };
/** A fetch that answers from `svar` and records each call. */
function stub(svar: (k: Kald) => { status: number; json: unknown }): { hent: Hent; kald: Kald[] } {
  const kald: Kald[] = [];
  const hent = (async (input: string | URL | Request, init?: RequestInit) => {
    const k: Kald = { url: String(input), metode: init?.method ?? 'GET', type: new Headers(init?.headers).get('content-type') ?? '', krop: new URLSearchParams(String(init?.body ?? '')) };
    kald.push(k);
    const s = svar(k);
    return new Response(JSON.stringify(s.json), { status: s.status, headers: { 'content-type': 'application/json' } });
  }) as Hent;
  return { hent, kald };
}

test('PKCE: the verifier is 43–128 unreserved characters, fresh each time', () => {
  const a = lavVerifier();
  assert.match(a, /^[A-Za-z0-9\-._~]{43,128}$/);
  assert.notEqual(lavVerifier(), a);
});

test('PKCE: the S256 challenge is the RFC 7636 example', () => {
  assert.equal(udfordring('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('the consent URL asks for read-only calendar access, offline, with S256 and the state', () => {
  const u = new URL(samtykkeUrl({ klientId: KLIENT.id, tilbage: TILBAGE, state: 'st-1', udfordring: 'udf' }));
  assert.equal(`${u.origin}${u.pathname}`, ENDPOINTS.samtykke);
  assert.equal(ENDPOINTS.samtykke, 'https://accounts.google.com/o/oauth2/v2/auth');
  const p = Object.fromEntries(u.searchParams);
  assert.deepEqual(p, {
    client_id: KLIENT.id, redirect_uri: TILBAGE, response_type: 'code', scope: 'https://www.googleapis.com/auth/calendar.readonly',
    access_type: 'offline', prompt: 'consent', state: 'st-1', code_challenge: 'udf', code_challenge_method: 'S256',
  });
  assert.equal(SCOPE_KALENDER, 'https://www.googleapis.com/auth/calendar.readonly');
});

// KC-0135: a second connector (Gmail) asks for its own scope on the same Google app.
test('the consent URL for mail asks for the IMAP scope and the address; udvid adds the already-granted scopes, and only then', () => {
  const enkelt = new URL(samtykkeUrl({ klientId: KLIENT.id, tilbage: TILBAGE, state: 's', udfordring: 'u', scopes: [SCOPE_MAIL, ...SCOPE_ADRESSE] }));
  assert.equal(enkelt.searchParams.get('scope'), 'https://mail.google.com/ openid email');
  assert.equal(enkelt.searchParams.has('include_granted_scopes'), false);
  const udvidet = new URL(samtykkeUrl({ klientId: KLIENT.id, tilbage: TILBAGE, state: 's', udfordring: 'u', scopes: [SCOPE_MAIL, ...SCOPE_ADRESSE], udvid: true }));
  assert.equal(udvidet.searchParams.get('scope'), 'https://mail.google.com/ openid email');
  assert.equal(udvidet.searchParams.get('include_granted_scopes'), 'true');
  assert.equal(udvidet.searchParams.get('code_challenge_method'), 'S256');
});

test('scope merging: scopesFra splits Google\'s string, fletScopes is a duplicate-free union in order', () => {
  assert.deepEqual(scopesFra('openid  email\nhttps://mail.google.com/'), ['openid', 'email', 'https://mail.google.com/']);
  assert.deepEqual(scopesFra(undefined), []);
  assert.deepEqual(scopesFra(42), []);
  assert.deepEqual(fletScopes([SCOPE_KALENDER], [SCOPE_MAIL, SCOPE_KALENDER], ['openid']), [SCOPE_KALENDER, SCOPE_MAIL, 'openid']);
});

const jwt = (payload: unknown): string => `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

test('adresseFraIdToken: the verified address, nothing for garbage, an unverified address or none', () => {
  assert.equal(adresseFraIdToken(jwt({ email: 'ella@gmail.example', email_verified: true })), 'ella@gmail.example');
  assert.equal(adresseFraIdToken(jwt({ email: 'ella@gmail.example' })), 'ella@gmail.example');
  assert.equal(adresseFraIdToken(jwt({ email: 'ella@gmail.example', email_verified: false })), null);
  assert.equal(adresseFraIdToken(jwt({ sub: '1' })), null);
  assert.equal(adresseFraIdToken(jwt({ email: 'ikke en adresse' })), null);
  assert.equal(adresseFraIdToken('ikke-en-jwt'), null);
  assert.equal(adresseFraIdToken(undefined), null);
});

test('code exchange for mail: scopes and the address come back; a merged grant that also holds the calendar is accepted', async () => {
  const base = { access_token: 'a', expires_in: 3600, refresh_token: 'r', token_type: 'Bearer', id_token: jwt({ email: 'ella@gmail.example', email_verified: true }) };
  const kald = (scope: string, extra: object = {}) => byttKode({ hent: stub(() => ({ status: 200, json: { ...base, scope, ...extra } })).hent, klient: KLIENT, kode: 'k', verifier: 'v'.repeat(43), tilbage: TILBAGE, krav: MAIL_KRAV });
  const ok = await kald(`openid https://www.googleapis.com/auth/userinfo.email ${SCOPE_MAIL}`);
  assert.deepEqual(ok.scopes, ['openid', 'https://www.googleapis.com/auth/userinfo.email', SCOPE_MAIL]);
  assert.equal(ok.adresse, 'ella@gmail.example');
  const flettet = await kald(`openid email ${SCOPE_MAIL} ${SCOPE_KALENDER}`);
  assert.ok(flettet.scopes.includes(SCOPE_KALENDER));
  assert.equal((await byttKode({ hent: stub(() => ({ status: 200, json: { ...base, id_token: undefined, scope: SCOPE_MAIL } })).hent, klient: KLIENT, kode: 'k', verifier: 'v'.repeat(43), tilbage: TILBAGE, krav: MAIL_KRAV })).adresse, undefined);
});

test('code exchange for mail fails closed: mail unticked on the consent screen, or a scope beyond mail, address and the read-only calendar', async () => {
  const base = { access_token: 'a', expires_in: 3600, refresh_token: 'r', token_type: 'Bearer' };
  const kald = (scope: string) => byttKode({ hent: stub(() => ({ status: 200, json: { ...base, scope } })).hent, klient: KLIENT, kode: 'k', verifier: 'v'.repeat(43), tilbage: TILBAGE, krav: MAIL_KRAV });
  await assert.rejects(kald('openid email'), (e) => e instanceof KildeFejl && e.status === 403 && /mail/i.test(e.message));
  await assert.rejects(kald(`${SCOPE_MAIL} https://www.googleapis.com/auth/drive`), (e) => e instanceof KildeFejl && e.status === 403 && /mere end/.test(e.message));
  await assert.rejects(kald(`${SCOPE_MAIL} https://www.googleapis.com/auth/calendar`), (e) => e instanceof KildeFejl && e.status === 403);
});

test('code exchange: a real HTTP round-trip, form-encoded with the verifier and the same redirect URI', async () => {
  const modtaget: { url: string; type: string; krop: URLSearchParams }[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      modtaget.push({ url: req.url ?? '', type: req.headers['content-type'] ?? '', krop: new URLSearchParams(b) });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ access_token: 'ya29.adgang', expires_in: 3599, refresh_token: '1//varig', scope: SCOPE_KALENDER, token_type: 'Bearer' }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  // Google's host is pointed at the local stub; everything else is real fetch.
  const hent = ((input: string | URL | Request, init?: RequestInit) => fetch(String(input).replace('https://oauth2.googleapis.com', `http://127.0.0.1:${port}`), init)) as Hent;
  try {
    const t = await byttKode({ hent, klient: KLIENT, kode: '4/kode', verifier: 'v'.repeat(43), tilbage: TILBAGE, krav: KALENDER_KRAV });
    assert.deepEqual(t, { refresh: '1//varig', adgang: 'ya29.adgang', udloeberMs: 3599_000, scopes: [SCOPE_KALENDER] });
    assert.equal(modtaget.length, 1);
    assert.equal(modtaget[0]!.url, '/token');
    assert.match(modtaget[0]!.type, /application\/x-www-form-urlencoded/);
    assert.deepEqual(Object.fromEntries(modtaget[0]!.krop), {
      grant_type: 'authorization_code', code: '4/kode', code_verifier: 'v'.repeat(43), redirect_uri: TILBAGE, client_id: KLIENT.id, client_secret: KLIENT.hemmelighed,
    });
  } finally { await new Promise((r) => server.close(r)); }
});

test('code exchange fails closed: no refresh token, scope unticked, or a write scope', async () => {
  const svarMed = (json: unknown) => stub(() => ({ status: 200, json })).hent;
  const base = { access_token: 'a', expires_in: 3600, token_type: 'Bearer' };
  const kald = (json: unknown) => byttKode({ hent: svarMed(json), klient: KLIENT, kode: 'k', verifier: 'v'.repeat(43), tilbage: TILBAGE, krav: KALENDER_KRAV });
  await assert.rejects(kald({ ...base, scope: SCOPE_KALENDER }), (e) => e instanceof KildeFejl && e.status === 502 && /varig/.test(e.message));
  await assert.rejects(kald({ ...base, refresh_token: 'r', scope: 'openid' }), (e) => e instanceof KildeFejl && e.status === 403 && /kalender/i.test(e.message));
  await assert.rejects(kald({ ...base, refresh_token: 'r', scope: `${SCOPE_KALENDER} https://www.googleapis.com/auth/calendar` }), (e) => e instanceof KildeFejl && e.status === 403);
  await assert.rejects(kald({ ...base, refresh_token: '', scope: SCOPE_KALENDER }), KildeFejl);
});

test('code exchange: Google refusing the code is a 502 with Danish text and no value in the message', async () => {
  const { hent } = stub(() => ({ status: 400, json: { error: 'invalid_grant', error_description: 'Bad Request' } }));
  await assert.rejects(byttKode({ hent, klient: KLIENT, kode: '4/hemmelig-kode', verifier: 'v'.repeat(43), tilbage: TILBAGE, krav: KALENDER_KRAV }), (e) => {
    assert.ok(e instanceof GoogleFejl);
    assert.equal(e.art, 'afvist');
    assert.ok(!e.message.includes('hemmelig'), 'no code or secret in the message');
    return true;
  });
});

test('refresh: grant_type refresh_token with the client; invalid_grant → afvist, a 5xx or a network error → nede', async () => {
  const ok = stub(() => ({ status: 200, json: { access_token: 'ny', expires_in: 1800, scope: SCOPE_KALENDER, token_type: 'Bearer' } }));
  assert.deepEqual(await forny({ hent: ok.hent, klient: KLIENT, refresh: '1//varig' }), { adgang: 'ny', udloeberMs: 1800_000 });
  assert.equal(ok.kald[0]!.url, ENDPOINTS.token);
  assert.deepEqual(Object.fromEntries(ok.kald[0]!.krop), { grant_type: 'refresh_token', refresh_token: '1//varig', client_id: KLIENT.id, client_secret: KLIENT.hemmelighed });

  const afvist = stub(() => ({ status: 400, json: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }));
  await assert.rejects(forny({ hent: afvist.hent, klient: KLIENT, refresh: 'r' }), (e) => e instanceof GoogleFejl && e.art === 'afvist');
  const nede = stub(() => ({ status: 503, json: {} }));
  await assert.rejects(forny({ hent: nede.hent, klient: KLIENT, refresh: 'r' }), (e) => e instanceof GoogleFejl && e.art === 'nede');
  const netvaerk = (async () => { throw new TypeError('fetch failed'); }) as Hent;
  await assert.rejects(forny({ hent: netvaerk, klient: KLIENT, refresh: 'r' }), (e) => e instanceof GoogleFejl && e.art === 'nede');
  const klient = stub(() => ({ status: 401, json: { error: 'invalid_client' } }));
  await assert.rejects(forny({ hent: klient.hent, klient: KLIENT, refresh: 'r' }), (e) => e instanceof GoogleFejl && e.art === 'klient');
});

test('revoke: POST form token to the revoke endpoint; true on 200, false otherwise (never throws)', async () => {
  const ok = stub(() => ({ status: 200, json: {} }));
  assert.equal(await tilbagekald({ hent: ok.hent, token: '1//varig' }), true);
  assert.equal(ok.kald[0]!.url, 'https://oauth2.googleapis.com/revoke');
  assert.equal(ok.kald[0]!.metode, 'POST');
  assert.match(ok.kald[0]!.type, /x-www-form-urlencoded/);
  assert.equal(ok.kald[0]!.krop.get('token'), '1//varig');
  assert.equal(await tilbagekald({ hent: stub(() => ({ status: 400, json: { error: 'invalid_token' } })).hent, token: 'x' }), false);
  assert.equal(await tilbagekald({ hent: (async () => { throw new Error('net'); }) as Hent, token: 'x' }), false);
});
