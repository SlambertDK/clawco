// KC-0142 in the app: Hermes reads the rules file every time it thinks (the
// Kuratoren run and the Nu chat), and a file that cannot be read shows one card
// in Nu — otherwise there is no such card (KC-0052).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/server.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { lavReglerLager } from '../../src/tillid/lager.ts';

const NOW = new Date('2026-10-31T09:00:00Z');
const regel = (id: string, titel: string, trin: number): string => `## ${id} · ${titel}\n- trin: ${trin}\n- gaelder: mail / regning\n- oprindelse: import 2026-10-31\n- status: aktiv\n`;
const FIL = `naeste-id: R-0002\n\n${regel('R-0001', 'Regnskabslinjer', 2)}`;

async function opsaet(o: { vaultDir?: boolean } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-tillid-srv-'));
  const dataDir = path.join(dir, 'data');
  const vaultRod = o.vaultDir ? path.join(dir, 'egen-vault') : path.join(dir, 'vault');
  const hermes = createFakeAgent({ answer: () => '```json\n{"kort":[],"vurderinger":[],"intet":[]}\n```' });
  const sut = createApp({
    store: createFileStore(dataDir), hermes, sourceGlob: path.join(dir, 'avis_{date}.json'), dataDir, now: () => NOW,
    mailRunner: async () => ({ code: 0, stdout: '[]', stderr: '' }), mailStateDir: path.join(dir, 'state'),
    vaultInbox: path.join(dir, 'vault', '00-Indbakke'), ...(o.vaultDir ? { vaultDir: vaultRod } : {}),
  });
  const lager = lavReglerLager({ vaultDir: vaultRod, dataDir });
  const post = (url: string, body: unknown) => sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const naesteKald = async (foer: number): Promise<string> => {
    for (let i = 0; i < 200 && hermes.calls.length <= foer; i++) await new Promise((r) => setTimeout(r, 5));
    const kald = hermes.calls[foer];
    assert.ok(kald, 'Hermes got a run');
    return kald.instructions;
  };
  return { dir, sut, hermes, lager, post, naesteKald, // Runs keep writing to the data dir after the asserted call; remove it only once every run is finished.
    ryd: async () => { await Promise.allSettled(sut.runs.list().map((r) => r.finished)); await rm(dir, { recursive: true, force: true }); } };
}

test('the Nu chat sends the rules, read fresh on every message', async () => {
  const t = await opsaet();
  try {
    await t.lager.skrivTekst(FIL);
    assert.equal((await t.post('/api/rum/hjem/chat', { besked: 'Hej' })).status, 202);
    assert.match(await t.naesteKald(0), /R-0001 · trin 2 · mail \/ regning: Regnskabslinjer/);
    await t.lager.skrivTekst(`naeste-id: R-0003\n\n${regel('R-0001', 'Regnskabslinjer', 2)}\n${regel('R-0002', 'Ny regel', 1)}`);
    assert.equal((await t.post('/api/rum/hjem/chat', { besked: 'Og nu?' })).status, 202);
    assert.match(await t.naesteKald(1), /R-0002 · trin 1/, 'a rule Henrik added is read on the next run');
  } finally { await t.ryd(); }
});

test('Kuratoren sends the rules', async () => {
  const t = await opsaet();
  try {
    await t.lager.skrivTekst(FIL);
    assert.equal((await t.post('/api/rum/hjem/kurator', { dyb: true })).status, 202);
    assert.match(await t.naesteKald(0), /R-0001 · trin 2/);
  } finally { await t.ryd(); }
});

test('KC_VAULT_DIR (AppDeps.vaultDir) is where the rules are read', async () => {
  const t = await opsaet({ vaultDir: true });
  try {
    await t.lager.skrivTekst(FIL);
    await t.post('/api/rum/hjem/chat', { besked: 'Hej' });
    assert.match(await t.naesteKald(0), /R-0001 · trin 2/);
  } finally { await t.ryd(); }
});

test('a broken file: Hermes is told trin 0 and Nu shows one card "Reglerne kan ikke læses"', async () => {
  const t = await opsaet();
  try {
    await mkdir(path.dirname(t.lager.fil), { recursive: true });
    await writeFile(t.lager.fil, '# noter\nikke en regelfil\n', 'utf8');
    const side = await (await t.sut.app.request('/rum/hjem')).text();
    const kort = /<article[^>]*data-element="Reglerne kan ikke læses"[^>]*>[\s\S]*?<\/article>/.exec(side)?.[0] ?? '';
    assert.ok(kort, 'the card is there');
    assert.match(kort, /data-blok="kort"/);
    assert.match(kort, /naeste-id/, 'it says why');
    assert.match(kort, /regler\.md/, 'it says which file');
    assert.match(side, /data-baand="kraever"/, 'it waits on Henrik');
    assert.doesNotMatch(side, /class="card alt-ordnet"/);
    await t.post('/api/rum/hjem/chat', { besked: 'Hej' });
    assert.match(await t.naesteKald(0), /kun se \(trin 0\)/);
  } finally { await t.ryd(); }
});

