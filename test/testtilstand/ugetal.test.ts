// KC-0147 in the test world: the day's moments seed eight weeks of "things that required you" (falling, with one week
// where Fortryd rose), and the moment "Mandag morgen" puts the clock on a Monday so Nu shows the week's number.
// The cold start is a fresh install: no history.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lavTestverden } from '../../src/testtilstand/verden.ts';
import { froe, MOMENTER } from '../../src/testtilstand/indhold.ts';
import { erMandag, mandagFor, raekke, ugeAf, ugeNr, ugetal } from '../../src/tillid/dagstal.ts';
import { idagKbh } from '../../src/shell/tid.ts';

const DAG = '2026-10-29'; // a Thursday
const rod = await mkdtemp(path.join(tmpdir(), 'kc-ugetal-verden-'));
after(() => rm(rod, { recursive: true, force: true }));

test('the seed: eight completed weeks, falling, and exactly one week where Fortryd rose', () => {
  const f = froe('morgen', DAG);
  assert.ok(f.dagstal && f.dagstal.length > 0);
  const uger = raekke(f.dagstal, mandagFor(DAG), 9).slice(0, 8); // the eight weeks before the current one
  assert.ok(uger.every((u) => u.dage === 7), 'a full week each');
  for (let i = 1; i < uger.length; i++) assert.ok(uger[i]!.snit < uger[i - 1]!.snit, `week ${i} is lower than the one before`);
  const steg = uger.filter((u, i) => i > 0 && u.fortryd > uger[i - 1]!.fortryd);
  assert.equal(steg.length, 1, 'one week where Fortryd rose');
  // The current week so far holds only days before today.
  assert.ok(f.dagstal.filter((d) => d.dato >= DAG).length === 0);
});

test('the Monday moment: its clock is a Monday after the story day, and the seed is relative to it', async () => {
  const mandag = MOMENTER.find((m) => m.id === 'mandag');
  assert.ok(mandag);
  const v = await lavTestverden({ dataDir: path.join(rod, 'data-test'), delayMs: 0 });
  await v.hop('mandag');
  assert.equal(erMandag(v.ur.now()), true);
  assert.ok(idagKbh(v.ur.now()) > idagKbh(new Date()), 'the Monday after today');
});

test('Nu on Mandag morgen shows the week that just ended against the one before; /viden shows the bars', async () => {
  const v = await lavTestverden({ dataDir: path.join(rod, 'data-test-2'), delayMs: 0 });
  await v.hop('mandag');
  const nu = await (await v.app.request('/rum/hjem')).text();
  assert.match(nu, /data-ugetal="linje">Sidste uge krævede i snit 6 ting dig om dagen \(ugen før 7\)\. Fortryd: 1\. Det er faldet, uden at Fortryd steg\./);
  const viden = await (await v.app.request('/viden')).text();
  assert.match(viden, /data-ugetal="linje">Sidste uge krævede i snit 6 ting dig om dagen \(ugen før 7\)/, 'no day of the new week is finished yet');
  assert.match(viden, /data-ugetal="soejler"/);
  assert.equal((viden.match(/<rect /g) ?? []).length, 8);
  assert.match(viden, /aria-label="Ting der krævede dig om dagen, uge for uge: uge \d+: 13, uge \d+: 12,/);
  // The Monday moment follows the real calendar, so its week number does too.
  assert.ok(viden.includes(`uge ${ugeNr(ugeAf(v.ur.now()))}: –`), 'this week has no finished day yet');
  await v.hop('morgen');
  const m = await (await v.app.request('/viden')).text();
  assert.match(m, /data-ugetal="soejler"/, 'the page always shows it');
});

test('the cold start is a fresh install: no history, the page says the number is still to come', async () => {
  assert.equal(froe('kold', DAG).dagstal, undefined);
  const v = await lavTestverden({ dataDir: path.join(rod, 'data-test-3'), delayMs: 0 });
  await v.hop('kold');
  assert.match(await (await v.app.request('/viden')).text(), /Tallet kommer, når Clawco har talt en dag\./);
});

test('ugetal over the seed: this week so far is the current week, the average is the seeded one', () => {
  const f = froe('morgen', DAG);
  assert.equal(ugetal(f.dagstal ?? [], '2026-10-19').snit, 6);
});
