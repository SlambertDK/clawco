// KC-0139: the card a failing connection gets in Nu. One element per source with the
// stable id kilde-helbred-<id>; its words come from the fixed table (per state and per
// auth kind), never from the provider; every text is escaped; nothing when ok.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genforbindFelter, kortTekst } from '../../src/kilder/helbred-tekst.ts';
import { kildeHelbredElementer, type KildeHelbredKort } from '../../src/shell/kilde-helbred.ts';
import type { Auth, Felt } from '../../src/kilder/types.ts';

const NU = new Date('2026-11-01T12:00:00Z');
const kort = (over: Partial<KildeHelbredKort> = {}): KildeHelbredKort => ({
  id: 'falsk-kalender', navn: 'Falsk kalender', slags: 'kalender', auth: 'oauth', vist: 'log-ind-igen', zone: 'privat', felter: [], kanForbinde: true,
  sidstLaest: '2026-11-01T06:05:00Z', ...over,
});

test('the id is stable and there is one element per source', () => {
  const e = kildeHelbredElementer([kort(), kort({ id: 'falsk-mail', navn: 'Falsk mail', slags: 'mail', auth: 'bridge', vist: 'nede' })], NU);
  assert.deepEqual(e.map((x) => x.id), ['kilde-helbred-falsk-kalender', 'kilde-helbred-falsk-mail']);
  assert.deepEqual(kildeHelbredElementer([kort()], NU).map((x) => x.id), ['kilde-helbred-falsk-kalender'], 'the same input gives the same id');
});

test('the same source twice is still one card (deduped)', () => {
  assert.equal(kildeHelbredElementer([kort(), kort()], NU).length, 1);
});

test('no sources, no cards', () => {
  assert.deepEqual(kildeHelbredElementer([], NU), []);
});

test('the words per state and auth kind come from the table', () => {
  const t = kortTekst('log-ind-igen', 'oauth', 'kalender');
  assert.equal(t.titel, 'Din kalender er logget ud');
  assert.equal(t.knap, 'Log ind igen');
  assert.equal(kortTekst('log-ind-igen', 'apikey', 'beskeder').knap, 'Indtast adgangskoden igen');
  assert.equal(kortTekst('log-ind-igen', 'bridge', 'mail').knap, 'Indtast adgangskoden igen');
  assert.equal(kortTekst('nede', 'local', 'noter').knap, 'Vælg mappen igen');
  assert.match(kortTekst('nede', 'local', 'noter').titel, /dine noter/);
  assert.match(kortTekst('nede', 'oauth', 'kalender').titel, /svarer ikke/);
  assert.match(kortTekst('snart-udloebet', 'oauth', 'kalender').titel, /udløber snart/);
  const alle: Auth[] = ['oauth', 'apikey', 'local', 'bridge'];
  for (const vist of ['snart-udloebet', 'log-ind-igen', 'nede'] as const) for (const a of alle) {
    const x = kortTekst(vist, a, 'mail');
    assert.ok(x.titel && x.tekst && x.knap, `${vist}/${a} has all three texts`);
  }
});

test('KC-0235: a calendar kept by a private link (Aula) speaks of the link, never of a password', () => {
  const t = kortTekst('log-ind-igen', 'apikey', 'kalender');
  assert.equal(t.titel, 'Kalenderlinket virker ikke længere');
  assert.match(t.tekst, /nyt kalenderlink i Aula/);
  assert.equal(t.knap, 'Indsæt et nyt link');
  for (const vist of ['snart-udloebet', 'log-ind-igen', 'nede'] as const) {
    const x = kortTekst(vist, 'apikey', 'kalender');
    assert.ok(x.titel && x.tekst && x.knap && !/adgangskode/i.test(`${x.titel} ${x.tekst} ${x.knap}`), vist);
  }
  assert.equal(kortTekst('log-ind-igen', 'apikey', 'beskeder').knap, 'Indtast adgangskoden igen', 'the other apikey sources keep their words');
});

