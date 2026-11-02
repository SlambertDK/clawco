// KC-0182: provisioning is a resumable state machine stored in Postgres — bestilt → startet → sund →
// i-gateway → klar on the lokal driver — each step timestamped, each step done once, and any failure
// resumed by running it again without a second volume or container.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provisioner, hentSundhed, type ProvisionerDeps } from '../../src/fleet/provisioner.ts';
import { bestil, hentTenant, tenantForEjer, laase, TRIN } from '../../src/fleet/tilstand.ts';
import { falskFlaade, falskNoegler, opsaet, type FalskNoegler } from './hjaelp.ts';

function deps(o: Awaited<ReturnType<typeof opsaet>>, f = falskFlaade(), ekstra: Partial<Omit<ProvisionerDeps, 'noegler'>> & { noegler?: FalskNoegler } = {}): ProvisionerDeps & { sundKald: string[]; gatewayKald: string[]; noegler: FalskNoegler } {
  const sundKald: string[] = [];
  const gatewayKald: string[] = [];
  return {
    db: o.db, flaade: f, billede: 'clawco:test', laas: laase(),
    nu: o.ur.nu,
    vent: async (ms) => { o.ur.frem(ms); },
    sundhed: async (adresse) => { sundKald.push(adresse); o.ur.frem(1_000); return { ok: true, sha: 'abc1234' }; },
    iGateway: async (t) => { gatewayKald.push(`${t.slug} ${t.adresse}`); },
    noegler: falskNoegler(),
    sundKald, gatewayKald,
    ...ekstra,
  };
}

test('bestil makes one row in bestilt with a random slug; a second bestil for the same owner returns the same tenant', async () => {
  const o = await opsaet();
  const t = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  assert.match(t.slug, /^hus-[a-z2-7]{8}$/);
  assert.equal(t.tilstand, 'bestilt');
  assert.equal(t.tider.bestilt?.toISOString(), o.ur.nu().toISOString());
  const igen = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  assert.equal(igen.slug, t.slug);
  assert.equal((await o.db.query('SELECT 1 FROM flaade.tenant')).length, 1);
  assert.equal((await tenantForEjer(o.db, o.kontoId))?.slug, t.slug);
  await o.db.close();
});

test('bestil draws again on a slug collision and never reuses a slug', async () => {
  const o = await opsaet();
  const { konto: b } = await (await import('../../src/konto/konto.ts')).findEllerOpretKonto(o.db, 'b@example.test', o.ur.nu());
  await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu(), nySlug: () => 'hus-aaaaaaaa' });
  const traek = ['hus-aaaaaaaa', 'hus-aaaaaaaa', 'hus-bbbbbbbb'];
  const t = await bestil(o.db, { kontoId: b.id, driver: 'lokal', nu: o.ur.nu(), nySlug: () => traek.shift()! });
  assert.equal(t.slug, 'hus-bbbbbbbb');
  await assert.rejects(bestil(o.db, { kontoId: 999, driver: 'lokal', nu: o.ur.nu(), nySlug: () => 'hus-cccccccc' }));
  await o.db.close();
});

test('happy path: the steps run in order, each with its own timestamp, and the tenant ends klar with its address and release', async () => {
  const o = await opsaet('mette@example.test');
  const d = deps(o);
  const t0 = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  o.ur.frem(500);
  const t = await provisioner(d, t0.slug);
  assert.equal(t.tilstand, 'klar');
  assert.deepEqual(TRIN, ['bestilt', 'startet', 'sund', 'i-gateway', 'klar']);
  const tider = TRIN.map((s) => t.tider[s]!.getTime());
  for (let i = 1; i < tider.length; i++) assert.ok(tider[i]! >= tider[i - 1]!, `${TRIN[i]} after ${TRIN[i - 1]}`);
  assert.equal(tider[1]! - tider[0]!, 500);
  assert.equal(t.adresse, 'http://172.18.0.2:8750');
  assert.equal(t.release, 'abc1234');
  assert.equal(t.billede, 'clawco:test');
  assert.equal(t.fejl, null);
  assert.deepEqual((d.flaade as ReturnType<typeof falskFlaade>).kald, [`klargoer ${t.slug}`]);
  assert.equal((d.flaade as ReturnType<typeof falskFlaade>).husstande.get(t.slug), 'mette@example.test', 'the owner\'s verified email');
  assert.deepEqual(d.sundKald, ['http://172.18.0.2:8750']);
  assert.deepEqual(d.gatewayKald, [`${t.slug} http://172.18.0.2:8750`]);
  // Done is done: running it again changes nothing.
  const igen = await provisioner(d, t.slug);
  assert.deepEqual(igen, t);
  assert.equal((d.flaade as ReturnType<typeof falskFlaade>).kald.length, 1);
  await o.db.close();
});

