// KC-0226: Kuratoren runs once per zone that has material. The privat run is what it always was (its prompt is pinned
// by privat-prompt.golden.txt); an arbejde run and a husstand run read ONLY that zone's messages and open cards, never
// two zones in one prompt, and their cards land in Nu with the zone set (the chip and who may see them follow from it).
//
// To change the pinned privat prompt on purpose, regenerate the golden with the same two builds as `privatPrompt()` below
// (normalised boundary) and say in the commit that every install's privat run changed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { laesKurator, startKurator, endreKurator, synligKurator } from '../../src/kurator/kurator.ts';
import { buildKuratorRun, type KuratorInput } from '../../src/kurator/prompt.ts';
import { nyeBeskeder } from '../../src/kurator/beskeder.ts';
import { regnskabsfil } from '../../src/kurator/regnskab.ts';
import { renderHjem } from '../../src/rooms/hjem/render.ts';
import type { Kort, Lukning } from '../../src/rooms/hjem/kort.ts';
import { DATAZONER, type DataZone } from '../../src/identitet/zoner.ts';
import type { Person } from '../../src/identitet/husstand.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createRunRegistry } from '../../src/runs.ts';
import { createLiveBus } from '../../src/live.ts';
import { lavRevisionslog } from '../../src/graenser/revisionslog.ts';
import type { AgentRunRequest } from '../../src/agent/types.ts';
import type { RoomDeps, KuratorBesked } from '../../src/rooms/module.ts';
import type { Runner } from '../../src/rooms/mail/source.ts';
import { PRIVAT_FULD, PRIVAT_DYB } from './privat-fixtur.ts';

const NOW = new Date('2026-11-01T10:00:00Z');
const ingenMail: Runner = async () => ({ code: 0, stdout: '[]', stderr: '' });

// ---------- the privat prompt is pinned ----------

const norm = (s: string): string => s.replace(/\b[0-9a-f]{24}\b/g, 'GRAENSE');
const privatPrompt = (): string => [PRIVAT_FULD, PRIVAT_DYB].map((i) => { const s = buildKuratorRun(i); return `=== instructions ===\n${norm(s.instructions)}\n=== input ===\n${norm(s.input)}\n`; }).join('\n');

test('the privat run prompt is byte-identical to the one pinned before the zone runs (explicit zone or none)', async () => {
  const golden = await readFile(new URL('./privat-prompt.golden.txt', import.meta.url), 'utf8');
  assert.equal(privatPrompt(), golden);
  const eksplicit = [{ ...PRIVAT_FULD, zone: 'privat' as const }, { ...PRIVAT_DYB, zone: 'privat' as const }].map((i) => { const s = buildKuratorRun(i); return `=== instructions ===\n${norm(s.instructions)}\n=== input ===\n${norm(s.input)}\n`; }).join('\n');
  assert.equal(eksplicit, golden);
});

// ---------- never two zones in one prompt ----------

const ord = (z: DataZone, hvad: string): string => `${z.toUpperCase()}-${hvad}`;
const kortI = (z: DataZone): Kort => ({ id: `besked:${z}`, type: 'familie', titel: ord(z, 'KORTTITEL'), betyder: ord(z, 'KORTBETYDER'), grundlag: [], kilder: [], anbefaling: ord(z, 'ANBEFALING'), prioritet: 2, zone: z });
const lukI = (z: DataZone): Lukning => ({ id: `l:${z}`, titel: ord(z, 'LUKKET'), grund: ord(z, 'GRUND'), dato: '2026-10-31', zone: z });
const beskedId = (z: DataZone): string => `b-${DATAZONER.indexOf(z).toString().repeat(16)}`;
const beskedI = (z: DataZone): KuratorBesked => ({ id: beskedId(z), kanal: 'signal', samtaleNavn: ord(z, 'SAMTALE'), afsender: { navn: ord(z, 'AFSENDER') }, tid: '2026-11-01T09:00:00.000Z', tekst: ord(z, 'BESKEDTEKST'), zone: z });

const BLANDET: KuratorInput = {
  mails: [{ id: '1', mappe: 'Inbox', emne: 'MAIL-EMNE', fra: 'Rikke', modtaget: '2026-11-01T08:00:00Z' }],
  nyheder: ['NYHEDS-LINJE'],
  aabne: DATAZONER.map(kortI),
  lukket: DATAZONER.map(lukI),
  dyb: false, now: NOW, stier: { vault: '/vault', personer: '/people' },
  beskeder: DATAZONER.map(beskedI),
};

