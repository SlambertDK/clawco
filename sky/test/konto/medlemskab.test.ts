// KC-0184: household membership in Sky. Invariant (AGENTS §0 r2/r12): a membership exists only after the invited
// address was verified (the accepting account's own email); only the owner removes a member or changes a role, a
// member may leave; Sky's rows and the tenant's household never disagree after a completed operation — the tenant
// call is inside the transaction, so a failing tenant leaves both as they were (the invitation still pending). A
// removal ends access at once: the membership, the account's unspent one-time codes and the gateway cache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { husStativ, sidsteToken, type HusStativ } from './husstand-stativ.ts';
import { forbered, send, findInvitation, ventendeInvitationer } from '../../src/konto/invitation.ts';
import { accepter, fjernMedlem, forlad, medlemmer, medlemskabFor, medlemskabHusstand, skiftRolle } from '../../src/konto/medlemskab.ts';
import { ruteTabel } from '../../src/gateway/rute.ts';
import { opretKode } from '../../src/gateway/login-vej.ts';

async function inviteret(s: HusStativ, email = 'nora@example.test', rolle = 'barn'): Promise<string> {
  const f = await forbered(s.inv, { ejerKontoId: s.ejer.id, email, navn: 'Nora', rolle, inviterer: 'Ida', nu: s.u.nu() });
  assert.ok(f.ok);
  assert.equal(await send(s.inv, { ejerKontoId: s.ejer.id, id: f.udkast.id, token: f.udkast.token, nu: s.u.nu() }), 'sendt');
  return sidsteToken(s);
}

async function medlem(s: HusStativ): Promise<void> {
  assert.equal((await accepter(s.med, { token: await inviteret(s), kontoId: s.nora.id, nu: s.u.nu() })).udfald, 'ok');
}

test('accept makes both: the membership row and the tenant\'s entry (login = her email, her role); the gateway lets her in', async () => {
  const s = await husStativ();
  const ruter = ruteTabel({ db: s.db });
  assert.equal(await ruter.medlem(s.slug, s.nora.id), false);
  const r = await accepter(s.med, { token: await inviteret(s), kontoId: s.nora.id, nu: s.u.nu() });
  assert.deepEqual(r, { udfald: 'ok', tenantId: s.slug });
  assert.deepEqual(await medlemskabFor(s.db, s.nora.id), { tenantId: s.slug, rolle: 'barn', navn: 'Nora' });
  assert.deepEqual(s.kald.ops, [{ slug: s.slug, op: { op: 'tilfoej', email: 'nora@example.test', navn: 'Nora', rolle: 'barn' } }]);
  assert.deepEqual(s.glemt, [s.slug]);
  assert.equal(await ruteTabel({ db: s.db }).medlem(s.slug, s.nora.id), true);
  assert.equal(await ruteTabel({ db: s.db }).medlem(s.andenSlug, s.nora.id), false, 'one household only');
  assert.equal(await ruteTabel({ db: s.db }).medlem(s.slug, s.fremmed.id), false);
});

test('accept is both rows or neither: a failing tenant call rolls back; the invitation stays pending and works once the tenant answers', async () => {
  const s = await husStativ();
  const t = await inviteret(s);
  s.kald.fejl = true;
  assert.equal((await accepter(s.med, { token: t, kontoId: s.nora.id, nu: s.u.nu() })).udfald, 'tenant-nede');
  assert.equal(await medlemskabFor(s.db, s.nora.id), null);
  assert.ok(await findInvitation(s.db, t, s.u.nu()), 'still pending, not spent');
  assert.equal(await ruteTabel({ db: s.db }).medlem(s.slug, s.nora.id), false);
  s.kald.fejl = false;
  assert.equal((await accepter(s.med, { token: t, kontoId: s.nora.id, nu: s.u.nu() })).udfald, 'ok');
});

