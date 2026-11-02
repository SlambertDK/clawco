// KC-0203: deleting an account deletes the beta numbers. Invariant: after sletKonto no table under beta/ names the
// account; the spent invitation stays as a tombstone with no account named (so the code stays spent); another
// household's rows are untouched. Nothing is kept for the retention list (konto/beholdt.ts lists what is kept).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opsaetBeta } from './hjaelp.ts';
import { sletKonto, ingenHusstand, ingenAfvikler } from '../../src/konto/slet.ts';
import { opretSession } from '../../src/konto/session.ts';
import { haendelser } from '../../src/delt/haendelser.ts';
import { BEHOLDT } from '../../src/konto/beholdt.ts';

test('deleting a beta household\'s account removes every beta row about it and leaves the others', async () => {
  const b = await opsaetBeta();
  const a = await b.husstand('slet@example.test', 'hus-aaaaaaaa', { samtykke: true });
  const andet = await b.husstand('bliver@example.test', 'hus-bbbbbbbb', { samtykke: true });
  for (const id of [a, andet]) {
    await b.db.query("INSERT INTO beta.set (konto_id, dag) VALUES ($1, '2026-11-02'), ($1, '2026-11-03')", [id]);
    await b.db.query("INSERT INTO beta.dagtal (konto_id, dag, kraever) VALUES ($1, '2026-11-02', 4)", [id]);
    await b.db.query("INSERT INTO beta.feedback (konto_id, dag, vurdering, tekst, betale, tid) VALUES ($1, 3, 4, 'fint', NULL, now())", [id]);
    await b.db.query('UPDATE beta.maal SET hentet = now(), foerste_vaerdi_ms = 1000 WHERE konto_id = $1', [id]);
  }
  const { session } = await opretSession(b.db, { kontoId: a, metode: 'passkey', enhed: 'Mac', nu: b.u.nu() });
  const afvikler = { async afprovisioner() {} };
  assert.equal(await sletKonto({ db: b.db, husstand: { async forKonto() { return { tenantId: 'hus-aaaaaaaa', rolle: 'ejer', medlemmer: [] }; }, async forlad() {} }, afvikler, haendelser: haendelser() }, { kontoId: a, session, emailBekraeftelse: 'slet@example.test', nu: b.u.nu() }), 'slettet');
  for (const t of ['beta.set', 'beta.maal', 'beta.dagtal', 'beta.feedback']) {
    assert.deepEqual((await b.db.query(`SELECT 1 FROM ${t} WHERE konto_id = $1`, [a])).map(() => 1), [], t);
    assert.equal((await b.db.query(`SELECT 1 FROM ${t} WHERE konto_id = $1`, [andet])).length > 0, true, `${t}: the other household stays`);
  }
  const inv = await b.db.query<{ brugt: unknown; brugt_af: unknown }>('SELECT brugt, brugt_af FROM beta.invitation ORDER BY id');
  assert.equal(inv.length, 2);
  assert.ok(inv[0]!.brugt !== null && inv[0]!.brugt_af === null, 'the deleted account\'s code stays spent, naming nobody');
  assert.ok(inv[1]!.brugt_af !== null, 'the other household\'s code still names its account');
  // Nothing under beta/ is "kept": the retention list does not mention it.
  assert.ok(!BEHOLDT.some((x) => x.sted.startsWith('beta')));
  await b.db.close();
  void ingenHusstand; void ingenAfvikler;
});
