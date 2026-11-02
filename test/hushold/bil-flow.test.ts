// KC-0151, the first household flow end to end: "jeg skal bruge den store bil lørdag 10 til 15" in the Husstand
// chat. A free car becomes one card whose blue button books (nothing changes on the sentence); a car Rikke holds
// 09–13 becomes the clash card for both with "Tag den lille bil", "Spørg Rikke om at bytte" and "Drop" in that
// order; her yes moves the bookings and both get a Fortryd that restores.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { dobbeltBooket } from '../../src/hushold/ressource.ts';
import { booking, HENRIK, RIKKE, LOERDAG, lavBil, lordag, MAJA, nyRod, type BilApp } from '../helpers/bil.ts';

const rod = await nyRod();
after(() => rm(rod, { recursive: true, force: true }));

const SAETNING = 'Jeg skal bruge den store bil lørdag 10 til 15';
const kursus = (a: BilApp) => a.aktion(RIKKE, 'book', { ressourceId: 'stor-bil', dag: LOERDAG, start: '09:00', slut: '13:00', titel: 'Kursus' });
const ingenDobbelt = async (a: BilApp) => assert.ok((await a.state()).ressourcer.every((r) => !dobbeltBooket(r)), 'never a double booking');
const raekkefoelge = (h: string, ...dele: string[]): void => {
  const pos = dele.map((d) => h.indexOf(d));
  assert.ok(pos.every((p) => p >= 0), `all of ${dele.join(' | ')} are there: ${pos}`);
  assert.deepEqual([...pos].sort((x, y) => x - y), pos, `in order: ${dele.join(' → ')}`);
};

/** Rikke's course holds the big car; Henrik says his sentence; Hermes answers with the booking block. */
async function lordagMedKursus(navn: string) {
  const a = await lavBil(rod, navn, { chat: booking(lordag('10:00', '15:00'), 'Den store bil er optaget af Rikke; jeg har lagt et kort frem.') });
  assert.equal((await kursus(a)).status, 202);
  assert.equal(await a.sig(HENRIK, SAETNING), 202);
  return a;
}

