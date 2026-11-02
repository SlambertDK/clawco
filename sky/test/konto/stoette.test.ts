// KC-0188: "Lad support se med" in Sky — the grant. Invariant (D15): no Clawco staff identity reaches a tenant except
// through an unexpired grant its owner created; a grant is for one tenant, at most 24 hours, ends by clock or revoke;
// only a staff account (personale) logged in by passkey can use it, and only the first one that opened it; every use
// is logged with the staff account's id; on any doubt (clock, database, missing grant) the answer is no.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nyDb, ur, type Ur } from './hjaelp.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { opretSession } from '../../src/konto/session.ts';
import { bestil, skift } from '../../src/fleet/tilstand.ts';
import type { Database } from '../../src/db/pool.ts';
import { falskPost } from '../../src/delt/post.ts';
import {
  STOETTE_TIMER, STOETTE_MAKS_TIMER, GRUND_MAKS, givStoette, tilbagekaldStoette, annullerStoette, aabnStoette, stoetteGyldig,
  sessionStartet, erPersonale, aktiveStoetter, noterUdloebne, stoetteHaendelser, sendStoetteKvittering,
} from '../../src/konto/stoette.ts';

const TIME = 3_600_000;

type Hvem = { id: number; sessionId: number };
type Stativ = { db: Database; u: Ur; slug: string; andenSlug: string; ejer: Hvem; anden: Hvem; personale: Hvem; personale2: Hvem; linkPersonale: Hvem; kunde: Hvem };

async function stativ(): Promise<Stativ> {
  const db = await nyDb();
  const u = ur();
  const person = async (email: string, o: { personale?: boolean; passkey?: boolean; metode?: 'passkey' | 'link' } = {}): Promise<Hvem> => {
    const { konto } = await findEllerOpretKonto(db, email, u.nu());
    if (o.passkey ?? o.personale) await db.query("INSERT INTO passkey (konto_id, credential_id, public_key, taeller, navn, oprettet) VALUES ($1, $2, 'pk', 0, 'nøgle', now())", [konto.id, `cred-${konto.id}`]);
    if (o.personale) await db.query('UPDATE konto SET personale = true WHERE id = $1', [konto.id]);
    const { session } = await opretSession(db, { kontoId: konto.id, metode: o.metode ?? 'passkey', enhed: '', nu: u.nu() });
    return { id: konto.id, sessionId: session.id };
  };
  const ejer = await person('ejer@example.test');
  const anden = await person('anden@example.test');
  const personale = await person('personale@example.test', { personale: true });
  const personale2 = await person('personale2@example.test', { personale: true });
  const linkPersonale = await person('link-personale@example.test', { personale: true, metode: 'link' });
  const kunde = await person('kunde@example.test', { passkey: true });
  const a = await bestil(db, { kontoId: ejer.id, driver: 'lokal', nu: u.nu(), nySlug: () => 'hus-abcdefgh' });
  await skift(db, a.slug, ['bestilt'], 'klar', u.nu(), { adresse: 'http://127.0.0.1:1' });
  const b = await bestil(db, { kontoId: anden.id, driver: 'lokal', nu: u.nu(), nySlug: () => 'hus-bbbbbbbb' });
  await skift(db, b.slug, ['bestilt'], 'klar', u.nu(), { adresse: 'http://127.0.0.1:2' });
  return { db, u, slug: a.slug, andenSlug: b.slug, ejer, anden, personale, personale2, linkPersonale, kunde };
}

async function givet(s: Stativ, timer: number = 1): Promise<number> {
  const r = await givStoette(s.db, { slug: s.slug, kontoId: s.ejer.id, timer, grund: 'Mail viser ingenting', nu: s.u.nu() });
  assert.ok(r.ok, 'the owner turns it on');
  return r.adgang.id;
}

const gyldig = (s: Stativ, id: number, hvem: Hvem = s.personale, slug = s.slug) =>
  stoetteGyldig(s.db, { id, slug, personaleKontoId: hvem.id, sessionId: hvem.sessionId, nu: s.u.nu() });

test('the durations are 1, 4 and 24 hours, and 24 is the most (one constant)', () => {
  assert.deepEqual([...STOETTE_TIMER], [1, 4, 24]);
  assert.equal(STOETTE_MAKS_TIMER, 24);
  assert.equal(Math.max(...STOETTE_TIMER), STOETTE_MAKS_TIMER);
  assert.equal(GRUND_MAKS, 120);
});

