// KC-0137: the connect card draws a file field, a several-lines field and an ordinary one; a hidden
// option (a stored feed list) is never drawn.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kildeIndhold } from '../../../src/rooms/start/kilderender.ts';
import type { KildeKortSyn } from '../../../src/rooms/module.ts';

const kort: KildeKortSyn = {
  id: 'nyheder-rss', navn: 'Nyhedskilder', slags: 'nyheder', zone: 'privat', forbundet: false, helbred: null,
  kort: {
    titel: 'Nyhedskilder', tekst: 'Indsæt en adresse.', handling: 'Tilføj',
    felter: [
      { navn: 'adresser', etiket: 'Adresser', type: 'tekst', flere: true, paakraevet: false, maks: 4000 },
      { navn: 'opml', etiket: 'OPML-fil', type: 'fil', paakraevet: false, maks: 1000000 },
      { navn: 'feeds', etiket: 'Feeds', type: 'tekst', skjult: true, paakraevet: false, maks: 30000 },
      { navn: 'navn', etiket: 'Navn', type: 'tekst', paakraevet: false },
    ],
  },
};

test('a several-lines field is a textarea, a file field a file input, a hidden field is not drawn', () => {
  const html = String(kildeIndhold('flere-kilder', 'ikke-startet', { kort: [kort], forhaandsvisninger: [], flere: ['nyheder-rss'], kanForbinde: true }, new Date('2026-11-01T08:00:00Z')));
  assert.match(html, /<textarea name="adresser"[^>]*maxlength="4000"/);
  assert.match(html, /<input name="opml" type="file"[^>]*accept="[^"]*opml[^"]*"/);
  assert.match(html, /<input name="navn" type="text"/);
  assert.ok(!html.includes('name="feeds"'), 'the hidden option is not on the card');
});
