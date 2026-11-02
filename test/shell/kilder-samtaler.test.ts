// KC-0224: Beskeder, once connected, lists every conversation Hermes can see in the Kø panel's "Kilder", with one
// checkbox each (checked = Clawco reads it). Owner only; names are text, escaped. Same markup conventions as KC-0222's list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderKilder, type KildeVisning } from '../../src/shell/kilder.ts';
import { medSprog } from '../../src/shell/tekster.ts';

const NU = new Date('2026-11-02T10:00:00Z');
const MAJA = 's-aaaaaaaaaaaa';
const GRILL = 's-bbbbbbbbbbbb';
const beskeder = (o: Partial<KildeVisning> = {}): KildeVisning => ({
  id: 'beskeder', navn: 'Beskeder', slags: 'beskeder', auth: 'bridge', zone: 'privat', forbundet: true, helbred: { status: 'ok' }, sidstLaest: null,
  samtaler: [
    { noegle: MAJA, navn: 'Ella', kanal: 'Signal', gruppe: false, valgt: true, zone: 'husstand' },
    { noegle: GRILL, navn: 'Vejens grillaften', kanal: 'Telegram', gruppe: true, valgt: false },
  ], ...o,
});
const ejer = (liste: KildeVisning[]): string => String(renderKilder(liste, { nu: NU, maaFrakoble: true }));

test('the list: collapsed, "n valgt af m", one row per conversation with a checkbox that is checked only for the chosen', () => {
  const h = ejer([beskeder()]);
  assert.match(h, /<details class="kilde-feeds" data-kilde-samtaler="beskeder">/);
  assert.match(h, /<summary[^>]*>Samtaler \(1 valgt af 2\)<\/summary>/);
  assert.doesNotMatch(h, /<details[^>]*\bopen\b/);
  assert.equal((h.match(/data-kilde-samtale="/g) ?? []).length, 2);
  assert.match(h, new RegExp(`data-kilde-samtale="${MAJA}"[\\s\\S]*?Ella[\\s\\S]*?<input type="checkbox"[^>]*data-kilde-samtale-valg="${MAJA}"[^>]* checked`));
  const grill = new RegExp(`data-kilde-samtale="${GRILL}"[\\s\\S]*?Vejens grillaften[\\s\\S]*?<input type="checkbox"[^>]*data-kilde-samtale-valg="${GRILL}"[^>]*>`).exec(h);
  assert.ok(grill, 'the group has its checkbox');
  assert.doesNotMatch(grill[0].slice(grill[0].indexOf('<input')), /checked/, 'a conversation not chosen is not checked');
  assert.match(h, new RegExp(`data-kilde-samtale="${MAJA}"[^>]*data-valgt="ja"`));
  assert.match(h, new RegExp(`data-kilde-samtale="${GRILL}"[^>]*data-valgt="nej"`));
  assert.ok(h.indexOf('data-kilde="beskeder"') < h.indexOf('data-kilde-samtaler="beskeder"'), 'the list follows the source\'s row');
  assert.match(h, /<p class="row-note" data-kilde-samtale-fejl hidden><\/p>/, 'a place for the plain sentence a refusal gets');
});

test('each row says channel and kind, and the zone it is read in when chosen, "læses ikke" when not', () => {
  const h = ejer([beskeder()]);
  assert.match(h, /Signal · samtale · Husstand/);
  assert.match(h, /Telegram · gruppe · læses ikke/);
  assert.match(h, /Clawco læser kun de samtaler, du vælger/);
  assert.match(h, /slettes dens beskeder hos Clawco/);
});

test('only the owner sees the list; a source without one, not connected, or with no conversations shows none', () => {
  assert.doesNotMatch(String(renderKilder([beskeder()], { nu: NU, maaFrakoble: false })), /data-kilde-samtale/);
  const { samtaler: _uden, ...udenListe } = beskeder();
  assert.doesNotMatch(ejer([udenListe]), /data-kilde-samtale/);
  assert.doesNotMatch(ejer([beskeder({ forbundet: false, helbred: null })]), /data-kilde-samtale/);
  assert.doesNotMatch(ejer([beskeder({ samtaler: [] })]), /data-kilde-samtale/);
});

test('conversation names are text: markup in a name is escaped everywhere', () => {
  const h = ejer([beskeder({ samtaler: [{ noegle: MAJA, navn: '<img src=x onerror=alert(1)>', kanal: 'Signal', gruppe: false, valgt: true, zone: 'privat' }, { noegle: GRILL, navn: '"><script>x</script>', kanal: 'Telegram', gruppe: true, valgt: false }] })]);
  assert.doesNotMatch(h, /<img|<script/);
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('in English the words are English, and the markers are the same', () => {
  const h = medSprog('en', () => ejer([beskeder()]));
  assert.match(h, /Conversations \(1 chosen of 2\)/);
  assert.match(h, /Signal · conversation · Household/);
  assert.match(h, /Telegram · group · not read/);
  assert.match(h, new RegExp(`data-kilde-samtale-valg="${MAJA}"`));
});
