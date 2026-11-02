// KC-0203 (tenant side of the closed beta): the beta switch, the day count, which feedback card is due, and the small
// state file. Everything here is pure or runs on a temp folder; nothing happens without KC_BETA=ja.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { betaFraMiljoe } from '../../src/beta/miljoe.ts';
import { betaDag, FEEDBACK_DAGE, kortDue, lavBetaLager, parseBetaTilstand, type BetaTilstand } from '../../src/beta/tilstand.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-beta-'));
after(() => rm(rod, { recursive: true, force: true }));

test('betaFraMiljoe: nothing unless KC_BETA is exactly "ja"; consent at start only from KC_BETA_SAMTYKKE=ja', () => {
  for (const env of [{}, { KC_BETA: '' }, { KC_BETA: 'nej' }, { KC_BETA: 'true' }, { KC_BETA: 'JA' }, { KC_BETA_SAMTYKKE: 'ja' }]) assert.equal(betaFraMiljoe(env), null, JSON.stringify(env));
  assert.deepEqual(betaFraMiljoe({ KC_BETA: 'ja' }), { samtykkeStart: false });
  assert.deepEqual(betaFraMiljoe({ KC_BETA: 'ja', KC_BETA_SAMTYKKE: 'nej' }), { samtykkeStart: false });
  assert.deepEqual(betaFraMiljoe({ KC_BETA: 'ja', KC_BETA_SAMTYKKE: 'ja' }), { samtykkeStart: true });
  assert.deepEqual(betaFraMiljoe({ KC_BETA: ' ja ' }), { samtykkeStart: false }, 'surrounding spaces are tolerated, as for the other switches');
});

test('betaDag: 1-based UTC day number from the first boot', () => {
  const startet = '2026-11-02T23:30:00.000Z';
  assert.equal(betaDag(startet, new Date('2026-11-02T23:59:59Z')), 1);
  assert.equal(betaDag(startet, new Date('2026-11-03T00:00:00Z')), 2, 'a new UTC day is a new day number, however little time has passed');
  assert.equal(betaDag(startet, new Date('2026-11-04T05:00:00Z')), 3);
  assert.equal(betaDag(startet, new Date('2026-11-16T00:00:00Z')), 15);
  assert.equal(betaDag(startet, new Date('2026-11-01T00:00:00Z')), 1, 'a clock before the start never gives day 0');
});

const t = (o: Partial<BetaTilstand> = {}): BetaTilstand => ({ startet: '2026-11-01T08:00:00.000Z', samtykke: false, svaret: {}, feedback: [], ...o });
const paaDag = (n: number, time = 10): Date => new Date(Date.UTC(2026, 10, n, time));

test('kortDue: the newest card whose day has come and is unanswered; one at a time; none after day 21', () => {
  assert.deepEqual([...FEEDBACK_DAGE], [3, 7, 14]);
  const tabel: [number, number | null][] = [[1, null], [2, null], [3, 3], [4, 3], [6, 3], [7, 7], [10, 7], [13, 7], [14, 14], [20, 14], [21, 14], [22, null], [30, null]];
  for (const [dag, kort] of tabel) assert.equal(kortDue(t(), paaDag(dag)), kort, `day ${dag}`);
});

test('kortDue: an answered card is gone; the day-3 card unanswered on day 7 is not shown any more (the newest wins)', () => {
  assert.equal(kortDue(t({ svaret: { 3: 'x' } }), paaDag(5)), null);
  assert.equal(kortDue(t({ svaret: { 3: 'x' } }), paaDag(7)), 7);
  assert.equal(kortDue(t({ svaret: { 7: 'x' } }), paaDag(8)), null, 'day 3 was skipped; it does not come back after day 7 arrived and was answered');
  assert.equal(kortDue(t({ svaret: { 14: 'x' } }), paaDag(15)), null);
});

test('kortDue: "Ikke nu" hides that card for the rest of the UTC day only; another card is not hidden by it', () => {
  const udsat = { dag: 3 as const, dato: '2026-11-04' };
  assert.equal(kortDue(t({ udsat }), paaDag(4, 9)), null);
  assert.equal(kortDue(t({ udsat }), paaDag(4, 23)), null);
  assert.equal(kortDue(t({ udsat }), paaDag(5, 0)), 3, 'back the next day');
  assert.equal(kortDue(t({ udsat }), paaDag(8)), 7, 'a snooze of day 3 does not hide day 7');
});

