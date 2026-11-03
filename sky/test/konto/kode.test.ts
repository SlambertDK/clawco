// KC-0246: the sign-in mail also carries a one-time code, for a person who asks for the mail on one device and opens it on
// another. The code does what the link does and no more: only in the browser that asked, once (link and code spend each
// other), the same 15 minutes, stored only as a hash, compared in constant time, five wrong tries and that login is void,
// and the same per-IP failure budget as the link. It is derived from the link token (so the page the link opens in another
// browser can show it without the database ever holding it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nyDb, ur, alleRaekker, antal } from './hjaelp.ts';
import { anmodLink, bekraeftKode, bekraeftLink, findLink, grupperKode, kodeFraToken, linkTilstand, normaliserKode, KODE_ALFABET, LINK_MS, MAKS_FORSOEG, type LinkDeps } from '../../src/konto/maillink.ts';
import { kontoForEmail } from '../../src/konto/konto.ts';
import { FEJL_PR_IP } from '../../src/konto/graenser.ts';
import { falskPost, type FalskPost } from '../../src/delt/post.ts';
import type { Database } from '../../src/db/pool.ts';

const PUBLIC = 'https://konto.example.test';
const BROWSER = 'binding-fra-browseren-der-bad-om-linket';
const IP = '203.0.113.1';

async function opsaet(): Promise<{ db: Database; post: FalskPost; d: LinkDeps; u: ReturnType<typeof ur> }> {
  const db = await nyDb();
  const post = falskPost();
  return { db, post, d: { db, post, publicUrl: PUBLIC }, u: ur() };
}
const sidsteToken = (post: FalskPost): string => new URL(post.udbakke.at(-1)!.data['link']!).searchParams.get('t')!;
const sidsteKode = (post: FalskPost): string => post.udbakke.at(-1)!.data['kode']!;
/** A code that is well formed and not the right one. */
const forkert = (kode: string): string => (kode[0] === '2' ? '3' : '2') + kode.slice(1);

