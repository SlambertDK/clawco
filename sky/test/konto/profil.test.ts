// KC-0198: what sign-up asks on the account (country, language, consent versions) and the time from account
// to a ready Clawco, stored on the konto row (migration 0007).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nyDb, ur } from './hjaelp.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { gemProfil, hentProfil, noterTilmeldingstid } from '../../src/konto/profil.ts';

test('a new account has an empty profile; saving it round-trips', async () => {
  const db = await nyDb();
  const u = ur();
  const { konto } = await findEllerOpretKonto(db, 'ny@example.test', u.nu());
  const tom = (await hentProfil(db, konto.id))!;
  assert.deepEqual({ ...tom, oprettet: undefined }, { land: null, sprog: null, vilkaar: null, privatliv: null, tilmeldingMs: null, oprettet: undefined });
  assert.equal(tom.oprettet.toISOString(), u.nu().toISOString());
  await gemProfil(db, konto.id, { land: 'SE', sprog: 'en', vilkaar: '0.1-udkast', privatliv: '0.1-udkast', nu: u.nu() });
  const p = (await hentProfil(db, konto.id))!;
  assert.equal(p.land, 'SE');
  assert.equal(p.sprog, 'en');
  assert.equal(p.vilkaar, '0.1-udkast');
  assert.equal(p.privatliv, '0.1-udkast');
  const [r] = await db.query<{ samtykke_ved: Date }>('SELECT samtykke_ved FROM konto WHERE id = $1', [konto.id]);
  assert.equal(new Date(r!.samtykke_ved).toISOString(), u.nu().toISOString());
  await db.close();
});

test('the database refuses a language or country that is not one', async () => {
  const db = await nyDb();
  const { konto } = await findEllerOpretKonto(db, 'x@example.test', new Date());
  await assert.rejects(gemProfil(db, konto.id, { land: 'DK', sprog: 'de' as 'da', vilkaar: 'v', privatliv: 'v', nu: new Date() }));
  await assert.rejects(gemProfil(db, konto.id, { land: 'dk', sprog: 'da', vilkaar: 'v', privatliv: 'v', nu: new Date() }));
  await db.close();
});

test('tilmeldingstid: account created → tenant klar, written once and never overwritten', async () => {
  const db = await nyDb();
  const u = ur();
  const { konto } = await findEllerOpretKonto(db, 't@example.test', u.nu());
  await noterTilmeldingstid(db, konto.id, new Date(u.nu().getTime() + 83_250));
  assert.equal((await hentProfil(db, konto.id))!.tilmeldingMs, 83_250);
  await noterTilmeldingstid(db, konto.id, new Date(u.nu().getTime() + 500_000));
  assert.equal((await hentProfil(db, konto.id))!.tilmeldingMs, 83_250);
  await db.close();
});

test('a klar time before the account existed is recorded as 0, never negative', async () => {
  const db = await nyDb();
  const u = ur();
  const { konto } = await findEllerOpretKonto(db, 'n@example.test', u.nu());
  await noterTilmeldingstid(db, konto.id, new Date(u.nu().getTime() - 5_000));
  assert.equal((await hentProfil(db, konto.id))!.tilmeldingMs, 0);
  await db.close();
});
