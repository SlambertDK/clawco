// KC-0203: the beta's two cards in Nu's Kræver dig band — the plain "lukket beta" card and the feedback card at day 3, 7
// and 14. App-driven, like the rule proposal: they show only when the server says so, and are gone once answered
// (KC-0052: not greyed out). The preview text and the prices come from one place each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hjemEgne, kraeverIder, renderHjem, type HjemData } from '../../src/rooms/hjem/render.ts';
import { medSprog } from '../../src/shell/tekster.ts';
import type { Person } from '../../src/identitet/husstand.ts';

const NOW = new Date('2026-11-04T10:00:00Z');
const henrik: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const data = (o: Partial<HjemData> = {}): HjemData => ({ hilsen: 'Goddag, Henrik', venter: [], hermes: [], now: NOW, person: henrik, ...o });
const side = (d: HjemData): string => String(renderHjem(d));
const PRISER = { solo: 79, husstand: 129 };

test('nothing from the beta without it: no card, no marker, no script hook', () => {
  const h = side(data());
  assert.doesNotMatch(h, /data-beta|lukket beta|Hvordan går det/);
});

test('the beta card: the plain sentence and one button, Forstået (the one primary)', () => {
  const h = side(data({ beta: { kort: true } }));
  assert.match(h, /data-beta-kort/);
  assert.match(h, /Det her er en lukket beta: det kan gå galt, og vi skriver til dig, før noget slutter\./);
  const kort = h.slice(h.indexOf('data-beta-kort'), h.indexOf('</article>', h.indexOf('data-beta-kort')));
  assert.equal((kort.match(/btn-primary/g) ?? []).length, 1);
  assert.match(kort, /<button type="button" class="btn btn-primary" data-beta-luk="">Forstået<\/button>/);
});

test('the day-3 card: title with the day, five rating buttons, one optional text line (max 500), a preview, Send til Henrik (primary) and Ikke nu — no pay question', () => {
  const h = side(data({ beta: { feedback: { dag: 3, priser: PRISER } } }));
  assert.match(h, /data-beta-feedback="3"/);
  assert.match(h, /Hvordan går det\? \(dag 3\)/);
  for (const n of [1, 2, 3, 4, 5]) assert.match(h, new RegExp(`<button type="button" class="btn" data-beta-vurdering="${n}" aria-pressed="false">${n}</button>`));
  assert.match(h, /Hvad drillede\?/);
  assert.match(h, /<input type="text" maxlength="500" data-beta-tekst/);
  assert.match(h, /data-beta-forhaand/);
  assert.match(h, /Sendes til Henrik: vælg en vurdering for at sende/);
  const kort = h.slice(h.indexOf('data-beta-feedback='), h.indexOf('</article>', h.indexOf('data-beta-feedback=')));
  assert.equal((kort.match(/btn-primary/g) ?? []).length, 1);
  assert.match(kort, /class="btn btn-primary" data-beta-send="3" disabled>Send til Henrik<\/button>/);
  assert.match(kort, /data-beta-ikkenu="3">Ikke nu<\/button>/);
  assert.doesNotMatch(kort, /data-beta-betale|Ville du betale/);
  assert.equal((kort.match(/<input/g) ?? []).length, 1, 'the one free-text field and nothing else');
});

test('the day-14 card asks the pay question with the prices it was given, three answers, in the preview words', () => {
  const h = side(data({ beta: { feedback: { dag: 14, priser: PRISER } } }));
  assert.match(h, /Ville du betale 79 kr \(Solo\) \/ 129 kr \(Husstand\) om måneden for det her\?/);
  for (const v of ['ja', 'maaske', 'nej']) assert.match(h, new RegExp(`data-beta-betale="${v}"`));
  assert.match(h, />Måske<\/button>/);
  // Another price file, another question: nothing is typed in the card.
  assert.match(side(data({ beta: { feedback: { dag: 14, priser: { solo: 69, husstand: 119.5 } } } })), /Ville du betale 69 kr \(Solo\) \/ 119,50 kr \(Husstand\)/);
});

test('day 14 without a readable price file: no pay question at all (a price is never invented)', () => {
  const h = side(data({ beta: { feedback: { dag: 14, priser: null } } }));
  assert.match(h, /data-beta-feedback="14"/);
  assert.doesNotMatch(h, /Ville du betale|data-beta-betale/);
});

test('the card carries the words of the preview, and the client builds the line from them', () => {
  const h = side(data({ beta: { feedback: { dag: 7, priser: PRISER } } }));
  const m = /data-beta-ord="([^"]+)"/.exec(h);
  assert.ok(m);
  const ord = JSON.parse(m![1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&')) as Record<string, string>;
  assert.deepEqual(Object.keys(ord).sort(), ['betale', 'ja', 'maaske', 'nej', 'sendes', 'vaelg', 'vurdering']);
});

test('English chosen: the card is English (no Danish left in it)', () => {
  const h = medSprog('en', () => side(data({ beta: { feedback: { dag: 14, priser: PRISER } } })));
  assert.match(h, /How is it going\? \(day 14\)/);
  assert.match(h, /Would you pay DKK 79 \(Solo\) \/ DKK 129 \(Household\) a month for this\?/);
  assert.match(h, /Send to Henrik/);
  assert.doesNotMatch(h, /Hvordan|Send til|Ikke nu|Måske|drillede/);
});

test('the cards count in the band and the nav number like any card, but never in the day count of what required the person', () => {
  const d = data({ beta: { kort: true, feedback: { dag: 3, priser: PRISER } } });
  assert.equal(hjemEgne(d), 2);
  assert.deepEqual(kraeverIder(d), [], 'the survey is not "something that required you" (KC-0147): the beta numbers must not move with it');
  assert.equal(kraeverIder(data()).length, 0);
});

test('only the owner sees them: a member gets neither card even if the server passed the data', () => {
  const maja: Person = { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' };
  assert.doesNotMatch(side(data({ person: maja, beta: { kort: true, feedback: { dag: 3, priser: PRISER } } })), /data-beta/);
});
