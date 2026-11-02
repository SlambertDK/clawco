// KC-0170 slice 2: the screen of Mail in English or Danish. Danish (no language chosen, or da chosen) renders byte for
// byte as before (test/fixtures/sprog-mail/, captured before the strings moved); English has no Danish word left in
// what the room itself says.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAIL_TEKSTER, mailTekst } from '../../src/rooms/mail/tekster.ts';
import { mailRoom } from '../../src/rooms/mail/room.ts';
import { medSprog } from '../../src/shell/tekster.ts';
import type { RoomDeps } from '../../src/rooms/module.ts';
import type { MailState } from '../../src/rooms/mail/schema.ts';
import { MAIL, MAIL_NU } from '../fixtures/sprog-golden-mail.ts';
import { form, tomme, ensStrenge, danskeLinjer } from '../fixtures/sprog-tjek.ts';

const rod = path.dirname(fileURLToPath(import.meta.url));
const fixtur = (navn: string): string => readFileSync(path.join(rod, '../fixtures/sprog-mail', navn), 'utf8');
const tabel = (t: unknown): Record<string, unknown> => t as Record<string, unknown>;

/** Strings that are the same in both languages on purpose (a name, or a word English borrows). */
const ENS = new Set(['rum', 'send']);

/** One phrase the room does not own and that stays Danish until the voice's slice (D10): the data-sig attribute, the spoken passage (src/rooms/mail/stemme.ts). Left out of the check. */
const udenAndres = (doc: string): string => doc.replace(/\sdata-sig="[^"]*"/g, '');
// The reason of a line for what Clawco never does comes from src/graenser/afgoer.ts, Danish for now.
const dansk = (doc: string): string[] => danskeLinjer(udenAndres(doc)).filter((l) => !/betaler aldrig/.test(l));

test('English has exactly Danish\'s keys and shapes; no string is empty; no Danish string copied over', () => {
  assert.deepEqual(form(MAIL_TEKSTER.en), form(MAIL_TEKSTER.da));
  for (const t of [MAIL_TEKSTER.da, MAIL_TEKSTER.en]) assert.deepEqual(tomme(tabel(t)), []);
  assert.deepEqual(ensStrenge(tabel(MAIL_TEKSTER.da), tabel(MAIL_TEKSTER.en)).filter((k) => !ENS.has(k)), []);
});

test('Henrik\'s installation: with no language chosen Mail renders byte for byte as before', () => {
  // One difference is allowed, as in slice 1: an apostrophe that was literal markup now comes through the escaper as
  // &#39;, which the browser shows as the same character.
  const samme = (s: string): string => s.replaceAll('&#39;', "'");
  const filer = readdirSync(path.join(rod, '../fixtures/sprog-mail')).sort();
  assert.deepEqual(Object.keys(MAIL).map((k) => `mail-${k}.html`).sort(), filer, 'every golden has a case');
  for (const [k, lav] of Object.entries(MAIL)) {
    assert.equal(samme(lav()), samme(fixtur(`mail-${k}.html`)), k);
    assert.equal(samme(medSprog('da', lav)), samme(fixtur(`mail-${k}.html`)), `${k} (da chosen)`);
  }
});

test('the Danish detector works: the Danish full screen is full of Danish lines', () => {
  assert.ok(dansk(MAIL['fuld']!()).length > 10, String(dansk(MAIL['fuld']!()).length));
});

test('English: Mail has no Danish word in what the room says, in any of its screens', () => {
  for (const [k, lav] of Object.entries(MAIL)) assert.deepEqual(dansk(medSprog('en', lav)), [], k);
});

test('English: the full screen reads as English chrome', () => {
  const doc = medSprog('en', MAIL['fuld']!);
  for (const re of [
    /<h1>Mail<\/h1>/, /Waiting for your decision/, /Needs a reply · Acme Electric/, /Due 2026-10-31/, />Save as draft</, />Copy</, />Done</,
    /data-confirm="Send the reply to Acme Electric now\?"/, /Your reply \(Hermes(?:'|&#39;) draft, edit as you like\)/, /Sent → Afventer/, /Decided/,
    /Sorted by Hermes today/, /Show all 10/, /Hermes(?:'|&#39;) work in the room/, />Undo</, /Undone at 07:55/, /Refresh/, /26 Oct/,
    /Done with the 2 for your information/, /data-element="Count: 5 in Handling"/, /data-element="Mail: Quote for the panel"/,
  ]) assert.match(doc, re);
  assert.match(medSprog('en', MAIL['forbindelse']!), /The inbox in me@example\.com\. Done moves the mail to the archive\./);
  assert.match(medSprog('en', MAIL['laeseKun']!), /Unread and flagged mails in me@example\.com\. Clawco can only read it/);
  const tomt = medSprog('en', MAIL['rumTomt']!);
  for (const re of [/Not fetched yet/, /The room is empty/, /Nothing read yet\./, /Ask Hermes to read Handling/]) assert.match(tomt, re);
});

test('English: the read-only tile and the connection tile say what they count', () => {
  assert.match(medSprog('en', MAIL['laeseKun']!), /unread or flagged/);
  assert.match(medSprog('en', MAIL['forbindelse']!), /in the inbox/);
});

// ---- Nu: the lines the room reports -----------------------------------------------------------------------------------

const state: MailState = {
  dato: '2026-10-27', genereret: MAIL_NU.toISOString(), tal: { handling: 1, afventer: 0, regninger: 0, sorteretIDag: 0 },
  beslutninger: [{ mailId: '1', emne: 'Quote for the panel', fra: 'Acme', modtaget: '2026-10-26T18:57:39Z', type: 'svar', resume: '', betydning: 'Reply.', arkivmappe: 'Archive', muligheder: [] }],
  ordnet: [], hermesStatus: 'Watching',
};
const deps = (s: MailState | null): RoomDeps => ({
  store: { readState: async () => s, readLog: async () => [] },
  person: { id: 'o', login: null, navn: 'Owner', rolle: 'ejer' },
  now: () => MAIL_NU, runs: { igang: () => [] },
}) as unknown as RoomDeps;

test('Nu: Mail\'s line says "Mail: …" and is Danish with no language chosen, English when en', async () => {
  assert.deepEqual(await mailRoom.hjemVenter(deps(state)), [{ roomId: 'mail', tekst: 'Mail: Quote for the panel' }]);
  assert.equal(mailTekst().nuLinje('x'), 'Mail: x');
  assert.deepEqual(await medSprog('en', () => mailRoom.hjemVenter(deps(state))), [{ roomId: 'mail', tekst: 'Mail: Quote for the panel' }]);
});

test('the room view\'s empty state says why in the chosen language', async () => {
  const da = String((await mailRoom.view(deps(null))).main);
  assert.match(da, /Ikke hentet endnu\./);
  const en = String((await medSprog('en', () => mailRoom.view(deps(null)))).main);
  assert.match(en, /Not fetched yet\./);
  assert.deepEqual(dansk(en), []);
});