test('the code: 8 characters from an unambiguous alphabet, shown in two groups of four, the same for the same token', () => {
  assert.equal(KODE_ALFABET.length, 32);
  assert.ok(!/[01OI]/.test(KODE_ALFABET), 'no 0, 1, O or I');
  assert.equal(new Set(KODE_ALFABET).size, 32);
  const k = kodeFraToken('et-token');
  assert.match(k, new RegExp(`^[${KODE_ALFABET}]{8}$`));
  assert.equal(kodeFraToken('et-token'), k);
  assert.notEqual(kodeFraToken('et-andet-token'), k);
  assert.match(grupperKode(k), /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(grupperKode('4F7K9Q2M'), '4F7K-9Q2M');
  // Many tokens: every character of the alphabet turns up (no bias that hides part of it), nothing outside it.
  const set = new Set<string>();
  for (let i = 0; i < 400; i++) for (const c of kodeFraToken(`t${i}`)) set.add(c);
  assert.equal(set.size, 32);
});

test('typed codes are tidied (case, spaces, hyphens) and anything not 8 characters of the alphabet is no code', () => {
  assert.equal(normaliserKode('4f7k-9q2m'), '4F7K9Q2M');
  assert.equal(normaliserKode(' 4F7K 9Q2M '), '4F7K9Q2M');
  assert.equal(normaliserKode('4F7K–9Q2M'), '4F7K9Q2M', 'a typographic dash from a phone keyboard');
  for (const v of ['', '4F7K', '4F7K-9Q2M-X', '4F7K-9Q20', '4F7K-9Q2I', 'ÆØÅÆØÅÆØ', 42, null, undefined, { a: 1 }]) assert.equal(normaliserKode(v), null, String(v));
});

test('the mail carries the code, grouped, derived from the link token; the link is unchanged', async () => {
  const { post, d, u } = await opsaet();
  await anmodLink(d, { email: 'a@example.test', binding: BROWSER, ip: IP, nu: u.nu() });
  const m = post.udbakke[0]!;
  assert.equal(m.data['kode'], grupperKode(kodeFraToken(sidsteToken(post))));
  assert.equal(new URL(m.data['link']!).pathname, '/log-ind/link');
});

test('the code logs in once, in the browser that asked; the link is spent with it', async () => {
  const { db, post, d, u } = await opsaet();
  await anmodLink(d, { email: 'ny@example.test', binding: BROWSER, ip: IP, nu: u.nu() });
  const r = await bekraeftKode(db, { kode: sidsteKode(post).toLowerCase(), binding: BROWSER, ip: IP, nu: u.nu() });
  assert.ok(r.ok);
  assert.equal(r.ok && r.ny, true);
  assert.equal((await kontoForEmail(db, 'ny@example.test'))?.id, r.ok ? r.kontoId : -1);
  assert.deepEqual(await bekraeftKode(db, { kode: sidsteKode(post), binding: BROWSER, ip: IP, nu: u.nu() }), { ok: false, grund: 'doed' }, 'a second use of the code');
  assert.equal(await bekraeftLink(db, { token: sidsteToken(post), binding: BROWSER, ip: IP, nu: u.nu() }), null, 'the link is spent by the code');
  assert.equal(await findLink(db, sidsteToken(post), u.nu()), false);
});

test('the link spends the code', async () => {
  const { db, post, d, u } = await opsaet();
  await anmodLink(d, { email: 'a@example.test', binding: BROWSER, ip: IP, nu: u.nu() });
  assert.ok(await bekraeftLink(db, { token: sidsteToken(post), binding: BROWSER, ip: IP, nu: u.nu() }));
  assert.deepEqual(await bekraeftKode(db, { kode: sidsteKode(post), binding: BROWSER, ip: IP, nu: u.nu() }), { ok: false, grund: 'doed' });
});

test('the code does not work in another browser, and trying it there does not use the login up', async () => {
  const { db, post, d, u } = await opsaet();
  await anmodLink(d, { email: 'a@example.test', binding: BROWSER, ip: IP, nu: u.nu() });
  for (const binding of ['en-anden-browser', '']) assert.equal((await bekraeftKode(db, { kode: sidsteKode(post), binding, ip: '203.0.113.2', nu: u.nu() })).ok, false);
  const [{ forsoeg }] = (await db.query<{ forsoeg: number }>('SELECT forsoeg FROM loginkode')) as [{ forsoeg: number }];
  assert.equal(Number(forsoeg), 0, 'a stranger with the right code cannot burn the owner\'s tries');
  assert.ok((await bekraeftKode(db, { kode: sidsteKode(post), binding: BROWSER, ip: IP, nu: u.nu() })).ok);
});

test('the code expires with the link, after 15 minutes', async () => {
  const { db, post, d, u } = await opsaet();
  await anmodLink(d, { email: 'a@example.test', binding: BROWSER, ip: IP, nu: u.nu() });
  u.frem(LINK_MS + 1);
  assert.deepEqual(await bekraeftKode(db, { kode: sidsteKode(post), binding: BROWSER, ip: IP, nu: u.nu() }), { ok: false, grund: 'doed' });
});

test('five wrong codes void that login: the sixth try fails even with the right code, and the link is dead too', async () => {
  const { db, post, d, u } = await opsaet();
  await anmodLink(d, { email: 'a@example.test', binding: BROWSER, ip: IP, nu: u.nu() });
  const rigtig = sidsteKode(post);
  assert.equal(MAKS_FORSOEG, 5);
  for (let i = 1; i <= MAKS_FORSOEG; i++) {
    const r = await bekraeftKode(db, { kode: forkert(rigtig), binding: BROWSER, ip: `203.0.113.${100 + i}`, nu: u.nu() });
    assert.deepEqual(r, { ok: false, grund: i < MAKS_FORSOEG ? 'forkert' : 'doed' }, `forsøg ${i}`);
  }
  assert.deepEqual(await bekraeftKode(db, { kode: rigtig, binding: BROWSER, ip: IP, nu: u.nu() }), { ok: false, grund: 'doed' });
  assert.equal(await bekraeftLink(db, { token: sidsteToken(post), binding: BROWSER, ip: IP, nu: u.nu() }), null);
  assert.equal(await findLink(db, sidsteToken(post), u.nu()), false);
  // A new mail is a new login with its own tries.
  await anmodLink(d, { email: 'a@example.test', binding: BROWSER, ip: IP, nu: u.nu() });
  assert.ok((await bekraeftKode(db, { kode: sidsteKode(post), binding: BROWSER, ip: IP, nu: u.nu() })).ok);
});

test('the right code on the fifth try still works; five wrong ones in parallel never give more than five tries', async () => {
  const { db, post, d, u } = await opsaet();
  await anmodLink(d, { email: 'a@example.test', binding: BROWSER, ip: IP, nu: u.nu() });
  const rigtig = sidsteKode(post);
  for (let i = 0; i < 4; i++) await bekraeftKode(db, { kode: forkert(rigtig), binding: BROWSER, ip: `203.0.113.${100 + i}`, nu: u.nu() });
  assert.ok((await bekraeftKode(db, { kode: rigtig, binding: BROWSER, ip: IP, nu: u.nu() })).ok);

  await anmodLink(d, { email: 'b@example.test', binding: 'b2', ip: IP, nu: u.nu() });
  const rigtig2 = sidsteKode(post);
  const alle = await Promise.all(Array.from({ length: 12 }, (_, i) => bekraeftKode(db, { kode: i === 11 ? rigtig2 : forkert(rigtig2), binding: 'b2', ip: `198.51.100.${i}`, nu: u.nu() })));
  const [{ forsoeg }] = (await db.query<{ forsoeg: number }>("SELECT forsoeg FROM loginkode WHERE email = 'b@example.test'")) as [{ forsoeg: number }];
  assert.ok(Number(forsoeg) <= MAKS_FORSOEG, `forsoeg = ${forsoeg}`);
  assert.ok(alle.filter((r) => r.ok).length <= 1);
});

test('the same IP budget as the link: failed codes count, and from a blocked IP even the right code is refused', async () => {
  const { db, post, d, u } = await opsaet();
  await anmodLink(d, { email: 'a@example.test', binding: BROWSER, ip: IP, nu: u.nu() });
  for (let i = 0; i < FEJL_PR_IP; i++) await bekraeftKode(db, { kode: 'gaet', binding: 'ingen-ventende-' + i, ip: '203.0.113.66', nu: u.nu() });
  assert.deepEqual(await bekraeftKode(db, { kode: sidsteKode(post), binding: BROWSER, ip: '203.0.113.66', nu: u.nu() }), { ok: false, grund: 'for-mange' });
  assert.ok((await bekraeftKode(db, { kode: sidsteKode(post), binding: BROWSER, ip: IP, nu: u.nu() })).ok, 'from another address it still works');
  // And link failures count against the same budget (one budget for every way of proving a login).
  await anmodLink(d, { email: 'b@example.test', binding: 'b3', ip: IP, nu: u.nu() });
  for (let i = 0; i < FEJL_PR_IP; i++) await bekraeftLink(db, { token: `gaet-${i}`, binding: 'b3', ip: '203.0.113.77', nu: u.nu() });
  assert.deepEqual(await bekraeftKode(db, { kode: sidsteKode(post), binding: 'b3', ip: '203.0.113.77', nu: u.nu() }), { ok: false, grund: 'for-mange' });
});

test('the database holds the code only as a salted hash; never the code, the grouped code or a plain hash of it', async () => {
  const { db, post, d, u } = await opsaet();
  await anmodLink(d, { email: 'a@example.test', binding: BROWSER, ip: IP, nu: u.nu() });
  const kode = sidsteKode(post).replace('-', '');
  const alt = await alleRaekker(db);
  assert.ok(!alt.includes(kode) && !alt.includes(sidsteKode(post)), 'koden står i klartekst');
  const { createHash } = await import('node:crypto');
  assert.ok(!alt.includes(createHash('sha256').update(kode).digest('hex')), 'a plain hash of the code would fall to a lookup table');
  const [{ kode_hash }] = (await db.query<{ kode_hash: string }>('SELECT kode_hash FROM loginkode')) as [{ kode_hash: string }];
  assert.match(kode_hash, /^[0-9a-f]{64}$/);
});

test('the compare is constant-time: the code is checked with timingSafeEqual (ensTokens), not ===', async () => {
  const fs = await import('node:fs');
  const kilde = fs.readFileSync(new URL('../../src/konto/maillink.ts', import.meta.url), 'utf8');
  const i = kilde.indexOf('export async function bekraeftKode');
  assert.ok(i > 0);
  const krop = kilde.slice(i);
  assert.match(krop, /ensTokens\(/);
  assert.doesNotMatch(krop, /kode_hash\s*===|===\s*\w*\.kode_hash/);
});

test('linkTilstand: dead, this browser, or another browser — reading never spends anything', async () => {
  const { db, post, d, u } = await opsaet();
  await anmodLink(d, { email: 'a@example.test', binding: BROWSER, ip: IP, nu: u.nu() });
  const t = sidsteToken(post);
  assert.equal(await linkTilstand(db, t, BROWSER, u.nu()), 'her');
  assert.equal(await linkTilstand(db, t, 'en-anden', u.nu()), 'anden-browser');
  assert.equal(await linkTilstand(db, t, '', u.nu()), 'anden-browser');
  assert.equal(await linkTilstand(db, 'opdigtet', BROWSER, u.nu()), 'doed');
  assert.equal(await linkTilstand(db, '', BROWSER, u.nu()), 'doed');
  assert.equal(await linkTilstand(db, t, BROWSER, u.nu()), 'her', 'still unspent');
  assert.ok(await bekraeftLink(db, { token: t, binding: BROWSER, ip: IP, nu: u.nu() }));
  assert.equal(await linkTilstand(db, t, BROWSER, u.nu()), 'doed');
});

test('no code path logs the code', async () => {
  const { db, post, d, u } = await opsaet();
  const fanget: string[] = [];
  const gemt = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const k of Object.keys(gemt) as (keyof typeof gemt)[]) console[k] = (...a: unknown[]) => { fanget.push(a.map(String).join(' ')); };
  let kode = '';
  try {
    await anmodLink(d, { email: 'a@example.test', binding: BROWSER, ip: IP, nu: u.nu() });
    kode = sidsteKode(post);
    post.fejl = true;
    await anmodLink(d, { email: 'b@example.test', binding: BROWSER, ip: IP, nu: u.nu() });
    await bekraeftKode(db, { kode: forkert(kode), binding: BROWSER, ip: IP, nu: u.nu() });
    await bekraeftKode(db, { kode, binding: BROWSER, ip: IP, nu: u.nu() });
  } finally { Object.assign(console, gemt); }
  const log = fanget.join('\n');
  assert.ok(!log.includes(kode) && !log.includes(kode.replace('-', '')) && !log.includes(forkert(kode)), 'koden står i loggen');
});

test('a login row from before the code existed (no code hash) still works by link and never by code', async () => {
  const { db, d, u } = await opsaet();
  void d;
  const { hashToken } = await import('../../src/konto/token.ts');
  await db.query('INSERT INTO loginkode (hash, email, binding, oprettet, udloeber) VALUES ($1, $2, $3, $4, $5)',
    [hashToken('gammelt'), 'g@example.test', hashToken(BROWSER), u.nu().toISOString(), new Date(u.nu().getTime() + LINK_MS).toISOString()]);
  assert.deepEqual(await bekraeftKode(db, { kode: kodeFraToken('gammelt'), binding: BROWSER, ip: IP, nu: u.nu() }), { ok: false, grund: 'doed' });
  assert.ok(await bekraeftLink(db, { token: 'gammelt', binding: BROWSER, ip: IP, nu: u.nu() }));
  assert.equal(await antal(db, 'loginkode'), 1);
});
