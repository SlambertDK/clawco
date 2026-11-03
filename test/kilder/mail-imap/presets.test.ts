// KC-0134: the mail presets are data, the connection a user picks is resolved
// from them, and TLS verification is only ever relaxed for a loopback host
// whose certificate is the pinned one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PRESETS, TJENESTER, erLoopback, forbindelse, normalFingeraftryk, tlsValg } from '../../../src/kilder/mail-imap/presets.ts';
import { KildeFejl } from '../../../src/kilder/types.ts';

const pem = (n: string): string => readFileSync(new URL(`../../helpers/certifikater/${n}.crt`, import.meta.url), 'utf8');
const BRIDGE = pem('bridge');
const ANDEN = pem('anden');
const fp = (p: string): string => new X509Certificate(p).fingerprint256;
const peer = (p: string) => ({ fingerprint256: fp(p) }) as never;

test('presets: every service is data with host, port and security', () => {
  assert.deepEqual([...TJENESTER], ['proton-bridge', 'fastmail', 'icloud', 'gmail', 'anden']);
  assert.deepEqual(PRESETS['proton-bridge'], { navn: 'Proton (via Bridge)', vaert: '127.0.0.1', port: 1143, sikkerhed: 'starttls' });
  assert.deepEqual(PRESETS.fastmail, { navn: 'Fastmail', vaert: 'imap.fastmail.com', port: 993, sikkerhed: 'tls' });
  assert.deepEqual(PRESETS.icloud, { navn: 'iCloud', vaert: 'imap.mail.me.com', port: 993, sikkerhed: 'tls' });
  assert.deepEqual(PRESETS.gmail, { navn: 'Gmail (app-adgangskode)', vaert: 'imap.gmail.com', port: 993, sikkerhed: 'tls' });
  assert.equal(PRESETS.anden.vaert, '');
});

test('forbindelse: a preset fixes host and security; the port may be overridden; the address is the login', () => {
  assert.deepEqual(forbindelse({ tjeneste: 'fastmail', adresse: 'a@b.example' }), { tjeneste: 'fastmail', vaert: 'imap.fastmail.com', port: 993, sikkerhed: 'tls', bruger: 'a@b.example' });
  assert.deepEqual(forbindelse({ tjeneste: 'proton-bridge', adresse: 'a@proton.me', port: '1144', server: 'ond.example', sikkerhed: 'tls' }),
    { tjeneste: 'proton-bridge', vaert: '127.0.0.1', port: 1144, sikkerhed: 'starttls', bruger: 'a@proton.me' });
  assert.deepEqual(forbindelse({ tjeneste: 'anden', adresse: 'a@b.example', server: 'mail.b.dk', sikkerhed: 'starttls' }), { tjeneste: 'anden', vaert: 'mail.b.dk', port: 143, sikkerhed: 'starttls', bruger: 'a@b.example' });
  assert.equal(forbindelse({ tjeneste: 'anden', adresse: 'a@b.example', server: 'mail.b.dk' }).port, 993);
});

test('forbindelse: refuses a missing service, address or server and a bad port (400)', () => {
  const er400 = (e: unknown) => e instanceof KildeFejl && e.status === 400;
  assert.throws(() => forbindelse({ adresse: 'a@b.example' }), er400);
  assert.throws(() => forbindelse({ tjeneste: 'yahoo', adresse: 'a@b.example' }), er400);
  assert.throws(() => forbindelse({ tjeneste: 'fastmail' }), er400);
  assert.throws(() => forbindelse({ tjeneste: 'anden', adresse: 'a@b.example' }), er400);
  assert.throws(() => forbindelse({ tjeneste: 'anden', adresse: 'a@b.example', server: 'mail b.dk' }), er400);
  for (const port of ['0', '70000', 'abc', '99.5']) assert.throws(() => forbindelse({ tjeneste: 'fastmail', adresse: 'a@b.example', port }), er400, port);
});

test('erLoopback: only loopback IP literals', () => {
  for (const h of ['127.0.0.1', '127.1.2.3', '::1']) assert.equal(erLoopback(h), true, h);
  for (const h of ['localhost', 'imap.fastmail.com', '127.0.0.1.evil.com', '10.0.0.1', '', '::ffff:8.8.8.8']) assert.equal(erLoopback(h), false, h);
});

test('normalFingeraftryk: colons and case are optional; anything but 32 bytes of hex is nothing', () => {
  const f = fp(BRIDGE);
  assert.equal(normalFingeraftryk(f.replace(/:/g, '').toLowerCase()), f);
  assert.equal(normalFingeraftryk(f), f);
  assert.equal(normalFingeraftryk('AB:CD'), '');
  assert.equal(normalFingeraftryk(''), '');
});

test('tlsValg: any host that is not loopback is verified normally, even with a pin', () => {
  const f = forbindelse({ tjeneste: 'anden', adresse: 'a@b.example', server: 'mail.b.dk' });
  for (const o of [tlsValg(f), tlsValg(f, { fingeraftryk: fp(ANDEN), pem: ANDEN })]) {
    assert.notEqual(o.rejectUnauthorized, false);
    assert.equal(o.ca, undefined);
    assert.equal(o.checkServerIdentity, undefined);
  }
});

test('tlsValg: a loopback host trusts only the pinned certificate', () => {
  const f = forbindelse({ tjeneste: 'proton-bridge', adresse: 'a@proton.me' });
  const o = tlsValg(f, { fingeraftryk: fp(BRIDGE), pem: BRIDGE });
  assert.equal(o.rejectUnauthorized, true);
  assert.deepEqual(o.ca, [BRIDGE]);
  assert.equal(o.checkServerIdentity?.('127.0.0.1', peer(BRIDGE)), undefined);
  assert.ok(o.checkServerIdentity?.('127.0.0.1', peer(ANDEN)) instanceof Error);
  // Without a pin a loopback host is verified like any other (and a self-signed Bridge fails).
  const uden = tlsValg(f);
  assert.notEqual(uden.rejectUnauthorized, false);
  assert.equal(uden.ca, undefined);
});

// KC-0274 (C2): a hosted install may only name a mail server on the public internet.
test('forbindelse (hosted): "anden" refuses loopback, LAN, link-local and metadata servers with a fixed sentence; presets and public servers are untouched', () => {
  const hostet = { hostet: true } as const;
  for (const server of ['127.0.0.1', 'localhost', '192.168.1.5', '10.0.0.7', '172.16.0.1', '169.254.169.254', '::1', 'fd12::1', '2002:7f00:1::', 'metadata.google.internal', 'x.localhost']) {
    assert.throws(() => forbindelse({ tjeneste: 'anden', adresse: 'a@b.example', server }, hostet), (e: unknown) => e instanceof KildeFejl && e.status === 400 && !e.message.includes(server), server);
    // Not hosted: unchanged (a self-hoster's own server on the LAN is the point of "anden").
    assert.doesNotThrow(() => forbindelse({ tjeneste: 'anden', adresse: 'a@b.example', server }), server);
  }
  assert.equal(forbindelse({ tjeneste: 'anden', adresse: 'a@b.example', server: 'mail.b.dk' }, hostet).vaert, 'mail.b.dk');
  assert.equal(forbindelse({ tjeneste: 'anden', adresse: 'a@b.example', server: '93.184.216.34' }, hostet).vaert, '93.184.216.34');
  assert.equal(forbindelse({ tjeneste: 'fastmail', adresse: 'a@b.example' }, hostet).vaert, 'imap.fastmail.com');
});
