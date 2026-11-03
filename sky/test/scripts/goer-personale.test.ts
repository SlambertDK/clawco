// KC-0272 (D6): making an account staff promotes every passkey it has to a staff login. Invariants: the passkeys that
// become staff logins are named (id, name, added) before anything changes; an account with more than one passkey is
// refused unless the operator says --alle (one unknown device would otherwise become a staff key unseen); a refusal
// changes nothing; the output never shows an address beyond the one the operator typed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nyDb, ur } from '../konto/hjaelp.ts';
import { findEllerOpretKonto, goerPersonale, kontoForEmail } from '../../src/konto/konto.ts';
import type { Database } from '../../src/db/pool.ts';
import { kommando } from '../../scripts/goer-personale.ts';

async function medPasskeys(db: Database, email: string, navne: string[], nu: Date): Promise<number[]> {
  const { konto } = await findEllerOpretKonto(db, email, nu);
  const ider: number[] = [];
  for (const navn of navne) {
    const [r] = await db.query<{ id: unknown }>("INSERT INTO passkey (konto_id, credential_id, public_key, taeller, navn, oprettet) VALUES ($1, $2, 'pk', 0, $3, $4) RETURNING id", [konto.id, `cred-${email}-${navn}`, navn, nu.toISOString()]);
    ider.push(Number(r!.id));
  }
  return ider;
}

test('goerPersonale names the passkeys it promotes; more than one is refused unless alle', async () => {
  const db = await nyDb();
  const nu = ur().nu();
  const [en] = await medPasskeys(db, 'en@example.test', ['Mac'], nu);
  const r = await goerPersonale(db, 'en@example.test');
  assert.equal(r.udfald, 'ok');
  assert.deepEqual(r.passkeys.map((p) => [p.id, p.navn]), [[en, 'Mac']]);

  const [a, b] = await medPasskeys(db, 'to@example.test', ['Mac', 'Ukendt telefon'], nu);
  const nej = await goerPersonale(db, 'to@example.test');
  assert.equal(nej.udfald, 'flere-passkeys');
  assert.deepEqual(nej.passkeys.map((p) => p.id).sort(), [a, b].sort());
  assert.equal((await kontoForEmail(db, 'to@example.test'))?.personale, false, 'a refusal changes nothing');
  const ja = await goerPersonale(db, 'to@example.test', { alle: true });
  assert.equal(ja.udfald, 'ok');
  assert.equal(ja.passkeys.length, 2);
  assert.equal((await kontoForEmail(db, 'to@example.test'))?.personale, true);
  await db.close();
});

test('kommando: lists the passkey ids it promotes; two passkeys without --alle exit 1 and change nothing; usage is 2', async () => {
  const db = await nyDb();
  const nu = ur().nu();
  const [a, b] = await medPasskeys(db, 'to@example.test', ['Mac', 'Telefon'], nu);
  const koer = async (argv: string[]) => { const ud: string[] = []; const kode = await kommando(argv, db, (l) => ud.push(l)); return { kode, ud: ud.join('\n') }; };
  assert.equal((await koer([])).kode, 2);
  assert.equal((await koer(['to@example.test', '--noget'])).kode, 2);
  const nej = await koer(['to@example.test']);
  assert.equal(nej.kode, 1);
  assert.match(nej.ud, new RegExp(`passkey ${a}\\b`));
  assert.match(nej.ud, new RegExp(`passkey ${b}\\b`));
  assert.match(nej.ud, /--alle/);
  assert.equal((await kontoForEmail(db, 'to@example.test'))?.personale, false);
  const ja = await koer(['to@example.test', '--alle']);
  assert.equal(ja.kode, 0);
  assert.match(ja.ud, new RegExp(`passkey ${a}\\b`));
  assert.match(ja.ud, /er nu personale/);
  assert.equal((await koer(['ukendt@example.test'])).kode, 1);
  await db.close();
});
