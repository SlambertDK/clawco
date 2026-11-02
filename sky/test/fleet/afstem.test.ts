// KC-0182: the reconciler. Level-triggered, so a Sky restart loses nothing: every account with an active
// plan or trial gets a tenant ordered, every tenant stuck part-way is carried on (or its deletion
// finished), and leftover Docker objects are removed only when the tenant table proves they were ours and
// the tenant is gone. A label with no row at all is never touched (it could be another Sky's).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afstem, afstemLoekke, klargoerKonto, type AfstemDeps } from '../../src/fleet/afstem.ts';
import { bestil, hentTenant, laase, tenantForEjer } from '../../src/fleet/tilstand.ts';
import { kontiMedAdgang, saetGave } from '../../src/abonnement/synk.ts';
import { laesPriser } from '../../src/abonnement/priser.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { falskFlaade, falskNoegler, opsaet, type FalskFlaade } from './hjaelp.ts';

function deps(o: Awaited<ReturnType<typeof opsaet>>, f: FalskFlaade, berettigede: () => Promise<number[]> = async () => []): AfstemDeps {
  return {
    db: o.db, flaade: f, billede: 'clawco:test', laas: laase(), nu: o.ur.nu, vent: async () => {},
    sundhed: async () => ({ ok: true, sha: 'abc' }), iGateway: async () => {}, udAfGateway: async () => {},
    noegler: falskNoegler(), berettigede,
  };
}

test('an account with an active plan gets a tenant ordered and carried to klar; one without a plan gets nothing', async () => {
  const o = await opsaet('betaler@example.test');
  const { konto: gratis } = await findEllerOpretKonto(o.db, 'gratis@example.test', o.ur.nu());
  await saetGave(o.db, o.kontoId, 'sky-husstand', laesPriser(), o.ur.nu());
  const f = falskFlaade();
  const r = await afstem(deps(o, f, () => kontiMedAdgang(o.db)));
  const t = await tenantForEjer(o.db, o.kontoId);
  assert.ok(t);
  assert.equal(t.tilstand, 'klar');
  assert.deepEqual(r.bestilt, [t.slug]);
  assert.equal(await tenantForEjer(o.db, gratis.id), null);
  // A second pass orders nothing new.
  const r2 = await afstem(deps(o, f, () => kontiMedAdgang(o.db)));
  assert.deepEqual(r2.bestilt, []);
  assert.equal((await o.db.query('SELECT 1 FROM flaade.tenant')).length, 1);
  await o.db.close();
});

test('kontiMedAdgang: trial and active count; overdue, paused, cancelled, none and deleted accounts do not', async () => {
  const o = await opsaet('a@example.test');
  const status = ['proeve', 'aktiv', 'forfalden', 'pause', 'opsagt', 'ingen'];
  const ider: Record<string, number> = {};
  for (const s of status) {
    const { konto } = await findEllerOpretKonto(o.db, `${s}@example.test`, o.ur.nu());
    ider[s] = konto.id;
    await o.db.query(
      "INSERT INTO abonnement.rettigheder (konto_id, kilde, plan, status, medlemmer_max, skrivebeskyttet, opdateret) VALUES ($1, 'stripe', 'sky-solo', $2, 1, false, now())",
      [konto.id, s],
    );
  }
  await o.db.query("UPDATE abonnement.rettigheder SET status = 'aktiv' WHERE konto_id = $1", [ider['ingen']]);
  await o.db.query('UPDATE konto SET email = NULL, slettet_ved = now() WHERE id = $1', [ider['ingen']]);
  assert.deepEqual((await kontiMedAdgang(o.db)).sort((a, b) => a - b), [ider['proeve']!, ider['aktiv']!].sort((a, b) => a - b));
  await o.db.close();
});

test('a tenant stuck part-way (Sky restarted) is resumed; a failure is reported, not thrown', async () => {
  const o = await opsaet();
  const f = falskFlaade();
  const { slug } = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  f.fejlNaeste('klargoer');
  const r1 = await afstem(deps(o, f));
  assert.deepEqual(r1.fejlede.map((x) => x.slug), [slug]);
  assert.equal((await hentTenant(o.db, slug))!.tilstand, 'bestilt');
  const r2 = await afstem(deps(o, f));
  assert.deepEqual(r2.genoptaget, [slug]);
  assert.equal((await hentTenant(o.db, slug))!.tilstand, 'klar');
  await o.db.close();
});

