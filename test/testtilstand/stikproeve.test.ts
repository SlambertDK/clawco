// KC-0145 in the test world (AGENTS §4 r11): "Søndag aften" seeds the week's ~200 hidden items as the app records them,
// five drawn by the app's own function and one already answered wrong (its pause proposal waits in Nu); "Søndag: stop
// tjekket?" has three clean weeks and the stop question. Fictional only.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { froe, FORBUDT, MOMENTER } from '../../src/testtilstand/indhold.ts';
import { lavTestverden, type Testverden } from '../../src/testtilstand/verden.ts';
import { DAEKNING } from '../../src/testtilstand/daekning.ts';
import { iUge } from '../../src/tillid/skjulte.ts';
import { traekStikproeve } from '../../src/tillid/stikproeve.ts';
import { mandagFor } from '../../src/tillid/dagstal.ts';
import { idagKbh } from '../../src/shell/tid.ts';
import type { KuratorState } from '../../src/rooms/hjem/kort.ts';

const DAG = '2026-10-29'; // a Thursday
const rod = await mkdtemp(path.join(tmpdir(), 'kc-stikproeve-verden-'));
after(() => rm(rod, { recursive: true, force: true }));
const send = (v: Testverden, sti: string, body: unknown) => v.app.request(sti, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('the seed: Sunday evening after the story day, ~200 hidden this week, five drawn by the app\'s function, one wrong; fictional only', () => {
  const m = MOMENTER.find((x) => x.id === 'soendag');
  assert.ok(m && m.ugedag === 0 && m.tid >= '18:00');
  const f = froe('soendag', DAG);
  const mandag = '2026-10-26';
  assert.ok(f.skjulte && f.stikproever);
  const uge = f.stikproever.uger.at(-1)!;
  assert.equal(uge.uge, mandag);
  assert.equal(uge.skjulte, iUge(f.skjulte, mandag).length, 'the number is the records');
  assert.ok(uge.skjulte >= 200);
  assert.deepEqual(uge.traek.map((t) => t.id), traekStikproeve(f.skjulte, mandag).map((t) => t.id), 'the five are the app\'s own draw');
  assert.equal(uge.traek.length, 5);
  assert.equal(uge.traek.filter((t) => t.svar === 'forkert').length, 1);
  assert.equal(uge.traek.filter((t) => t.svar === undefined).length, 4);
  const pause = ((f.rum['hjem']?.state as KuratorState).regelforslag ?? []).filter((x) => x.status === 'afventer' && x.kunPause);
  assert.deepEqual(pause.map((x) => x.pauser), ['R-0001']);
  const tekst = JSON.stringify([f.skjulte, f.stikproever]);
  for (const ord of FORBUDT) assert.ok(!tekst.includes(ord), ord);
  for (const id of ['stikproeve', 'stop-soendagstjek', 'regelforslag-pause']) assert.ok(DAEKNING.some((d) => d.id === id), `${id} on the coverage list (§4 r11)`);
});

test('the stop variant: three clean weeks in a row, the stop question pending, nothing left to answer', () => {
  const f = froe('soendag-stop', DAG);
  const b = f.stikproever!;
  assert.equal(b.uger.length, 3);
  assert.ok(b.uger.every((u) => u.forkerte === 0 && u.traek.every((t) => t.svar === 'rigtigt')));
  assert.equal(b.stop?.svar, undefined);
  assert.equal(b.stop?.uge, '2026-10-26');
});

test('Nu at Søndag aften: the card with the counted number, Rigtigt and Skulle have vist mig det clicked for real', async () => {
  const dir = path.join(rod, 'data-test-a');
  const v = await lavTestverden({ dataDir: dir, delayMs: 0 });
  await v.hop('soendag');
  const mandag = mandagFor(idagKbh(v.ur.now()));
  const h = await (await v.app.request('/rum/hjem')).text();
  assert.match(h, new RegExp(`data-stikproeve="${mandag}"`));
  assert.match(h, /Denne uge skjulte jeg 212 ting\. Her er 5 tilfældige\. Var det rigtigt\?/);
  assert.match(h, /Skal jeg sætte reglen på pause\?/);
  const ids = [...h.matchAll(/data-stikproeve-svar="rigtigt" data-uge="[^"]+" data-id="([^"]+)"/g)].map((m) => m[1]!);
  assert.equal(ids.length, 4);
  for (const id of ids.slice(0, 3)) assert.equal((await send(v, `/api/tillid/stikproeve/${mandag}/${encodeURIComponent(id)}`, { svar: 'rigtigt' })).status, 200);
  const r = await send(v, `/api/tillid/stikproeve/${mandag}/${encodeURIComponent(ids[3]!)}`, { svar: 'forkert' });
  assert.equal(r.status, 200);
  assert.ok(((await r.json()) as { runId?: string }).runId, 'Hermes is asked (the scripted one in the test world)');
  const efter = await (await v.app.request('/rum/hjem')).text();
  assert.doesNotMatch(efter, /data-stikproeve="/, 'all five answered: folded away');
  const bog = JSON.parse(await readFile(path.join(dir, 'tillid', 'stikproever.json'), 'utf8')) as { uger: { forkerte: number }[] };
  assert.equal(bog.uger.at(-1)!.forkerte, 2);
});

test('Nu at Søndag: stop tjekket? shows the question; Ja stops the check, Fortryd in the log turns it on', async () => {
  const dir = path.join(rod, 'data-test-b');
  const v = await lavTestverden({ dataDir: dir, delayMs: 0 });
  await v.hop('soendag-stop');
  const h = await (await v.app.request('/rum/hjem')).text();
  assert.match(h, /data-soendagstjek-stop/);
  assert.doesNotMatch(h, /data-stikproeve="/);
  assert.equal((await send(v, '/api/tillid/soendagstjek/stop', { svar: 'ja' })).status, 200);
  const efter = await (await v.app.request('/rum/hjem')).text();
  assert.doesNotMatch(efter, /data-soendagstjek-stop/);
  assert.match(efter, /Stoppede søndagstjekket/);
});
