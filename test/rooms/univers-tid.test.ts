import { test } from 'node:test';
import assert from 'node:assert/strict';
import { koebenhavnTilIso, iVinduet } from '../../src/rooms/univers/tid.ts';

test('winter time: Copenhagen is UTC+1', () => {
  assert.equal(koebenhavnTilIso('2026-01-15T10:00'), '2026-01-15T09:00:00.000Z');
});

test('summer time: Copenhagen is UTC+2', () => {
  assert.equal(koebenhavnTilIso('2026-07-15T10:00'), '2026-07-15T08:00:00.000Z');
});

test('the days around the DST changes use the offset valid at that wall time', () => {
  assert.equal(koebenhavnTilIso('2026-03-28T12:00'), '2026-03-28T11:00:00.000Z');
  assert.equal(koebenhavnTilIso('2026-03-29T12:00'), '2026-03-29T10:00:00.000Z');
  assert.equal(koebenhavnTilIso('2026-03-29T01:30'), '2026-03-29T00:30:00.000Z');
  assert.equal(koebenhavnTilIso('2026-10-24T12:00'), '2026-10-24T10:00:00.000Z');
  assert.equal(koebenhavnTilIso('2026-10-25T12:00'), '2026-10-25T11:00:00.000Z');
});

test('seconds are kept; garbage and impossible dates give null', () => {
  assert.equal(koebenhavnTilIso('2026-01-15T10:00:30'), '2026-01-15T09:00:30.000Z');
  assert.equal(koebenhavnTilIso(''), null);
  assert.equal(koebenhavnTilIso('i morgen'), null);
  assert.equal(koebenhavnTilIso('2026-13-01T10:00'), null);
  assert.equal(koebenhavnTilIso('2026-02-30T10:00'), null);
});

test('the polling window is 06:00 to 22:00 Copenhagen time', () => {
  assert.equal(iVinduet(new Date('2026-10-27T04:59:00Z')), false); // 05:59
  assert.equal(iVinduet(new Date('2026-10-27T05:00:00Z')), true); // 06:00
  assert.equal(iVinduet(new Date('2026-10-27T20:59:00Z')), true); // 21:59
  assert.equal(iVinduet(new Date('2026-10-27T21:00:00Z')), false); // 22:00
  assert.equal(iVinduet(new Date('2026-07-15T03:59:00Z')), false); // 05:59 summer
  assert.equal(iVinduet(new Date('2026-07-15T04:00:00Z')), true); // 06:00 summer
});
