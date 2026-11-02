// KC-0233: what the Digital Post rule remembers — the confirmed sender(s), the notices marked "Set den", which viewer the
// person's link goes to, and a snooze of Start's step. One small file, $KC_DATA_DIR/danmark/digital-post.json, written atomically.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DanmarkFejl, lavDanmarkLager, parseDanmarkTilstand, STANDARD, VISERE, erViser, type DanmarkTilstand } from '../../src/danmark/tilstand.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-danmark-'));
after(() => rm(rod, { recursive: true, force: true }));
let nr = 0;
const dir = (): string => path.join(rod, `t${++nr}`);

test('without a file: the default (no sender, nothing seen, mit.dk), and reading creates nothing', async () => {
  const d = dir();
  const lager = lavDanmarkLager({ dir: d });
  assert.deepEqual(await lager.laes(), STANDARD);
  assert.deepEqual(STANDARD, { afsendere: [], set: [], viser: 'mit.dk' });
  await assert.rejects(() => readdir(d), /ENOENT/);
});

test('aendre writes danmark/digital-post.json atomically: valid JSON, no temp file left, the change is read back', async () => {
  const d = dir();
  const lager = lavDanmarkLager({ dir: d });
  await lager.aendre((s) => ({ ...s, afsendere: ['post@notifikation.digitalpost.example'], viser: 'borger.dk' }));
  assert.deepEqual(await readdir(path.join(d, 'danmark')), ['digital-post.json']);
  const paa: DanmarkTilstand = JSON.parse(await readFile(path.join(d, 'danmark', 'digital-post.json'), 'utf8'));
  assert.deepEqual(paa, { afsendere: ['post@notifikation.digitalpost.example'], set: [], viser: 'borger.dk' });
  assert.deepEqual(await lavDanmarkLager({ dir: d }).laes(), paa, 'a fresh lager (a restart) reads the same');
});

test('two changes at once both land (serialised)', async () => {
  const lager = lavDanmarkLager({ dir: dir() });
  await Promise.all([lager.aendre((s) => ({ ...s, set: [...s.set, 'a'] })), lager.aendre((s) => ({ ...s, set: [...s.set, 'b'] }))]);
  assert.deepEqual((await lager.laes()).set.sort(), ['a', 'b']);
});

test('parse: accepts what the lager writes, refuses anything malformed (no guessing)', () => {
  const ok: DanmarkTilstand = { afsendere: ['post@x.example'], set: ['<a@x.example>', '7'], viser: 'e-boks', afvist: '2026-11-02T10:00:00.000Z' };
  assert.deepEqual(parseDanmarkTilstand(JSON.parse(JSON.stringify(ok))), ok);
  for (const daarlig of [null, [], 'x', {}, { ...ok, afsendere: 'post@x.example' }, { ...ok, afsendere: ['ikke en adresse'] }, { ...ok, afsendere: ['POST@X.EXAMPLE'] }, { ...ok, afsendere: [1] },
    { ...ok, set: 'a' }, { ...ok, set: [1] }, { ...ok, viser: 'google.com' }, { ...ok, viser: undefined }, { ...ok, afvist: 'i går' }]) {
    assert.equal(parseDanmarkTilstand(daarlig), null, JSON.stringify(daarlig));
  }
});

test('a damaged file fails loudly (DanmarkFejl), nothing is repaired by guessing; a file the lager cannot read fails too', async () => {
  const d = dir();
  await mkdir(path.join(d, 'danmark'), { recursive: true });
  await writeFile(path.join(d, 'danmark', 'digital-post.json'), '{ ikke json');
  await assert.rejects(() => lavDanmarkLager({ dir: d }).laes(), DanmarkFejl);
  await writeFile(path.join(d, 'danmark', 'digital-post.json'), JSON.stringify({ afsendere: ['a'], set: [], viser: 'mit.dk' }));
  await assert.rejects(() => lavDanmarkLager({ dir: d }).aendre((s) => s), DanmarkFejl);
});

test('the viewers: a fixed https front page each, no query, no fragment, never built from mail content', () => {
  assert.deepEqual(Object.keys(VISERE).sort(), ['borger.dk', 'e-boks', 'mit.dk']);
  for (const [id, v] of Object.entries(VISERE)) {
    const u = new URL(v.url);
    assert.equal(u.protocol, 'https:', id);
    assert.equal(u.search + u.hash, '', id);
    assert.ok(v.navn.length > 2, id);
    assert.ok(erViser(id));
  }
  assert.ok(!erViser('google.com') && !erViser(undefined) && !erViser('constructor'));
});

// KC-0236: the Aula card's "Ikke nu" is kept in the pack's own small memory, beside Digital Post's.
test('KC-0236 parse: aulaAfvist is an optional ISO time; anything else refuses the file', () => {
  const ok: DanmarkTilstand = { afsendere: [], set: [], viser: 'mit.dk', aulaAfvist: '2026-11-02T10:00:00.000Z' };
  assert.deepEqual(parseDanmarkTilstand(JSON.parse(JSON.stringify(ok))), ok);
  assert.equal(parseDanmarkTilstand({ afsendere: [], set: [], viser: 'mit.dk' })?.aulaAfvist, undefined);
  for (const daarlig of ['i går', 7, null, {}]) assert.equal(parseDanmarkTilstand({ afsendere: [], set: [], viser: 'mit.dk', aulaAfvist: daarlig }), null, JSON.stringify(daarlig));
});