test('a readable file or no file: no card', async () => {
  const t = await opsaet();
  try {
    assert.doesNotMatch(await (await t.sut.app.request('/rum/hjem')).text(), /Reglerne kan ikke læses/);
    await t.lager.skrivTekst(FIL.replace('trin: 2', 'trin: 9'));
    assert.doesNotMatch(await (await t.sut.app.request('/rum/hjem')).text(), /Reglerne kan ikke læses/, 'one invalid rule is not a broken file');
  } finally { await t.ryd(); }
});

test('KC-0146: Slå fra pauses a rule with a fresh human tap, Slå til igen undoes it; the app wrote it, so it is not "changed outside"', async () => {
  const t = await opsaet();
  try {
    await t.lager.skrivTekst(FIL);
    const tryk = async (id: string): Promise<string> => ((await (await t.post('/api/graense/ja', { rum: 'viden', slags: 'regel', id })).json()) as { ja: string }).ja;
    assert.equal((await t.post('/api/tillid/regler/R-0001/pause', {})).status, 403, 'no tap, no change');
    const ja = await tryk('R-0001:pause');
    assert.equal((await t.post('/api/tillid/regler/R-0001/aktiv', { ja })).status, 403, 'a tap is bound to its button');
    const res = await t.post('/api/tillid/regler/R-0001/pause', { ja: await tryk('R-0001:pause') });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id: 'R-0001', status: 'pause' });
    let l = await t.lager.laes();
    assert.equal(l.tilstand === 'ok' && l.saet.regler[0]?.status, 'pause');
    assert.equal(l.tilstand === 'ok' && l.aendretUdenfor, false);
    assert.match(await (await t.sut.app.request('/viden')).text(), /data-regel-form="R-0001:aktiv"/);
    assert.equal((await t.post('/api/tillid/regler/R-0001/aktiv', { ja: await tryk('R-0001:aktiv') })).status, 200);
    l = await t.lager.laes();
    assert.equal(l.tilstand === 'ok' && l.saet.regler[0]?.status, 'aktiv');
    const brugt = await tryk('R-0001:pause');
    assert.equal((await t.post('/api/tillid/regler/R-0001/pause', { ja: brugt })).status, 200);
    assert.equal((await t.post('/api/tillid/regler/R-0001/pause', { ja: brugt })).status, 403, 'a tap is good once');
    assert.equal((await t.post('/api/tillid/regler/R-0009/pause', { ja: await tryk('R-0009:pause') })).status, 404);
    assert.equal((await t.post('/api/tillid/regler/R-0001/slet', {})).status, 404);
    assert.equal((await t.post('/api/graense/ja', { rum: 'viden', slags: 'slet-alt', id: 'x' })).status, 400, 'no tap token exists for anything else here');
  } finally { await t.ryd(); }
});

test('KC-0146: a rules file that cannot be read is not rewritten by Slå fra', async () => {
  const t = await opsaet();
  try {
    await mkdir(path.dirname(t.lager.fil), { recursive: true });
    await writeFile(t.lager.fil, '# noter\n', 'utf8');
    const { ja } = (await (await t.post('/api/graense/ja', { rum: 'viden', slags: 'regel', id: 'R-0001:pause' })).json()) as { ja: string };
    assert.equal((await t.post('/api/tillid/regler/R-0001/pause', { ja })).status, 409);
  } finally { await t.ryd(); }
});

test('KC-0270 (B3): a rules file changed outside Clawco is approved only by the owner\'s tap for exactly that content; until then nothing rewrites it', async () => {
  const t = await opsaet();
  try {
    await t.lager.skrivTekst(FIL);
    await writeFile(t.lager.fil, FIL.replace('- trin: 2', '- trin: 4'), 'utf8');
    const l = await t.lager.laes();
    assert.ok(l.tilstand === 'ok' && l.aendretUdenfor && l.sha);
    const sha = l.tilstand === 'ok' ? l.sha! : '';
    const side = await (await t.sut.app.request('/viden')).text();
    assert.ok(side.includes(`data-regel-form="godkend:${sha}"`), 'the page offers the approval of what it shows');
    const tryk = async (id: string): Promise<string> => ((await (await t.post('/api/graense/ja', { rum: 'viden', slags: 'regel', id })).json()) as { ja: string }).ja;
    // Slå fra would rewrite the file and so approve the outside edit by the back door: refused until approved.
    assert.equal((await t.post('/api/tillid/regler/R-0001/pause', { ja: await tryk('R-0001:pause') })).status, 409);
    assert.equal((await t.post('/api/tillid/regler/godkend', {})).status, 403, 'no tap, no approval');
    assert.equal((await t.sut.app.request('/api/tillid/regler/godkend', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: JSON.stringify({ ja: await tryk(`godkend:${sha}`) }) })).status, 403, 'only from Clawco itself');
    const gammel = await tryk(`godkend:${sha}`);
    await writeFile(t.lager.fil, FIL.replace('- trin: 2', '- trin: 3'), 'utf8');
    assert.equal((await t.post('/api/tillid/regler/godkend', { ja: gammel })).status, 403, 'changed again after it was shown: that yes is for other content');
    await writeFile(t.lager.fil, FIL.replace('- trin: 2', '- trin: 4'), 'utf8');
    assert.equal((await t.post('/api/tillid/regler/godkend', { ja: await tryk(`godkend:${sha}`) })).status, 200);
    const efter = await t.lager.laes();
    assert.ok(efter.tilstand === 'ok' && !efter.aendretUdenfor, 'approved');
  } finally { await t.ryd(); }
});
