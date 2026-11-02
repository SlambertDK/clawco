// KC-0181: purpose keys derived from the DEK with HKDF, one fixed label each. Different labels give
// unrelated keys; the same tenant and label always give the same key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afled, FORMAAL } from '../../src/hemmeligheder/afled.ts';
import { nyDataNoegle } from '../../src/hemmeligheder/kuvert.ts';
import { skjul } from '../../src/hemmeligheder/skjul.ts';

test('the three labels give three different 32-byte keys, none equal to the DEK', () => {
  assert.deepEqual([...FORMAAL], ['volume', 'backup', 'lager']);
  const dek = nyDataNoegle();
  const noegler = FORMAAL.map((f) => afled(dek, 'hus-abcdefgh', f).aaben().toString('hex'));
  assert.equal(new Set([...noegler, dek.aaben().toString('hex')]).size, 4);
  for (const n of noegler) assert.equal(n.length, 64);
});

test('deterministic per tenant and label; another tenant or DEK gives another key', () => {
  const bytes = nyDataNoegle().aaben();
  const a = afled(skjul(Buffer.from(bytes)), 'hus-abcdefgh', 'lager').aaben();
  const b = afled(skjul(Buffer.from(bytes)), 'hus-abcdefgh', 'lager').aaben();
  assert.ok(a.equals(b));
  assert.ok(!afled(skjul(Buffer.from(bytes)), 'hus-abcdefgi', 'lager').aaben().equals(a));
  assert.ok(!afled(nyDataNoegle(), 'hus-abcdefgh', 'lager').aaben().equals(a));
});

test('an unknown label is refused', () => {
  assert.throws(() => afled(nyDataNoegle(), 'hus-abcdefgh', 'alt' as never), /ukendt formål/);
});

test('KC-0185: the control-plane dump key comes from the master key under its own label, unlike any tenant key', async () => {
  const { afledKontrolplan, KONTROLPLAN_FORMAAL } = await import('../../src/hemmeligheder/afled.ts');
  assert.deepEqual([...KONTROLPLAN_FORMAAL], ['db-backup']);
  const kek = nyDataNoegle();
  const a = afledKontrolplan(skjul(Buffer.from(kek.aaben())), 'db-backup').aaben();
  assert.equal(a.length, 32);
  assert.ok(a.equals(afledKontrolplan(skjul(Buffer.from(kek.aaben())), 'db-backup').aaben()));
  assert.ok(!a.equals(kek.aaben()));
  assert.ok(!a.equals(afled(skjul(Buffer.from(kek.aaben())), 'db-backup', 'backup').aaben()), 'not the tenant derivation with the same bytes');
  assert.throws(() => afledKontrolplan(kek, 'andet' as never), /ukendt formål/);
});