test('accept refuses: another household\'s member, an owner of her own Clawco, a full household — nothing written, nothing called', async () => {
  const s = await husStativ();
  await medlem(s);
  // The other owner invites Nora too: she is already in a household (one household per account).
  const f = await forbered(s.inv, { ejerKontoId: s.andenEjer.id, email: 'nora@example.test', navn: 'Nora', rolle: 'medlem', inviterer: 'Bo', nu: s.u.nu() });
  assert.ok(f.ok);
  await send(s.inv, { ejerKontoId: s.andenEjer.id, id: f.udkast.id, token: f.udkast.token, nu: s.u.nu() });
  assert.equal((await accepter(s.med, { token: sidsteToken(s), kontoId: s.nora.id, nu: s.u.nu() })).udfald, 'anden-husstand');
  // An owner of a Clawco cannot join another one.
  const g = await forbered(s.inv, { ejerKontoId: s.ejer.id, email: 'anden-ejer@example.test', navn: 'Bo', rolle: 'medlem', inviterer: 'Ida', nu: s.u.nu() });
  assert.ok(g.ok);
  await send(s.inv, { ejerKontoId: s.ejer.id, id: g.udkast.id, token: g.udkast.token, nu: s.u.nu() });
  assert.equal((await accepter(s.med, { token: sidsteToken(s), kontoId: s.andenEjer.id, nu: s.u.nu() })).udfald, 'ejer-selv');
  // The plan shrank after the invitation was sent: accepting would exceed it.
  const h = await forbered(s.inv, { ejerKontoId: s.ejer.id, email: 'fremmed@example.test', navn: 'Maja', rolle: 'gaest', inviterer: 'Ida', nu: s.u.nu() });
  assert.ok(h.ok);
  await send(s.inv, { ejerKontoId: s.ejer.id, id: h.udkast.id, token: h.udkast.token, nu: s.u.nu() });
  s.max.n = 2;
  assert.equal((await accepter(s.med, { token: sidsteToken(s), kontoId: s.fremmed.id, nu: s.u.nu() })).udfald, 'fuld');
  assert.equal(s.kald.ops.length, 1, 'only the first accept reached a tenant');
  assert.deepEqual((await medlemmer(s.db, s.slug)).map((m) => m.email), ['nora@example.test']);
});

test('remove (owner only): the row, her unspent codes and the gateway cache go; the next request is refused at once', async () => {
  const s = await husStativ();
  await medlem(s);
  const ruter = ruteTabel({ db: s.db });
  assert.equal(await ruter.medlem(s.slug, s.nora.id), true, 'cached as a member');
  await opretKode(s.db, { kontoId: s.nora.id, sessionId: s.nora.sessionId, slug: s.slug, naeste: '/', nu: s.u.nu() });
  const med = { ...s.med, glem: (slug: string) => { s.glemt.push(slug); ruter.glem(slug); } };
  assert.equal(await fjernMedlem(med, { ejerKontoId: s.fremmed.id, medlemKontoId: s.nora.id }), 'ikke-ejer');
  assert.equal(await fjernMedlem(med, { ejerKontoId: s.nora.id, medlemKontoId: s.nora.id }), 'ikke-ejer', 'a member cannot remove (she leaves instead)');
  assert.equal(await fjernMedlem(med, { ejerKontoId: s.andenEjer.id, medlemKontoId: s.nora.id }), 'ukendt', 'another owner cannot');
  assert.equal(await ruter.medlem(s.slug, s.nora.id), true);
  assert.equal(await fjernMedlem(med, { ejerKontoId: s.ejer.id, medlemKontoId: s.nora.id }), 'ok');
  assert.equal(await ruter.medlem(s.slug, s.nora.id), false, 'the cache was dropped: refused at once, not within 30 seconds');
  assert.equal(await medlemskabFor(s.db, s.nora.id), null);
  assert.deepEqual(await s.db.query('SELECT 1 FROM gateway.kode WHERE konto_id = $1', [s.nora.id]), []);
  assert.deepEqual(s.kald.ops.at(-1), { slug: s.slug, op: { op: 'fjern', email: 'nora@example.test' } });
});