test('invariant: each zone prompt holds only its own zone — cards, closed cards, messages, segment headers and the zone line', () => {
  for (const zone of DATAZONER) {
    const spec = buildKuratorRun({ ...BLANDET, zone });
    const alt = `${spec.instructions}\n${spec.input}`;
    assert.match(spec.instructions, new RegExp(`Zone: ${zone}\\. `), `${zone}: zone line`);
    for (const andre of DATAZONER.filter((z) => z !== zone)) {
      assert.ok(!alt.includes(ord(andre, '')), `${zone} prompt mentions ${andre} content`);
      assert.ok(!new RegExp(`Zone: ${andre}\\.`).test(spec.instructions));
    }
    for (const hvad of ['KORTTITEL', 'LUKKET', 'SAMTALE', 'BESKEDTEKST']) assert.ok(alt.includes(ord(zone, hvad)), `${zone} prompt lacks its own ${hvad}`);
    const headers = [...spec.input.matchAll(/· zone: (\w+) ·/g)].map((m) => m[1]);
    assert.ok(headers.length > 0);
    assert.deepEqual([...new Set(headers)], [zone], `${zone}: every data segment is tagged ${zone}`);
  }
});

test('the arbejde and husstand prompts read messages only: no mail, news, ledger, himalaya or private notes', () => {
  for (const zone of ['arbejde', 'husstand'] as const) {
    const spec = buildKuratorRun({ ...BLANDET, zone });
    const alt = `${spec.instructions}\n${spec.input}`;
    for (const ikke of ['MAIL-EMNE', 'NYHEDS-LINJE', 'himalaya', 'regnskab', '10-Privat', '"mailId"', 'Cloudflare']) assert.ok(!alt.includes(ikke), `${zone} prompt has ${ikke}`);
    assert.match(spec.instructions, /beskedId/);
    assert.match(spec.instructions, /aldrig en "handling"/);
    assert.match(spec.instructions, /Du er Kuratoren/);
  }
  const privat = buildKuratorRun({ ...BLANDET, zone: 'privat' });
  assert.ok(privat.input.includes('MAIL-EMNE') && privat.input.includes('NYHEDS-LINJE'));
});

test('nyeBeskeder: a zone selects its own messages; the default is privat', () => {
  const alle = DATAZONER.map(beskedI);
  assert.deepEqual(nyeBeskeder(alle, []).map((b) => b.zone), ['privat']);
  for (const z of DATAZONER) assert.deepEqual(nyeBeskeder(alle, [], z).map((b) => b.zone), [z]);
  assert.deepEqual(nyeBeskeder(alle, [beskedId('arbejde')], 'arbejde'), []);
  const { zone: _z, ...utenZone } = beskedI('privat');
  assert.equal(nyeBeskeder([utenZone], [], 'privat').length, 1); // no zone reads as privat
});

// ---------- the runs ----------

const EJER = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' } satisfies Person;

type Svar = (req: AgentRunRequest, zone: DataZone) => string;
const zoneAfReq = (req: AgentRunRequest): DataZone => /Zone: (privat|arbejde|husstand)\./.exec(req.instructions)?.[1] as DataZone;
const fenced = (o: unknown): string => '```json\n' + JSON.stringify(o) + '\n```';
/** One card per message in the run, zone left out (= the run's own). */
const etKortPerBesked: Svar = (req, zone) => fenced({
  kort: [...req.input.matchAll(/"id": "(b-[0-9a-f]{16})"/g)].map((m, i) => ({ id: `besked:${zone}:${i}`, type: 'familie', titel: ord(zone, `KORT${i}`), betyder: 'Hun beder om noget.', anbefaling: 'Svar selv.', prioritet: 3, beskedId: m[1] })),
  vurderinger: [], intet: [],
});

