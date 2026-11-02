// KC-0206, the proof: an owner with seeded data in every store Sky has — account rows, a passkey, sessions, a login
// code and a gateway code, an export link, the profile, a Stripe customer with a subscription and an invoice, a tenant
// (container + volume with content), its data key, a nightly encrypted backup of the tenant and of Sky's own database,
// a route in the gateway — deletes the account. The clock then runs 31 days with the real daily key purge and the
// real nightly backup job. A full inventory then finds nothing of the person outside the kept list (konto/beholdt.ts):
// every table of every schema (found from the catalogue, so a table added later is scanned too), the fleet, the copy
// store (every remaining copy opened and read), the key, the route, Stripe and every log line written meanwhile.
// Fakes and temp state only; no real provider.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { stativ, startProeve, EMAIL } from '../abonnement/stativ.ts';
import { nyAutentifikator } from './autentifikator.ts';
import { ring as nyRing } from '../hemmeligheder/hjaelp.ts';
import { falskFlaade, type FalskFlaade } from '../fleet/hjaelp.ts';
import { falskNode } from '../drift/backup/hjaelp.ts';
import { anmodLink, bekraeftLink } from '../../src/konto/maillink.ts';
import { registreringsMuligheder, gemRegistrering, type Rp } from '../../src/konto/passkey.ts';
import { opretSession } from '../../src/konto/session.ts';
import { gemProfil } from '../../src/konto/profil.ts';
import { opretEksportLink } from '../../src/konto/eksport.ts';
import { sletKonto, ingenHusstand } from '../../src/konto/slet.ts';
import { BEHOLDT, KOPIER_DAGE, kontoHash } from '../../src/konto/beholdt.ts';
import { synkKunde } from '../../src/abonnement/synk.ts';
import { opsigVedSletning } from '../../src/abonnement/kunde.ts';
import { bestil, laase, tenanterTilKopi, hentTenant } from '../../src/fleet/tilstand.ts';
import { provisioner } from '../../src/fleet/provisioner.ts';
import { flaadeAfvikler, flaadeHusstand } from '../../src/fleet/afvikler.ts';
import type { FlaadeNoegler } from '../../src/fleet/noegler.ts';
import { opretTenantNoegle, markerSlettet, destruerUdloebne, slettedeNoegler } from '../../src/hemmeligheder/tenantnoegle.ts';
import { kopiNoegler } from '../../src/hemmeligheder/kopi.ts';
import { falskKopiLager } from '../../src/drift/backup/lager.ts';
import { koerNat, praefiks, DB } from '../../src/drift/backup/koer.ts';
import { gendan, aabnDbDump } from '../../src/drift/backup/gendan.ts';
import type { KopiDeps } from '../../src/drift/backup/typer.ts';
import { ruteTabel } from '../../src/gateway/rute.ts';
import { kant } from '../../src/server.ts';
import { haendelser } from '../../src/delt/haendelser.ts';
import { falskPost } from '../../src/delt/post.ts';
import type { Database } from '../../src/db/pool.ts';

const RP: Rp = { id: 'konto.example.test', navn: 'Clawco', origin: 'https://konto.example.test' };
/** Content only the person's Clawco holds: it must never surface anywhere once the account is gone. */
const INDHOLD = 'HEMMELIG-DAGBOG-7f3a: tandlæge torsdag';
const DAG = 86_400_000;

/** Every row of every table of every schema, found from the catalogue. */
async function alleTabeller(db: Database): Promise<{ navn: string; raekker: Record<string, unknown>[] }[]> {
  const t = await db.query<{ s: string; t: string }>(
    "SELECT table_schema AS s, table_name AS t FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY 1, 2");
  const ud = [];
  for (const { s, t: navn } of t) {
    const fuldt = s === 'public' ? navn : `${s}.${navn}`;
    ud.push({ navn: fuldt, raekker: await db.query<Record<string, unknown>>(`SELECT * FROM ${s === 'public' ? '' : `${s}.`}${navn}`) });
  }
  return ud;
}

