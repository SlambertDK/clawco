import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nyDb, ur, alleRaekker, antal } from './hjaelp.ts';
import { nyAutentifikator } from './autentifikator.ts';
import { sletKonto, sletOversigt, ingenHusstand, ingenAfvikler, type Husstand, type TenantAfvikler, type Tilknytning } from '../../src/konto/slet.ts';
import { anmodLink, bekraeftLink } from '../../src/konto/maillink.ts';
import { opretSession, hentSession, FRISK_MS } from '../../src/konto/session.ts';
import { registreringsMuligheder, gemRegistrering, type Rp } from '../../src/konto/passkey.ts';
import { hentKonto } from '../../src/konto/konto.ts';
import { emailNoegle } from '../../src/konto/graenser.ts';
import { falskPost } from '../../src/delt/post.ts';
import { haendelser, type Haendelse } from '../../src/delt/haendelser.ts';
import type { Database } from '../../src/db/pool.ts';
import { gemProfil } from '../../src/konto/profil.ts';
import { opretEksportLink } from '../../src/konto/eksport.ts';
import { BEHOLDT, kontoHash } from '../../src/konto/beholdt.ts';

const RP: Rp = { id: 'konto.example.test', navn: 'Clawco', origin: 'https://konto.example.test' };
const EMAIL = 'slet.mig@example.test';

function falskAfvikler(): TenantAfvikler & { kald: string[] } {
  const a = { kald: [] as string[], async afprovisioner(t: string) { a.kald.push(t); } };
  return a;
}

function falskHusstand(t: Tilknytning | null): Husstand & { forladt: number[] } {
  const h = { forladt: [] as number[], async forKonto() { return t; }, async forlad(k: number) { h.forladt.push(k); } };
  return h;
}

/** A full account: signed up by link (so loginkode and counters exist), a passkey, two sessions. */
async function fuldKonto(db: Database, nu: Date) {
  const post = falskPost();
  await anmodLink({ db, post, publicUrl: RP.origin }, { email: EMAIL, binding: 'b', ip: '203.0.113.7', nu });
  const t = new URL(post.udbakke[0]!.data['link']!).searchParams.get('t')!;
  const { kontoId } = (await bekraeftLink(db, { token: t, binding: 'b', ip: '203.0.113.7', nu }))!;
  const o = await registreringsMuligheder(db, RP, { id: kontoId, email: EMAIL }, nu);
  assert.ok(await gemRegistrering(db, RP, kontoId, nyAutentifikator().registrer(o, RP.origin), 'Mac', nu));
  const a = await opretSession(db, { kontoId, metode: 'link', enhed: 'Mac', nu });
  const b = await opretSession(db, { kontoId, metode: 'passkey', enhed: 'iPhone', nu });
  return { kontoId, a, b };
}

function deps(db: Database, husstand: Husstand, afvikler: TenantAfvikler) {
  const h = haendelser();
  const set: Haendelse[] = [];
  h.lyt('konto.slettet', (e) => { set.push(e); });
  return { d: { db, husstand, afvikler, haendelser: h }, set };
}

test('deleting needs fresh authentication (a login within the last 5 minutes)', async () => {
  const db = await nyDb();
  const u = ur();
  const { kontoId, a } = await fuldKonto(db, u.nu());
  const afv = falskAfvikler();
  const { d, set } = deps(db, ingenHusstand(), afv);
  u.frem(FRISK_MS + 1);
  assert.equal(await sletKonto(d, { kontoId, session: a.session, emailBekraeftelse: EMAIL, nu: u.nu() }), 'ikke-frisk');
  assert.ok(await hentKonto(db, kontoId));
  assert.equal(afv.kald.length, 0);
  assert.equal(set.length, 0);
});

test('deleting needs the account\'s own email typed (case and spaces forgiven)', async () => {
  const db = await nyDb();
  const u = ur();
  const { kontoId, a } = await fuldKonto(db, u.nu());
  const { d } = deps(db, ingenHusstand(), falskAfvikler());
  assert.equal(await sletKonto(d, { kontoId, session: a.session, emailBekraeftelse: 'en.anden@example.test', nu: u.nu() }), 'forkert-email');
  assert.equal(await sletKonto(d, { kontoId, session: a.session, emailBekraeftelse: '', nu: u.nu() }), 'forkert-email');
  assert.equal(await sletKonto(d, { kontoId, session: a.session, emailBekraeftelse: '  Slet.Mig@Example.test ', nu: u.nu() }), 'slettet');
});

