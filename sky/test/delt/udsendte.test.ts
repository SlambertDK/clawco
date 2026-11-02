// KC-0196: the shared "one mail per account, kind and key" record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nyDb } from '../konto/hjaelp.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { erSendt, frigivMail, GENTAG_EFTER_MS, markerSendt, paatagMail } from '../../src/delt/udsendte.ts';

const NU = new Date('2026-11-14T10:00:00.000Z');
const senere = (ms: number): Date => new Date(NU.getTime() + ms);

test('a claim is taken once; a sent mail is never claimed again', async () => {
  const db = await nyDb();
  const { konto } = await findEllerOpretKonto(db, 'ejer@example.test', NU);
  const m = { kontoId: konto.id, slags: 'betaling-fejlet', noegle: 'forfalden:2026-11-14T10:00:00.000Z' };
  assert.equal(await paatagMail(db, m, NU), true);
  assert.equal(await paatagMail(db, m, NU), false, 'a second sender at the same time gets nothing');
  await markerSendt(db, m, NU);
  assert.equal(await erSendt(db, m), true);
  assert.equal(await paatagMail(db, m, senere(30 * 86_400_000)), false, 'sent stays sent');
  assert.equal(await paatagMail(db, { ...m, noegle: 'forfalden:2026-12-20T10:00:00.000Z' }, NU), true, 'another key is another mail');
  await db.close();
});

test('a failed send gives the claim back at once; a crashed one after the wait', async () => {
  const db = await nyDb();
  const { konto } = await findEllerOpretKonto(db, 'ejer@example.test', NU);
  const m = { kontoId: konto.id, slags: 'proeve-slut', noegle: 'proeve:sub_1' };
  assert.equal(await paatagMail(db, m, NU), true);
  await frigivMail(db, m);
  assert.equal(await paatagMail(db, m, NU), true, 'released: the next pass sends');
  // This claim "crashed" (never released, never sent): blocked until the wait has passed.
  assert.equal(await paatagMail(db, m, senere(GENTAG_EFTER_MS - 1)), false);
  assert.equal(await paatagMail(db, m, senere(GENTAG_EFTER_MS)), true);
  assert.equal(await erSendt(db, m), false);
  await db.close();
});
