// KC-0212 (spec D18): the hetzner driver is built but refuses while the cost ledger has no active,
// covered Hetzner line — a disabled driver never provisions. The real driver waits for the revenue trigger (KC-0182).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hetznerFlaade, HetznerSlukket } from '../../src/fleet/hetzner.ts';
import { flaadeAfvikler } from '../../src/fleet/afvikler.ts';
import { ingenKryptering } from '../../src/fleet/kryptering.ts';
import { laesOmkostninger, validerOmkostninger } from '../../src/delt/omkostninger.ts';
import { bestil, hentTenant, laase } from '../../src/fleet/tilstand.ts';
import { falskNoegler, opsaet } from './hjaelp.ts';

const taendt = validerOmkostninger({ ressourcer: { 'hetzner-node-1': { navn: 'H', maanedlig: 5600, aktiv: true, kilde: 'k', laest: '2026-10-31', udloeser: { mrrGange: 2 } } } });

test('on the real ledger (Hetzner off, no customers) every call refuses with HetznerSlukket', async () => {
  const f = hetznerFlaade({ omkostninger: () => laesOmkostninger(), mrr: () => 0 });
  assert.equal(f.navn, 'hetzner');
  await assert.rejects(f.klargoer({ id: 'a1', ejer: 'a@example.test' }), HetznerSlukket);
  await assert.rejects(f.status('a1'), HetznerSlukket);
  await assert.rejects(f.stop('a1'), HetznerSlukket);
  await assert.rejects(f.slet('a1'), HetznerSlukket);
  await assert.rejects(f.maerkede(), HetznerSlukket);
});

test('switched on but not covered by MRR still refuses (red in the ledger)', async () => {
  const f = hetznerFlaade({ omkostninger: () => taendt, mrr: () => 11_199 });
  await assert.rejects(f.klargoer({ id: 'a1', ejer: 'a@example.test' }), HetznerSlukket);
});

test('switched on and covered: refuses as not built yet (KC-0182), never pretends to provision', async () => {
  const f = hetznerFlaade({ omkostninger: () => taendt, mrr: () => 11_200 });
  await assert.rejects(f.klargoer({ id: 'a1', ejer: 'a@example.test' }), (e: Error) => !(e instanceof HetznerSlukket) && /KC-0182/.test(e.message));
});

test('the fleet-backed TenantAfvikler on a disabled Hetzner fleet keeps the error and never marks the tenant deleted', async () => {
  const o = await opsaet();
  const { slug } = await bestil(o.db, { kontoId: o.kontoId, driver: 'hetzner', nu: o.ur.nu() });
  const f = hetznerFlaade({ omkostninger: () => laesOmkostninger(), mrr: () => 0 });
  await assert.rejects(flaadeAfvikler({ db: o.db, flaade: f, laas: laase(), nu: o.ur.nu, udAfGateway: async () => {}, noegler: falskNoegler() }).afprovisioner(slug), HetznerSlukket);
  assert.equal((await hentTenant(o.db, slug))!.tilstand, 'afvikles');
  await o.db.close();
});

test('encryption at rest is a seam: none until KC-0181, and it says so', () => {
  const k = ingenKryptering();
  assert.equal(k.krypteret, false);
  assert.match(k.navn, /KC-0181/);
});
