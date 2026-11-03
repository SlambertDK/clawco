// KC-0135: the Gmail connector over the in-process fake Google and the fake
// IMAP server. "Log ind med Google" through the registry (PKCE, the address
// from the ID token, incremental consent on top of a calendar grant), the
// read over XOAUTH2 (EXAMINE only), a token that dies mid-session, a refused
// grant (invalid_grant) and a refused login both reading as log-ind-igen
// (KC-0139), card states, and the invariant that Gmail can never write.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { mailGmail, MAIL_GMAIL_ID } from '../../../src/kilder/mail-gmail/kilde.ts';
import { googleKalender, GOOGLE_KALENDER_ID } from '../../../src/kilder/google-kalender/kilde.ts';
import { falskGoogle } from '../../../src/kilder/google/falsk-google.ts';
import { SCOPE_KALENDER, SCOPE_MAIL } from '../../../src/kilder/google/oauth.ts';
import { laesKonto, TILLADTE_KOMMANDOER } from '../../../src/kilder/mail-imap/imap.ts';
import type { Forbindelse } from '../../../src/kilder/mail-imap/presets.ts';
import { lavRegister } from '../../../src/kilder/register.ts';
import { laesKildeHemmelighed } from '../../../src/kilder/hemmeligheder.ts';
import { KildeFejl, type KildeKontekst } from '../../../src/kilder/types.ts';
import type { Person } from '../../../src/identitet/husstand.ts';
import { startFalskImap, testCertifikat } from '../../helpers/falsk-imap.ts';
import { medData, NU } from '../hjaelp.ts';
import { nulstilRegistrerede, redigeres } from '../../../src/graenser/redaktion.ts';
import { GMAIL_KASSER } from '../../helpers/gmail-kasser.ts';

const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const KLIENT = { id: 'klient-1.apps.googleusercontent.com', hemmelighed: 'GOCSPX-klient' };
const ENV = { KC_GOOGLE_CLIENT_ID: KLIENT.id, KC_GOOGLE_CLIENT_SECRET: KLIENT.hemmelighed };
const ADR = 'https://kontrol.example.ts.net';
const TILBAGE = `${ADR}/api/kilder/mail-gmail/tilbage`;
const ADRESSE = 'ella@gmail.example';
const PIN = new X509Certificate(testCertifikat('bridge').cert).fingerprint256;
const MUTERENDE = ['SELECT', 'STORE', 'UID STORE', 'APPEND', 'EXPUNGE', 'COPY', 'UID COPY', 'MOVE', 'UID MOVE', 'CLOSE', 'CREATE', 'DELETE', 'RENAME'];
const ctx = (hemmelighed: Record<string, string> | null, o: Partial<KildeKontekst> = {}): KildeKontekst => ({ nu: NU, zone: 'privat', valg: {}, hemmelighed: async () => hemmelighed, ...o });

type Verden = {
  r: ReturnType<typeof lavRegister>; g: ReturnType<typeof falskGoogle>; imap: Awaited<ReturnType<typeof startFalskImap>>;
  forbindelser: Forbindelse[]; afvisAlt(): void; dir: string; nu(): Date; sigNu(d: Date): void;
};