test('an owner\'s deletion deprovisions the tenant exactly once, and nothing of the account remains', async () => {
  const db = await nyDb();
  const u = ur();
  const { kontoId, a, b } = await fuldKonto(db, u.nu());
  const afv = falskAfvikler();
  const husstand = falskHusstand({ tenantId: 'tenant-42', rolle: 'ejer', medlemmer: ['mor@example.test'] });
  const { d, set } = deps(db, husstand, afv);
  assert.equal(await sletKonto(d, { kontoId, session: a.session, emailBekraeftelse: EMAIL, nu: u.nu() }), 'slettet');
  assert.deepEqual(afv.kald, ['tenant-42']);
  assert.deepEqual(husstand.forladt, []);
  for (const t of ['session', 'passkey', 'loginkode', 'udfordring']) assert.equal(await antal(db, t), 0, `${t} er ikke tom`);
  // Counters keyed by the email's hash go too (the IP's counter is about the address, not the person).
  assert.deepEqual(await db.query('SELECT 1 FROM graense WHERE noegle = $1', [emailNoegle(EMAIL)]), []);
  assert.equal(await hentKonto(db, kontoId), null);
  assert.equal(await hentSession(db, a.token, u.nu()), null);
  assert.equal(await hentSession(db, b.token, u.nu()), null);
  const alt = await alleRaekker(db);
  assert.ok(!alt.includes('slet.mig'), 'emailen findes stadig et sted');
  assert.equal(set.length, 1);
  assert.equal(set[0]?.kontoId, kontoId);
  // Deleting again finds nothing.
  assert.equal(await sletKonto(d, { kontoId, session: a.session, emailBekraeftelse: EMAIL, nu: u.nu() }), 'ukendt');
  assert.deepEqual(afv.kald, ['tenant-42']);
});

test('a household member\'s deletion only leaves the household; the tenant stays', async () => {
  const db = await nyDb();
  const u = ur();
  const { kontoId, a } = await fuldKonto(db, u.nu());
  const afv = falskAfvikler();
  const husstand = falskHusstand({ tenantId: 'tenant-42', rolle: 'medlem', medlemmer: [] });
  const { d } = deps(db, husstand, afv);
  assert.equal(await sletKonto(d, { kontoId, session: a.session, emailBekraeftelse: EMAIL, nu: u.nu() }), 'slettet');
  assert.deepEqual(afv.kald, []);
  assert.deepEqual(husstand.forladt, [kontoId]);
});

test('if deprovisioning fails, the account stays whole (retry later), and no event is sent', async () => {
  const db = await nyDb();
  const u = ur();
  const { kontoId, a } = await fuldKonto(db, u.nu());
  const husstand = falskHusstand({ tenantId: 'tenant-42', rolle: 'ejer', medlemmer: [] });
  const { d, set } = deps(db, husstand, ingenAfvikler());
  await assert.rejects(sletKonto(d, { kontoId, session: a.session, emailBekraeftelse: EMAIL, nu: u.nu() }));
  assert.ok(await hentKonto(db, kontoId));
  assert.ok(await hentSession(db, a.token, u.nu()));
  assert.equal(set.length, 0);
});

test('the overview before deleting warns an owner with the members who lose access', async () => {
  const db = await nyDb();
  const u = ur();
  const { kontoId } = await fuldKonto(db, u.nu());
  const ejer = await sletOversigt({ db, husstand: falskHusstand({ tenantId: 't', rolle: 'ejer', medlemmer: ['mor@example.test', 'barn@example.test'] }) }, kontoId);
  assert.deepEqual(ejer, { email: EMAIL, rolle: 'ejer', medlemmer: ['mor@example.test', 'barn@example.test'] });
  const alene = await sletOversigt({ db, husstand: ingenHusstand() }, kontoId);
  assert.deepEqual(alene, { email: EMAIL, rolle: null, medlemmer: [] });
});

