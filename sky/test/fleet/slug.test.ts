// KC-0182: a tenant's slug is random (`hus-` + 8 base32 characters), never derived from a name or an
// email, and never one of the names Sky keeps for itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nySlug, erSlug, RESERVEREDE, SLUG } from '../../src/fleet/slug.ts';
import { TENANT_ID } from '../../src/fleet/flaade.ts';

test('format: hus- plus 8 lower-case base32 characters, and a valid tenant id for Docker names', () => {
  for (let i = 0; i < 200; i++) {
    const s = nySlug();
    assert.match(s, /^hus-[a-z2-7]{8}$/);
    assert.ok(erSlug(s));
    assert.match(s, TENANT_ID);
  }
});

test('random: 2000 draws give 2000 different slugs', () => {
  const set = new Set(Array.from({ length: 2000 }, () => nySlug()));
  assert.equal(set.size, 2000);
});

test('the draw comes from the random source only (never a name or an email)', () => {
  assert.equal(nySlug(() => Buffer.alloc(5, 0)), 'hus-aaaaaaaa');
  assert.equal(nySlug(() => Buffer.alloc(5, 0xff)), 'hus-77777777');
  assert.ok(nySlug.length <= 1, 'the only input is the random source');
});

test('reserved names and anything off-format are never accepted', () => {
  for (const r of ['www', 'konto', 'status', 'api', 'mail', 'sky', 'docs', 'admin']) {
    assert.ok(RESERVEREDE.has(r));
    assert.equal(erSlug(r), false, r);
  }
  for (const s of ['', 'hus-', 'hus-aaaaaaa', 'hus-aaaaaaaaa', 'HUS-aaaaaaaa', 'hus-aaaaaaa1', 'hus-aaaa aaa', 'x-aaaaaaaa', 'hus-aaaaaaaa.', 'hus-aaaaaaaa\n']) {
    assert.equal(erSlug(s), false, JSON.stringify(s));
  }
  assert.equal(SLUG.source, '^hus-[a-z2-7]{8}$');
});