async function opsaet(svar: Svar, beskeder: KuratorBesked[], o: { mail?: Runner } = {}) {
  const rod = await mkdtemp(join(tmpdir(), 'kc-kurator-zoner-'));
  const hermes = createFakeAgent({ answer: (req) => svar(req, zoneAfReq(req)) });
  const runs = createRunRegistry(hermes);
  runs.setModels({ lille: 'model-lille', taenker: 'model-taenker' });
  const store = createFileStore(join(rod, 'data'));
  const revision = lavRevisionslog(join(rod, 'data'));
  const d = { store, hermes, runs, live: createLiveBus(), now: () => NOW, mailRunner: o.mail ?? ingenMail, himalaya: 'himalaya', vaultInbox: join(rod, 'vault', '00-Indbakke'), vaultRod: join(rod, 'vault'), regnskabsfil: (h: 'shelfatlas' | 'privat') => regnskabsfil(join(rod, 'vault'), h), beskeder: async () => beskeder, revision, person: EJER } as unknown as RoomDeps;
  const faerdige = async () => { await Promise.all(runs.list().filter((r) => r.kind === 'kurator').map((r) => r.finished)); };
  return { d, hermes, runs, store, revision, faerdige, ryd: () => rm(rod, { recursive: true, force: true }) };
}

test('arbejde and husstand messages alone start one run each, each with only its own zone; the cards land with their zone and sender line', async () => {
  const t = await opsaet(etKortPerBesked, DATAZONER.map(beskedI).filter((b) => b.zone !== 'privat'));
  try {
    const foerste = await startKurator(t.d, { dyb: false, nyheder: null });
    assert.ok(foerste, 'new arbejde/husstand messages start runs although nothing privat is new');
    await t.faerdige();
    assert.equal(t.hermes.calls.length, 2);
    assert.deepEqual(t.hermes.calls.map((c) => zoneAfReq(c)).sort(), ['arbejde', 'husstand']);
    for (const c of t.hermes.calls) {
      const z = zoneAfReq(c);
      for (const andre of DATAZONER.filter((x) => x !== z)) assert.ok(!`${c.instructions}${c.input}`.includes(ord(andre, '')), `${z} run saw ${andre}`);
    }
    const s = await laesKurator(t.store);
    assert.deepEqual(s.kort.map((k) => k.zone).sort(), ['arbejde', 'husstand']);
    for (const k of s.kort) {
      assert.equal(k.handling, undefined);
      assert.equal(k.besked?.afsender, ord(k.zone as DataZone, 'AFSENDER'));
      assert.equal(k.beskedId, beskedId(k.zone as DataZone));
    }
    assert.deepEqual([...(s.beskederSete ?? [])].sort(), [beskedId('arbejde'), beskedId('husstand')].sort());
    // The privat bookkeeping is the privat run's alone: a zone run moves neither the mail cursor nor the seen mail.
    assert.equal(s.cursor, undefined);
    assert.deepEqual(s.sete, []);
    assert.equal(s.sidst, undefined);
  } finally { await t.ryd(); }
});

test('all three zones with material: three runs (privat unchanged in what it reads); a second start with nothing new costs nothing; one new message costs one run', async () => {
  const lager = DATAZONER.map(beskedI);
  const t = await opsaet(etKortPerBesked, lager);
  try {
    assert.ok(await startKurator(t.d, { dyb: false, nyheder: null }));
    await t.faerdige();
    assert.equal(t.hermes.calls.length, 3);
    assert.deepEqual(t.hermes.calls.map(zoneAfReq).sort(), ['arbejde', 'husstand', 'privat']);
    assert.equal((await laesKurator(t.store)).kort.length, 3);
    assert.equal(await startKurator(t.d, { dyb: false, nyheder: null }), null, 'nothing new in any zone = no run');
    assert.equal(t.hermes.calls.length, 3);
    // One new husstand message: exactly one more run, and it is the husstand run.
    lager.push({ ...beskedI('husstand'), id: 'b-ffffffffffffffff', tekst: 'HUSSTAND-NY' });
    assert.ok(await startKurator(t.d, { dyb: false, nyheder: null }));
    await t.faerdige();
    assert.deepEqual(t.hermes.calls.map(zoneAfReq).slice(3), ['husstand']);
  } finally { await t.ryd(); }
});

test('a zone run that finds nothing makes no card and no log line, but is on the audit log with its zone', async () => {
  const t = await opsaet(() => fenced({ kort: [], vurderinger: [], intet: [] }), [beskedI('arbejde')]);
  try {
    const run = await startKurator(t.d, { dyb: false, nyheder: null });
    assert.ok(run);
    assert.equal(run.zone, 'arbejde');
    assert.equal((await run.finished).status, 'done');
    const s = await laesKurator(t.store);
    assert.deepEqual(s.kort, []);
    assert.deepEqual(s.intet, []);
    assert.deepEqual(s.beskederSete, [beskedId('arbejde')], 'read, so not read again');
    assert.deepEqual(await t.store.readLog('hjem', 50), []);
    const rev = await t.revision.seneste(5);
    assert.equal(rev.length, 1);
    assert.deepEqual(rev[0]?.zoner, ['arbejde']);
    assert.equal(rev[0]?.rum, 'hjem');
    assert.equal(rev[0]?.runId, run.id);
    assert.equal(rev[0]?.udfald, 'tillad');
    assert.match(rev[0]?.hvorfor ?? '', /arbejde/i);
  } finally { await t.ryd(); }
});

