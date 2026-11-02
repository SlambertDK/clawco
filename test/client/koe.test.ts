// KC-0100: the Kø panel speaks plain Danish. The pure parts: a model id becomes a human name,
// and a run becomes the status words of its row ("i kø", "lige startet", "startet for 2 min siden").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../public/koe.js';

type Raekke = { status: string; startedAt: number; begyndt?: number | null; finishedAt?: number | null };
type Koe = { modelNavn(id: string): string; status(r: Raekke, nu: number): string };
const KC = (globalThis as unknown as { KCKoe: Koe }).KCKoe;

test('a model id gets a human name, derived from its pattern', () => {
  assert.equal(KC.modelNavn('claude-haiku-5.5'), 'Haiku 5.5 — hurtig');
  assert.equal(KC.modelNavn('claude-sonnet-5.5'), 'Sonnet 5.5');
  assert.equal(KC.modelNavn('claude-opus-5.5'), 'Opus 5.5 — grundig');
  assert.equal(KC.modelNavn('claude-sonnet-5-5'), 'Sonnet 5.5');
  assert.equal(KC.modelNavn('copilot/claude-opus-6'), 'Opus 6 — grundig');
});

test('an empty or unknown model id reads as Hermes\' own choice or stays as typed', () => {
  assert.equal(KC.modelNavn(''), 'Hermes\' standard');
  assert.equal(KC.modelNavn('   '), 'Hermes\' standard');
  assert.equal(KC.modelNavn('noget-andet-1'), 'noget-andet-1');
});

test('a queued run says i kø', () => {
  assert.equal(KC.status({ status: 'queued', startedAt: 0 }, 5000), 'i kø');
});

test('a run that started 30 seconds ago says lige startet', () => {
  const nu = 10 * 60_000;
  assert.equal(KC.status({ status: 'running', startedAt: nu - 90_000, begyndt: nu - 30_000 }, nu), 'lige startet');
});

test('a run that started 2 minutes ago says startet for 2 min siden', () => {
  const nu = 10 * 60_000;
  assert.equal(KC.status({ status: 'running', startedAt: nu - 130_000, begyndt: nu - 125_000 }, nu), 'startet for 2 min siden');
});

test('a long run counts hours, and a run with no start time falls back to when it was created', () => {
  const nu = 10 * 3600_000;
  assert.equal(KC.status({ status: 'running', startedAt: nu - 3600_000, begyndt: nu - 3600_000 }, nu), 'startet for 1 time siden');
  assert.equal(KC.status({ status: 'running', startedAt: nu - 3 * 3600_000 }, nu), 'startet for 3 timer siden');
  assert.equal(KC.status({ status: 'running', startedAt: nu + 5000, begyndt: nu + 5000 }, nu), 'lige startet'); // a clock a little behind
});

test('finished runs say klar or mislykkedes', () => {
  assert.equal(KC.status({ status: 'done', startedAt: 0 }, 1), 'klar');
  assert.equal(KC.status({ status: 'failed', startedAt: 0 }, 1), 'mislykkedes');
});