test('a sentence on a car Rikke holds becomes one clash card for both; nothing is booked and nothing is double booked', async () => {
  const a = await lordagMedKursus('konflikt');
  const st = await a.state();
  assert.equal(st.sammenfald.length, 1);
  const s = st.sammenfald[0]!;
  assert.deepEqual([s.ny.af, s.mod.af, s.ressourceId], ['henrik', 'rikke', 'stor-bil']);
  assert.equal(s.ny.titel, 'Indkøb');
  assert.deepEqual((await a.kalender()).map((b) => [b.af, b.titel]), [['rikke', 'Kursus']], "Henrik's wish is not a booking");
  assert.equal(st.udkast.length, 0, 'a clash is the card, not a second one');
  for (const p of [HENRIK, RIKKE]) {
    const h = await a.side(p);
    assert.match(h, /data-blok="beslutning" data-sammenfald="/);
    assert.match(h, /Rikke har kursus; den lille bil er fri\./);
  }
  assert.doesNotMatch(await a.side(MAJA), /data-sammenfald=/, 'another owner sees nothing');
  assert.match(await a.side(HENRIK, '/rum/hjem'), /Dobbeltbooket: Den store bil/);
  await ingenDobbelt(a);
});

test('the options come in the ticket order: Tag den lille bil · Spørg Rikke om at bytte · … · Drop', async () => {
  const a = await lordagMedKursus('rækkefølge');
  const s = (await a.state()).sammenfald[0]!;
  assert.deepEqual(s.valg.map((v) => [v.id, v.slags, v.hvem]), [['v1', 'anden', 'henrik'], ['v2', 'afgiv', 'rikke'], ['v3', 'anden', 'rikke'], ['v4', 'afgiv', 'henrik']]);
  const h = await a.side(HENRIK);
  raekkefoelge(h, 'Tag den lille bil', 'Spørg Rikke om at bytte', 'Drop det, Rikke beholder den');
  assert.match(h, /data-aktion="sammenfald-valg"[^>]*data-sammenfald-valg="v1"[^>]*>Tag den lille bil</, 'his own option is a direct action');
  assert.match(h, /data-aktion="sammenfald-spoerg"[^>]*data-sammenfald-valg="v2"[^>]*>Spørg Rikke om at bytte</, 'the other person\'s option is an ask');
});

test('"Tag den lille bil" books the small car for Henrik and leaves Rikke the big one', async () => {
  const a = await lordagMedKursus('lille-bil');
  const s = (await a.state()).sammenfald[0]!;
  assert.equal((await a.aktion(HENRIK, 'sammenfald-valg', { id: s.id, valg: 'v1' })).status, 202);
  assert.deepEqual((await a.kalender('lille-bil')).map((b) => [b.af, b.titel]), [['henrik', 'Indkøb']]);
  assert.deepEqual((await a.kalender()).map((b) => b.af), ['rikke']);
  assert.ok((await a.log()).some((e) => e.ejer === 'henrik' && e.fortryd?.startsWith('lokal:') && /Booket: Den lille bil/.test(e.tekst)), 'with Fortryd');
  assert.doesNotMatch(await a.side(RIKKE), /data-sammenfald=/);
  await ingenDobbelt(a);
});

test('"Spørg Rikke om at tage den lille bil" is a request to her; her yes moves her booking and books Henrik; both lines carry Fortryd and it restores', async () => {
  const a = await lordagMedKursus('bytte');
  const s = (await a.state()).sammenfald[0]!;
  assert.equal((await a.aktion(HENRIK, 'sammenfald-spoerg', { id: s.id, valg: 'v3' }, true)).status, 202);
  const f = (await a.state()).forespoergsler[0]!;
  assert.deepEqual([f.fra, f.til, f.tilstand, f.ressourceId], ['henrik', 'rikke', 'spurgt', 'stor-bil']);
  assert.match(f.titel, /tage den lille bil/);
  assert.match(await a.side(RIKKE), /Henrik har spurgt dig\./);
  assert.deepEqual((await a.kalender()).map((b) => b.af), ['rikke'], 'asking books nothing');

  assert.equal((await a.aktion(RIKKE, 'svar', { id: f.id, svar: 'ja' })).status, 202);
  const kursusId = (await a.kalender('lille-bil'))[0]!.id;
  assert.deepEqual((await a.kalender('lille-bil')).map((b) => [b.af, b.titel]), [['rikke', 'Kursus']], 'her booking moved to the small car, same booking');
  assert.deepEqual((await a.kalender()).map((b) => [b.af, b.titel, b.foresporgselId]), [['henrik', 'Indkøb', f.id]]);
  assert.equal((await a.state()).sammenfald[0]!.afgjort?.af, 'rikke');
  await ingenDobbelt(a);

  const linjer = await a.log();
  const henriks = linjer.find((e) => e.ejer === 'henrik' && e.fortryd?.startsWith('lokal:') && /Booket: Den store bil/.test(e.tekst));
  const rikkes = linjer.find((e) => e.ejer === 'rikke' && e.fortryd?.startsWith('lokal:') && /flyttet til den lille bil/.test(e.tekst));
  assert.ok(henriks && rikkes, 'the log carries a Fortryd for both');
  assert.match(await a.side(HENRIK), new RegExp(`data-fortryd="${henriks.id}"`));
  assert.doesNotMatch(await a.side(RIKKE), new RegExp(`data-fortryd="${rikkes.id}"`), 'she cannot go back while Henrik holds the big car');
  assert.equal(await a.fortryd(RIKKE, rikkes.id), 404, 'refused: nothing is displaced');
  assert.deepEqual((await a.kalender('lille-bil')).map((b) => b.id), [kursusId]);

  assert.equal(await a.fortryd(HENRIK, henriks.id), 202, 'Henrik lets go');
  assert.deepEqual(await a.kalender(), []);
  assert.match(await a.side(RIKKE), new RegExp(`data-fortryd="${rikkes.id}"`), 'now hers can go back');
  assert.equal(await a.fortryd(RIKKE, rikkes.id), 202);
  assert.deepEqual((await a.kalender()).map((b) => [b.id, b.af]), [[kursusId, 'rikke']], 'restored: her course is on the big car again');
  assert.deepEqual(await a.kalender('lille-bil'), []);
  assert.equal(await a.fortryd(RIKKE, rikkes.id), 404, 'once');
  await ingenDobbelt(a);
});

test('"Spørg Rikke om at bytte" (she lets go) books Henrik on the big car when she says yes', async () => {
  const a = await lordagMedKursus('afgiv');
  const s = (await a.state()).sammenfald[0]!;
  assert.equal((await a.aktion(HENRIK, 'sammenfald-spoerg', { id: s.id, valg: 'v2' }, true)).status, 202);
  const f = (await a.state()).forespoergsler[0]!;
  assert.equal((await a.aktion(RIKKE, 'svar', { id: f.id, svar: 'ja' })).status, 202);
  assert.deepEqual((await a.kalender()).map((b) => [b.af, b.titel]), [['henrik', 'Indkøb']]);
  assert.ok((await a.log()).some((e) => e.ejer === 'rikke' && /gav slip/.test(e.tekst)));
  await ingenDobbelt(a);
});

test('a free car: the sentence books nothing — one card, and only its blue button books', async () => {
  const a = await lavBil(rod, 'fri', { chat: booking(lordag('14:00', '16:00')) });
  assert.equal(await a.sig(HENRIK, 'Jeg skal bruge den store bil lørdag 14 til 16'), 202);
  assert.deepEqual(await a.kalender(), [], 'nothing is booked from a sentence');
  const st = await a.state();
  assert.equal(st.udkast.length, 1);
  assert.equal(st.sammenfald.length, 0);
  const h = await a.side(HENRIK);
  assert.match(h, /data-udkast="/);
  assert.match(h, /class="btn btn-primary" data-aktion="udkast-book"[^>]*>Book den store bil lørdag 7\. nov kl\. 14\.00–16\.00</);
  assert.match(await a.side(HENRIK, '/rum/hjem'), /Bekræft booking: Den store bil/, 'it waits on Nu');
  assert.doesNotMatch(await a.side(RIKKE), /data-udkast=/, 'the card is Henrik\'s');
  assert.deepEqual((await a.log()).filter((e) => /Booket/.test(e.tekst)), []);

  const u = st.udkast[0]!;
  assert.equal((await a.aktion(RIKKE, 'udkast-book', { id: u.id })).status, 404, "not Rikke's card");
  assert.equal((await a.aktion(HENRIK, 'udkast-book', { id: u.id })).status, 202);
  assert.deepEqual((await a.kalender()).map((b) => [b.af, b.titel, b.start]), [['henrik', 'Indkøb', '2026-11-07T13:00:00.000Z']]);
  assert.equal((await a.state()).udkast.length, 0, 'the card is gone');
  const linje = (await a.log()).find((e) => e.ejer === 'henrik' && e.fortryd?.startsWith('lokal:'));
  assert.ok(linje, 'the booking has Fortryd');
  assert.equal((await a.aktion(HENRIK, 'udkast-book', { id: u.id })).status, 404, 'once');
  assert.equal(await a.fortryd(HENRIK, linje.id), 202);
  assert.deepEqual(await a.kalender(), []);
  await ingenDobbelt(a);
});

test('a card clicked after someone else took the slot becomes the clash card, never a double booking', async () => {
  const a = await lavBil(rod, 'indhentet', { chat: booking(lordag('10:00', '15:00')) });
  assert.equal(await a.sig(HENRIK, SAETNING), 202);
  const u = (await a.state()).udkast[0]!;
  assert.equal((await kursus(a)).status, 202, 'Rikke books meanwhile');
  assert.equal((await a.aktion(HENRIK, 'udkast-book', { id: u.id })).status, 202);
  const st = await a.state();
  assert.deepEqual((await a.kalender()).map((b) => b.af), ['rikke']);
  assert.equal(st.sammenfald.length, 1);
  assert.equal(st.udkast.length, 0);
  assert.match(await a.side(RIKKE), /data-sammenfald="/);
  await ingenDobbelt(a);
});

test('Drop throws the card away and books nothing; a second Drop is a 404', async () => {
  const a = await lavBil(rod, 'drop', { chat: booking(lordag('14:00', '16:00')) });
  await a.sig(HENRIK, 'Den store bil lørdag 14 til 16');
  const u = (await a.state()).udkast[0]!;
  assert.equal((await a.aktion(RIKKE, 'udkast-drop', { id: u.id })).status, 404);
  assert.equal((await a.aktion(HENRIK, 'udkast-drop', { id: u.id })).status, 202);
  assert.equal((await a.state()).udkast.length, 0);
  assert.deepEqual(await a.kalender(), []);
  assert.equal((await a.aktion(HENRIK, 'udkast-drop', { id: u.id })).status, 404);
});

test('the same wish asked twice is one card; a car Henrik holds himself gives no card', async () => {
  const a = await lavBil(rod, 'dublet', { chat: booking(lordag('14:00', '16:00')) });
  await a.sig(HENRIK, 'Den store bil lørdag 14 til 16');
  await a.sig(HENRIK, 'Den store bil lørdag 14 til 16 igen');
  assert.equal((await a.state()).udkast.length, 1);
  await a.aktion(HENRIK, 'book', { ressourceId: 'stor-bil', dag: LOERDAG, start: '14:00', slut: '16:00', titel: 'Selv' });
  await a.sig(HENRIK, 'Den store bil lørdag 15 til 17', booking(lordag('15:00', '17:00')));
  const st = await a.state();
  assert.equal(st.sammenfald.length, 0, 'a clash with your own booking is no card for two');
  assert.equal(st.udkast.length, 1, 'and no second card');
  assert.ok((await a.log()).length > 0);
  const chat = await a.store.readChat('husstand', 20);
  assert.match(chat.at(-1)!.tekst, /Jeg lagde ikke noget kort frem: Du har allerede den store bil i det tidsrum\./);
});
