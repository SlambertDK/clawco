import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nyOpgave, skiftStatus, svar, synlige, tillid, type Opgave } from '../../src/udvikling/opgaver.ts';
import { PROJEKTER, findProjekt, projektForRepo } from '../../src/udvikling/projekter.ts';

const NOW = new Date('2026-10-29T10:00:00Z');
const opgave = (over: Partial<Opgave> = {}): Opgave => ({
  id: 'o-abc123', projekt: 'kontrolcenter', repo: 'SlambertDK/kontrolcenter', saetning: 'Ret knappen', grundlag: null,
  kilde: 'kort', oprettet: NOW.toISOString(), opdateret: NOW.toISOString(), status: 'sendt', ...over,
});

test('the project list starts with Kontrolcenter and ShelfAtlas, and a repo matches case-insensitively', () => {
  assert.deepEqual(PROJEKTER.map((p) => p.id), ['kontrolcenter', 'shelfatlas']);
  assert.equal(findProjekt('shelfatlas')?.repo, 'SlambertDK/ShelfAtlas');
  assert.equal(findProjekt('nope'), undefined);
  assert.equal(projektForRepo('slambertdk/shelfatlas')?.id, 'shelfatlas');
  assert.equal(projektForRepo('SlambertDK/other'), undefined);
});

test('nyOpgave makes a sendt opgave with the project repo, a trimmed sentence and the card as grundlag', () => {
  const r = nyOpgave({ projekt: 'shelfatlas', saetning: '  Fejlen i Sentry skal væk  ', grundlag: { titel: 'Sentry', linjer: ['TypeError'], kilder: [] }, kilde: 'kort' }, NOW);
  assert.ok(r.ok);
  assert.match(r.opgave.id, /^o-[a-z0-9]{4,40}$/);
  assert.equal(r.opgave.repo, 'SlambertDK/ShelfAtlas');
  assert.equal(r.opgave.saetning, 'Fejlen i Sentry skal væk');
  assert.equal(r.opgave.status, 'sendt');
  assert.equal(r.opgave.oprettet, NOW.toISOString());
  assert.deepEqual(r.opgave.grundlag, { titel: 'Sentry', linjer: ['TypeError'], kilder: [] });
  const r2 = nyOpgave({ projekt: 'shelfatlas', saetning: 'x', grundlag: null, kilde: 'chat' }, NOW);
  assert.ok(r2.ok && r2.opgave.id !== r.opgave.id, 'ids are unique');
});

test('nyOpgave refuses an unknown project and an empty or too long sentence', () => {
  assert.equal(nyOpgave({ projekt: 'nope', saetning: 'x', grundlag: null, kilde: 'chat' }, NOW).ok, false);
  assert.equal(nyOpgave({ projekt: 'kontrolcenter', saetning: '   ', grundlag: null, kilde: 'chat' }, NOW).ok, false);
  assert.equal(nyOpgave({ projekt: 'kontrolcenter', saetning: 'x'.repeat(501), grundlag: null, kilde: 'chat' }, NOW).ok, false);
  assert.equal(nyOpgave({ projekt: 'kontrolcenter', saetning: 'x'.repeat(500), grundlag: null, kilde: 'chat' }, NOW).ok, true);
});

test('skiftStatus follows the transition table and refuses the rest with 409', () => {
  const lov: [Opgave['status'], Opgave['status']][] = [
    ['sendt', 'modtaget'], ['modtaget', 'sendt'], ['modtaget', 'i-gang'], ['modtaget', 'parkeret'], ['modtaget', 'faerdig'],
    ['i-gang', 'parkeret'], ['i-gang', 'faerdig'], ['parkeret', 'modtaget'], ['parkeret', 'i-gang'], ['parkeret', 'faerdig'],
  ];
  const alle: Opgave['status'][] = ['sendt', 'modtaget', 'i-gang', 'parkeret', 'faerdig'];
  for (const fra of alle) for (const til of alle) {
    if (fra === til) continue;
    const r = skiftStatus(opgave({ status: fra }), { status: til }, NOW);
    const ventet = lov.some(([a, b]) => a === fra && b === til);
    assert.equal(r.ok, ventet, `${fra} → ${til}`);
    if (!r.ok) assert.equal(r.status, 409);
  }
});

