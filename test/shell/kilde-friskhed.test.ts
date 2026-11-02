// KC-0139: a source's elements are never shown as fresh when its last successful read
// is older than its freshness window or the source is not working: the label says
// "Sidst hentet 07.05" only while that holds, else "ikke opdateret siden …".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { erFrisk, kildeFriskhed } from '../../src/shell/friskhed.ts';
import { FRISKHEDSVINDUE_MS } from '../../src/kilder/helbred-tekst.ts';

const NU = new Date('2026-10-30T12:00:00Z'); // 13.00 in Copenhagen

test('working and read recently: "Sidst hentet" with the Copenhagen time, no warning', () => {
  const ud = String(kildeFriskhed({ slags: 'kalender', sidstLaest: '2026-10-30T06:05:00Z', ok: true }, NU));
  assert.match(ud, /data-sidst-hentet/);
  assert.match(ud, /Sidst hentet 07\.05/);
  assert.doesNotMatch(ud, /ikke opdateret|friskhed-gammel/);
});

test('an old read yields "ikke opdateret siden", even while the source is ok', () => {
  const gammel = new Date(NU.getTime() - FRISKHEDSVINDUE_MS.kalender - 3600_000).toISOString();
  assert.equal(erFrisk({ slags: 'kalender', sidstLaest: gammel, ok: true }, NU), false);
  const ud = String(kildeFriskhed({ slags: 'kalender', sidstLaest: gammel, ok: true }, NU));
  assert.match(ud, /data-ikke-opdateret/);
  assert.match(ud, /ikke opdateret siden /);
  assert.match(ud, /friskhed-gammel/);
});

test('a source that is not working is not fresh, however recent its last read', () => {
  const f = { slags: 'mail', sidstLaest: '2026-10-30T11:50:00Z', ok: false };
  assert.equal(erFrisk(f, NU), false);
  assert.match(String(kildeFriskhed(f, NU)), /ikke opdateret siden 12\.50/);
});

test('yesterday is named: "ikke opdateret siden i går 16.20"', () => {
  assert.match(String(kildeFriskhed({ slags: 'mail', sidstLaest: '2026-10-29T15:20:00Z', ok: false }, NU)), /ikke opdateret siden i går 16\.20/);
});

test('never read: nothing to call fresh, nothing to date', () => {
  assert.equal(erFrisk({ slags: 'mail', ok: true }, NU), false);
  assert.equal(String(kildeFriskhed({ slags: 'mail', ok: true }, NU)), '');
  assert.match(String(kildeFriskhed({ slags: 'mail', ok: false }, NU)), /ikke hentet endnu/);
});

test('an unreadable time is treated as never read', () => {
  assert.equal(erFrisk({ slags: 'mail', sidstLaest: 'i går', ok: true }, NU), false);
});
