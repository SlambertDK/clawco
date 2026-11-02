// KC-0148: the household room's HTML — who is in it and what, and the shared
// week with whose each entry is. Pure; everything escaped (§4 r9); never a
// login or a phone number on screen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHusstand, renderIkkeHer } from '../../src/hushold/render.ts';
import type { Medlem } from '../../src/hushold/schema.ts';
import type { FaellesDag } from '../../src/hushold/uge.ts';
import type { Person } from '../../src/identitet/husstand.ts';

const NU = new Date('2026-11-02T08:00:00Z');
const HENRIK: Person = { id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' };
const MEDLEMMER: Medlem[] = [
  { id: 'henrik', navn: 'Henrik', rolle: 'ejer', tailnetLogin: 'henrik@example.com' },
  { id: 'maja', navn: 'Maja <b>', rolle: 'medlem', relation: 'din kone', telefon: '+45 12345678', tailnetLogin: 'maja@example.com' },
  { id: 'farmor', navn: 'Farmor', rolle: 'gaest' },
];
const UGE: FaellesDag[] = [
  { dato: '2026-11-02', poster: [] },
  { dato: '2026-11-03', poster: [
    { id: 'h', titel: 'Farmor på besøg', start: '2026-11-03', slut: '2026-11-04', heldag: true, hvem: [], kilde: 'kalender' },
    { id: 'x', titel: '<script>alert(1)</script>', start: '2026-11-03T16:30:00+01:00', slut: '2026-11-03T17:30:00+01:00', heldag: false, hvem: ['maja', 'henrik'], kilde: 'kalender' },
  ] },
];

test('members: one row each with role; the viewer is Du; relation shown, never login or telefon', () => {
  const h = String(renderHusstand({ medlemmer: MEDLEMMER, person: HENRIK, uge: UGE, now: NU }));
  assert.match(h, /<h1>Husstanden<\/h1>/);
  for (const r of ['ejer', 'medlem', 'gaest']) assert.match(h, new RegExp(`data-medlem-rolle="${r}"`));
  assert.match(h, /data-medlem="henrik"[^>]*>[\s\S]*?Du/);
  assert.match(h, /din kone/);
  assert.match(h, /gæst/);
  assert.doesNotMatch(h, /12345678|example\.com/);
  assert.match(h, /data-blok="bunke"/);
});

test('the week: only days with entries, all-day as "hele dagen", whose each entry is, "Alle" when it is everyone', () => {
  const h = String(renderHusstand({ medlemmer: MEDLEMMER, person: HENRIK, uge: UGE, now: NU }));
  assert.match(h, /data-husstand-uge/);
  assert.match(h, /data-datazone="husstand"/);
  assert.match(h, /hele dagen/);
  assert.match(h, /16\.30/);
  assert.match(h, /Alle/);
  assert.match(h, /Maja &lt;b&gt; og Du|Maja &lt;b&gt;, Du/);
  assert.match(h, /data-uge-hvem="maja henrik"/);
  assert.match(h, /data-uge-hvem="alle"/);
  assert.equal((h.match(/class="row faelles-dag"/g) ?? []).length, 1, 'the empty Monday is not shown');
});

test('hostile text is escaped', () => {
  const h = String(renderHusstand({ medlemmer: MEDLEMMER, person: HENRIK, uge: UGE, now: NU }));
  assert.doesNotMatch(h, /<script>|<b>/);
  assert.match(h, /&lt;script&gt;/);
});

test('an empty week says so in one line', () => {
  const h = String(renderHusstand({ medlemmer: MEDLEMMER, person: HENRIK, uge: [{ dato: '2026-11-02', poster: [] }], now: NU }));
  assert.match(h, /Intet fælles i den kommende uge/);
});

test('renderIkkeHer names nobody', () => {
  const h = String(renderIkkeHer());
  assert.match(h, /Husstanden/);
  assert.doesNotMatch(h, /Henrik|Maja/);
});
