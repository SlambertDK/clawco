// KC-0184: inviting a household member by mail. Invariant (AGENTS §0 r2, spec D15): only the owner's own click sends
// an invitation, after he saw the exact mail; the link is 32 random bytes stored as SHA-256 only, 7 days, once, for
// that address only; cancelling or resending kills the old link; over the plan's limit nothing is sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { husStativ, sidsteToken, PUBLIC, type HusStativ } from './husstand-stativ.ts';
import { annuller, findInvitation, forbered, gensend, send, ventendeInvitationer, INVITATION_DAGE, UDKAST_MS } from '../../src/konto/invitation.ts';
import { accepter } from '../../src/konto/medlemskab.ts';
import { renderBesked } from '../../src/delt/post.ts';
import { hashToken } from '../../src/konto/token.ts';

const DAG = 86_400_000;
const NORA = { email: 'Nora@Example.test', navn: 'Nora', rolle: 'barn', inviterer: 'Ida' };

async function inviter(s: HusStativ, o: Partial<typeof NORA> = {}, ejer = s.ejer.id): Promise<string> {
  const f = await forbered(s.inv, { ejerKontoId: ejer, ...NORA, ...o, nu: s.u.nu() });
  assert.ok(f.ok, JSON.stringify(f));
  assert.equal(await send(s.inv, { ejerKontoId: ejer, id: f.udkast.id, token: f.udkast.token, nu: s.u.nu() }), 'sendt');
  return sidsteToken(s);
}

test('preview equals send: the draft\'s mail is byte for byte what the mail client renders, link included; nothing is sent before the click', async () => {
  const s = await husStativ();
  const f = await forbered(s.inv, { ejerKontoId: s.ejer.id, ...NORA, nu: s.u.nu() });
  assert.ok(f.ok);
  assert.equal(f.udkast.til, 'nora@example.test');
  assert.equal(s.post.udbakke.length, 0, 'a preview sends nothing');
  assert.equal(await findInvitation(s.db, f.udkast.token, s.u.nu()), null, 'a draft opens nothing');
  assert.equal(await send(s.inv, { ejerKontoId: s.ejer.id, id: f.udkast.id, token: f.udkast.token, nu: s.u.nu() }), 'sendt');
  assert.equal(s.post.udbakke.length, 1);
  const b = s.post.udbakke[0]!;
  assert.equal(b.til, 'nora@example.test');
  assert.equal(b.skabelon, 'invitation');
  assert.deepEqual(renderBesked(b), f.udkast.mail);
  assert.match(f.udkast.mail.tekst, /Ida har inviteret dig til Idas husstand på Clawco/);
  assert.match(f.udkast.mail.tekst, new RegExp(`${PUBLIC}/invitation\\?t=[A-Za-z0-9_-]{43}`));
  assert.match(f.udkast.mail.tekst, new RegExp(`${INVITATION_DAGE} dage`));
});

test('hash-only storage: the token is nowhere in the database, only its SHA-256', async () => {
  const s = await husStativ();
  const t = await inviter(s);
  const alt = JSON.stringify(await s.db.query('SELECT * FROM invitation'));
  assert.ok(!alt.includes(t));
  assert.equal((await s.db.query('SELECT 1 FROM invitation WHERE hash = $1', [hashToken(t)])).length, 1);
});

test('single use: the second accept with the same link finds nothing', async () => {
  const s = await husStativ();
  const t = await inviter(s);
  assert.equal((await accepter(s.med, { token: t, kontoId: s.nora.id, nu: s.u.nu() })).udfald, 'ok');
  assert.equal(await findInvitation(s.db, t, s.u.nu()), null);
  assert.equal((await accepter(s.med, { token: t, kontoId: s.nora.id, nu: s.u.nu() })).udfald, 'ugyldig');
});

test('expiry: the link works for 7 days and not a millisecond longer; an unsent draft dies after its hour', async () => {
  const s = await husStativ();
  const t = await inviter(s);
  s.u.frem(INVITATION_DAGE * DAG - 1);
  assert.ok(await findInvitation(s.db, t, s.u.nu()));
  s.u.frem(1);
  assert.equal(await findInvitation(s.db, t, s.u.nu()), null);
  assert.equal((await accepter(s.med, { token: t, kontoId: s.nora.id, nu: s.u.nu() })).udfald, 'ugyldig');
  const f = await forbered(s.inv, { ejerKontoId: s.ejer.id, ...NORA, nu: s.u.nu() });
  assert.ok(f.ok);
  s.u.frem(UDKAST_MS + 1);
  assert.equal(await send(s.inv, { ejerKontoId: s.ejer.id, id: f.udkast.id, token: f.udkast.token, nu: s.u.nu() }), 'ukendt');
  assert.equal(s.post.udbakke.length, 1, 'only the first was sent');
});