test('the card shows the title, the text, the freshness and one primary button plus Fjern forbindelsen', () => {
  const h = String(kildeHelbredElementer([kort()], NU)[0]?.html);
  assert.match(h, /data-kilde-helbred="log-ind-igen"/);
  assert.match(h, /data-blok="kort"/);
  assert.match(h, /Din kalender er logget ud/);
  assert.match(h, /ikke opdateret siden 07\.05/);
  assert.equal((h.match(/btn-primary/g) ?? []).length, 1);
  assert.match(h, /btn btn-primary"[^>]*data-kilde-forbind="falsk-kalender"[^>]*>Log ind igen</);
  assert.match(h, /data-kilde-fjern="falsk-kalender"[^>]*>Fjern forbindelsen</);
});

test('a non-oauth card carries a form with the secret field to type again; stored options go along hidden', () => {
  const felter: Felt[] = [
    { navn: 'adresse', etiket: 'Din mailadresse', type: 'tekst', paakraevet: true },
    { navn: 'adgangskode', etiket: 'App-adgangskode', type: 'hemmelig', paakraevet: true },
    { navn: 'fingeraftryk', etiket: 'Fingeraftryk', type: 'tekst', paakraevet: false },
  ];
  const f = genforbindFelter(felter, { adresse: 'henrik@example.org', fingeraftryk: 'AB:CD' });
  assert.deepEqual(f.map((x) => [x.navn, x.skjult]), [['adresse', true], ['adgangskode', false]], 'the old pin is left out so a changed certificate can be trusted anew');
  const h = String(kildeHelbredElementer([kort({ id: 'imap', auth: 'bridge', slags: 'mail', navn: 'Mail', felter: f })], NU)[0]?.html);
  assert.match(h, /<input type="hidden" name="adresse" value="henrik@example\.org">/);
  assert.match(h, /<input name="adgangskode" type="password"[^>]* required/);
  assert.match(h, />Indtast adgangskoden igen</);
});

test('a folder field is shown with its stored value, a required field without a stored value is shown empty', () => {
  const f = genforbindFelter([
    { navn: 'mappe', etiket: 'Mappe', type: 'mappe', paakraevet: true },
    { navn: 'konto', etiket: 'Konto', type: 'tekst', paakraevet: true },
  ], { mappe: '/Volumes/nas/vault' });
  assert.deepEqual(f.map((x) => [x.navn, x.skjult, x.vaerdi ?? '']), [['mappe', false, '/Volumes/nas/vault'], ['konto', false, '']]);
});

test('provider text never reaches the card: only the table and escaped names do', () => {
  const ond = '<img src=x onerror=alert(1)>';
  const h = String(kildeHelbredElementer([kort({ navn: ond, felter: genforbindFelter([{ navn: 'a', etiket: ond, type: 'tekst', paakraevet: true }], { a: ond }) })], NU)[0]?.html);
  assert.doesNotMatch(h, /<img/);
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(h, /onerror=alert\(1\)>(?!&)/);
});

test('a person who may not connect sees the card without buttons or form', () => {
  const h = String(kildeHelbredElementer([kort({ kanForbinde: false })], NU)[0]?.html);
  assert.match(h, /Din kalender er logget ud/);
  assert.doesNotMatch(h, /<button|<form|data-kilde-forbind/);
  assert.match(h, /Ejeren/);
});

test('snart-udloebet says when it ends', () => {
  const h = String(kildeHelbredElementer([kort({ vist: 'snart-udloebet', udloeber: '2026-11-02T20:00:00Z' })], NU)[0]?.html);
  assert.match(h, /data-kilde-helbred="snart-udloebet"/);
  assert.match(h, /Udløber i morgen 21\.00/);
  assert.match(h, /Sidst hentet 07\.05/, 'a source that still works has fresh data');
  assert.doesNotMatch(h, /ikke opdateret/);
});
