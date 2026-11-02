import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { trimNyheder, readNyhederSource, readNyhedsbreve } from '../../src/rooms/nyheder/source.ts';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/avis_data_sample.json', import.meta.url), 'utf8'));

test('trimNyheder keeps every news item with kilde, url, resume and source stats, skipping tasks and experiments', () => {
  const t = trimNyheder({ ...fixture, sources: [...fixture.sources, { source: 'r/dead', type: 'reddit', error: 'HTTP 403', items: [] }] });
  assert.equal(t.nyheder.length, 5);
  assert.equal(t.nyheder[0]?.kilde, 'Eksempel Energi');
  assert.equal(t.nyheder[0]?.resume, 'Systemansvaret skærper kravene til reservekapacitet i vintermånederne.');
  assert.deepEqual(t.kilder, { antal: 4, medNyheder: 3, nyheder: 5, fejlede: ['r/dead'] });
});

test('readNyhederSource returns null without a file and the trimmed data with it', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-ny-'));
  try {
    assert.equal(await readNyhederSource(path.join(dir, 'avis_{date}.json'), new Date('2026-10-26T06:00:00Z')), null);
    await writeFile(path.join(dir, 'avis_2026-10-26.json'), JSON.stringify(fixture));
    const t = await readNyhederSource(path.join(dir, 'avis_{date}.json'), new Date('2026-10-26T06:00:00Z'));
    assert.equal(t?.dato, '2026-10-26');
    assert.equal(t?.nyheder.length, 5);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('readNyhedsbreve lists Archive envelopes dated today and tolerates a failing runner', async () => {
  const stdout = JSON.stringify({ envelopes: [
    { id: '7', subject: 'Ugens energinyt', from: [{ name: 'Eksempel Energi', email: 'n@e' }], date: '2026-10-27T06:10:00Z', flags: [] },
    { id: '6', subject: 'Gammelt', from: [{ name: 'X', email: 'x@e' }], date: '2026-10-20T06:10:00Z', flags: [] },
  ] });
  const calls: string[][] = [];
  const ok = await readNyhedsbreve(async (_c, args) => { calls.push(args); return { code: 0, stdout, stderr: '' }; }, 'himalaya', new Date('2026-10-27T08:00:00Z'));
  assert.deepEqual(ok, [{ mailId: '7', emne: 'Ugens energinyt', fra: 'Eksempel Energi' }]);
  assert.ok(calls[0]?.includes('Archive'));
  const bad = await readNyhedsbreve(async () => ({ code: 1, stdout: '', stderr: 'nope' }), 'himalaya', new Date());
  assert.deepEqual(bad, []);
});
