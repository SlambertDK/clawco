// KC-0182 (spec D11): deprovisioning — out of the gateway, stop the container, wipe the volume (seen gone),
// tombstone the row. Idempotent and resumable like provisioning, and reached from "delete my account"
// through konto's TenantAfvikler seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afprovisioner, type AfprovisionerDeps } from '../../src/fleet/afprovisioner.ts';
import { provisioner } from '../../src/fleet/provisioner.ts';
import { flaadeAfvikler, flaadeHusstand, clawcoFor } from '../../src/fleet/afvikler.ts';
import { bestil, hentTenant, laase } from '../../src/fleet/tilstand.ts';
import { sletKonto, ingenHusstand } from '../../src/konto/slet.ts';
import { haendelser } from '../../src/delt/haendelser.ts';
import { falskFlaade, falskNoegler, opsaet, type FalskFlaade, type FalskNoegler } from './hjaelp.ts';

function deps(o: Awaited<ReturnType<typeof opsaet>>, f: FalskFlaade, ud: string[] = [], noegler: FalskNoegler = falskNoegler()): AfprovisionerDeps {
  return { db: o.db, flaade: f, laas: laase(), nu: o.ur.nu, udAfGateway: async (slug) => { ud.push(slug); }, noegler };
}

async function klarTenant(o: Awaited<ReturnType<typeof opsaet>>, f: FalskFlaade, laas = laase()) {
  const { slug } = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  await provisioner({ db: o.db, flaade: f, billede: 'clawco:test', laas, nu: o.ur.nu, vent: async () => {}, sundhed: async () => ({ ok: true, sha: 'abc' }), iGateway: async () => {}, noegler: falskNoegler() }, slug);
  return slug;
}

test('a klar tenant: out of the gateway, stopped, wiped, then a slettet tombstone without an address', async () => {
  const o = await opsaet();
  const f = falskFlaade();
  const slug = await klarTenant(o, f);
  f.kald.length = 0;
  const ud: string[] = [];
  o.ur.frem(60_000);
  await afprovisioner(deps(o, f, ud), slug);
  assert.deepEqual(ud, [slug]);
  assert.deepEqual(f.kald, [`stop ${slug}`, `slet ${slug}`]);
  assert.equal(f.volumener.size, 0);
  assert.equal(f.containere.size, 0);
  const t = (await hentTenant(o.db, slug))!;
  assert.equal(t.tilstand, 'slettet');
  assert.equal(t.adresse, null);
  assert.equal(t.tider.afvikles?.toISOString(), o.ur.nu().toISOString());
  assert.equal(t.tider.slettet?.toISOString(), o.ur.nu().toISOString());
  assert.equal(t.slug, slug, 'the slug stays on the tombstone, so it is never handed out again');
  await o.db.close();
});

test('idempotent: deprovisioning a deleted tenant does nothing', async () => {
  const o = await opsaet();
  const f = falskFlaade();
  const slug = await klarTenant(o, f);
  await afprovisioner(deps(o, f), slug);
  f.kald.length = 0;
  await afprovisioner(deps(o, f), slug);
  assert.deepEqual(f.kald, []);
  await o.db.close();
});

test('a failure part-way leaves the tenant in afvikles with the error, and the next run finishes it', async () => {
  const o = await opsaet();
  const f = falskFlaade();
  const slug = await klarTenant(o, f);
  f.fejlNaeste('slet');
  await assert.rejects(afprovisioner(deps(o, f), slug), /slet-fejl/);
  const mellem = (await hentTenant(o.db, slug))!;
  assert.equal(mellem.tilstand, 'afvikles');
  assert.match(mellem.fejl ?? '', /slet-fejl/);
  await afprovisioner(deps(o, f), slug);
  assert.equal((await hentTenant(o.db, slug))!.tilstand, 'slettet');
  assert.equal(f.volumener.size, 0);
  await o.db.close();
});

