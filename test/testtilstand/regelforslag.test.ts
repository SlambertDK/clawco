// KC-0144 in the test world (AGENTS §4 r11): the card "Skal jeg gøre det til en regel?" — one pending proposal from the moment
// Henrik closed the parcel card (and one he declined, never shown), the scripted Hermes proposing after a Ret or an Ikke relevant
// that names a pattern, and the whole flow: Ja writes the rule into the world's own rules file, Fortryd removes it, Nej tak is remembered.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { froe } from '../../src/testtilstand/indhold.ts';
import { lavTestverden, type Testverden } from '../../src/testtilstand/verden.ts';
import { type KuratorState } from '../../src/rooms/hjem/kort.ts';
import { DAEKNING } from '../../src/testtilstand/daekning.ts';
import { FORBUDT } from '../../src/testtilstand/indhold.ts';

const DAG = '2026-10-29';
const rod = await mkdtemp(path.join(tmpdir(), 'kc-forslag-verden-'));
after(() => rm(rod, { recursive: true, force: true }));
const post = (v: Testverden, sti: string, body: unknown) => v.app.request(sti, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function vent(v: Testverden, sti: string, moenster: RegExp): Promise<string> {
  let h = '';
  for (let i = 0; i < 100; i++) { h = await (await v.app.request(sti)).text(); if (moenster.test(h)) return h; await new Promise((r) => setTimeout(r, 20)); }
  return h;
}
const state = (id: string): KuratorState => froe(id, DAG).rum['hjem']?.state as KuratorState;
const reglerFil = (dir: string): Promise<string> => readFile(path.join(dir, 'vault', 'Clawco', 'regler.md'), 'utf8');
const ja = async (v: Testverden, id: string): Promise<string> => ((await (await post(v, '/api/graense/ja', { rum: 'hjem', slags: 'forslag', id })).json()) as { ja: string }).ja;

test('the seed: one pending proposal at the three moments after the parcel card was closed, one declined; none before, none pending after; fictional only', () => {
  const ventende = (id: string) => (state(id).regelforslag ?? []).filter((f) => f.status === 'afventer');
  for (const id of ['morgen', 'formiddag']) assert.equal(state(id).regelforslag, undefined, id);
  for (const id of ['foer-moede', 'moede', 'eftermiddag']) {
    assert.deepEqual(ventende(id).map((f) => [f.kortId, f.art, f.trin]), [['tjeneste:pakkeshoppen-pakke', 'ikke-relevant', 1]], id);
    assert.equal(state(id).regelforslag?.filter((f) => f.status === 'afvist').length, 1, `${id}: one declined, remembered`);
  }
  for (const id of ['aften', 'sent-aften']) assert.equal(ventende(id).length, 0, `${id}: Alt er ordnet needs nothing pending`);
  const tekst = JSON.stringify(state('foer-moede').regelforslag);
  for (const ord of FORBUDT) assert.ok(!tekst.includes(ord), ord);
  assert.ok(DAEKNING.some((d) => d.id === 'regelforslag' && d.marker === 'data-regelforslag="'), 'on the coverage list (§4 r11)');
});

test('the flow: the card is on screen; Ja writes the rule in the world\'s rules file and the log line has its Fortryd; Fortryd removes exactly it', async () => {
  const dir = path.join(rod, 'data-test-ja');
  const v = await lavTestverden({ dataDir: dir, delayMs: 0 });
  await v.hop('eftermiddag');
  const h = await (await v.app.request('/rum/hjem')).text();
  const id = /data-regelforslag="(rf-[0-9a-f]{10})"/.exec(h)![1]!;
  assert.match(h, /Skal jeg gøre det til en regel\?/);
  assert.match(h, /Pakkemails lægges i Pakker/);
  assert.equal((h.match(/data-regelforslag="/g) ?? []).length, 1, 'one card');
  const foer = await reglerFil(dir);
  assert.doesNotMatch(foer, /Pakkemails/);
  assert.equal((await post(v, `/api/tillid/forslag/${id}/godkend`, {})).status, 403, 'no yes, no rule');
  assert.equal(await reglerFil(dir), foer);
  const res = await post(v, `/api/tillid/forslag/${id}/godkend`, { ja: await ja(v, id) });
  assert.equal(res.status, 200);
  const { regelId } = (await res.json()) as { regelId: string };
  assert.match(await reglerFil(dir), new RegExp(`## ${regelId} · Pakkemails lægges i Pakker\\n- trin: 1\\n- gaelder: mail / pakke\\n- oprindelse: ikke-relevant \\d{4}-\\d{2}-\\d{2} \\(kort tjeneste:pakkeshoppen-pakke\\)\\n- status: aktiv`));
  const efter = await (await v.app.request('/rum/hjem')).text();
  assert.doesNotMatch(efter, /data-regelforslag="/, 'answered: gone');
  const logId = /data-log="([^"]+)"[^>]*>(?:(?!data-log=)[\s\S])*?Gjorde det til en regel[\s\S]*?data-hjem-fortryd="([^"]+)"/.exec(efter)?.[2];
  assert.ok(logId, 'the log line has its Fortryd');
  assert.equal((await post(v, `/api/rum/hjem/fortryd/${logId}`, {})).status, 200);
  assert.doesNotMatch(await reglerFil(dir), /Pakkemails/);
});

test('Nej tak: the rules file is untouched and the card is gone', async () => {
  const dir = path.join(rod, 'data-test-nej');
  const v = await lavTestverden({ dataDir: dir, delayMs: 0 });
  await v.hop('moede');
  const h = await (await v.app.request('/rum/hjem')).text();
  const id = /data-regelforslag="(rf-[0-9a-f]{10})"/.exec(h)![1]!;
  const foer = await reglerFil(dir);
  assert.equal((await post(v, `/api/tillid/forslag/${id}/afvis`, {})).status, 200);
  assert.equal(await reglerFil(dir), foer);
  assert.doesNotMatch(await (await v.app.request('/rum/hjem')).text(), /data-regelforslag="/);
});

test('the scripted Hermes: an Ikke relevant that names a pattern gives one proposal; one that does not, none', async () => {
  const dir = path.join(rod, 'data-test-luk');
  const v = await lavTestverden({ dataDir: dir, delayMs: 0 });
  await v.hop('morgen');
  assert.doesNotMatch(await (await v.app.request('/rum/hjem')).text(), /data-regelforslag="/);
  assert.equal((await post(v, '/api/rum/hjem/kort/regning%3Aloebeklubben-kontingent/luk', { grund: 'Klaret, jeg har betalt' })).status, 202);
  await new Promise((r) => setTimeout(r, 300));
  assert.doesNotMatch(await (await v.app.request('/rum/hjem')).text(), /data-regelforslag="/, 'no pattern in his words');
  assert.equal((await post(v, '/api/rum/hjem/kort/nyhed%3Aregn-16-19/luk', { grund: 'Jeg vil aldrig have vejrkort om løb' })).status, 202);
  const h = await vent(v, '/rum/hjem', /data-regelforslag="/);
  assert.match(h, /Tilbud lægges i Ordnet/);
  assert.match(h, /Kom fra: dit Ikke relevant på «Regn kl\. 16–19/);
});

test('the scripted Hermes: a Ret that names a pattern gives one proposal; Ret reglen rewrites its text in his words and keeps one card', async () => {
  const dir = path.join(rod, 'data-test-ret');
  const v = await lavTestverden({ dataDir: dir, delayMs: 0 });
  await v.hop('morgen');
  assert.equal((await post(v, '/api/rum/hjem/chat', { besked: 'Kontingenter skal altid i Ordnet', kontekst: 'Kortet: Løbeklubben: halvårskontingent 450 kr.' })).status, 202);
  const h = await vent(v, '/rum/hjem', /Kontingenter lægges i Ordnet/);
  assert.match(h, /Kom fra: dit Ret på «Løbeklubben: halvårskontingent 450 kr\.»/);
  assert.equal((await post(v, '/api/rum/hjem/chat', { besked: 'Kun kontingenter under 500 kr.', kontekst: 'Forslag: Kontingenter lægges i Ordnet' })).status, 202);
  const rettet = await vent(v, '/rum/hjem', /Kun kontingenter under 500 kr\./);
  assert.match(rettet, /Kun kontingenter under 500 kr\./);
  assert.equal((rettet.match(/data-regelforslag="/g) ?? []).length, 1);
});
