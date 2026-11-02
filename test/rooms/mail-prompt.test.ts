import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMailRefreshRun, buildKladdeRun, buildBaggrundFlytRun, buildSendRun } from '../../src/rooms/mail/prompt.ts';
import { GRAENSER } from '../../src/agent/prompt.ts';
import type { TrimmedMail } from '../../src/rooms/mail/source.ts';

const trimmed: TrimmedMail = {
  dato: '2026-10-27', hentet: '2026-10-27T08:40:00Z',
  handling: [{ id: '242', emne: 'Tilbud på ny eltavle', fra: 'Elektrikeren ApS', modtaget: '2026-10-26T18:57:39Z', laest: true, flag: false, vedhaeftning: true }],
  tal: { handling: 1, afventer: 1, regninger: 12, indbakke: 0, sorteretIDag: 3 },
  ordnet: [],
};

test('refresh run asks for the analysis schema: type, betydning, udkast, arkivmappe, and the hard rules', () => {
  const r = buildMailRefreshRun(trimmed, new Date('2026-10-27T08:40:00Z'));
  for (const k of ['"type"', '"betydning"', '"udkast"', '"arkivmappe"', '"muligheder"', '"hermesStatus"']) assert.ok(r.instructions.includes(k), k);
  assert.match(r.instructions, /himalaya message read -m Folders\/Handling/);
  assert.match(r.instructions, /List-Unsubscribe/);
  assert.match(r.instructions, /aldrig.*send/i);
  assert.ok(r.input.includes('"242"'));
});

test('KC-0118: the refresh run is built by the shared prompt builder: limits once, zone line, catalog', () => {
  const r = buildMailRefreshRun(trimmed, new Date('2026-10-27T08:40:00Z'));
  assert.equal(r.instructions.split(GRAENSER).length - 1, 1);
  assert.match(r.instructions, /Zone: privat/);
  assert.match(r.instructions, /Byggeklodserne/);
});

test('kladde run passes Henriks text and asks for a Drafts entry as a reply', () => {
  const r = buildKladdeRun('242', 'Tilbud på ny eltavle', 'Hej, tak.');
  assert.match(r.instructions, /Drafts/);
  assert.match(r.instructions, /In-Reply-To/);
  assert.match(r.instructions, /aldrig.*send/i);
  assert.ok(r.input.includes('Hej, tak.'));
  assert.ok(r.input.includes('242'));
});

test('background move run names folder and mail', () => {
  const r = buildBaggrundFlytRun('242', 'Folders/Afventer');
  assert.match(r.input, /--from Folders\/Handling --to Folders\/Afventer 242/);
});

test('send run says Henrik approved, uses himalaya reply --send and forbids anything but this one reply', () => {
  const r = buildSendRun('242', 'Tilbud på ny eltavle', 'Hej, tak.');
  assert.match(r.instructions, /Henrik har godkendt/);
  assert.match(r.instructions, /himalaya message reply -m Folders\/Handling 242/);
  assert.match(r.instructions, /--send/);
  assert.match(r.instructions, /kun denne ene mail/i);
  assert.ok(r.input.includes('Hej, tak.'));
});

test('KC-0060: the refresh run asks for a visuel on every decision', () => {
  const t = buildMailRefreshRun(trimmed, new Date('2026-10-27T08:40:00Z')).instructions;
  assert.match(t, /"visuel": \{ "ikon": "cloud-rain"/);
  assert.match(t, /"ikon" \(skal\): ét af [^\n]*receipt/);
  assert.match(t, /Giv hver beslutning et "visuel"/);
});

test('KC-0066: the refresh run asks Hermes to mark muligheder that go to others with tilAndre and keeps the no-send rule', () => {
  const r = buildMailRefreshRun(trimmed, new Date('2026-10-27T08:40:00Z'));
  assert.match(r.instructions, /"tilAndre": true/);
  assert.match(r.instructions, /tilAndre[^\n]*andre mennesker/);
  assert.match(r.instructions, /aldrig sende/i);
});

// KC-0223: the refresh for a connection Clawco may only read.
test('the read-only refresh asks for no draft, folder or muligheder, says Henrik moves and answers mails himself, and never mentions himalaya', async () => {
  const { buildMailRefreshForbindelseRun } = await import('../../src/rooms/mail/prompt.ts');
  const spec = buildMailRefreshForbindelseRun(trimmed, new Date('2026-10-27T08:40:00Z'), 'Gmail', { laeseKun: true });
  assert.doesNotMatch(spec.instructions, /"udkast"|"arkivmappe"|"muligheder"/);
  assert.doesNotMatch(spec.instructions, /himalaya/);
  assert.match(spec.instructions, /kan ikke læse selve mailene/);
  assert.match(spec.instructions, /flytter og besvarer .* selv/);
  assert.match(spec.input, /Gmail/);
  const med = buildMailRefreshForbindelseRun(trimmed, new Date('2026-10-27T08:40:00Z'), 'Mail');
  assert.match(med.instructions, /"udkast"/, 'the acting prompt is unchanged');
});