test('the second claim gets 409, and a claim with a ticket cannot be released', () => {
  const r = skiftStatus(opgave({ status: 'sendt' }), { status: 'modtaget' }, NOW);
  assert.ok(r.ok);
  const igen = skiftStatus(r.opgave, { status: 'modtaget', ticket: 'KC-0049' }, NOW);
  assert.ok(igen.ok, 'same status with the ticket updates the fields');
  assert.equal(igen.opgave.ticket, 'KC-0049');
  const frigiv = skiftStatus(igen.opgave, { status: 'sendt' }, NOW);
  assert.equal(frigiv.ok, false);
  assert.equal(skiftStatus(opgave({ status: 'modtaget' }), { status: 'sendt' }, NOW).ok, true);
});

test('faerdig is final, and the same status again with the same fields is a no-op', () => {
  const f = opgave({ status: 'faerdig', bevis: '170 tests', ticket: 'KC-0049' });
  const r = skiftStatus(f, { status: 'faerdig', bevis: '170 tests', ticket: 'KC-0049' }, NOW);
  assert.ok(r.ok);
  assert.equal(r.opgave, f, 'unchanged → the very same object');
  assert.equal(skiftStatus(f, { status: 'i-gang' }, NOW).ok, false);
});

test('skiftStatus validates ticket, pr and caps the texts', () => {
  const o = opgave({ status: 'i-gang' });
  const bad = (b: Record<string, unknown>): void => { const r = skiftStatus(o, b, NOW); assert.ok(!r.ok && r.status === 400, JSON.stringify(b)); };
  bad({ status: 'nope' });
  bad({ status: 'faerdig', ticket: 'kc-1' });
  bad({ status: 'faerdig', pr: 'http://github.com/a/b/pull/1' });
  bad({ status: 'faerdig', pr: 'https://evil.example/a/b/pull/1' });
  bad({ status: 'faerdig', bevis: 42 });
  const r = skiftStatus(o, { status: 'faerdig', bevis: 'x'.repeat(2000), pr: 'https://github.com/SlambertDK/kontrolcenter/pull/19', ticket: 'KC-0049' }, new Date('2026-10-29T11:00:00Z'));
  assert.ok(r.ok);
  assert.equal(r.opgave.bevis?.length, 1000);
  assert.equal(r.opgave.pr, 'https://github.com/SlambertDK/kontrolcenter/pull/19');
  assert.equal(r.opgave.opdateret, '2026-10-29T11:00:00.000Z');
  const p = skiftStatus(o, { status: 'parkeret', grund: 'y'.repeat(900) }, NOW);
  assert.ok(p.ok && p.opgave.grund?.length === 600);
});

test('synlige: open ones always, finished or parked ones for 7 days, newest first', () => {
  const dag = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString();
  const liste = [
    opgave({ id: 'o-gammelfaerdig', status: 'faerdig', oprettet: dag(20), opdateret: dag(8) }),
    opgave({ id: 'o-gammelsendt', status: 'sendt', oprettet: dag(30), opdateret: dag(30) }),
    opgave({ id: 'o-nyfaerdig', status: 'faerdig', oprettet: dag(3), opdateret: dag(1) }),
    opgave({ id: 'o-parkeret', status: 'parkeret', oprettet: dag(2), opdateret: dag(2) }),
    opgave({ id: 'o-gammelparkeret', status: 'parkeret', oprettet: dag(12), opdateret: dag(10) }),
  ];
  assert.deepEqual(synlige(liste, NOW).map((o) => o.id), ['o-parkeret', 'o-nyfaerdig', 'o-gammelsendt']);
});

