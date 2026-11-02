import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildMailChatRun } from '../../src/rooms/mail/prompt.ts';
import type { MailState } from '../../src/rooms/mail/schema.ts';

const state: MailState = {
  dato: '2026-10-27', genereret: '2026-10-27T08:40:00Z', tal: { handling: 2, afventer: 0, regninger: 0, sorteretIDag: 0 }, ordnet: [], hermesStatus: 'x',
  beslutninger: [
    { mailId: '242', emne: 'Tilbud på ny eltavle', fra: 'Elektrikeren ApS', modtaget: '2026-10-26T18:57:39Z', type: 'svar', resume: 'Et tilbud', betydning: 'b', arkivmappe: 'Archive', muligheder: [] },
    { mailId: '243', emne: 'Din faktura', fra: 'Energi A/S', modtaget: '2026-10-27T06:01:00Z', type: 'regning', resume: 'En regning', betydning: 'b', arkivmappe: 'Archive', muligheder: [], afgjort: { mulighedId: 'faerdig', tid: '2026-10-27T07:00:00Z' } },
  ],
};

// Each run wraps data in a fresh random boundary: replace it so the text can be pinned.
const fast = (s: string): string => { const m = s.match(/⟦data (\S+) /); return m ? s.split(m[1] ?? "").join('GRAENSE') : s; };
const hash = (s: string): string => createHash('sha256').update(fast(s)).digest('hex');

test('KC-0218: the chat prompt in tool mode is unchanged byte for byte (Henrik\'s own installation)', () => {
  const a = buildMailChatRun('Hvad haster?', 'Tilbud', state);
  assert.equal(hash(a.instructions), '8c8b7aceb3a097cdc98868d6044a8947f18633c1189ffea6b6abdb8f1e8322ec');
  assert.equal(hash(a.input), '48aa6ae0ab269830e860c406be310d5c651a7021974d33fd85f78a8f703d23cf');
  const b = buildMailChatRun('Hvad haster?', undefined, null);
  assert.equal(hash(b.instructions), '8c8b7aceb3a097cdc98868d6044a8947f18633c1189ffea6b6abdb8f1e8322ec');
  assert.equal(hash(b.input), '9888f3204c1b2bbdc65534e8838e85e6848673d2a6f91b296493a79f96ae09f7');
  assert.match(a.instructions, /himalaya/);
});

for (const kanHandle of [true, false]) {
  test(`KC-0218: in connector mode (kanHandle ${kanHandle}) the chat names the connector and its envelopes and mentions no tool`, () => {
    const r = buildMailChatRun('Hvem har skrevet i dag?', undefined, state, { navn: 'Gmail', kanHandle });
    assert.doesNotMatch(r.instructions, /himalaya|terminal|Folders\/|Proton/i);
    assert.match(r.instructions, /Gmail/);
    assert.match(r.instructions, /afsender, emne og dato/);
    assert.match(r.instructions, /kan ikke læse selve mailene/);
    assert.match(r.instructions, /kan ikke flytte, skrive kladder eller sende/);
    assert.match(r.instructions, /hvem der har skrevet/);
    assert.match(r.instructions, /kun ud fra emnet[^\n]*gæt/);
    assert.match(r.instructions, /aldrig sende, besvare eller videresende/);
    // the envelopes the answer is built from: sender, subject, date, and what is already decided
    for (const s of ['Elektrikeren ApS', 'Tilbud på ny eltavle', '2026-10-26T18:57:39Z', 'Energi A/S', '2026-10-27T06:01:00Z']) assert.ok(r.input.includes(s), s);
    assert.match(r.input, /"afgjort": true/);
    assert.ok(r.input.endsWith('Hvem har skrevet i dag?'));
  });
}

test('KC-0218: the connector chat says the connection can only read when kanHandle is false, and Færdig otherwise', () => {
  const laes = buildMailChatRun('x', undefined, state, { navn: 'Gmail', kanHandle: false }).instructions;
  assert.match(laes, /kan kun læse/);
  assert.match(laes, /egen mailapp/);
  const handl = buildMailChatRun('x', undefined, state, { navn: 'Mail', kanHandle: true }).instructions;
  assert.match(handl, /Færdig/);
  assert.doesNotMatch(handl, /egen mailapp/);
});

test('KC-0218: the connector chat copes with an empty room and an element the person points at', () => {
  const r = buildMailChatRun('Hvad er der?', 'Tilbud på ny eltavle', null, { navn: 'Mail', kanHandle: true });
  assert.match(r.input, /Rummet har ingen data endnu/);
  assert.match(r.input, /Om: Tilbud på ny eltavle/);
  assert.doesNotMatch(r.instructions, /himalaya/);
});
