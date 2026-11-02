// KC-0189: the operator's incident list (sky/scripts/haendelse.mjs). Plain text only, and never anything that names a
// customer or a machine: a slug, an email address or an IP address is refused before it can reach the public feed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afslutHaendelse, haendelserTilFeed, nyHaendelse, tjekHaendelse } from '../../../src/drift/helbred/haendelse.ts';
import { nyDb } from '../../konto/hjaelp.ts';

const NU = new Date('2026-11-02T10:00:00.000Z');

test('an incident is written, listed and ended', async () => {
  const db = await nyDb();
  try {
    const id = await nyHaendelse(db, { titel: 'Login er langsom', tekst: 'Vi undersøger det.', start: NU, slut: null }, NU);
    assert.deepEqual(await haendelserTilFeed(db, NU), [{ titel: 'Login er langsom', tekst: 'Vi undersøger det.', start: NU.toISOString(), slut: null }]);
    const slut = new Date(NU.getTime() + 600_000);
    assert.equal(await afslutHaendelse(db, id, slut), true);
    assert.equal((await haendelserTilFeed(db, slut))[0]!.slut, slut.toISOString());
    // Ending an unknown or an already ended incident changes nothing.
    assert.equal(await afslutHaendelse(db, id, slut), false);
    assert.equal(await afslutHaendelse(db, id + 99, slut), false);
  } finally { await db.close(); }
});

test('identifiers, markup, empty or overlong text and a backwards period are refused', () => {
  const ok = { titel: 'Mail forsinket', tekst: 'Mails kom op til ti minutter for sent.', start: NU, slut: null };
  assert.equal(tjekHaendelse(ok), null);
  assert.match(tjekHaendelse({ ...ok, tekst: 'hus-abcdefgh var nede' })!, /kunde/);
  assert.match(tjekHaendelse({ ...ok, tekst: 'skriv til kunde@example.test' })!, /mail/);
  assert.match(tjekHaendelse({ ...ok, titel: 'Node 10.0.0.4 nede' })!, /IP/);
  assert.match(tjekHaendelse({ ...ok, tekst: '<b>nede</b>' })!, /tekst/);
  assert.ok(tjekHaendelse({ ...ok, titel: '' }));
  assert.ok(tjekHaendelse({ ...ok, tekst: 'x'.repeat(2001) }));
  assert.ok(tjekHaendelse({ ...ok, slut: new Date(NU.getTime() - 1) }));
});

test('the command prints its usage and exits 2 without arguments (no database needed)', () => {
  const script = fileURLToPath(new URL('../../../scripts/haendelse.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '' } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /brug: haendelse\.mjs/);
});