test('startet fails: the error is stored, the state stays bestilt, and the next run resumes without a second volume', async () => {
  const o = await opsaet();
  const f = falskFlaade();
  const d = deps(o, f);
  const { slug } = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  f.fejlNaeste('klargoer');
  await assert.rejects(provisioner(d, slug), /falsk klargoer-fejl/);
  const mellem = (await hentTenant(o.db, slug))!;
  assert.equal(mellem.tilstand, 'bestilt');
  assert.match(mellem.fejl ?? '', /klargoer-fejl/);
  assert.equal(mellem.forsoeg, 1);
  const t = await provisioner(d, slug);
  assert.equal(t.tilstand, 'klar');
  assert.equal(t.fejl, null, 'a step that succeeds clears the error');
  assert.equal(f.volumener.size, 1);
  assert.equal(f.containere.size, 1);
  await o.db.close();
});

test('sund waits for /health within its limit; past it the tenant stays startet and a later run picks it up', async () => {
  const o = await opsaet();
  const f = falskFlaade();
  let svar = false;
  const d = deps(o, f, { sundhed: async () => ({ ok: svar, sha: svar ? 'abc1234' : null }), sundFrist: { forsoeg: 3, ms: 1_000 } });
  const { slug } = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  await assert.rejects(provisioner(d, slug), /health/);
  assert.equal((await hentTenant(o.db, slug))!.tilstand, 'startet');
  svar = true;
  const t = await provisioner(d, slug);
  assert.equal(t.tilstand, 'klar');
  assert.deepEqual(f.kald, [`klargoer ${slug}`, `klargoer ${slug}`], 'the resumed run re-reads the address; no second container');
  assert.equal(f.containere.size, 1);
  await o.db.close();
});

test('i-gateway fails: the tenant stays sund and resumes there', async () => {
  const o = await opsaet();
  let n = 0;
  const d = deps(o, falskFlaade(), { iGateway: async () => { if (n++ === 0) throw new Error('gateway nede'); } });
  const { slug } = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  await assert.rejects(provisioner(d, slug), /gateway nede/);
  assert.equal((await hentTenant(o.db, slug))!.tilstand, 'sund');
  assert.equal((await provisioner(d, slug)).tilstand, 'klar');
  await o.db.close();
});

test('a tenant being deleted is never moved forward again', async () => {
  const o = await opsaet();
  const d = deps(o);
  const { slug } = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  await o.db.query("UPDATE flaade.tenant SET tilstand = 'afvikles', afvikles = now() WHERE slug = $1", [slug]);
  const t = await provisioner(d, slug);
  assert.equal(t.tilstand, 'afvikles');
  assert.deepEqual((d.flaade as ReturnType<typeof falskFlaade>).kald, []);
  await o.db.close();
});

test('an owner whose account is gone gets no container', async () => {
  const o = await opsaet();
  const d = deps(o);
  const { slug } = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  await o.db.query('UPDATE konto SET email = NULL, slettet_ved = now() WHERE id = $1', [o.kontoId]);
  await assert.rejects(provisioner(d, slug), /ejer/);
  assert.deepEqual((d.flaade as ReturnType<typeof falskFlaade>).kald, []);
  await o.db.close();
});

test('the state column only takes the machine\'s states, and one owner has at most one live tenant', async () => {
  const o = await opsaet();
  const t = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  await assert.rejects(o.db.query("UPDATE flaade.tenant SET tilstand = 'halvt' WHERE slug = $1", [t.slug]));
  await assert.rejects(o.db.query("INSERT INTO flaade.tenant (slug, ejer_konto_id, driver, tilstand, bestilt, oprettet, opdateret) VALUES ('hus-zzzzzzzz', $1, 'lokal', 'bestilt', now(), now(), now())", [o.kontoId]));
  await assert.rejects(o.db.query("UPDATE flaade.tenant SET slug = 'konto' WHERE slug = $1", [t.slug]));
  await o.db.close();
});

test('two runs at once for the same tenant do the work once (the per-tenant lock)', async () => {
  const o = await opsaet();
  const f = falskFlaade();
  const d = deps(o, f);
  const { slug } = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  const [a, b] = await Promise.all([provisioner(d, slug), provisioner(d, slug)]);
  assert.equal(a.tilstand, 'klar');
  assert.equal(b.tilstand, 'klar');
  assert.deepEqual(f.kald, [`klargoer ${slug}`]);
  await o.db.close();
});