/** Findings: places that still hold the person. Empty = nothing left outside the kept list. */
async function inventar(o: { db: Database; kontoId: number; slug: string; flaade: FalskFlaade; node: ReturnType<typeof falskNode>; kopi: KopiDeps; log: string[] }): Promise<string[]> {
  const fund: string[] = [];
  const beholdt = new Set(BEHOLDT.map((b) => b.sted));
  const forbudt = (tekst: string): boolean => tekst.toLowerCase().includes(EMAIL) || tekst.includes(INDHOLD);
  for (const { navn, raekker } of await alleTabeller(o.db)) {
    for (const r of raekker) {
      const json = JSON.stringify(r, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v));
      if (forbudt(json)) fund.push(`${navn}: mail eller indhold`);
      const henviser = Object.entries(r).some(([k, v]) =>
        ((k === 'konto_id' || k === 'ejer_konto_id' || (navn === 'konto' && k === 'id')) && Number(v) === o.kontoId) || v === o.slug);
      if (henviser && !beholdt.has(navn)) fund.push(`${navn}: henviser til kontoen eller dens Clawco`);
    }
  }
  if (o.flaade.containere.has(o.slug)) fund.push('flåde: beholder');
  if (o.flaade.volumener.has(o.slug)) fund.push('flåde: disk');
  if (o.node.levende.has(o.slug)) fund.push('flåde: diskens indhold');
  if ((await o.kopi.lager.liste(praefiks(o.slug))).length) fund.push('kopilager: Clawcoens kopier');
  for (const obj of await o.kopi.lager.liste(praefiks(DB))) {
    const id = obj.noegle.slice(praefiks(DB).length).replace(/\.ckb$/, '');
    const { dump } = await aabnDbDump(o.kopi, id);
    if (forbudt(dump.toString('utf8'))) fund.push(`kopilager: databasekopi ${id} har mail eller indhold`);
  }
  const [n] = await o.db.query<{ kuvert: unknown }>('SELECT kuvert FROM hemmeligheder.tenant_noegle WHERE tenant = $1', [o.slug]);
  if (n?.kuvert) fund.push('nøgle: Clawcoens datanøgle findes');
  if (await ruteTabel({ db: o.db }).find(o.slug)) fund.push('gateway: rute');
  if (o.log.some(forbudt)) fund.push('log: mail eller indhold');
  return fund;
}

