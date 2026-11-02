import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synligeRum } from '../../src/shell/synlig.ts';

const NU = new Date('2026-10-29T10:00:00.000Z'); // 11.00 in Copenhagen
const ALLE = ['hjem', 'dagen', 'mail', 'skrive', 'nyheder', 'univers'];
const vis = (o: Partial<Parameters<typeof synligeRum>[0]>): string[] =>
  [...synligeRum({ roomId: 'hjem', rum: ALLE, univers: [], venter: {}, aabnet: {}, now: NU, ...o })].sort();

test('KC-0052: with nothing waiting and nothing opened, only Hjem is in the nav', () => {
  assert.deepEqual(vis({}), ['hjem']);
});

test('KC-0052: the room on screen and every room where something new waits for Henrik are shown', () => {
  assert.deepEqual(vis({ roomId: 'dagen', venter: { mail: 2, nyheder: 0, univers: 1 } }), ['dagen', 'hjem', 'mail', 'univers']);
});

test('KC-0052: his own unfinished work (a proposal in Skrive, tasks in a univers) does not keep a room in the nav', () => {
  assert.deepEqual(vis({ univers: ['have'], venter: { skrive: 1, 'univers-have': 3 } }), ['hjem']);
  assert.deepEqual(vis({ univers: ['have'], venter: { skrive: 1 }, aabnet: { skrive: '2026-10-29T07:00:00.000Z' } }), ['hjem', 'skrive']);
});

test('KC-0052: a room opened today stays; one opened yesterday (Copenhagen day) is gone', () => {
  assert.deepEqual(vis({ aabnet: { skrive: '2026-10-28T23:30:00.000Z', nyheder: '2026-10-28T22:30:00.000Z' } }), ['hjem', 'skrive']);
});

test('KC-0052: a univers is shown when it is on screen or was opened today — and then Univers is too', () => {
  const univers = ['min-arena', 'have'];
  assert.deepEqual(vis({ univers }), ['hjem']);
  assert.deepEqual(vis({ univers, roomId: 'univers-min-arena' }), ['hjem', 'univers', 'univers-min-arena']);
  assert.deepEqual(vis({ univers, aabnet: { 'univers-min-arena': '2026-10-29T06:00:00.000Z' } }), ['hjem', 'univers', 'univers-min-arena']);
  assert.deepEqual(vis({ univers, roomId: 'univers' }), ['hjem', 'univers']);
});

test('KC-0052: a bad timestamp never shows a room', () => {
  assert.deepEqual(vis({ aabnet: { mail: 'nonsens' } }), ['hjem']);
});

test('KC-0114: in the morning Dagen counts as relevant by itself; in the day, the evening and with no situation it does not', () => {
  assert.deepEqual(vis({ situation: 'morgen' }), ['dagen', 'hjem']);
  assert.deepEqual(vis({ situation: 'dagen' }), ['hjem']);
  assert.deepEqual(vis({ situation: 'aften' }), ['hjem']);
  assert.deepEqual(vis({}), ['hjem']);
});

test('KC-0126: Start is on screen while the journey is not Done, and gone once it is — even opened today or with steps open', () => {
  const rum = [...ALLE, 'start'];
  assert.deepEqual(vis({ rum, start: { faerdig: false, forslag: 0 } }), ['hjem', 'start']);
  assert.deepEqual(vis({ rum, start: { faerdig: true, forslag: 0 }, venter: { start: 1 }, aabnet: { start: '2026-10-29T07:00:00.000Z' } }), ['hjem']);
  assert.deepEqual(vis({ rum, roomId: 'start', start: { faerdig: true, forslag: 0 } }), ['hjem', 'start'], 'the room on screen stays');
});

test('KC-0126: after Done, Start comes back when a source is worth adding, and goes again when the suggestion is dismissed', () => {
  const rum = [...ALLE, 'start'];
  assert.deepEqual(vis({ rum, start: { faerdig: true, forslag: 1 } }), ['hjem', 'start']);
  assert.deepEqual(vis({ rum, start: { faerdig: true, forslag: 0 } }), ['hjem']);
});

test('KC-0126: without Start\'s own input Start is not in the nav, whatever it counts', () => {
  assert.deepEqual(vis({ rum: [...ALLE, 'start'], venter: { start: 1 } }), ['hjem']);
});

test('KC-0148: Husstanden has its own rule — shown (under Univers) exactly when the household universe is there for this person', () => {
  const rum = [...ALLE, 'husstand'];
  assert.deepEqual(vis({ rum }), ['hjem']);
  assert.deepEqual(vis({ rum, husstand: true }), ['hjem', 'husstand', 'univers']);
  assert.deepEqual(vis({ rum, husstand: false, roomId: 'husstand', venter: { husstand: 1 }, aabnet: { husstand: '2026-10-29T07:00:00.000Z' } }), ['hjem'], 'not on its own page, waiting or opened today');
});
