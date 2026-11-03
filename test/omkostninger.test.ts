// KC-0212: the cost ledger in the tenant app — the owner card in Kø. The validator gives every case of
// the shared conformance fixture the same verdict as Sky's; the card is a bunke block, escaped, owner
// only, and absent when the host has no ledger file (a customer's tenant never gets one).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { daekning, laesOmkostningsfil, validerOmkostninger, OmkostningsFejl, OMKOSTNINGSFIL, type Omkostninger } from '../src/omkostninger/regnskab.ts';
import { renderOmkostninger, OMKOSTNING_SAMLET } from '../src/shell/omkostninger.ts';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import type { Person } from '../src/identitet/husstand.ts';

const rod = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
type Tilfaelde = { navn: string; raw: unknown; fejl?: string; mrr?: number; samlet?: string; nu?: number; tilstande?: Record<string, string> };
const { tilfaelde } = JSON.parse(fs.readFileSync(path.join(rod, 'test', 'fixtures', 'omkostninger-konformitet.json'), 'utf8')) as { tilfaelde: Tilfaelde[] };

const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const MEDLEM: Person = { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' };
const betalt = (aktiv: boolean, navn = 'Ekstra server') => ({ navn, maanedlig: 5600, aktiv, kilde: 'k', laest: '2026-10-31', udloeser: { mrrGange: 2 } });
const gratis = { navn: 'Serveren i kælderen', maanedlig: 0, aktiv: true, udloeser: null };

test('the shared conformance fixture: the same verdict as Sky gives', () => {
  assert.ok(tilfaelde.length >= 15);
  for (const t of tilfaelde) {
    if (t.fejl) {
      assert.throws(() => validerOmkostninger(t.raw), (e: Error) => e instanceof OmkostningsFejl && e.message.startsWith(`config/omkostninger.json: ${t.fejl} `), t.navn);
      continue;
    }
    const d = daekning(validerOmkostninger(t.raw), t.mrr ?? 0);
    assert.equal(d.samlet, t.samlet, t.navn);
    assert.equal(d.nu, t.nu, t.navn);
    for (const [id, tilstand] of Object.entries(t.tilstande ?? {})) assert.equal(d.linjer.find((l) => l.id === id)?.tilstand, tilstand, `${t.navn}: ${id}`);
  }
});

/** KC-0276: the ledger is private (config/omkostninger.json is left out of the public mirror); tests of the real file skip there. */
const LEDGER_MANGLER = fs.existsSync(OMKOSTNINGSFIL) ? false : 'the ledger is not in the public mirror (KC-0276)';

test('laesOmkostningsfil: the real file reads, a missing file is null, an invalid one throws OmkostningsFejl', { skip: LEDGER_MANGLER }, async () => {
  assert.equal(OMKOSTNINGSFIL, path.join(rod, 'config', 'omkostninger.json'));
  const o = await laesOmkostningsfil(OMKOSTNINGSFIL);
  assert.ok(o && daekning(o, 0).nu === 0);
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-omk-'));
  try {
    assert.equal(await laesOmkostningsfil(path.join(dir, 'findes-ikke.json')), null);
    await writeFile(path.join(dir, 'ugyldig.json'), '{ "ressourcer": {} }');
    await assert.rejects(laesOmkostningsfil(path.join(dir, 'ugyldig.json')), OmkostningsFejl);
    await writeFile(path.join(dir, 'ikke-json.json'), '{');
    await assert.rejects(laesOmkostningsfil(path.join(dir, 'ikke-json.json')), OmkostningsFejl);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the card for the real ledger: 0 kr/md now, green, the free services summed up, a bunke block', { skip: LEDGER_MANGLER }, () => {
  const o = validerOmkostninger(JSON.parse(fs.readFileSync(OMKOSTNINGSFIL, 'utf8')));
  const h = String(renderOmkostninger(daekning(o, 0)));
  assert.match(h, /data-blok="bunke"/);
  assert.match(h, /data-omkostninger-samlet="groen"/);
  assert.match(h, /0 kr\/md/);
  assert.match(h, /6 tjenester kører gratis/);
  assert.ok(!h.includes('data-omkostning="hetzner-node-1"'), 'an inactive line far from its trigger is not on screen (KC-0052)');
});

test('the card: red when something paid is on without cover, amber when a trigger is near; every text escaped', () => {
  const o: Omkostninger = validerOmkostninger({ ressourcer: { kaelder: gratis, ekstra: betalt(true, '<script>x</script>') } });
  const roed = String(renderOmkostninger(daekning(o, 0)));
  assert.match(roed, /data-omkostninger-samlet="roed"/);
  assert.match(roed, /data-omkostning="ekstra" data-omkostning-tilstand="udaekket"/);
  assert.match(roed, /56 kr\/md/);
  assert.ok(!roed.includes('<script>x'), 'escaped');
  assert.match(roed, /tilstand-graense/);

  const gul = String(renderOmkostninger(daekning(validerOmkostninger({ ressourcer: { kaelder: gratis, ekstra: betalt(false) } }), 9000)));
  assert.match(gul, /data-omkostninger-samlet="gul"/);
  assert.match(gul, /data-omkostning-tilstand="naer"/);
  assert.match(gul, /tilstand-kraever/);
  assert.deepEqual([...OMKOSTNING_SAMLET], ['groen', 'gul', 'roed']);
});

test('the card when the file cannot be read: one red line, no numbers', () => {
  const h = String(renderOmkostninger('fejl'));
  assert.match(h, /data-omkostninger-samlet="roed"/);
  assert.match(h, /kunne ikke læses/);
});

async function medApp(fn: (lav: (p: Person, laes?: () => Promise<Omkostninger | null>) => ReturnType<typeof createApp>) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-omk-app-'));
  try {
    const store = createFileStore(path.join(dir, 'data'));
    await fn((person, laes) => createApp({
      store, hermes: createFakeAgent({ answer: () => 'Gjort.' }), sourceGlob: '/nonexistent/{date}.json', dataDir: dir,
      mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent', identitet: { fast: person },
      ...(laes ? { omkostninger: { laes, mrr: () => 0 } } : {}),
    }));
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const koe = async (app: ReturnType<typeof createApp>['app'], q = '?kilder=1') => (await (await app.request(`/api/koe${q}`)).json()) as { omkostninger?: string };

test('GET /api/koe?kilder=1: the owner gets the card, a member does not, nobody without a ledger; a broken file is a red line, not a 500', { skip: LEDGER_MANGLER }, async () => {
  const real = () => laesOmkostningsfil(OMKOSTNINGSFIL);
  await medApp(async (lav) => {
    assert.match((await koe(lav(EJER, real).app)).omkostninger ?? '', /data-omkostninger-samlet="groen"/);
    assert.equal((await koe(lav(MEDLEM, real).app)).omkostninger, '');
    assert.equal((await koe(lav(EJER, real).app, '')).omkostninger, undefined, 'only while the panel is open');
    assert.equal((await koe(lav(EJER, async () => null).app)).omkostninger, '', 'no ledger on this host: no card');
    assert.equal((await koe(lav(EJER).app)).omkostninger, '', 'no ledger configured: no card');
    const res = await lav(EJER, async () => { throw new OmkostningsFejl('config/omkostninger.json: x mangler'); }).app.request('/api/koe?kilder=1');
    assert.equal(res.status, 200);
    assert.match(((await res.json()) as { omkostninger: string }).omkostninger, /data-omkostninger-samlet="roed"/);
  });
});

test('the shell gives only the owner the slot the card is drawn in', async () => {
  await medApp(async (lav) => {
    const ejer = await (await lav(EJER, async () => null).app.request('/rum/hjem')).text();
    const medlem = await (await lav(MEDLEM, async () => null).app.request('/rum/hjem')).text();
    assert.match(ejer, /data-omkostninger="panel"/);
    assert.ok(!medlem.includes('data-omkostninger="panel"'));
  });
});

test('the tenant image never gets the ledger: .dockerignore excludes config/omkostninger.json', () => {
  const linjer = fs.readFileSync(path.join(rod, '.dockerignore'), 'utf8').split('\n').map((l) => l.trim());
  assert.ok(linjer.includes('config/omkostninger.json'));
});

test('the test world: green most of the day, amber in the evening, red late; no forbidden word in its ledger', async () => {
  const { testOmkostninger } = await import('../src/testtilstand/indhold/omkostninger.ts');
  const { MOMENTER, FORBUDT } = await import('../src/testtilstand/indhold.ts');
  const farve = Object.fromEntries(MOMENTER.map((m) => { const t = testOmkostninger(m.id); return [m.id, daekning(t.regnskab, t.mrr).samlet]; }));
  assert.equal(farve['aften'], 'gul');
  assert.equal(farve['sent-aften'], 'roed');
  assert.equal(farve['morgen'], 'groen');
  const tekst = JSON.stringify(MOMENTER.map((m) => testOmkostninger(m.id))).toLowerCase();
  for (const ord of FORBUDT) assert.ok(!tekst.includes(ord.toLowerCase()), ord);
});
