// KC-0212: the cost ledger as Sky reads it. The real file validates and costs 0 kr now; every case of
// the shared conformance fixture gets the verdict the tenant's validator gives too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { daekning, erDaekketAktiv, laesOmkostninger, validerOmkostninger, OMKOSTNINGSFIL } from '../../src/delt/omkostninger.ts';

const repoRod = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
type Tilfaelde = { navn: string; raw: unknown; fejl?: string; mrr?: number; samlet?: string; nu?: number; tilstande?: Record<string, string> };
const { tilfaelde } = JSON.parse(fs.readFileSync(path.join(repoRod, 'test', 'fixtures', 'omkostninger-konformitet.json'), 'utf8')) as { tilfaelde: Tilfaelde[] };

/** KC-0276: the ledger is private (config/omkostninger.json is left out of the public mirror); tests of the real file skip there. */
const LEDGER_MANGLER = fs.existsSync(OMKOSTNINGSFIL) ? false : 'the ledger is not in the public mirror (KC-0276)';

test('the real ledger validates, costs 0 kr now and is green with no customers', { skip: LEDGER_MANGLER }, () => {
  assert.equal(OMKOSTNINGSFIL, path.join(repoRod, 'config', 'omkostninger.json'));
  const o = laesOmkostninger();
  const d = daekning(o, 0);
  assert.equal(d.nu, 0);
  assert.equal(d.samlet, 'groen');
  for (const id of ['kira-home', 'cloudflare-tunnel', 'r2-gratis', 'stripe', 'mail-gratis', 'fejlovervaagning-gratis']) {
    assert.equal(o.ressourcer[id]?.aktiv, true, id);
    assert.equal(o.ressourcer[id]?.maanedlig, 0, id);
  }
  for (const id of ['hetzner-node-1', 'r2-over-gratis']) {
    const r = o.ressourcer[id]!;
    assert.equal(r.aktiv, false, id);
    assert.ok(r.maanedlig > 0 && r.udloeser && r.kilde && r.laest, `${id} is paid with a trigger and a source`);
  }
});

test('every paid line in the real ledger has a trigger (§0 r6: nothing paid without one)', { skip: LEDGER_MANGLER }, () => {
  for (const [id, r] of Object.entries(laesOmkostninger().ressourcer)) if (r.maanedlig > 0) assert.ok(r.udloeser && r.udloeser.mrrGange >= 1, id);
});

test('the shared conformance fixture: every case gets its verdict', () => {
  assert.ok(tilfaelde.length >= 15);
  for (const t of tilfaelde) {
    if (t.fejl) {
      assert.throws(() => validerOmkostninger(t.raw), (e: Error) => e.message.startsWith(`config/omkostninger.json: ${t.fejl} `), t.navn);
      continue;
    }
    const d = daekning(validerOmkostninger(t.raw), t.mrr ?? 0);
    assert.equal(d.samlet, t.samlet, t.navn);
    assert.equal(d.nu, t.nu, t.navn);
    for (const [id, tilstand] of Object.entries(t.tilstande ?? {})) assert.equal(d.linjer.find((l) => l.id === id)?.tilstand, tilstand, `${t.navn}: ${id}`);
  }
});

test('erDaekketAktiv: only an active paid line whose cover is met', { skip: LEDGER_MANGLER }, () => {
  const real = laesOmkostninger();
  assert.equal(erDaekketAktiv(real, 'hetzner-node-1', 0), false);
  assert.equal(erDaekketAktiv(real, 'hetzner-node-1', 10_000_000), false, 'inactive stays off however much MRR');
  assert.equal(erDaekketAktiv(real, 'kira-home', 0), false, 'a free line is not a paid one');
  assert.equal(erDaekketAktiv(real, 'findes-ikke', 0), false);
  const taendt = validerOmkostninger({ ressourcer: { h: { navn: 'H', maanedlig: 1000, aktiv: true, kilde: 'k', laest: '2026-10-31', udloeser: { mrrGange: 2 } } } });
  assert.equal(erDaekketAktiv(taendt, 'h', 1999), false);
  assert.equal(erDaekketAktiv(taendt, 'h', 2000), true);
});

test('a broken file names the file, never half-reads it', () => {
  assert.throws(() => laesOmkostninger(path.join(repoRod, 'findes-ikke.json')), /kan ikke læse omkostningsfilen/);
});
