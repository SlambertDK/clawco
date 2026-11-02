import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nyDb, ur, alleRaekker, antal } from './hjaelp.ts';
import { anmodLink, bekraeftLink, findLink, LINK_MS, type LinkDeps } from '../../src/konto/maillink.ts';
import { kontoForEmail, normaliserEmail, goerPersonale } from '../../src/konto/konto.ts';
import { KODER_PR_EMAIL, KODER_PR_IP, FEJL_PR_IP } from '../../src/konto/graenser.ts';
import { falskPost, type FalskPost } from '../../src/delt/post.ts';
import type { Database } from '../../src/db/pool.ts';

const PUBLIC = 'https://konto.example.test';
const BROWSER = 'binding-fra-browseren-der-bad-om-linket';

async function opsaet(): Promise<{ db: Database; post: FalskPost; d: LinkDeps; u: ReturnType<typeof ur> }> {
  const db = await nyDb();
  const post = falskPost();
  return { db, post, d: { db, post, publicUrl: PUBLIC }, u: ur() };
}

/** The token from the last mail's link (what the person clicks). */
function sidsteToken(post: FalskPost): string {
  const link = post.udbakke.at(-1)?.data['link'] ?? '';
  const url = new URL(link);
  assert.equal(url.origin, PUBLIC);
  assert.equal(url.pathname, '/log-ind/link');
  return url.searchParams.get('t') ?? '';
}

test('email addresses are trimmed and lower-cased; junk is refused', () => {
  assert.equal(normaliserEmail('  Henrik@Example.TEST '), 'henrik@example.test');
  assert.equal(normaliserEmail('ingen-snabel-a'), null);
  assert.equal(normaliserEmail('a b@example.test'), null);
  assert.equal(normaliserEmail('a@b'), null);
  assert.equal(normaliserEmail(`${'x'.repeat(250)}@example.test`), null);
  assert.equal(normaliserEmail(42), null);
});

