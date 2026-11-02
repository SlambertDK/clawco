// KC-0132 in the test world (AGENTS §4 r11): the five fake connectors read the
// fictional day, each moment seeds which are connected (and which are not) and
// what state each fake is in, and the test world's /api/kilder shows exactly
// that — with nothing from Henrik's real life in any of it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FORBUDT, MOMENTER, froe } from '../../src/testtilstand/indhold.ts';
import { KILDE_TILSTAND, kildeData, TEST_PERSONER } from '../../src/testtilstand/indhold/kilder.ts';
import { laesPersoner } from '../../src/kilder/noter/personer.ts';
import { fakta, momentNr } from '../../src/testtilstand/indhold/fakta.ts';
import { skrivFroe } from '../../src/testtilstand/skriv.ts';
import { lavTestverden } from '../../src/testtilstand/verden.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { laesKonfig } from '../../src/kilder/register.ts';
import { SLAGS } from '../../src/kilder/types.ts';

const DAG = '2026-10-29';
const forbundne = (id: string): string[] => (froe(id, DAG).kilder?.kilder ?? []).filter((k) => k.status === 'forbundet').map((k) => k.id).sort();

test('every slags has fictional data in every moment, and none of it is from Henrik\'s real life', () => {
  for (const m of MOMENTER) {
    const d = kildeData(momentNr(m.id), fakta(DAG));
    assert.deepEqual(Object.keys(d).sort(), [...SLAGS].sort());
    assert.ok(d.kalender.days[0]!.events.length > 0 && d.mail.length > 0 && d.nyheder.nyheder.length > 0 && d.noter.personer.length > 0 && d.beskeder.length > 0, m.id);
    const tekst = JSON.stringify(d).toLowerCase();
    for (const ord of FORBUDT) assert.ok(!tekst.includes(ord.toLowerCase()), `${m.id} indeholder "${ord}"`);
  }
});

test('the moments seed connected and unconnected fakes: the morning has two (plus the own news feeds), mail joins in the forenoon, Google before the meeting, notes in the afternoon, messages in the evening', () => {
  // KC-0148: the household's family calendar is connected (in the husstand zone) all day.
  assert.deepEqual(forbundne('morgen'), ['falsk-familiekalender', 'falsk-kalender', 'falsk-nyheder', 'nyheder-rss']);
  assert.deepEqual(forbundne('formiddag'), ['falsk-familiekalender', 'falsk-kalender', 'falsk-mail', 'falsk-nyheder', 'nyheder-rss']);
  assert.deepEqual(forbundne('foer-moede'), ['falsk-familiekalender', 'falsk-kalender', 'falsk-mail', 'falsk-nyheder', 'google-kalender', 'nyheder-rss']);
  assert.deepEqual(forbundne('eftermiddag'), ['falsk-familiekalender', 'falsk-kalender', 'falsk-mail', 'falsk-nyheder', 'google-kalender', 'noter', 'nyheder-rss']);
  for (const m of MOMENTER) assert.ok(!forbundne(m.id).includes('falsk-beskeder'), m.id);
  // KC-0138: the real Beskeder connector, from the evening, two conversations chosen (the group stays off).
  assert.ok(!forbundne('eftermiddag').includes('beskeder'));
  assert.ok(forbundne('aften').includes('beskeder'));
  for (const m of MOMENTER) assert.ok(!JSON.stringify(froe(m.id, DAG).kilder).toLowerCase().includes('kira'));
});

test('skrivFroe writes kilder.json and wipes the secrets of the previous moment', async () => {
  const rod = await mkdtemp(path.join(tmpdir(), 'kc-kilder-froe-'));
  const dir = path.join(rod, 'data-test');
  try {
    await mkdir(path.join(dir, 'hemmeligheder'), { recursive: true });
    await writeFile(path.join(dir, 'hemmeligheder', 'falsk-mail.json'), '{}', 'utf8');
    await skrivFroe(dir, froe('formiddag', DAG), createFileStore(dir), DAG);
    assert.deepEqual((await laesKonfig(dir)).kilder.map((k) => k.id).sort(), ['falsk-familiekalender', 'falsk-kalender', 'falsk-mail', 'falsk-nyheder', 'nyheder-rss']);
    assert.ok(!(await readdir(dir)).includes('hemmeligheder'));
  } finally { await rm(rod, { recursive: true, force: true }); }
});

