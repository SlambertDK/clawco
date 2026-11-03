import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nyDb, ur, alleRaekker } from './hjaelp.ts';
import { opretSession, hentSession, tilbagekald, sessioner, afslutSession, erFrisk, tjekOrigin, tjekCsrf, enhedNavn, SESSION_DAGE, SESSION_MAKS_DAGE, FRISK_MS } from '../../src/konto/session.ts';
import { hashToken, nytToken } from '../../src/konto/token.ts';
import type { Database } from '../../src/db/pool.ts';

const DAG = 24 * 3_600_000;

async function konto(db: Database, email = 'a@example.test'): Promise<number> {
  const [r] = await db.query<{ id: number }>('INSERT INTO konto (email, oprettet) VALUES ($1, now()) RETURNING id', [email]);
  return Number(r!.id);
}

test('tokens are 32 random bytes; only their SHA-256 is stored (a database dump logs nobody in)', async () => {
  const db = await nyDb();
  const u = ur();
  const t = nytToken();
  assert.equal(Buffer.from(t, 'base64url').length, 32);
  assert.notEqual(nytToken(), t);
  const { token, session } = await opretSession(db, { kontoId: await konto(db), metode: 'link', enhed: 'Firefox', nu: u.nu() });
  const alt = await alleRaekker(db);
  assert.ok(!alt.includes(token), 'det rå session-id ligger i databasen');
  assert.ok(alt.includes(hashToken(token)));
  assert.equal((await hentSession(db, token, u.nu()))?.id, session.id);
  assert.equal(await hentSession(db, hashToken(token), u.nu()), null, 'hashen selv må ikke virke som session');
  assert.equal(await hentSession(db, 'noget-andet', u.nu()), null);
});

test('a session expires after 30 days without use, and each use slides the expiry', async () => {
  const db = await nyDb();
  const u = ur();
  const { token } = await opretSession(db, { kontoId: await konto(db), metode: 'link', enhed: '', nu: u.nu() });
  u.frem(SESSION_DAGE * DAG - 60_000);
  assert.ok(await hentSession(db, token, u.nu()), 'lige før udløb virker den');
  u.frem(SESSION_DAGE * DAG - 60_000);
  assert.ok(await hentSession(db, token, u.nu()), 'brugen skubbede udløbet');
  u.frem(SESSION_DAGE * DAG + 1);
  assert.equal(await hentSession(db, token, u.nu()), null);
});

// KC-0272 (D6): sliding alone let a session live for ever while it was used; a stolen one never ran out.
test('KC-0272: a session lives at most 90 days from login, however often it is used', async () => {
  const db = await nyDb();
  const u = ur();
  assert.equal(SESSION_MAKS_DAGE, 90);
  const start = u.nu().getTime();
  const dag = (d: number, ms = 0) => new Date(start + d * DAG + ms);
  const { token } = await opretSession(db, { kontoId: await konto(db), metode: 'link', enhed: '', nu: dag(0) });
  for (const d of [29, 58, 87]) assert.ok(await hentSession(db, token, dag(d)), `day ${d}`);
  const s = await hentSession(db, token, dag(89));
  assert.ok(s, 'day 89');
  assert.ok(s.udloeber.getTime() <= dag(90).getTime(), 'the slide stops at login + 90 days');
  assert.equal(await hentSession(db, token, dag(90, 1)), null, 'day 90 and a moment');
});

test('KC-0272: a session row from before the cap is refused once it is 90 days old, whatever its expiry says', async () => {
  const db = await nyDb();
  const u = ur();
  const { token, session } = await opretSession(db, { kontoId: await konto(db), metode: 'link', enhed: '', nu: u.nu() });
  await db.query('UPDATE session SET udloeber = $2 WHERE id = $1', [session.id, new Date(u.nu().getTime() + 400 * DAG).toISOString()]);
  assert.ok(await hentSession(db, token, new Date(u.nu().getTime() + 89 * DAG)));
  assert.equal(await hentSession(db, token, new Date(u.nu().getTime() + 90 * DAG + 1)), null);
});

test('a session can be revoked one by one, only by its own account', async () => {
  const db = await nyDb();
  const u = ur();
  const a = await konto(db, 'a@example.test');
  const b = await konto(db, 'b@example.test');
  const s1 = await opretSession(db, { kontoId: a, metode: 'link', enhed: 'Mac', nu: u.nu() });
  const s2 = await opretSession(db, { kontoId: a, metode: 'passkey', enhed: 'iPhone', nu: u.nu() });
  assert.deepEqual((await sessioner(db, a, u.nu())).map((s) => s.enhed).sort(), ['Mac', 'iPhone']);
  assert.equal(await tilbagekald(db, b, s1.session.id), false, 'en anden konto kan ikke afslutte den');
  assert.ok(await hentSession(db, s1.token, u.nu()));
  assert.equal(await tilbagekald(db, a, s1.session.id), true);
  assert.equal(await hentSession(db, s1.token, u.nu()), null);
  assert.ok(await hentSession(db, s2.token, u.nu()), 'den anden session lever');
  await afslutSession(db, s2.token);
  assert.equal(await hentSession(db, s2.token, u.nu()), null);
});

test('fresh authentication lasts 5 minutes from login', async () => {
  const db = await nyDb();
  const u = ur();
  const { session } = await opretSession(db, { kontoId: await konto(db), metode: 'passkey', enhed: '', nu: u.nu() });
  assert.equal(erFrisk(session, u.nu()), true);
  u.frem(FRISK_MS - 1);
  assert.equal(erFrisk(session, u.nu()), true);
  u.frem(2);
  assert.equal(erFrisk(session, u.nu()), false);
});

test('Origin must equal the public origin; a missing Origin is refused', () => {
  assert.equal(tjekOrigin('https://konto.example.test', 'https://konto.example.test/'), true);
  assert.equal(tjekOrigin(undefined, 'https://konto.example.test'), false);
  assert.equal(tjekOrigin('null', 'https://konto.example.test'), false);
  assert.equal(tjekOrigin('https://ond.example.test', 'https://konto.example.test'), false);
  assert.equal(tjekOrigin('http://konto.example.test', 'https://konto.example.test'), false);
});

test('the CSRF token is per session; a missing or other session\'s token is refused', async () => {
  const db = await nyDb();
  const u = ur();
  const k = await konto(db);
  const a = await opretSession(db, { kontoId: k, metode: 'link', enhed: '', nu: u.nu() });
  const b = await opretSession(db, { kontoId: k, metode: 'link', enhed: '', nu: u.nu() });
  assert.notEqual(a.session.csrf, b.session.csrf);
  assert.equal(tjekCsrf(a.session, a.session.csrf), true);
  assert.equal(tjekCsrf(a.session, b.session.csrf), false);
  assert.equal(tjekCsrf(a.session, undefined), false);
  assert.equal(tjekCsrf(a.session, ''), false);
});

test('the device name is a short browser-and-system label from the User-Agent', () => {
  assert.equal(enhedNavn('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'), 'Chrome på Mac');
  assert.equal(enhedNavn('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'), 'Safari på iPhone');
  assert.equal(enhedNavn('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0'), 'Firefox på Windows');
  assert.equal(enhedNavn('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0'), 'Edge på Windows');
  assert.equal(enhedNavn(undefined), 'Ukendt enhed');
  assert.equal(enhedNavn('curl/8.0'), 'Ukendt enhed');
});
