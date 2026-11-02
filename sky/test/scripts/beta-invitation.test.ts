// KC-0203: the operator's invitation tool. Invariants: the codes are printed once, one per line, and nothing else goes
// to stdout; the database holds hashes only; bad arguments print no code and change nothing; the beta-end date can
// only be set 30 or more days out and only moves gifts forward.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nyDb, ur, antal } from '../konto/hjaelp.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { laesPriser } from '../../src/abonnement/priser.ts';
import { hentRettigheder } from '../../src/abonnement/synk.ts';
import { betaIndloesDeps } from '../../src/betaforbind.ts';
import { indloes } from '../../src/beta/invitationer.ts';
import { koerInvitation } from '../../scripts/beta-invitation.ts';

const priser = laesPriser();

test('--antal: N codes on stdout, one per line and nothing else; only hashes in the database', async () => {
  const db = await nyDb();
  const u = ur();
  const r = await koerInvitation(db, ['--antal', '3'], u.nu(), priser);
  assert.equal(r.kode, 0);
  assert.equal(r.ud.length, 3);
  for (const l of r.ud) assert.match(l, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await antal(db, 'beta.invitation'), 3);
  assert.ok(!JSON.stringify(await db.query('SELECT * FROM beta.invitation')).includes(r.ud[0]!));
  assert.ok(r.fejl.every((l) => !r.ud.some((k) => l.includes(k))), 'a code is never in the messages');
  await db.close();
});

test('bad arguments print no code and create nothing', async () => {
  const db = await nyDb();
  const u = ur();
  for (const a of [[], ['--antal'], ['--antal', '0'], ['--antal', '51'], ['--antal', 'ti'], ['--antal', '2', '--annuller-alle'], ['--ukendt'], ['--antal', '1', '--gyldig-dage', '-4']]) {
    const r = await koerInvitation(db, a, u.nu(), priser);
    assert.notEqual(r.kode, 0, JSON.stringify(a));
    assert.deepEqual(r.ud, [], JSON.stringify(a));
    assert.ok(r.fejl.length > 0);
  }
  assert.equal(await antal(db, 'beta.invitation'), 0);
  await db.close();
});

test('--gyldig-dage sets the expiry', async () => {
  const db = await nyDb();
  const u = ur();
  await koerInvitation(db, ['--antal', '1', '--gyldig-dage', '7'], u.nu(), priser);
  const [i] = await db.query<{ oprettet: Date; udloeber: Date }>('SELECT oprettet, udloeber FROM beta.invitation');
  assert.equal(new Date(i!.udloeber).getTime() - new Date(i!.oprettet).getTime(), 7 * 86_400_000);
  await db.close();
});

test('--annuller revokes one unused code by its text; --annuller-alle every unused one; neither prints a code', async () => {
  const db = await nyDb();
  const u = ur();
  const { ud } = await koerInvitation(db, ['--antal', '3'], u.nu(), priser);
  const en = await koerInvitation(db, ['--annuller', ud[0]!], u.nu(), priser);
  assert.equal(en.kode, 0);
  assert.ok(![...en.ud, ...en.fejl].some((l) => l.includes(ud[0]!)));
  assert.equal((await koerInvitation(db, ['--annuller', ud[0]!], u.nu(), priser)).kode, 1, 'twice: not found');
  const alle = await koerInvitation(db, ['--annuller-alle'], u.nu(), priser);
  assert.equal(alle.kode, 0);
  assert.match(alle.ud.join(' '), /2/);
  assert.equal((await db.query('SELECT 1 FROM beta.invitation WHERE annulleret IS NULL')).length, 0);
  await db.close();
});

test('--forlaeng-til: only 30 or more days out; moves every beta gift\'s end forward', async () => {
  const db = await nyDb();
  const u = ur();
  const id = (await findEllerOpretKonto(db, 'b@example.test', u.nu())).konto.id;
  const { ud } = await koerInvitation(db, ['--antal', '1'], u.nu(), priser);
  assert.equal(await indloes(betaIndloesDeps(db, priser), id, ud[0]!, u.nu(), { samtykke: false }), true);
  const tidlig = await koerInvitation(db, ['--forlaeng-til', '2026-11-15'], u.nu(), priser);
  assert.equal(tidlig.kode, 1);
  assert.match(tidlig.fejl.join(' '), /30 dage/);
  assert.equal((await koerInvitation(db, ['--forlaeng-til', 'i morgen'], u.nu(), priser)).kode, 2);
  const r = await koerInvitation(db, ['--forlaeng-til', '2027-06-30'], u.nu(), priser);
  assert.equal(r.kode, 0);
  assert.match(r.ud.join(' '), /1/);
  assert.equal(new Date((await hentRettigheder(db, id, priser, u.nu())).periodeSlutter!).toISOString().slice(0, 10), '2027-06-30');
  await db.close();
});

test('the root wrappers hand the arguments to Sky\'s own scripts as a child process, add nothing to the output, and import nothing from sky/', () => {
  for (const [navn, sky] of [['beta-invitation', 'beta-invitation.ts'], ['beta-rapport', 'beta-rapport.ts']] as const) {
    const kilde = fs.readFileSync(new URL(`../../../scripts/${navn}.mjs`, import.meta.url), 'utf8');
    assert.match(kilde, new RegExp(`sky/scripts/${sky.replace('.', '\\.')}`));
    assert.match(kilde, /spawnSync\(process\.execPath/);
    assert.match(kilde, /process\.argv\.slice\(2\)/);
    assert.match(kilde, /stdio: 'inherit'/);
    assert.ok(!/console\.(log|error)|process\.std(out|err)\.write/.test(kilde), 'the wrapper prints nothing of its own');
    assert.ok(!/from ['"][^'"]*sky\/|import\(['"][^'"]*sky\//.test(kilde), 'no import of Sky code (aftryk)');
  }
});
