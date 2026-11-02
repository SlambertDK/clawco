// KC-0133: Google's calendarList + events.list → exactly the JSON
// scripts/kalender_uge.py prints, so Dagen's trimUge reads it unchanged.
// Fixture API answers cover an all-day event, a multi-day one that began
// before the window, a night event around midnight Copenhagen, a declined
// invite, a resource attendee, one calendar failing, paging, a 401 that is
// refreshed once, and the window across the end of summer time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laesUge } from '../../../src/kilder/google-kalender/laes.ts';
import type { Hent } from '../../../src/kilder/google/oauth.ts';
import { KildeFejl } from '../../../src/kilder/types.ts';
import { trimUge } from '../../../src/rooms/dagen/uge.ts';

const NU = new Date('2026-10-31T10:00:00Z'); // Saturday, winter time (+01:00)
const API = 'https://www.googleapis.com/calendar/v3';

const KALENDERE = {
  items: [
    { id: 'ella@example.test', summary: 'ella@example.test', primary: true },
    { id: 'familie#abc@group.calendar.google.com', summary: 'Familie' },
    { id: 'arbejde@group.calendar.google.com', summary: 'Work', summaryOverride: 'Arbejde' },
  ],
};
const EVENTS: Record<string, unknown[]> = {
  'ella@example.test': [
    { id: 'e1', status: 'confirmed', summary: 'Stand-up', start: { dateTime: '2026-10-31T09:00:00+01:00' }, end: { dateTime: '2026-10-31T09:15:00+01:00' }, location: 'Mødelokale 1', creator: { email: 'clara@example.test' }, description: 'HEMMELIG BESKRIVELSE', hangoutLink: 'https://meet.example/xyz',
      attendees: [{ email: 'ella@example.test', displayName: 'Ella', self: true, responseStatus: 'accepted' }, { email: 'rum1@resource.calendar.google.com', displayName: 'Rum 1', resource: true }, { email: 'clara@example.test' }] },
    { id: 'e2', status: 'confirmed', summary: 'Afvist møde', start: { dateTime: '2026-10-31T13:00:00+01:00' }, end: { dateTime: '2026-10-31T14:00:00+01:00' }, attendees: [{ email: 'ella@example.test', self: true, responseStatus: 'declined' }] },
    // 23:30 UTC on 31 Oct is 00:30 on 1 Nov in Copenhagen.
    { id: 'e3', summary: 'Nattog', start: { dateTime: '2026-10-31T23:30:00Z' }, end: { dateTime: '2026-11-01T01:00:00Z' } },
    { id: 'e4', status: 'cancelled', summary: 'Aflyst', start: { dateTime: '2026-11-02T10:00:00+01:00' }, end: { dateTime: '2026-11-02T11:00:00+01:00' } },
    { id: 'e5', start: { dateTime: '2026-11-02T08:00:00+01:00' }, end: { dateTime: '2026-11-02T08:30:00+01:00' } },
  ],
  'familie#abc@group.calendar.google.com': [
    // Multi-day all-day event that began yesterday: it stands on the window's first day.
    { id: 'f1', summary: 'Maja: nattevagt hele ugen', start: { date: '2026-10-30' }, end: { date: '2026-11-03' } },
    { id: 'f2', summary: 'Ellas fødselsdag', start: { date: '2026-11-04' }, end: { date: '2026-11-05' } },
  ],
};

type Kald = { url: URL; auth: string };
function falskApi(o: { fejl?: Record<string, number>; sider?: boolean; udloebet?: number } = {}): { hent: Hent; kald: Kald[] } {
  const kald: Kald[] = [];
  let udloebet = o.udloebet ?? 0;
  const svar = (status: number, json: unknown) => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  const hent = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get('authorization') ?? '';
    kald.push({ url, auth });
    if (udloebet > 0 && auth === 'Bearer gammel') { udloebet -= 1; return svar(401, { error: { code: 401 } }); }
    const sti = url.pathname.replace('/calendar/v3', '');
    if (sti === '/users/me/calendarList') {
      if (o.fejl?.['liste']) return svar(o.fejl['liste'], { error: {} });
      return svar(200, KALENDERE);
    }
    const m = /^\/calendars\/([^/]+)\/events$/.exec(sti);
    if (!m) return svar(404, {});
    const id = decodeURIComponent(m[1]!);
    if (o.fejl?.[id]) return svar(o.fejl[id], { error: { code: o.fejl[id] } });
    const alle = EVENTS[id] ?? [];
    if (o.sider && alle.length > 1) {
      const side = url.searchParams.get('pageToken') === 'side2' ? 2 : 1;
      return svar(200, side === 1 ? { items: alle.slice(0, 1), nextPageToken: 'side2' } : { items: alle.slice(1) });
    }
    return svar(200, { items: alle });
  }) as Hent;
  return { hent, kald };
}
const adgang = async () => 'tok';

