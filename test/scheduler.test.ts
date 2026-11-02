import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontload, dueNow, parseKuratorPlan, kuratorDue, startTik, parseKonfliktPlan, konfliktDue } from '../src/scheduler.ts';

test('parseFrontload reads "room=HH:MM,HH:MM;room=HH:MM" and ignores junk', () => {
  const s = parseFrontload('mail=06:50,12:00,17:00; nyheder=07:08;bad;dagen=25:99,07:05');
  assert.deepEqual(s, [{ room: 'mail', tider: ['06:50', '12:00', '17:00'] }, { room: 'nyheder', tider: ['07:08'] }, { room: 'dagen', tider: ['07:05'] }]);
  assert.deepEqual(parseFrontload(''), []);
});

test('dueNow returns the rooms whose time matches the Copenhagen minute, once per minute', () => {
  const s = parseFrontload('mail=06:50,12:00;nyheder=06:50');
  const at = new Date('2026-10-27T05:50:10Z'); // 06:50 CET
  const seen = new Set<string>();
  assert.deepEqual(dueNow(s, at, seen), ['mail', 'nyheder']);
  assert.deepEqual(dueNow(s, at, seen), [], 'same minute is not due twice');
  assert.deepEqual(dueNow(s, new Date('2026-10-27T11:00:00Z'), seen), ['mail']);
});

test('parseKuratorPlan reads "fra-til/min"; empty or "fra" means off', () => {
  assert.deepEqual(parseKuratorPlan('07-22/60'), { fra: 7, til: 22, hverMin: 60 });
  assert.deepEqual(parseKuratorPlan(' 8-20/30 '), { fra: 8, til: 20, hverMin: 30 });
  assert.equal(parseKuratorPlan(''), null);
  assert.equal(parseKuratorPlan('fra'), null);
  assert.equal(parseKuratorPlan('22-07/60'), null, 'fra must be before til');
  assert.equal(parseKuratorPlan('07-25/60'), null);
  assert.equal(parseKuratorPlan('07-22/0'), null);
  assert.equal(parseKuratorPlan('junk'), null);
});

test('kuratorDue: false at 06:59 and 22:00, true at 07:00 with no sidst, false 30 min after sidst', () => {
  const plan = { fra: 7, til: 22, hverMin: 60 };
  assert.equal(kuratorDue(plan, new Date('2026-10-27T05:59:00Z')), false, '06:59 CET');
  assert.equal(kuratorDue(plan, new Date('2026-10-27T21:00:00Z')), false, '22:00 CET');
  assert.equal(kuratorDue(plan, new Date('2026-10-27T06:00:00Z')), true, '07:00 CET, never run');
  assert.equal(kuratorDue(plan, new Date('2026-10-27T11:30:00Z'), '2026-10-27T11:00:00Z'), false, '30 min after');
  assert.equal(kuratorDue(plan, new Date('2026-10-27T12:00:00Z'), '2026-10-27T11:00:00Z'), true, '60 min after');
  assert.equal(kuratorDue(plan, new Date('2026-10-27T12:00:00Z'), 'not a date'), true, 'unreadable sidst counts as never');
});

test('startTik (KC-0149): calls the tick every interval while active, one at a time, and stops', async () => {
  let n = 0; let aktiv = true; let samtidig = 0; let max = 0;
  const stop = startTik(async () => { n++; samtidig++; max = Math.max(max, samtidig); await new Promise((r) => setTimeout(r, 15)); samtidig--; }, 5, () => aktiv);
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(n >= 2, `ticked ${n} times`);
  assert.equal(max, 1, 'a slow tick is never overlapped');
  aktiv = false;
  await new Promise((r) => setTimeout(r, 20));
  const efterPause = n;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(n, efterPause, 'no tick while inactive');
  stop();
});

test('parseKonfliktPlan (KC-0152): a clock time is the plan; empty, "fra" and junk are off', () => {
  assert.deepEqual(parseKonfliktPlan('07:30'), { kl: '07:30' });
  assert.deepEqual(parseKonfliktPlan(' 08:05 '), { kl: '08:05' });
  assert.equal(parseKonfliktPlan(''), null);
  assert.equal(parseKonfliktPlan('fra'), null);
  assert.equal(parseKonfliktPlan('25:00'), null);
  assert.equal(parseKonfliktPlan('7.30'), null);
});

test('konfliktDue (KC-0152): Tuesdays from 07:30 Copenhagen, never another day, never before', () => {
  const plan = { kl: '07:30' };
  assert.equal(konfliktDue(plan, new Date('2026-11-03T06:29:00Z')), false, 'Tuesday 07:29 CET');
  assert.equal(konfliktDue(plan, new Date('2026-11-03T06:30:00Z')), true, 'Tuesday 07:30 CET');
  assert.equal(konfliktDue(plan, new Date('2026-11-03T20:00:00Z')), true, 'a restart later on Tuesday still catches up');
  assert.equal(konfliktDue(plan, new Date('2026-11-02T06:30:00Z')), false, 'Monday');
  assert.equal(konfliktDue(plan, new Date('2026-11-04T06:30:00Z')), false, 'Wednesday');
  assert.equal(konfliktDue(plan, new Date('2026-11-03T23:30:00Z')), false, 'Wednesday 00:30 CET');
  assert.equal(konfliktDue(plan, new Date('2026-07-07T05:30:00Z')), true, 'Tuesday 07:30 CEST (summer time)');
});