/** A registry with Gmail (and optionally the calendar) over a fake Google and a fake IMAP that accepts only tokens that Google issued. */
async function medGmail(fn: (v: Verden) => Promise<void>, o: { kalender?: boolean } = {}): Promise<void> {
  await medData(async (dir, store) => {
    let nu = NU;
    let afvist = false;
    const g = falskGoogle({ klient: KLIENT, kalendere: () => [], konto: ADRESSE });
    const imap = await startFalskImap({ brugere: {}, postkasser: GMAIL_KASSER, tls: 'tls', tokens: (b, t) => !afvist && b === ADRESSE && g.erAdgang(t, SCOPE_MAIL) });
    const forbindelser: Forbindelse[] = [];
    try {
      const r = lavRegister({ dataDir: dir, store, nu: () => nu, adresse: ADR });
      if (o.kalender) r.registrer(googleKalender({ env: { ...ENV }, adresse: ADR, hent: g.hent, nu: () => nu }));
      r.registrer(mailGmail({
        env: { ...ENV }, adresse: ADR, hent: g.hent, nu: () => nu,
        laes: (f, a) => { forbindelser.push(f); return laesKonto({ ...f, vaert: '127.0.0.1', port: imap.port, sikkerhed: 'tls' }, a, { pin: PIN, profil: 'gmail', tidsgraenseMs: 1500 }); },
      }));
      await fn({ r, g, imap, forbindelser, afvisAlt: () => { afvist = true; }, dir, nu: () => nu, sigNu: (d) => { nu = d; } });
    } finally { await imap.luk(); }
  });
}
const post = (g: ReturnType<typeof falskGoogle>, url: string): URL => new URL(g.samtykke(url));
/** The whole round trip: forbind answers Google's consent URL (`url`), the person consents, Google redirects back with a code (tilbage). */
async function logInd(v: Verden, id = MAIL_GMAIL_ID): Promise<{ url: URL; f: Awaited<ReturnType<Verden['r']['tilbage']>> }> {
  const svar = await v.r.forbind(id, {}, EJER);
  assert.ok('omdiriger' in svar);
  const tilbage = post(v.g, svar.omdiriger);
  return { url: new URL(svar.omdiriger), f: await v.r.tilbage(id, tilbage.searchParams.get('state')!, tilbage.searchParams.get('code')!, EJER) };
}
const helbred = async (v: Verden) => (await v.r.oversigt()).find((x) => x.id === MAIL_GMAIL_ID)!.helbred;

test('the connector can never write: no verbs, no act, oauth, mail, privat', () => {
  const k = mailGmail({ env: {} });
  assert.deepEqual([k.id, k.slags, k.auth, k.zone, k.tillid], ['mail-gmail', 'mail', 'oauth', 'privat', 'uklar']);
  assert.equal(k.verber, undefined);
  assert.equal(k.act, undefined);
});

test('card without client keys: setup steps with this connector\'s return address and the mail scope to copy, fields to the env file', async () => {
  const kort = await mailGmail({ env: {}, adresse: ADR }).kort(ctx(null));
  assert.ok(kort.trin!.some((t) => t.kopier === TILBAGE), 'the return address of Gmail, not the calendar');
  assert.ok(kort.trin!.some((t) => t.kopier === SCOPE_MAIL), 'the IMAP scope is offered to copy');
  assert.ok(kort.trin!.some((t) => /Publish app/.test(t.tekst) && /syv dage/.test(t.tekst)));
  assert.ok(!kort.trin!.some((t) => /Calendar API/.test(t.tekst)), 'no calendar step on the mail card');
  assert.deepEqual(kort.felter.map((f) => [f.navn, f.type, f.miljoe]), [['klient_id', 'tekst', 'KC_GOOGLE_CLIENT_ID'], ['klient_hemmelighed', 'hemmelig', 'KC_GOOGLE_CLIENT_SECRET']]);
  assert.equal(kort.handling, 'Gem og log ind med Google');
});

test('card with client keys: "Log ind med Google", and it says plainly that Google calls this full access while Clawco reads only envelopes', async () => {
  const kort = await mailGmail({ env: { ...ENV }, adresse: ADR }).kort(ctx(null));
  assert.equal(kort.handling, 'Log ind med Google');
  assert.deepEqual(kort.felter, []);
  assert.equal(kort.trin, undefined);
  assert.match(kort.tekst, /fuld adgang/);
  assert.match(kort.tekst, /afsender, emne og tid/);
  assert.match(kort.tekst, /aldrig selve mailen/);
  assert.match(kort.tekst, /hverken sende, flytte eller slette/);
  assert.match(kort.tekst, /app-adgangskode/, 'the app-password preset stays documented as the alternative');
  assert.doesNotMatch(kort.tekst, /[<>]/);
});