test('off by default: a fresh tenant has no grant and nothing opens it', async () => {
  const s = await stativ();
  assert.deepEqual(await aktiveStoetter(s.db, s.u.nu()), []);
  assert.equal(await gyldig(s, 1), null);
  await s.db.close();
});

test('only the owner turns it on; another account (even another owner) gets ikke-ejer and nothing is written', async () => {
  const s = await stativ();
  for (const hvem of [s.anden, s.personale, s.kunde]) {
    const r = await givStoette(s.db, { slug: s.slug, kontoId: hvem.id, timer: 1, grund: '', nu: s.u.nu() });
    assert.deepEqual(r, { ok: false, grund: 'ikke-ejer' });
  }
  const [n] = await s.db.query<{ n: number }>('SELECT count(*)::int AS n FROM stoette_adgang');
  assert.equal(n!.n, 0);
  const r = await givStoette(s.db, { slug: s.slug, kontoId: s.ejer.id, timer: 4, grund: '  Mail viser ingenting  ', nu: s.u.nu() });
  assert.ok(r.ok);
  assert.equal(r.adgang.slug, s.slug);
  assert.equal(r.adgang.grund, 'Mail viser ingenting');
  assert.equal(r.adgang.udloeber.getTime() - r.adgang.givet.getTime(), 4 * TIME);
  assert.deepEqual((await stoetteHaendelser(s.db, r.adgang.id)).map((h) => [h.slags, h.kontoId]), [['givet', s.ejer.id]]);
  await s.db.close();
});

test('durations are capped: only 1, 4 or 24 hours; a reason is one line of at most 120 characters', async () => {
  const s = await stativ();
  for (const timer of [0, 2, 25, 48, -1, 1.5, '1', null, undefined, Number.NaN]) {
    const r = await givStoette(s.db, { slug: s.slug, kontoId: s.ejer.id, timer, grund: '', nu: s.u.nu() });
    assert.deepEqual(r, { ok: false, grund: 'ugyldig-tid' }, String(timer));
  }
  for (const grund of ['x'.repeat(121), 'to\nlinjer', 'tab\there', 42]) {
    const r = await givStoette(s.db, { slug: s.slug, kontoId: s.ejer.id, timer: 1, grund, nu: s.u.nu() });
    assert.deepEqual(r, { ok: false, grund: 'ugyldig-grund' }, String(grund).slice(0, 20));
  }
  const r = await givStoette(s.db, { slug: s.slug, kontoId: s.ejer.id, timer: 24, nu: s.u.nu() });
  assert.ok(r.ok && r.adgang.udloeber.getTime() - r.adgang.givet.getTime() === 24 * TIME && r.adgang.grund === '');
  // The database refuses a longer grant even if the code were wrong.
  await assert.rejects(s.db.query("INSERT INTO stoette_adgang (tenant_id, givet_af, givet, udloeber) VALUES ($1, $2, now(), now() + interval '25 hours')", [s.slug, s.ejer.id]));
  await s.db.close();
});

test('staff only: a customer, a staff account without passkey login (mail link) and an unknown session are refused', async () => {
  const s = await stativ();
  const id = await givet(s);
  assert.equal(await aabnStoette(s.db, { id, personaleKontoId: s.kunde.id, sessionId: s.kunde.sessionId, nu: s.u.nu() }), null, 'a customer with a passkey is not staff');
  assert.equal(await aabnStoette(s.db, { id, personaleKontoId: s.linkPersonale.id, sessionId: s.linkPersonale.sessionId, nu: s.u.nu() }), null, 'magic-link-only staff session refused');
  assert.equal(await aabnStoette(s.db, { id, personaleKontoId: s.personale.id, sessionId: s.anden.sessionId, nu: s.u.nu() }), null, 'someone else\'s session');
  assert.equal(await erPersonale(s.db, { kontoId: s.kunde.id, sessionId: s.kunde.sessionId, nu: s.u.nu() }), false);
  assert.equal(await erPersonale(s.db, { kontoId: s.linkPersonale.id, sessionId: s.linkPersonale.sessionId, nu: s.u.nu() }), false);
  assert.equal(await erPersonale(s.db, { kontoId: s.personale.id, sessionId: s.personale.sessionId, nu: s.u.nu() }), true);
  const a = await aabnStoette(s.db, { id, personaleKontoId: s.personale.id, sessionId: s.personale.sessionId, nu: s.u.nu() });
  assert.equal(a?.personaleKontoId, s.personale.id);
  assert.ok(await gyldig(s, id));
  assert.equal(await gyldig(s, id, s.linkPersonale), null);
  assert.equal(await gyldig(s, id, s.kunde), null);
  await s.db.close();
});

