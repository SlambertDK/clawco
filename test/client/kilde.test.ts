// KC-0128: a Start connect card posts to /api/kilder/:id/forbind. The pure parts:
// the form's fields become { felter, zone }, and the answer says where to go next.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../public/kilde.js';

type Kilde = { krop(par: [string, string][]): { felter: Record<string, string>; zone?: string }; naeste(svar: { omdiriger?: string }, efter: string | null, her: string): string };
const KC = (globalThis as unknown as { KCKilde: Kilde }).KCKilde;

test('the form becomes the card\'s fields plus the chosen zone', () => {
  assert.deepEqual(KC.krop([['brugernavn', 'alma'], ['adgangskode', 'x'], ['zone', 'arbejde']]), { felter: { brugernavn: 'alma', adgangskode: 'x' }, zone: 'arbejde' });
  assert.deepEqual(KC.krop([]), { felter: {} });
});

test('a login goes to the provider; otherwise the card\'s destination (Nu for the first source), else the page again', () => {
  assert.equal(KC.naeste({ omdiriger: '/api/kilder/falsk-kalender/tilbage?state=s&code=c' }, '/rum/hjem', '/rum/start'), '/api/kilder/falsk-kalender/tilbage?state=s&code=c');
  assert.equal(KC.naeste({}, '/rum/hjem', '/rum/start'), '/rum/hjem');
  assert.equal(KC.naeste({}, null, '/rum/start'), '/rum/start');
});

test('only an http(s) or same-origin path is followed', () => {
  assert.equal(KC.naeste({ omdiriger: 'javascript:alert(1)' }, null, '/rum/start'), '/rum/start');
  assert.equal(KC.naeste({ omdiriger: 'https://accounts.example.org/o?x=1' }, null, '/rum/start'), 'https://accounts.example.org/o?x=1');
  assert.equal(KC.naeste({}, '//ond.example', '/rum/start'), '/rum/start');
});
