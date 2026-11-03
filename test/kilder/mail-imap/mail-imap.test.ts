// KC-0134: the mail connector end to end against the fake IMAP server — the
// card (services as choices, the Bridge password hint), Forbind checks the
// login before anything is stored and pins Bridge's certificate, the first
// read and the counts, health from the last attempt, and the password in no
// text, log or config file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { kildeKonformitet } from '../konformitet.ts';
import { medData, NU } from '../hjaelp.ts';
import { KILDER_LOG, laesKonfig, lavRegister } from '../../../src/kilder/register.ts';
import { laesKildeHemmelighed } from '../../../src/kilder/hemmeligheder.ts';
import { MAIL_IMAP_ID, mailImapKilde } from '../../../src/kilder/mail-imap/mail-imap.ts';
import { FEJLTEKST } from '../../../src/kilder/mail-imap/fejl.ts';
import { PRESETS, TJENESTER } from '../../../src/kilder/mail-imap/presets.ts';
import { imapTekst } from '../../../src/kilder/mail-imap/tekster.ts';
import { KildeFejl, type Kilde, type KildeKontekst } from '../../../src/kilder/types.ts';
import type { Person } from '../../../src/identitet/husstand.ts';
import { medMailImap } from '../../../src/server.ts';
import { kiraMail } from '../../../src/kilder/legacy/legacy.ts';
import { lukketPort, startFalskImap, testCertifikat, type FalskImap } from '../../helpers/falsk-imap.ts';

const KODE = 'bridge-kode-xyz';
const PIN = new X509Certificate(testCertifikat('bridge').cert).fingerprint256;
const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const INDBAKKE = [
  { uid: 1, flags: ['\\Seen'], dato: '2026-10-29T08:00:00Z', emne: 'Kvittering', fra: { navn: 'Butik', adresse: 'ordre@butik.example' } },
  { uid: 2, dato: '2026-10-30T08:00:00Z', emne: 'Middag fredag?', fra: { navn: 'Søster', adresse: 'soester@x.example' } },
  { uid: 3, flags: ['\\Flagged'], dato: '2026-10-31T07:00:00Z', emne: 'Faktura', fra: { adresse: 'faktura@el.example' } },
];
const TID = { tidsgraenseMs: 1500 };

async function medServer(fn: (s: FalskImap) => Promise<void>, brugere: Record<string, string> = { 'mig@proton.me': KODE }): Promise<void> {
  const s = await startFalskImap({ brugere, tls: 'starttls', postkasser: [{ navn: 'INBOX', beskeder: INDBAKKE }] });
  try { await fn(s); } finally { await s.luk(); }
}
const valg = (port: number): Record<string, string> => ({ tjeneste: 'proton-bridge', adresse: 'mig@proton.me', port: String(port), fingeraftryk: PIN });
/** The connector as kilder.json and the secret file would configure it (the conformance suite calls with empty options). */
function konfigureret(k: Kilde, v: Record<string, string>, kode: string | null): Kilde {
  const ctx = (c: KildeKontekst): KildeKontekst => ({ ...c, valg: v, hemmelighed: async () => (kode === null ? null : { adgangskode: kode }) });
  return { ...k, read: (c) => k.read(ctx(c)), helbred: (c) => k.helbred(ctx(c)), kort: (c) => k.kort(ctx(c)) };
}
const ctxFor = (v: Record<string, string>, kode: string | null, nu = NU): KildeKontekst => ({ nu, zone: 'privat', valg: v, hemmelighed: async () => (kode === null ? null : { adgangskode: kode }) });

test('mail-imap passes the conformance suite (read-only, untrusted, envelopes only; down = KildeFejl)', async () => {
  await medServer(async (s) => {
    const port = await lukketPort();
    await kildeKonformitet(konfigureret(mailImapKilde(TID), valg(s.port), KODE), { nede: konfigureret(mailImapKilde(TID), valg(port), KODE) });
  });
  const k = mailImapKilde();
  assert.equal(k.id, MAIL_IMAP_ID);
  assert.deepEqual([k.slags, k.zone, k.auth, k.tillid], ['mail', 'privat', 'apikey', 'uklar']);
  // KC-0214: exactly two verbs, on the ladder below the limits — move within the account, and prepare a draft.
  assert.deepEqual(Object.fromEntries(Object.entries(k.verber ?? {}).map(([n, v]) => [n, v.verb])), { flyt: 'sorter', kladde: 'forbered' });
  assert.equal(typeof k.act, 'function');
});

