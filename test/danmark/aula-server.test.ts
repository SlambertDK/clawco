// KC-0236 through the app: Aula in the Danmark-pakke. Start's group (the Aula card beside Digital Post's step; "Ikke nu";
// gone once connected; never a first source in step 3), the shared week (the institution label; who sees it is the role
// matrix's call) and Nu (today and tomorrow, owner/member/child yes, guest no, none when nothing is due, no handling).
// Invented titles and institutions; the Aula file is served by a scripted fetcher.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/server.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { skrivHusstand } from '../../src/identitet/husstand.ts';
import { aulaKalender, AULA_KALENDER_ID } from '../../src/kilder/aula-kalender/kilde.ts';
import { falskHenter, LINK } from '../kilder/aula-kalender/hjaelp.ts';
import { forbiTil, FORBI_KILDER, type Forbi } from '../helpers/start-forbi.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-aula-pakke-'));
const apps: { helbred: { tom(): Promise<void> } }[] = [];
after(async () => { await Promise.all(apps.map((a) => a.helbred.tom())); await rm(rod, { recursive: true, force: true }); });

const NU = new Date('2026-11-02T08:00:00Z'); // 09:00 in Copenhagen, a Monday
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const som = (l: string): RequestInit => ({ headers: { 'Tailscale-User-Login': l } });
const HENRIK = { id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' as const };
const MAJA = { id: 'maja', login: 'maja@example.com', navn: 'Maja', rolle: 'medlem' as const };
const ELLA = { id: 'ella', login: 'ella@example.com', navn: 'Ella', rolle: 'barn' as const };
const FARMOR = { id: 'farmor', login: 'farmor@example.com', navn: 'Farmor', rolle: 'gaest' as const };
const PERSONER = [HENRIK, MAJA, ELLA, FARMOR];

const med = (...l: string[]): string => `BEGIN:VEVENT\r\n${l.join('\r\n')}\r\nEND:VEVENT\r\n`;
const tz = 'TZID=Europe/Copenhagen';
/** The invented week of 2.–8. November: one over this morning, one later today, one tomorrow, one on Friday, one all-day next week-end. */
const ICS = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Kløvermarkskolen', ''].join('\r\n') + [
  med('UID:u1', 'SUMMARY:Morgensang', `DTSTART;${tz}:20261102T073000`, `DTEND;${tz}:20261102T081500`),
  med('UID:u2', 'SUMMARY:Idrætsdag i 2.B', `DTSTART;${tz}:20261102T130000`, `DTEND;${tz}:20261102T143000`, 'LOCATION:Idrætsanlægget', 'ORGANIZER;CN=Lærer Lund:mailto:lund@skole.example', 'DESCRIPTION:HEMMELIG'),
  med('UID:u3', 'SUMMARY:Skolefoto', `DTSTART;${tz}:20261103T090000`, `DTEND;${tz}:20261103T100000`),
  med('UID:u4', 'SUMMARY:Sommerfest i børnehaven', `DTSTART;${tz}:20261106T150000`, `DTEND;${tz}:20261106T170000`),
].join('') + 'END:VCALENDAR\r\n';

let nr = 0;
async function lav(o: { personer?: typeof PERSONER | null; tid?: { nu: Date }; forbi?: Forbi } = {}) {
  const dataDir = path.join(rod, `t${++nr}`);
  const ur = o.tid ?? { nu: NU };
  if (o.personer !== null) await skrivHusstand(dataDir, { personer: o.personer ?? PERSONER });
  if (o.forbi) await forbiTil(dataDir, o.forbi, { nu: NU }); // KC-0247: the pack waits until the first source works
  const sut = createApp({
    store: createFileStore(dataDir), hermes: createFakeAgent({ answer: () => 'ok' }), sourceGlob: '/nonexistent/{date}.json', dataDir, sha: 'abc', now: () => ur.nu,
    mailRunner: async () => ({ code: 1, stdout: '', stderr: 'ingen' }), mailStateDir: '/nonexistent', kilder: [aulaKalender({ hent: falskHenter({ tekst: ICS }), ur: () => ur.nu.getTime() }), ...(o.forbi ? FORBI_KILDER() : [])],
    danmark: { cacheMs: 0 },
  });
  apps.push(sut);
  const side = async (p: { login: string }, url: string): Promise<{ status: number; h: string }> => { const r = await sut.app.request(url, som(p.login), LOOPBACK); return { status: r.status, h: await r.text() }; };
  const post = (p: { login: string }, url: string, body: unknown = {}) => sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'Tailscale-User-Login': p.login }, body: JSON.stringify(body) }, LOOPBACK);
  const aktion = async (p: { login: string }, navn: string): Promise<Response> => {
    const r = await post(p, `/api/rum/start/aktion/${navn}`, {});
    if (r.status === 202) { const { runId } = (await r.clone().json()) as { runId: string }; await sut.runs.get(runId)?.finished; }
    return r;
  };
  const forbind = async (): Promise<void> => { assert.equal((await post(HENRIK, `/api/kilder/${AULA_KALENDER_ID}/forbind`, { felter: { link: LINK } })).status, 200); };
  const fil = async (): Promise<{ aulaAfvist?: string }> => JSON.parse(await readFile(path.join(dataDir, 'danmark', 'digital-post.json'), 'utf8'));
  return { dataDir, sut, side, post, aktion, forbind, fil, ur };
}
const antal = (h: string, re: RegExp): number => (h.match(re) ?? []).length;
/** The Nu page's Aula part: the group's own markup. */
const aulaDel = (h: string): string => {
  const i = h.indexOf('data-gruppe="Aula"');
  if (i < 0) return '';
  const rest = h.slice(i + 10);
  const slut = rest.search(/<section|<\/main>|data-gruppe=|data-baand=/);
  return h.slice(i, slut < 0 ? undefined : i + 10 + slut);
};

