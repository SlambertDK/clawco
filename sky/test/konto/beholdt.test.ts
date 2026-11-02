// KC-0206: the one list of what is kept after an account is deleted, and why (the receipt stores it; the
// inventory proof allows exactly it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEHOLDT, KOPIER_DAGE, kontoHash } from '../../src/konto/beholdt.ts';
import { OPBEVARING_DAGE as KOPI } from '../../src/drift/backup/opbevaring.ts';
import { OPBEVARING_DAGE as NOEGLE } from '../../src/hemmeligheder/tenantnoegle.ts';

test('backups go within the same 30 days the copies and the data key keep', () => {
  assert.equal(KOPIER_DAGE, 30);
  assert.equal(KOPIER_DAGE, KOPI);
  assert.equal(KOPIER_DAGE, NOEGLE);
});

test('every kept thing names where, what and why; the bookkeeping ones are flagged for the lawyer', () => {
  assert.ok(BEHOLDT.length >= 5);
  for (const b of BEHOLDT) {
    for (const felt of ['sted', 'hvad', 'hvorfor'] as const) assert.ok(b[felt].trim().length > 3, `${b.sted}: ${felt}`);
  }
  assert.equal(new Set(BEHOLDT.map((b) => b.sted)).size, BEHOLDT.length, 'one entry per place');
  assert.ok(BEHOLDT.some((b) => b.sted === 'stripe' && b.jurist), 'invoices at Stripe: kept for bookkeeping, lawyer to confirm');
  assert.ok(BEHOLDT.some((b) => b.sted === 'abonnement.kunde' && b.jurist));
});

test('the account id hash is 64 hex, stable, and differs per account', () => {
  assert.match(kontoHash(7), /^[0-9a-f]{64}$/);
  assert.equal(kontoHash(7), kontoHash(7));
  assert.notEqual(kontoHash(7), kontoHash(8));
});
