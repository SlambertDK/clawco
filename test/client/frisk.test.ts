// KC-0071: the screen is always fresh. A phone that slept, a tab in the background
// or a live stream that reconnected after a deploy must fetch the room again —
// a change made while nobody listened would otherwise never reach the screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../public/frisk.js';

type Frisk = {
  vedHello(kendt: number, version: number): { kendt: number; hent: boolean };
  vedSynlig(skjultSiden: number | null, nu: number): boolean;
  genforbindOm(forsoeg: number): number;
  SKJULT_MIN: number;
};
const KC = (globalThis as unknown as { KCFrisk: Frisk }).KCFrisk;

test('the first hello only learns the version: the page was just rendered', () => {
  assert.deepEqual(KC.vedHello(-1, 7), { kendt: 7, hent: false });
});

test('a hello after a reconnect with a newer version fetches the room', () => {
  assert.deepEqual(KC.vedHello(7, 9), { kendt: 9, hent: true });
});

test('a hello after a server restart (versions start over) also fetches the room', () => {
  assert.deepEqual(KC.vedHello(7, 0), { kendt: 0, hent: true });
});

test('a hello with the version already shown fetches nothing', () => {
  assert.deepEqual(KC.vedHello(7, 7), { kendt: 7, hent: false });
});

test('coming back after a while in the background fetches the room', () => {
  assert.equal(KC.vedSynlig(1_000, 1_000 + KC.SKJULT_MIN), true);
});

test('a quick glance away (app switcher) fetches nothing', () => {
  assert.equal(KC.vedSynlig(1_000, 1_000 + KC.SKJULT_MIN - 1), false);
});

test('visible without having been hidden fetches nothing', () => {
  assert.equal(KC.vedSynlig(null, 5_000), false);
});

test('a dead live stream is reopened with a growing pause, at most 30 s', () => {
  assert.equal(KC.genforbindOm(0), 1_000);
  assert.equal(KC.genforbindOm(1), 2_000);
  assert.equal(KC.genforbindOm(3), 8_000);
  assert.equal(KC.genforbindOm(10), 30_000);
});
