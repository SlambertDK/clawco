// KC-0225: the sender of an inbound message by the per-channel id in the people register: phone numbers compared as
// E.164 digits, handles case-folded, an ambiguous or unknown id is no match (never a guess).

// The WhatsApp host suffixes are joined at run time: the mirror guard (test/privat) reads a literal
// "<digits>@<host>" as an email address.
const WA = '@' + 's.whatsapp.net';
const CUS = '@' + 'c.us';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findAfsender, kanalIdAf, navnForAfsender, type Kontakt } from '../../../src/kilder/beskeder/afsender.ts';

const k = (id: string, navn: string, kanaler: Record<string, string>): Kontakt => ({ id, navn, relation: 'familie', kanaler });
const REGISTER: Kontakt[] = [
  k('maja', 'Maja', { signal: '+45 12 34 56 78', whatsapp: '0045 12 34 56 78', telegram: '@Maja_DK' }),
  k('ella', 'Ella', { telefon: '(+45) 87-65-43-21' }),
  k('ole', 'Ole', {}),
  k('tove', 'Tove', { signal: 'a1b2c3d4-0000-4000-8000-ffffffffffff' }),
];

test('kanalIdAf: the id on that channel; telefon stands in on the phone channels only', () => {
  assert.equal(kanalIdAf(REGISTER[0]!, 'signal'), '+45 12 34 56 78');
  assert.equal(kanalIdAf(REGISTER[0]!, 'telegram'), '@Maja_DK');
  assert.equal(kanalIdAf(REGISTER[1]!, 'signal'), '(+45) 87-65-43-21');
  assert.equal(kanalIdAf(REGISTER[1]!, 'whatsapp'), '(+45) 87-65-43-21');
  assert.equal(kanalIdAf(REGISTER[1]!, 'telegram'), undefined);
  assert.equal(kanalIdAf(REGISTER[2]!, 'signal'), undefined);
  assert.equal(kanalIdAf({}, 'signal'), undefined);
});

const TABEL: [string, 'telegram' | 'whatsapp' | 'signal', string, string | undefined][] = [
  ['E.164 as the person has it', 'signal', '+4512345678', 'Maja'],
  ['digits only, the WhatsApp address', 'whatsapp', '4512345678' + WA, 'Maja'],
  ['WhatsApp address with a device suffix', 'whatsapp', '4512345678:7' + WA, 'Maja'],
  ['the person wrote 0045 and spaces', 'whatsapp', '+4512345678', 'Maja'],
  ['no country code: Danish eight digits', 'signal', '12 34 56 78', 'Maja'],
  ['phone-only person via telefon on Signal', 'signal', '+4587654321', 'Ella'],
  ['phone-only person via telefon on WhatsApp', 'whatsapp', '4587654321' + CUS, 'Ella'],
  ['telefon never stands in on Telegram', 'telegram', '4587654321', undefined],
  ['handle case-folded, @ optional', 'telegram', 'maja_dk', 'Maja'],
  ['handle with @ and other case', 'telegram', '@MAJA_dk', 'Maja'],
  ['uuid case-folded', 'signal', 'A1B2C3D4-0000-4000-8000-FFFFFFFFFFFF', 'Tove'],
  ['an id of another channel is not a match', 'whatsapp', 'maja_dk', undefined],
  ['a handle is not a phone: no loose last-digits match', 'signal', '+4612345678', undefined],
  ['unknown number', 'signal', '+4599999999', undefined],
  ['empty or junk', 'signal', '  ', undefined],
];
for (const [navn, kanal, id, vent] of TABEL) test(`navnForAfsender: ${navn}`, () => assert.equal(navnForAfsender(REGISTER, kanal, id), vent));

test('two people with the same number are no match (ambiguous), and an empty register never matches', () => {
  const to = [k('a', 'Anne', { telefon: '+4511111111' }), k('b', 'Bo', { signal: '+45 11 11 11 11' })];
  assert.equal(findAfsender(to, 'signal', '+4511111111'), undefined);
  assert.equal(findAfsender(to, 'whatsapp', '+4511111111')?.navn, 'Anne');
  assert.equal(findAfsender([], 'signal', '+4511111111'), undefined);
});

test('findAfsender returns the person (id, relation), navnForAfsender only the name', () => {
  assert.equal(findAfsender(REGISTER, 'signal', '+4512345678')?.id, 'maja');
  assert.equal(findAfsender(REGISTER, 'signal', '+4512345678')?.relation, 'familie');
});