test('hentSundhed: ok only for a 200 with ok:true; the sha is kept short; nothing answering is not ok', async () => {
  const svar = (status: number, krop: unknown) => (async () => new Response(JSON.stringify(krop), { status })) as typeof fetch;
  assert.deepEqual(await hentSundhed('http://172.18.0.2:8750', svar(200, { ok: true, sha: 'abc1234' })), { ok: true, sha: 'abc1234' });
  assert.deepEqual(await hentSundhed('http://172.18.0.2:8750', svar(200, { ok: false })), { ok: false, sha: null });
  assert.deepEqual(await hentSundhed('http://172.18.0.2:8750', svar(503, { ok: true })), { ok: false, sha: null });
  assert.deepEqual(await hentSundhed('http://172.18.0.2:8750', svar(200, { ok: true, sha: 'x'.repeat(500) })), { ok: true, sha: 'x'.repeat(64) });
  assert.deepEqual(await hentSundhed('http://172.18.0.2:8750', (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch), { ok: false, sha: null });
  let url = '';
  await hentSundhed('http://172.18.0.2:8750', (async (u: string | URL | Request) => { url = String(u); return new Response('{}'); }) as typeof fetch);
  assert.equal(url, 'http://172.18.0.2:8750/health');
});

// --- KC-0181: the tenant's key envelope -------------------------------------------------------------

/** One call list for the fleet and the keys, so the order between them can be asserted. */
function medFaellesListe(o: Awaited<ReturnType<typeof opsaet>>, ekstra: Partial<Omit<ProvisionerDeps, 'noegler'>> = {}) {
  const f = falskFlaade();
  const noegler = falskNoegler(f.kald);
  return { f, noegler, d: deps(o, f, { noegler, ...ekstra }) };
}

test('KC-0181: the data key is made BEFORE the container, and its lager key is delivered right after it starts', async () => {
  const o = await opsaet();
  const { f, d } = medFaellesListe(o);
  const { slug } = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  assert.equal((await provisioner(d, slug)).tilstand, 'klar');
  assert.deepEqual(f.kald, [`noegle-sikr ${slug}`, `klargoer ${slug}`, `noegle-lever ${slug} clawco-t-${slug}`]);
  await o.db.close();
});

test('KC-0181: no key, no container — a failing key step means the fleet is never asked to start the tenant', async () => {
  const o = await opsaet();
  const { f, noegler, d } = medFaellesListe(o);
  const { slug } = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  noegler.fejlNaeste('sikr');
  await assert.rejects(provisioner(d, slug), /falsk sikr-fejl/);
  assert.deepEqual(f.kald, [`noegle-sikr ${slug}`], 'klargoer never ran');
  assert.equal(f.containere.size, 0);
  const t = (await hentTenant(o.db, slug))!;
  assert.equal(t.tilstand, 'bestilt');
  assert.match(t.fejl ?? '', /sikr-fejl/);
  assert.equal((await provisioner(d, slug)).tilstand, 'klar', 'the next run resumes');
  await o.db.close();
});

test('KC-0181: a failed delivery keeps the tenant out of startet; the resumed run delivers again and only then moves on', async () => {
  const o = await opsaet();
  const { f, noegler, d } = medFaellesListe(o);
  const { slug } = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  noegler.fejlNaeste('lever');
  await assert.rejects(provisioner(d, slug), /falsk lever-fejl/);
  assert.equal((await hentTenant(o.db, slug))!.tilstand, 'bestilt');
  assert.equal(d.sundKald.length, 0, 'a tenant whose key is not in is never judged healthy');
  assert.equal((await provisioner(d, slug)).tilstand, 'klar');
  assert.deepEqual(f.kald.filter((k) => k.startsWith('noegle-lever')), [`noegle-lever ${slug} clawco-t-${slug}`, `noegle-lever ${slug} clawco-t-${slug}`]);
  assert.equal(f.containere.size, 1, 'still one container');
  await o.db.close();
});

test('KC-0181: a run resumed in startet restarts the container if needed and delivers again (the tmpfs is gone after a stop)', async () => {
  const o = await opsaet();
  const { f, d } = medFaellesListe(o, { sundFrist: { forsoeg: 1, ms: 1 }, sundhed: async () => ({ ok: false, sha: null }) });
  const { slug } = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  await assert.rejects(provisioner(d, slug), /health/);
  assert.equal((await hentTenant(o.db, slug))!.tilstand, 'startet');
  f.kald.length = 0;
  const d2 = { ...d, sundhed: async () => ({ ok: true, sha: 'abc' }) };
  assert.equal((await provisioner(d2, slug)).tilstand, 'klar');
  assert.deepEqual(f.kald, [`noegle-sikr ${slug}`, `klargoer ${slug}`, `noegle-lever ${slug} clawco-t-${slug}`]);
  await o.db.close();
});
