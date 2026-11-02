import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { trimAvisData, readDagenSource, sourcePathFor, dagFraUge } from '../../src/rooms/dagen/source.ts';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/avis_data_sample.json', import.meta.url), 'utf8'));

test('sourcePathFor substitutes {date} with the Copenhagen date', () => {
  // 23:30 UTC on the 25th is already the 26th in Copenhagen (CET, UTC+1 in late October)
  assert.equal(sourcePathFor('/tmp/avis_data_{date}.json', new Date('2026-10-25T23:30:00Z')), '/tmp/avis_data_2026-10-26.json');
});

test('trimAvisData keeps timed calendar events with time strings and drops task/health raw payloads', () => {
  const t = trimAvisData(fixture);
  assert.equal(t.kalender.length, 3);
  assert.deepEqual(t.kalender[0], { titel: 'Driften: vinterberedskab', start: '10.00', slut: '11.00', kalender: 'Arbejde', sted: 'Mødelokale 3' });
  assert.equal(t.kalender[2]?.heldag, true);
  assert.equal(t.helbred, 'stabil');
  assert.equal((t as Record<string, unknown>)['health'], undefined);
});

test('trimAvisData flattens news items across sources, newest first, capped at 30, without tasks', () => {
  const t = trimAvisData(fixture);
  assert.equal(t.nyheder.length, 5);
  assert.equal(t.nyheder[0]?.kilde, 'Eksempel Energi');
  assert.equal(t.nyheder[0]?.titel, 'Eksempel Energi strammer reserver i vinter');
  assert.ok(t.nyheder.every((n) => n.kilde !== 'google_tasks'));
});

test('trimAvisData carries the commitment radar and mail attention counts, never mail bodies', () => {
  const t = trimAvisData(fixture);
  assert.deepEqual(t.forpligtelser, [{ titel: 'Ring til elektriker om tilbud', frist: '2026-10-27', kilde: 'tasks' }]);
  assert.equal(t.mail.venter, 2);
  assert.deepEqual(t.mail.emner, ['Tilbud på ny eltavle', 'Forældremøde 3.b']);
});

test('readDagenSource returns null when the file for today is missing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-'));
  try {
    const r = await readDagenSource(path.join(dir, 'avis_{date}.json'), new Date('2026-10-26T06:00:00Z'));
    assert.equal(r, null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('readDagenSource reads and trims the file for today', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-'));
  try {
    await writeFile(path.join(dir, 'avis_2026-10-26.json'), JSON.stringify(fixture));
    const r = await readDagenSource(path.join(dir, 'avis_{date}.json'), new Date('2026-10-26T06:00:00Z'));
    assert.equal(r?.dato, '2026-10-26');
    assert.equal(r?.kalender.length, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// KC-0133: no morning paper (a product install) — today's events from the connected calendar's week build the day.
test('dagFraUge: today\'s events from the kalender_uge week, trimmed like the morning paper\'s calendar; null without today', () => {
  const uge = { generated: '2026-10-31T07:58:00+01:00', days: [
    { date: '2026-10-31', events: [
      { start: '2026-10-31', end: '2026-11-01', all_day: true, title: 'Maja: nattevagt', calendar: 'Familie', location: null },
      { start: '2026-10-31T09:00:00+01:00', end: '2026-10-31T09:15:00+01:00', all_day: false, title: 'Stand-up', calendar: 'Arbejde', location: 'Mødelokale 1', creator: 'c@example.test', attendees: [] },
    ] },
    { date: '2026-11-01', events: [{ start: '2026-11-01T10:00:00+01:00', all_day: false, title: 'I morgen' }] },
  ], errors: [] };
  const d = dagFraUge(uge, new Date('2026-10-31T07:00:00Z'));
  assert.deepEqual(d, {
    dato: '2026-10-31', hentet: '2026-10-31T07:58:00+01:00',
    kalender: [{ titel: 'Maja: nattevagt', start: '2026-10-31', kalender: 'Familie', heldag: true }, { titel: 'Stand-up', start: '09.00', slut: '09.15', kalender: 'Arbejde', sted: 'Mødelokale 1' }],
    nyheder: [], forpligtelser: [], mail: { venter: 0, emner: [] },
  });
  assert.equal(dagFraUge(uge, new Date('2026-11-05T07:00:00Z')), null);
  assert.equal(dagFraUge(null, new Date('2026-10-31T07:00:00Z')), null);
});
