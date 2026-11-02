// KC-0203: the beta invitation lifecycle. Invariants: only a hash is stored; a code is spent once; an expired or
// revoked code grants nothing; redeeming gives a gift (no Stripe) that Stripe state can never change; a gift given
// by hand without an invitation is not a beta household; the beta's end date only ever moves forward.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { nyDb, ur, antal } from '../konto/hjaelp.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { taelOp } from '../../src/konto/graenser.ts';
import { hentRettigheder, saetGave, synkKunde } from '../../src/abonnement/synk.ts';
import { laesPriser } from '../../src/abonnement/priser.ts';
import { FalskBetalingsKlient } from '../../src/abonnement/falsk.ts';
import {
  BETA_DAGE, BETA_PLAN, annuller, annullerAlle, betaForTenant, erBetaKonto, forlaengGaver, indloes, lavInvitationer,
  type IndloesDeps,
} from '../../src/beta/invitationer.ts';
import { betaGaver } from '../../src/betaforbind.ts';
import type { Database } from '../../src/db/pool.ts';

const priser = laesPriser();
const DAG = 86_400_000;

async function opsaet() {
  const db = await nyDb();
  const u = ur();
  const gaver = betaGaver(priser);
  const deps: IndloesDeps = { db, gaver, begraens: (n, g, nu) => taelOp(db, n, g, nu) };
  const konto = async (email: string) => (await findEllerOpretKonto(db, email, u.nu())).konto.id;
  return { db, u, deps, konto };
}

const hash = (kode: string) => createHash('sha256').update(kode).digest('hex');

test('lavInvitationer: the plain codes come back once; the database holds a hash, an expiry and the state, never the code', async () => {
  const { db, u } = await opsaet();
  const koder = await lavInvitationer(db, 3, u.nu());
  assert.equal(koder.length, 3);
  assert.equal(new Set(koder).size, 3);
  for (const k of koder) assert.match(k, /^[A-Za-z0-9_-]{43}$/);
  const raekker = await db.query<Record<string, unknown>>('SELECT * FROM beta.invitation ORDER BY id');
  assert.equal(raekker.length, 3);
  const alt = JSON.stringify(raekker);
  for (const k of koder) assert.ok(!alt.includes(k), 'the code is not in any row');
  assert.deepEqual(raekker.map((r) => r['hash']).sort(), koder.map(hash).sort());
  assert.ok(raekker.every((r) => r['brugt'] === null && r['brugt_af'] === null && r['annulleret'] === null));
  assert.equal(new Date(raekker[0]!['udloeber'] as string).getTime() - u.nu().getTime(), 60 * DAG, 'valid 60 days by default');
  await db.close();
});

test('lavInvitationer takes 1 to 50 codes and nothing else', async () => {
  const { db, u } = await opsaet();
  for (const n of [0, 51, -1, 1.5, Number.NaN]) await assert.rejects(lavInvitationer(db, n, u.nu()), /antal/, String(n));
  assert.equal(await antal(db, 'beta.invitation'), 0);
  assert.equal((await lavInvitationer(db, 50, u.nu())).length, 50);
  await db.close();
});

test('redeem: a gift on the Husstand plan, active, no Stripe, ending 90 days out; the code is spent and names the account', async () => {
  const { db, u, deps, konto } = await opsaet();
  const id = await konto('beta1@example.test');
  const [kode] = await lavInvitationer(db, 1, u.nu());
  assert.equal(await indloes(deps, id, kode!, u.nu(), { samtykke: true }), true);
  const r = await hentRettigheder(db, id, priser, u.nu());
  assert.equal(r.kilde, 'gave');
  assert.equal(r.plan, BETA_PLAN);
  assert.equal(r.status, 'aktiv');
  assert.equal(r.abonnement, null, 'no Stripe subscription');
  assert.equal(new Date(r.periodeSlutter!).getTime(), u.nu().getTime() + BETA_DAGE * DAG);
  const [i] = await db.query<{ brugt_af: unknown }>('SELECT brugt_af FROM beta.invitation');
  assert.equal(Number(i!.brugt_af), id);
  assert.equal(await erBetaKonto(db, id), true);
  await db.close();
});

