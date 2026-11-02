// KC-0214: the mail connector's two verbs against the fake IMAP server. The
// invariants (§0 r2, KC-0122): a verb's client may send the read commands plus
// exactly its own (flyt: SELECT, UID MOVE; kladde: APPEND) — never STORE,
// EXPUNGE, COPY, CLOSE, CREATE or DELETE; a move never lands in Trash, Junk
// or another special folder and never creates one; a draft is APPENDed to the
// Drafts folder with \Draft and nothing is ever sent; the sender's subject can
// never add a header.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { aabnKlient, flytMail, gemKladde, hentCertifikat, TILLADTE_KOMMANDOER, VERBUM_KOMMANDOER } from '../../../src/kilder/mail-imap/imap.ts';
import { kladdeBesked } from '../../../src/kilder/mail-imap/kladde.ts';
import { forbindelse } from '../../../src/kilder/mail-imap/presets.ts';
import { KildeFejl } from '../../../src/kilder/types.ts';
import { startFalskImap, testCertifikat, type FalskImap, type FalskImapValg, type FalskPostkasse } from '../../helpers/falsk-imap.ts';

const KODE = 'app-kode-1';
const PIN = new X509Certificate(testCertifikat('bridge').cert).fingerprint256;
const HURTIG = { tidsgraenseMs: 1500 };
const NU = new Date('2026-10-31T10:00:00Z');
const ALTID_FORBUDT = ['STORE', 'UID STORE', 'EXPUNGE', 'UID EXPUNGE', 'COPY', 'UID COPY', 'CLOSE', 'CREATE', 'DELETE', 'RENAME', 'SUBSCRIBE', 'UNSUBSCRIBE', 'MOVE'];

const POSTKASSER: FalskPostkasse[] = [
  { navn: 'INBOX', beskeder: [
    { uid: 7, dato: '2026-10-30T08:15:00Z', emne: 'Tilbud på eltavle', fra: { navn: 'Elektrikeren ApS', adresse: 'tilbud@el.example' }, messageId: '<a1@el.example>' },
    { uid: 8, dato: '2026-10-31T06:00:00Z', emne: 'Middag på fredag – kommer I?', fra: { navn: 'Søster', adresse: 'soester@x.example' }, messageId: '<a2@x.example>' },
    { uid: 9, dato: '2026-10-31T07:00:00Z', emne: 'Hej\r\nBcc: angriber@ond.example', fra: { adresse: 'ond@ond.example' }, messageId: '<a3@ond.example>' },
  ] },
  { navn: 'Gemt', specialUse: '\\Archive', beskeder: [{ uid: 3, dato: '2026-10-01T10:00:00Z' }] },
  { navn: 'Papirkurv', specialUse: '\\Trash', beskeder: [] },
  { navn: 'Skidt', specialUse: '\\Junk', beskeder: [] },
  { navn: 'Kladder', specialUse: '\\Drafts', beskeder: [] },
  { navn: 'Spam', beskeder: [] },
  { navn: 'Folders/Afventer', beskeder: [] },
];

async function med(o: Partial<FalskImapValg>, fn: (s: FalskImap) => Promise<void>): Promise<void> {
  const s = await startFalskImap({ brugere: { 'mig@x.example': KODE }, postkasser: POSTKASSER, tls: 'tls', ...o });
  try { await fn(s); } finally { await s.luk(); }
}
const konto = (port: number) => forbindelse({ tjeneste: 'anden', adresse: 'mig@x.example', server: '127.0.0.1', port: String(port), sikkerhed: 'tls' });
const uids = (s: FalskImap, navn: string): number[] => (s.postkasser.find((p) => p.navn === navn)?.beskeder ?? []).map((b) => b.uid);
/** Every command sent is a read command or one of the verb's own; none of the always-forbidden ones. */
function kunTilladte(s: FalskImap, verbum: keyof typeof VERBUM_KOMMANDOER): void {
  const tilladt = new Set([...TILLADTE_KOMMANDOER, ...VERBUM_KOMMANDOER[verbum]]);
  for (const k of s.kommandoer) assert.ok(tilladt.has(k), `${k} sent by ${verbum}: ${s.kommandoer.join(',')}`);
  for (const k of ALTID_FORBUDT) assert.ok(!s.kommandoer.includes(k), `${k} was sent`);
}

test('VERBUM_KOMMANDOER: flyt adds exactly SELECT and UID MOVE, kladde exactly APPEND; the read allowlist is unchanged', () => {
  assert.deepEqual(VERBUM_KOMMANDOER, { flyt: ['SELECT', 'UID MOVE'], kladde: ['APPEND'] });
  for (const k of ['SELECT', 'UID MOVE', 'APPEND', ...ALTID_FORBUDT]) assert.ok(!TILLADTE_KOMMANDOER.has(k), k);
});

