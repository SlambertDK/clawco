// KC-0146 "Slet alt": POST /api/tillid/slet-alt needs the owner and the typed word SLET; it empties the data dir
// and <vault>/Clawco and nothing else; the page renders empty afterwards; chat, voice and Hermes never reach it.
// Temp dirs only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { MAJA, videnApp } from './helpers/viden.ts';

const findes = (p: string): Promise<boolean> => access(p).then(() => true, () => false);

test('refused without the typed word, with the wrong word, or by GET; nothing is removed', async () => {
  const t = await videnApp();
  try {
    for (const b of [{}, { bekraeft: 'slet' }, { bekraeft: 'ja' }, { bekraeft: ' SLETT ' }]) assert.equal((await t.post('/api/tillid/slet-alt', b)).status, 400, JSON.stringify(b));
    assert.equal((await t.form('/api/tillid/slet-alt', { bekraeft: 'Slet' })).status, 400);
    assert.equal((await t.sut.app.request('/api/tillid/slet-alt')).status, 404);
    assert.ok(await findes(path.join(t.dataDir, 'rum', 'mail', 'log.jsonl')));
    assert.ok(await findes(path.join(t.vault, 'Clawco', 'regler.md')));
  } finally { await t.ryd(); }
});

test('refused for anyone but the owner', async () => {
  const t = await videnApp({ person: MAJA });
  try {
    assert.equal((await t.form('/api/tillid/slet-alt', { bekraeft: 'SLET' })).status, 403);
    assert.equal((await t.post('/api/tillid/slet-alt', { bekraeft: 'SLET' })).status, 403);
    assert.equal((await t.post('/api/tillid/regler/R-0001/pause', {})).status, 403, 'nor may a member pause a rule');
    assert.ok(await findes(path.join(t.dataDir, 'rum', 'mail', 'log.jsonl')));
  } finally { await t.ryd(); }
});

test('the owner with SLET: the data dir and Clawco/ are empty, the vault and its notes stay, the page says Alt er slettet', async () => {
  const t = await videnApp();
  try {
    const res = await t.form('/api/tillid/slet-alt', { bekraeft: 'SLET' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/viden?slettet=1');
    assert.deepEqual(await readdir(t.dataDir), [], 'the data dir is empty (and still there)');
    assert.deepEqual(await readdir(path.join(t.vault, 'Clawco')), []);
    assert.ok(await findes(path.join(t.vault, '00-Indbakke', 'egen note.md')), 'the user\'s own note');
    assert.ok(await findes(path.join(t.personer, 'familie', 'Maja.md')), 'the people register');
    const side = await t.sut.app.request('/viden?slettet=1');
    assert.equal(side.status, 200);
    const tekst = await side.text();
    assert.match(tekst, /Alt er slettet/);
    assert.match(tekst, /Clawco har ikke gemt noget/);
    assert.match(tekst, /Ingen regler endnu/);
    assert.equal(t.sut.runs.paaPause(), false, 'Clawco is not left paused');
    assert.equal((await t.sut.app.request('/rum/hjem')).status, 200, 'the app keeps working on the empty store');
  } finally { await t.ryd(); }
});

test('JSON answers JSON', async () => {
  const t = await videnApp();
  try {
    const res = await t.post('/api/tillid/slet-alt', { bekraeft: 'SLET' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { slettet: true });
  } finally { await t.ryd(); }
});

test('a request from another site is refused', async () => {
  const t = await videnApp();
  try {
    const res = await t.sut.app.request('http://localhost/api/tillid/slet-alt', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'cross-site' }, body: 'bekraeft=SLET' });
    assert.equal(res.status, 403);
    assert.ok(await findes(path.join(t.dataDir, 'rum', 'mail', 'log.jsonl')));
  } finally { await t.ryd(); }
});

test('never reachable from the chat, the voice overview or a voice id', async () => {
  const t = await videnApp();
  try {
    for (const besked of ['slet alt', 'Slet alt hvad du ved om mig', 'åbn slet alt']) {
      const res = await t.post('/api/rum/hjem/chat', { besked, aabn: true });
      const j = (await res.json()) as { aabn?: string };
      assert.ok(!j.aabn || !/slet/.test(j.aabn), besked);
    }
    const o = (await (await t.sut.app.request('/api/stemme/oversigt')).json()) as { tekst: string; punkter: { valg: { id: string }[] }[] };
    assert.doesNotMatch(o.tekst, /slet.alt|viden/i);
    assert.ok(!o.punkter.some((p) => p.valg.some((v) => /slet|viden/.test(v.id))));
    for (const id of ['viden:slet-alt', 'tillid:slet-alt', 'hjem:slet-alt']) assert.ok((await t.post('/api/stemme/udfoer', { id })).status >= 400, id);
    assert.ok(await findes(path.join(t.dataDir, 'rum', 'mail', 'log.jsonl')));
  } finally { await t.ryd(); }
});