// ---------- Start ----------

test('Start, the first source working (KC-0247), Aula not connected: the pack\'s group with Aula\'s card — once, headed "Danmark-pakke", and not among step 3\'s offers', async () => {
  const t = await lav({ forbi: 'foerste-kilde' });
  const { h } = await t.side(HENRIK, '/rum/start');
  assert.equal(antal(h, /data-danmark-pakke/g), 1);
  assert.match(h, /<h3 class="eyebrow">Danmark-pakke<\/h3>/);
  assert.equal(antal(h, /data-kilde-kort="aula-kalender"/g), 1, 'the card is in the pack only');
  assert.ok(h.indexOf('data-kilde-kort="aula-kalender"') > h.indexOf('data-danmark-pakke'), 'inside the group');
  assert.match(h, /data-aktion="aula-ikke-nu"/);
  assert.match(h, /data-kilde-trin="aula-kalender"/);
});

test('Start: Aula\'s card is the owner\'s — a member and a child see no group (nothing to do), the guest cannot reach it', async () => {
  const t = await lav();
  for (const p of [MAJA, ELLA]) assert.doesNotMatch((await t.side(p, '/rum/start')).h, /data-danmark-pakke|Danmark-pakke/, p.id);
});

test('Start: "Ikke nu" puts the card away — the group is gone entirely (nothing else in it) — and it returns after 30 days; a member cannot', async () => {
  const t = await lav({ forbi: 'foerste-kilde' });
  assert.equal((await t.aktion(MAJA, 'aula-ikke-nu')).status, 403);
  await assert.rejects(() => t.fil(), /ENOENT/);
  assert.equal((await t.aktion(HENRIK, 'aula-ikke-nu')).status, 202);
  assert.ok((await t.fil()).aulaAfvist);
  const efter = (await t.side(HENRIK, '/rum/start')).h;
  assert.doesNotMatch(efter, /data-danmark-pakke|Danmark-pakke|data-kilde-kort="aula-kalender"/);
  t.ur.nu = new Date(NU.getTime() + 31 * 86_400_000);
  assert.match((await t.side(HENRIK, '/rum/start')).h, /data-danmark-pakke/);
});

test('Start: once Aula is connected the card and the group are gone, and Aula alone never completes step 3 (it is not a first source)', async () => {
  const t = await lav();
  await t.forbind();
  const { h } = await t.side(HENRIK, '/rum/start');
  assert.doesNotMatch(h, /data-danmark-pakke|data-kilde-kort="aula-kalender"/);
  assert.doesNotMatch(h, /Aula er forbundet/);
});

