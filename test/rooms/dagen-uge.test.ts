import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readUge, trimUge, type TrimmedUge } from '../../src/rooms/dagen/uge.ts';
import { parseDagenState } from '../../src/rooms/dagen/schema.ts';
import { renderDagen } from '../../src/rooms/dagen/render.ts';
import { buildRefreshRun } from '../../src/rooms/dagen/prompt.ts';
import type { TrimmedAvis } from '../../src/rooms/dagen/source.ts';

const raw = {
  generated: '2026-10-27T08:00:00+01:00',
  days: [
    { date: '2026-10-27', events: [{ start: '2026-10-27T13:00:00+01:00', end: '2026-10-27T16:30:00+01:00', all_day: false, title: 'Østre', calendar: 'henrik@example.com', location: null }] },
    { date: '2026-10-28', events: [{ start: '2026-10-28', end: '2026-10-29', all_day: true, title: 'Ida i Berlin', calendar: 'Family', location: null }, { start: '2026-10-28T18:00:00+01:00', end: '2026-10-28T19:00:00+01:00', all_day: false, title: 'reserver wow navne', calendar: 'henrik@example.com', location: 'Hjemme' }] },
    { date: '2026-10-29', events: [] },
  ],
  errors: ['Helligdage i Danmark: HTTPError'],
};

test('trimUge turns the script output into days with Danish times, calendar short names and errors', () => {
  const u = trimUge(raw);
  assert.equal(u.dage.length, 3);
  assert.deepEqual(u.dage[0], { dato: '2026-10-27', aftaler: [{ tid: '13.00', slut: '16.30', titel: 'Østre', kalender: 'Henrik' }] });
  assert.deepEqual(u.dage[1]?.aftaler[0], { tid: 'hele dagen', titel: 'Ida i Berlin', kalender: 'Family' });
  assert.equal(u.dage[1]?.aftaler[1]?.sted, 'Hjemme');
  assert.deepEqual(u.fejl, ['Helligdage i Danmark: HTTPError']);
});

test('readUge runs the script through the runner and returns null when it fails', async () => {
  const ok = await readUge(async (cmd, args) => ({ code: 0, stdout: JSON.stringify(raw), stderr: `${cmd} ${args.join(' ')}` }), '/x/kalender_uge.py');
  assert.equal(ok?.dage.length, 3);
  const bad = await readUge(async () => ({ code: 1, stdout: '', stderr: 'nope' }), '/x/kalender_uge.py');
  assert.equal(bad, null);
});

test('parseDagenState accepts ugen with a note per day and keeps at most 7 days', () => {
  const base = { dato: '2026-10-27', treLinjer: ['a'], anbefaling: { tekst: 'b' }, kalender: [], morgenavis: [], hermesStatus: 'x' };
  const ugen = Array.from({ length: 9 }, (_, i) => ({ dato: `2026-11-0${i + 1}`, note: `Note ${i}`, aftaler: [{ tid: '10.00', titel: `A${i}`, kalender: 'Family' }] }));
  const s = parseDagenState({ ...base, ugen }, new Date());
  assert.equal(s.ugen?.length, 7);
  assert.equal(s.ugen?.[0]?.note, 'Note 0');
  assert.equal(s.ugen?.[0]?.aftaler[0]?.kalender, 'Family');
  assert.equal(parseDagenState(base, new Date()).ugen, undefined);
});

test('renderDagen shows Ugen frem with day notes and events', () => {
  const s = parseDagenState({ dato: '2026-10-27', treLinjer: ['a'], anbefaling: { tekst: 'b' }, kalender: [], morgenavis: [], hermesStatus: 'x',
    ugen: [{ dato: '2026-10-28', note: 'Ida er i Berlin; du har aftenen fri.', aftaler: [{ tid: 'hele dagen', titel: 'Ida i Berlin', kalender: 'Family' }] }] }, new Date());
  const out = String(renderDagen(s, [], new Date()));
  assert.match(out, /Ugen frem/);
  assert.match(out, /data-element="Onsdag 28\. okt"/);
  assert.match(out, /Ida er i Berlin; du har aftenen fri\./);
  assert.match(out, /Ida i Berlin/);
});

test('buildRefreshRun passes the week and asks for ugen notes', () => {
  const trimmed: TrimmedAvis = { dato: '2026-10-27', hentet: 'x', kalender: [], nyheder: [], forpligtelser: [], mail: { venter: 0, emner: [] } };
  const uge: TrimmedUge = trimUge(raw);
  const r = buildRefreshRun(trimmed, new Date(), uge);
  assert.match(r.instructions, /"ugen"/);
  assert.match(r.instructions, /familie/i);
  assert.ok(r.input.includes('Ida i Berlin'));
});

test('KC-0027: the week carries who created each event (for Hermes to tell whose it is), and the page never shows the address', () => {
  const u = trimUge({ generated: '2026-10-27T08:00:00+01:00', days: [{ date: '2026-10-28', events: [
    { start: '2026-10-28T16:30:00+01:00', end: '2026-10-28T18:00:00+01:00', all_day: false, title: 'Liva', calendar: 'Family', location: null, creator: 'nora@example.com' },
    { start: '2026-10-28T17:00:00+01:00', end: '2026-10-28T18:00:00+01:00', all_day: false, title: 'Træning', calendar: 'Family', location: null, creator: 'rikke@example.com' },
    { start: '2026-10-28T19:00:00+01:00', end: '2026-10-28T20:00:00+01:00', all_day: false, title: 'Uden opretter', calendar: 'Family', location: null },
  ] }], errors: [] });
  assert.equal(u.dage[0]?.aftaler[0]?.oprettetAf, 'nora@example.com');
  assert.equal(u.dage[0]?.aftaler[1]?.oprettetAf, 'rikke@example.com');
  assert.equal(u.dage[0]?.aftaler[2]?.oprettetAf, undefined);
  const state = parseDagenState({ dato: '2026-10-27', treLinjer: ['a'], anbefaling: { tekst: 'b' }, kalender: [], morgenavis: [], hermesStatus: 'x',
    ugen: [{ dato: '2026-10-28', note: 'Freja til Liva, Maria træner.', aftaler: u.dage[0]?.aftaler }] }, new Date());
  assert.doesNotMatch(String(renderDagen(state, [], new Date())), /@example\.com/);
});