test('wrong email: another account gets anden-email and spends nothing; the right one can still accept', async () => {
  const s = await husStativ();
  const t = await inviter(s);
  assert.equal((await accepter(s.med, { token: t, kontoId: s.fremmed.id, nu: s.u.nu() })).udfald, 'anden-email');
  assert.equal((await s.db.query('SELECT 1 FROM medlemskab')).length, 0);
  assert.ok(await findInvitation(s.db, t, s.u.nu()), 'still pending');
  assert.equal((await accepter(s.med, { token: t, kontoId: s.nora.id, nu: s.u.nu() })).udfald, 'ok');
});

test('cancel: the owner cancels a pending invitation and its link stops at once; a non-owner cannot cancel it', async () => {
  const s = await husStativ();
  const t = await inviter(s);
  const [v] = await ventendeInvitationer(s.db, s.slug, s.u.nu());
  assert.equal(await annuller(s.db, { ejerKontoId: s.fremmed.id, id: v!.id, nu: s.u.nu() }), 'ikke-ejer');
  assert.equal(await annuller(s.db, { ejerKontoId: s.andenEjer.id, id: v!.id, nu: s.u.nu() }), 'ukendt', 'another owner cannot touch it');
  assert.ok(await findInvitation(s.db, t, s.u.nu()));
  assert.equal(await annuller(s.db, { ejerKontoId: s.ejer.id, id: v!.id, nu: s.u.nu() }), 'ok');
  assert.equal(await findInvitation(s.db, t, s.u.nu()), null);
  assert.deepEqual(await ventendeInvitationer(s.db, s.slug, s.u.nu()), []);
});

test('resend issues a new token and kills the old one (only once the new mail is sent); one pending invitation per address', async () => {
  const s = await husStativ();
  const gammel = await inviter(s);
  const dobbelt = await forbered(s.inv, { ejerKontoId: s.ejer.id, ...NORA, nu: s.u.nu() });
  assert.deepEqual(dobbelt, { ok: false, grund: 'ventende' });
  const [v] = await ventendeInvitationer(s.db, s.slug, s.u.nu());
  const g = await gensend(s.inv, { ejerKontoId: s.ejer.id, id: v!.id, nu: s.u.nu() });
  assert.ok(g.ok);
  assert.ok(await findInvitation(s.db, gammel, s.u.nu()), 'the old link lives until the new mail is sent');
  assert.equal(await send(s.inv, { ejerKontoId: s.ejer.id, id: g.udkast.id, token: g.udkast.token, nu: s.u.nu() }), 'sendt');
  const ny = sidsteToken(s);
  assert.notEqual(ny, gammel);
  assert.equal(await findInvitation(s.db, gammel, s.u.nu()), null);
  assert.ok(await findInvitation(s.db, ny, s.u.nu()));
  assert.equal((await ventendeInvitationer(s.db, s.slug, s.u.nu())).length, 1);
});

test('only the owner: another account, a member or another tenant\'s owner gets ikke-ejer (the route answers 403) and nothing is stored or sent', async () => {
  const s = await husStativ();
  for (const hvem of [s.fremmed.id, s.nora.id]) {
    assert.deepEqual(await forbered(s.inv, { ejerKontoId: hvem, ...NORA, nu: s.u.nu() }), { ok: false, grund: 'ikke-ejer' });
  }
  const f = await forbered(s.inv, { ejerKontoId: s.ejer.id, ...NORA, nu: s.u.nu() });
  assert.ok(f.ok);
  assert.equal(await send(s.inv, { ejerKontoId: s.fremmed.id, id: f.udkast.id, token: f.udkast.token, nu: s.u.nu() }), 'ikke-ejer');
  assert.equal(await send(s.inv, { ejerKontoId: s.andenEjer.id, id: f.udkast.id, token: f.udkast.token, nu: s.u.nu() }), 'ukendt');
  assert.equal(await send(s.inv, { ejerKontoId: s.ejer.id, id: f.udkast.id, token: 'x'.repeat(43), nu: s.u.nu() }), 'ukendt', 'the draft\'s own token only');
  assert.equal(s.post.udbakke.length, 0);
});