test('a claim is exclusive: modtaget again without a ticket is 409, unless the claim is 10 minutes old and still has no ticket', () => {
  const krav = skiftStatus(opgave({ status: 'sendt' }), { status: 'modtaget' }, NOW);
  assert.ok(krav.ok);
  const anden = skiftStatus(krav.opgave, { status: 'modtaget' }, new Date(NOW.getTime() + 60_000));
  assert.ok(!anden.ok && anden.status === 409, 'a second session gets 409');
  const senere = new Date(NOW.getTime() + 11 * 60_000);
  const gammel = skiftStatus(krav.opgave, { status: 'modtaget' }, senere);
  assert.ok(gammel.ok && gammel.opgave.opdateret === senere.toISOString(), 'a stuck claim can be taken over');
  const medTicket = skiftStatus(krav.opgave, { status: 'modtaget', ticket: 'KC-0049' }, NOW);
  assert.ok(medTicket.ok);
  assert.equal(skiftStatus(medTicket.opgave, { status: 'modtaget' }, senere).ok, false, 'never once it has a ticket');
  const andenTicket = skiftStatus(medTicket.opgave, { status: 'i-gang', ticket: 'KC-0050' }, NOW);
  assert.ok(!andenTicket.ok && andenTicket.status === 409, 'the ticket never changes once set');
});

const SP = { tekst: 'Skal knappen være grøn eller blå?', valg: ['Grøn (anbefalet)', 'Blå'] };
const LATER = new Date('2026-10-29T11:00:00Z');

test('KC-0045: a parked report carries the question; it is stamped, capped and only allowed with parkeret', () => {
  const r = skiftStatus(opgave({ status: 'i-gang', ticket: 'KC-0060' }), { status: 'parkeret', grund: 'Mangler et valg', spoergsmaal: SP }, LATER);
  assert.ok(r.ok);
  assert.deepEqual(r.opgave.spoergsmaal, { ...SP, stillet: LATER.toISOString() });
  const lang = skiftStatus(opgave({ status: 'i-gang' }), { status: 'parkeret', spoergsmaal: { tekst: 'x'.repeat(700), valg: ['a', 'b', 'c', 'd', 'e', 'y'.repeat(200)] } }, LATER);
  assert.ok(lang.ok);
  assert.equal(lang.opgave.spoergsmaal?.tekst.length, 600);
  assert.deepEqual(lang.opgave.spoergsmaal?.valg, ['a', 'b', 'c', 'd']);
  const r2 = skiftStatus(opgave({ status: 'i-gang' }), { status: 'faerdig', spoergsmaal: SP }, LATER);
  assert.ok(!r2.ok && r2.status === 400);
  const r3 = skiftStatus(opgave({ status: 'i-gang' }), { status: 'parkeret', spoergsmaal: { tekst: '  ' } }, LATER);
  assert.ok(!r3.ok && r3.status === 400);
  const r4 = skiftStatus(opgave({ status: 'i-gang' }), { status: 'parkeret', spoergsmaal: 'hvad?' }, LATER);
  assert.ok(!r4.ok && r4.status === 400);
});

test('KC-0045: the same question again changes nothing; a new question drops the answer; leaving parkeret drops both', () => {
  const parkeret = opgave({ status: 'parkeret', ticket: 'KC-0060', spoergsmaal: { ...SP, stillet: NOW.toISOString() }, svar: { tekst: 'Grøn', tid: NOW.toISOString() } });
  const samme = skiftStatus(parkeret, { status: 'parkeret', spoergsmaal: SP }, LATER);
  assert.ok(samme.ok && samme.opgave === parkeret, 'idempotent');
  const ny = skiftStatus(parkeret, { status: 'parkeret', spoergsmaal: { tekst: 'Og hvor stor?' } }, LATER);
  assert.ok(ny.ok);
  assert.deepEqual(ny.opgave.spoergsmaal, { tekst: 'Og hvor stor?', valg: [], stillet: LATER.toISOString() });
  assert.equal(ny.opgave.svar, undefined);
  const videre = skiftStatus(parkeret, { status: 'modtaget', ticket: 'KC-0060' }, LATER);
  assert.ok(videre.ok);
  assert.equal(videre.opgave.spoergsmaal, undefined);
  assert.equal(videre.opgave.svar, undefined);
});

