// KC-0134: an IMAP envelope becomes exactly the envelope the himalaya path
// makes of the same mail (parseAll in src/rooms/mail/source.ts), so the Mail
// room cannot tell the two sources apart.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kuverter, tilKuvert, type ImapBesked } from '../../../src/kilder/mail-imap/parse.ts';
import { parseAll } from '../../../src/rooms/mail/source.ts';

const imap: ImapBesked[] = [
  { uid: 7, flags: new Set(['\\Seen']), envelope: { date: new Date('2026-10-30T08:15:00Z'), subject: '  Tilbud på eltavle ', messageId: '<a1@el.example>', from: [{ name: 'Elektrikeren ApS', address: 'tilbud@el.example' }] }, bodyStructure: { type: 'multipart/mixed', childNodes: [{ type: 'text/plain' }, { type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: 'tilbud.pdf' } }] } },
  { uid: 8, flags: new Set(['\\Flagged']), envelope: { date: new Date('2026-10-31T06:00:00Z'), subject: '', messageId: '<a2@x.example>', from: [{ address: 'ingen-navn@x.example' }] }, bodyStructure: { type: 'text/plain' } },
  { uid: 9, flags: new Set(), envelope: { date: new Date('2026-10-29T12:00:00Z'), from: [] }, bodyStructure: { type: 'text/html' } },
];
// The same three mails as himalaya prints them.
const himalaya = [
  { id: 7, flags: [{ iana: 'seen' }], subject: '  Tilbud på eltavle ', from: [{ name: 'Elektrikeren ApS', email: 'tilbud@el.example' }], date: '2026-10-30T08:15:00.000Z', 'has-attachment': true, 'message-id': '<a1@el.example>' },
  { id: 8, flags: [{ iana: 'flagged' }], subject: '', from: [{ email: 'ingen-navn@x.example' }], date: '2026-10-31T06:00:00.000Z', 'has-attachment': false, 'message-id': '<a2@x.example>' },
  { id: 9, flags: [], from: [], date: '2026-10-29T12:00:00.000Z', 'has-attachment': false },
];

test('kuverter: golden equality with the himalaya path (names, no subject, no-name sender, no sender, attachment, flags)', () => {
  assert.deepEqual(kuverter(imap), parseAll(himalaya));
  const [nyeste, , aeldste] = kuverter(imap);
  assert.deepEqual(nyeste, { id: '8', emne: '(uden emne)', fra: 'ingen-navn@x.example', fraEmail: 'ingen-navn@x.example', modtaget: '2026-10-31T06:00:00.000Z', laest: false, flag: true, vedhaeftning: false, messageId: '<a2@x.example>' });
  assert.equal(aeldste?.fra, '(ukendt afsender)');
});

test('kuverter: newest first, capped at 20 like the room', () => {
  const mange: ImapBesked[] = Array.from({ length: 25 }, (_, i) => ({ uid: i + 1, flags: new Set<string>(), envelope: { date: new Date(Date.UTC(2026, 9, 1 + i)), subject: `m${i + 1}` } }));
  const ud = kuverter(mange);
  assert.equal(ud.length, 20);
  assert.equal(ud[0]?.emne, 'm25');
  assert.equal(ud[19]?.emne, 'm6');
});

test('tilKuvert: no uid is no envelope; a string date is kept as text; long fields are cut', () => {
  assert.equal(tilKuvert({ uid: 0, envelope: {} }), null);
  assert.equal(tilKuvert({ uid: 1, envelope: { date: 'Fri, 31 Oct 2026 07:00:00 +0100' } })?.modtaget, 'Fri, 31 Oct 2026 07:00:00 +0100');
  assert.equal(tilKuvert({ uid: 1, envelope: { date: new Date('ugyldig') } })?.modtaget, '');
  assert.equal(tilKuvert({ uid: 1, envelope: { subject: 'x'.repeat(400) } })?.emne.length, 300);
});

test('tilKuvert: only envelope keys — a body or source in the fetch result is ignored', () => {
  const k = tilKuvert({ uid: 3, envelope: { subject: 'Hej' }, source: Buffer.from('BODY'), bodyParts: new Map() } as ImapBesked);
  assert.deepEqual(Object.keys(k ?? {}).sort(), ['emne', 'flag', 'fra', 'id', 'laest', 'modtaget', 'vedhaeftning']);
});
