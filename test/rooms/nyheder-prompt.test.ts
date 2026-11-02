import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRAENSER } from '../../src/agent/prompt.ts';
import { buildNyhederRefreshRun, buildNyhederHentRun } from '../../src/rooms/nyheder/prompt.ts';

test('refresh run names the schema keys and rules and passes the items', () => {
  const r = buildNyhederRefreshRun({ dato: '2026-10-27', nyheder: [{ titel: 'GPT-6.1 Terra', kilde: 'Simon Willison', url: 'https://example.org/gpt', resume: 'r' }], kilder: { antal: 25, medNyheder: 9, nyheder: 1, fejlede: [] } }, new Date('2026-10-27T07:10:00Z'));
  for (const k of ['femLinjer', 'baner', 'navn', 'nyheder', 'hvorfor', 'forslag', 'hermesStatus']) assert.ok(r.instructions.includes(`"${k}"`), k);
  // KC-0228: the owner's work comes from what Hermes knows about him (as the family does, KC-0023), never from code.
  assert.match(r.instructions, /det, du ved om Henrik/);
  assert.doesNotMatch(r.instructions, /product manager|hos [A-ZÆØÅ]\w+ \(/);
  assert.match(r.instructions, /url.*uændret|præcis som|nøjagtigt/i);
  assert.match(r.instructions, /titel.*rent/i);
  assert.ok(r.input.includes('GPT-6.1 Terra'));
  assert.match(buildNyhederHentRun(new Date()).input, /morgenavis_cron\.py/);
});

test('KC-0118: the refresh run is built by the shared prompt builder: limits once, zone line', () => {
  const r = buildNyhederRefreshRun({ dato: '2026-10-27', nyheder: [], kilder: { antal: 0, medNyheder: 0, nyheder: 0, fejlede: [] } }, new Date());
  assert.equal(r.instructions.split(GRAENSER).length - 1, 1);
  assert.match(r.instructions, /Zone: privat/);
});

test('refresh run asks for relevans notes with the fixed keys and tells Hermes to use what it knows about Henrik', () => {
  const r = buildNyhederRefreshRun({ dato: '2026-10-27', nyheder: [], kilder: { antal: 0, medNyheder: 0, nyheder: 0, fejlede: [] } }, new Date());
  assert.match(r.instructions, /"relevans"/);
  for (const k of ['mig', 'familie', 'arbejde', 'danmark', 'holdning', 'projekter']) assert.ok(r.instructions.includes(`"${k}"`), k);
  assert.match(r.instructions, /det, du ved om Henrik|din viden om Henrik/i);
});