test('KC-0178: a completed deletion sends one receipt to the address it had; a failed mail never undoes it', async () => {
  const db = await nyDb();
  const u = ur();
  const { kontoId, a } = await fuldKonto(db, u.nu());
  const post = falskPost();
  const { d } = deps(db, ingenHusstand(), falskAfvikler());
  u.frem(FRISK_MS + 1);
  assert.equal(await sletKonto({ ...d, post }, { kontoId, session: a.session, emailBekraeftelse: EMAIL, nu: u.nu() }), 'ikke-frisk');
  assert.equal(post.udbakke.length, 0, 'intet sendt når intet er slettet');
  const frisk = await opretSession(db, { kontoId, metode: 'link', enhed: 'Mac', nu: u.nu() });
  assert.equal(await sletKonto({ ...d, post }, { kontoId, session: frisk.session, emailBekraeftelse: EMAIL, nu: u.nu() }), 'slettet');
  assert.deepEqual(post.udbakke.map((b) => [b.til, b.skabelon]), [[EMAIL, 'konto-slettet']]);

  const db2 = await nyDb();
  const k2 = await fuldKonto(db2, u.nu());
  const fejler = falskPost();
  fejler.fejl = true;
  const { d: d2 } = deps(db2, ingenHusstand(), falskAfvikler());
  assert.equal(await sletKonto({ ...d2, post: fejler }, { kontoId: k2.kontoId, session: k2.a.session, emailBekraeftelse: EMAIL, nu: u.nu() }), 'slettet');
  assert.equal(await hentKonto(db2, k2.kontoId), null);
});

test('KC-0206: deletion takes the export links and the profile with it, and writes one receipt (hash, time, role, what is kept and why)', async () => {
  const db = await nyDb();
  const u = ur();
  const { kontoId, a } = await fuldKonto(db, u.nu());
  await gemProfil(db, kontoId, { land: 'SE', sprog: 'en', vilkaar: '2026-10', privatliv: '2026-10', nu: u.nu() });
  await db.query('UPDATE konto SET tilmelding_ms = 4200 WHERE id = $1', [kontoId]);
  await opretEksportLink(db, kontoId, u.nu());
  const post = falskPost();
  const { d } = deps(db, falskHusstand({ tenantId: 'tenant-42', rolle: 'ejer', medlemmer: [] }), falskAfvikler());
  assert.equal(await sletKonto({ ...d, post }, { kontoId, session: a.session, emailBekraeftelse: EMAIL, nu: u.nu() }), 'slettet');
  assert.equal(await antal(db, 'eksportlink'), 0);
  const [k] = await db.query<Record<string, unknown>>('SELECT land, sprog, tilmelding_ms, email FROM konto WHERE id = $1', [kontoId]);
  assert.deepEqual(k, { land: null, sprog: null, tilmelding_ms: null, email: null });
  const kv = await db.query<{ konto_hash: string; slettet_ved: Date; rolle: string; beholdt: unknown; kopier_vaek: Date }>('SELECT * FROM sletkvittering');
  assert.equal(kv.length, 1);
  assert.equal(kv[0]!.konto_hash, kontoHash(kontoId));
  assert.equal(new Date(kv[0]!.slettet_ved).toISOString(), u.nu().toISOString());
  assert.equal(kv[0]!.rolle, 'ejer');
  assert.deepEqual(kv[0]!.beholdt, BEHOLDT);
  assert.equal(new Date(kv[0]!.kopier_vaek).getTime() - u.nu().getTime(), 30 * 86_400_000);
  assert.ok(!JSON.stringify(kv).includes('slet.mig'), 'the receipt names nobody');
  // The receipt mail goes in the account's own language and says when the backups are gone.
  assert.deepEqual(post.udbakke.map((b) => [b.skabelon, b.sprog, b.data['dage']]), [['konto-slettet', 'en', '30']]);
});

test('KC-0206: a member leaving and an account without a Clawco get their own receipt role', async () => {
  for (const [h, rolle] of [[falskHusstand({ tenantId: 't', rolle: 'medlem', medlemmer: [] }), 'medlem'], [ingenHusstand(), 'alene']] as const) {
    const db = await nyDb();
    const u = ur();
    const { kontoId, a } = await fuldKonto(db, u.nu());
    const { d } = deps(db, h, falskAfvikler());
    assert.equal(await sletKonto(d, { kontoId, session: a.session, emailBekraeftelse: EMAIL, nu: u.nu() }), 'slettet');
    assert.deepEqual((await db.query<{ rolle: string }>('SELECT rolle FROM sletkvittering')).map((r) => r.rolle), [rolle]);
  }
});
