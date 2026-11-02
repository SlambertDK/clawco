// KC-0222: a connected source that keeps a list of its own (the news feeds) shows that list in the Kø panel's "Kilder":
// by name with Fjern on each (not on the last one), and a field to add one by its address. Owner only; escaped.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderKilder, type KildeVisning } from '../../src/shell/kilder.ts';
import { medSprog } from '../../src/shell/tekster.ts';

const NU = new Date('2026-11-02T10:00:00Z');
const rss = (o: Partial<KildeVisning> = {}): KildeVisning => ({
  id: 'nyheder-rss', navn: 'Nyhedskilder', slags: 'nyheder', auth: 'local', zone: 'privat', forbundet: true, helbred: { status: 'ok' }, sidstLaest: null,
  feeder: [{ id: 'f-aaaaaaaaaaaa', navn: 'Kystradioen' }, { id: 'f-bbbbbbbbbbbb', navn: 'Elnyt' }], ...o,
});
const ejer = (liste: KildeVisning[]): string => String(renderKilder(liste, { nu: NU, maaFrakoble: true }));

test('the list: one row per feed by name, Fjern on each, and the field that adds one — all under the source\'s own row', () => {
  const h = ejer([rss()]);
  assert.match(h, /<details class="kilde-feeds" data-kilde-feeds="nyheder-rss">/);
  assert.match(h, /<summary[^>]*>Dine kilder \(2\)<\/summary>/);
  assert.equal((h.match(/data-kilde-feed="/g) ?? []).length, 2);
  assert.match(h, /data-kilde-feed="f-aaaaaaaaaaaa"[\s\S]*?Kystradioen[\s\S]*?data-kilde-feed-fjern="f-aaaaaaaaaaaa"[^>]*>Fjern<\/button>/);
  assert.match(h, /data-kilde-feed="f-bbbbbbbbbbbb"[\s\S]*?Elnyt[\s\S]*?data-kilde-feed-fjern="f-bbbbbbbbbbbb"/);
  assert.match(h, /<form[^>]*data-kilde-feed-tilfoej="nyheder-rss"[^>]*>[\s\S]*?<input[^>]*name="adresse"[^>]*maxlength="2000"[^>]*data-kilde-feed-adresse[\s\S]*?<button[^>]*data-kilde-feed-ny="nyheder-rss"[^>]*>Tilføj kilde<\/button>/);
  assert.ok(h.indexOf('data-kilde="nyheder-rss"') < h.indexOf('data-kilde-feeds="nyheder-rss"'), 'the list follows the source\'s row');
  assert.match(h, /<p class="row-note" data-kilde-feed-fejl hidden><\/p>/, 'a place for the plain Danish sentence a refusal gets');
});

test('the last feed has no Fjern (the connection would have nothing to read; Frakobl is for that)', () => {
  const h = ejer([rss({ feeder: [{ id: 'f-aaaaaaaaaaaa', navn: 'Kystradioen' }] })]);
  assert.match(h, /data-kilde-feed="f-aaaaaaaaaaaa"/);
  assert.doesNotMatch(h, /data-kilde-feed-fjern/);
  assert.match(h, /Dine kilder \(1\)/);
  assert.match(h, /data-kilde-feed-ny="nyheder-rss"/, 'adding is still possible');
});

test('only the owner sees the list; a source without a list of its own, or not connected, shows none', () => {
  assert.doesNotMatch(String(renderKilder([rss()], { nu: NU, maaFrakoble: false })), /data-kilde-feed|kilde-feeds/);
  const { feeder: _uden, ...udenListe } = rss();
  assert.doesNotMatch(ejer([udenListe]), /data-kilde-feed|kilde-feeds/);
  assert.doesNotMatch(ejer([rss({ forbundet: false, helbred: null })]), /data-kilde-feed|kilde-feeds/);
});

test('feed names are text: markup in a name is escaped everywhere it appears', () => {
  const h = ejer([rss({ feeder: [{ id: 'f-aaaaaaaaaaaa', navn: '<img src=x onerror=alert(1)>' }, { id: 'f-bbbbbbbbbbbb', navn: '"><script>x</script>' }] })]);
  assert.doesNotMatch(h, /<img|<script/);
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('in English the words are English, and the markers are the same', () => {
  const h = medSprog('en', () => ejer([rss()]));
  assert.match(h, /Your sources \(2\)/);
  assert.match(h, />Remove<\/button>/);
  assert.match(h, />Add source<\/button>/);
  assert.match(h, /data-kilde-feed-fjern="f-aaaaaaaaaaaa"/);
});
