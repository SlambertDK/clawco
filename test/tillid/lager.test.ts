// KC-0142: the rules file on disk. Missing = no rules; unreadable = fail
// closed (the caller shows trin 0); every app write is atomic and leaves a
// sha256 in <dataDir>/tillid/regler.sha so a later hand edit is noticed.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lavReglerLager } from '../../src/tillid/lager.ts';
import { parseRegler } from '../../src/tillid/regler.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-tillid-'));
after(() => rm(rod, { recursive: true, force: true }));
let n = 0;
const ny = () => { n += 1; return lavReglerLager({ vaultDir: path.join(rod, `vault${n}`), dataDir: path.join(rod, `data${n}`) }); };

const MD = 'naeste-id: R-0002\n\n## R-0001 · Sortér mail\n- trin: 1\n- gaelder: mail\n- oprindelse: import 2026-10-31\n- status: aktiv\n';

test('the file is <vault>/Clawco/regler.md', () => {
  assert.equal(lavReglerLager({ vaultDir: '/v', dataDir: '/d' }).fil, path.join('/v', 'Clawco', 'regler.md'));
});

test('no file: no rules (not a fault)', async () => {
  assert.deepEqual(await ny().laes(), { tilstand: 'mangler' });
});

test('an app write reads back ok and is not "changed outside Clawco"', async () => {
  const l = ny();
  await l.skriv(parseRegler(MD));
  const r = await l.laes();
  assert.equal(r.tilstand, 'ok');
  assert.ok(r.tilstand === 'ok' && r.saet.regler[0]?.id === 'R-0001');
  assert.ok(r.tilstand === 'ok' && r.aendretUdenfor === false);
  assert.deepEqual((await readdir(path.dirname(l.fil))).filter((f) => f.includes('.tmp')), [], 'no tmp file left');
});

test('the sha file holds sha256 of what the app wrote', async () => {
  const l = ny();
  await l.skrivTekst(MD);
  const sha = (await readFile(path.join(rod, `data${n}`, 'tillid', 'regler.sha'), 'utf8')).trim();
  assert.equal(sha, createHash('sha256').update(MD).digest('hex'));
});

test('a hand edit after an app write is noticed, informational only', async () => {
  const l = ny();
  await l.skrivTekst(MD);
  await writeFile(l.fil, MD.replace('Sortér mail', 'Sortér al mail'), 'utf8');
  const r = await l.laes();
  assert.equal(r.tilstand, 'ok', 'still followed');
  assert.ok(r.tilstand === 'ok' && r.aendretUdenfor === true);
});

test('a file Henrik made by hand (no sha yet) is not flagged', async () => {
  const l = ny();
  await mkdir(path.dirname(l.fil), { recursive: true });
  await writeFile(l.fil, MD, 'utf8');
  const r = await l.laes();
  assert.ok(r.tilstand === 'ok' && r.aendretUdenfor === false);
});

test('a file that is not a rules file is unreadable (fail closed), with the reason', async () => {
  const l = ny();
  await mkdir(path.dirname(l.fil), { recursive: true });
  await writeFile(l.fil, '# mine noter\nnoget helt andet\n', 'utf8');
  const r = await l.laes();
  assert.equal(r.tilstand, 'ulaeselig');
  assert.ok(r.tilstand === 'ulaeselig' && /naeste-id/.test(r.hvorfor));
});

test('a path that cannot be read as a file is unreadable, not a crash', async () => {
  const l = ny();
  await mkdir(l.fil, { recursive: true }); // a folder where the file should be
  assert.equal((await l.laes()).tilstand, 'ulaeselig');
});
