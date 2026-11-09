// KC-0126: the world variant kold. "Kold start" is a fresh install (nothing on
// disk, nothing connected): / lands in Start, Start is in the nav, step 1 open.
// "Velkommen klaret": step 1 Klaret and the calendar suggested. The day's own
// moments are past onboarding: Start is out of the nav.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lavTestverden } from '../../src/testtilstand/verden.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-kold-'));
after(() => rm(rod, { recursive: true, force: true }));
const verden = lavTestverden({ dataDir: path.join(rod, 'data-test'), delayMs: 0 });
const side = async (sti: string): Promise<string> => (await (await verden).app.request(sti)).text();
const iNav = (h: string): boolean => /<li><a href="\/rum\/start"/.test(h);

test('Kold start: / lands in Start, Start is in the nav, step 0 (the pick) open, nothing connected', async () => {
  const v = await verden;
  assert.deepEqual(await v.hop('kold'), { url: '/rum/start' });
  assert.equal((await v.app.request('/')).headers.get('location'), '/rum/start');
  const h = await side('/rum/start');
  assert.ok(iNav(h));
  assert.match(h, /data-trin="situation" data-trin-status="ikke-startet"/);
  assert.match(h, /data-situation="mail"[\s\S]*data-situation="familie"[\s\S]*data-situation="alt"/, 'the three picks');
  assert.doesNotMatch(h, /id="velkommen-form"/, 'step 1 waits');
  const k = (await (await v.app.request('/api/kilder')).json()) as { kilder: { forbundet: boolean }[] };
  assert.ok(k.kilder.length > 0 && k.kilder.every((x) => !x.forbundet), 'nothing connected');
});

// KC-0248: step 0 in the world — a pick not yet gone on with, the same on a fresh English installation, and the pick gone on with.
test('Kold start: valgt, ikke gået videre — the pick is pressed, its example stands under the picks, Gå videre is offered', async () => {
  const v = await verden;
  assert.deepEqual(await v.hop('kold-situation'), { url: '/rum/start' });
  const h = await side('/rum/start');
  assert.match(h, /data-trin="situation" data-trin-status="i-gang"/);
  assert.match(h, /data-situation="familie" aria-pressed="true"/);
  assert.match(h, /data-eksempel="familie"/);
  assert.equal((h.match(/data-eksempel-kort/g) ?? []).length, 3);
  assert.equal((h.match(/Eksempel<\/span>/g) ?? []).length, 3, 'every example card is marked');
  assert.match(h, /Lørdag: to ting kl\. 10/);
  assert.equal((h.match(/<li>Clawco (betaler|sender|sletter) aldrig/g) ?? []).length, 3, 'the three refusals');
  assert.match(h, /data-aktion="situation-bekraeft"/);
});

test('Kold start: ny installation på engelsk — the whole step 0 is English, the example and the refusals too', async () => {
  const v = await verden;
  assert.deepEqual(await v.hop('kold-situation-engelsk'), { url: '/rum/start' });
  const h = await side('/rum/start');
  assert.match(h, /<html lang="en">/);
  assert.match(h, /What should Clawco take off your plate\?/);
  assert.match(h, /data-eksempel="mail"/);
  assert.match(h, /Statistics 2 hand-in/);
  assert.match(h, /Clawco never pays for anything on your behalf\./);
  assert.doesNotMatch(h, /Clawco betaler aldrig/);
  await v.hop('kold-situation');
  assert.match(await side('/rum/start'), /<html lang="da">/);
});

test('Kold start: valget klaret — step 0 folded to its pick, step 1 is the open step', async () => {
  const v = await verden;
  assert.deepEqual(await v.hop('kold-situation-klaret'), { url: '/rum/start' });
  const h = await side('/rum/start');
  assert.match(h, /data-trin="situation" data-trin-status="klaret"/);
  assert.match(h, /data-situation-valgt="familie"/);
  assert.match(h, /data-trin="velkommen" data-trin-status="ikke-startet" data-trin-aaben/);
  assert.match(h, /id="velkommen-form"/);
});

