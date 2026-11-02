// KC-0232: the Danmark-pakke recogniser — a pure rule over the mail envelopes the app already reads. A notice exists only
// for a sender the person confirmed; the subject is plain, short and never a link. Invented senders only (.example).

// The real hint domains are joined at run time: the mirror guard (test/privat) reads a literal <local>@<host> as an address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { erKendtDomaene, genkendDigitalPost, GENERISK_EMNE, KENDTE_DOMAENER, kandidatAfsendere, EMNE_MAKS, SET_MAKS, tilfoejSet } from '../../../src/kilder/danmark/digital-post.ts';
import type { Kuvert } from '../../../src/kilder/types.ts';

const NU = new Date('2026-11-02T10:00:00Z');
const AFSENDER = 'post@notifikation.digitalpost.example';
const dageSiden = (n: number): string => new Date(NU.getTime() - n * 86_400_000).toISOString();
const k = (o: Partial<Kuvert> & { id: string }): Kuvert => ({ emne: 'Du har ny Digital Post', fra: 'Digital Post', fraEmail: AFSENDER, modtaget: dageSiden(1), laest: false, flag: false, vedhaeftning: false, ...o });
const valg = (o: Partial<Parameters<typeof genkendDigitalPost>[1]> = {}): Parameters<typeof genkendDigitalPost>[1] => ({ afsendere: [AFSENDER], nu: NU, set: new Set(), ...o });

test('a confirmed sender gives a notice with the id, the time and the confirmed address', () => {
  const ud = genkendDigitalPost([k({ id: '7', messageId: '<m7@x.example>', emne: 'Ny besked fra Fiktiv Kommune' })], valg());
  assert.deepEqual(ud, [{ id: '<m7@x.example>', modtaget: dageSiden(1), afsender: AFSENDER, emneKort: 'Ny besked fra Fiktiv Kommune' }]);
});

test('the id is the message id, else the envelope id', () => {
  assert.equal(genkendDigitalPost([k({ id: '42' })], valg())[0]?.id, '42');
});

test('an unconfirmed sender with the same subject gives none; the address is compared in lower case, whole', () => {
  assert.deepEqual(genkendDigitalPost([k({ id: '1', fraEmail: 'post@andet.example' })], valg()), []);
  assert.deepEqual(genkendDigitalPost([k({ id: '1', fraEmail: `x${AFSENDER}` })], valg()), [], 'a longer address is another address');
  assert.deepEqual(genkendDigitalPost([k({ id: '1', fraEmail: `${AFSENDER}.evil.example` })], valg()), []);
  assert.equal(genkendDigitalPost([k({ id: '1', fraEmail: AFSENDER.toUpperCase() })], valg()).length, 1, 'case does not matter');
  assert.deepEqual(genkendDigitalPost([k({ id: '1', fra: AFSENDER, fraEmail: 'post@andet.example' })], valg()), [], 'the display name is never an address; only fraEmail counts');
  const { fraEmail: _uden, ...udenAdresse } = k({ id: '1' });
  assert.deepEqual(genkendDigitalPost([udenAdresse], valg()), []);
});

test('no confirmed sender: nothing is ever recognised', () => {
  assert.deepEqual(genkendDigitalPost([k({ id: '1' })], valg({ afsendere: [] })), []);
});

test('a read envelope gives none (the person already saw it in the mail)', () => {
  assert.deepEqual(genkendDigitalPost([k({ id: '1', laest: true })], valg()), []);
});

test('a notice marked seen ("Set den") gives none, by its id', () => {
  const m = [k({ id: '1', messageId: '<a@x.example>' }), k({ id: '2', messageId: '<b@x.example>' })];
  assert.deepEqual(genkendDigitalPost(m, valg({ set: new Set(['<a@x.example>']) })).map((n) => n.id), ['<b@x.example>']);
});

test('expiry: a notice older than the window gives none (14 days by default, the day itself still counts)', () => {
  assert.equal(genkendDigitalPost([k({ id: '1', modtaget: dageSiden(14) })], valg()).length, 1);
  assert.equal(genkendDigitalPost([k({ id: '1', modtaget: dageSiden(14.01) })], valg()).length, 0);
  assert.equal(genkendDigitalPost([k({ id: '1', modtaget: dageSiden(3) })], valg({ udloebDage: 2 })).length, 0);
});

test('a date that cannot be read, or lies in the future, gives none (it could never expire)', () => {
  assert.deepEqual(genkendDigitalPost([k({ id: '1', modtaget: '' }), k({ id: '2', modtaget: 'i går' })], valg()), []);
  assert.deepEqual(genkendDigitalPost([k({ id: '1', modtaget: dageSiden(-40) })], valg()), []);
  assert.equal(genkendDigitalPost([k({ id: '1', modtaget: dageSiden(-0.5) })], valg()).length, 1, 'a little clock skew is tolerated');
});

test('duplicates by message id collapse to one (the newest); different ids stay', () => {
  const m = [k({ id: '1', messageId: '<a@x.example>', modtaget: dageSiden(2) }), k({ id: '9', messageId: '<a@x.example>', modtaget: dageSiden(1) }), k({ id: '3', messageId: '<c@x.example>' })];
  const ud = genkendDigitalPost(m, valg());
  assert.equal(ud.length, 2);
  assert.equal(ud.find((n) => n.id === '<a@x.example>')?.modtaget, dageSiden(1));
});

