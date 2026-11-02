// KC-0128: steps 3 (foerste-kilde, mandatory) and 4 (flere-kilder, optional,
// one card at a time). Klaret reads the sources themselves, never a button.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alleTrin, flereKilderKoe, trinStatus, type KildeTrin, type TrinKontekst } from '../../../src/rooms/start/trin.ts';
import { parseStartState, type StartState } from '../../../src/rooms/start/schema.ts';

const tom: StartState = { startet: '2026-10-31T08:00:00.000Z', trin: {}, afvist: {} };
const kilde = (id: string, slags: string, o: Partial<KildeTrin> = {}): KildeTrin => ({ id, navn: id, slags, forbundet: false, ...o });
const ctx = (kilder: KildeTrin[]): TrinKontekst => ({ profil: null, kilder });
const trin = (id: string) => alleTrin().find((t) => t.id === id)!;
const ALLE = [kilde('kal', 'kalender'), kilde('mail', 'mail'), kilde('noter', 'noter'), kilde('nyh', 'nyheder'), kilde('besk', 'beskeder')];
const med = (id: string, o: Partial<KildeTrin>): KildeTrin[] => ALLE.map((k) => (k.id === id ? { ...k, ...o } : k));
const vaerdi = (kildeId: string): StartState => ({ ...tom, kilder: { [kildeId]: { foersteVaerdiMs: 400, tid: tom.startet, forhaandsvisning: { kildeId, navn: kildeId, slags: 'mail', titel: '2 ulæste', linje: '', hentet: tom.startet } } } });

test('step 3 is mandatory and comes after velkommen; step 4 is optional', () => {
  const ider = alleTrin().map((t) => t.id);
  assert.ok(ider.indexOf('foerste-kilde') > ider.indexOf('velkommen'));
  assert.ok(ider.indexOf('flere-kilder') > ider.indexOf('foerste-kilde'));
  assert.equal(trin('foerste-kilde').krav, 'obligatorisk');
  assert.equal(trin('flere-kilder').krav, 'valgfri');
});

test('step 3 is Klaret iff a calendar or mail source is connected and its first read gave a value', () => {
  const t = trin('foerste-kilde');
  assert.equal(t.erKlaret(tom, ctx(ALLE)), false, 'nothing connected');
  assert.equal(t.erKlaret(tom, ctx(med('mail', { forbundet: true }))), false, 'connected, never read (or the first read failed)');
  assert.equal(t.erKlaret(vaerdi('mail'), ctx(med('mail', { forbundet: true }))), true, 'connected, first value recorded in Start');
  assert.equal(t.erKlaret(vaerdi('mail'), ctx(ALLE)), false, 'a recorded value of a source no longer connected');
  assert.equal(t.erKlaret(vaerdi('noter'), ctx(med('noter', { forbundet: true }))), false, 'notes are not a first source');
  assert.equal(t.erKlaret(vaerdi('mail'), { profil: null }), false, 'no registry: not Klaret');
});

test('step 3 reopens when the connector later disappears', () => {
  const t = trin('foerste-kilde');
  const s: StartState = { ...vaerdi('mail'), trin: { 'foerste-kilde': { status: 'klaret', tid: tom.startet } } };
  assert.equal(trinStatus(t, s, ctx(med('mail', { forbundet: true }))), 'klaret');
  assert.equal(trinStatus(t, s, ctx(ALLE)), 'i-gang', 'disconnected');
  assert.equal(trinStatus(t, s, ctx(ALLE.filter((k) => k.id !== 'mail'))), 'i-gang', 'no longer registered');
});

test('step 4 offers nothing until step 3 is Klaret, then the other of calendar/mail, notes, news, messages', () => {
  assert.deepEqual(flereKilderKoe(tom, ctx(ALLE)).map((k) => k.id), []);
  const efterMail = ctx(med('mail', { forbundet: true }));
  assert.deepEqual(flereKilderKoe(vaerdi('mail'), efterMail).map((k) => k.id), ['kal', 'noter', 'nyh', 'besk']);
  const efterKal = ctx(med('kal', { forbundet: true }));
  assert.deepEqual(flereKilderKoe(vaerdi('kal'), efterKal).map((k) => k.id), ['mail', 'noter', 'nyh', 'besk']);
});

test('step 4: a skipped or connected source leaves the pile; a second source of a connected kind is not offered', () => {
  const kilder = [...med('kal', { forbundet: true }), kilde('noter-2', 'noter')];
  const s: StartState = { ...vaerdi('kal'), sprunget: { mail: tom.startet } };
  assert.deepEqual(flereKilderKoe(s, ctx(kilder)).map((k) => k.id), ['noter', 'noter-2', 'nyh', 'besk']);
  const noterForbundet = kilder.map((k) => (k.id === 'noter' ? { ...k, forbundet: true } : k));
  assert.deepEqual(flereKilderKoe(s, ctx(noterForbundet)).map((k) => k.id), ['nyh', 'besk']);
});

test('step 4 is Klaret when the pile is empty and a source beyond the first is connected', () => {
  const t = trin('flere-kilder');
  const s: StartState = { ...vaerdi('kal'), sprunget: { noter: tom.startet, nyh: tom.startet, besk: tom.startet } };
  assert.equal(t.erKlaret(s, ctx(med('kal', { forbundet: true }))), false, 'mail still offered');
  const begge = ALLE.map((k) => (k.id === 'kal' || k.id === 'mail' ? { ...k, forbundet: true } : k));
  assert.equal(t.erKlaret(s, ctx(begge)), true);
  assert.equal(t.erKlaret({ ...s, sprunget: { ...s.sprunget, mail: tom.startet } }, ctx(med('kal', { forbundet: true }))), false, 'everything skipped: not Klaret');
});

test('the state keeps first values and skipped sources, and drops what is malformed', () => {
  const s = parseStartState({ ...vaerdi('mail'), sprunget: { noter: tom.startet, 'Ond Id': tom.startet, x: 'ikke en tid' }, kilder: { ...vaerdi('mail').kilder, ond: { foersteVaerdiMs: 'nej' } } });
  assert.deepEqual(Object.keys(s?.sprunget ?? {}), ['noter']);
  assert.deepEqual(Object.keys(s?.kilder ?? {}), ['mail']);
  assert.equal(s?.kilder?.['mail']?.foersteVaerdiMs, 400);
  assert.equal(s?.kilder?.['mail']?.forhaandsvisning.titel, '2 ulæste');
});