test('parseBetaTilstand: accepts what the lager writes, refuses anything malformed (no guessing)', () => {
  const ok = t({ samtykke: true, betaKortLukket: '2026-11-01T09:00:00.000Z', feedback: [{ dag: 3, vurdering: 4, tekst: 'ok', betale: null, tid: '2026-11-04T08:00:00.000Z' }], svaret: { 3: '2026-11-04T08:00:00.000Z' } });
  assert.deepEqual(parseBetaTilstand(JSON.parse(JSON.stringify(ok))), ok);
  for (const bad of [null, [], 'x', {}, { ...ok, startet: 'i går' }, { ...ok, samtykke: 'ja' }, { ...ok, feedback: [{ dag: 4, vurdering: 4, tekst: null, betale: null, tid: ok.startet }] },
    { ...ok, feedback: [{ dag: 3, vurdering: 6, tekst: null, betale: null, tid: ok.startet }] }, { ...ok, feedback: [{ dag: 3, vurdering: 3, tekst: null, betale: 'ja', tid: ok.startet }] }, { ...ok, svaret: { 5: ok.startet } }]) {
    assert.equal(parseBetaTilstand(bad), null, JSON.stringify(bad).slice(0, 80));
  }
});

test('lager: the first read creates beta.json (start now, consent from the env value), later reads keep both; the person owns consent after that', async () => {
  const dir = path.join(rod, 'foerste');
  const nu = new Date('2026-11-02T10:00:00Z');
  const a = lavBetaLager({ dir, nu: () => nu, samtykkeStart: true });
  const foerste = await a.laes();
  assert.deepEqual(foerste, { startet: nu.toISOString(), samtykke: true, svaret: {}, feedback: [] });
  await a.aendre((s) => ({ ...s, samtykke: false }));
  // A restart with the env still saying ja: the person's no stands, the start day is kept.
  const b = lavBetaLager({ dir, nu: () => new Date('2026-12-24T10:00:00Z'), samtykkeStart: true });
  const efter = await b.laes();
  assert.equal(efter?.samtykke, false);
  assert.equal(efter?.startet, nu.toISOString());
});

test('lager: writes are atomic (no temp file left), serialised (two changes at once both land), and the file is valid JSON', async () => {
  const dir = path.join(rod, 'atomisk');
  const l = lavBetaLager({ dir, nu: () => new Date('2026-11-02T10:00:00Z'), samtykkeStart: false });
  await l.laes();
  await Promise.all([l.aendre((s) => ({ ...s, betaKortLukket: '2026-11-02T10:01:00.000Z' })), l.aendre((s) => ({ ...s, svaret: { ...s.svaret, 3: '2026-11-05T10:00:00.000Z' } }))]);
  const s = JSON.parse(await readFile(path.join(dir, 'beta.json'), 'utf8')) as BetaTilstand;
  assert.equal(s.betaKortLukket, '2026-11-02T10:01:00.000Z');
  assert.equal(s.svaret[3], '2026-11-05T10:00:00.000Z');
  assert.deepEqual((await readdir(dir)).filter((f) => f.includes('.tmp')), []);
});

test('lager: a damaged file fails loudly (never a silent reset that would restart the day count or flip consent)', async () => {
  const dir = path.join(rod, 'itu');
  const l = lavBetaLager({ dir, nu: () => new Date(), samtykkeStart: true });
  await l.laes();
  await writeFile(path.join(dir, 'beta.json'), '{ ikke json', 'utf8');
  await assert.rejects(() => l.laes(), /beta\.json/);
  assert.equal((await readFile(path.join(dir, 'beta.json'), 'utf8')), '{ ikke json', 'the broken file is left for a person to look at');
});

test('lager with kunMedFil (the test world): no file = beta is off and nothing is created', async () => {
  const dir = path.join(rod, 'verden');
  const l = lavBetaLager({ dir, nu: () => new Date(), samtykkeStart: false, kunMedFil: true });
  assert.equal(await l.laes(), null);
  await assert.rejects(() => readFile(path.join(dir, 'beta.json'), 'utf8'), /ENOENT/);
});
