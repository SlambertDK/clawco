// KC-0138: one inbound line shaped into a Besked — text cut to 500, no phone number or handle anywhere in it, the
// sender as a person from the register when one matches, else the channel's display name, else "ukendt afsender".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAKS_TEKST, tilBesked, UKENDT, type Kontakt } from '../../../src/kilder/beskeder/besked.ts';
import type { RaaBesked } from '../../../src/kilder/beskeder/jsonl.ts';

const raa = (o: Partial<RaaBesked>): RaaBesked => ({ kanal: 'whatsapp', samtale: '4512345678@s.whatsapp.net', gruppe: false, afsender: '4512345678@s.whatsapp.net', tid: '2026-11-01T08:00:00.000Z', tekst: 'Hej', ...o });
const KONTAKTER: Kontakt[] = [{ id: 'maja', navn: 'Maja', relation: 'din kone', kanaler: { whatsapp: '+45 12 34 56 78', telegram: '@maja_dk' } }, { id: 'ella', navn: 'Ella', relation: 'datter', kanaler: {} }];

test('text is cut to 500 characters', () => {
  const b = tilBesked(raa({ tekst: 'x'.repeat(900) }), { kontakter: [], zone: 'privat' });
  assert.equal(MAKS_TEKST, 500);
  assert.equal(b.tekst.length, 500);
});

test('the sender matched by number reads as the person and relation, with the person id', () => {
  const b = tilBesked(raa({}), { kontakter: KONTAKTER, zone: 'husstand' });
  assert.deepEqual(b.afsender, { navn: 'Maja (din kone)', personId: 'maja' });
  assert.equal(b.zone, 'husstand');
  assert.equal(b.kanal, 'whatsapp');
});

test('the sender matched by display name (case and accents aside) reads as the person', () => {
  const b = tilBesked(raa({ afsender: '777', afsenderNavn: 'ella' }), { kontakter: KONTAKTER, zone: 'privat' });
  assert.deepEqual(b.afsender, { navn: 'Ella (datter)', personId: 'ella' });
});

test('an unmatched sender keeps the channel display name; without one it is "ukendt afsender"', () => {
  assert.deepEqual(tilBesked(raa({ afsender: '999', afsenderNavn: 'Hr. Hansen' }), { kontakter: KONTAKTER, zone: 'privat' }).afsender, { navn: 'Hr. Hansen' });
  assert.deepEqual(tilBesked(raa({ afsender: '999' }), { kontakter: KONTAKTER, zone: 'privat' }).afsender, { navn: UKENDT });
});

test('a display name that is itself a number or handle is never shown', () => {
  assert.equal(tilBesked(raa({ afsender: '999', afsenderNavn: '+45 99 88 77 66' }), { kontakter: [], zone: 'privat' }).afsender.navn, UKENDT);
  assert.equal(tilBesked(raa({ afsender: '999', afsenderNavn: '@hansen_dk' }), { kontakter: [], zone: 'privat' }).afsender.navn, UKENDT);
});

test('no phone number, platform id or handle survives anywhere in the output', () => {
  const b = tilBesked(raa({ tekst: 'Ring på +45 12 34 56 78 eller 4512345678, eller skriv til @maja_dk', samtaleNavn: '4512345678@s.whatsapp.net' }), { kontakter: [], zone: 'privat' });
  const ud = [b.tekst, b.samtaleNavn, b.afsender.navn].join(' | ');
  assert.ok(!/\d{6,}/.test(ud.replace(/\s/g, '')), ud);
  assert.ok(!JSON.stringify(b).includes('4512345678'));
  assert.ok(!ud.includes('@maja_dk'));
  assert.ok(!ud.includes('whatsapp.net'));
  assert.match(b.samtaleId, /^s-[0-9a-f]{12}$/);
  assert.equal(b.samtaleNavn, 'Samtale på WhatsApp');
});

test('attachments are names and types only; the id is stable for the same line', () => {
  const r = raa({ vedhaeftning: [{ navn: 'skema.pdf', type: 'application/pdf' }] });
  const a = tilBesked(r, { kontakter: [], zone: 'privat' });
  assert.deepEqual(a.vedhaeftning, [{ navn: 'skema.pdf', type: 'application/pdf' }]);
  assert.equal(a.id, tilBesked(r, { kontakter: [], zone: 'privat' }).id);
  assert.match(a.id ?? '', /^b-[0-9a-f]{16}$/);
  assert.equal(a.laest, false);
});

// KC-0225: the id the register holds per channel names the sender, also when the channel gives no display name.

test('KC-0225: a sender known only by the id on the channel reads as the person; without it, "ukendt afsender"', () => {
  const b = tilBesked(raa({}), { kontakter: KONTAKTER, zone: 'privat' }); // no afsenderNavn at all
  assert.deepEqual(b.afsender, { navn: 'Maja (din kone)', personId: 'maja' });
  assert.equal(b.samtaleNavn, 'Maja');
  const tg = tilBesked(raa({ kanal: 'telegram', samtale: '-100', gruppe: true, afsender: '@MAJA_dk' }), { kontakter: KONTAKTER, zone: 'privat' });
  assert.deepEqual(tg.afsender, { navn: 'Maja (din kone)', personId: 'maja' });
  assert.deepEqual(tilBesked(raa({ afsender: '4599999999' }), { kontakter: KONTAKTER, zone: 'privat' }).afsender, { navn: UKENDT });
  // the Signal id of Maja is not on WhatsApp: another channel's id never matches
  assert.deepEqual(tilBesked(raa({ kanal: 'signal', afsender: '+4512345678' }), { kontakter: KONTAKTER, zone: 'privat' }).afsender, { navn: UKENDT });
});

test('KC-0225: the id wins over a display name that points at someone else; a lone display name still works without an id match', () => {
  const b = tilBesked(raa({ afsenderNavn: 'Ella' }), { kontakter: KONTAKTER, zone: 'privat' });
  assert.equal(b.afsender.navn, 'Maja (din kone)');
});

test('KC-0225: the number or handle the person is known by is nowhere in the output', () => {
  const b = tilBesked(raa({ tekst: 'Det er mig på +45 12 34 56 78 / @maja_dk / 12345678' }), { kontakter: KONTAKTER, zone: 'privat' });
  const alt = JSON.stringify(b);
  assert.ok(!alt.includes('4512345678') && !alt.includes('12345678') && !alt.includes('12 34 56 78') && !alt.includes('@maja_dk'), alt);
});
