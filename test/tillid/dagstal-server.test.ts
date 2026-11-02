// KC-0147 in the app: Nu records what is in its Kræver dig band, the week's number
// shows in Nu on Mondays only and always on /viden. Temp dirs, fake Hermes, injected clock.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/server.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { lavDagstal } from '../../src/tillid/dagstal.ts';
import { lavReglerLager } from '../../src/tillid/lager.ts';
import { baandDel } from '../baand.ts';

async function opsaet(start: string) {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-dagstal-srv-'));
  const dataDir = path.join(dir, 'data');
  const klokke = { nu: new Date(start) };
  const store = createFileStore(dataDir);
  const sut = createApp({
    store, hermes: createFakeAgent({ answer: () => '```json\n{"kort":[],"vurderinger":[],"intet":[]}\n```' }), sourceGlob: path.join(dir, 'avis_{date}.json'), dataDir, now: () => klokke.nu,
    mailRunner: async () => ({ code: 0, stdout: '[]', stderr: '' }), mailStateDir: path.join(dir, 'state'), vaultInbox: path.join(dir, 'vault', '00-Indbakke'),
  });
  const fil = path.join(dataDir, 'tillid', 'dagstal.jsonl');
  const laes = async () => (await readFile(fil, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  return { dir, dataDir, klokke, store, sut, fil, laes, lager: lavDagstal({ dir: dataDir }), ryd: () => rm(dir, { recursive: true, force: true }) };
}
const seed = async (dataDir: string, linjer: Record<string, unknown>[]) => {
  await mkdir(path.join(dataDir, 'tillid'), { recursive: true });
  await writeFile(path.join(dataDir, 'tillid', 'dagstal.jsonl'), linjer.map((l) => `${JSON.stringify(l)}\n`).join(''), 'utf8');
};
const toUger = (): Record<string, unknown>[] => [
  ...['2026-10-19', '2026-10-20', '2026-10-21'].map((dato, i) => ({ dato, kraevede: 9, fortryd: i === 0 ? 1 : 0 })),
  ...['2026-10-26', '2026-10-27', '2026-10-28'].map((dato, i) => ({ dato, kraevede: 6, fortryd: i === 0 ? 1 : 0 })),
];

test('opening Nu notes the band: a broken rules file is one thing that required Henrik, counted once however often Nu is built', async () => {
  const t = await opsaet('2026-10-28T09:00:00Z');
  try {
    const regler = lavReglerLager({ vaultDir: path.join(t.dir, 'vault'), dataDir: t.dataDir });
    await mkdir(path.dirname(regler.fil), { recursive: true });
    await writeFile(regler.fil, '# noter\nikke en regelfil\n', 'utf8');
    const side = await (await t.sut.app.request('/rum/hjem')).text();
    for (let i = 0; i < 2; i++) assert.equal((await t.sut.app.request('/rum/hjem')).status, 200);
    assert.equal((await t.sut.app.request('/api/rum/hjem/fragment')).status, 200);
    // The count is the band on screen: the rules card and every waiting row it draws.
    const tegnet = (baandDel(side, 'kraever').match(/data-id="/g) ?? []).length;
    assert.ok(tegnet >= 1 && baandDel(side, 'kraever').includes('data-id="regler:ulaeselig"'));
    const dage = await t.lager.dage();
    assert.deepEqual(dage.map((d) => [d.dato, d.kraevede]), [['2026-10-28', tegnet]]);
    assert.equal((await t.laes()).length, 1, 'one line: nothing changed after the first view');
  } finally { await t.ryd(); }
});

test('the next day the same thing counts again', async () => {
  const t = await opsaet('2026-10-28T09:00:00Z');
  try {
    const regler = lavReglerLager({ vaultDir: path.join(t.dir, 'vault'), dataDir: t.dataDir });
    await mkdir(path.dirname(regler.fil), { recursive: true });
    await writeFile(regler.fil, 'ikke en regelfil\n', 'utf8');
    await t.sut.app.request('/rum/hjem');
    t.klokke.nu = new Date('2026-10-29T09:00:00Z');
    await t.sut.app.request('/rum/hjem');
    const [a, b] = await t.lager.dage();
    assert.deepEqual([a?.dato, b?.dato], ['2026-10-28', '2026-10-29']);
    assert.ok((a?.kraevede ?? 0) >= 1 && a?.kraevede === b?.kraevede, 'the same things count again on the next day');
  } finally { await t.ryd(); }
});

test('Fortryd is counted from the logs of every room, on the day it was undone', async () => {
  const t = await opsaet('2026-10-28T09:00:00Z');
  try {
    for (const rum of ['hjem', 'mail']) await t.store.appendLog(rum, { tekst: 'Gjort', kilde: 'hermes', fortrudt: '2026-10-28T07:00:00Z' } as never);
    await t.store.appendLog('mail', { tekst: 'Fortrudt i går', kilde: 'hermes', fortrudt: '2026-10-27T07:00:00Z' } as never);
    await t.sut.app.request('/rum/hjem');
    assert.equal((await t.lager.dage())[0]?.fortryd, 2);
  } finally { await t.ryd(); }
});

test('Nu shows the week line on Monday (the week that just ended) and not on other days', async () => {
  const t = await opsaet('2026-11-02T08:00:00Z'); // Monday 09:00 Copenhagen
  try {
    await seed(t.dataDir, toUger());
    const mandag = await (await t.sut.app.request('/rum/hjem')).text();
    assert.match(mandag, /data-ugetal="linje">Sidste uge krævede i snit 6 ting dig om dagen \(ugen før 9\)\. Fortryd: 1\./);
    t.klokke.nu = new Date('2026-11-03T08:00:00Z');
    assert.doesNotMatch(await (await t.sut.app.request('/rum/hjem')).text(), /data-ugetal/);
    t.klokke.nu = new Date('2026-11-01T22:30:00Z'); // Sunday 23:30
    assert.doesNotMatch(await (await t.sut.app.request('/rum/hjem')).text(), /data-ugetal/);
  } finally { await t.ryd(); }
});

test('/viden counts finished days only: today, still growing, does not pull the week down', async () => {
  const t = await opsaet('2026-10-28T09:00:00Z'); // Wednesday: Monday and Tuesday are finished
  try {
    await seed(t.dataDir, [...toUger(), { dato: '2026-10-28', kraevede: 1, fortryd: 0 }]);
    assert.match(await (await t.sut.app.request('/viden')).text(), /I denne uge krævede i snit 6 ting dig om dagen \(sidste uge 9\)/);
  } finally { await t.ryd(); }
});

test('/viden on a Monday, before any day of the week is finished, is about the week that just ended', async () => {
  const t = await opsaet('2026-11-02T08:00:00Z');
  try {
    await seed(t.dataDir, toUger());
    assert.match(await (await t.sut.app.request('/viden')).text(), /Sidste uge krævede i snit 6 ting dig om dagen \(ugen før 9\)/);
  } finally { await t.ryd(); }
});

test('Nu on a Monday with one week of data: the first-week sentence', async () => {
  const t = await opsaet('2026-11-02T08:00:00Z');
  try {
    await seed(t.dataDir, toUger().slice(3));
    assert.match(await (await t.sut.app.request('/rum/hjem')).text(), /Første uge: 6 om dagen\. Sammenligning kommer næste uge\./);
  } finally { await t.ryd(); }
});

test('/viden always shows the number and the eight bars, with a text alternative', async () => {
  const t = await opsaet('2026-10-29T08:00:00Z'); // a Thursday
  try {
    await seed(t.dataDir, toUger());
    const side = await (await t.sut.app.request('/viden')).text();
    assert.match(side, /data-viden-del="ugetal"/);
    assert.match(side, /I denne uge krævede i snit 6 ting dig om dagen \(sidste uge 9\)\. Fortryd: 1\./);
    assert.match(side, /uge 43: 9, uge 44: 6/);
    assert.equal((side.match(/<rect /g) ?? []).length, 8);
  } finally { await t.ryd(); }
});

test('Hent alt contains the file and Slet alt removes it', async () => {
  const t = await opsaet('2026-10-29T08:00:00Z');
  try {
    await seed(t.dataDir, toUger());
    const zip = Buffer.from(await (await t.sut.app.request('/api/tillid/eksport')).arrayBuffer());
    assert.ok(zip.includes(Buffer.from('data/tillid/dagstal.jsonl')), 'the export lists it');
    const res = await t.sut.app.request('/api/tillid/slet-alt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bekraeft: 'SLET' }) });
    assert.equal(res.status, 200);
    assert.deepEqual(await t.lager.dage(), []);
    assert.equal((await t.sut.app.request('/rum/hjem')).status, 200, 'Nu still builds afterwards');
  } finally { await t.ryd(); }
});