test('Kold start: velkommen klaret — step 1 Klaret, the calendar suggested', async () => {
  const v = await verden;
  await v.hop('kold-velkommen');
  const h = await side('/rum/start');
  assert.match(h, /data-trin="velkommen" data-trin-status="klaret"/);
  assert.match(h, /data-forslag-kilde="falsk-kalender"/);
  assert.ok(iNav(await side('/rum/hjem')), 'Start still in the nav: the journey is not Done');
});

// KC-0127: step 2 open, failing (the Danish reason) and passing.
const modelKort = (h: string): string => /<article[^>]*data-trin="model"[\s\S]*?<\/article>/.exec(h)?.[0] ?? '';

test('Kold start: step 2 is open with the provider form', async () => {
  const v = await verden;
  await v.hop('kold-velkommen');
  const kort = modelKort(await side('/rum/start'));
  assert.match(kort, /data-trin-status="ikke-startet"/);
  assert.match(kort, /id="model-form"/);
});

test('Kold start: nøglen afvist — both tiers failed with the Danish reason; a retest fails again (scripted 401)', async () => {
  const v = await verden;
  await v.hop('kold-model-fejl');
  const kort = modelKort(await side('/rum/start'));
  assert.doesNotMatch(kort, /data-trin-status="klaret"/);
  assert.match(kort, /data-model-test="fejl"/);
  assert.match(kort, /Nøglen er afvist\./);
  const res = await v.app.request('/api/rum/start/aktion/model-test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tier: 'lille' }) });
  assert.equal(res.status, 202);
  // The seeded failure took 412 ms; the scripted retest replaces it (and fails again).
  const lille = async () => ((await (await v.app.request('/api/indstillinger')).json()) as { modelTest?: { lille?: { ok: boolean; ms: number; fejl?: string } } }).modelTest?.lille;
  for (let i = 0; i < 50 && (await lille())?.ms === 412; i++) await new Promise((r) => setTimeout(r, 20));
  const t = await lille();
  assert.notEqual(t?.ms, 412, 'retested');
  assert.deepEqual([t?.ok, t?.fejl], [false, 'noegle']);
  assert.match(modelKort(await side('/rum/start')), /data-model-tier="lille" data-model-test="fejl"/);
});

test('Kold start: modellen virker — step 2 Klaret with Virker and the time', async () => {
  const v = await verden;
  await v.hop('kold-model');
  const kort = modelKort(await side('/rum/start'));
  assert.match(kort, /data-trin-status="klaret"/);
  assert.match(kort, /data-model-test="ok"/);
  assert.match(kort, /Virker · 0,8 s/);
});

test('the day is past onboarding: Start is out of the nav and / goes to Nu', async () => {
  const v = await verden;
  await v.hop('morgen');
  assert.ok(!iNav(await side('/rum/hjem')));
  assert.equal((await v.app.request('/')).headers.get('location'), '/rum/hjem');
});

// KC-0131: the scripted Hermes answers in the cold world too — the rebuilds a first source starts (Dagen, Mail),
// Kuratoren and the chat in Nu — with what the real parsers accept. The cold calendar is the morning's, so Dagen is
// the morning; Kuratoren has the one card a calendar alone gives; the cold mail folders are empty, so Mail decides nothing.
test('KC-0131: the cold world\'s scripted Hermes answers Dagen, Mail, Kuratoren and the chat in Nu', async () => {
  const { svar } = await import('../../src/testtilstand/indhold.ts');
  const { KOLD_START } = await import('../../src/testtilstand/indhold/start.ts');
  const { fakta } = await import('../../src/testtilstand/indhold/fakta.ts');
  const { kildeData } = await import('../../src/testtilstand/indhold/kilder.ts');
  const { dagFraUge } = await import('../../src/rooms/dagen/source.ts');
  const { trimUge } = await import('../../src/rooms/dagen/uge.ts');
  const { buildRefreshRun } = await import('../../src/rooms/dagen/prompt.ts');
  const { kraevJson, parseDagenState } = await import('../../src/rooms/dagen/schema.ts');
  const { buildMailRefreshRun } = await import('../../src/rooms/mail/prompt.ts');
  const { parseMailState } = await import('../../src/rooms/mail/schema.ts');
  const { buildKuratorRun } = await import('../../src/kurator/prompt.ts');
  const { parseKuratorSvar } = await import('../../src/rooms/hjem/kort.ts');
  const { buildHjemChatRun } = await import('../../src/rooms/hjem/prompt.ts');
  const dag = '2026-10-29';
  const f = fakta(dag);
  const d = new Date(f.iso('09:16'));
  const uge = kildeData(0, f).kalender;
  const data = dagFraUge(uge, d);
  assert.ok(data, 'the cold calendar gives a day');
  const tom = { handling: [], ordnet: [], tal: { handling: 0, afventer: 0, regninger: 0, sorteretIDag: 0 } };
  for (const moment of KOLD_START) {
    const ctx = { moment, dag };
    const dagen = parseDagenState(kraevJson(svar(buildRefreshRun(data, d, trimUge(uge)), ctx)), d);
    assert.ok(dagen.kalender.length >= 1, `${moment.id}: Dagen has the calendar`);
    const mail = parseMailState(kraevJson(svar(buildMailRefreshRun(tom as never, d), ctx)), { tal: tom.tal, ordnet: [] } as never, d, null);
    assert.equal(mail.beslutninger.length, 0, `${moment.id}: the cold mail folders are empty`);
    const kort = parseKuratorSvar(kraevJson(svar(buildKuratorRun({ mails: [], nyheder: [], aabne: [], dyb: false, now: d, stier: { vault: '' } }), ctx))).nye;
    assert.equal(kort.length, 1, `${moment.id}: one card from the calendar`);
    assert.ok(svar(buildHjemChatRun('Hvad står der nu?', 'Overblik', d, kort.map((k) => ({ id: k.id, titel: k.titel, betyder: k.betyder }))), ctx).trim().length > 5);
  }
});

test('KC-0131: rejsen gennemført — every step Klaret, Start out of the nav, Dagen in Nu', async () => {
  const v = await verden;
  assert.deepEqual(await v.hop('kold-faerdig'), { url: '/rum/hjem' });
  const hjem = await side('/rum/hjem');
  assert.ok(!iNav(hjem), 'Start has folded away');
  assert.equal((await v.app.request('/')).headers.get('location'), '/rum/hjem');
  assert.match(hjem, /data-id="venter:dagen"/);
  assert.doesNotMatch(hjem, /data-forhaandsvisning=/, 'both previews were replaced');
  const h = await side('/rum/start');
  for (const id of ['velkommen', 'model', 'foerste-kilde', 'flere-kilder']) assert.match(h, new RegExp(`data-trin="${id}" data-trin-status="klaret"`), id);
  const k = (await (await v.app.request('/api/kilder')).json()) as { kilder: { id: string; forbundet: boolean }[] };
  assert.deepEqual(k.kilder.filter((x) => x.forbundet).map((x) => x.id).sort(), ['falsk-kalender', 'falsk-mail']);
});

// KC-0170: the screen in English — step 1 saved with English, so Start, the nav and the chat are English.
test('Kold start: på engelsk — the profile chose English, the whole screen is English', async () => {
  const v = await verden;
  assert.deepEqual(await v.hop('kold-engelsk'), { url: '/rum/start' });
  const h = await side('/rum/start');
  assert.match(h, /<html lang="en">/);
  assert.match(h, /data-trin="velkommen" data-trin-status="klaret"/);
  assert.match(h, /Hermes answers in English/);
  assert.match(h, /<span>Now<\/span>/);
  assert.match(h, /Ask Hermes/);
  await v.hop('kold-velkommen');
  assert.match(await side('/rum/start'), /<html lang="da">/);
});
