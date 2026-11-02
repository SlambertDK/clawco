import { test } from 'node:test';
import assert from 'node:assert/strict';
import { naesteLinje, omTekst, udenMail } from '../../src/shell/naeste.ts';

// KC-0088: "Næste: Havvind Nord kl. 14.00 · om 3 t 50 min" at the top of Hjem.
const MIN = 60_000;
const t = (iso: string): number => Date.parse(iso);
const NU = new Date('2026-10-30T09:10:00Z'); // 10.10 in Copenhagen (CET)

test('omTekst: minutes under an hour, hours and minutes above, whole hours without minutes', () => {
  const nu = t('2026-10-30T09:10:00Z');
  assert.equal(omTekst(nu + 25 * MIN, undefined, nu), 'om 25 min');
  assert.equal(omTekst(nu + 60 * MIN, undefined, nu), 'om 1 t');
  assert.equal(omTekst(nu + 230 * MIN, undefined, nu), 'om 3 t 50 min');
  assert.equal(omTekst(nu + 180 * MIN, undefined, nu), 'om 3 t');
});

test('omTekst: seconds count as the minute they are still part of, never "om 0 min"', () => {
  const nu = t('2026-10-30T09:10:00Z');
  assert.equal(omTekst(nu + 1_000, undefined, nu), 'om 1 min');
  assert.equal(omTekst(nu + 60_000, undefined, nu), 'om 1 min');
  assert.equal(omTekst(nu + 61_000, undefined, nu), 'om 2 min');
});

test('omTekst: "nu" from the start until the end; null once it is over', () => {
  const start = t('2026-10-30T10:00:00Z');
  const slut = t('2026-10-30T11:00:00Z');
  assert.equal(omTekst(start, slut, start), 'nu');
  assert.equal(omTekst(start, slut, slut - 1), 'nu');
  assert.equal(omTekst(start, slut, slut), null);
});

test('omTekst: an appointment without an end is over the moment it starts', () => {
  const start = t('2026-10-30T10:00:00Z');
  assert.equal(omTekst(start, undefined, start), null);
  assert.equal(omTekst(start, undefined, start + MIN), null);
});

test('naesteLinje shows title, Copenhagen start time and the countdown', () => {
  const out = String(naesteLinje({ titel: 'Havvind Nord', start: '2026-10-30T13:00:00Z', slut: '2026-10-30T14:00:00Z' }, NU)); // 14.00 CET
  assert.match(out, /^<p class="naeste" data-naeste data-start="1793365200000" data-slut="1793368800000">/);
  assert.match(out, /Næste: <span class="naeste-titel">Havvind Nord<\/span> kl\. 14\.00 · <span class="naeste-om">om 3 t 50 min<\/span>/);
});

test('naesteLinje says "nu" while it runs and renders nothing once it is over', () => {
  const koerer = String(naesteLinje({ titel: 'Møde', start: '2026-10-30T09:00:00Z', slut: '2026-10-30T10:00:00Z' }, NU));
  assert.match(koerer, /kl\. 10\.00 · <span class="naeste-om">nu<\/span>/);
  assert.equal(String(naesteLinje({ titel: 'Møde', start: '2026-10-30T07:00:00Z', slut: '2026-10-30T08:00:00Z' }, NU)), '');
});

test('naesteLinje escapes the title and never shows an e-mail address', () => {
  const out = String(naesteLinje({ titel: '<b>Møde</b> med clara.holm@example.com', start: '2026-10-30T13:00:00Z' }, NU));
  assert.doesNotMatch(out, /<b>/);
  assert.doesNotMatch(out, /@/);
  assert.match(out, /&lt;b&gt;Møde&lt;\/b&gt; med/);
});

test('naesteLinje ignores an unreadable start', () => {
  assert.equal(String(naesteLinje({ titel: 'Møde', start: 'i morgen' }, NU)), '');
});

test('udenMail strips address-like words and keeps the rest', () => {
  assert.equal(udenMail('Møde med Clara (clara@x.example) og Jonas'), 'Møde med Clara og Jonas');
  assert.equal(udenMail('Havvind Nord'), 'Havvind Nord');
});