test('a zone run with cards writes a room log line and an audit line that both name the zone', async () => {
  const t = await opsaet(etKortPerBesked, [beskedI('husstand')]);
  try {
    const run = await startKurator(t.d, { dyb: false, nyheder: null });
    assert.ok(run);
    assert.equal(run.zone, 'husstand');
    await run.finished;
    const log = await t.store.readLog('hjem', 50);
    assert.equal(log.length, 1);
    assert.equal(log[0]?.zone, 'husstand');
    assert.match(log[0]?.tekst ?? '', /Husstand/);
    assert.equal(log[0]?.kilde, 'hermes');
    const rev = await t.revision.seneste(5);
    assert.deepEqual(rev.map((r) => r.zoner), [['husstand']]);
    assert.match(rev[0]?.hvorfor ?? '', /husstand/i);
  } finally { await t.ryd(); }
});

test('a zone run whose answer names another zone is rejected twice and fails; nothing is stored and the message stays unread', async () => {
  const t = await opsaet((_req, zone) => fenced({ kort: [{ id: 'x', type: 'familie', titel: 'Fra en anden zone', betyder: 'b', zone: zone === 'arbejde' ? 'privat' : zone }], vurderinger: [], intet: [] }), [beskedI('arbejde')]);
  try {
    const run = await startKurator(t.d, { dyb: false, nyheder: null });
    assert.ok(run);
    assert.equal((await run.finished).status, 'failed');
    const s = await laesKurator(t.store);
    assert.deepEqual(s.kort, []);
    assert.equal(s.beskederSete, undefined);
    assert.equal(await (async () => (await t.revision.seneste(5)).length)(), 0, 'a failed run is not on the audit log as read');
  } finally { await t.ryd(); }
});

test('a zone card cannot take a beskedId from another zone, nor the sender line of another zone’s stored card, nor overwrite its card', async () => {
  const privatKort: Kort = { id: 'besked:privat:0', type: 'familie', titel: 'PRIVAT-STORET', betyder: 'b', grundlag: [], kilder: [], anbefaling: '', prioritet: 4, zone: 'privat', beskedId: beskedId('privat'), besked: { kanal: 'signal', afsender: 'PRIVAT-AFSENDER' } };
  const t = await opsaet((_req, zone) => fenced({
    kort: [
      { id: 'besked:arbejde:laan', type: 'familie', titel: 'Lånt linje', betyder: 'b', beskedId: beskedId('privat') },
      { id: 'besked:privat:0', type: 'familie', titel: 'OVERSKREVET', betyder: 'b' },
    ].filter(() => zone === 'arbejde'),
    vurderinger: [], intet: [],
  }), [beskedI('arbejde')]);
  try {
    await endreKurator(t.store, (s) => ({ ...s, kort: [privatKort] }));
    const run = await startKurator(t.d, { dyb: false, nyheder: null });
    assert.ok(run);
    assert.equal((await run.finished).status, 'done');
    const s = await laesKurator(t.store);
    const laan = s.kort.find((k) => k.id === 'besked:arbejde:laan');
    assert.ok(laan);
    assert.equal(laan.zone, 'arbejde');
    assert.equal(laan.beskedId, undefined);
    assert.equal(laan.besked, undefined);
    const privat = s.kort.find((k) => k.id === 'besked:privat:0');
    assert.equal(privat?.titel, 'PRIVAT-STORET', 'the privat card is untouched');
    assert.deepEqual(privat?.besked, { kanal: 'signal', afsender: 'PRIVAT-AFSENDER' });
  } finally { await t.ryd(); }
});

