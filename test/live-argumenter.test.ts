// KC-0069: live:tjek reads its arguments the same way with and without --test: a path limits the check to that
// route, and (only with --test) a moment id limits it to that moment. Argument parsing is pure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLiveArgumenter, testPlan } from '../scripts/live-argumenter.ts';

const MOMENTER = [{ id: 'morgen' }, { id: 'formiddag' }, { id: 'kold' }, { id: 'kold-velkommen' }];

test('without --test every positional argument is a path, as before; no argument = the front page', () => {
  assert.deepEqual(parseLiveArgumenter(['/rum/hjem', '/rum/mail']), { test: false, kold: false, stier: ['/rum/hjem', '/rum/mail'], momenter: [], fejl: [] });
  assert.deepEqual(parseLiveArgumenter([]).stier, ['/rum/hjem']);
});

test('the flags are taken out wherever they stand, and never end up as paths', () => {
  const a = parseLiveArgumenter(['--skaermbillede', '/tmp/sk', '/rum/dagen', '--sha', 'abc1234', '--test']);
  assert.equal(a.skaermDir, '/tmp/sk');
  assert.equal(a.sha, 'abc1234');
  assert.equal(a.test, true);
  assert.deepEqual(a.stier, ['/rum/dagen']);
  assert.deepEqual(a.fejl, []);
});

test('--kold is a test run too, and a flag without its value is an error, not a path', () => {
  const k = parseLiveArgumenter(['--kold']);
  assert.equal(k.kold, true);
  assert.equal(k.test, true);
  const m = parseLiveArgumenter(['--skaermbillede']);
  assert.match(m.fejl[0] ?? '', /--skaermbillede/);
  assert.deepEqual(m.stier, ['/rum/hjem']);
});

test('with --test a path argument limits the check to that route; a moment id limits it to that moment', () => {
  const a = parseLiveArgumenter(['--test', '/rum/mail', '/viden']);
  assert.deepEqual(a.stier, ['/rum/mail', '/viden']);
  assert.deepEqual(a.momenter, []);
  assert.deepEqual(testPlan(MOMENTER, a).plan.map((p) => `${p.moment} ${p.sti}`), ['morgen /rum/mail', 'morgen /viden', 'formiddag /rum/mail', 'formiddag /viden', 'kold /rum/mail', 'kold /viden', 'kold-velkommen /rum/mail', 'kold-velkommen /viden']);

  const b = parseLiveArgumenter(['--test', 'formiddag', '/viden']);
  assert.deepEqual(testPlan(MOMENTER, b).plan, [{ moment: 'formiddag', sti: '/viden', navn: 'test-formiddag /viden' }]);

  const c = parseLiveArgumenter(['--test', 'morgen', 'kold']);
  assert.deepEqual(testPlan(MOMENTER, c).plan.map((p) => `${p.moment} ${p.sti}`), ['morgen null', 'kold null'], 'no path: each chosen moment\'s own landing page (null = where the jump lands)');
});

test('with --test and no path or moment id every moment is checked at the page its jump lands on, as before; --kold only the cold ones', () => {
  const alle = testPlan(MOMENTER, parseLiveArgumenter(['--test'])).plan;
  assert.deepEqual(alle.map((p) => p.navn), ['test-morgen', 'test-formiddag', 'test-kold', 'test-kold-velkommen']);
  assert.deepEqual(alle.map((p) => p.sti), [null, null, null, null], 'the landing page is whatever the jump answers');
  assert.deepEqual(testPlan(MOMENTER, parseLiveArgumenter(['--kold'])).plan.map((p) => p.moment), ['kold', 'kold-velkommen']);
});

test('an unknown moment id is reported with the ones that exist, and nothing is checked', () => {
  const r = testPlan(MOMENTER, parseLiveArgumenter(['--test', 'morgn']));
  assert.deepEqual(r.plan, []);
  assert.match(r.fejl[0] ?? '', /morgn/);
  assert.match(r.fejl[0] ?? '', /morgen, formiddag/);
});

test('a non-path word without --test is an error (it would have been fetched as a broken address)', () => {
  const r = parseLiveArgumenter(['formiddag']);
  assert.match(r.fejl[0] ?? '', /formiddag/);
  assert.deepEqual(r.stier, ['/rum/hjem']);
});

test('parsing does not change its input', () => {
  const args = ['--test', 'morgen', '/viden'];
  parseLiveArgumenter(args);
  assert.deepEqual(args, ['--test', 'morgen', '/viden']);
});