test('the test world offers four fakes, Google, the own news feeds, Gmail and Beskeder with the moment\'s connections and states', async () => {
  const rod = await mkdtemp(path.join(tmpdir(), 'kc-kilder-verden-'));
  try {
    const verden = await lavTestverden({ dataDir: path.join(rod, 'data-test'), delayMs: 0 });
    type O = { id: string; forbundet: boolean; helbred: { status: string } | null };
    const liste = async (): Promise<O[]> => ((await (await verden.app.request('/api/kilder')).json()) as { kilder: O[] }).kilder;
    const morgen = await liste();
    assert.deepEqual(morgen.map((k) => [k.id, k.forbundet, k.helbred?.status ?? null]), [
      ['falsk-kalender', true, 'ok'], ['falsk-mail', false, null], ['noter', false, null], ['falsk-nyheder', true, 'ok'],
      ['falsk-familiekalender', true, 'ok'], ['google-kalender', false, null], ['nyheder-rss', true, 'ok'], ['mail-gmail', false, null], ['beskeder', false, null],
    ]);
    // KC-0138: in the evening Beskeder is connected and working; Nu shows Ella's question with her name and no number.
    await verden.hop('aften');
    assert.equal((await liste()).find((k) => k.id === 'beskeder')?.helbred?.status, 'ok');
    const nu = await (await verden.app.request('/rum/hjem')).text();
    assert.match(nu, /data-besked-kanal="signal">Besked fra Ella \(familie\) på Signal/);
    assert.ok(!nu.includes('+4500000002'));
    const [moment, slags] = Object.entries(KILDE_TILSTAND).flatMap(([m, t]) => Object.entries(t ?? {}).filter(([, v]) => v === 'log-ind-igen').map(([s]) => [m, s] as const))[0]!;
    await verden.hop(moment);
    assert.equal((await liste()).find((k) => k.id === `falsk-${slags}`)?.helbred?.status, 'log-ind-igen');
  } finally { await rm(rod, { recursive: true, force: true }); }
});

// KC-0136: the real notes connector over a fictional vault in the world's data dir — four invented people in the
// register (written by the app's own writer), connected from the afternoon, its folder gone the next morning.
test('the test world\'s notes: a fictional vault with four invented people, connected in the afternoon, missing the next morning', async () => {
  const rod = await mkdtemp(path.join(tmpdir(), 'kc-kilder-noter-'));
  try {
    const dir = path.join(rod, 'data-test');
    const verden = await lavTestverden({ dataDir: dir, delayMs: 0 });
    type O = { id: string; forbundet: boolean; helbred: { status: string; tekst?: string } | null; kort: { tekst: string; felter: { navn: string; forslag?: string[] }[] } };
    const noter = async (): Promise<O> => ((await (await verden.app.request('/api/kilder')).json()) as { kilder: O[] }).kilder.find((k) => k.id === 'noter')!;
    const ikke = await noter();
    assert.equal(ikke.forbundet, false);
    assert.deepEqual(ikke.kort.felter.find((f) => f.navn === 'mappe')?.forslag, [path.join(path.resolve(dir), 'vault')]); // the world's vault is found as an Obsidian vault
    const personer = await laesPersoner(path.join(dir, 'vault', '40-Mennesker', 'People'), { zone: 'privat' });
    assert.deepEqual(personer.map((p) => [p.navn, p.relation, p.mappe]), TEST_PERSONER.map((p) => [p.navn, p.relation, p.mappe]).sort((a, b) => `${a[2]}/${a[0]}` < `${b[2]}/${b[0]}` ? -1 : 1));
    assert.equal(personer.length, 4);
    for (const ord of FORBUDT) assert.ok(!JSON.stringify(personer).toLowerCase().includes(ord.toLowerCase()), ord);
    await verden.hop('eftermiddag');
    const eft = await noter();
    assert.deepEqual([eft.forbundet, eft.helbred?.status], [true, 'ok']);
    assert.match(eft.kort.tekst, /din Obsidian-vault/);
    await verden.hop('naeste-morgen');
    const naeste = await noter();
    assert.deepEqual([naeste.forbundet, naeste.helbred], [true, { status: 'nede', tekst: 'Mappen kan ikke findes.' }]);
    assert.match(naeste.kort.tekst, /^Mappen kan ikke findes/);
  } finally { await rm(rod, { recursive: true, force: true }); }
});

