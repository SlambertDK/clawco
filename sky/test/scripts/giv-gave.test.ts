// KC-0203: the operator's one way to give a beta household a gift (an entitlement without Stripe).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pgliteDatabase } from '../pglite.ts';
import { migrer } from '../../src/db/migrer.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { hentRettigheder } from '../../src/abonnement/synk.ts';
import { laesPriser } from '../../src/abonnement/priser.ts';
import { givGave } from '../../scripts/giv-gave.ts';

const nu = new Date('2026-11-01T12:00:00Z');

test('a known account gets an active gift on the named plan; the email is matched case-insensitively', async () => {
  const db = await pgliteDatabase();
  try {
    await migrer(db);
    const { konto } = await findEllerOpretKonto(db, 'beta@example.test', nu);
    assert.equal(await givGave(db, '  Beta@Example.test ', 'sky-husstand', laesPriser(), nu), 'ok');
    const r = await hentRettigheder(db, konto.id, laesPriser(), nu);
    assert.equal(r.kilde, 'gave');
    assert.equal(r.plan, 'sky-husstand');
    assert.equal(r.status, 'aktiv');
  } finally { await db.close(); }
});

test('an unknown account or plan changes nothing and says which', async () => {
  const db = await pgliteDatabase();
  try {
    await migrer(db);
    const { konto } = await findEllerOpretKonto(db, 'beta@example.test', nu);
    assert.equal(await givGave(db, 'ingen@example.test', 'sky-solo', laesPriser(), nu), 'ukendt-konto');
    assert.equal(await givGave(db, 'beta@example.test', 'sky-guld', laesPriser(), nu), 'ukendt-plan');
    assert.equal(await givGave(db, 'ikke en mail', 'sky-solo', laesPriser(), nu), 'ukendt-konto');
    assert.notEqual((await hentRettigheder(db, konto.id, laesPriser(), nu)).kilde, 'gave');
  } finally { await db.close(); }
});