test('KC-0206 proof: delete an owner, run 31 days, and a full inventory finds nothing outside the kept list', async () => {
  // --- Seed every store --------------------------------------------------------------------------------------
  const s = await stativ(); // PGlite + fake Stripe with the prices set up, the account and its Stripe customer
  const { db, klient, priser } = s;
  let t = new Date('2026-11-01T05:00:00Z').getTime();
  const nu = () => new Date(t);
  const r = nyRing();
  const log: string[] = [];
  for (const m of ['log', 'error', 'warn'] as const) mock.method(console, m, (...a: unknown[]) => { log.push(a.map(String).join(' ')); });
  try {
    const post = falskPost();
    await anmodLink({ db, post, publicUrl: RP.origin }, { email: EMAIL, binding: 'b', ip: '203.0.113.7', nu: nu() });
    const lt = new URL(post.udbakke[0]!.data['link']!).searchParams.get('t')!;
    const { kontoId } = (await bekraeftLink(db, { token: lt, binding: 'b', ip: '203.0.113.7', nu: nu() }))!;
    assert.equal(kontoId, s.kontoId);
    const opr = await registreringsMuligheder(db, RP, { id: kontoId, email: EMAIL }, nu());
    assert.ok(await gemRegistrering(db, RP, kontoId, nyAutentifikator().registrer(opr, RP.origin), 'Mac', nu()));
    await gemProfil(db, kontoId, { land: 'DK', sprog: 'da', vilkaar: '2026-10', privatliv: '2026-10', nu: nu() });
    await opretEksportLink(db, kontoId, nu());
    await startProeve(s);
    await synkKunde(db, klient, priser, { stripeKunde: s.kunde, kontoId, grund: 'test', haendelseId: null, nu: nu() });
    klient.tilfoejFaktura({ id: 'in_1', kunde: s.kunde, nummer: 'A-1', oprettet: nu(), beloeb: 7900, valuta: 'dkk', status: 'paid', url: null });

    // The tenant: container + volume with content, its data key, the route, a one-time gateway code.
    const flaade = falskFlaade();
    const node = falskNode();
    const fl = { ...flaade, slet: async (id: string) => { await flaade.slet(id); node.levende.delete(id); } };
    const noegler: FlaadeNoegler = {
      sikr: async (slug) => { await opretTenantNoegle(db, r, slug, nu()); },
      lever: async () => {},
      markerSlettet: async (slug) => { await markerSlettet(db, slug, nu()); },
    };
    const laas = laase();
    const { slug } = await bestil(db, { kontoId, driver: 'lokal', nu: nu() });
    await provisioner({ db, flaade: fl, noegler, billede: 'clawco:test', laas, nu, vent: async () => {}, sundhed: async () => ({ ok: true, sha: 'abc' }), iGateway: async () => {} }, slug);
    node.levende.set(slug, { 'data/rum/dagen/chat.jsonl': `{"tekst":"${INDHOLD}"}\n`, 'data/husstand.json': `{"personer":[{"login":"${EMAIL}"}]}` });
    const sess = await opretSession(db, { kontoId, metode: 'passkey', enhed: 'Mac', nu: nu() });
    await db.query('INSERT INTO gateway.kode (hash, konto_id, session_id, slug, naeste, oprettet, udloeber) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [createHash('sha256').update('kode').digest('hex'), kontoId, sess.session.id, slug, '/', nu().toISOString(), new Date(t + 60_000).toISOString()]);
    assert.ok(await ruteTabel({ db }).find(slug), 'the tenant is routed');

    // Backups: the real nightly job, sealed with the real envelope keys; Sky's "pg_dump" is every row as JSON.
    const dump = async () => Buffer.from(`PGDMP${JSON.stringify(await alleTabeller(db), (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v))}`);
    const kopi: KopiDeps = {
      db, lager: falskKopiLager(), node, noegler: kopiNoegler({ db, ring: r }),
      dump: { dump, tjek: async () => 1, gendan: async () => {} },
      tenanter: () => tenanterTilKopi(db), slettedeNoegler: () => slettedeNoegler(db), nu,
      sundhed: async () => ({ ok: true, sha: 'abc' }), vent: async () => {},
    } as KopiDeps;
    const nat = await koerNat(kopi);
    assert.equal(nat.ok, 2, 'the tenant and the database were copied');

    // The scan is real: before the deletion it finds the person everywhere.
    const foer = await inventar({ db, kontoId, slug, flaade, node, kopi, log });
    for (const sted of ['konto: mail eller indhold', 'flåde: disk', 'kopilager: Clawcoens kopier', 'nøgle: Clawcoens datanøgle findes', 'gateway: rute', 'eksportlink: henviser til kontoen eller dens Clawco', 'session: henviser til kontoen eller dens Clawco']) {
      assert.ok(foer.includes(sted), `before: ${sted} (found: ${foer.join('; ')})`);
    }
    assert.ok(foer.some((f) => f.startsWith('kopilager: databasekopi')), 'the database copy holds the mail before');

    // --- Delete, as the owner, fresh, with the email typed ------------------------------------------------------
    t += 60_000;
    const ruter = ruteTabel({ db });
    const tomt: string[] = [];
    const afprov = { db, flaade: fl, noegler, laas, nu, udAfGateway: kant(db, ruter).udAfGateway, toem: async (sl: string) => { tomt.push(sl); node.levende.set(sl, {}); } };
    const h = haendelser();
    opsigVedSletning(h, { db, klient });
    const kvittering = falskPost();
    const frisk = await opretSession(db, { kontoId, metode: 'passkey', enhed: 'Mac', nu: nu() });
    const husstand = flaadeHusstand({ db, basedomain: 'clawco.example', reserve: ingenHusstand() });
    assert.equal(await sletKonto({ db, husstand, afvikler: flaadeAfvikler(afprov), haendelser: h, post: kvittering }, { kontoId, session: frisk.session, emailBekraeftelse: EMAIL, nu: nu() }), 'slettet');
    await new Promise((res) => setTimeout(res, 20)); // the Stripe cancel runs on the event
    assert.deepEqual(tomt, [slug], 'the tenant\'s own Slet alt ran first');
    assert.equal((await hentTenant(db, slug))!.tilstand, 'slettet');
    assert.deepEqual((await klient.listAbonnementer(s.kunde)).map((a) => a.status), ['canceled']);
    assert.deepEqual(kvittering.udbakke.map((b) => [b.til, b.skabelon]), [[EMAIL, 'konto-slettet']], 'one receipt mail');

    // --- 31 days: the daily key purge and the nightly copies, as Sky runs them -----------------------------------
    for (let dag = 1; dag <= 31; dag++) {
      t = new Date('2026-11-01T05:00:00Z').getTime() + dag * DAG;
      await destruerUdloebne(db, nu());
      await koerNat(kopi);
    }

    // --- The inventory -----------------------------------------------------------------------------------------
    assert.deepEqual(await inventar({ db, kontoId, slug, flaade, node, kopi, log }), []);
    await assert.rejects(gendan(kopi, slug), 'a restore of the deleted tenant is refused after the purge date');
    const [kv] = await db.query<{ konto_hash: string; rolle: string; kopier_vaek: Date }>('SELECT konto_hash, rolle, kopier_vaek FROM sletkvittering');
    assert.equal(kv!.konto_hash, kontoHash(kontoId));
    assert.equal(kv!.rolle, 'ejer');
    assert.ok(new Date(kv!.kopier_vaek).getTime() <= nu().getTime(), 'the receipt\'s backup date has passed');
    assert.equal(new Date(kv!.kopier_vaek).getTime(), new Date('2026-11-01T05:01:00Z').getTime() + KOPIER_DAGE * DAG);
  } finally {
    mock.restoreAll();
  }
  await db.close();
});
