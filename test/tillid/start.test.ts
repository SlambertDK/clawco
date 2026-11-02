// KC-0142 migration for the reference install: the behaviours Hermes already
// follows, written as rules once — only when no rules file exists. A file
// Henrik has (even a broken one) is never overwritten.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lavReglerLager } from '../../src/tillid/lager.ts';
import { skrivStartregler } from '../../src/tillid/start.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-tillid-start-'));
after(() => rm(rod, { recursive: true, force: true }));
let n = 0;
const ny = () => { n += 1; return lavReglerLager({ vaultDir: path.join(rod, `v${n}`), dataDir: path.join(rod, `d${n}`) }); };

test('no file: writes the two known behaviours (mail sorting trin 1, ledger lines trin 2) as import rules', async () => {
  const l = ny();
  assert.equal(await skrivStartregler(l, '2026-10-31'), 'skrevet');
  const r = await l.laes();
  assert.ok(r.tilstand === 'ok');
  assert.deepEqual(r.saet.regler.map((x) => [x.id, x.trin, x.gaelder.kilde, x.gaelder.slags, x.oprindelse.art, x.oprindelse.dato, x.status]), [
    ['R-0001', 1, 'mail', 'indbakke', 'import', '2026-10-31', 'aktiv'],
    ['R-0002', 2, 'mail', 'regning', 'import', '2026-10-31', 'aktiv'],
  ]);
  assert.equal(r.saet.naesteId, 3);
  assert.equal(r.aendretUdenfor, false, 'written by the app, sha logged');
});

test('a file that exists is never overwritten, readable or not', async () => {
  for (const indhold of ['naeste-id: R-0001\n', 'ikke en regelfil\n']) {
    const l = ny();
    await mkdir(path.dirname(l.fil), { recursive: true });
    await writeFile(l.fil, indhold, 'utf8');
    assert.equal(await skrivStartregler(l, '2026-10-31'), 'findes');
    assert.equal(await readFile(l.fil, 'utf8'), indhold);
  }
});

test('a bad date is refused before anything is written', async () => {
  const l = ny();
  await assert.rejects(() => skrivStartregler(l, '31-10-2026'));
  assert.deepEqual(await l.laes(), { tilstand: 'mangler' });
});