test('a link logs in once; the second use is refused', async () => {
  const { db, post, d, u } = await opsaet();
  await anmodLink(d, { email: 'a@example.test', binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
  const t = sidsteToken(post);
  const r = await bekraeftLink(db, { token: t, binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
  assert.ok(r);
  assert.equal(await bekraeftLink(db, { token: t, binding: BROWSER, ip: '203.0.113.1', nu: u.nu() }), null);
});

test('a link expires after 15 minutes', async () => {
  const { db, post, d, u } = await opsaet();
  await anmodLink(d, { email: 'a@example.test', binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
  u.frem(LINK_MS + 1);
  assert.equal(await bekraeftLink(db, { token: sidsteToken(post), binding: BROWSER, ip: '203.0.113.1', nu: u.nu() }), null);
});

test('a link opened in another browser is refused and is not used up', async () => {
  const { db, post, d, u } = await opsaet();
  await anmodLink(d, { email: 'a@example.test', binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
  const t = sidsteToken(post);
  assert.equal(await bekraeftLink(db, { token: t, binding: 'en-anden-browser', ip: '203.0.113.2', nu: u.nu() }), null);
  assert.equal(await bekraeftLink(db, { token: t, binding: '', ip: '203.0.113.2', nu: u.nu() }), null);
  assert.ok(await bekraeftLink(db, { token: t, binding: BROWSER, ip: '203.0.113.1', nu: u.nu() }));
});

test('looking at the link (GET, a mail scanner) does not use it up', async () => {
  const { db, post, d, u } = await opsaet();
  await anmodLink(d, { email: 'a@example.test', binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
  const t = sidsteToken(post);
  assert.equal(await findLink(db, t, u.nu()), true);
  assert.equal(await findLink(db, t, u.nu()), true);
  assert.equal(await findLink(db, 'opdigtet', u.nu()), false);
  assert.ok(await bekraeftLink(db, { token: t, binding: BROWSER, ip: '203.0.113.1', nu: u.nu() }));
  assert.equal(await findLink(db, t, u.nu()), false);
});

test('an unknown email gets the same mail, and becomes an account only when the link is used', async () => {
  const { db, post, d, u } = await opsaet();
  await anmodLink(d, { email: 'Ny@Example.test', binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
  assert.equal(post.udbakke.length, 1);
  assert.equal(post.udbakke[0]?.til, 'ny@example.test');
  assert.equal(post.udbakke[0]?.skabelon, 'maillink');
  assert.equal(post.udbakke[0]?.data['minutter'], String(LINK_MS / 60_000), 'mailen nævner linkets egen levetid');
  assert.equal(await kontoForEmail(db, 'ny@example.test'), null, 'ingen konto før linket er brugt');
  const r = await bekraeftLink(db, { token: sidsteToken(post), binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
  assert.equal(r?.ny, true);
  const k = await kontoForEmail(db, 'ny@example.test');
  assert.equal(k?.id, r?.kontoId);
  assert.equal(k?.personale, false);
  // The second login finds the same account.
  await anmodLink(d, { email: 'ny@example.test', binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
  const r2 = await bekraeftLink(db, { token: sidsteToken(post), binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
  assert.deepEqual(r2, { kontoId: k?.id, ny: false });
});

test('the answer is the same whatever happens: anmodLink resolves for junk, limits and send errors', async () => {
  const { db, post, d, u } = await opsaet();
  await anmodLink(d, { email: 'ikke en mail', binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
  post.fejl = true;
  await anmodLink(d, { email: 'a@example.test', binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
  assert.equal(post.udbakke.length, 0);
  assert.equal(await antal(db, 'loginkode'), 0, 'a code that was never sent must not be stored');
});

test('per email: the sixth link in a window is not sent', async () => {
  const { post, d, u } = await opsaet();
  for (let i = 0; i < KODER_PR_EMAIL + 1; i++) await anmodLink(d, { email: 'a@example.test', binding: BROWSER, ip: `203.0.113.${i}`, nu: u.nu() });
  assert.equal(post.udbakke.length, KODER_PR_EMAIL);
});

test('per IP: one address cannot spray links at many emails', async () => {
  const { post, d, u } = await opsaet();
  for (let i = 0; i < KODER_PR_IP + 2; i++) await anmodLink(d, { email: `p${i}@example.test`, binding: BROWSER, ip: '203.0.113.50', nu: u.nu() });
  assert.equal(post.udbakke.length, KODER_PR_IP);
});

test('failed confirmations from one IP are limited; then even a good link is refused from there', async () => {
  const { db, post, d, u } = await opsaet();
  await anmodLink(d, { email: 'a@example.test', binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
  for (let i = 0; i < FEJL_PR_IP; i++) await bekraeftLink(db, { token: `gaet-${i}`, binding: BROWSER, ip: '203.0.113.66', nu: u.nu() });
  assert.equal(await bekraeftLink(db, { token: sidsteToken(post), binding: BROWSER, ip: '203.0.113.66', nu: u.nu() }), null);
  assert.ok(await bekraeftLink(db, { token: sidsteToken(post), binding: BROWSER, ip: '203.0.113.1', nu: u.nu() }), 'linket virker stadig fra en anden adresse');
});

test('staff accounts never get a link and never log in by one (passkey only)', async () => {
  const { db, post, d, u } = await opsaet();
  await anmodLink(d, { email: 'staff@example.test', binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
  const gammel = sidsteToken(post);
  const r = await bekraeftLink(db, { token: gammel, binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
  assert.equal(await goerPersonale(db, 'staff@example.test'), 'ingen-passkey', 'personale kræver en passkey først');
  await anmodLink(d, { email: 'staff@example.test', binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
  const foerForfremmelse = sidsteToken(post);
  await db.query("INSERT INTO passkey (konto_id, credential_id, public_key, taeller, navn, oprettet) VALUES ($1, 'cred', 'pk', 0, 'nøgle', now())", [r!.kontoId]);
  assert.equal(await goerPersonale(db, 'staff@example.test'), 'ok');
  assert.equal(await bekraeftLink(db, { token: foerForfremmelse, binding: BROWSER, ip: '203.0.113.1', nu: u.nu() }), null, 'et link fra før forfremmelsen virker ikke bagefter');
  const foer = post.udbakke.length;
  await anmodLink(d, { email: 'staff@example.test', binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
  assert.equal(post.udbakke.length, foer, 'personale får ingen mail');
  assert.equal(await goerPersonale(db, 'ukendt@example.test'), 'ukendt');
});

test('no code path logs the link or the token', async () => {
  const { db, post, d, u } = await opsaet();
  const fanget: string[] = [];
  const gemt = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const k of Object.keys(gemt) as (keyof typeof gemt)[]) console[k] = (...a: unknown[]) => { fanget.push(a.map(String).join(' ')); };
  try {
    await anmodLink(d, { email: 'a@example.test', binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
    const t = sidsteToken(post);
    post.fejl = true;
    await anmodLink(d, { email: 'b@example.test', binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
    await bekraeftLink(db, { token: t, binding: 'forkert', ip: '203.0.113.1', nu: u.nu() });
    await bekraeftLink(db, { token: t, binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
    const log = fanget.join('\n');
    assert.ok(!log.includes(t), 'tokenet står i loggen');
    assert.ok(!log.includes('/log-ind/link'), 'linket står i loggen');
  } finally {
    Object.assign(console, gemt);
  }
});

test('the database holds only the hash of a link token', async () => {
  const { db, post, d, u } = await opsaet();
  await anmodLink(d, { email: 'a@example.test', binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
  const alt = await alleRaekker(db);
  assert.ok(!alt.includes(sidsteToken(post)));
  assert.ok(!alt.includes(BROWSER), 'bindingen gemmes også kun som hash');
});

test('used and expired link rows (they hold an email) are cleared after a day', async () => {
  const { db, post, d, u } = await opsaet();
  await anmodLink(d, { email: 'gammel@example.test', binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
  await bekraeftLink(db, { token: sidsteToken(post), binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
  await anmodLink(d, { email: 'udloebet@example.test', binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
  u.frem(LINK_MS + 24 * 3_600_000 + 1);
  await anmodLink(d, { email: 'ny@example.test', binding: BROWSER, ip: '203.0.113.1', nu: u.nu() });
  const tilbage = await db.query<{ email: string }>('SELECT email FROM loginkode');
  assert.deepEqual(tilbage.map((r) => r.email), ['ny@example.test']);
});