test('a verb client refuses every command outside the read set plus its own', async () => {
  await med({}, async (s) => {
    const f = konto(s.port);
    const pin = { fingeraftryk: PIN, pem: (await hentCertifikat(f, HURTIG)).pem };
    for (const [verbum, egne] of Object.entries(VERBUM_KOMMANDOER) as [keyof typeof VERBUM_KOMMANDOER, readonly string[]][]) {
      const k = await aabnKlient(f, KODE, { pin, verbum, ...HURTIG });
      try {
        const exec = (k as unknown as { exec(c: string, a?: unknown[]): Promise<unknown> }).exec.bind(k);
        const andre = Object.values(VERBUM_KOMMANDOER).flat().filter((c) => !egne.includes(c));
        for (const c of [...ALTID_FORBUDT, ...andre]) await assert.rejects(exec(c, []), /ikke tilladt/, `${verbum}: ${c}`);
      } finally { await k.logout().catch(() => {}); }
    }
  });
});

test('flytMail: Archive means the \\Archive folder; UID MOVE moves exactly that mail and answers its new UID', async () => {
  await med({}, async (s) => {
    const r = await flytMail(konto(s.port), KODE, { pin: PIN, uid: 7, fra: 'INBOX', til: 'Archive', ...HURTIG });
    assert.deepEqual(r, { fra: 'INBOX', til: 'Gemt', nyUid: 4 });
    assert.deepEqual(uids(s, 'INBOX'), [8, 9]);
    assert.deepEqual(uids(s, 'Gemt'), [3, 4]);
    assert.ok(s.kommandoer.includes('SELECT') && s.kommandoer.includes('UID MOVE'));
    kunTilladte(s, 'flyt');
  });
});

test('flytMail: back again (Fortryd) by the new UID; a named folder is used as named', async () => {
  await med({}, async (s) => {
    const r = await flytMail(konto(s.port), KODE, { pin: PIN, uid: 8, fra: 'INBOX', til: 'Folders/Afventer', ...HURTIG });
    const tilbage = await flytMail(konto(s.port), KODE, { pin: PIN, uid: r.nyUid ?? 0, fra: r.til, til: r.fra, ...HURTIG });
    assert.deepEqual(tilbage, { fra: 'Folders/Afventer', til: 'INBOX', nyUid: 10 });
    assert.deepEqual(uids(s, 'INBOX'), [7, 9, 10]);
    kunTilladte(s, 'flyt');
  });
});

test('flytMail never moves to Trash, Junk, Drafts or a folder named like spam — refused before anything is selected', async () => {
  await med({}, async (s) => {
    for (const til of ['Papirkurv', 'Skidt', 'Kladder', 'Spam']) {
      const err = await flytMail(konto(s.port), KODE, { pin: PIN, uid: 7, fra: 'INBOX', til, ...HURTIG }).then(() => null, (e: unknown) => e);
      assert.ok(err instanceof KildeFejl && err.status === 400, `${til}: ${String(err)}`);
    }
    assert.ok(!s.kommandoer.includes('SELECT') && !s.kommandoer.includes('UID MOVE'));
    assert.deepEqual(uids(s, 'INBOX'), [7, 8, 9]);
  });
});

test('flytMail: a folder that does not exist is refused (no CREATE); so is a mail no longer there; so is a move to where it is', async () => {
  await med({}, async (s) => {
    const fejl = async (o: { uid: number; fra: string; til: string }) => flytMail(konto(s.port), KODE, { pin: PIN, ...o, ...HURTIG }).then(() => null, (e: unknown) => e);
    const mangler = await fejl({ uid: 7, fra: 'INBOX', til: 'Folders/Findes-ikke' });
    assert.ok(mangler instanceof KildeFejl && mangler.status === 404 && /findes ikke/.test(mangler.message), String(mangler));
    const vaek = await fejl({ uid: 99, fra: 'INBOX', til: 'Archive' });
    assert.ok(vaek instanceof KildeFejl && vaek.status === 404 && /ligger ikke/.test(vaek.message), String(vaek));
    const samme = await fejl({ uid: 7, fra: 'INBOX', til: 'inbox' });
    assert.ok(samme instanceof KildeFejl && samme.status === 400, String(samme));
    assert.ok(!s.kommandoer.includes('UID MOVE'));
    kunTilladte(s, 'flyt');
  });
});

test('flytMail: a server without MOVE is refused before anything is selected (never COPY + STORE + EXPUNGE)', async () => {
  await med({ udenMove: true }, async (s) => {
    const err = await flytMail(konto(s.port), KODE, { pin: PIN, uid: 7, fra: 'INBOX', til: 'Archive', ...HURTIG }).then(() => null, (e: unknown) => e);
    assert.ok(err instanceof KildeFejl && err.status === 409, String(err));
    assert.ok(!s.kommandoer.includes('SELECT'));
    assert.deepEqual(uids(s, 'INBOX'), [7, 8, 9]);
  });
});