test('a half-made tenant (still bestilt) is deleted too, and provisioning never picks it up again', async () => {
  const o = await opsaet();
  const f = falskFlaade();
  const { slug } = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  await afprovisioner(deps(o, f), slug);
  assert.equal((await hentTenant(o.db, slug))!.tilstand, 'slettet');
  const t = await provisioner({ db: o.db, flaade: f, billede: null, laas: laase(), nu: o.ur.nu, vent: async () => {}, sundhed: async () => ({ ok: true, sha: null }), iGateway: async () => {}, noegler: falskNoegler() }, slug);
  assert.equal(t.tilstand, 'slettet');
  assert.ok(!f.kald.some((k) => k.startsWith('klargoer')));
  await o.db.close();
});

test('an unknown slug is refused (never claims to have deleted something it does not know)', async () => {
  const o = await opsaet();
  await assert.rejects(afprovisioner(deps(o, falskFlaade()), 'hus-zzzzzzzz'), /ukendt/);
  await o.db.close();
});

test('delete my account (KC-0177) as an owner: the household seam finds the tenant, the afvikler wipes it, the account goes', async () => {
  const o = await opsaet('ejer@example.test');
  const f = falskFlaade();
  const slug = await klarTenant(o, f);
  const husstand = flaadeHusstand({ db: o.db, basedomain: 'clawco.example', reserve: ingenHusstand() });
  assert.deepEqual(await husstand.forKonto(o.kontoId), { tenantId: slug, rolle: 'ejer', medlemmer: [] });
  const afvikler = flaadeAfvikler(deps(o, f));
  const r = await sletKonto({ db: o.db, husstand, afvikler, haendelser: haendelser() }, {
    kontoId: o.kontoId, session: { autentificeret: o.ur.nu() }, emailBekraeftelse: 'ejer@example.test', nu: o.ur.nu(),
  });
  assert.equal(r, 'slettet');
  assert.equal((await hentTenant(o.db, slug))!.tilstand, 'slettet');
  assert.equal(f.volumener.size, 0);
  assert.equal(await husstand.forKonto(o.kontoId), null, 'a deleted tenant belongs to nobody');
  await o.db.close();
});

test('when the wipe fails, the account stays whole (konto deletes the tenant first)', async () => {
  const o = await opsaet('ejer@example.test');
  const f = falskFlaade();
  await klarTenant(o, f);
  f.fejlNaeste('stop');
  const husstand = flaadeHusstand({ db: o.db, basedomain: 'clawco.example', reserve: ingenHusstand() });
  await assert.rejects(sletKonto({ db: o.db, husstand, afvikler: flaadeAfvikler(deps(o, f)), haendelser: haendelser() }, {
    kontoId: o.kontoId, session: { autentificeret: o.ur.nu() }, emailBekraeftelse: 'ejer@example.test', nu: o.ur.nu(),
  }));
  const [k] = await o.db.query<{ email: string | null }>('SELECT email FROM konto WHERE id = $1', [o.kontoId]);
  assert.equal(k?.email, 'ejer@example.test');
  await o.db.close();
});

test('an account without a tenant falls through to the household seam behind it', async () => {
  const o = await opsaet();
  const reserve = { forladt: [] as number[], async forKonto() { return { tenantId: 'hus-anden0000', rolle: 'medlem' as const, medlemmer: [] }; }, async forlad(k: number) { reserve.forladt.push(k); } };
  const h = flaadeHusstand({ db: o.db, basedomain: 'clawco.example', reserve });
  assert.equal((await h.forKonto(o.kontoId))?.rolle, 'medlem');
  await h.forlad(o.kontoId);
  assert.deepEqual(reserve.forladt, [o.kontoId]);
  await o.db.close();
});