test('over the limit: Solo (1 person) cannot invite at all; Husstand counts the owner, members and pending invitations; nothing is sent', async () => {
  const s = await husStativ();
  s.max.n = 1;
  assert.deepEqual(await forbered(s.inv, { ejerKontoId: s.ejer.id, ...NORA, nu: s.u.nu() }), { ok: false, grund: 'fuld', max: 1 });
  s.max.n = 2;
  const f = await forbered(s.inv, { ejerKontoId: s.ejer.id, ...NORA, nu: s.u.nu() });
  assert.ok(f.ok);
  await send(s.inv, { ejerKontoId: s.ejer.id, id: f.udkast.id, token: f.udkast.token, nu: s.u.nu() });
  assert.deepEqual(await forbered(s.inv, { ejerKontoId: s.ejer.id, ...NORA, email: 'maja@example.test', navn: 'Maja', nu: s.u.nu() }), { ok: false, grund: 'fuld', max: 2 });
  // A draft made while there was room is checked again at send: the plan shrank meanwhile.
  s.max.n = 3;
  const g = await forbered(s.inv, { ejerKontoId: s.ejer.id, ...NORA, email: 'maja@example.test', navn: 'Maja', nu: s.u.nu() });
  assert.ok(g.ok);
  s.max.n = 2;
  assert.equal(await send(s.inv, { ejerKontoId: s.ejer.id, id: g.udkast.id, token: g.udkast.token, nu: s.u.nu() }), 'fuld');
  assert.equal(s.post.udbakke.length, 1, 'only the invitation that fitted');
});

test('the form is validated: address, names (one line, 1-80), role below the owner, never the owner himself', async () => {
  const s = await husStativ();
  const nej = async (o: Record<string, unknown>, grund: string) => assert.deepEqual(await forbered(s.inv, { ejerKontoId: s.ejer.id, ...NORA, ...o, nu: s.u.nu() }), { ok: false, grund }, JSON.stringify(o));
  await nej({ email: 'ikke-en-mail' }, 'email');
  await nej({ navn: '' }, 'navn');
  await nej({ navn: 'x'.repeat(81) }, 'navn');
  await nej({ navn: 'Nora\u202Eevil' }, 'navn');
  await nej({ rolle: 'ejer' }, 'rolle');
  await nej({ rolle: 'stoette' }, 'rolle');
  await nej({ inviterer: '' }, 'inviterer');
  await nej({ inviterer: 'x'.repeat(61) }, 'inviterer'); // the mail adds "s husstand" (a template name is at most 80)
  await nej({ email: 'ejer@example.test' }, 'egen-email');
});

test('a refused mail marks nothing sent: the draft stays a draft and its link opens nothing', async () => {
  const s = await husStativ();
  const f = await forbered(s.inv, { ejerKontoId: s.ejer.id, ...NORA, nu: s.u.nu() });
  assert.ok(f.ok);
  s.post.fejl = true;
  assert.equal(await send(s.inv, { ejerKontoId: s.ejer.id, id: f.udkast.id, token: f.udkast.token, nu: s.u.nu() }), 'post-fejl');
  assert.equal(await findInvitation(s.db, f.udkast.token, s.u.nu()), null);
  s.post.fejl = false;
  assert.equal(await send(s.inv, { ejerKontoId: s.ejer.id, id: f.udkast.id, token: f.udkast.token, nu: s.u.nu() }), 'sendt');
});

test('Clawco never invites on its own: only the account routes call send, and nothing in fleet, billing, sign-up, drift or scripts does', () => {
  const rod = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const filer = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filer(path.join(dir, e.name)) : /\.(ts|js|sh)$/.test(e.name) ? [path.join(dir, e.name)] : []));
  const brugere = [...filer(path.join(rod, 'src')), ...filer(path.join(rod, 'scripts'))]
    .filter((f) => /konto\/invitation\.ts|\.\/invitation\.ts/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(rod, f)).sort();
  assert.deepEqual(brugere, ['src/konto/medlemskab.ts', 'src/konto/ruter.ts', 'src/server.ts']);
  const medlemskab = fs.readFileSync(path.join(rod, 'src/konto/medlemskab.ts'), 'utf8');
  assert.doesNotMatch(medlemskab, /\bsend\b\s*[,}]|\bsend\(/, 'membership never sends a mail');
  const server = fs.readFileSync(path.join(rod, 'src/server.ts'), 'utf8');
  assert.doesNotMatch(server, /invitation\.ts';[^\n]*\bsend\b/, 'server.ts wires seams, never send');
});