test('the first staff member to open a grant is the only one who can use it', async () => {
  const s = await stativ();
  const id = await givet(s);
  assert.ok(await aabnStoette(s.db, { id, personaleKontoId: s.personale.id, sessionId: s.personale.sessionId, nu: s.u.nu() }));
  assert.equal(await aabnStoette(s.db, { id, personaleKontoId: s.personale2.id, sessionId: s.personale2.sessionId, nu: s.u.nu() }), null);
  assert.equal(await gyldig(s, id, s.personale2), null);
  assert.ok(await gyldig(s, id, s.personale));
  await s.db.close();
});

test('expiry is by clock: one millisecond after udloeber the grant opens nothing, and the expiry is logged once', async () => {
  const s = await stativ();
  const id = await givet(s, 1);
  await aabnStoette(s.db, { id, personaleKontoId: s.personale.id, sessionId: s.personale.sessionId, nu: s.u.nu() });
  s.u.frem(TIME - 1);
  assert.ok(await gyldig(s, id));
  s.u.frem(1);
  assert.equal(await gyldig(s, id), null);
  assert.equal(await aabnStoette(s.db, { id, personaleKontoId: s.personale.id, sessionId: s.personale.sessionId, nu: s.u.nu() }), null);
  assert.deepEqual(await aktiveStoetter(s.db, s.u.nu()), []);
  assert.deepEqual((await noterUdloebne(s.db, s.u.nu())).map((a) => a.id), [id]);
  assert.deepEqual(await noterUdloebne(s.db, s.u.nu()), [], 'once');
  assert.deepEqual((await stoetteHaendelser(s.db, id)).map((h) => h.slags), ['givet', 'udloebet']);
  await s.db.close();
});

test('revoke ends it at once; only the owner revokes; a new grant replaces the old one', async () => {
  const s = await stativ();
  const id = await givet(s);
  await aabnStoette(s.db, { id, personaleKontoId: s.personale.id, sessionId: s.personale.sessionId, nu: s.u.nu() });
  assert.equal(await tilbagekaldStoette(s.db, { slug: s.slug, kontoId: s.anden.id, nu: s.u.nu() }), null, 'not the owner');
  assert.ok(await gyldig(s, id));
  assert.deepEqual(await tilbagekaldStoette(s.db, { slug: s.slug, kontoId: s.ejer.id, nu: s.u.nu() }), [id]);
  assert.equal(await gyldig(s, id), null);
  assert.deepEqual(await tilbagekaldStoette(s.db, { slug: s.slug, kontoId: s.ejer.id, nu: s.u.nu() }), [], 'nothing left to revoke');
  const ny = await givet(s, 4);
  const nyere = await givet(s, 1);
  assert.notEqual(ny, nyere);
  assert.deepEqual((await aktiveStoetter(s.db, s.u.nu())).map((a) => a.id), [nyere], 'one grant per tenant at a time');
  assert.deepEqual((await stoetteHaendelser(s.db, id)).map((h) => [h.slags, h.kontoId]), [['givet', s.ejer.id], ['tilbagekaldt', s.ejer.id]]);
  await annullerStoette(s.db, nyere, s.u.nu());
  assert.deepEqual(await aktiveStoetter(s.db, s.u.nu()), []);
  await s.db.close();
});

test('one tenant only: a grant for A opens nothing on B', async () => {
  const s = await stativ();
  const id = await givet(s);
  await aabnStoette(s.db, { id, personaleKontoId: s.personale.id, sessionId: s.personale.sessionId, nu: s.u.nu() });
  assert.ok(await gyldig(s, id));
  assert.equal(await gyldig(s, id, s.personale, s.andenSlug), null);
  await s.db.close();
});