test('a second redeem of the same code is refused, also for another account, and changes nothing', async () => {
  const { db, u, deps, konto } = await opsaet();
  const a = await konto('a@example.test');
  const b = await konto('b@example.test');
  const [kode] = await lavInvitationer(db, 1, u.nu());
  assert.equal(await indloes(deps, a, kode!, u.nu(), { samtykke: false }), true);
  assert.equal(await indloes(deps, a, kode!, u.nu(), { samtykke: false }), false);
  assert.equal(await indloes(deps, b, kode!, u.nu(), { samtykke: true }), false);
  assert.equal((await hentRettigheder(db, b, priser, u.nu())).kilde, 'stripe');
  assert.equal((await hentRettigheder(db, b, priser, u.nu())).status, 'ingen');
  assert.equal(await erBetaKonto(db, b), false);
  assert.equal(await antal(db, 'beta.maal'), 1, 'no consent row for the refused account');
  await db.close();
});

test('a wrong, empty, expired or revoked code grants nothing', async () => {
  const { db, u, deps, konto } = await opsaet();
  const id = await konto('c@example.test');
  const [gammel, tilbagekaldt, god] = await lavInvitationer(db, 3, u.nu());
  assert.equal(await indloes(deps, id, 'forkert', u.nu(), { samtykke: true }), false);
  assert.equal(await indloes(deps, id, '', u.nu(), { samtykke: true }), false);
  assert.equal(await annuller(db, tilbagekaldt!, u.nu()), true);
  assert.equal(await indloes(deps, id, tilbagekaldt!, u.nu(), { samtykke: true }), false, 'revoked');
  u.frem(61 * DAG);
  assert.equal(await indloes(deps, id, gammel!, u.nu(), { samtykke: true }), false, 'expired');
  assert.equal(await indloes(deps, id, god!, u.nu(), { samtykke: true }), false, 'expired too');
  assert.equal((await hentRettigheder(db, id, priser, u.nu())).status, 'ingen');
  assert.equal(await antal(db, 'beta.maal'), 0);
  await db.close();
});

test('the consent given at redemption is stored: ticked or not', async () => {
  const { db, u, deps, konto } = await opsaet();
  const ja = await konto('ja@example.test');
  const nej = await konto('nej@example.test');
  const [k1, k2] = await lavInvitationer(db, 2, u.nu());
  await indloes(deps, ja, k1!, u.nu(), { samtykke: true });
  await indloes(deps, nej, k2!, u.nu(), { samtykke: false });
  const r = await db.query<{ konto_id: unknown; samtykke: boolean }>('SELECT konto_id, samtykke FROM beta.maal ORDER BY konto_id');
  assert.deepEqual(r.map((x) => [Number(x.konto_id), x.samtykke]), [[ja, true], [nej, false]]);
  await db.close();
});

test('redeeming is rate limited per account: the eleventh try in a window is refused even with a good code', async () => {
  const { db, u, deps, konto } = await opsaet();
  const id = await konto('d@example.test');
  const [god] = await lavInvitationer(db, 1, u.nu());
  for (let i = 0; i < 10; i++) assert.equal(await indloes(deps, id, `gaet-${i}`, u.nu(), { samtykke: true }), false);
  assert.equal(await indloes(deps, id, god!, u.nu(), { samtykke: true }), false, 'blocked');
  u.frem(16 * 60_000);
  assert.equal(await indloes(deps, id, god!, u.nu(), { samtykke: true }), true, 'a new window');
  await db.close();
});

test('revoking: one code by its text, or every code not yet used; a used code and its tenant are never touched', async () => {
  const { db, u, deps, konto } = await opsaet();
  const id = await konto('e@example.test');
  const [brugt, en, to, tre] = await lavInvitationer(db, 4, u.nu());
  await indloes(deps, id, brugt!, u.nu(), { samtykke: true });
  assert.equal(await annuller(db, 'ukendt', u.nu()), false);
  assert.equal(await annuller(db, brugt!, u.nu()), false, 'a spent code is not revoked');
  assert.equal(await annuller(db, en!, u.nu()), true);
  assert.equal(await annuller(db, en!, u.nu()), false, 'once');
  assert.equal(await annullerAlle(db, u.nu()), 2);
  const b = await konto('f@example.test');
  assert.equal(await indloes(deps, b, to!, u.nu(), { samtykke: true }), false);
  assert.equal(await indloes(deps, b, tre!, u.nu(), { samtykke: true }), false);
  assert.equal((await hentRettigheder(db, id, priser, u.nu())).status, 'aktiv', 'the existing gift stands');
  await db.close();
});

test('a gift given by hand (giv-gave) without an invitation is not a beta household', async () => {
  const { db, u, konto } = await opsaet();
  const id = await konto('g@example.test');
  await saetGave(db, id, 'sky-husstand', priser, u.nu());
  assert.equal(await erBetaKonto(db, id), false);
  await db.close();
});

