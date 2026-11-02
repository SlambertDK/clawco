// KC-0181: key material is a type that never prints its bytes — not via String, JSON, inspect,
// util.format, a template string or an error message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import util from 'node:util';
import { skjul, SKJULT } from '../../src/hemmeligheder/skjul.ts';
import { former } from './hjaelp.ts';

test('a hidden key prints as [nøgle] everywhere', () => {
  const b = randomBytes(32);
  const k = skjul(Buffer.from(b));
  const ud = [
    String(k), `${k}`, k.toString(), JSON.stringify(k), JSON.stringify({ k, liste: [k] }),
    util.inspect(k), util.inspect({ k }, { showHidden: true, depth: 5 }), util.format('%s %o %O %j', k, k, k, k),
    new Error(`fejl med ${k}`).message, String(new Error('x', { cause: k }).cause),
  ];
  for (const s of ud) {
    assert.ok(s.includes(SKJULT), s);
    for (const f of former(b)) assert.ok(!s.includes(f), `leak in: ${s}`);
  }
  assert.equal(SKJULT, '[nøgle]');
});

test('only aaben() gives the bytes; laengde is safe to print; oedelaeg zeroes them', () => {
  const b = randomBytes(32);
  const k = skjul(Buffer.from(b));
  assert.ok(k.aaben().equals(b));
  assert.equal(k.laengde, 32);
  assert.deepEqual(Object.keys(k), [], 'no enumerable field holds the bytes');
  k.oedelaeg();
  assert.ok(k.aaben().equals(Buffer.alloc(32)));
});
