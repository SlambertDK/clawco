// KC-0186: cohorts. Every tenant has one (intern, kanari, alle); a new tenant starts in `alle`; the operator
// marks the internal test tenant by hand (never hardcoded); kanari is filled to about 5 percent, at least one,
// from `alle` in a stable order. Soak times and the per-node concurrency are constants in hold.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { HOLD, PROEVETID_MS, kanariMangler, naesteHold, samtidige } from '../../../src/drift/udrulning/hold.ts';
import { bestil, hentTenant, klareTilUdrulning, saetHold, skift } from '../../../src/fleet/tilstand.ts';
import { opsaet } from '../../fleet/hjaelp.ts';

test('a new tenant is in the cohort alle; the operator can mark it intern', async () => {
  const s = await opsaet();
  const t = await bestil(s.db, { kontoId: s.kontoId, driver: 'lokal', nu: s.ur.nu(), nySlug: () => 'hus-abcdefgh' });
  assert.equal(t.hold, 'alle');
  assert.equal(await saetHold(s.db, t.slug, 'intern'), true);
  assert.equal((await hentTenant(s.db, t.slug))!.hold, 'intern');
  assert.equal(await saetHold(s.db, 'hus-zzzzzzzz', 'intern'), false);
  await assert.rejects(saetHold(s.db, t.slug, 'beta' as never));
  await s.db.close();
});

test('klareTilUdrulning lists only klar tenants with their cohort, release and address', async () => {
  const s = await opsaet();
  const t = await bestil(s.db, { kontoId: s.kontoId, driver: 'lokal', nu: s.ur.nu(), nySlug: () => 'hus-abcdefgh' });
  assert.deepEqual(await klareTilUdrulning(s.db), []);
  await skift(s.db, t.slug, ['bestilt'], 'klar', s.ur.nu(), { adresse: 'http://172.18.0.2:8750', release: 'aaaaaaa' });
  assert.deepEqual(await klareTilUdrulning(s.db), [{ slug: t.slug, hold: 'alle', release: 'aaaaaaa', adresse: 'http://172.18.0.2:8750' }]);
  await s.db.close();
});

const slugs = (n: number) => Array.from({ length: n }, (_, i) => `hus-${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}aaaaaa`);

test('kanari: one tenant when there is one; about 5 percent, rounded up; never the internal one', () => {
  assert.deepEqual(kanariMangler([{ slug: 'hus-intern00', hold: 'intern' }]), []);
  assert.deepEqual(kanariMangler([{ slug: 'hus-intern00', hold: 'intern' }, { slug: 'hus-aaaaaaaa', hold: 'alle' }]), ['hus-aaaaaaaa']);
  const fyrre = slugs(40).map((slug) => ({ slug, hold: 'alle' as const }));
  assert.equal(kanariMangler(fyrre).length, 2);
  assert.equal(kanariMangler([...fyrre, { slug: 'hus-intern00', hold: 'intern' }]).length, 2);
  // Existing kanari tenants count: nothing more is needed.
  const med = fyrre.map((t, i) => (i < 2 ? { ...t, hold: 'kanari' as const } : t));
  assert.deepEqual(kanariMangler(med), []);
});

test('kanari is chosen in a stable order (by a hash of the slug), not by list order', () => {
  const t = slugs(20).map((slug) => ({ slug, hold: 'alle' as const }));
  const valgt = kanariMangler(t);
  assert.deepEqual(kanariMangler([...t].reverse()), valgt);
  const forventet = [...t].sort((a, b) => (createHash('sha256').update(a.slug).digest('hex') < createHash('sha256').update(b.slug).digest('hex') ? -1 : 1))[0]!.slug;
  assert.deepEqual(valgt, [forventet]);
});

test('cohorts run intern, kanari, alle; soak 10 min and 1 hour; a few at a time per node, never all of it', () => {
  assert.deepEqual(HOLD, ['intern', 'kanari', 'alle']);
  assert.equal(naesteHold('intern'), 'kanari');
  assert.equal(naesteHold('kanari'), 'alle');
  assert.equal(naesteHold('alle'), null);
  assert.deepEqual(PROEVETID_MS, { intern: 600_000, kanari: 3_600_000, alle: 0 });
  assert.deepEqual([1, 2, 3, 10].map(samtidige), [1, 1, 2, 2]);
});