test('Start: an install with no data folder offers no Aula card (there is nowhere to keep "Ikke nu" or the link)', async () => {
  const sut = createApp({ store: createFileStore(path.join(rod, 'uden-mappe')), hermes: createFakeAgent({ answer: () => 'ok' }), sourceGlob: '/nonexistent/{date}.json', now: () => NU, mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent' });
  assert.doesNotMatch(await (await sut.app.request('/rum/start')).text(), /data-danmark-pakke/);
});

// ---------- the shared week ----------

test('the shared week: the owner, a member and a child see the events with the institution as the label; the guest has no Husstanden at all', async () => {
  const t = await lav();
  await t.forbind();
  for (const p of [HENRIK, MAJA, ELLA]) {
    const { status, h } = await t.side(p, '/rum/husstand');
    assert.equal(status, 200, p.id);
    for (const titel of ['Idrætsdag i 2.B', 'Skolefoto', 'Sommerfest i børnehaven']) assert.ok(h.includes(titel), `${p.id}: ${titel}`);
    assert.equal(antal(h, /data-uge-institution>· Kløvermarkskolen<\/span>/g), 4, `${p.id}: one label per event`);
    for (const forbudt of ['HEMMELIG', 'lund@skole.example', 'Lærer Lund']) assert.ok(!h.includes(forbudt), `${p.id}: ${forbudt}`);
  }
  const g = await t.side(FARMOR, '/rum/husstand');
  assert.equal(g.status, 404);
  for (const titel of ['Idrætsdag', 'Skolefoto', 'Kløvermarkskolen']) assert.ok(!g.h.includes(titel), `guest: ${titel}`);
});

// ---------- Nu ----------

test('Nu: today\'s and tomorrow\'s events, one element each, for the owner, a member and a child — not the one that is over, not Friday\'s', async () => {
  const t = await lav();
  await t.forbind();
  for (const p of [HENRIK, MAJA, ELLA]) {
    const { status, h } = await t.side(p, '/rum/hjem');
    assert.equal(status, 200, p.id);
    const a = aulaDel(h);
    assert.match(a, /I dag: Idrætsdag i 2\.B \(Kløvermarkskolen, kl\. 13\.00\)/, p.id);
    assert.match(a, /I morgen: Skolefoto \(Kløvermarkskolen, kl\. 09\.00\)/, p.id);
    assert.equal(antal(a, /data-aula-kort=/g), 2, p.id);
    assert.ok(!a.includes('Morgensang') && !a.includes('Sommerfest'), `${p.id}: over / not yet`);
    assert.match(a, /data-datazone="husstand"/);
    for (const forbudt of ['HEMMELIG', 'lund@skole.example', 'Lærer Lund']) assert.ok(!h.includes(forbudt), `${p.id}: ${forbudt}`);
  }
});

test('Nu: the guest sees no Aula at all (the week is not hers)', async () => {
  const t = await lav();
  await t.forbind();
  const { status, h } = await t.side(FARMOR, '/rum/hjem');
  assert.equal(status, 200);
  for (const s of ['Idrætsdag', 'Skolefoto', 'Kløvermarkskolen', 'data-aula', 'data-gruppe="Aula"']) assert.ok(!h.includes(s), s);
});

test('INVARIANT Nu: the Aula element has no handling — nothing to press, nothing for Hermes — and it is not something that waits', async () => {
  const t = await lav();
  await t.forbind();
  const { h } = await t.side(HENRIK, '/rum/hjem');
  const a = aulaDel(h);
  assert.ok(a.length > 0);
  for (const forbudt of ['<button', 'data-handling', 'data-aktion', 'data-spoerg', 'data-instruktion', '<form']) assert.ok(!a.includes(forbudt), forbudt);
  const k = h.indexOf('data-baand="kraever"');
  const kraever = k < 0 ? '' : h.slice(k, h.indexOf('<!--/baand-->', k));
  assert.ok(!kraever.includes('data-aula-kort'), 'not in Kræver dig');
});

test('Nu: the event leaves the screen when it is over, the next day takes over, and a day with nothing due has no group at all', async () => {
  const t = await lav();
  await t.forbind();
  t.ur.nu = new Date('2026-11-02T14:00:00Z'); // 15:00: Idrætsdag ended 14:30
  let a = aulaDel((await t.side(HENRIK, '/rum/hjem')).h);
  assert.ok(!a.includes('Idrætsdag') && a.includes('I morgen: Skolefoto'));
  t.ur.nu = new Date('2026-11-03T12:00:00Z'); // Tuesday 13:00: Skolefoto ended 10:00; Friday's is still 3 days away
  const h = (await t.side(HENRIK, '/rum/hjem')).h;
  a = aulaDel(h);
  assert.equal(a, '');
  assert.doesNotMatch(h, /data-gruppe="Aula"|data-aula-kort/);
});

test('Nu: Aula not connected (or no household at all): no element and no group', async () => {
  const t = await lav();
  assert.doesNotMatch((await t.side(HENRIK, '/rum/hjem')).h, /data-aula-kort|data-gruppe="Aula"/);
  const e = await lav({ personer: null });
  const r = await e.sut.app.request(`/api/kilder/${AULA_KALENDER_ID}/forbind`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ felter: { link: LINK } }) });
  assert.equal(r.status, 200);
  const h = await (await e.sut.app.request('/rum/hjem')).text();
  assert.match(aulaDel(h), /I dag: Idrætsdag i 2\.B/, 'a single-user install: the owner sees today\'s event in Nu');
});

test('Nu: an Aula connection the owner kept in privat is the owner\'s alone — a member sees nothing of it in Nu or in the week (zones are never crossed)', async () => {
  const t = await lav();
  assert.equal((await t.post(HENRIK, `/api/kilder/${AULA_KALENDER_ID}/forbind`, { felter: { link: LINK }, zone: 'privat' })).status, 200);
  const ejer = aulaDel((await t.side(HENRIK, '/rum/hjem')).h);
  assert.match(ejer, /I dag: Idrætsdag i 2\.B/);
  assert.match(ejer, /data-datazone="privat"/);
  for (const p of [MAJA, ELLA]) {
    assert.ok(!(await t.side(p, '/rum/hjem')).h.includes('Idrætsdag'), `${p.id}: Nu`);
    assert.ok(!(await t.side(p, '/rum/husstand')).h.includes('Idrætsdag'), `${p.id}: the week`);
  }
});