test('betaForTenant: the owner account and its consent, for a live beta tenant only', async () => {
  const { db, u, deps, konto } = await opsaet();
  const id = await konto('h@example.test');
  const andet = await konto('i@example.test');
  const [kode] = await lavInvitationer(db, 1, u.nu());
  await indloes(deps, id, kode!, u.nu(), { samtykke: true });
  await db.query("INSERT INTO flaade.tenant (slug, ejer_konto_id, driver, tilstand, bestilt, oprettet, opdateret) VALUES ('hus-aaaaaaaa', $1, 'lokal', 'klar', now(), now(), now()), ('hus-bbbbbbbb', $2, 'lokal', 'klar', now(), now(), now())", [id, andet]);
  assert.deepEqual(await betaForTenant(db, 'hus-aaaaaaaa'), { kontoId: id, samtykke: true });
  assert.equal(await betaForTenant(db, 'hus-bbbbbbbb'), null, 'not a beta account');
  assert.equal(await betaForTenant(db, 'hus-cccccccc'), null, 'unknown');
  await db.query("UPDATE flaade.tenant SET tilstand = 'slettet' WHERE slug = 'hus-aaaaaaaa'");
  assert.equal(await betaForTenant(db, 'hus-aaaaaaaa'), null, 'a deleted tenant');
  await db.close();
});

async function gaveSlutter(db: Database, id: number): Promise<string | null> {
  const [r] = await db.query<{ periode_slutter: Date | null }>('SELECT periode_slutter FROM abonnement.rettigheder WHERE konto_id = $1', [id]);
  return r?.periode_slutter ? new Date(r.periode_slutter).toISOString() : null;
}

test('the beta-end path: forlaengGaver moves every beta gift\'s end forward, never back, and leaves other gifts alone', async () => {
  const { db, u, deps, konto } = await opsaet();
  const a = await konto('j@example.test');
  const b = await konto('k@example.test');
  const haand = await konto('l@example.test');
  const [k1, k2] = await lavInvitationer(db, 2, u.nu());
  await indloes(deps, a, k1!, u.nu(), { samtykke: true });
  u.frem(30 * DAG);
  await indloes(deps, b, k2!, u.nu(), { samtykke: false });
  await saetGave(db, haand, 'sky-solo', priser, u.nu());
  const foer = await gaveSlutter(db, a);
  const til = new Date(u.nu().getTime() + 200 * DAG);
  assert.equal(await forlaengGaver(deps, til, u.nu()), 2);
  assert.equal(await gaveSlutter(db, a), til.toISOString());
  assert.equal(await gaveSlutter(db, b), til.toISOString());
  assert.equal(await gaveSlutter(db, haand), null, 'a hand-given gift is not a beta gift');
  assert.ok(new Date(foer!) < til);
  // Never backwards: an earlier date changes nothing.
  assert.equal(await forlaengGaver(deps, new Date(til.getTime() - 50 * DAG), u.nu()), 0);
  assert.equal(await gaveSlutter(db, a), til.toISOString());
  const h = await db.query<{ grund: string }>("SELECT grund FROM abonnement.rettigheds_haendelser WHERE konto_id = $1 ORDER BY id", [a]);
  assert.deepEqual(h.map((x) => x.grund), ['gave', 'gave-forlaenget'], 'the outbox says so');
  await db.close();
});

test('Stripe never changes a beta gift or its end date: a sync, a late cancellation and a webhook-shaped re-read leave it as it was', async () => {
  const { db, u, deps, konto } = await opsaet();
  const id = await konto('m@example.test');
  const [kode] = await lavInvitationer(db, 1, u.nu());
  await indloes(deps, id, kode!, u.nu(), { samtykke: true });
  const foer = await hentRettigheder(db, id, priser, u.nu());
  const klient = new FalskBetalingsKlient('test');
  const r = await synkKunde(db, klient, priser, { stripeKunde: 'cus_ingen', kontoId: id, grund: 'customer.subscription.deleted', haendelseId: 'evt_1', nu: new Date(u.nu().getTime() + DAG) });
  assert.equal(r.aendret, false);
  assert.deepEqual(await hentRettigheder(db, id, priser, u.nu()), foer);
  assert.equal(await gaveSlutter(db, id), new Date(u.nu().getTime() + BETA_DAGE * DAG).toISOString());
  await db.close();
});