test('every session start is logged with the staff account\'s id', async () => {
  const s = await stativ();
  const id = await givet(s);
  await aabnStoette(s.db, { id, personaleKontoId: s.personale.id, sessionId: s.personale.sessionId, nu: s.u.nu() });
  await sessionStartet(s.db, { id, personaleKontoId: s.personale.id, nu: s.u.nu() });
  await sessionStartet(s.db, { id, personaleKontoId: s.personale.id, nu: s.u.nu() });
  assert.deepEqual((await stoetteHaendelser(s.db, id)).map((h) => [h.slags, h.kontoId]), [['givet', s.ejer.id], ['aabnet', s.personale.id], ['aabnet', s.personale.id]]);
  await s.db.close();
});

test('fail closed: a staff session that ends, a staff flag taken away, a tenant that leaves the gateway, a bad clock', async () => {
  const s = await stativ();
  const id = await givet(s);
  await aabnStoette(s.db, { id, personaleKontoId: s.personale.id, sessionId: s.personale.sessionId, nu: s.u.nu() });
  assert.ok(await gyldig(s, id));
  await assert.rejects(stoetteGyldig(s.db, { id, slug: s.slug, personaleKontoId: s.personale.id, sessionId: s.personale.sessionId, nu: new Date(Number.NaN) }), /ur/);
  await s.db.query('UPDATE konto SET personale = false WHERE id = $1', [s.personale.id]);
  assert.equal(await gyldig(s, id), null);
  await s.db.query('UPDATE konto SET personale = true WHERE id = $1', [s.personale.id]);
  await s.db.query("UPDATE flaade.tenant SET tilstand = 'afvikles' WHERE slug = $1", [s.slug]);
  assert.equal(await gyldig(s, id), null);
  await s.db.query("UPDATE flaade.tenant SET tilstand = 'klar' WHERE slug = $1", [s.slug]);
  await s.db.query('DELETE FROM session WHERE id = $1', [s.personale.sessionId]);
  assert.equal(await gyldig(s, id), null);
  await s.db.close();
  await assert.rejects(stoetteGyldig(s.db, { id, slug: s.slug, personaleKontoId: s.personale.id, sessionId: s.personale.sessionId, nu: new Date() }), 'a database that cannot answer is an error, never a yes');
});

test('the notice mail goes to the owner\'s own address when a grant starts (template stoette-startet, fake mail client)', async () => {
  const s = await stativ();
  const post = falskPost();
  const r = await givStoette(s.db, { slug: s.slug, kontoId: s.ejer.id, timer: 4, grund: '', nu: s.u.nu() });
  assert.ok(r.ok);
  await sendStoetteKvittering({ db: s.db, post }, s.ejer.id, { timer: 4, udloeber: r.adgang.udloeber });
  assert.equal(post.udbakke.length, 1);
  const [b] = post.udbakke;
  assert.equal(b!.til, 'ejer@example.test');
  assert.equal(b!.skabelon, 'stoette-startet');
  // 10.00 UTC + 4 h = 14.00 UTC = 15.00 in Copenhagen (CET on 31 October 2026).
  assert.deepEqual(b!.data, { timer: '4', til: '15.00' });
  post.fejl = true;
  await assert.rejects(sendStoetteKvittering({ db: s.db, post }, s.ejer.id, { timer: 4, udloeber: r.adgang.udloeber }), 'a failed mail is an error (the caller rolls the grant back)');
  await s.db.close();
});

test('never on from sign-up, the fleet, billing or a script: only server.ts wires givStoette (to the owner\'s switch in the gateway)', () => {
  const rod = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const filer = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filer(path.join(dir, e.name)) : /\.(ts|js|sh)$/.test(e.name) ? [path.join(dir, e.name)] : []));
  const brugere = [...filer(path.join(rod, 'src')), ...filer(path.join(rod, 'scripts'))]
    .filter((f) => /\bgivStoette\b/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(rod, f)).sort();
  assert.deepEqual(brugere, ['src/konto/stoette.ts', 'src/server.ts']);
  for (const f of filer(path.join(rod, 'scripts'))) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /stoette/i, `${path.relative(rod, f)} must not touch support grants`);
  for (const d of ['tilmelding', 'fleet', 'abonnement']) for (const f of filer(path.join(rod, 'src', d))) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /stoette/i, `${path.relative(rod, f)}`);
});