// KC-0133: the real Google connector over the world's fake Google — not connected in the morning (its card offers
// "Log ind med Google"), connected and reading the story's calendar before the meeting, refused the next morning
// (log in again), and fine again on a jump back (each moment seeds its own refresh token).
test('the test world\'s Google calendar: card, connected with the story\'s calendar, log-ind-igen the next morning', async () => {
  const rod = await mkdtemp(path.join(tmpdir(), 'kc-kilder-google-'));
  try {
    const verden = await lavTestverden({ dataDir: path.join(rod, 'data-test'), delayMs: 0 });
    type O = { id: string; forbundet: boolean; helbred: { status: string; tekst?: string } | null; kort: { handling: string } };
    const google = async (): Promise<O> => ((await (await verden.app.request('/api/kilder')).json()) as { kilder: O[] }).kilder.find((k) => k.id === 'google-kalender')!;
    const morgen = await google();
    assert.equal(morgen.forbundet, false);
    assert.equal(morgen.kort.handling, 'Log ind med Google');
    await verden.hop('foer-moede');
    assert.equal((await google()).helbred?.status, 'ok');
    const koe = (await (await verden.app.request('/api/koe?kilder=1')).json()) as { kilder?: string };
    assert.match(koe.kilder ?? '', /data-kilde="google-kalender" data-kilde-tilstand="forbundet"/);
    await verden.hop('naeste-morgen');
    const afvist = await google();
    assert.equal(afvist.helbred?.status, 'log-ind-igen');
    assert.match(afvist.helbred?.tekst ?? '', /Log ind med Google igen/);
    await verden.hop('aften');
    assert.equal((await google()).helbred?.status, 'ok');
  } finally { await rm(rod, { recursive: true, force: true }); }
});

// KC-0137: the user's own feeds over the world's fake feeds — the real connector, three invented feeds, one of which
// does not answer the next morning and is named; the world's fetcher never reaches the internet.
test('the test world\'s own news feeds: three feeds read, one named when it does not answer, nothing leaves the world', async () => {
  const rod = await mkdtemp(path.join(tmpdir(), 'kc-kilder-rss-'));
  try {
    const verden = await lavTestverden({ dataDir: path.join(rod, 'data-test'), delayMs: 0 });
    type O = { id: string; forbundet: boolean; helbred: { status: string; tekst?: string } | null; kort: { tekst: string } };
    const rss = async (): Promise<O> => ((await (await verden.app.request('/api/kilder')).json()) as { kilder: O[] }).kilder.find((k) => k.id === 'nyheder-rss')!;
    const forbind = (felter: Record<string, string>) => verden.app.request('/api/kilder/nyheder-rss/forbind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ felter }) });
    const noeglen = (await rss());
    assert.deepEqual([noeglen.forbundet, noeglen.helbred?.status], [true, 'ok']);
    assert.match(noeglen.kort.tekst, /^3 nyhedskilder: Kystradioen, Elnyt og Den døve avis\./);
    // A feed on the world's own domain can be added; the internet cannot be reached.
    assert.equal((await forbind({ adresser: 'https://nyt.testverden.example/rss' })).status, 200);
    assert.match((await rss()).kort.tekst, /^4 nyhedskilder/);
    const ud = await forbind({ adresser: 'https://www.rigtig-avis.dk/rss' });
    assert.equal(ud.status, 400);
    assert.match(((await ud.json()) as { error: string }).error, /rigtige internet/);
    await verden.hop('naeste-morgen');
    // The next morning one of the three does not answer: the room names it, the connector says so calmly.
    assert.match(await (await verden.app.request('/rum/nyheder')).text(), /Kilder, der ikke svarede i dag: Den døve avis/);
    assert.equal((await verden.app.request('/api/rum/nyheder/opdater', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'opdater' }) })).status, 202);
  } finally { await rm(rod, { recursive: true, force: true }); }
});