test('KC-0045: Henrik answers once, only a parked opgave with an open question, and the answer is trimmed and capped', () => {
  const sp = opgave({ status: 'parkeret', ticket: 'KC-0060', spoergsmaal: { ...SP, stillet: NOW.toISOString() } });
  const r = svar(sp, '  Grøn  ', LATER);
  assert.ok(r.ok);
  assert.deepEqual(r.opgave.svar, { tekst: 'Grøn', tid: LATER.toISOString() });
  assert.equal(r.opgave.opdateret, LATER.toISOString());
  const igen = svar(r.opgave, 'Blå', LATER);
  assert.ok(!igen.ok && igen.status === 409);
  const ingen = svar(opgave({ status: 'parkeret' }), 'Grøn', LATER);
  assert.ok(!ingen.ok && ingen.status === 409);
  const tom = svar(sp, '   ', LATER);
  assert.ok(!tom.ok && tom.status === 400);
  const lang = svar(sp, 'z'.repeat(600), LATER);
  assert.ok(!lang.ok && lang.status === 400);
});

test('KC-0048: reaching faerdig stamps faerdigTid once; a later evidence fix does not move it', () => {
  const i = opgave({ status: 'i-gang', ticket: 'KC-0001' });
  const f = skiftStatus(i, { status: 'faerdig', bevis: 'Live.' }, new Date('2026-10-29T10:07:00Z'));
  assert.ok(f.ok);
  assert.equal(f.opgave.faerdigTid, '2026-10-29T10:07:00.000Z');
  const rettet = skiftStatus(f.opgave, { status: 'faerdig', bevis: 'Live, rettet.' }, new Date('2026-10-29T11:00:00Z'));
  assert.ok(rettet.ok);
  assert.equal(rettet.opgave.faerdigTid, '2026-10-29T10:07:00.000Z');
});

test('KC-0048: tilbagerullet (a date) is accepted only on a faerdig opgave and is idempotent', () => {
  const f = opgave({ status: 'faerdig', ticket: 'KC-0001', faerdigTid: NOW.toISOString() });
  const r = skiftStatus(f, { status: 'faerdig', tilbagerullet: '2026-10-29' }, NOW);
  assert.ok(r.ok);
  assert.equal(r.opgave.tilbagerullet, '2026-10-29');
  const igen = skiftStatus(r.opgave, { status: 'faerdig', tilbagerullet: '2026-10-29' }, NOW);
  assert.ok(igen.ok && igen.opgave === r.opgave, 'unchanged → the same object');
  const forkert = skiftStatus(f, { status: 'faerdig', tilbagerullet: 'i går' }, NOW);
  assert.ok(!forkert.ok && forkert.status === 400);
  const ikkeFaerdig = skiftStatus(opgave({ status: 'i-gang' }), { status: 'i-gang', tilbagerullet: '2026-10-29' }, NOW);
  assert.ok(!ikkeFaerdig.ok && ikkeFaerdig.status === 400);
});

test('KC-0048: tillid counts per project what landed, what was rolled back, what is parked and the typical time to done', () => {
  const t = (min: number): string => new Date(NOW.getTime() + min * 60_000).toISOString();
  const tal = tillid([
    opgave({ id: 'o-a1', status: 'faerdig', oprettet: t(0), faerdigTid: t(4), opdateret: t(90) }),
    opgave({ id: 'o-a2', status: 'faerdig', oprettet: t(0), faerdigTid: t(10) }),
    opgave({ id: 'o-a3', status: 'faerdig', oprettet: t(0), opdateret: t(2), tilbagerullet: '2026-10-29' }),
    opgave({ id: 'o-a4', status: 'parkeret', oprettet: t(0) }),
    opgave({ id: 'o-a5', status: 'i-gang', oprettet: t(0) }),
    opgave({ id: 'o-b1', projekt: 'shelfatlas', repo: 'SlambertDK/ShelfAtlas', status: 'sendt', oprettet: t(0) }),
  ]);
  assert.deepEqual(tal, [
    { projekt: 'kontrolcenter', landet: 2, rullet: 1, parkeret: 1, aabne: 1, minutter: 4 },
    { projekt: 'shelfatlas', landet: 0, rullet: 0, parkeret: 0, aabne: 1 },
  ]);
});

test('KC-0048: an opgave that finished before faerdigTid existed is not stamped by a later evidence fix', () => {
  const gammel = opgave({ status: 'faerdig', ticket: 'KC-0001', bevis: 'Live.' });
  const r = skiftStatus(gammel, { status: 'faerdig', bevis: 'Live, rettet.' }, NOW);
  assert.ok(r.ok);
  assert.equal(r.opgave.faerdigTid, undefined);
});