test('the read is exactly the kalender_uge.py shape: seven Copenhagen days, script keys only', async () => {
  const u = await laesUge({ hent: falskApi().hent, adgang, nu: NU });
  assert.deepEqual(Object.keys(u).sort(), ['days', 'errors', 'generated']);
  assert.equal(u.generated, '2026-10-31T11:00:00+01:00');
  assert.deepEqual(u.days.map((d) => d.date), ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
  assert.deepEqual(u.errors, []);
  for (const d of u.days) for (const e of d.events) assert.deepEqual(Object.keys(e).sort(), ['all_day', 'attendees', 'calendar', 'creator', 'end', 'id', 'location', 'start', 'title']);
  assert.ok(!JSON.stringify(u).includes('HEMMELIG'), 'no description');
  assert.ok(!JSON.stringify(u).includes('meet.example'), 'no conference link');
});

test('placement: all-day first, multi-day from the window start, midnight Copenhagen, declined and cancelled dropped', async () => {
  const u = await laesUge({ hent: falskApi().hent, adgang, nu: NU });
  const dag = (d: string) => u.days.find((x) => x.date === d)!.events;
  assert.deepEqual(dag('2026-10-31'), [
    { start: '2026-10-30', end: '2026-11-03', all_day: true, title: 'Maja: nattevagt hele ugen', calendar: 'Familie', location: null, creator: null, id: 'f1', attendees: [] },
    { start: '2026-10-31T09:00:00+01:00', end: '2026-10-31T09:15:00+01:00', all_day: false, title: 'Stand-up', calendar: 'ella@example.test', location: 'Mødelokale 1', creator: 'clara@example.test', id: 'e1',
      attendees: [{ name: 'Ella', email: 'ella@example.test', self: true }, { name: null, email: 'clara@example.test', self: false }] },
  ]);
  assert.deepEqual(dag('2026-11-01').map((e) => e['title']), ['Nattog']);
  assert.deepEqual(dag('2026-11-02').map((e) => e['title']), ['(uden titel)']);
  assert.deepEqual(dag('2026-11-04').map((e) => [e['title'], e['all_day']]), [['Ellas fødselsdag', true]]);
});

test('the window is Copenhagen midnight to midnight seven days on, across the end of summer time', async () => {
  const { hent, kald } = falskApi();
  await laesUge({ hent, adgang, nu: new Date('2026-10-24T10:00:00Z') });
  const ev = kald.find((k) => k.url.pathname.endsWith('/events'))!;
  assert.equal(ev.url.searchParams.get('timeMin'), '2026-10-24T00:00:00+02:00');
  assert.equal(ev.url.searchParams.get('timeMax'), '2026-10-31T00:00:00+01:00');
  assert.equal(ev.url.searchParams.get('singleEvents'), 'true');
  assert.equal(ev.url.searchParams.get('orderBy'), 'startTime');
  assert.equal(ev.auth, 'Bearer tok');
  assert.ok(kald.every((k) => k.url.href.startsWith(API)), 'only the calendar API');
});

test('one calendar failing goes to errors; the rest are read', async () => {
  const u = await laesUge({ hent: falskApi({ fejl: { 'familie#abc@group.calendar.google.com': 500 } }).hent, adgang, nu: NU });
  assert.deepEqual(u.errors, ['Familie: HTTP 500']);
  assert.ok(u.days[0]!.events.some((e) => e['title'] === 'Stand-up'));
  assert.ok(!u.days[0]!.events.some((e) => e['calendar'] === 'Familie'));
});

test('the calendar list failing is a KildeFejl 502, never an empty week', async () => {
  await assert.rejects(laesUge({ hent: falskApi({ fejl: { liste: 500 } }).hent, adgang, nu: NU }), (e) => e instanceof KildeFejl && e.status === 502);
});

test('paging: every page of a calendar is read', async () => {
  const { hent, kald } = falskApi({ sider: true });
  const u = await laesUge({ hent, adgang, nu: NU });
  assert.ok(kald.some((k) => k.url.searchParams.get('pageToken') === 'side2'));
  assert.deepEqual(u.days.find((d) => d.date === '2026-11-02')!.events.map((e) => e['id']), ['e5']);
});

test('a 401 asks for a fresh token once and retries', async () => {
  let gange = 0;
  const frisk = async (ny?: boolean) => { if (ny) gange += 1; return ny ? 'ny' : 'gammel'; };
  const u = await laesUge({ hent: falskApi({ udloebet: 1 }).hent, adgang: frisk, nu: NU });
  assert.equal(gange, 1);
  assert.ok(u.days[0]!.events.length > 0);
});

test('Dagen reads it unchanged: trimUge gives Danish times, calendar names and errors', async () => {
  const t = trimUge(await laesUge({ hent: falskApi().hent, adgang, nu: NU }));
  assert.equal(t.dage.length, 7);
  assert.deepEqual(t.dage[0]!.aftaler.map((a) => a.tid), ['hele dagen', '09.00']);
  const { tid, slut, titel, oprettetAf, sted } = t.dage[0]!.aftaler[1]!;
  assert.deepEqual({ tid, slut, titel, oprettetAf, sted }, { tid: '09.00', slut: '09.15', titel: 'Stand-up', oprettetAf: 'clara@example.test', sted: 'Mødelokale 1' });
  assert.equal(t.dage[0]!.aftaler[0]!.kalender, 'Familie');
  const fejlet = trimUge(await laesUge({ hent: falskApi({ fejl: { 'familie#abc@group.calendar.google.com': 500 } }).hent, adgang, nu: NU }));
  assert.deepEqual(fejlet.fejl, ['Familie: HTTP 500']);
});