test('gemKladde: APPENDs the reply to the Drafts folder with \\Draft; the original is only EXAMINEd; nothing is sent or moved', async () => {
  await med({}, async (s) => {
    const r = await gemKladde(konto(s.port), KODE, { pin: PIN, uid: 8, tekst: 'Hej søs\n\nVi kommer gerne.\n\nHenrik', nu: NU, ...HURTIG });
    assert.deepEqual(r, { mappe: 'Kladder' });
    assert.equal(s.tilfoejet.length, 1);
    const [t] = s.tilfoejet;
    assert.equal(t?.mappe, 'Kladder');
    assert.deepEqual(t?.flag, ['\\Draft', '\\Seen']);
    const [hoved = '', krop = ''] = (t?.tekst ?? '').split('\r\n\r\n');
    assert.match(hoved, /^From: mig@x\.example$/m);
    assert.match(hoved, /^To: soester@x\.example$/m);
    assert.match(hoved, /^In-Reply-To: <a2@x\.example>$/m);
    assert.match(hoved, /^References: <a2@x\.example>$/m);
    assert.equal(Buffer.from(krop.replace(/\r\n/g, ''), 'base64').toString('utf8'), 'Hej søs\r\n\r\nVi kommer gerne.\r\n\r\nHenrik');
    assert.deepEqual(uids(s, 'INBOX'), [7, 8, 9]);
    assert.ok(s.kommandoer.includes('EXAMINE') && s.kommandoer.includes('APPEND'));
    kunTilladte(s, 'kladde');
  });
});

test('gemKladde: a mail no longer in the inbox, or an account without a drafts folder, is refused and nothing is appended', async () => {
  await med({}, async (s) => {
    const err = await gemKladde(konto(s.port), KODE, { pin: PIN, uid: 99, tekst: 'x', nu: NU, ...HURTIG }).then(() => null, (e: unknown) => e);
    assert.ok(err instanceof KildeFejl && err.status === 404, String(err));
  });
  await med({ postkasser: POSTKASSER.filter((p) => p.navn !== 'Kladder') }, async (s) => {
    const err = await gemKladde(konto(s.port), KODE, { pin: PIN, uid: 8, tekst: 'x', nu: NU, ...HURTIG }).then(() => null, (e: unknown) => e);
    assert.ok(err instanceof KildeFejl && err.status === 409 && /kladdemappe/.test(err.message), String(err));
    assert.equal(s.tilfoejet.length, 0);
  });
});

test('kladdeBesked: the subject is encoded and "Re:"-prefixed once; a line break in it never becomes a header', () => {
  const b = kladdeBesked({ fra: 'mig@x.example', til: 'ond@ond.example', emne: 'Hej\r\nBcc: angriber@ond.example', messageId: '<a3@ond.example>', tekst: 'ok', nu: NU, id: 'abc' });
  const hoved = b.split('\r\n\r\n')[0] ?? '';
  assert.ok(!/^Bcc:/im.test(hoved), hoved);
  assert.match(hoved, /^Subject: Re: Hej Bcc: angriber@ond\.example$/m);
  const dansk = kladdeBesked({ fra: 'mig@x.example', til: 'a@b.example', emne: 'RE: Middag på fredag – kommer I?', tekst: 'ok', nu: NU, id: 'abc' });
  const emne = /^Subject: (.*(?:\r\n .*)*)$/m.exec(dansk)?.[1] ?? '';
  assert.ok(/^[\x20-\x7e\r\n]*$/.test(emne), 'the header is 7-bit');
  const afkodet = emne.split(/\r\n /).map((ord) => Buffer.from(/=\?UTF-8\?B\?(.*)\?=/.exec(ord)?.[1] ?? '', 'base64').toString('utf8')).join('');
  assert.equal(afkodet, 'RE: Middag på fredag – kommer I?');
  for (const linje of dansk.split('\r\n')) assert.ok(linje.length <= 78, linje);
  assert.match(dansk, /^Message-ID: <abc@x\.example>$/m);
  assert.match(dansk, /^Date: Sat, 31 Oct 2026 10:00:00 \+0000$/m);
  assert.ok(!/^In-Reply-To:/m.test(dansk), 'no Message-ID, no In-Reply-To');
});

test('kladdeBesked: an invalid recipient or a Message-ID with odd characters is refused or left out', () => {
  assert.throws(() => kladdeBesked({ fra: 'mig@x.example', til: 'a@b.example\r\nBcc: c@d.example', emne: 'x', tekst: 'ok', nu: NU, id: 'abc' }), KildeFejl);
  assert.throws(() => kladdeBesked({ fra: 'mig@x.example', til: '', emne: 'x', tekst: 'ok', nu: NU, id: 'abc' }), KildeFejl);
  const b = kladdeBesked({ fra: 'mig@x.example', til: 'a@b.example', emne: 'x', messageId: '<a@b>\r\nBcc: c@d.example', tekst: 'ok', nu: NU, id: 'abc' });
  assert.ok(!/In-Reply-To|Bcc/.test(b));
});
