// KC-0170 slice 3 (part B): the connector tables. English has exactly Danish's keys and shapes, no string is empty, no
// Danish string was copied over, and no English string holds a Danish word. The functions are called with the same
// sample arguments in both languages (a function that answers the same words in both was copied, too).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KILDER_TEKSTER } from '../../src/kilder/tekster.ts';
import { GOOGLE_TEKSTER } from '../../src/kilder/google/tekster.ts';
import { GOOGLE_KALENDER_TEKSTER } from '../../src/kilder/google-kalender/tekster.ts';
import { GMAIL_TEKSTER } from '../../src/kilder/mail-gmail/tekster.ts';
import { IMAP_TEKSTER } from '../../src/kilder/mail-imap/tekster.ts';
import { RSS_TEKSTER } from '../../src/kilder/nyheder-rss/tekster.ts';
import { NOTER_TEKSTER } from '../../src/kilder/noter/tekster.ts';
import { BESKEDER_TEKSTER } from '../../src/kilder/beskeder/tekster.ts';
import { AULA_TEKSTER } from '../../src/kilder/aula-kalender/tekster.ts';
import { HELBRED_TEKSTER } from '../../src/kilder/helbred-tekst.ts';
import { form, tomme, ensStrenge, DANSK } from '../fixtures/sprog-tjek.ts';

type Tabel = { da: object; en: object };

/** Strings that are the same in both languages on purpose: a name, a protocol word, a console label. */
const ENS: Record<string, string[]> = {
  kilder: ['slags.mail'], // the word is the same
  google: [],
  'google-kalender': [],
  gmail: ['loginIgenTekst', 'forbundetTekst'], // pure composition of two sentences

  imap: ['navn', 'tjenester.proton-bridge', 'tjenester.fastmail', 'tjenester.icloud', 'felt.tls', 'felt.starttls'],
  rss: ['kortListe', 'adresseFejl'], // pure composition
  noter: ['personFelt.relation'], // the word is the same
  beskeder: ['min', 'kortSamlet'], // "3 min"; a composition of three sentences
  aula: ['navn'],
  // the card functions hand the button's label (the sample argument) back as it came
  helbred: ['logIndIgen', 'nede', 'snartUdloebet'].flatMap((t) => ['oauth', 'lokal', 'kode', 'andre'].map((k) => `${t}.${k}.knap`)),
};

const TABELLER: Record<string, Tabel> = {
  kilder: KILDER_TEKSTER, google: GOOGLE_TEKSTER, 'google-kalender': GOOGLE_KALENDER_TEKSTER, gmail: GMAIL_TEKSTER, imap: IMAP_TEKSTER,
  rss: RSS_TEKSTER, noter: NOTER_TEKSTER, beskeder: BESKEDER_TEKSTER, aula: AULA_TEKSTER, helbred: HELBRED_TEKSTER,
};

/** Every string a table can say: its plain strings and what each function answers to sample arguments, with the path. */
function ord(v: unknown, sti = ''): [string, string][] {
  if (typeof v === 'string') return [[sti, v]];
  if (typeof v === 'function') return ord((v as (...a: unknown[]) => unknown)(...Array.from({ length: v.length }, (_, i) => (i === 0 ? 'Navn' : 'Ord'))), sti);
  if (typeof v === 'object' && v !== null) return Object.entries(v).flatMap(([k, x]) => ord(x, `${sti}${k}.`.replace(/^\./, '')));
  return [];
}
const tabel = (t: unknown): Record<string, unknown> => t as Record<string, unknown>;

for (const [navn, t] of Object.entries(TABELLER)) {
  test(`${navn}: English has exactly Danish's keys and shapes; no string is empty`, () => {
    assert.deepEqual(form(t.en), form(t.da));
    for (const x of [t.da, t.en]) assert.deepEqual(tomme(tabel(x)), []);
  });

  test(`${navn}: no Danish string copied over to English (the allowed ones named)`, () => {
    const da = new Map(ord(t.da));
    const kopier = ord(t.en).filter(([sti, s]) => da.get(sti) === s).map(([sti]) => sti.replace(/\.$/, ''));
    assert.deepEqual(kopier.filter((sti) => !(ENS[navn] ?? []).includes(sti)), []);
    assert.deepEqual(ensStrenge(tabel(t.da), tabel(t.en)).filter((sti) => !(ENS[navn] ?? []).includes(sti)), []);
  });

  test(`${navn}: no Danish word in English`, () => {
    // The quoted names of another product's own screens (Aula's "Ugekalender", the vault's folders, the console labels) are not Danish words of ours.
    const dansk = ord(t.en).filter(([, s]) => DANSK.test(s));
    assert.deepEqual(dansk, []);
  });
}

test('the English tables stay English where the user reads a number or a name', () => {
  assert.equal(RSS_TEKSTER.en.antal(1), '1 news source');
  assert.equal(RSS_TEKSTER.en.antal(3), '3 news sources');
  assert.equal(IMAP_TEKSTER.en.ulaeste(2), '2 unread');
  assert.equal(IMAP_TEKSTER.en.sidstLaest(1), 'Last read 1 minute ago.');
  assert.equal(IMAP_TEKSTER.en.sidstLaest(5), 'Last read 5 minutes ago.');
  assert.equal(BESKEDER_TEKSTER.en.timer(1), '1 hour');
  assert.equal(BESKEDER_TEKSTER.en.dage(3), '3 days');
  assert.equal(AULA_TEKSTER.en.opsatTekst(1), 'The Aula calendar answered: 1 appointment in the next seven days.');
});