test('card with the calendar already connected: "Google er allerede koblet: kun mail mangler", one step to add this return address to the same Google app', async () => {
  const kort = await mailGmail({ env: { ...ENV }, adresse: ADR }).kort(ctx(null, { erForbundet: async (id) => id === GOOGLE_KALENDER_ID }));
  assert.match(kort.tekst, /^Google er allerede koblet: kun mail mangler\./);
  assert.match(kort.tekst, /fuld adgang/);
  assert.ok(kort.trin!.some((t) => t.kopier === TILBAGE));
  assert.ok(kort.trin!.some((t) => t.kopier === SCOPE_MAIL));
  assert.equal(kort.handling, 'Giv adgang til mail');
});

test('connected card shows the account, with markup stripped', async () => {
  const k = mailGmail({ env: { ...ENV }, adresse: ADR });
  const kort = await k.kort(ctx({ refresh_token: '1//r', adresse: 'a<b>@gmail.example' }));
  assert.match(kort.tekst, /Forbundet som ab@gmail\.example/);
  assert.equal(kort.handling, 'Skift Google-konto');
});

test('fail closed: no client keys or no known address → start refuses in Danish; an unknown state is 400', async () => {
  await assert.rejects(mailGmail({ env: {}, adresse: ADR }).oauth!.start('s', TILBAGE, ctx(null)), (e) => e instanceof KildeFejl && e.status === 409 && /Google-appen/.test(e.message));
  await assert.rejects(mailGmail({ env: { ...ENV } }).oauth!.start('s', '/api/kilder/mail-gmail/tilbage', ctx(null)), (e) => e instanceof KildeFejl && e.status === 409 && /adresse/.test(e.message));
  await assert.rejects(mailGmail({ env: { ...ENV }, adresse: ADR }).oauth!.tilbage('kode', ctx(null), 'ukendt'), (e) => e instanceof KildeFejl && e.status === 400);
});

test('connect through the registry: the consent asks for mail and the address only, the address comes from Google, the first read has the envelopes', async () => {
  await medGmail(async (v) => {
    const { url, f } = await logInd(v);
    assert.equal(url.searchParams.get('scope'), 'https://mail.google.com/ openid email');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.has('include_granted_scopes'), false, 'no calendar grant to merge');
    assert.equal(url.searchParams.get('redirect_uri'), TILBAGE);
    assert.equal(f.foersteLaesning?.antal, 2);
    const l = await v.r.laes(MAIL_GMAIL_ID);
    assert.equal(l.slags, 'mail');
    assert.equal(l.uklar, true);
    if (l.slags === 'mail') assert.deepEqual(l.data.map((k) => k.emne), ['Svar inden fredag', 'Tilbud på eltavle']);
    assert.deepEqual(Object.keys((await laesKildeHemmelighed(v.dir, MAIL_GMAIL_ID)) ?? {}).sort(), ['adresse', 'refresh_token']);
    assert.equal((await laesKildeHemmelighed(v.dir, MAIL_GMAIL_ID))?.['adresse'], ADRESSE);
    // The connection is Gmail's own IMAP host, the logged-in address, TLS.
    assert.deepEqual(v.forbindelser.map((x) => [x.vaert, x.port, x.sikkerhed, x.bruger]), v.forbindelser.map(() => ['imap.gmail.com', 993, 'tls', ADRESSE]));
  });
});

test('incremental consent: with the calendar connected the mail login asks for mail only and merges the calendar grant (one Google account link)', async () => {
  await medGmail(async (v) => {
    await logInd(v, GOOGLE_KALENDER_ID);
    const { url } = await logInd(v);
    assert.equal(url.searchParams.get('scope'), 'https://mail.google.com/ openid email', 'only the extra scope is asked for');
    assert.equal(url.searchParams.get('include_granted_scopes'), 'true');
    assert.ok(v.g.givetScopes().includes(SCOPE_KALENDER) && v.g.givetScopes().includes(SCOPE_MAIL));
    assert.equal((await helbred(v))?.status, 'ok');
    assert.equal((await v.r.oversigt()).find((x) => x.id === GOOGLE_KALENDER_ID)?.helbred?.status, 'ok');
  }, { kalender: true });
});

