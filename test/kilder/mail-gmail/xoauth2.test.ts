// KC-0135: the IMAP reader over XOAUTH2 against the in-process fake server.
// The invariant of KC-0134 (§0 r2/r7) re-run on the new path: the mailbox is
// opened with EXAMINE, nothing outside the allowlist reaches the wire, and the
// access token is the only credential (no LOGIN, no password).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { laesKonto, TILLADTE_KOMMANDOER } from '../../../src/kilder/mail-imap/imap.ts';
import { forbindelse } from '../../../src/kilder/mail-imap/presets.ts';
import { startFalskImap, testCertifikat } from '../../helpers/falsk-imap.ts';
import { GMAIL_KASSER } from '../../helpers/gmail-kasser.ts';

const ADRESSE = 'mig@gmail.example';
const TOKEN = 'ya29.xoauth2-token-1';
const PIN = new X509Certificate(testCertifikat('bridge').cert).fingerprint256;
const MUTERENDE = ['SELECT', 'STORE', 'UID STORE', 'APPEND', 'EXPUNGE', 'UID EXPUNGE', 'COPY', 'UID COPY', 'MOVE', 'UID MOVE', 'CLOSE', 'CREATE', 'DELETE', 'RENAME', 'SUBSCRIBE', 'UNSUBSCRIBE'];
const HURTIG = { tidsgraenseMs: 1500 };

async function med(tokens: (b: string, t: string) => boolean, fn: (s: Awaited<ReturnType<typeof startFalskImap>>) => Promise<void>): Promise<void> {
  const s = await startFalskImap({ brugere: {}, postkasser: GMAIL_KASSER, tls: 'tls', tokens });
  try { await fn(s); } finally { await s.luk(); }
}
const konto = (port: number) => forbindelse({ tjeneste: 'anden', adresse: ADRESSE, server: '127.0.0.1', port: String(port), sikkerhed: 'tls' });

test('XOAUTH2: a valid access token reads the envelopes; AUTHENTICATE, never LOGIN', async () => {
  await med((b, t) => b === ADRESSE && t === TOKEN, async (s) => {
    const r = await laesKonto(konto(s.port), { accessToken: TOKEN }, { pin: PIN, ...HURTIG });
    assert.deepEqual(r.kuverter.map((k) => [k.id, k.emne, k.laest]), [['12', 'Svar inden fredag', false], ['11', 'Tilbud på eltavle', true]]);
    assert.ok(s.kommandoer.includes('AUTHENTICATE'), s.kommandoer.join(','));
    assert.ok(!s.kommandoer.includes('LOGIN'), 'no password login on the token path');
    assert.equal(s.logins, 1);
  });
});

test('XOAUTH2: EXAMINE only and no mutating command ever reaches the wire (the KC-0134 assertion on this path)', async () => {
  await med(() => true, async (s) => {
    await laesKonto(konto(s.port), { accessToken: TOKEN }, { pin: PIN, ...HURTIG });
    assert.ok(s.kommandoer.includes('EXAMINE'), s.kommandoer.join(','));
    for (const m of MUTERENDE) assert.ok(!s.kommandoer.includes(m), `${m} was sent: ${s.kommandoer.join(',')}`);
    for (const k of s.kommandoer) assert.ok(TILLADTE_KOMMANDOER.has(k), `${k} is not on the allowlist`);
  });
});

test('XOAUTH2: an expired or wrong token is an authentication failure, and the mailbox is never opened', async () => {
  await med((_b, t) => t === TOKEN, async (s) => {
    const err = await laesKonto(konto(s.port), { accessToken: 'ya29.udloebet' }, { pin: PIN, ...HURTIG }).then(() => null, (e: unknown) => e);
    assert.equal((err as { authenticationFailed?: boolean } | null)?.authenticationFailed, true, String(err));
    assert.ok(!s.kommandoer.includes('EXAMINE'));
    assert.ok(!s.kommandoer.includes('LIST'));
    assert.equal(s.logins, 0);
  });
});

test('XOAUTH2: a token for another address is refused too (the user in the initial response must match)', async () => {
  await med((b, t) => b === 'en.anden@gmail.example' && t === TOKEN, async (s) => {
    const err = await laesKonto(konto(s.port), { accessToken: TOKEN }, { pin: PIN, ...HURTIG }).then(() => null, (e: unknown) => e);
    assert.equal((err as { authenticationFailed?: boolean } | null)?.authenticationFailed, true);
  });
});
