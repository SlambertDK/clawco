// KC-0181: the tenant's encrypted key store. AES-256-GCM over $KC_DATA_DIR/hemmeligheder.enc with the
// `lager` key from the file KC_HEMMELIGHEDER_FIL names (delivered by Sky onto a tmpfs after start).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { filNoegleLager, LAGERFIL, SKJULTE_DATAFILER } from '../../src/hemmeligheder/lager-fil.ts';

const UDBYDERE = ['anthropic', 'openai', 'lmstudio'];

async function opsaet(): Promise<{ dir: string; noeglefil: string; noegle: Buffer; ryd: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-lager-'));
  const noegle = randomBytes(32);
  const noeglefil = path.join(dir, 'lager-noegle');
  await writeFile(noeglefil, `${noegle.toString('base64')}\n`, { mode: 0o400 });
  return { dir, noeglefil, noegle, ryd: () => rm(dir, { recursive: true, force: true }) };
}
const lav = (o: { dir: string; noeglefil: string }) => filNoegleLager({ udbydere: UDBYDERE, dataDir: path.join(o.dir, 'data'), noeglefil: o.noeglefil });

test('round trip: a saved key is read back, trimmed, and survives a new instance', async () => {
  const o = await opsaet();
  try {
    const l = lav(o);
    assert.equal(await l.findes('anthropic'), false);
    assert.equal(await l.hent('anthropic'), undefined);
    assert.deepEqual(await l.saet('anthropic', '  sk-ant-hemmelig  '), { laengde: 15 });
    await l.saet('openai', 'sk-oa-andet');
    assert.equal(await l.hent('anthropic'), 'sk-ant-hemmelig');
    const igen = lav(o);
    assert.equal(await igen.hent('anthropic'), 'sk-ant-hemmelig');
    assert.equal(await igen.hent('openai'), 'sk-oa-andet');
    assert.equal(await igen.findes('openai'), true);
  } finally { await o.ryd(); }
});

test('two saves at once both land (they run one after the other)', async () => {
  const o = await opsaet();
  try {
    const l = lav(o);
    await Promise.all([l.saet('anthropic', 'a'), l.saet('openai', 'b'), l.saet('lmstudio', 'c')]);
    assert.deepEqual([await l.hent('anthropic'), await l.hent('openai'), await l.hent('lmstudio')], ['a', 'b', 'c']);
  } finally { await o.ryd(); }
});

test('an empty key and an unknown provider are refused', async () => {
  const o = await opsaet();
  try {
    const l = lav(o);
    await assert.rejects(() => l.saet('anthropic', '   '), /tom/);
    await assert.rejects(() => l.saet('nope', 'x'), /ukendt udbyder: nope/);
    await assert.rejects(() => l.hent('nope'), /ukendt udbyder/);
  } finally { await o.ryd(); }
});

test('the file is not plaintext: neither key nor provider id nor value appears in its bytes', async () => {
  const o = await opsaet();
  try {
    await lav(o).saet('anthropic', 'sk-ant-MEGET-HEMMELIG-VAERDI');
    const raa = await readFile(path.join(o.dir, 'data', LAGERFIL));
    const s = raa.toString('latin1');
    assert.ok(!s.includes('MEGET-HEMMELIG'));
    assert.ok(!s.includes('anthropic'));
    assert.ok(!raa.includes(o.noegle));
    assert.ok(!s.includes(o.noegle.toString('base64')));
    assert.equal(((await stat(path.join(o.dir, 'data', LAGERFIL))).mode & 0o777), 0o600);
  } finally { await o.ryd(); }
});

test('writes are atomic: no temp file is left behind, and each save re-encrypts under a fresh nonce', async () => {
  const o = await opsaet();
  try {
    const l = lav(o);
    await l.saet('anthropic', 'a');
    const foer = await readFile(path.join(o.dir, 'data', LAGERFIL));
    await l.saet('anthropic', 'a');
    const efter = await readFile(path.join(o.dir, 'data', LAGERFIL));
    assert.notDeepEqual(foer.subarray(0, 30), efter.subarray(0, 30), 'nonce is fresh per write');
    assert.deepEqual(await readdir(path.join(o.dir, 'data')), [LAGERFIL]);
  } finally { await o.ryd(); }
});

test('a wrong key fails closed: hent and saet reject, the file is never overwritten', async () => {
  const o = await opsaet();
  try {
    await lav(o).saet('anthropic', 'sk-ant-1');
    const foer = await readFile(path.join(o.dir, 'data', LAGERFIL));
    await rm(o.noeglefil);
    await writeFile(o.noeglefil, `${randomBytes(32).toString('base64')}\n`);
    const l = lav(o);
    await assert.rejects(() => l.hent('anthropic'), /kunne ikke åbnes/);
    await assert.rejects(() => l.saet('openai', 'sk-2'), /kunne ikke åbnes/);
    assert.deepEqual(await readFile(path.join(o.dir, 'data', LAGERFIL)), foer);
  } finally { await o.ryd(); }
});

test('a tampered file fails closed', async () => {
  const o = await opsaet();
  try {
    await lav(o).saet('anthropic', 'sk-ant-1');
    const f = path.join(o.dir, 'data', LAGERFIL);
    const b = await readFile(f);
    b[b.length - 1] = b[b.length - 1]! ^ 1;
    await writeFile(f, b);
    await assert.rejects(() => lav(o).hent('anthropic'), /kunne ikke åbnes/);
    await writeFile(f, Buffer.from('not an envelope'));
    await assert.rejects(() => lav(o).hent('anthropic'), /kunne ikke åbnes/);
  } finally { await o.ryd(); }
});

test('the key is read lazily: before Sky delivers it the store refuses; afterwards it works without a restart', async () => {
  const o = await opsaet();
  try {
    await rm(o.noeglefil);
    const l = lav(o);
    await assert.rejects(() => l.saet('anthropic', 'x'), /nøglen er ikke leveret/);
    await assert.rejects(() => l.hent('anthropic'), /nøglen er ikke leveret/);
    await writeFile(o.noeglefil, `${o.noegle.toString('base64')}\n`);
    await l.saet('anthropic', 'x');
    assert.equal(await l.hent('anthropic'), 'x');
  } finally { await o.ryd(); }
});

test('a junk key file is refused, and the error never contains its content', async () => {
  const o = await opsaet();
  try {
    await rm(o.noeglefil);
    await writeFile(o.noeglefil, 'DETTE-ER-IKKE-EN-NOEGLE\n');
    const l = lav(o);
    await assert.rejects(() => l.saet('anthropic', 'x'), (e: Error) => /ugyldig/.test(e.message) && !e.message.includes('DETTE-ER'));
  } finally { await o.ryd(); }
});

test('the file and its temp name are on the hidden list for the export and the file list', () => {
  assert.ok(SKJULTE_DATAFILER.includes(LAGERFIL));
  assert.ok(SKJULTE_DATAFILER.some((n) => n.startsWith('.') && n.includes(LAGERFIL)));
});
