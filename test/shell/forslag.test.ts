// KC-0077: the suggestions in an empty chat. One map per room, shown as buttons,
// sent exactly like a typed sentence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORSLAG, forslagTil } from '../../src/shell/forslag.ts';
import { rumFraBesked, erHjaelp } from '../../src/shell/aabn.ts';
import { ROOMS } from '../../src/rooms/registry.ts';
import { shell } from '../../src/shell/layout.ts';
import { html } from '../../src/shell/html.ts';
import { medSprog } from '../../src/store/sprog.ts';

const side = (roomId: string, chat: { id: string; tid: string; fra: 'henrik' | 'hermes'; tekst: string }[] = []): string => String(shell({
  roomId, hermesStatus: 'Klar', venter: {}, main: html`<p>x</p>`, chat,
}));

test('every room has two to four short Danish suggestions, a single univers too', () => {
  for (const r of ROOMS) {
    const f = forslagTil(r.id);
    assert.ok(f.length >= 2 && f.length <= 4, `${r.id}: ${f.length} forslag`);
    for (const s of f) assert.ok(s.length > 0 && s.length <= 40, `${r.id}: "${s}" is short`);
  }
  assert.ok(forslagTil('univers-havvind-nord').length >= 1);
  assert.deepEqual(forslagTil('findes-ikke'), []);
});

test('the Hjem suggestions are the ones Henrik asked for, and "Jeg vil skrive" is understood by the chat matcher', () => {
  assert.deepEqual(FORSLAG['hjem'], ['Hvad venter på mig?', 'Hvad sker der i dag?', 'Jeg vil skrive']);
  assert.equal(rumFraBesked('Jeg vil skrive', [])?.id, 'skrive');
  assert.equal(rumFraBesked('Jeg vil skrive', [])?.videre, false);
});

test('the suggestions are real buttons right above the field, after the messages, where the thumb is', () => {
  const out = side('hjem');
  const i = out.indexOf('id="chat-forslag"');
  assert.ok(i > out.indexOf('id="chat"') && i < out.indexOf('id="chat-form"'), 'between messages and field');
  const knapper = [...out.matchAll(/<button type="button" class="btn btn-forslag" data-forslag="([^"]*)">([^<]*)<\/button>/g)];
  assert.deepEqual(knapper.map((m) => m[2]), ['Hvad venter på mig?', 'Hvad sker der i dag?', 'Jeg vil skrive', 'Hvad kan jeg sige?']);
  for (const m of knapper) assert.equal(m[1], m[2], 'the button sends the sentence it shows');
});

// The chat keeps its last 50 messages, so "only an empty chat" would almost never show them.
test('a chat with earlier messages still offers the suggestions (they go once Henrik sends)', () => {
  const out = side('hjem', [{ id: 'c1', tid: '2026-10-26T06:00:00.000Z', fra: 'henrik', tekst: 'Hej' }]);
  assert.match(out, /id="chat-forslag"/);
});

test('a room without suggestions renders no empty box', () => {
  assert.doesNotMatch(side('findes-ikke'), /id="chat-forslag"/);
});

test('the hint says Tryk on touch and Klik with a mouse, both in the markup so CSS picks one', () => {
  const out = side('hjem');
  assert.match(out, /id="kontekst-hint"><span class="kun-touch">Tryk<\/span><span class="kun-mus">Klik<\/span> på en kasse eller en linje i rummet, så handler chatten om den\./);
});

// KC-0098: the help is one tap away, last, so it never pushes a room's own suggestions out.
test('KC-0098: "Hvad kan jeg sige?" is the last suggestion in every room, after the room\'s own, and the chat understands it', () => {
  for (const r of ROOMS.map((x) => x.id)) {
    const f = forslagTil(r);
    assert.equal(f[f.length - 1], 'Hvad kan jeg sige?', r);
    assert.deepEqual(f.slice(0, -1), FORSLAG[r], `${r}: its own suggestions come first, untouched`);
  }
  assert.equal(forslagTil('univers-havvind-nord').at(-1), 'Hvad kan jeg sige?');
  assert.equal(erHjaelp('Hvad kan jeg sige?'), true);
});

// KC-0170: the chips come in the request's language; the Danish ones stay as they were.
test('KC-0170: English chips per room, each two to four and short, the help last, and the chat reads the ones that are phrases', () => {
  for (const r of ROOMS.map((x) => x.id).concat(['univers-havvind-nord'])) {
    const f = medSprog('en', () => forslagTil(r));
    assert.ok(f.length >= 2 && f.length <= 4, `${r}: ${f.length}`);
    for (const s of f) assert.ok(s.length > 0 && s.length <= 40, `${r}: "${s}" is short`);
    assert.equal(f.at(-1), 'What can I say?', r);
    assert.notDeepEqual(f, forslagTil(r), `${r}: not the Danish chips`);
  }
  assert.deepEqual(medSprog('en', () => forslagTil('hjem')), ['What is waiting for me?', 'What is happening today?', 'I want to write', 'What can I say?']);
  assert.deepEqual(medSprog('en', () => forslagTil('findes-ikke')), []);
  assert.equal(medSprog('en', () => rumFraBesked('I want to write', [])?.id), 'skrive');
  assert.equal(medSprog('en', () => erHjaelp('What can I say?')), true);
  assert.deepEqual(forslagTil('hjem'), ['Hvad venter på mig?', 'Hvad sker der i dag?', 'Jeg vil skrive', 'Hvad kan jeg sige?'], 'Danish unchanged, read at call time');
});

test('KC-0170: an English page shows the chips as buttons, and the Danish page keeps its own', () => {
  const en = medSprog('en', () => side('hjem'));
  const knapper = [...en.matchAll(/<button type="button" class="btn btn-forslag" data-forslag="([^"]*)">([^<]*)<\/button>/g)].map((m) => m[2]);
  assert.deepEqual(knapper, ['What is waiting for me?', 'What is happening today?', 'I want to write', 'What can I say?']);
  assert.match(en, /id="chat-forslag" role="group" aria-label="Suggestions"/);
});
