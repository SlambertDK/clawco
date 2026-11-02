// KC-0135: Gmail's folders by special-use flag, never by name, and the one
// trap in them: "All Mail" (\All) holds every mail including the INBOX ones, so
// it is never counted as an archive — INBOX membership is the inbox.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { laesKonto, mapperFra } from '../../../src/kilder/mail-imap/imap.ts';
import { forbindelse } from '../../../src/kilder/mail-imap/presets.ts';
import { startFalskImap, testCertifikat, type FalskBesked, type FalskPostkasse } from '../../helpers/falsk-imap.ts';

const ADRESSE = 'mig@gmail.example';
const TOKEN = 'ya29.kort';
const PIN = new X509Certificate(testCertifikat('bridge').cert).fingerprint256;
const n = (antal: number, flags: string[] = []): FalskBesked[] => Array.from({ length: antal }, (_, i) => ({ uid: i + 1, flags, dato: `2026-10-${String(10 + i).padStart(2, '0')}T10:00:00Z`, emne: `m${i}` }));

const KASSER: FalskPostkasse[] = [
  { navn: 'INBOX', beskeder: [...n(2), ...n(1, ['\\Seen']).map((b) => ({ ...b, uid: 3 }))] },
  { navn: '[Gmail]/All Mail', specialUse: '\\All', beskeder: n(10) },
  { navn: '[Gmail]/Sent Mail', specialUse: '\\Sent', beskeder: n(1) },
  { navn: '[Gmail]/Spam', specialUse: '\\Junk', beskeder: n(2) },
  { navn: '[Gmail]/Trash', specialUse: '\\Trash', beskeder: n(3) },
  { navn: '[Gmail]/Important', specialUse: '\\Important', beskeder: n(4) },
  { navn: '[Gmail]/Starred', specialUse: '\\Flagged', beskeder: n(5) },
  { navn: '[Gmail]/Drafts', specialUse: '\\Drafts', beskeder: n(1) },
  // Named like Gmail's sent folder, but not flagged: never counted as one.
  { navn: 'Sent', beskeder: n(7) },
];

test('mapperFra (gmail): \\Sent, \\Junk and \\Trash by flag; \\All, \\Important, \\Flagged and \\Drafts are never a count', () => {
  const liste = KASSER.map((k) => ({ path: k.navn, ...(k.specialUse ? { specialUse: k.specialUse } : {}) }));
  assert.deepEqual(mapperFra(liste, 'gmail'), { sendt: '[Gmail]/Sent Mail', spam: '[Gmail]/Spam', papirkurv: '[Gmail]/Trash' });
});

test('mapperFra (standard) is what KC-0134 had: sent, archive and junk; Trash and \\All stay unmapped', () => {
  const liste = [{ path: 'Ting', specialUse: '\\Sent' }, { path: 'Gammelt', specialUse: '\\Archive' }, { path: 'Skidt', specialUse: '\\Junk' }, { path: 'Bin', specialUse: '\\Trash' }, { path: 'Alt', specialUse: '\\All' }];
  assert.deepEqual(mapperFra(liste, 'standard'), { sendt: 'Ting', arkiv: 'Gammelt', spam: 'Skidt' });
});

test('laesKonto (gmail): the inbox is INBOX alone, All Mail is not an archive, counts are per flagged folder', async () => {
  const s = await startFalskImap({ brugere: {}, postkasser: KASSER, tls: 'tls', tokens: (b, t) => b === ADRESSE && t === TOKEN });
  try {
    const f = forbindelse({ tjeneste: 'anden', adresse: ADRESSE, server: '127.0.0.1', port: String(s.port), sikkerhed: 'tls' });
    const r = await laesKonto(f, { accessToken: TOKEN }, { pin: PIN, tidsgraenseMs: 1500, profil: 'gmail' });
    assert.deepEqual(r.tal, { indbakke: 3, ulaeste: 2, mapper: { sendt: 1, spam: 2, papirkurv: 3 } });
    assert.equal(r.kuverter.length, 3, 'envelopes come from INBOX, not from All Mail (10)');
    for (const m of ['STORE', 'APPEND', 'MOVE', 'UID MOVE', 'EXPUNGE', 'SELECT']) assert.ok(!s.kommandoer.includes(m), m);
  } finally { await s.luk(); }
});
