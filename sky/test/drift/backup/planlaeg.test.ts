// KC-0185: the night schedule — each scope (a tenant, or `db`) has its own minute in a 00:00–04:00 UTC window,
// spread so they do not all run at once; a scope is due once its minute has passed with no success since; a
// failure retries after an hour; a Sky that was down catches up. Deprovisioned tenants are not scopes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VINDUE, forsinkede, levendeOmfang, naerGratisGraense, planlagtTid, skyldige } from '../../../src/drift/backup/planlaeg.ts';

const T = 3_600_000;
const dag = new Date('2026-11-01T00:00:00.000Z');

test('every scope gets a minute inside the night window, the same one each day, and scopes spread out', () => {
  const tider = ['db', ...Array.from({ length: 40 }, (_, i) => `hus-${String(i).padStart(8, 'a')}`)].map((o) => planlagtTid(o, new Date('2026-11-01T13:37:00Z')));
  for (const t of tider) {
    assert.ok(t.getTime() >= dag.getTime() + VINDUE.fraTime * T && t.getTime() < dag.getTime() + VINDUE.tilTime * T, t.toISOString());
  }
  assert.ok(new Set(tider.map((t) => t.getTime())).size > 20, 'spread, not all at once');
  assert.deepEqual(planlagtTid('db', new Date('2026-11-02T23:00:00Z')).getUTCMinutes(), tider[0]!.getUTCMinutes());
});

test('only provisioned, live tenants are scopes: bestilt, afvikles and slettet are skipped', () => {
  const t = (slug: string, tilstand: string) => ({ slug, tilstand, siden: dag });
  const ud = levendeOmfang([t('hus-aaaaaaaa', 'klar'), t('hus-bbbbbbbb', 'bestilt'), t('hus-cccccccc', 'afvikles'), t('hus-dddddddd', 'slettet'), t('hus-eeeeeeee', 'startet')]);
  assert.deepEqual(ud.map((o) => o.omfang), ['hus-aaaaaaaa', 'hus-eeeeeeee']);
});

test('a scope is due once its minute has passed and it has no success since; not before', () => {
  const p = planlagtTid('db', dag);
  const omfang = [{ omfang: 'db', siden: new Date('2026-10-01T00:00:00Z') }];
  const i_nat = new Map([['db', { sidsteForsoeg: new Date(p.getTime() - 24 * T), sidsteSucces: new Date(p.getTime() - 24 * T) }]]);
  assert.deepEqual(skyldige(omfang, i_nat, new Date(p.getTime() - 1)), []);
  assert.deepEqual(skyldige(omfang, i_nat, p), ['db']);
  assert.deepEqual(skyldige(omfang, new Map(), new Date(p.getTime() - 1)), ['db'], 'never copied: due at once');
  const ok = new Map([['db', { sidsteForsoeg: p, sidsteSucces: p }]]);
  assert.deepEqual(skyldige(omfang, ok, new Date(p.getTime() + T)), [], 'done for tonight');
});

test('a failed run retries after an hour, not on every tick', () => {
  const p = planlagtTid('db', dag);
  const omfang = [{ omfang: 'db', siden: new Date('2026-10-01T00:00:00Z') }];
  const fejlet = new Map([['db', { sidsteForsoeg: p, sidsteSucces: new Date(p.getTime() - 24 * T) }]]);
  assert.deepEqual(skyldige(omfang, fejlet, new Date(p.getTime() + 30 * 60_000)), []);
  assert.deepEqual(skyldige(omfang, fejlet, new Date(p.getTime() + T)), ['db']);
});

test('a Sky that was down through the window catches up at once', () => {
  const omfang = [{ omfang: 'db', siden: new Date('2026-10-01T00:00:00Z') }];
  const i_gaar = new Map([['db', { sidsteForsoeg: new Date('2026-10-31T02:00:00Z'), sidsteSucces: new Date('2026-10-31T02:00:00Z') }]]);
  assert.deepEqual(skyldige(omfang, i_gaar, new Date('2026-11-01T13:00:00Z')), ['db']);
});

test('a scope with no success in 36 hours counts as late; a new tenant is not late before its own 36 hours', () => {
  const nu = new Date('2026-11-02T12:00:00Z');
  const omfang = [
    { omfang: 'hus-aaaaaaaa', siden: new Date('2026-10-01T00:00:00Z') },
    { omfang: 'hus-bbbbbbbb', siden: new Date('2026-11-02T10:00:00Z') },
    { omfang: 'hus-cccccccc', siden: new Date('2026-10-01T00:00:00Z') },
    { omfang: 'db', siden: new Date('2026-10-01T00:00:00Z') },
  ];
  const tilstand = new Map([
    ['hus-aaaaaaaa', { sidsteForsoeg: nu, sidsteSucces: new Date(nu.getTime() - 37 * T) }],
    ['db', { sidsteForsoeg: nu, sidsteSucces: new Date(nu.getTime() - 35 * T) }],
  ]);
  assert.equal(forsinkede(omfang, tilstand, nu), 2, 'hus-aaaaaaaa (37 h) and hus-cccccccc (never)');
});

test('the R2 free tier warns at 80 % of 10 GB', () => {
  assert.equal(naerGratisGraense(7_999_999_999), false);
  assert.equal(naerGratisGraense(8_000_000_000), true);
});