test('kort: every service is a choice; the password is a secret; the card says Bridge uses its own password', async () => {
  const kort = await mailImapKilde().kort(ctxFor({}, null));
  const felt = (n: string) => kort.felter.find((f) => f.navn === n);
  assert.deepEqual(felt('tjeneste')?.muligheder, TJENESTER.map((t) => ({ vaerdi: t, etiket: PRESETS[t].navn })));
  assert.equal(felt('tjeneste')?.paakraevet, true);
  assert.equal(felt('adresse')?.paakraevet, true);
  assert.equal(felt('adgangskode')?.type, 'hemmelig');
  assert.deepEqual(felt('sikkerhed')?.muligheder?.map((m) => m.vaerdi), ['tls', 'starttls']);
  for (const n of ['server', 'port', 'sikkerhed', 'fingeraftryk']) assert.equal(felt(n)?.paakraevet, false, n);
  assert.match(kort.tekst, /Bridge/);
  assert.match(`${kort.tekst} ${felt('adgangskode')?.etiket}`, /ikke din Proton-adgangskode/);
  assert.equal(kort.handling, 'Forbind');
});

test('forbind: a wrong password is refused with the Danish text and nothing is stored', async () => {
  await medServer(async (s) => {
    await medData(async (dir, store) => {
      const r = lavRegister({ dataDir: dir, store, nu: () => NU });
      r.registrer(mailImapKilde(TID));
      const err = await r.forbind(MAIL_IMAP_ID, { felter: { tjeneste: 'proton-bridge', adresse: 'mig@proton.me', port: String(s.port), adgangskode: 'forkert' } }, EJER).then(() => null, (e: unknown) => e);
      assert.ok(err instanceof KildeFejl && err.status === 400, String(err));
      assert.equal((err as Error).message, FEJLTEKST.adgangskode);
      assert.deepEqual(await laesKonfig(dir), { kilder: [] });
      assert.equal(await laesKildeHemmelighed(dir, MAIL_IMAP_ID), null);
    });
  });
});

test('forbind: checks the login, pins Bridge\'s certificate, reads at once; the card then shows the counts', async () => {
  await medServer(async (s) => {
    await medData(async (dir, store) => {
      const r = lavRegister({ dataDir: dir, store, nu: () => NU });
      r.registrer(mailImapKilde(TID));
      const svar = await r.forbind(MAIL_IMAP_ID, { felter: { tjeneste: 'proton-bridge', adresse: 'mig@proton.me', port: String(s.port), adgangskode: KODE } }, EJER);
      assert.ok('forbundet' in svar);
      assert.deepEqual(svar.foersteLaesning, { slags: 'mail', hentet: NU.toISOString(), antal: 3 });
      assert.match(svar.opsat ?? '', /2 ulæste/);
      assert.match(svar.opsat ?? '', new RegExp(PIN));
      assert.deepEqual((await laesKonfig(dir)).kilder[0]?.valg, { tjeneste: 'proton-bridge', adresse: 'mig@proton.me', port: String(s.port), fingeraftryk: PIN });
      assert.deepEqual(await laesKildeHemmelighed(dir, MAIL_IMAP_ID), { adgangskode: KODE });

      const l = await r.laes(MAIL_IMAP_ID);
      assert.equal(l.slags, 'mail');
      assert.deepEqual(l.slags === 'mail' ? l.data.map((m) => m.emne) : [], ['Faktura', 'Middag fredag?', 'Kvittering']);
      const [o] = await r.oversigt();
      assert.equal(o?.helbred?.status, 'ok');
      assert.match(o?.kort.tekst ?? '', /2 ulæste i indbakken/);
      assert.match(o?.kort.tekst ?? '', /1 .*flag/);
      assert.match(o?.kort.tekst ?? '', new RegExp(PIN));
      assert.ok(s.kommandoer.every((k) => !['SELECT', 'STORE', 'UID STORE', 'APPEND', 'EXPUNGE', 'COPY', 'MOVE'].includes(k)));

      // The password is in no text, log line or config file.
      const alt = [JSON.stringify(svar), JSON.stringify(await r.oversigt()), JSON.stringify(await store.readLog(KILDER_LOG)), await readFile(path.join(dir, 'kilder.json'), 'utf8')].join('\n');
      assert.ok(!alt.includes(KODE));
    });
  });
});

test('forbind: a typed fingerprint must match the certificate Bridge presents', async () => {
  await medServer(async (s) => {
    await medData(async (dir, store) => {
      const r = lavRegister({ dataDir: dir, store, nu: () => NU });
      r.registrer(mailImapKilde(TID));
      const anden = new X509Certificate(testCertifikat('anden').cert).fingerprint256;
      const err = await r.forbind(MAIL_IMAP_ID, { felter: { tjeneste: 'proton-bridge', adresse: 'mig@proton.me', port: String(s.port), adgangskode: KODE, fingeraftryk: anden } }, EJER).then(() => null, (e: unknown) => e);
      assert.equal((err as Error).message, FEJLTEKST.pin);
      assert.equal(s.logins, 0);
      assert.deepEqual(await laesKonfig(dir), { kilder: [] });
    });
  });
});

