// KC-0135: no token, ID token, code or client secret ever leaves the secret
// stores — not in a card, the overview (/api/kilder), the Kilder panel HTML,
// kilder.json, the store's log, an error message or the console, across
// connect, read, a mid-session refresh, a refused login at the mail server, a
// refused grant and disconnect. The account's address is kept in the secret
// file only (the connected card names it; nothing else does).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { mailGmail, MAIL_GMAIL_ID } from '../../../src/kilder/mail-gmail/kilde.ts';
import { falskGoogle } from '../../../src/kilder/google/falsk-google.ts';
import { SCOPE_MAIL } from '../../../src/kilder/google/oauth.ts';
import { laesKonto } from '../../../src/kilder/mail-imap/imap.ts';
import { KILDER_LOG, lavRegister } from '../../../src/kilder/register.ts';
import { laesKildeHemmelighed } from '../../../src/kilder/hemmeligheder.ts';
import { renderKilder } from '../../../src/shell/kilder.ts';
import type { Person } from '../../../src/identitet/husstand.ts';
import { startFalskImap, testCertifikat } from '../../helpers/falsk-imap.ts';
import { GMAIL_KASSER } from '../../helpers/gmail-kasser.ts';
import { medData, NU } from '../hjaelp.ts';

const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const KLIENT_HEMMELIGHED = 'GOCSPX-klient-hemmelighed-gmail';
const ADRESSE = 'privat.person@gmail.example';
const ADR = 'https://kontrol.example.ts.net';
const PIN = new X509Certificate(testCertifikat('bridge').cert).fingerprint256;

test('tokens, the ID token, the code and the client secret never reach a card, the overview, HTML, kilder.json, the log, an error or the console', async () => {
  await medData(async (dir, store) => {
    const konsol: string[] = [];
    const gemt = { log: console.log, error: console.error, warn: console.warn, info: console.info };
    for (const n of ['log', 'error', 'warn', 'info'] as const) console[n] = (...a: unknown[]) => { konsol.push(a.map(String).join(' ')); };
    const fejl: string[] = [];
    let nu = NU;
    let afvist = false;
    const g = falskGoogle({ klient: { id: 'klient-1.apps.googleusercontent.com', hemmelighed: KLIENT_HEMMELIGHED }, kalendere: () => [], konto: ADRESSE });
    const imap = await startFalskImap({ brugere: {}, postkasser: GMAIL_KASSER, tls: 'tls', tokens: (b, t) => !afvist && b === ADRESSE && g.erAdgang(t, SCOPE_MAIL) });
    try {
      const env = { KC_GOOGLE_CLIENT_ID: 'klient-1.apps.googleusercontent.com', KC_GOOGLE_CLIENT_SECRET: KLIENT_HEMMELIGHED };
      const r = lavRegister({ dataDir: dir, store, nu: () => nu, adresse: ADR });
      r.registrer(mailGmail({
        env, adresse: ADR, hent: g.hent, nu: () => nu,
        laes: (f, a) => laesKonto({ ...f, vaert: '127.0.0.1', port: imap.port, sikkerhed: 'tls' }, a, { pin: PIN, profil: 'gmail', tidsgraenseMs: 1500 }),
      }));
      const svar = await r.forbind(MAIL_GMAIL_ID, {}, EJER);
      assert.ok('omdiriger' in svar);
      const tilbage = new URL(g.samtykke(svar.omdiriger));
      const f = await r.tilbage(MAIL_GMAIL_ID, tilbage.searchParams.get('state')!, tilbage.searchParams.get('code')!, EJER);
      await r.laes(MAIL_GMAIL_ID);
      g.udloebAdgang(); // a mid-session refresh
      await r.laes(MAIL_GMAIL_ID);
      const oversigt = await r.oversigt();
      const html = String(renderKilder(oversigt, { nu, maaFrakoble: true }));
      afvist = true; // the mail server now refuses every login
      g.udloebAdgang();
      await r.laes(MAIL_GMAIL_ID).catch((e: Error) => { fejl.push(e.message); });
      const efter = await r.oversigt();
      const efterHtml = String(renderKilder(efter, { nu, maaFrakoble: true }));
      g.tilbagekaldAlt(); // and Google refuses the grant too
      nu = new Date(NU.getTime() + 4 * 3600_000);
      await r.laes(MAIL_GMAIL_ID).catch((e: Error) => { fejl.push(e.message); });
      const sidst = await r.oversigt();

      const lager = (await laesKildeHemmelighed(dir, MAIL_GMAIL_ID)) ?? {};
      const refresh = lager['refresh_token'] ?? '';
      assert.ok(refresh.length > 10, 'the refresh token is in the secret file');
      assert.equal(lager['adresse'], ADRESSE, 'and so is the address');
      assert.ok(g.udstedteIdTokens().length >= 1);
      const vaerdier = [refresh, ...g.udstedteAdgange(), ...g.udstedteIdTokens(), KLIENT_HEMMELIGHED, tilbage.searchParams.get('code')!];
      await r.frakobl(MAIL_GMAIL_ID, EJER);

      const kilderJson = await readFile(path.join(dir, 'kilder.json'), 'utf8');
      const log = JSON.stringify(await store.readLog(KILDER_LOG, 100));
      const overflader = {
        f: JSON.stringify(f), oversigt: JSON.stringify(oversigt), html, efter: JSON.stringify(efter), efterHtml, sidst: JSON.stringify(sidst),
        kilderJson, log, fejl: fejl.join('\n'), konsol: konsol.join('\n'), filer: (await readdir(dir)).join(' '),
      };
      for (const [hvor, tekst] of Object.entries(overflader)) {
        for (const v of vaerdier) assert.ok(!tekst.includes(v), `${hvor} contains a secret value (${v.length} chars)`);
      }
      // The address is not in the log, kilder.json, an error or the console either (the connected card names it, nothing else).
      for (const hvor of ['kilderJson', 'log', 'fejl', 'konsol', 'filer'] as const) assert.ok(!overflader[hvor].includes(ADRESSE), `${hvor} contains the address`);
      assert.match(efterHtml, /data-kilde-tilstand="log-ind-igen"/);
      assert.equal(fejl.length, 2);
    } finally { Object.assign(console, gemt); await imap.luk(); }
  });
});