test('a deletion that stopped half-way is finished', async () => {
  const o = await opsaet();
  const f = falskFlaade({ containere: {}, volumener: [] });
  const { slug } = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  f.volumener.add(slug);
  await o.db.query("UPDATE flaade.tenant SET tilstand = 'afvikles', afvikles = now() WHERE slug = $1", [slug]);
  await afstem(deps(o, f));
  assert.equal((await hentTenant(o.db, slug))!.tilstand, 'slettet');
  assert.equal(f.volumener.size, 0);
  await o.db.close();
});

test('leftovers: removed only for a slettet tombstone; a live tenant and a label with no row are left alone', async () => {
  const o = await opsaet();
  const { konto: b } = await findEllerOpretKonto(o.db, 'b@example.test', o.ur.nu());
  const levende = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  const doed = await bestil(o.db, { kontoId: b.id, driver: 'lokal', nu: o.ur.nu() });
  await o.db.query("UPDATE flaade.tenant SET tilstand = 'klar', klar = now() WHERE slug = $1", [levende.slug]);
  await o.db.query("UPDATE flaade.tenant SET tilstand = 'slettet', slettet = now() WHERE slug = $1", [doed.slug]);
  const f = falskFlaade({ containere: { [levende.slug]: true, 'hus-fremmed0': true }, volumener: [levende.slug, doed.slug, 'hus-fremmed0'] });
  const r = await afstem(deps(o, f));
  assert.deepEqual(r.fjernet, [doed.slug]);
  assert.deepEqual(r.ukendte, ['hus-fremmed0']);
  assert.ok(f.volumener.has(levende.slug) && f.containere.has(levende.slug));
  assert.ok(f.volumener.has('hus-fremmed0'), 'a label with no row is not provably ours');
  assert.ok(!f.volumener.has(doed.slug));
  await o.db.close();
});

test('the loop runs a pass at start, never two at once, and logs a repeated problem only once', async () => {
  const o = await opsaet();
  const f = falskFlaade({ volumener: ['hus-fremmed0'] });
  const linjer: string[] = [];
  let tik: (() => void) | null = null;
  const l = afstemLoekke(deps(o, f), { interval: 15_000, log: (s) => linjer.push(s), saetInterval: (fn) => { tik = fn; return () => { tik = null; }; } });
  await l.foerste;
  assert.equal(f.kald.filter((k) => k === 'maerkede').length, 1);
  tik!();
  tik!();
  await l.vent();
  assert.equal(f.kald.filter((k) => k === 'maerkede').length, 2, 'the second tick was skipped while the first ran');
  assert.equal(linjer.filter((s) => s.includes('hus-fremmed0')).length, 1);
  l.stop();
  assert.equal(tik, null);
  await o.db.close();
});

// --- KC-0198: "Prøv igen" from the sign-up flow -------------------------------------------------------

test('klargoerKonto: carries the account on now; a double click and a second tab still make one tenant and one container', async () => {
  const o = await opsaet('igen@example.test');
  await saetGave(o.db, o.kontoId, 'sky-solo', laesPriser(), o.ur.nu());
  const f = falskFlaade();
  const d = deps(o, f, () => kontiMedAdgang(o.db));
  const slugs = await Promise.all([klargoerKonto(d, o.kontoId), klargoerKonto(d, o.kontoId), klargoerKonto(d, o.kontoId)]);
  assert.equal(new Set(slugs).size, 1);
  assert.equal((await o.db.query('SELECT 1 FROM flaade.tenant')).length, 1);
  assert.equal(f.kald.filter((k) => k.startsWith('klargoer')).length, 1);
  assert.equal((await tenantForEjer(o.db, o.kontoId))?.tilstand, 'klar');
  await o.db.close();
});

