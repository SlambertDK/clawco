import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ENEBRUGER, erAfvist, erLoopback, hvemKigger } from '../../src/identitet/identitet.ts';
import { HusstandFejl, laesHusstand, skrivHusstand, type Husstand } from '../../src/identitet/husstand.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-identitet-'));
after(() => rm(rod, { recursive: true, force: true }));

const HENRIK = { id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' as const };
const MAJA = { id: 'maja', login: 'maja@example.com', navn: 'Maja', rolle: 'medlem' as const };
const TO: Husstand = { personer: [HENRIK, MAJA] };

const h = (o: Record<string, string>): Headers => new Headers(o);
const login = (l: string): Headers => h({ 'Tailscale-User-Login': l, 'Tailscale-User-Name': 'Navn' });

test('a loopback peer with the identity header is the person with that login', () => {
  assert.deepEqual(hvemKigger({ headers: login('maja@example.com'), peer: '127.0.0.1' }, TO), MAJA);
  assert.deepEqual(hvemKigger({ headers: login('henrik@example.com'), peer: '::1' }, TO), HENRIK);
});

test('IPv4-mapped loopback counts as loopback; anything else does not', () => {
  assert.equal(erLoopback('::ffff:127.0.0.1'), true);
  assert.equal(erLoopback('127.0.0.5'), true);
  assert.equal(erLoopback('100.64.0.5'), false);
  assert.equal(erLoopback('::ffff:100.64.0.5'), false);
  assert.equal(erLoopback(undefined), false);
  assert.equal(erLoopback(''), false);
});

test('the same header from a non-loopback peer is ignored (rule 1)', () => {
  const r = hvemKigger({ headers: login('henrik@example.com'), peer: '100.64.0.5' }, TO);
  assert.ok(erAfvist(r));
  assert.equal(r.afvist, 401);
  // And with no peer at all (a request without Node bindings).
  const r2 = hvemKigger({ headers: login('henrik@example.com'), peer: undefined }, TO);
  assert.ok(erAfvist(r2) && r2.afvist === 401);
});

test('Funnel traffic is refused with 403, even from loopback and in single-user mode (rule 2)', () => {
  for (const hus of [TO, null]) {
    const r = hvemKigger({ headers: h({ 'Tailscale-Funnel-Request': '?1', 'Tailscale-User-Login': 'henrik@example.com' }), peer: '127.0.0.1' }, hus);
    assert.ok(erAfvist(r));
    assert.equal(r.afvist, 403);
  }
});

test('a household of two without an identity gets 401, never the implicit owner (rule 3)', () => {
  const r = hvemKigger({ headers: h({}), peer: '127.0.0.1' }, TO);
  assert.ok(erAfvist(r));
  assert.equal(r.afvist, 401);
  assert.match(r.hvorfor, /\p{L}/u);
});

test('a login that is not in the household is refused with 403 (rule 4)', () => {
  const r = hvemKigger({ headers: login('fremmed@example.com'), peer: '127.0.0.1' }, TO);
  assert.ok(erAfvist(r));
  assert.equal(r.afvist, 403);
  const en = hvemKigger({ headers: login('fremmed@example.com'), peer: '127.0.0.1' }, { personer: [HENRIK] });
  assert.ok(erAfvist(en) && en.afvist === 403);
});

test('login matching ignores case and surrounding space', () => {
  assert.deepEqual(hvemKigger({ headers: login(' Maja@Example.COM '), peer: '127.0.0.1' }, TO), MAJA);
});

test('single-user: no household file → the implicit owner, header or not', () => {
  assert.deepEqual(hvemKigger({ headers: h({}), peer: undefined }, null), ENEBRUGER);
  assert.deepEqual(hvemKigger({ headers: login('henrik@example.com'), peer: '127.0.0.1' }, null), ENEBRUGER);
  assert.deepEqual(hvemKigger({ headers: h({}), peer: '127.0.0.1' }, { personer: [] }), ENEBRUGER);
  assert.equal(ENEBRUGER.rolle, 'ejer');
});

test('single-user: a household of one without a header is that person', () => {
  assert.deepEqual(hvemKigger({ headers: h({}), peer: '127.0.0.1' }, { personer: [HENRIK] }), HENRIK);
  assert.deepEqual(hvemKigger({ headers: login('henrik@example.com'), peer: '127.0.0.1' }, { personer: [HENRIK] }), HENRIK);
});

test('laesHusstand: missing file is null; written file round-trips', async () => {
  const dir = path.join(rod, 'rundtur');
  assert.equal(await laesHusstand(dir), null);
  await skrivHusstand(dir, TO);
  assert.deepEqual(await laesHusstand(dir), TO);
  assert.ok(JSON.parse(await readFile(path.join(dir, 'husstand.json'), 'utf8')).personer);
});

test('laesHusstand fails closed on a broken file (never single-user by accident)', async () => {
  const dir = path.join(rod, 'brudt');
  await skrivHusstand(dir, TO);
  const fil = path.join(dir, 'husstand.json');
  for (const indhold of ['{ikke json', '[]', '{"personer": "x"}', JSON.stringify({ personer: [{ ...MAJA, rolle: 'admin' }] }), JSON.stringify({ personer: [{ ...MAJA, id: 'Ma ja' }] }), JSON.stringify({ personer: [MAJA, { ...HENRIK, id: 'maja' }] })]) {
    await writeFile(fil, indhold, 'utf8');
    await assert.rejects(laesHusstand(dir), HusstandFejl, indhold);
  }
});

test('skrivHusstand refuses an invalid household', async () => {
  await assert.rejects(skrivHusstand(path.join(rod, 'ugyldig'), { personer: [{ ...MAJA, rolle: 'admin' as never }] }), HusstandFejl);
});