test('a grant without the mail scope (unticked on Google\'s screen) is refused and nothing is stored', async () => {
  await medData(async (dir, store) => {
    const g = falskGoogle({ klient: KLIENT, kalendere: () => [], konto: ADRESSE });
    const afkortet = (async (input: string | URL | Request, init?: RequestInit) => {
      const svar = await g.hent(input, init);
      if (!String(input).endsWith('/token') || !svar.ok) return svar;
      const j = (await svar.json()) as Record<string, unknown>;
      return new Response(JSON.stringify({ ...j, scope: 'openid https://www.googleapis.com/auth/userinfo.email' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const r = lavRegister({ dataDir: dir, store, nu: () => NU, adresse: ADR });
    r.registrer(mailGmail({ env: { ...ENV }, adresse: ADR, hent: afkortet }));
    const svar = await r.forbind(MAIL_GMAIL_ID, {}, EJER);
    assert.ok('omdiriger' in svar);
    const url = post(g, svar.omdiriger);
    await assert.rejects(r.tilbage(MAIL_GMAIL_ID, url.searchParams.get('state')!, url.searchParams.get('code')!, EJER), (e) => e instanceof KildeFejl && e.status === 403 && /mail/.test(e.message));
    assert.deepEqual(await r.forbundne('mail'), []);
    assert.equal(await laesKildeHemmelighed(dir, MAIL_GMAIL_ID), null);
  });
});

test('access token: reused while valid; Google drops it early → the IMAP login fails, one fresh token, one retry, the read succeeds', async () => {
  await medGmail(async (v) => {
    await logInd(v);
    const foer = v.g.tokenKald().length;
    await v.r.laes(MAIL_GMAIL_ID);
    assert.equal(v.g.tokenKald().length, foer, 'cached token reused');
    v.g.udloebAdgang();
    const l = await v.r.laes(MAIL_GMAIL_ID);
    assert.equal(l.slags, 'mail');
    assert.deepEqual(v.g.tokenKald().slice(foer), ['refresh_token'], 'exactly one refresh');
    assert.equal((await helbred(v))?.status, 'ok');
  });
});

test('access token: refreshed within 60 s of its expiry, before the IMAP login', async () => {
  await medGmail(async (v) => {
    await logInd(v);
    const foer = v.g.tokenKald().length;
    v.sigNu(new Date(NU.getTime() + (3600 - 50) * 1000));
    await v.r.laes(MAIL_GMAIL_ID);
    assert.deepEqual(v.g.tokenKald().slice(foer), ['refresh_token']);
  });
});

test('invalid_grant (revoked, or a Testing app\'s 7 days): log-ind-igen, and no further call to Google or the mail server until a new login', async () => {
  await medGmail(async (v) => {
    await logInd(v);
    v.g.tilbagekaldAlt();
    v.sigNu(new Date(NU.getTime() + 2 * 3600_000));
    await assert.rejects(v.r.laes(MAIL_GMAIL_ID), KildeFejl);
    const h = await helbred(v);
    assert.equal(h?.status, 'log-ind-igen');
    assert.match(h?.tekst ?? '', /Log ind med Google igen/);
    const tokens = v.g.tokenKald().length;
    const logins = v.imap.kommandoer.length;
    await assert.rejects(v.r.laes(MAIL_GMAIL_ID));
    assert.equal(v.g.tokenKald().length, tokens, 'invalid_grant is not retried against Google');
    assert.equal(v.imap.kommandoer.length, logins, 'and the mail server is not touched');
    // Logging in again repairs it.
    await logInd(v);
    assert.equal((await helbred(v))?.status, 'ok');
  });
});

test('the mail server refusing a fresh token is log-ind-igen too, not retried', async () => {
  await medGmail(async (v) => {
    await logInd(v);
    v.afvisAlt();
    v.g.udloebAdgang();
    await assert.rejects(v.r.laes(MAIL_GMAIL_ID), KildeFejl);
    const h = await helbred(v);
    assert.equal(h?.status, 'log-ind-igen');
    assert.match(h?.tekst ?? '', /Google/);
    const tokens = v.g.tokenKald().length;
    await assert.rejects(v.r.laes(MAIL_GMAIL_ID));
    assert.equal(v.g.tokenKald().length, tokens);
  });
});

test('a mail server that does not answer is nede (KC-0134\'s words), not log-ind-igen', async () => {
  const k = mailGmail({
    env: { ...ENV }, adresse: ADR,
    hent: falskGoogle({ klient: KLIENT, kalendere: () => [], kendteMailRefresh: ['1//m'] }).hent,
    laes: async () => { throw Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }); },
  });
  const h = await k.helbred(ctx({ refresh_token: '1//m', adresse: ADRESSE }));
  assert.equal(h.status, 'nede');
  assert.match(h.tekst ?? '', /Mailserveren svarer ikke/);
});

test('health: no client keys → nede; no stored login → log-ind-igen', async () => {
  assert.equal((await mailGmail({ env: {} }).helbred(ctx({ refresh_token: 'r', adresse: ADRESSE }))).status, 'nede');
  assert.equal((await mailGmail({ env: { ...ENV } }).helbred(ctx(null))).status, 'log-ind-igen');
});

test('read-only on the wire: EXAMINE, the allowlist, and none of the mutating commands, across connect, read and refresh', async () => {
  await medGmail(async (v) => {
    await logInd(v);
    v.g.udloebAdgang();
    await v.r.laes(MAIL_GMAIL_ID);
    assert.ok(v.imap.kommandoer.includes('EXAMINE'));
    assert.ok(!v.imap.kommandoer.includes('LOGIN'));
    for (const m of MUTERENDE) assert.ok(!v.imap.kommandoer.includes(m), `${m} was sent`);
    for (const c of v.imap.kommandoer) assert.ok(TILLADTE_KOMMANDOER.has(c), `${c} is not on the allowlist`);
    await assert.rejects(v.r.handl(MAIL_GMAIL_ID, 'flyt', { id: '12', til: 'Archive' }, { person: EJER, kanal: 'knap' }), (e) => e instanceof KildeFejl && e.status === 400);
  });
});

test('disconnect revokes the grant at Google and removes the stored login', async () => {
  await medGmail(async (v) => {
    await logInd(v);
    const refresh = (await laesKildeHemmelighed(v.dir, MAIL_GMAIL_ID))!['refresh_token']!;
    await v.r.frakobl(MAIL_GMAIL_ID, EJER);
    assert.deepEqual(v.g.tilbagekaldte(), [refresh]);
    assert.equal(await laesKildeHemmelighed(v.dir, MAIL_GMAIL_ID), null);
    await assert.rejects(v.r.laes(MAIL_GMAIL_ID), (e) => e instanceof KildeFejl && e.status === 409);
  });
});

// KC-0274 (C4): the access token Google issues is a secret like the refresh token: masked wherever text leaves the process.
test('the access token is registered for masking as soon as it is issued', async () => {
  nulstilRegistrerede();
  const g = falskGoogle({ klient: KLIENT, kalendere: () => [], kendteMailRefresh: ['1//m'] });
  const k = mailGmail({ env: { ...ENV }, adresse: ADR, hent: g.hent, laes: async () => { throw new Error('stop'); } });
  await k.helbred(ctx({ refresh_token: '1//m', adresse: ADRESSE })).catch(() => undefined);
  const [token] = g.udstedteAdgange();
  assert.ok(token && token.length >= 8, 'the fake issued an access token');
  assert.equal(redigeres(`Authorization: Bearer ${token}`).includes(token), false);
  nulstilRegistrerede();
});
