// KC-0185: retention — a snapshot is kept exactly 30 days and never deleted earlier; the newest one of a
// scope is never deleted by age; a deleted tenant's snapshots go on its data key's purge date (KC-0181).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPBEVARING_DAGE, purgeSlettet, snapshotId, snapshotTid, udloebne } from '../../../src/drift/backup/opbevaring.ts';

const DAG = 86_400_000;
const nu = new Date('2026-11-01T02:00:00.000Z');
const id = (msSiden: number, hale = 'a1b2c3d4') => snapshotId(new Date(nu.getTime() - msSiden), hale);

test('a snapshot id is a sortable UTC stamp plus 8 hex, and its time reads back (to the second)', () => {
  const s = snapshotId(new Date('2026-11-01T02:13:45.678Z'), '0a1b2c3d');
  assert.equal(s, '20261101T021345Z-0a1b2c3d');
  assert.deepEqual(snapshotTid(s), new Date('2026-11-01T02:13:45.000Z'));
  assert.equal(snapshotTid('../etc/passwd'), null);
  assert.equal(snapshotTid('20261101T021345Z-0A1B2C3D'), null, 'lower-case hex only');
  assert.throws(() => snapshotId(nu, 'xyz'), /8 hex/);
});

test('retention is exactly 30 days: 30 d minus a second is kept, 30 d plus a second is deleted', () => {
  assert.equal(OPBEVARING_DAGE, 30);
  const ny = id(0, '00000000');
  const kant = id(30 * DAG - 1000, '11111111');
  const gammel = id(30 * DAG + 1000, '22222222');
  assert.deepEqual(udloebne([gammel, kant, ny], nu), [gammel]);
});

test('the newest snapshot of a scope is never deleted by age (a long outage keeps the last good copy)', () => {
  const a = id(40 * DAG, '11111111');
  const b = id(35 * DAG, '22222222');
  assert.deepEqual(udloebne([b, a], nu), [a]);
  assert.deepEqual(udloebne([], nu), []);
});

test('ids that are not snapshot ids are never deleted', () => {
  assert.deepEqual(udloebne(['noget-andet', id(50 * DAG)], nu), []);
});

test('a deleted tenant keeps its snapshots until the purge date, then all of them go', () => {
  const ids = [id(2 * DAG, '11111111'), id(1 * DAG, '22222222')];
  const destrueres = new Date(nu.getTime() + 28 * DAG);
  assert.deepEqual(purgeSlettet(ids, { destrueres, destrueret: false }, nu), []);
  assert.deepEqual(purgeSlettet(ids, { destrueres, destrueret: false }, new Date(destrueres.getTime() - 1)), []);
  assert.deepEqual(purgeSlettet(ids, { destrueres, destrueret: false }, destrueres), ids);
  assert.deepEqual(purgeSlettet(ids, { destrueres: null, destrueret: true }, nu), ids, 'a destroyed key: nothing can open them anyway');
  assert.deepEqual(purgeSlettet(ids, { destrueres: null, destrueret: false }, nu), [], 'not deleted: the age rule applies, not this one');
});
