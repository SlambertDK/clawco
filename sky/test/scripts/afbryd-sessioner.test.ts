// KC-0230: the first hour's "cut the access" step as one script (no sudo, counts only). Invariants: every live session
// and login link of one account, or of all, stops working at once (hentSession and the gateway's sessionLever both say
// no); nothing is deleted (the rows stay as the evidence the runbook asks for); other accounts are untouched by --konto;
// a second run finds nothing left; the output is counts and never an address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nyDb, ur, antal } from '../konto/hjaelp.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { hentSession, opretSession } from '../../src/konto/session.ts';
import { sessionLever } from '../../src/gateway/cookie.ts';
import { hashToken } from '../../src/konto/token.ts';
import type { Database } from '../../src/db/pool.ts';
import { afbrydSessioner, kommando } from '../../scripts/afbryd-sessioner.ts';

async function link(db: Database, email: string, nu: Date, minutter = 15): Promise<string> {
  const token = `link-${email}-${nu.getTime()}`;
  await db.query('INSERT INTO loginkode (hash, email, binding, oprettet, udloeber) VALUES ($1, $2, $3, $4, $5)',
    [hashToken(token), email, hashToken('binding'), nu.toISOString(), new Date(nu.getTime() + minutter * 60_000).toISOString()]);
  return token;
}

async function verden() {
  const db = await nyDb();
  const u = ur();
  const nu = u.nu();
  const a = (await findEllerOpretKonto(db, 'a@kunde.test', nu)).konto;
  const b = (await findEllerOpretKonto(db, 'b@kunde.test', nu)).konto;
  const a1 = await opretSession(db, { kontoId: a.id, metode: 'passkey', enhed: 'Chrome på Mac', nu });
  const a2 = await opretSession(db, { kontoId: a.id, metode: 'link', enhed: 'Safari på iPhone', nu });
  const b1 = await opretSession(db, { kontoId: b.id, metode: 'passkey', enhed: 'Firefox på Linux', nu });
  await link(db, 'a@kunde.test', nu);
  await link(db, 'b@kunde.test', nu);
  return { db, u, a, b, a1, a2, b1 };
}

test('one account: its sessions and login links stop at once, the other account is untouched, nothing is deleted', async () => {
  const w = await verden();
  const nu = new Date(w.u.nu().getTime() + 60_000);
  assert.ok(await hentSession(w.db, w.a1.token, nu));
  assert.equal(await sessionLever(w.db, { s: w.a1.session.id, k: w.a.id }, nu), 'a@kunde.test');
  const raekker = await antal(w.db, 'session');
  const koder = await antal(w.db, 'loginkode');

  assert.deepEqual(await afbrydSessioner(w.db, { kontoId: w.a.id, nu }), { sessioner: 2, loginkoder: 1 });

  assert.equal(await hentSession(w.db, w.a1.token, nu), null);
  assert.equal(await hentSession(w.db, w.a2.token, nu), null);
  assert.equal(await sessionLever(w.db, { s: w.a1.session.id, k: w.a.id }, nu), null, 'the gateway stops too');
  assert.ok(await hentSession(w.db, w.b1.token, nu), 'the other account keeps its session');
  const [kode] = await w.db.query<{ n: number }>("SELECT count(*)::int AS n FROM loginkode WHERE email = 'b@kunde.test' AND udloeber > $1", [nu.toISOString()]);
  assert.equal(kode!.n, 1, 'and its login link');
  assert.equal(await antal(w.db, 'session'), raekker, 'no row is deleted: they are the evidence');
  assert.equal(await antal(w.db, 'loginkode'), koder);
  await w.db.close();
});

test('every account: all sessions and all unused login links; a second run finds nothing', async () => {
  const w = await verden();
  const nu = new Date(w.u.nu().getTime() + 60_000);
  assert.deepEqual(await afbrydSessioner(w.db, { nu }), { sessioner: 3, loginkoder: 2 });
  for (const s of [w.a1, w.a2, w.b1]) assert.equal(await hentSession(w.db, s.token, nu), null);
  assert.deepEqual(await afbrydSessioner(w.db, { nu }), { sessioner: 0, loginkoder: 0 });
  await w.db.close();
});

test('an expired session or an already used login link is not counted; a revoked link cannot be used', async () => {
  const w = await verden();
  const nu = new Date(w.u.nu().getTime() + 60_000);
  await w.db.query("UPDATE session SET udloeber = $1 WHERE id = $2", [new Date(nu.getTime() - 1000).toISOString(), w.a1.session.id]);
  await w.db.query("UPDATE loginkode SET brugt = $1 WHERE email = 'b@kunde.test'", [nu.toISOString()]);
  assert.deepEqual(await afbrydSessioner(w.db, { nu }), { sessioner: 2, loginkoder: 1 });
  const { findLink } = await import('../../src/konto/maillink.ts');
  assert.equal(await findLink(w.db, `link-a@kunde.test-${w.u.nu().getTime()}`, nu), false);
  await w.db.close();
});

test('kommando: neither flag, both flags, a bad id or an unknown account exit non-zero and cut nothing', async () => {
  const w = await verden();
  const nu = new Date(w.u.nu().getTime() + 60_000);
  const koer = async (argv: string[]) => { const ud: string[] = []; const kode = await kommando(argv, w.db, nu, (l) => ud.push(l)); return { kode, ud: ud.join('\n') }; };
  for (const argv of [[], ['--konto'], ['--konto', 'x'], ['--konto', '0'], ['--konto', '1', '--alle'], ['--alle', 'ekstra'], ['--ukendt']]) {
    const r = await koer(argv);
    assert.equal(r.kode, 2, JSON.stringify(argv));
    assert.match(r.ud, /brug:/);
  }
  assert.equal((await koer(['--konto', '9999'])).kode, 1);
  assert.ok(await hentSession(w.db, w.a1.token, nu), 'nothing was cut');
  await w.db.close();
});

test('kommando: prints counts and the account number only, never an address', async () => {
  const w = await verden();
  const nu = new Date(w.u.nu().getTime() + 60_000);
  const ud: string[] = [];
  assert.equal(await kommando(['--konto', String(w.a.id)], w.db, nu, (l) => ud.push(l)), 0);
  assert.match(ud.join('\n'), /2 sessioner og 1 login-link/);
  assert.ok(!/@/.test(ud.join('\n')));
  const alle: string[] = [];
  assert.equal(await kommando(['--alle'], w.db, nu, (l) => alle.push(l)), 0);
  assert.match(alle.join('\n'), /1 sessioner og 1 login-link/);
  await w.db.close();
});