test('clawcoFor (what /konto shows): the address once klar, waiting while made, nothing while deleted or without one', async () => {
  const o = await opsaet();
  const vis = clawcoFor({ db: o.db, basedomain: 'clawco.example' });
  assert.equal(await vis(o.kontoId), null);
  const { slug } = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  assert.deepEqual(await vis(o.kontoId), { venter: true });
  await o.db.query("UPDATE flaade.tenant SET tilstand = 'klar', klar = now() WHERE slug = $1", [slug]);
  assert.deepEqual(await vis(o.kontoId), { url: `https://${slug}.clawco.example/` });
  await o.db.query("UPDATE flaade.tenant SET tilstand = 'afvikles', afvikles = now() WHERE slug = $1", [slug]);
  assert.equal(await vis(o.kontoId), null);
  await o.db.close();
});

// --- KC-0181 (D11 "revoke keys") ----------------------------------------------------------------------

test('KC-0181: once the container and volume are seen gone, the tenant\'s data key is marked for its 30-day purge', async () => {
  const o = await opsaet();
  const f = falskFlaade();
  const slug = await klarTenant(o, f);
  const kald: string[] = [];
  const noegler = falskNoegler(kald);
  await afprovisioner(deps(o, f, [], noegler), slug);
  assert.deepEqual(kald, [`noegle-slettet ${slug}`]);
  assert.deepEqual(f.kald.slice(-2), [`stop ${slug}`, `slet ${slug}`]);
  assert.equal((await hentTenant(o.db, slug))!.tilstand, 'slettet');
  await o.db.close();
});

test('KC-0181: if marking the key fails the tenant stays afvikles with the error, and a rerun finishes', async () => {
  const o = await opsaet();
  const f = falskFlaade();
  const slug = await klarTenant(o, f);
  const noegler = falskNoegler();
  noegler.fejlNaeste('markerSlettet');
  await assert.rejects(afprovisioner(deps(o, f, [], noegler), slug), /markerSlettet-fejl/);
  const mellem = (await hentTenant(o.db, slug))!;
  assert.equal(mellem.tilstand, 'afvikles');
  assert.match(mellem.fejl ?? '', /markerSlettet-fejl/);
  await afprovisioner(deps(o, f, [], noegler), slug);
  assert.equal((await hentTenant(o.db, slug))!.tilstand, 'slettet');
  assert.equal(noegler.kald.filter((k) => k.startsWith('noegle-slettet')).length, 2);
  await o.db.close();
});

test('KC-0206: the tenant\'s own Slet alt runs before the container stops, at its address', async () => {
  const o = await opsaet();
  const f = falskFlaade();
  const slug = await klarTenant(o, f);
  const adresse = (await hentTenant(o.db, slug))!.adresse!;
  f.kald.length = 0;
  await afprovisioner({ ...deps(o, f), toem: async (s, a) => { f.kald.push(`toem ${s} ${a}`); } }, slug);
  assert.deepEqual(f.kald, [`toem ${slug} ${adresse}`, `stop ${slug}`, `slet ${slug}`]);
  assert.equal((await hentTenant(o.db, slug))!.tilstand, 'slettet');
  await o.db.close();
});

test('KC-0206: a tenant that cannot empty itself (crashed, unreachable) is still wiped — the volume removal is the guarantee', async () => {
  const o = await opsaet();
  const f = falskFlaade();
  const slug = await klarTenant(o, f);
  const fejl: string[] = [];
  const { mock } = await import('node:test');
  const m = mock.method(console, 'error', (...a: unknown[]) => { fejl.push(a.join(' ')); });
  try {
    await afprovisioner({ ...deps(o, f), toem: async () => { throw new Error('kundens Clawco svarede 502 på Slet alt'); } }, slug);
  } finally { m.mock.restore(); }
  assert.equal(f.volumener.size, 0);
  assert.equal((await hentTenant(o.db, slug))!.tilstand, 'slettet');
  assert.equal(fejl.length, 1);
  assert.match(fejl[0]!, /502/);
  await o.db.close();
});

test('KC-0206: a half-made tenant without an address is not asked to empty itself', async () => {
  const o = await opsaet();
  const f = falskFlaade();
  const { slug } = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  const kaldt: string[] = [];
  await afprovisioner({ ...deps(o, f), toem: async (s) => { kaldt.push(s); } }, slug);
  assert.deepEqual(kaldt, []);
  await o.db.close();
});
