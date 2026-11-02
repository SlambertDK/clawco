// KC-0134: the IMAP session against an in-process fake server. The invariant
// (§0 r2/r7): the connector can only read envelopes — the mailbox is opened
// with EXAMINE, never SELECT; no STORE/APPEND/EXPUNGE/COPY/MOVE ever reaches
// the wire; TLS verification is only relaxed for the pinned loopback case,
// and a wrong pin stops the connection before the password is sent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { aabnKlient, hentCertifikat, laesKonto, TILLADTE_KOMMANDOER } from '../../../src/kilder/mail-imap/imap.ts';
import { FEJLTEKST, klassificer } from '../../../src/kilder/mail-imap/fejl.ts';
import { forbindelse, PinFejl } from '../../../src/kilder/mail-imap/presets.ts';
import { lukketPort, startFalskImap, testCertifikat, type FalskImapValg, type FalskPostkasse } from '../../helpers/falsk-imap.ts';

const KODE = 'app-kode-1';
const PIN = new X509Certificate(testCertifikat('bridge').cert).fingerprint256;
const ANDEN_PIN = new X509Certificate(testCertifikat('anden').cert).fingerprint256;
const MUTERENDE = ['SELECT', 'STORE', 'UID STORE', 'APPEND', 'EXPUNGE', 'UID EXPUNGE', 'COPY', 'UID COPY', 'MOVE', 'UID MOVE', 'CLOSE', 'CREATE', 'DELETE', 'RENAME', 'SUBSCRIBE', 'UNSUBSCRIBE'];
const HURTIG = { tidsgraenseMs: 1500 };

const POSTKASSER: FalskPostkasse[] = [
  { navn: 'INBOX', beskeder: [
    { uid: 11, flags: ['\\Seen'], dato: '2026-10-30T08:15:00Z', emne: 'Tilbud på eltavle', fra: { navn: 'Elektrikeren ApS', adresse: 'tilbud@el.example' }, messageId: '<a1@el.example>', vedhaeftning: true },
    { uid: 12, flags: ['\\Flagged'], dato: '2026-10-31T06:00:00Z', emne: 'Svar inden fredag', fra: { adresse: 'ven@x.example' }, messageId: '<a2@x.example>' },
    { uid: 13, dato: '2026-10-29T12:00:00Z', fra: { navn: 'Nyhedsbrev', adresse: 'nyt@y.example' } },
  ] },
  { navn: 'Ting', specialUse: '\\Sent', beskeder: [{ uid: 1, flags: ['\\Seen'], dato: '2026-10-28T10:00:00Z', emne: 'sendt' }] },
  { navn: 'Gammelt', specialUse: '\\Archive', beskeder: [{ uid: 1, dato: '2026-10-01T10:00:00Z' }, { uid: 2, dato: '2026-10-02T10:00:00Z' }] },
  { navn: 'Skidt', specialUse: '\\Junk', beskeder: [{ uid: 1, dato: '2026-10-03T10:00:00Z' }] },
  // Named like a sent folder but not flagged: never counted as one (special-use by flag, not name).
  { navn: 'Sent', beskeder: [{ uid: 1, dato: '2026-10-04T10:00:00Z' }, { uid: 2, dato: '2026-10-05T10:00:00Z' }, { uid: 3, dato: '2026-10-06T10:00:00Z' }] },
];

async function med(o: Partial<FalskImapValg>, fn: (s: Awaited<ReturnType<typeof startFalskImap>>) => Promise<void>): Promise<void> {
  const s = await startFalskImap({ brugere: { 'mig@x.example': KODE }, postkasser: POSTKASSER, tls: 'tls', ...o });
  try { await fn(s); } finally { await s.luk(); }
}
const konto = (port: number, sikkerhed: 'tls' | 'starttls' = 'tls') => forbindelse({ tjeneste: 'anden', adresse: 'mig@x.example', server: '127.0.0.1', port: String(port), sikkerhed });
const ingenMuterende = (k: string[]): void => { for (const m of MUTERENDE) assert.ok(!k.includes(m), `${m} was sent: ${k.join(',')}`); };

test('laesKonto: envelopes and flags, newest first; counts from STATUS; special-use folders by flag, not name', async () => {
  await med({}, async (s) => {
    const r = await laesKonto(konto(s.port), KODE, { pin: PIN, ...HURTIG });
    assert.deepEqual(r.kuverter.map((k) => [k.id, k.emne, k.fra, k.laest, k.flag, k.vedhaeftning]), [
      ['12', 'Svar inden fredag', 'ven@x.example', false, true, false],
      ['11', 'Tilbud på eltavle', 'Elektrikeren ApS', true, false, true],
      ['13', '(uden emne)', 'Nyhedsbrev', false, false, false],
    ]);
    assert.equal(r.kuverter[1]?.messageId, '<a1@el.example>');
    assert.deepEqual(r.tal, { indbakke: 3, ulaeste: 2, mapper: { sendt: 1, arkiv: 2, spam: 1 } });
  });
});

test('laesKonto: opens INBOX with EXAMINE and never sends a mutating command', async () => {
  await med({}, async (s) => {
    await laesKonto(konto(s.port), KODE, { pin: PIN, ...HURTIG });
    assert.ok(s.kommandoer.includes('EXAMINE'), s.kommandoer.join(','));
    ingenMuterende(s.kommandoer);
    for (const k of s.kommandoer) assert.ok(TILLADTE_KOMMANDOER.has(k), `${k} is not on the allowlist`);
  });
});

