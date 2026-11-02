import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nyDb, ur, antal } from './hjaelp.ts';
import { nyAutentifikator } from './autentifikator.ts';
import { registreringsMuligheder, gemRegistrering, loginMuligheder, verificerLogin, passkeys, fjernPasskey, UDFORDRING_MS, type Rp } from '../../src/konto/passkey.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import type { Database } from '../../src/db/pool.ts';

const RP: Rp = { id: 'konto.example.test', navn: 'Clawco', origin: 'https://konto.example.test' };

async function kontoMedPasskey(db: Database, nu: Date, email = 'a@example.test') {
  const { konto } = await findEllerOpretKonto(db, email, nu);
  const auth = nyAutentifikator();
  const o = await registreringsMuligheder(db, RP, konto, nu);
  assert.equal(await gemRegistrering(db, RP, konto.id, auth.registrer(o, RP.origin), 'Min Mac', nu), true);
  return { konto, auth };
}

test('register a passkey, then log in with it', async () => {
  const db = await nyDb();
  const u = ur();
  const { konto, auth } = await kontoMedPasskey(db, u.nu());
  const liste = await passkeys(db, konto.id);
  assert.equal(liste.length, 1);
  assert.equal(liste[0]?.navn, 'Min Mac');
  assert.equal(liste[0]?.sidstBrugt, null);
  const o = await loginMuligheder(db, RP, u.nu());
  assert.equal(o.rpId, RP.id);
  assert.deepEqual(o.allowCredentials ?? [], [], 'login er "discoverable": ingen email først');
  assert.deepEqual(await verificerLogin(db, RP, auth.logInd(o, RP.origin), u.nu()), { kontoId: konto.id });
  assert.ok((await passkeys(db, konto.id))[0]?.sidstBrugt);
});

test('registration excludes passkeys the account already has', async () => {
  const db = await nyDb();
  const u = ur();
  const { konto, auth } = await kontoMedPasskey(db, u.nu());
  const o = await registreringsMuligheder(db, RP, konto, u.nu());
  assert.deepEqual(o.excludeCredentials?.map((c) => c.id), [auth.credentialId.toString('base64url')]);
  assert.equal(o.rp.id, RP.id);
});

test('a login challenge works once: a replayed assertion is refused', async () => {
  const db = await nyDb();
  const u = ur();
  const { auth } = await kontoMedPasskey(db, u.nu());
  const svar = auth.logInd(await loginMuligheder(db, RP, u.nu()), RP.origin);
  assert.ok(await verificerLogin(db, RP, svar, u.nu()));
  assert.equal(await verificerLogin(db, RP, svar, u.nu()), null);
});

test('an assertion signed by another key for the same credential id is refused', async () => {
  const db = await nyDb();
  const u = ur();
  const { auth } = await kontoMedPasskey(db, u.nu());
  const falsk = nyAutentifikator();
  const svar = falsk.logInd(await loginMuligheder(db, RP, u.nu()), RP.origin);
  const id = auth.credentialId.toString('base64url');
  assert.equal(await verificerLogin(db, RP, { ...svar, id, rawId: id }, u.nu()), null);
});

test('a counter that goes backwards (a cloned authenticator) is refused', async () => {
  const db = await nyDb();
  const u = ur();
  const { auth } = await kontoMedPasskey(db, u.nu());
  auth.taeller = 5;
  assert.ok(await verificerLogin(db, RP, auth.logInd(await loginMuligheder(db, RP, u.nu()), RP.origin), u.nu()));
  auth.taeller = 5;
  assert.equal(await verificerLogin(db, RP, auth.logInd(await loginMuligheder(db, RP, u.nu()), RP.origin), u.nu()), null, 'samme tæller igen');
  auth.taeller = 3;
  assert.equal(await verificerLogin(db, RP, auth.logInd(await loginMuligheder(db, RP, u.nu()), RP.origin), u.nu()), null, 'lavere tæller');
  auth.taeller = 6;
  assert.ok(await verificerLogin(db, RP, auth.logInd(await loginMuligheder(db, RP, u.nu()), RP.origin), u.nu()), 'den ægte nøgle virker stadig');
});

test('an assertion for another origin or relying party is refused', async () => {
  const db = await nyDb();
  const u = ur();
  const { auth } = await kontoMedPasskey(db, u.nu());
  assert.equal(await verificerLogin(db, RP, auth.logInd(await loginMuligheder(db, RP, u.nu()), 'https://ond.example.test'), u.nu()), null);
  assert.equal(await verificerLogin(db, RP, auth.logInd(await loginMuligheder(db, RP, u.nu()), RP.origin, 'ond.example.test'), u.nu()), null);
});

test('challenges expire after 5 minutes', async () => {
  const db = await nyDb();
  const u = ur();
  const { auth } = await kontoMedPasskey(db, u.nu());
  const o = await loginMuligheder(db, RP, u.nu());
  u.frem(UDFORDRING_MS + 1);
  assert.equal(await verificerLogin(db, RP, auth.logInd(o, RP.origin), u.nu()), null);
});

test('a registration challenge belongs to the account that asked for it', async () => {
  const db = await nyDb();
  const u = ur();
  const { konto: a } = await findEllerOpretKonto(db, 'a@example.test', u.nu());
  const { konto: b } = await findEllerOpretKonto(db, 'b@example.test', u.nu());
  const o = await registreringsMuligheder(db, RP, a, u.nu());
  assert.equal(await gemRegistrering(db, RP, b.id, nyAutentifikator().registrer(o, RP.origin), 'x', u.nu()), false);
  assert.equal(await antal(db, 'passkey'), 0);
});

test('an unknown credential or a malformed answer is refused without throwing', async () => {
  const db = await nyDb();
  const u = ur();
  await kontoMedPasskey(db, u.nu());
  const fremmed = nyAutentifikator();
  assert.equal(await verificerLogin(db, RP, fremmed.logInd(await loginMuligheder(db, RP, u.nu()), RP.origin), u.nu()), null);
  assert.equal(await verificerLogin(db, RP, { id: 'x' }, u.nu()), null);
  assert.equal(await verificerLogin(db, RP, 'skrald', u.nu()), null);
  const { konto } = await findEllerOpretKonto(db, 'c@example.test', u.nu());
  assert.equal(await gemRegistrering(db, RP, konto.id, { response: {} }, 'x', u.nu()), false);
});

test('a passkey can be removed by its own account; staff cannot remove their last one', async () => {
  const db = await nyDb();
  const u = ur();
  const { konto } = await kontoMedPasskey(db, u.nu());
  const andre = await kontoMedPasskey(db, u.nu(), 'b@example.test');
  const [p] = await passkeys(db, konto.id);
  assert.equal(await fjernPasskey(db, andre.konto.id, p!.id), 'ukendt', 'en anden konto kan ikke fjerne den');
  await db.query('UPDATE konto SET personale = true WHERE id = $1', [konto.id]);
  assert.equal(await fjernPasskey(db, konto.id, p!.id), 'sidste-personale');
  await db.query('UPDATE konto SET personale = false WHERE id = $1', [konto.id]);
  assert.equal(await fjernPasskey(db, konto.id, p!.id), 'ok');
  assert.deepEqual(await passkeys(db, konto.id), []);
});