test('klargoerKonto: after a failed step it resumes that step on the same tenant', async () => {
  const o = await opsaet('fejl@example.test');
  await saetGave(o.db, o.kontoId, 'sky-solo', laesPriser(), o.ur.nu());
  const f = falskFlaade();
  const d = deps(o, f, () => kontiMedAdgang(o.db));
  f.fejlNaeste('klargoer');
  await assert.rejects(klargoerKonto(d, o.kontoId), /falsk klargoer-fejl/);
  const foer = await tenantForEjer(o.db, o.kontoId);
  assert.equal(foer?.tilstand, 'bestilt');
  assert.ok(foer?.fejl);
  assert.equal(await klargoerKonto(d, o.kontoId), foer!.slug);
  const efter = await tenantForEjer(o.db, o.kontoId);
  assert.equal(efter?.tilstand, 'klar');
  assert.equal(efter?.fejl, null);
  assert.equal((await o.db.query('SELECT 1 FROM flaade.tenant')).length, 1);
  await o.db.close();
});

test('klargoerKonto: an account without a trial or plan gets nothing', async () => {
  const o = await opsaet('gratis@example.test');
  const f = falskFlaade();
  assert.equal(await klargoerKonto(deps(o, f, () => kontiMedAdgang(o.db)), o.kontoId), null);
  assert.equal((await o.db.query('SELECT 1 FROM flaade.tenant')).length, 0);
  await o.db.close();
});

// KC-0216: the lager key lives on the container's tmpfs and is gone after every restart. The reconciler sees a
// new start (Docker's StartedAt) of a klar tenant and pipes the key in again: once per start, never every pass.
async function klarTenant() {
  const o = await opsaet('genstart@example.test');
  await saetGave(o.db, o.kontoId, 'sky-husstand', laesPriser(), o.ur.nu());
  const f = falskFlaade();
  const n = falskNoegler();
  const d = { ...deps(o, f, () => kontiMedAdgang(o.db)), noegler: n };
  const leveret = new Map<string, string>();
  await afstem(d, leveret);
  const t = await tenantForEjer(o.db, o.kontoId);
  assert.equal(t?.tilstand, 'klar');
  const leveringer = () => n.kald.filter((k) => k === `noegle-lever ${t!.slug} clawco-t-${t!.slug}`).length;
  return { o, f, n, d, leveret, slug: t!.slug, leveringer };
}

test('KC-0216: a klar tenant whose container restarted gets its key again, exactly once per start', async () => {
  const k = await klarTenant();
  await afstem(k.d, k.leveret); // first sight after provisioning (or after a Sky restart): one idempotent delivery
  const efterFoerste = k.leveringer();
  const r = await afstem(k.d, k.leveret);
  assert.equal(k.leveringer(), efterFoerste, 'a quiet pass delivers nothing');
  assert.deepEqual(r.genleveret, []);
  k.f.genstart(k.slug);
  const r2 = await afstem(k.d, k.leveret);
  assert.equal(k.leveringer(), efterFoerste + 1);
  assert.deepEqual(r2.genleveret, [k.slug]);
  await afstem(k.d, k.leveret);
  assert.equal(k.leveringer(), efterFoerste + 1, 'the same start is not delivered twice');
  await k.o.db.close();
});

test('KC-0216: a failed delivery is reported and retried on the next pass; a stopped container gets nothing', async () => {
  const k = await klarTenant();
  await afstem(k.d, k.leveret);
  const foer = k.leveringer();
  k.f.genstart(k.slug);
  k.n.fejlNaeste('lever');
  const r = await afstem(k.d, k.leveret);
  assert.deepEqual(r.fejlede.map((f) => f.slug), [k.slug]);
  assert.deepEqual(r.genleveret, []);
  const r2 = await afstem(k.d, k.leveret);
  assert.deepEqual(r2.genleveret, [k.slug]);
  assert.equal(k.leveringer(), foer + 2, 'the failed attempt and the retry');
  await k.f.stop(k.slug);
  const r3 = await afstem(k.d, k.leveret);
  assert.deepEqual(r3.genleveret, []);
  await k.o.db.close();
});

test('KC-0216: the loop keeps what it delivered between passes', async () => {
  const k = await klarTenant();
  let tick: () => void = () => {};
  const l = afstemLoekke(k.d, { interval: 1, log: () => {}, saetInterval: (fn) => { tick = fn; return () => {}; } });
  await l.foerste;
  const efter = k.leveringer();
  tick(); await l.vent();
  assert.equal(k.leveringer(), efter);
  k.f.genstart(k.slug);
  tick(); await l.vent();
  assert.equal(k.leveringer(), efter + 1);
  l.stop();
  await k.o.db.close();
});
