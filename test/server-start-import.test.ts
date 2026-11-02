// KC-0129: Start's step 5 through the real routes — a vault made by the notes connector, a first source, a pasted text,
// the pile, Gem, the files with frontmatter, Fortryd that removes only what was written. Fake Hermes, invented names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { falskeKilder } from '../src/kilder/falsk/falsk.ts';
import { noterKilde } from '../src/kilder/noter/noter.ts';
import { skrivPerson } from '../src/kilder/noter/personer.ts';
import { IMPORT_MARKOER } from '../src/rooms/start/import/foreslaa.ts';
import type { Person } from '../src/identitet/husstand.ts';
import type { StartState } from '../src/rooms/start/schema.ts';
import type { LogEntry } from '../src/store/types.ts';

const NOW = new Date('2026-10-31T09:30:00Z');
const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const SVAR = { personer: [
  { navn: 'Ingrid', relation: 'din kone', mappe: 'familie', foedselsdag: '1984-03-12' },
  { navn: 'Tore Nyvang', relation: 'kollega', mappe: 'arbejde', org: 'Fyrtaarn A/S' },
], profil: { tekst: 'Jeg løber tirsdag og torsdag.' } };
const kuvert = (id: string) => ({ id, emne: `Brev ${id}`, fra: 'Clara', modtaget: NOW.toISOString(), laest: false, flag: false, vedhaeftning: false });