test('helbred: ok with the age of the last read; a refused login is log-ind-igen and is not retried', async () => {
  await medServer(async (s) => {
    const k = mailImapKilde(TID);
    await k.read(ctxFor(valg(s.port), KODE));
    const h = await k.helbred(ctxFor(valg(s.port), KODE, new Date(NU.getTime() + 3 * 60_000)));
    assert.deepEqual(h, { status: 'ok', tekst: 'Sidst læst for 3 minutter siden.' });

    const forkert = mailImapKilde(TID);
    await assert.rejects(forkert.read(ctxFor(valg(s.port), 'gammel-kode')), (e: unknown) => e instanceof KildeFejl && e.message === FEJLTEKST.adgangskode);
    const foer = s.kommandoer.filter((c) => c === 'LOGIN').length;
    assert.deepEqual(await forkert.helbred(ctxFor(valg(s.port), 'gammel-kode')), { status: 'log-ind-igen', tekst: FEJLTEKST.adgangskode });
    assert.equal(s.kommandoer.filter((c) => c === 'LOGIN').length, foer, 'no new login attempt');
    assert.equal((await forkert.kort(ctxFor(valg(s.port), 'gammel-kode'))).handling, 'Forbind igen');
  });
});

test('helbred: with no read yet it checks the login; Bridge not running is nede', async () => {
  await medServer(async (s) => {
    assert.equal((await mailImapKilde(TID).helbred(ctxFor(valg(s.port), KODE))).status, 'ok');
  });
  const port = await lukketPort();
  assert.deepEqual(await mailImapKilde(TID).helbred(ctxFor(valg(port), KODE)), { status: 'nede', tekst: FEJLTEKST.bridge });
  assert.equal((await mailImapKilde(TID).helbred(ctxFor(valg(port), null))).status, 'log-ind-igen');
});

test('medMailImap: the IMAP connector is offered after the host\'s own sources, so kira-mail stays the first mail source', () => {
  const kira = kiraMail({ himalaya: '/bin/himalaya', run: async () => ({ code: 0, stdout: '[]', stderr: '' }), parse: () => [] });
  assert.deepEqual(medMailImap([kira]).map((k) => k.id), ['kira-mail', MAIL_IMAP_ID]);
  assert.deepEqual(medMailImap([]).map((k) => k.id), [MAIL_IMAP_ID]);
});

// ---------- KC-0214: the verbs through the registry ----------

const MED_MAPPER = [
  { navn: 'INBOX', beskeder: INDBAKKE.map((b) => ({ ...b, messageId: `<m${b.uid}@x.example>` })) },
  { navn: 'Arkiv', specialUse: '\\Archive', beskeder: [] },
  { navn: 'Drafts', specialUse: '\\Drafts', beskeder: [] },
  { navn: 'Trash', specialUse: '\\Trash', beskeder: [] },
];

async function medForbundet(fn: (r: ReturnType<typeof lavRegister>, s: FalskImap, revision: { linjer: Record<string, unknown>[] }) => Promise<void>): Promise<void> {
  const s = await startFalskImap({ brugere: { 'mig@proton.me': KODE }, tls: 'starttls', postkasser: MED_MAPPER });
  try {
    await medData(async (dir, store) => {
      const linjer: Record<string, unknown>[] = [];
      const r = lavRegister({ dataDir: dir, store, nu: () => NU, revision: { skriv: async (l: unknown) => { linjer.push(l as Record<string, unknown>); } } as never });
      r.registrer(mailImapKilde(TID));
      await r.forbind(MAIL_IMAP_ID, { felter: { tjeneste: 'proton-bridge', adresse: 'mig@proton.me', port: String(s.port), adgangskode: KODE } }, EJER);
      await fn(r, s, { linjer });
    });
  } finally { await s.luk(); }
}

