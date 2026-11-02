// KC-0185: the manifest taken at backup time — file count plus one checksum over every regular file's path,
// size and sha256 — read straight from the tar, so the drill can compare a restored volume with the copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifestFraTar, tarFiler } from '../../../src/drift/backup/manifest.ts';
import { tar } from './hjaelp.ts';

test('regular files are counted and read back; directories are not files', () => {
  const t = tar({ './husstand.json': '{"personer":[]}', './rum/dagen/state.json': '{}' }, { mapper: ['./', './rum/', './rum/dagen/'] });
  const f = tarFiler(t);
  assert.deepEqual(f.map((x) => x.sti), ['husstand.json', 'rum/dagen/state.json']);
  assert.equal(f[0]!.data.toString(), '{"personer":[]}');
  assert.equal(manifestFraTar(t).antal, 2);
  assert.match(manifestFraTar(t).digest, /^[0-9a-f]{64}$/);
});

test('the digest ignores order and the ./ prefix, and changes with any byte or name', () => {
  const a = manifestFraTar(tar({ './a.json': '1', './b.json': '2' }));
  assert.deepEqual(manifestFraTar(tar({ 'b.json': '2', 'a.json': '1' })), a);
  assert.notDeepEqual(manifestFraTar(tar({ 'a.json': '1', 'b.json': '3' })), a);
  assert.notDeepEqual(manifestFraTar(tar({ 'a.json': '1', 'c.json': '2' })), a);
});

test('long paths read the same through a GNU long-name entry and a pax entry', () => {
  const lang = `rum/${'x'.repeat(120)}/state.json`;
  const gnu = tarFiler(tar({ [lang]: 'g' }, { langt: 'gnu' }));
  const pax = tarFiler(tar({ [lang]: 'g' }, { langt: 'pax' }));
  assert.deepEqual(gnu.map((x) => x.sti), [lang]);
  assert.deepEqual(pax.map((x) => x.sti), [lang]);
});

test('a truncated or corrupt archive refuses instead of giving a short manifest', () => {
  const t = tar({ 'a.json': 'x'.repeat(2000) });
  assert.throws(() => tarFiler(t.subarray(0, 1024)), /tar/);
  const ondt = Buffer.from(t);
  ondt[150] = 0x41; // checksum field
  assert.throws(() => tarFiler(ondt), /tar/);
  assert.throws(() => tarFiler(tar({ '../ud.json': 'x' })), /tar/, 'a path that climbs out is refused');
});
