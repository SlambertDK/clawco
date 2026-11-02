import { test } from 'node:test';
import assert from 'node:assert/strict';
import { devAnswer } from '../../src/agent/devAnswers.ts';
import { buildForberedRun, buildOversigtChatRun, buildUniversChatRun } from '../../src/rooms/univers/prompt.ts';
import { extractJson } from '../../src/rooms/dagen/schema.ts';
import { parseForberedelse, parseNytUnivers, parseUniversSvar, tomtIndeks, tomtUnivers, type Moede, type UniversInfo } from '../../src/rooms/univers/schema.ts';

const NOW = new Date('2026-10-27T10:00:00Z');
const info: UniversInfo = { id: 'min-arena', navn: 'Min arena', om: 'Rollen', oprettet: NOW.toISOString() };
const moede: Moede = { id: 'moede-1', kilde: 'manuel', titel: 'Pitch til Tom', start: '2026-10-28T08:00:00.000Z', slut: '2026-10-28T09:00:00.000Z', deltagere: [{ navn: 'Jonas Holm', email: 'tom@x.example' }, { navn: 'Line Berg' }] };

test('dev fake: the forbered prompt gets a valid preparation with 2 participants, 4 points, 2 tasks and a script-free 3-section presentation', () => {
  const r = buildForberedRun(info, tomtUnivers(), moede, 'Få rollen afklaret', NOW);
  const f = parseForberedelse(extractJson(devAnswer({ ...r })));
  assert.equal(f.maal, 'Få rollen afklaret');
  assert.deepEqual(f.deltagere.map((d) => d.navn), ['Jonas Holm', 'Line Berg']);
  assert.equal(f.talepunkter.length, 4);
  assert.equal(f.opgaver.length, 2);
  assert.equal(f.praesentation?.html.match(/<section/g)?.length, 3);
  assert.doesNotMatch(f.praesentation?.html ?? '', /<script|on\w+=/i);
  assert.match(f.praesentation?.titel ?? '', /Pitch til Tom/);
});

test('dev fake: a univers chat that asks for something returns one note and one task; a question stays prose', () => {
  const lav = devAnswer(buildUniversChatRun(info, tomtUnivers(), 'Lav en note om kunderne', undefined, NOW));
  const els = parseUniversSvar(extractJson(lav));
  assert.deepEqual(els.map((e) => e.type), ['note', 'opgave']);
  const sp = devAnswer(buildUniversChatRun(info, tomtUnivers(), 'Hvornår er næste møde?', 'Møde: Pitch til Tom', NOW));
  assert.doesNotMatch(sp, /```/);
  assert.match(sp, /Pitch til Tom/);
});

test('dev fake: the overview chat creates a univers when asked, and otherwise talks', () => {
  const ny = parseNytUnivers(extractJson(devAnswer(buildOversigtChatRun(tomtIndeks(), 'Lav et univers om min arena', undefined, NOW))));
  assert.equal(ny.navn, 'Arena');
  assert.ok(ny.om.length > 0);
  assert.doesNotMatch(devAnswer(buildOversigtChatRun(tomtIndeks(), 'Hvad har jeg?', undefined, NOW)), /```/);
});

test('dev fake: the old answers still win for their own prompts', () => {
  assert.match(devAnswer({ instructions: 'Du er Kuratoren', input: 'x' }), /```json/);
  assert.match(devAnswer({ instructions: 'trykket "Fortryd"', input: 'x' }), /^Gjort om/);
});
