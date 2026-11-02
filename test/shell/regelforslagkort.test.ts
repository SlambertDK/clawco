// KC-0227: the rule-proposal card's words (src/shell/regelforslagkort.ts), moved out of Nu's table so Nu and Start draw
// one card. The same guarantees Nu's table had: English has Danish's keys, Danish is derived from the trust ladder, and
// with English chosen the card has no Danish word left.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGELFORSLAG_TEKSTER, regelforslagKort } from '../../src/shell/regelforslagkort.ts';
import { html } from '../../src/shell/html.ts';
import { medSprog } from '../../src/shell/tekster.ts';
import { TRIN } from '../../src/tillid/trin.ts';
import { lavForslag } from '../../src/tillid/forslag.ts';
import { form, tomme, ensStrenge, danskeLinjer } from '../fixtures/sprog-tjek.ts';

const tabel = (t: unknown): Record<string, unknown> => t as Record<string, unknown>;
const NU = new Date('2026-11-01T10:00:00Z');
const f = lavForslag({ titel: 'Pakkemails lægges i Pakker', tekst: 'Mails om pakker lægger jeg i mappen Pakker.', trin: 1, gaelder: { kilde: 'mail', slags: 'pakke' } }, { kort: { id: 'k1', titel: 'Pakkeshoppen' }, art: 'ikke-relevant', nu: NU });

test('English has exactly Danish\'s keys and shapes, no string is empty or copied over', () => {
  assert.deepEqual(form(REGELFORSLAG_TEKSTER.en), form(REGELFORSLAG_TEKSTER.da));
  for (const t of [REGELFORSLAG_TEKSTER.da, REGELFORSLAG_TEKSTER.en]) assert.deepEqual(tomme(tabel(t)), []);
  assert.deepEqual(ensStrenge(tabel(REGELFORSLAG_TEKSTER.da), tabel(REGELFORSLAG_TEKSTER.en)), []);
});

test('the Danish ladder is the trust ladder\'s own words: nothing is mirrored by hand', () => {
  for (const t of TRIN) {
    assert.equal(REGELFORSLAG_TEKSTER.da.trin[t.trin].navn, t.navn);
    assert.equal(REGELFORSLAG_TEKSTER.da.trin[t.trin].saetning, t.saetning);
    assert.ok(REGELFORSLAG_TEKSTER.en.trin[t.trin].navn && REGELFORSLAG_TEKSTER.en.trin[t.trin].saetning);
  }
});

test('the card follows the language being rendered, and the extra mark lands on the root tag only', () => {
  const eng = lavForslag({ titel: 'Parcel mails go to Parcels', tekst: 'Mails about parcels go in the Parcels folder.', trin: 1, gaelder: { kilde: 'mail', slags: 'parcel' } }, { kort: { id: 'k2', titel: 'Parcel shop' }, art: 'ret', nu: NU });
  assert.match(String(regelforslagKort(f)), /Ja, gør det til en regel/);
  const en = String(medSprog('en', () => regelforslagKort(eng)));
  assert.match(en, /Yes, make it a rule/);
  assert.deepEqual(danskeLinjer(en), []);
  const maerket = String(regelforslagKort(f, html` data-regelforslag-start="${f.id}"`));
  assert.equal(maerket.replace(` data-regelforslag-start="${f.id}"`, ''), String(regelforslagKort(f)));
  assert.match(maerket, /^<article[^>]* data-regelforslag-start="rf-[0-9a-f]{10}"[^>]*>/);
});
