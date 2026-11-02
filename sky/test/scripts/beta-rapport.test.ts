// KC-0203: the report run against a database with beta households: the numbers come from the tables, hand-given gifts
// and deleted accounts are not households, and nothing names a person or a tenant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { betaRapport, rapportTekst } from '../../scripts/beta-rapport.ts';
import { opsaetBeta, DAG } from '../beta/hjaelp.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { saetGave } from '../../src/abonnement/synk.ts';
import { laesPriser } from '../../src/abonnement/priser.ts';

test('the report reads the beta tables: households, retention, timings, consented numbers, feedback', async () => {
  const b = await opsaetBeta();
  const start = b.u.nu(); // 2026-11-01 10:00 UTC is day 1
  const a = await b.husstand('a@example.test', 'hus-aaaaaaaa', { samtykke: true, bestilt: new Date(start.getTime() - 40_000), klar: start });
  const c = await b.husstand('c@example.test', 'hus-cccccccc', { samtykke: false, bestilt: new Date(start.getTime() - 50_000), klar: start });
  // A hand-given gift and a paying customer are not beta households.
  const haand = (await findEllerOpretKonto(b.db, 'haand@example.test', start)).konto.id;
  await saetGave(b.db, haand, 'sky-husstand', laesPriser(), start);
  await b.db.query("INSERT INTO beta.set (konto_id, dag) VALUES ($1, '2026-11-09'), ($1, '2026-11-10'), ($1, '2026-11-14'), ($1, '2026-11-15'), ($2, '2026-11-02')", [a, c]);
  await b.db.query("UPDATE beta.maal SET kilde_forbundet_ms = 30000, foerste_vaerdi_ms = 80000, tilmelding_ms = 60000 WHERE konto_id = $1", [a]);
  await b.db.query("INSERT INTO beta.dagtal (konto_id, dag, kraever) VALUES ($1, '2026-11-03', 8), ($1, '2026-11-14', 2)", [a]);
  await b.db.query("INSERT INTO beta.feedback (konto_id, dag, vurdering, tekst, betale, tid) VALUES ($1, 14, 5, 'Roligt', 'ja', now()), ($2, 7, 3, 'For meget Mail', NULL, now())", [a, c]);
  b.u.frem(20 * DAG);
  const r = await betaRapport(b.db, b.u.nu());
  assert.equal(r.husstande, 2);
  assert.equal(r.klare, 2);
  assert.equal(r.koert14, 2);
  assert.deepEqual(r.fastholdt14, { n: 1, af: 2 });
  assert.deepEqual(r.provisionering, { n: 2, medianMs: 45_000, p95Ms: 50_000 });
  assert.deepEqual(r.foersteVaerdi, { n: 1, medianEfterKildeMs: 80_000, medianFraTilmeldingMs: 170_000 });
  assert.deepEqual(r.kraever, { delte: 1, sammenlignet: 1, lavere: 1 });
  assert.deepEqual(r.vurdering, { n: 2, gennemsnit: 4 });
  assert.deepEqual(r.betale, { ja: 1, maaske: 0, nej: 0 });
  assert.deepEqual(r.tekster.map((t) => t.tekst), ['For meget Mail', 'Roligt']);
  const alt = JSON.stringify(r) + rapportTekst(r).join('\n');
  assert.ok(!/@|hus-[a-z2-7]{8}|example\.test/.test(alt), 'no address, no tenant');
  await b.db.close();
});

test('a deleted account is not a household any more (its invitation names nobody)', async () => {
  const b = await opsaetBeta();
  const id = await b.husstand('a@example.test', 'hus-aaaaaaaa');
  await b.db.query('UPDATE beta.invitation SET brugt_af = NULL WHERE brugt_af = $1', [id]);
  assert.equal((await betaRapport(b.db, b.u.nu())).husstande, 0);
  await b.db.close();
});