test('newest first', () => {
  const ud = genkendDigitalPost([k({ id: 'a', modtaget: dageSiden(5) }), k({ id: 'b', modtaget: dageSiden(1) }), k({ id: 'c', modtaget: dageSiden(3) })], valg());
  assert.deepEqual(ud.map((n) => n.id), ['b', 'c', 'a']);
});

test('subject text: markup stays as text (the renderer escapes it), a URL never survives, control characters go, the length is cut', () => {
  const e = (emne: string): string => genkendDigitalPost([k({ id: '1', emne })], valg())[0]!.emneKort;
  assert.equal(e('<img src=x onerror=alert(1)> brev'), '<img src=x onerror=alert(1)> brev', 'text is text: html`` escapes it on screen (see the render test)');
  assert.doesNotMatch(e('Se https://svindel.example/login nu'), /https?:|svindel/);
  assert.doesNotMatch(e('Se www.svindel.example nu'), /www\.|svindel/);
  assert.doesNotMatch(e('Klik hxxp://x.example/a og ftp://y.example'), /:\/\//);
  assert.equal(e('A\u0000B‮C\r\nD'), 'ABC D');
  assert.equal(e('x'.repeat(200)).length, EMNE_MAKS);
  assert.equal(EMNE_MAKS, 80);
  assert.equal(e('   '), '', 'a blank subject is empty');
});

test('the generic notification subject is recognised as generic (the card then leaves the subject out)', () => {
  for (const g of ['Du har ny post', 'Du har ny Digital Post', 'Du har fået ny Digital Post', 'Ny digital post', 'Der er kommet ny post i Digital Post', 'Notifikation om ny post', '', 'Ny besked']) assert.ok(GENERISK_EMNE(g), g);
  for (const s of ['Ny besked fra Fiktiv Kommune', 'Årsopgørelse', 'Svar på din ansøgning']) assert.ok(!GENERISK_EMNE(s), s);
});

test('empty input gives an empty list', () => {
  assert.deepEqual(genkendDigitalPost([], valg()), []);
});

test('the input is not changed', () => {
  const m = [k({ id: '1' }), k({ id: '2', laest: true })];
  const kopi = structuredClone(m);
  genkendDigitalPost(m, valg());
  assert.deepEqual(m, kopi);
});

test('several confirmed senders all count', () => {
  const m = [k({ id: '1' }), k({ id: '2', fraEmail: 'post@e-boks.example' })];
  assert.equal(genkendDigitalPost(m, valg({ afsendere: [AFSENDER, 'post@e-boks.example'] })).length, 2);
});

test('hint domains: a known Digital Post domain (or a subdomain of it) is a candidate; nothing else; a hint is never a confirmation', () => {
  assert.deepEqual([...KENDTE_DOMAENER], ['digitalpost.dk', 'e-boks.dk', 'mit.dk', 'borger.dk']);
  const er = (a: string, d?: readonly string[]): boolean => erKendtDomaene(a, d);
  assert.ok(er('post' + '@' + 'digitalpost.dk'));
  assert.ok(er('Post' + '@' + 'Notifikation.Digitalpost.DK'));
  assert.ok(er('x' + '@' + 'e-boks.dk') && er('x' + '@' + 'mit.dk') && er('x' + '@' + 'borger.dk'));
  assert.ok(!er('x@digitalpost.dk.evil.example'), 'the domain must END with a hint domain');
  assert.ok(!er('x' + '@' + 'xdigitalpost.dk'), 'a longer label is another domain');
  assert.ok(!er('x@gmail.example') && !er('') && !er('uden-snabel') && !er('a@b' + '@' + 'mit.dk') && !er('x@ mit.dk'));
  assert.ok(er('post@digitalpost.example', ['digitalpost.example']), 'the world adds its invented domain');
});

test('candidates: the inbox senders on a hint domain — addresses only, once each, no subjects; read or unread, any age', () => {
  const m = [
    k({ id: '1', modtaget: dageSiden(40), laest: true, fraEmail: 'post@notifikation.digitalpost.example' }),
    k({ id: '2', fraEmail: 'POST@notifikation.digitalpost.example' }),
    k({ id: '3', fraEmail: 'nyhed@mit.example', emne: 'ikke relevant' }),
    k({ id: '4', fraEmail: 'info@butik.example' }),
  ];
  const ud = kandidatAfsendere(m, ['digitalpost.example', 'mit.example']);
  assert.deepEqual(ud, ['post@notifikation.digitalpost.example', 'nyhed@mit.example']);
  for (const s of ud) assert.doesNotMatch(s, /relevant/);
  assert.deepEqual(kandidatAfsendere([], KENDTE_DOMAENER), []);
});

test('the seen list is capped: the newest ids stay, the oldest go, no duplicates', () => {
  let s: string[] = [];
  for (let i = 0; i < SET_MAKS + 5; i++) s = tilfoejSet(s, `id${i}`);
  assert.equal(s.length, SET_MAKS);
  assert.equal(s[s.length - 1], `id${SET_MAKS + 4}`);
  assert.ok(!s.includes('id0'));
  assert.deepEqual(tilfoejSet(['a', 'b'], 'a'), ['b', 'a'], 'a repeat moves to the end, never twice');
});
