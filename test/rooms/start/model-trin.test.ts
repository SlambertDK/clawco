// KC-0127: step 2 "Vælg din model" is Klaret only while both tiers have a model
// and each tier's last live test passed for the revision it has now. A failed
// test, a stale one (the model or provider changed) or none leaves it open.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alleTrin, trinStatus, type ModelSyn } from '../../../src/rooms/start/trin.ts';
import type { StartState } from '../../../src/rooms/start/schema.ts';

const tom: StartState = { startet: '2026-10-31T08:00:00.000Z', trin: {}, afvist: {} };
const model = () => alleTrin().find((t) => t.id === 'model')!;
const ok = (rev: string) => ({ ok: true, tid: '2026-10-31T09:00:00.000Z', ms: 800, rev });
const syn = (o: Partial<ModelSyn> = {}): ModelSyn => ({
  udbyder: 'anthropic', modeller: { lille: 'h', taenker: 's' }, rev: { lille: 'r1', taenker: 'r2' },
  test: { lille: ok('r1'), taenker: ok('r2') }, ...o,
});

test('model is the second step, mandatory', () => {
  assert.deepEqual(alleTrin().slice(0, 3).map((t) => t.id), ['situation', 'velkommen', 'model']); // KC-0248: step 0 first
  assert.equal(model().krav, 'obligatorisk');
  assert.equal(model().titel, 'Vælg din model');
});

test('Klaret with both tiers named and both tests passed for the current revision', () => {
  assert.equal(model().erKlaret(tom, { profil: null, model: syn() }), true);
});

test('open without the model view, without a model name, or with a failed test', () => {
  assert.equal(model().erKlaret(tom, { profil: null }), false);
  assert.equal(model().erKlaret(tom, { profil: null, model: syn({ modeller: { lille: 'h' } }) }), false);
  assert.equal(model().erKlaret(tom, { profil: null, model: syn({ test: { lille: ok('r1'), taenker: { ...ok('r2'), ok: false, fejl: 'noegle' } } }) }), false);
  assert.equal(model().erKlaret(tom, { profil: null, model: syn({ test: { lille: ok('r1') } }) }), false, 'one tier never tested');
});

test('a stale test (the revision changed: another model or provider) reopens the step', () => {
  assert.equal(model().erKlaret(tom, { profil: null, model: syn({ rev: { lille: 'r1', taenker: 'r3' } }) }), false);
  const sagt: StartState = { ...tom, trin: { model: { status: 'klaret', tid: tom.startet } } };
  assert.equal(trinStatus(model(), sagt, { profil: null, model: syn({ rev: { lille: 'r9', taenker: 'r2' } }) }), 'i-gang');
});

test('an install like kira-home (tiers set, no test ever) shows the step open, never Klaret', () => {
  assert.equal(model().erKlaret(tom, { profil: null, model: { modeller: { lille: 'claude-haiku-5.5', taenker: 'claude-sonnet-5.5' }, rev: { lille: 'a', taenker: 'b' }, test: {} } }), false);
});