test('remove and leave are both or neither too: a failing tenant keeps the membership', async () => {
  const s = await husStativ();
  await medlem(s);
  s.kald.fejl = true;
  assert.equal(await fjernMedlem(s.med, { ejerKontoId: s.ejer.id, medlemKontoId: s.nora.id }), 'tenant-nede');
  assert.equal(await forlad(s.med, { kontoId: s.nora.id }), 'tenant-nede');
  assert.ok(await medlemskabFor(s.db, s.nora.id));
  assert.equal(await ruteTabel({ db: s.db }).medlem(s.slug, s.nora.id), true);
});

test('leave: a member leaves on her own; the tenant is told; she is no member anywhere', async () => {
  const s = await husStativ();
  await medlem(s);
  assert.equal(await forlad(s.med, { kontoId: s.nora.id }), 'ok');
  assert.equal(await medlemskabFor(s.db, s.nora.id), null);
  assert.deepEqual(s.kald.ops.at(-1)?.op, { op: 'fjern', email: 'nora@example.test' });
  assert.equal(await forlad(s.med, { kontoId: s.nora.id }), 'ingen');
  assert.equal(await forlad(s.med, { kontoId: s.ejer.id }), 'ingen', 'the owner does not leave his own household');
});

test('role change: owner only, medlem/barn/gæst; the tenant gets the same role', async () => {
  const s = await husStativ();
  await medlem(s);
  assert.equal(await skiftRolle(s.med, { ejerKontoId: s.nora.id, medlemKontoId: s.nora.id, rolle: 'medlem' }), 'ikke-ejer');
  assert.equal(await skiftRolle(s.med, { ejerKontoId: s.ejer.id, medlemKontoId: s.fremmed.id, rolle: 'medlem' }), 'ukendt');
  assert.equal(await skiftRolle(s.med, { ejerKontoId: s.ejer.id, medlemKontoId: s.nora.id, rolle: 'gaest' }), 'ok');
  assert.equal((await medlemskabFor(s.db, s.nora.id))?.rolle, 'gaest');
  assert.deepEqual(s.kald.ops.at(-1)?.op, { op: 'rolle', email: 'nora@example.test', rolle: 'gaest' });
  s.kald.fejl = true;
  assert.equal(await skiftRolle(s.med, { ejerKontoId: s.ejer.id, medlemKontoId: s.nora.id, rolle: 'medlem' }), 'tenant-nede');
  assert.equal((await medlemskabFor(s.db, s.nora.id))?.rolle, 'gaest', 'rolled back');
});

test('the Husstand seam (account deletion): the owner sees his members; a member\'s deletion leaves the household first', async () => {
  const s = await husStativ();
  await medlem(s);
  await inviteret(s, 'maja@example.test', 'medlem');
  const h = medlemskabHusstand(s.med);
  assert.deepEqual(await h.forKonto(s.ejer.id), { tenantId: s.slug, rolle: 'ejer', medlemmer: ['nora@example.test'] });
  assert.deepEqual(await h.forKonto(s.nora.id), { tenantId: s.slug, rolle: 'medlem', medlemmer: [] });
  assert.equal(await h.forKonto(s.fremmed.id), null);
  s.kald.fejl = true;
  await assert.rejects(h.forlad(s.nora.id), /svarede ikke/);
  s.kald.fejl = false;
  await h.forlad(s.nora.id);
  assert.equal(await medlemskabFor(s.db, s.nora.id), null);
  assert.equal((await ventendeInvitationer(s.db, s.slug, s.u.nu())).length, 1, 'other invitations are untouched');
});

test('the tenant call is wired only to membership: nothing else in Sky (fleet, billing, sign-up, drift, scripts) changes a household', () => {
  const rod = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const filer = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filer(path.join(dir, e.name)) : /\.(ts|js|sh)$/.test(e.name) ? [path.join(dir, e.name)] : []));
  const brugere = [...filer(path.join(rod, 'src')), ...filer(path.join(rod, 'scripts'))]
    .filter((f) => /\bkontrolKald\b|\bsignerKontrol\b/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(rod, f)).sort();
  assert.deepEqual(brugere, ['src/gateway/kontrolkald.ts', 'src/gateway/signer.ts', 'src/server.ts']);
});