test('handl flyt: moves the mail to the account\'s archive, answers how to undo it (the new UID), one audit line', async () => {
  await medForbundet(async (r, s, rev) => {
    const svar = await r.handl(MAIL_IMAP_ID, 'flyt', { id: '2', til: 'Archive' }, { person: EJER, kanal: 'knap' });
    assert.deepEqual(svar, { ok: true, tekst: 'Mailen er flyttet til Arkiv.', fortryd: { navn: 'flyt', args: { id: '1', fra: 'Arkiv', til: 'INBOX' } } });
    assert.deepEqual(s.postkasser.find((p) => p.navn === 'INBOX')?.beskeder.map((b) => b.uid), [1, 3]);
    assert.equal(rev.linjer.length, 1);
    assert.equal(rev.linjer[0]?.['verb'], 'sorter');
    assert.equal(rev.linjer[0]?.['udfald'], 'tillad');
    // Fortryd: the answer's own undo, through the registry again.
    const tilbage = await r.handl(MAIL_IMAP_ID, 'flyt', svar.fortryd?.args, { person: EJER, kanal: 'knap' });
    assert.equal(tilbage.ok, true);
    assert.deepEqual(s.postkasser.find((p) => p.navn === 'INBOX')?.beskeder.map((b) => b.uid), [1, 3, 4]);
  });
});

test('handl kladde: the reply lands in Drafts with \\Draft; the answer says it was not sent', async () => {
  await medForbundet(async (r, s) => {
    const svar = await r.handl(MAIL_IMAP_ID, 'kladde', { id: '2', tekst: 'Ja tak, vi kommer.' }, { person: EJER, kanal: 'knap' });
    assert.deepEqual(svar, { ok: true, tekst: 'Kladden ligger i Drafts. Clawco har ikke sendt den.' });
    assert.equal(s.tilfoejet.length, 1);
    assert.match(s.tilfoejet[0]?.tekst ?? '', /^To: soester@x\.example$/m);
  });
});

test('handl: invalid arguments are refused (400) before any login; Trash is refused; the password is never in an answer', async () => {
  await medForbundet(async (r, s) => {
    const logins = s.logins;
    for (const [navn, args] of [
      ['flyt', { id: 'abc', til: 'Archive' }], ['flyt', { id: '2' }], ['flyt', { id: '2', til: 'Archive', slet: true }], ['flyt', { id: '2', til: 'A\r\nB' }],
      ['kladde', { id: '2' }], ['kladde', { id: '2', tekst: '' }], ['kladde', { id: '2', tekst: 'x'.repeat(20_001) }], ['kladde', 'tekst'],
    ] as const) {
      const err = await r.handl(MAIL_IMAP_ID, navn, args, { person: EJER, kanal: 'knap' }).then(() => null, (e: unknown) => e);
      assert.ok(err instanceof KildeFejl && err.status === 400, `${navn} ${JSON.stringify(args)}: ${String(err)}`);
    }
    assert.equal(s.logins, logins);
    const trash = await r.handl(MAIL_IMAP_ID, 'flyt', { id: '2', til: 'Trash' }, { person: EJER, kanal: 'knap' }).then(() => null, (e: unknown) => e);
    assert.ok(trash instanceof KildeFejl && trash.status === 400 && !trash.message.includes(KODE), String(trash));
    const send = await r.handl(MAIL_IMAP_ID, 'send', { id: '2' }, { person: EJER, kanal: 'knap' }).then(() => null, (e: unknown) => e);
    assert.ok(send instanceof KildeFejl && send.status === 400);
  });
});

test('kort: says what the connector does and never does (moves and drafts on your tap; never sends or deletes)', async () => {
  const kort = await mailImapKilde().kort(ctxFor({}, null));
  assert.doesNotMatch(kort.tekst, /kan ikke flytte/);
  assert.match(kort.tekst, /sender og sletter aldrig/);
});

// KC-0274 (C2): the host name of a hosted "anden" server is resolved and judged before any connection is made.
test('hosted: a server NAME that resolves to a local or private address is refused before any connection, with the fixed sentence', async () => {
  const valg = { tjeneste: 'anden', adresse: 'mig@b.example', server: 'mail.indre.example' };
  const c = ctxFor(valg, 'x');
  for (const svar of [[{ address: '10.0.0.5', family: 4 as const }], [{ address: '93.184.216.34', family: 4 as const }, { address: '127.0.0.1', family: 4 as const }], [{ address: '169.254.169.254', family: 4 as const }], []]) {
    const k = mailImapKilde({ hostet: true, opslag: async () => svar, ...TID });
    await assert.rejects(k.read(c), (e: unknown) => e instanceof KildeFejl && e.status === 400 && e.message === imapTekst().serverIkkeHostet);
    assert.equal((await k.helbred(c)).status, 'nede');
  }
  // The literal form is refused by forbindelse() itself, also through the connector.
  await assert.rejects(mailImapKilde({ hostet: true, ...TID }).read(ctxFor({ ...valg, server: '127.0.0.1' }, 'x')), (e: unknown) => e instanceof KildeFejl && e.status === 400 && e.message === imapTekst().serverIkkeHostet);
});