async function medApp(fn: (s: { app: ReturnType<typeof createApp>['app']; runs: ReturnType<typeof createApp>['runs']; dir: string; vault: string; tmp: string; sendt: string[] }) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-start-import-'));
  const sendt: string[] = [];
  try {
    const hermes = createFakeAgent({ answer: (req) => { if (req.instructions.includes(IMPORT_MARKOER)) { sendt.push(req.input); return '```json\n' + JSON.stringify(SVAR) + '\n```'; } return 'ok'; } });
    const tmp = path.join(dir, 'upload');
    const { app, runs } = createApp({
      store: createFileStore(dir), hermes, sourceGlob: '/nonexistent/{date}.json', dataDir: dir, now: () => NOW, importTmp: tmp,
      mailRunner: async () => ({ code: 0, stdout: '{"envelopes":[]}', stderr: '' }), mailStateDir: '/nonexistent', identitet: { fast: EJER },
      kilder: [...falskeKilder({ data: { kalender: () => ({ generated: NOW.toISOString(), days: [], errors: [] }), mail: () => [kuvert('1')], nyheder: () => ({ nyheder: [], status: { antal: 0, medNyheder: 0, nyheder: 0, fejlede: [] } }), noter: () => ({ personer: [], noter: [] }), beskeder: () => [] }, forsinkelseMs: 0 }).filter((k) => k.slags !== 'noter'), noterKilde({ hjem: dir, platform: 'linux' })],
    });
    try { await fn({ app, runs, dir, vault: path.join(dir, 'Clawco', 'Vault'), tmp, sendt }); } finally {
      await Promise.all(runs.list().map((r) => r.finished.catch(() => null)));
      await new Promise((res) => setTimeout(res, 50));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
}
type S = Parameters<Parameters<typeof medApp>[0]>[0];
const post = (s: S, url: string, body: unknown = {}) => s.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const rolig = (s: S): Promise<unknown> => Promise.all(s.runs.list().map((r) => r.finished.catch(() => null)));
const start = async (s: S): Promise<string> => (await s.app.request('/rum/start')).text();
const state = async (s: S): Promise<StartState> => JSON.parse(await readFile(path.join(s.dir, 'rum', 'start', 'state.json'), 'utf8')) as StartState;
const log = async (s: S): Promise<LogEntry[]> => (await readFile(path.join(s.dir, 'rum', 'start', 'log.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as LogEntry);
const fil = (s: S, rel: string): Promise<string | null> => readFile(path.join(s.vault, rel), 'utf8').catch(() => null);
const trinKort = (h: string): string => /<article[^>]*data-trin="import"[\s\S]*?<\/article>/.exec(h)?.[0] ?? '';

/** The notes folder made, and a first source connected (step 3), so step 5 is on screen. */
async function klargoer(s: S): Promise<void> {
  assert.equal((await post(s, '/api/kilder/noter/forbind', { felter: { opsaetning: 'ny' } })).status, 200);
  assert.equal((await post(s, '/api/kilder/falsk-mail/forbind', { felter: { brugernavn: 'alma', adgangskode: 'hemmelig' } })).status, 200);
  await rolig(s);
}

test('paste → proposal pile → Gem → files with frontmatter → Fortryd removes only those files', async () => {
  await medApp(async (s) => {
    await klargoer(s);
    const foer = await start(s);
    assert.match(trinKort(foer), /data-trin-status="ikke-startet"/);
    assert.match(trinKort(foer), /id="import-form"/);

    const r = await post(s, '/api/rum/start/aktion/import-laes', { tekst: 'Ingrid er min kone. Tore er kollega hos Fyrtaarn.', assistent: 'chatgpt' });
    assert.equal(r.status, 202, await r.clone().text());
    await rolig(s);
    assert.match(s.sendt[0] ?? '', /Ingrid er min kone/);
    const pile = await start(s);
    assert.match(pile, /data-import-bunke/);
    assert.match(pile, /data-import-forslag="p1"/);
    assert.deepEqual(await readdir(path.join(s.vault, '40-Mennesker', 'People')), [], 'nothing is written before the tap');
    assert.deepEqual(await readdir(s.tmp).catch(() => []), [], 'no upload leftovers');

    assert.equal((await post(s, '/api/rum/start/aktion/import-gem', { forslagId: 'p1' })).status, 202);
    await rolig(s);
    const rikke = await fil(s, '40-Mennesker/People/familie/Ingrid.md');
    assert.match(rikke ?? '', /^---\nnavn: Ingrid\nrelation: din kone\nfoedselsdag: 1984-03-12\nzone: privat\nkilde: import-chatgpt\nimporteret: 2026-10-31\n---\n/);
    assert.equal(await fil(s, '40-Mennesker/People/arbejde/Tore Nyvang.md'), null, 'only what was tapped');
    assert.equal((await state(s)).trin['import']?.status, 'klaret');
    assert.match(trinKort(await start(s)), /data-trin-status="klaret"/);

    assert.equal((await post(s, '/api/rum/start/aktion/import-gem-alle', {})).status, 202);
    await rolig(s);
    assert.ok(await fil(s, '40-Mennesker/People/arbejde/Tore Nyvang.md'));
    assert.match((await fil(s, 'Clawco/Om mig.md')) ?? '', /Jeg løber tirsdag og torsdag\./);

    // Fortryd of the second save keeps what the user edited since; the first save's Ingrid is a different handling.
    await writeFile(path.join(s.vault, '40-Mennesker', 'People', 'arbejde', 'Tore Nyvang.md'), 'rettet af mig\n');
    const saves = (await log(s)).filter((e) => e.handlingId === 'import-gem');
    assert.equal(saves.length, 2);
    const anden = saves[1]!;
    assert.match(anden.tekst, /Tore Nyvang\.md/);
    assert.doesNotMatch(anden.tekst, /Ingrid/);
    const f = await post(s, `/api/rum/start/log/${anden.id}/fortryd`);
    assert.equal(f.status, 202, await f.clone().text());
    await rolig(s);
    assert.equal(await fil(s, '40-Mennesker/People/arbejde/Tore Nyvang.md'), 'rettet af mig\n', 'edited since: kept');
    assert.doesNotMatch((await fil(s, 'Clawco/Om mig.md')) ?? '', /løber/, 'the profile is back to the template');
    assert.ok(await fil(s, '40-Mennesker/People/familie/Ingrid.md'), 'the first save is untouched');
    assert.equal((await state(s)).import?.gemt?.length, 1);

    const g = await post(s, `/api/rum/start/log/${saves[0]!.id}/fortryd`);
    assert.equal(g.status, 202);
    await rolig(s);
    assert.equal(await fil(s, '40-Mennesker/People/familie/Ingrid.md'), null);
    assert.equal((await state(s)).import?.gemt, undefined);
    assert.match(trinKort(await start(s)), /data-trin-status="(i-gang|ikke-startet)"/);
  });
});

test('routes: a forged proposal id is a 404 and writes nothing; a refused upload is a 400; no notes folder is a 400 with the reason', async () => {
  await medApp(async (s) => {
    const udenMappe = await post(s, '/api/rum/start/aktion/import-laes', { tekst: 'x' });
    assert.equal(udenMappe.status, 400);
    assert.match(((await udenMappe.json()) as { error: string }).error, /mappe/);
    await klargoer(s);
    assert.equal((await post(s, '/api/rum/start/aktion/import-gem', { forslagId: 'p1' })).status, 404);
    assert.equal((await post(s, '/api/rum/start/aktion/import-laes', { filer: [{ navn: 'x.zip', tekst: 'x' }] })).status, 400);
    assert.equal((await post(s, '/api/rum/start/aktion/import-laes', { filer: [{ navn: '../x.vcf', tekst: 'x' }] })).status, 400);
    assert.equal((await post(s, '/api/rum/start/aktion/import-laes', {})).status, 400);
    assert.deepEqual(await readdir(s.tmp).catch(() => []), []);
    assert.equal(s.sendt.length, 0);
  });
});

test('an uploaded vcf, folded into the one `filer` field as the client does, becomes contacts for Hermes; the upload folder is gone', async () => {
  await medApp(async (s) => {
    await klargoer(s);
    const vcf = 'BEGIN:VCARD\nVERSION:3.0\nFN:Iris Bakke\nORG:Fyrtaarn\nEND:VCARD\n';
    const r = await post(s, '/api/rum/start/aktion/import-laes', { assistent: 'andet', tekst: '', filer: JSON.stringify([{ navn: 'kontakter.vcf', tekst: vcf }]) });
    assert.equal(r.status, 202, await r.clone().text());
    await rolig(s);
    assert.match(s.sendt[0] ?? '', /Iris Bakke/);
    assert.equal((await state(s)).import?.bunke?.slags, 'kontakter');
    assert.deepEqual(await readdir(s.tmp).catch(() => []), []);
  });
});

test('KC-0219 through the real routes: Opdater writes the diff into the existing file (202, not blocked by the policy layer), Fortryd puts the old bytes back', async () => {
  await medApp(async (s) => {
    await klargoer(s);
    await skrivPerson(path.join(s.vault, '40-Mennesker', 'People'), { navn: 'Ingrid', relation: 'hustru', zone: 'privat', tekst: 'Min egen note' }, { mappe: 'familie', zone: 'privat' });
    const foer = await fil(s, '40-Mennesker/People/familie/Ingrid.md');
    assert.equal((await post(s, '/api/rum/start/aktion/import-laes', { tekst: 'Ingrid er min kone.', assistent: 'chatgpt' })).status, 202);
    await rolig(s);
    const pile = await start(s);
    assert.match(pile, /data-aktion="import-opdater" data-arg="\{&quot;forslagId&quot;:&quot;p1&quot;\}"/);
    assert.equal((await post(s, '/api/rum/start/aktion/import-gem', { forslagId: 'p1' })).status, 400, 'Gem never writes over an existing person');
    const r = await post(s, '/api/rum/start/aktion/import-opdater', { forslagId: 'p1' });
    assert.equal(r.status, 202, await r.clone().text());
    await rolig(s);
    assert.equal(await fil(s, '40-Mennesker/People/familie/Ingrid.md'), '---\nnavn: Ingrid\nrelation: din kone\nzone: privat\nfoedselsdag: 1984-03-12\n---\nMin egen note\n');
    assert.ok(!(await state(s)).import?.bunke?.forslag.some((f) => f.id === 'p1'));
    const e = (await log(s)).find((x) => x.handlingId === 'import-opdater')!;
    assert.match(e.tekst, /Opdaterede Ingrid/);
    const f = await post(s, `/api/rum/start/log/${e.id}/fortryd`);
    assert.equal(f.status, 202, await f.clone().text());
    await rolig(s);
    assert.equal(await fil(s, '40-Mennesker/People/familie/Ingrid.md'), foer, 'byte for byte as before');
    assert.ok((await log(s)).find((x) => x.id === e.id)?.fortrudt);
    assert.equal((await post(s, '/api/rum/start/aktion/import-opdater', { forslagId: 'p9' })).status, 404);
  });
});
