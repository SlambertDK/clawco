// KC-0134: every way a mail connection fails reads as one Danish sentence and
// a health status — never the server's own text, never the password.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEJLTEKST, klassificer } from '../../../src/kilder/mail-imap/fejl.ts';
import { PinFejl } from '../../../src/kilder/mail-imap/presets.ts';

const KODE = 'hemmelig-app-kode-123';
const fejl = (besked: string, felter: Record<string, unknown> = {}): Error => Object.assign(new Error(besked), felter);

test('klassificer: an authentication failure is the wrong password and asks to log in again (400)', () => {
  const k = klassificer(fejl(`Command failed: NO [AUTHENTICATIONFAILED] Invalid credentials for ${KODE}`, { authenticationFailed: true, responseText: `bad ${KODE}` }), { loopback: false });
  assert.deepEqual(k, { status: 'log-ind-igen', tekst: FEJLTEKST.adgangskode, http: 400 });
  assert.match(k.tekst, /forkert adgangskode/i);
});

test('klassificer: a refused loopback connection means Bridge is not running', () => {
  assert.deepEqual(klassificer(fejl('connect ECONNREFUSED 127.0.0.1:1143', { code: 'ECONNREFUSED' }), { loopback: true }), { status: 'nede', tekst: FEJLTEKST.bridge, http: 502 });
  assert.match(FEJLTEKST.bridge, /Bridge kører ikke/);
});

test('klassificer: refused, unknown host and every timeout elsewhere mean the server does not answer', () => {
  for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ETIMEOUT', 'CONNECT_TIMEOUT', 'GREETING_TIMEOUT', 'UPGRADE_TIMEOUT', 'EHOSTUNREACH', 'ECONNRESET', 'EConnectionClosed', 'NoConnection']) {
    assert.deepEqual(klassificer(fejl(`x ${code}`, { code }), { loopback: false }), { status: 'nede', tekst: FEJLTEKST.svarer, http: 502 }, code);
  }
  assert.match(FEJLTEKST.svarer, /serveren svarer ikke/i);
});

test('klassificer: a certificate that cannot be verified is refused, also when wrapped as the cause', () => {
  for (const code of ['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID']) {
    assert.deepEqual(klassificer(fejl('tls', { code }), { loopback: false }), { status: 'nede', tekst: FEJLTEKST.certifikat, http: 502 }, code);
  }
  assert.equal(klassificer(fejl('wrapped', { cause: fejl('tls', { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }) }), { loopback: false }).tekst, FEJLTEKST.certifikat);
});

test('klassificer: a changed pinned certificate asks to connect again', () => {
  assert.deepEqual(klassificer(new PinFejl(), { loopback: true }), { status: 'log-ind-igen', tekst: FEJLTEKST.pin, http: 400 });
  assert.equal(klassificer(fejl('tls', { cause: new PinFejl() }), { loopback: true }).tekst, FEJLTEKST.pin);
});

test('klassificer: a server without STARTTLS is refused, not used in plaintext', () => {
  assert.equal(klassificer(fejl('Server does not support STARTTLS'), { loopback: false }).tekst, FEJLTEKST.kryptering);
});

test('klassificer: anything else is the generic text; no text carries the password or server words', () => {
  assert.deepEqual(klassificer(fejl(`* BYE ${KODE} weird`), { loopback: false }), { status: 'nede', tekst: FEJLTEKST.ukendt, http: 502 });
  assert.deepEqual(klassificer('nope', { loopback: false }), { status: 'nede', tekst: FEJLTEKST.ukendt, http: 502 });
  for (const t of Object.values(FEJLTEKST)) {
    assert.ok(!t.includes(KODE));
    assert.ok(!/[<>]/.test(t), t);
    assert.ok(/[.]$/.test(t), t);
  }
});
