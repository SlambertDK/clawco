import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { forKorteNavne, MASKE, MIN_LAENGDE, nulstilRegistrerede, redigerKonsol, redigeres, redigeresFejl, registrerHemmelighed } from '../../src/graenser/redaktion.ts';

const HEMMELIG = 'sk-test-1234567890abcdef';
beforeEach(() => nulstilRegistrerede());

test('the value of every env name matching KEY, TOKEN, SECRET, PASSWORD or NOEGLE, and the two named keys, is masked', () => {
  const env = {
    FOO_API_KEY: 'aaaaaaaa1111', BAR_TOKEN: 'bbbbbbbb2222', BAZ_SECRET: 'cccccccc3333', DB_PASSWORD: 'dddddddd4444',
    KC_ELEVENLABS_API_KEY: 'eeeeeeee5555', KC_HERMES_API_KEY: 'ffffffff6666', KC_MODEL_NOEGLE_ANTHROPIC: 'gggggggg7777', KC_PORT: '8750-port-value',
  };
  const ud = redigeres(Object.values(env).join(' | '), env);
  assert.equal(ud, [MASKE, MASKE, MASKE, MASKE, MASKE, MASKE, MASKE, '8750-port-value'].join(' | '));
});

test('no list of key shapes is needed: a value is found anywhere in the text, and every occurrence goes', () => {
  const env = { X_TOKEN: HEMMELIG };
  assert.equal(redigeres(`Authorization: Bearer ${HEMMELIG}; again ${HEMMELIG}!`, env), `Authorization: Bearer ${MASKE}; again ${MASKE}!`);
  assert.equal(redigeres('nothing to hide here', env), 'nothing to hide here');
});

test('regex-special characters in a value are matched literally', () => {
  const v = 'a.b*c+d?(e)[f]{g}|h^i$j\\k';
  const env = { X_SECRET: v };
  assert.equal(redigeres(`x ${v} y`, env), `x ${MASKE} y`);
  assert.equal(redigeres('a-b-c-d-e-f-g-h-i-j-k-xx', env), 'a-b-c-d-e-f-g-h-i-j-k-xx', 'the dots are not wildcards');
});

test('a value inside JSON or a URL is masked in its escaped form too', () => {
  const v = 'p"ss\nwo/rd é12345';
  const env = { X_PASSWORD: v };
  assert.equal(redigeres(JSON.stringify({ fejl: `bad ${v}` }), env), JSON.stringify({ fejl: `bad ${MASKE}` }));
  assert.equal(redigeres(`https://x.test/?k=${encodeURIComponent(v)}`, env), `https://x.test/?k=${MASKE}`);
});

test('partial overlaps: two secrets that overlap in the text leave neither half behind', () => {
  const env = { A_KEY: 'AAAAAAAABBBBBBBB', B_KEY: 'BBBBBBBBCCCCCCCC' };
  assert.equal(redigeres('x AAAAAAAABBBBBBBBCCCCCCCC y', env), `x ${MASKE} y`);
  assert.equal(redigeres('x AAAAAAAABBBBBBBB y', env), `x ${MASKE} y`);
});

test('a secret that contains another is masked whole, not around the inner one', () => {
  const env = { LANG_KEY: 'prefix-inner-secret-9', KORT_KEY: 'inner-secret' };
  assert.equal(redigeres('v=prefix-inner-secret-9', env), `v=${MASKE}`);
});

test('values below the minimum length are not masked (they would mask ordinary words), and are listed by name', () => {
  assert.equal(MIN_LAENGDE, 8);
  const env = { KORT_KEY: 'abc1234', LANG_KEY: 'abc12345', TOM_KEY: '', DEL_TOKEN: undefined };
  assert.equal(redigeres('abc1234 abc12345', env), `abc1234 ${MASKE}`);
  assert.deepEqual(forKorteNavne(env), ['KORT_KEY'], 'empty and unset are not "too short", they are missing');
});

test('registered values (a connector credential read at runtime) are masked like env values; short ones are refused', () => {
  assert.equal(registrerHemmelighed('hunter2'), false);
  assert.equal(registrerHemmelighed('imap-adgangskode-42'), true);
  assert.equal(redigeres('login failed for imap-adgangskode-42', {}), `login failed for ${MASKE}`);
  nulstilRegistrerede();
  assert.equal(redigeres('login failed for imap-adgangskode-42', {}), 'login failed for imap-adgangskode-42');
});

test('the process environment is the default source, read at call time (a key set after start is covered)', () => {
  const navn = 'KC_TEST_REDAKTION_TOKEN';
  assert.equal(redigeres(`v ${HEMMELIG}`), `v ${HEMMELIG}`);
  process.env[navn] = HEMMELIG;
  try { assert.equal(redigeres(`v ${HEMMELIG}`), `v ${MASKE}`); } finally { delete process.env[navn]; }
});

test('an error is shown with its message and its whole cause chain, masked at every level', () => {
  const env = { X_KEY: HEMMELIG };
  const indre = new Error(`401 for key ${HEMMELIG}`);
  const midt = new Error(`Hermes afviste kørslen (${HEMMELIG})`, { cause: indre });
  const ydre = new Error('kørslen fejlede', { cause: midt });
  const ud = redigeresFejl(ydre, env);
  assert.ok(!ud.includes(HEMMELIG));
  assert.match(ud, /kørslen fejlede/);
  assert.match(ud, /Hermes afviste kørslen \(\[skjult\]\)/);
  assert.match(ud, /401 for key \[skjult\]/);
  assert.ok(!redigeresFejl(new AggregateError([new Error(HEMMELIG)], `samlet ${HEMMELIG}`), env).includes(HEMMELIG));
  assert.equal(redigeresFejl(`tekst ${HEMMELIG}`, env), `tekst ${MASKE}`);
  assert.ok(!redigeresFejl({ besked: HEMMELIG }, env).includes(HEMMELIG), 'a thrown plain object');
});

test('the console wrapper masks strings, errors and objects in every level, and leaves the call shape alone', () => {
  const set: string[] = [];
  const k = { log: (...a: unknown[]) => set.push(a.join(' ')), info: (...a: unknown[]) => set.push(a.join(' ')), warn: (...a: unknown[]) => set.push(a.join(' ')), error: (...a: unknown[]) => set.push(a.join(' ')), debug: (...a: unknown[]) => set.push(a.join(' ')) };
  registrerHemmelighed(HEMMELIG);
  redigerKonsol(k);
  k.log('nøgle', HEMMELIG);
  k.error('fejl:', new Error(`nede ${HEMMELIG}`), { token: HEMMELIG });
  k.warn(`%s ok`, HEMMELIG);
  assert.equal(set.length, 3);
  for (const l of set) assert.ok(!l.includes(HEMMELIG), l);
  assert.match(set[0]!, /^nøgle \[skjult\]$/);
  assert.match(set[1]!, /fejl: .*nede \[skjult\]/s);
});
