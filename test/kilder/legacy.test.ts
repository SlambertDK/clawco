// KC-0132: Henrik's three existing sources as connectors of the new kind
// (kira-kalender, kira-morgenavis, kira-mail). Golden tests: what a room makes
// of the adapter's read is byte-identical to what it makes of the old direct
// call today, on the same fixture files. Registered only when their env vars
// are set.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kiraKalender, kiraMail, kiraMorgenavis, legacyKilder } from '../../src/kilder/legacy/legacy.ts';
import { KildeFejl, type KildeKontekst } from '../../src/kilder/types.ts';
import { readUge, trimUge } from '../../src/rooms/dagen/uge.ts';
import { readNyhederSource } from '../../src/rooms/nyheder/source.ts';
import { parseAll, readMailSource, type Runner } from '../../src/rooms/mail/source.ts';
import { kalenderScriptFra } from '../../src/server.ts';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const NU = new Date('2026-10-31T10:00:00Z');
const ctx: KildeKontekst = { nu: NU, zone: 'privat', valg: {}, hemmelighed: async () => null };
const uge = await readFile(path.join(FIX, 'kalender_uge_sample.json'), 'utf8');
const handling = await readFile(path.join(FIX, 'himalaya_handling_sample.json'), 'utf8');

/** A runner that answers from a fixture and records each call. */
function svarMed(stdout: string, code = 0): Runner & { kald: [string, string[]][] } {
  const kald: [string, string[]][] = [];
  const run = (async (cmd: string, args: string[]) => { kald.push([cmd, args]); return { code, stdout, stderr: code ? 'fejl' : '' }; }) as Runner & { kald: typeof kald };
  run.kald = kald;
  return run;
}

test('golden: kira-kalender — Dagen\'s week from the adapter equals the week from the script called directly', async () => {
  const script = '/opt/kalender_uge.py';
  const run = svarMed(uge);
  const k = kiraKalender({ script, run });
  const l = await k.read(ctx);
  assert.equal(l.slags, 'kalender');
  assert.equal(l.uklar, true);
  assert.deepEqual(run.kald, [['python3', [script]]]);
  const direkte = await readUge(svarMed(uge), script);
  assert.ok(direkte && direkte.dage.length === 4);
  assert.equal(JSON.stringify(trimUge(l.data)), JSON.stringify(direkte));
});

test('kira-kalender: a script that fails is a failing read, where the direct call gave no week', async () => {
  const run = svarMed('', 1);
  await assert.rejects(kiraKalender({ script: '/x.py', run }).read(ctx), KildeFejl);
  assert.equal(await readUge(run, '/x.py'), null);
  await assert.rejects(kiraKalender({ script: '/x.py', run: svarMed('ikke json') }).read(ctx), KildeFejl);
});

test('golden: kira-morgenavis — Nyheder\'s items and source stats from the adapter equal the direct read of the morning paper', async () => {
  const glob = path.join(FIX, 'avis_data_sample.json');
  const k = kiraMorgenavis({ glob, laes: readNyhederSource });
  const l = await k.read(ctx);
  assert.equal(l.slags, 'nyheder');
  const direkte = await readNyhederSource(glob, NU);
  assert.ok(direkte && direkte.nyheder.length > 0);
  assert.equal(JSON.stringify(l.data), JSON.stringify({ nyheder: direkte.nyheder, status: direkte.kilder }));
  await assert.rejects(kiraMorgenavis({ glob: '/nonexistent/avis_{date}.json', laes: readNyhederSource }).read(ctx), KildeFejl);
});

test('golden: kira-mail — the Handling envelopes from the adapter equal what the Mail room reads, never a body', async () => {
  const run = svarMed(handling);
  const k = kiraMail({ himalaya: '/usr/bin/himalaya', run, parse: parseAll });
  const l = await k.read(ctx);
  assert.equal(l.slags, 'mail');
  assert.deepEqual(run.kald, [['/usr/bin/himalaya', ['envelope', 'list', '-m', 'Folders/Handling', '-s', '120', '-p', '1', '--json']]]);
  const direkte = await readMailSource({ run: svarMed(handling), stateDir: '/nonexistent', now: NU, himalaya: '/usr/bin/himalaya' });
  assert.ok(direkte.handling.length > 0);
  assert.equal(JSON.stringify(l.data), JSON.stringify(direkte.handling));
  await assert.rejects(kiraMail({ himalaya: 'h', run: svarMed('', 1), parse: parseAll }).read(ctx), KildeFejl);
});

test('the legacy adapters are connected by the host, read-only, untrusted, and registered only when their source is set', () => {
  const deps = { run: svarMed(''), laesNyheder: readNyhederSource, parseMail: parseAll, kalenderScript: '' };
  assert.deepEqual(legacyKilder({}, deps), []);
  assert.deepEqual(legacyKilder({ KC_KALENDER_SCRIPT: '/k.py', KC_DAGEN_SOURCE_GLOB: '', KC_HIMALAYA: '' }, { ...deps, kalenderScript: ' ' }), []);
  const alle = legacyKilder({ KC_DAGEN_SOURCE_GLOB: '/tmp/avis_{date}.json', KC_HIMALAYA: 'himalaya' }, { ...deps, kalenderScript: '/k.py' });
  assert.deepEqual(alle.map((k) => [k.id, k.slags, k.standard, k.zone]), [['kira-kalender', 'kalender', 'forbundet', 'privat'], ['kira-morgenavis', 'nyheder', 'forbundet', 'privat'], ['kira-mail', 'mail', 'forbundet', 'privat']]);
  assert.ok(alle.every((k) => !k.act && !k.verber && (k.tillid ?? 'uklar') === 'uklar'));
  assert.deepEqual(legacyKilder({ KC_HIMALAYA: 'himalaya' }, deps).map((k) => k.id), ['kira-mail']);
});

// KC-0120: on Henrik's install KC_KALENDER_SCRIPT is unset and the bundled scripts/kalender_uge.py is read (through
// Kira's token script, which exists there — KC-0133); the calendar connector must exist under exactly that
// condition — main() derives the path once (kalenderScriptFra) and hands the same value to legacyKilder.
test('kira-kalender registers from the script Dagen reads, not from KC_KALENDER_SCRIPT', () => {
  const deps = { run: svarMed(''), laesNyheder: readNyhederSource, parseMail: parseAll };
  const rod = '/srv/kontrolcenter';
  const script = kalenderScriptFra({}, 'hermes-http', rod, { kiraToken: true });
  assert.equal(script, path.join(rod, 'scripts', 'kalender_uge.py'));
  const k = legacyKilder({}, { ...deps, kalenderScript: script });
  assert.deepEqual(k.map((x) => x.id), ['kira-kalender']);
  assert.equal(kalenderScriptFra({ KC_KALENDER_SCRIPT: ' /opt/k.py ' }, 'hermes-http', rod, { kiraToken: false }), '/opt/k.py');
  assert.equal(kalenderScriptFra({ KC_KALENDER_SCRIPT: '/opt/k.py' }, 'fake', rod, { kiraToken: true }), '');
  assert.deepEqual(legacyKilder({ KC_KALENDER_SCRIPT: '/opt/k.py' }, { ...deps, kalenderScript: kalenderScriptFra({ KC_KALENDER_SCRIPT: '/opt/k.py' }, 'fake', rod, { kiraToken: true }) }), []);
});
