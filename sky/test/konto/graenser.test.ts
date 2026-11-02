import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nyDb, ur, alleRaekker } from './hjaelp.ts';
import { taelOp, erSpaerret, emailNoegle, ipNoegle, VINDUE_MS, KODER_PR_EMAIL } from '../../src/konto/graenser.ts';

test('a counter allows the limit within a window and refuses the next', async () => {
  const db = await nyDb();
  const u = ur();
  const n = emailNoegle('a@example.test');
  for (let i = 0; i < KODER_PR_EMAIL; i++) assert.equal(await taelOp(db, n, KODER_PR_EMAIL, u.nu()), true, `forsøg ${i + 1}`);
  assert.equal(await taelOp(db, n, KODER_PR_EMAIL, u.nu()), false);
  assert.equal(await erSpaerret(db, n, KODER_PR_EMAIL, u.nu()), true);
});

test('a new window starts over', async () => {
  const db = await nyDb();
  const u = ur();
  const n = ipNoegle('203.0.113.9');
  for (let i = 0; i <= 3; i++) await taelOp(db, n, 3, u.nu());
  assert.equal(await erSpaerret(db, n, 3, u.nu()), true);
  u.frem(VINDUE_MS);
  assert.equal(await erSpaerret(db, n, 3, u.nu()), false);
  assert.equal(await taelOp(db, n, 3, u.nu()), true);
});

test('erSpaerret only looks; it never counts', async () => {
  const db = await nyDb();
  const u = ur();
  const n = ipNoegle('203.0.113.10');
  for (let i = 0; i < 10; i++) assert.equal(await erSpaerret(db, n, 1, u.nu()), false);
  assert.equal(await taelOp(db, n, 1, u.nu()), true);
});

test('counters never store the email or the IP in the clear', async () => {
  const db = await nyDb();
  const u = ur();
  await taelOp(db, emailNoegle('hemmelig.person@example.test'), 5, u.nu());
  await taelOp(db, ipNoegle('198.51.100.77'), 5, u.nu());
  const alt = await alleRaekker(db);
  assert.ok(!alt.includes('hemmelig.person'));
  assert.ok(!alt.includes('198.51.100.77'));
});
