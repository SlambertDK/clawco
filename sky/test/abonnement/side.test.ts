// KC-0195: the "Abonnement" page as a pure render — one state per subscription status (trial, active, cancelling,
// paused, past due), the invoice list (the last 12, newest first, a link to Stripe's hosted page each, zero invoices,
// Stripe unreachable), the member's read-only view, and every value escaped (sky/src/delt/html.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusSide } from '../../src/abonnement/render.ts';
import { laesPriser, type Priser } from '../../src/abonnement/priser.ts';
import { INGEN, type Rettighed } from '../../src/abonnement/rettigheder.ts';
import type { Faktura } from '../../src/abonnement/stripe-klient.ts';

const priser = laesPriser();
const tekst = (t: string): string => t.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const ret = (o: Partial<Rettighed>): Rettighed => ({
  ...INGEN, kilde: 'stripe', plan: 'sky-solo', status: 'aktiv', medlemmerMax: 1, abonnement: 'sub_1',
  proeveSlutter: null, periodeSlutter: '2026-12-14T10:00:00.000Z', ...o,
});

const side = (r: Rettighed, o: Partial<Parameters<typeof statusSide>[0]> = {}, p: Priser = priser): string =>
  statusSide({ csrf: 'c', rettighed: r, priser: p, overGraense: null, portal: true, ...o });

test('trial: the plan, the trial end and what happens then; the one button to Stripe', () => {
  const t = side(ret({ status: 'proeve', proeveSlutter: '2026-11-14T10:00:00.000Z', periodeSlutter: '2026-11-14T10:00:00.000Z' }));
  assert.match(tekst(t), /Sky Solo/);
  assert.match(tekst(t), /Gratis prøve til 14\. nov\. 2026/);
  assert.match(tekst(t), /Uden et kort sættes Clawco på pause, når prøven slutter/);
  assert.doesNotMatch(tekst(t), /næste betaling/i);
  assert.equal(t.match(/action="\/api\/abonnement\/portal"/g)?.length, 1, 'one button');
  assert.match(t, /<meta name="color-scheme" content="dark">/);
});

test('active: the next charge date', () => {
  assert.match(tekst(side(ret({}))), /Aktivt · næste betaling 14\. dec\. 2026/);
});

test('cancelling: the exact end date, use until then, no next charge (invariant 2)', () => {
  const t = tekst(side(ret({ opsiges: '2026-12-14T10:00:00.000Z' })));
  assert.match(t, /Slutter 14\. dec\. 2026/);
  assert.match(t, /Du kan bruge Clawco indtil 14\. dec\. 2026\. Der trækkes ikke flere penge\./);
  assert.doesNotMatch(t, /næste betaling/i);
});

test('paused and past due say so, and past due points at the card', () => {
  assert.match(tekst(side(ret({ status: 'pause', skrivebeskyttet: true }))), /På pause: prøven er slut/);
  const f = tekst(side(ret({ status: 'forfalden', forfaldenSiden: '2026-12-14T10:00:00.000Z' })));
  assert.match(f, /Betalingen mangler siden 14\. dec\. 2026/);
  assert.match(f, /Opdatér kortet/);
});

const faktura = (i: number, o: Partial<Faktura> = {}): Faktura => ({
  id: `in_${i}`, nummer: `CLAWCO-${String(i).padStart(4, '0')}`, oprettet: new Date(Date.UTC(2026, 0, 1 + i)), beloeb: 7900, valuta: 'dkk', status: 'paid',
  url: `https://invoice.stripe.com/i/acct_x/test_${i}`, ...o,
});

test('invoices: the last 12, newest first, each with a link to Stripe\'s hosted page; drafts and non-https links are left out', () => {
  const alle = Array.from({ length: 14 }, (_, i) => faktura(i + 1));
  alle.push(faktura(20, { status: 'draft', nummer: null, url: null }));
  alle.push(faktura(19, { url: 'javascript:alert(1)', status: 'open', valuta: 'eur', beloeb: 1060 }));
  const t = side(ret({}), { fakturaer: alle });
  const numre = [...t.matchAll(/CLAWCO-(\d{4})/g)].map((m) => Number(m[1]));
  assert.equal(numre.length, 12);
  assert.deepEqual(numre, [19, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4]);
  assert.match(t, /<a href="https:\/\/invoice\.stripe\.com\/i\/acct_x\/test_14">Se faktura<\/a>/);
  assert.ok(!t.includes('javascript:'));
  assert.match(tekst(t), /79,00 kr\. · Betalt/);
  assert.match(tekst(t), /10,60 EUR · Ikke betalt/);
});

test('zero invoices and an unreachable Stripe both read plainly; no customer shows no invoice section', () => {
  assert.match(tekst(side(ret({}), { fakturaer: [] })), /Ingen fakturaer endnu/);
  assert.match(tekst(side(ret({}), { fakturaer: 'fejl' })), /Fakturaerne kan ikke hentes lige nu/);
  assert.doesNotMatch(side(ret({})), /Fakturaer/);
});

test('every value is escaped: a plan name and an invoice number with markup', () => {
  const p = structuredClone(priser);
  p.planer['sky-solo']!.navn = '<script>x</script>';
  const t = side(ret({}), { fakturaer: [faktura(1, { nummer: '<b>1</b>' })] }, p);
  assert.ok(!t.includes('<script>x'));
  assert.ok(!t.includes('<b>1</b>'));
  assert.match(t, /&lt;b&gt;1&lt;\/b&gt;/);
});

test('a member sees the plan read-only and "Spørg ejeren": no button, no invoices, no actions', () => {
  const t = side(ret({}), { laeser: true, portal: false, handlinger: [{ href: '/konto/abonnement/opsig', tekst: 'Opsig abonnement' }], fakturaer: [faktura(1)] });
  assert.match(tekst(t), /Sky Solo/);
  assert.match(tekst(t), /Spørg ejeren/);
  assert.doesNotMatch(t, /action="\/api\/abonnement\/portal"/);
  assert.doesNotMatch(t, /Opsig abonnement/);
  assert.doesNotMatch(t, /CLAWCO-0001/);
});