test('the privat run does not see the other zones’ open cards and does not retire them', async () => {
  const lagret: Kort[] = [kortI('arbejde'), kortI('husstand'), { ...kortI('privat'), id: 'besked:privat' }];
  const t = await opsaet((_req, zone) => fenced({ kort: [], vurderinger: zone === 'privat' ? [{ id: 'besked:privat', status: 'behold', hvorfor: 'stadig' }] : [], intet: [] }), [beskedI('privat')]);
  try {
    await endreKurator(t.store, (s) => ({ ...s, kort: lagret }));
    const run = await startKurator(t.d, { dyb: false, nyheder: null });
    assert.ok(run);
    await run.finished;
    assert.equal(t.hermes.calls.length, 1);
    const alt = `${t.hermes.calls[0]!.instructions}${t.hermes.calls[0]!.input}`;
    assert.ok(alt.includes(ord('privat', 'KORTTITEL')));
    for (const andre of ['arbejde', 'husstand'] as const) assert.ok(!alt.includes(ord(andre, '')), `the privat run saw ${andre}`);
    const s = await laesKurator(t.store);
    assert.deepEqual(s.kort.map((k) => k.zone).sort(), ['arbejde', 'husstand', 'privat']);
    assert.equal(s.kort.find((k) => k.zone === 'arbejde')?.titel, ord('arbejde', 'KORTTITEL'));
  } finally { await t.ryd(); }
});

test('the arbejde run is shown only its own open cards, and a card it leaves unstood is retired — the other zones’ cards stay', async () => {
  const t = await opsaet((_req, _zone) => fenced({ kort: [], vurderinger: [], intet: [] }), [{ ...beskedI('arbejde'), id: 'b-aaaaaaaaaaaaaaaa' }]);
  try {
    await endreKurator(t.store, (s) => ({ ...s, kort: DATAZONER.map(kortI) }));
    const run = await startKurator(t.d, { dyb: false, nyheder: null });
    assert.ok(run);
    await run.finished;
    const alt = `${t.hermes.calls[0]!.instructions}${t.hermes.calls[0]!.input}`;
    assert.ok(alt.includes(ord('arbejde', 'KORTTITEL')));
    assert.ok(!alt.includes(ord('privat', '')) && !alt.includes(ord('husstand', '')));
    assert.deepEqual((await laesKurator(t.store)).kort.map((k) => k.zone).sort(), ['husstand', 'privat']);
  } finally { await t.ryd(); }
});

// ---------- who sees the cards, and how Nu shows them ----------

const henrik: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const maja: Person = { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' };
const gaest: Person = { id: 'gus', login: null, navn: 'Gus', rolle: 'gaest' };

test('message cards in arbejde and husstand: the owner sees both, a member only the husstand card, a guest none', () => {
  const s = { kort: DATAZONER.map(kortI), intet: [], afvist: [], sete: [] };
  assert.deepEqual(synligKurator(s, henrik).kort.map((k) => k.zone), ['privat', 'arbejde', 'husstand']);
  assert.deepEqual(synligKurator(s, maja).kort.map((k) => k.zone), ['husstand']);
  assert.deepEqual(synligKurator(s, gaest).kort.map((k) => k.zone), []);
});

test('Nu draws the zone chip on a message card, and an arbejde card is not labelled "Fra familien"', () => {
  const kort = DATAZONER.map((z) => ({ ...kortI(z), besked: { kanal: 'signal', afsender: ord(z, 'AFSENDER') } }));
  const ud = String(renderHjem({ hilsen: 'Hej', venter: [], now: NOW, person: henrik, kort, intet: [], regnskab: [], hermes: [] }));
  for (const [z, chip] of [['arbejde', 'Arbejde'], ['husstand', 'Husstand'], ['privat', 'Privat']] as const) {
    const kortHtml = new RegExp(`<article[^>]*data-kort-id="besked:${z}"[^>]*data-datazone="${z}"[\\s\\S]*?</article>`).exec(ud)?.[0] ?? '';
    assert.ok(kortHtml, `${z}: card markup`);
    assert.ok(kortHtml.includes(`<span class="chip zone-chip">${chip}</span>`), `${z}: chip`);
    assert.ok(kortHtml.includes('data-besked-kanal'), `${z}: the "Clawco læser kun" sender line`);
  }
  const arbejde = new RegExp('<article[^>]*data-kort-id="besked:arbejde"[\\s\\S]*?</article>').exec(ud)?.[0] ?? '';
  assert.ok(!arbejde.includes('Fra familien'));
  assert.ok(arbejde.includes('Fra arbejdet'));
  const husstand = new RegExp('<article[^>]*data-kort-id="besked:husstand"[\\s\\S]*?</article>').exec(ud)?.[0] ?? '';
  assert.ok(husstand.includes('Fra familien'));
});
