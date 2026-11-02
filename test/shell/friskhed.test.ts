import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friskhed } from '../../src/shell/friskhed.ts';

// KC-0078: "opdateret 07.05" today, "fra …" with a warning tone when older.
const NU = new Date('2026-10-30T12:00:00Z'); // 13.00 in Copenhagen (CET, UTC+1)

test('built today: quiet "opdateret" with the Copenhagen time', () => {
  const out = String(friskhed('2026-10-30T06:05:00Z', NU)); // 07.05 CET
  assert.match(out, /^<span class="friskhed">opdateret 07\.05<\/span>$/);
  assert.doesNotMatch(out, /friskhed-gammel/);
});

test('built yesterday: "fra i går" with the warning class', () => {
  const out = String(friskhed('2026-10-29T06:05:00Z', NU));
  assert.match(out, /^<span class="friskhed friskhed-gammel">fra i går 07\.05<\/span>$/);
});

test('built two to six days ago: the weekday name', () => {
  const out = String(friskhed('2026-10-27T06:05:00Z', NU)); // tuesday
  assert.match(out, /friskhed-gammel">fra tirsdag 07\.05</);
});

test('built a week or more ago: the date', () => {
  const out = String(friskhed('2026-10-23T05:05:00Z', NU)); // CEST: DST ended 25 Oct
  assert.match(out, /friskhed-gammel">fra 23\. okt\. 07\.05</);
});

test('the Copenhagen date decides, not UTC: 23.30 UTC is already tomorrow in Copenhagen', () => {
  // 2026-10-29T23:30Z = 30 Oct 00.30 CET -> today when now is 30 Oct 13.00 CET.
  const iDag = String(friskhed('2026-10-29T23:30:00Z', NU));
  assert.match(iDag, /opdateret 00\.30</);
  // 2026-10-30T23:30Z = 31 Oct 00.30 CET; now 31 Oct 00.10 CET -> still today for a stamp from the "future" of the same day.
  const nuMidnat = new Date('2026-10-30T23:10:00Z'); // 31 Oct 00.10 CET
  const igaar = String(friskhed('2026-10-30T22:50:00Z', nuMidnat)); // 30 Oct 23.50 CET
  assert.match(igaar, /fra i går 23\.50</);
});

test('summer time (CEST, UTC+2) is used when it applies', () => {
  const out = String(friskhed('2026-07-01T05:05:00Z', new Date('2026-07-01T10:00:00Z')));
  assert.match(out, /opdateret 07\.05</);
});

test('a stamp slightly in the future (clock skew) counts as today; unparseable gives nothing', () => {
  assert.match(String(friskhed('2026-10-30T12:05:00Z', NU)), /opdateret 13\.05</);
  assert.equal(String(friskhed('ikke en tid', NU)), '');
  assert.equal(String(friskhed('', NU)), '');
});