test('laesKonto: an empty INBOX is no envelopes and no FETCH', async () => {
  await med({ postkasser: [{ navn: 'INBOX', beskeder: [] }] }, async (s) => {
    const r = await laesKonto(konto(s.port), KODE, { pin: PIN, ...HURTIG });
    assert.deepEqual(r, { kuverter: [], tal: { indbakke: 0, ulaeste: 0, mapper: {} } });
    assert.ok(!s.kommandoer.includes('FETCH'));
  });
});

test('laesKonto: a wrong password is an authentication failure (the wrong-password text)', async () => {
  await med({}, async (s) => {
    const err = await laesKonto(konto(s.port), 'forkert', { pin: PIN, ...HURTIG }).then(() => null, (e: unknown) => e);
    assert.equal(klassificer(err, { loopback: true }).tekst, FEJLTEKST.adgangskode);
    assert.ok(!s.kommandoer.includes('EXAMINE'));
  });
});

test('the guard: a mutating or SELECT command is refused before it reaches the wire', async () => {
  await med({}, async (s) => {
    const f = konto(s.port);
    const cert = await hentCertifikat(f, HURTIG);
    const k = await aabnKlient(f, KODE, { pin: { fingeraftryk: PIN, pem: cert.pem }, ...HURTIG });
    try {
      const exec = (k as unknown as { exec(c: string, a?: unknown[]): Promise<unknown> }).exec.bind(k);
      for (const c of ['STORE', 'UID STORE', 'APPEND', 'EXPUNGE', 'COPY', 'MOVE', 'SELECT', 'DELETE']) await assert.rejects(exec(c, []), /ikke tilladt/, c);
      await assert.rejects(k.mailboxOpen('INBOX'));
      await k.mailboxOpen('INBOX', { readOnly: true });
      assert.equal(await k.messageFlagsAdd('1', ['\\Seen']).catch(() => false), false);
      ingenMuterende(s.kommandoer);
    } finally { await k.logout().catch(() => {}); }
  });
});

test('STARTTLS on loopback with the pinned certificate works; LOGIN only after the upgrade', async () => {
  await med({ tls: 'starttls' }, async (s) => {
    const r = await laesKonto(konto(s.port, 'starttls'), KODE, { pin: PIN, ...HURTIG });
    assert.equal(r.kuverter.length, 3);
    assert.ok(s.kommandoer.indexOf('STARTTLS') < s.kommandoer.indexOf('LOGIN'));
  });
});

test('a certificate other than the pinned one stops before the password is sent', async () => {
  for (const tls of ['tls', 'starttls'] as const) {
    await med({ tls, cert: 'anden' }, async (s) => {
      const err = await laesKonto(konto(s.port, tls), KODE, { pin: PIN, ...HURTIG }).then(() => null, (e: unknown) => e);
      assert.ok(err instanceof PinFejl, String(err));
      assert.equal(s.logins, 0);
      assert.ok(!s.kommandoer.includes('LOGIN'), tls);
    });
  }
});

test('without a pin a self-signed certificate is refused (verification stays on), before LOGIN', async () => {
  await med({}, async (s) => {
    const err = await laesKonto(konto(s.port), KODE, HURTIG).then(() => null, (e: unknown) => e);
    assert.equal(klassificer(err, { loopback: true }).tekst, FEJLTEKST.certifikat);
    assert.ok(!s.kommandoer.includes('LOGIN'));
  });
});

test('hentCertifikat: reads the loopback certificate without logging in; refuses any other host', async () => {
  await med({ tls: 'starttls', cert: 'anden' }, async (s) => {
    const c = await hentCertifikat(konto(s.port, 'starttls'), HURTIG);
    assert.equal(c.fingeraftryk, ANDEN_PIN);
    assert.deepEqual(s.kommandoer.filter((k) => k !== 'CAPABILITY'), ['STARTTLS']);
  });
  await assert.rejects(hentCertifikat(forbindelse({ tjeneste: 'fastmail', adresse: 'a@b.example' }), HURTIG), /loopback/);
});

test('a server without STARTTLS is refused, never used in plaintext', async () => {
  const s = await startFalskImap({ brugere: { 'mig@x.example': KODE }, postkasser: POSTKASSER });
  try {
    const err = await laesKonto(konto(s.port, 'starttls'), KODE, { pin: PIN, ...HURTIG }).then(() => null, (e: unknown) => e);
    assert.ok(err, 'refused');
    assert.ok(!s.kommandoer.includes('LOGIN'));
  } finally { await s.luk(); }
});

test('a server that never answers times out (server does not answer); a closed loopback port is Bridge not running', async () => {
  await med({ stum: true, tls: undefined }, async (s) => {
    const err = await laesKonto(forbindelse({ tjeneste: 'anden', adresse: 'mig@x.example', server: '127.0.0.1', port: String(s.port) }), KODE, { tidsgraenseMs: 300 }).then(() => null, (e: unknown) => e);
    assert.equal(klassificer(err, { loopback: false }).tekst, FEJLTEKST.svarer);
  });
  const port = await lukketPort();
  const err = await laesKonto(forbindelse({ tjeneste: 'proton-bridge', adresse: 'mig@x.example', port: String(port) }), KODE, { pin: PIN, ...HURTIG }).then(() => null, (e: unknown) => e);
  assert.equal(klassificer(err, { loopback: true }).tekst, FEJLTEKST.bridge);
});
