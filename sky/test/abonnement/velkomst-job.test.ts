// KC-0200: the welcome mails' job. One trial walked day by day through the real entitlement (fake Stripe), with the job
// run twice per tick as a restart would: three mails, once each, in the owner's language, with a reply-to that reaches
// support and the one-click unsubscribe header on the tips mail only. The claim is recorded before the send, so a
// crash between them neither repeats nor loses a mail; a "no thanks" counts at send time; a failed send is retried.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stativ, startProeve, fangLog, EMAIL, PUBLIC, type Stativ } from './stativ.ts';
import { falskPost, type FalskPost } from '../../src/delt/post.ts';
import { paatagMail, GENTAG_EFTER_MS } from '../../src/delt/udsendte.ts';
import { saetGave, synkKunde, hentRettigheder, kontiMedAdgang } from '../../src/abonnement/synk.ts';
import { velkomstGennemloeb, velkomstForKonto, kontiTilVelkomst, type VelkomstDeps } from '../../src/abonnement/velkomst-job.ts';
import { abonnementLink } from '../../src/abonnement/frist-job.ts';
import type { KoebDeps } from '../../src/abonnement/kvittering.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { HJAELP, svartid } from '../../src/konto/hjaelp.ts';
import { afstem } from '../../src/fleet/afstem.ts';
import { laase, tenantForEjer } from '../../src/fleet/tilstand.ts';
import { velkomstDeps } from '../../src/server.ts';
import { falskFlaade, falskNoegler } from '../fleet/hjaelp.ts';

const DAG = 86_400_000;
const CLAWCO = 'https://hus-abcdefgh.kunder.example.test/';
const POSTKASSE = 'kontakt@hjaelp.example.test';
const SAELGER = { da: 'Sælger Eksempel, Eksempelvej 1, 5000 Odense C, Danmark.', en: 'Seller Example, Eksempelvej 1, 5000 Odense C, Denmark.' };

type Styr = { klarVed: Date | null; tips: boolean; sprog: 'da' | 'en'; kontakt: boolean; afmeld: number };

function deps(s: Stativ, post: FalskPost, styr: Styr, over: Partial<VelkomstDeps> = {}): VelkomstDeps {
  return {
    db: s.db, priser: s.priser, post, publicUrl: PUBLIC, nu: s.u.nu,
    kontakt: async (id) => (id === s.kontoId && styr.kontakt ? { email: EMAIL, sprog: styr.sprog } : null),
    saelger: (sprog) => SAELGER[sprog],
    clawco: async (id) => (id === s.kontoId && styr.klarVed ? { klarVed: styr.klarVed, link: CLAWCO } : null),
    nyligtKlare: async (siden) => (styr.klarVed && styr.klarVed >= siden ? [s.kontoId] : []),
    tips: async () => styr.tips,
    afmeldLink: async (_id, sprog) => `https://konto.example.test/post/afmeld?t=tok${++styr.afmeld}&sprog=${sprog}`,
    hjaelp: { postkasse: POSTKASSE, svartid: (sprog) => (sprog === 'da' ? 'Vi svarer inden for 2 hverdage.' : 'We answer within 2 working days.') },
    ...over,
  };
}

/** The entitlement as Stripe holds it now (what a webhook would do). */
async function synk(s: Stativ): Promise<void> {
  s.klient.spolFrem(s.u.nu());
  await synkKunde(s.db, s.klient, s.priser, { stripeKunde: s.kunde, kontoId: s.kontoId, grund: 'test', haendelseId: null, nu: s.u.nu() });
}

/** A trial started now; the Clawco became klar two minutes later. */
async function proeve(sprog: 'da' | 'en' = 'da'): Promise<{ s: Stativ; styr: Styr }> {
  const s = await stativ();
  await startProeve(s);
  await synk(s);
  const styr: Styr = { klarVed: new Date(s.u.nu().getTime() + 2 * 60_000), tips: true, sprog, kontakt: true, afmeld: 0 };
  s.u.frem(5 * 60_000);
  return { s, styr };
}

const skabeloner = (p: FalskPost): string[] => p.udbakke.map((b) => b.skabelon);

/** One tick, then the same tick again by a "restarted" job (new deps, same database). */
async function tik(s: Stativ, post: FalskPost, styr: Styr): Promise<void> {
  await fangLog(() => velkomstGennemloeb(deps(s, post, styr)));
  await fangLog(() => velkomstGennemloeb(deps(s, post, styr)));
}

test('a trial, day by day: welcome on day 0, tips on day 3, trial-ending on day 12, each once, ticks twice a day with restarts', async () => {
  const { s, styr } = await proeve();
  const post = falskPost();
  const dage: Record<number, string[]> = {};
  for (let d = 0; d <= 15; d++) {
    await tik(s, post, styr);
    s.u.frem(12 * 3_600_000);
    await tik(s, post, styr);
    dage[d] = skabeloner(post);
    s.u.frem(12 * 3_600_000);
  }
  assert.deepEqual(dage[0], ['velkomst']);
  assert.deepEqual(dage[2], ['velkomst']);
  assert.deepEqual(dage[3], ['velkomst', 'kom-i-gang']);
  assert.deepEqual(dage[11], ['velkomst', 'kom-i-gang']);
  assert.deepEqual(dage[12], ['velkomst', 'kom-i-gang', 'proeve-slutter']);
  assert.deepEqual(dage[15], ['velkomst', 'kom-i-gang', 'proeve-slutter']);
  const [velkomst, tips, slutter] = post.udbakke;
  // Every mail: to the owner, in the owner's language, reply-to support; List-Unsubscribe on the tips mail only.
  for (const b of post.udbakke) {
    assert.equal(b.til, EMAIL);
    assert.equal(b.sprog, 'da');
    assert.equal(b.svarTil, POSTKASSE);
    assert.equal(b.data['saelger'], SAELGER.da);
  }
  assert.equal(velkomst!.afmeld, undefined);
  assert.equal(slutter!.afmeld, undefined);
  assert.equal(tips!.afmeld, 'https://konto.example.test/post/afmeld?t=tok1&sprog=da');
  assert.equal(tips!.data['afmeld'], tips!.afmeld, 'the visible link and the header are the same link');
  assert.equal(styr.afmeld, 1, 'one unsubscribe link, made for the one tips mail');
  // The welcome opens the Clawco, says when the free trial ends and that no card is needed, and links the account page.
  assert.equal(velkomst!.data['link'], CLAWCO);
  assert.equal(velkomst!.data['konto'], `${PUBLIC}/konto`);
  assert.equal(velkomst!.data['hjaelp'], POSTKASSE);
  assert.match(velkomst!.data['abonnement']!, /slutter 14\. november 2026\. Du skal ikke give et kort\./);
  // The tips mail goes into Start; the trial-ending mail to the subscription page, with the trial's end date.
  assert.equal(tips!.data['link'], 'https://hus-abcdefgh.kunder.example.test/rum/start');
  assert.equal(slutter!.data['link'], abonnementLink({ publicUrl: PUBLIC }));
  assert.equal(slutter!.data['dato'], '14. november 2026');
});

test('English account: the mails are English and the dates too', async () => {
  const { s, styr } = await proeve('en');
  const post = falskPost();
  await tik(s, post, styr);
  s.u.frem(12 * DAG);
  await tik(s, post, styr);
  assert.deepEqual(skabeloner(post), ['velkomst', 'proeve-slutter']);
  assert.ok(post.udbakke.every((b) => b.sprog === 'en'));
  assert.match(post.udbakke[0]!.data['abonnement']!, /ends on 14 November 2026\. You do not need to give a card\./);
  assert.equal(post.udbakke[1]!.data['dato'], '14 November 2026');
});

test('a crash between the claim and the send: nothing for the claim\'s lifetime, then the mail goes out exactly once', async () => {
  const { s, styr } = await proeve();
  const post = falskPost();
  // The "crashed" job claimed the welcome and died before sending.
  assert.ok(await paatagMail(s.db, { kontoId: s.kontoId, slags: 'velkomst', noegle: 'eneste' }, s.u.nu()));
  await tik(s, post, styr);
  assert.deepEqual(skabeloner(post), [], 'a live claim is never sent by another job');
  s.u.frem(GENTAG_EFTER_MS + 1);
  await tik(s, post, styr);
  await tik(s, post, styr);
  assert.deepEqual(skabeloner(post), ['velkomst']);
});

test('a failed send gives the claim back: the next tick sends it once', async () => {
  const { s, styr } = await proeve();
  const post = falskPost();
  post.fejl = true;
  const { r } = await fangLog(() => velkomstGennemloeb(deps(s, post, styr)));
  assert.deepEqual(r, { sendt: 0, fejl: 1 });
  post.fejl = false;
  await tik(s, post, styr);
  assert.deepEqual(skabeloner(post), ['velkomst']);
});

test('"no thanks" counts at send time: turned off on day 2, no tips mail; the service mails still come', async () => {
  const { s, styr } = await proeve();
  const post = falskPost();
  await tik(s, post, styr);
  s.u.frem(2 * DAG);
  styr.tips = false;
  s.u.frem(DAG + 3_600_000);
  await tik(s, post, styr);
  s.u.frem(9 * DAG);
  await tik(s, post, styr);
  assert.deepEqual(skabeloner(post), ['velkomst', 'proeve-slutter']);
  assert.equal(styr.afmeld, 0, 'no unsubscribe link is made for a mail that is not sent');
});

test('a deleted account (no address left) gets nothing, and nothing is claimed for it', async () => {
  const { s, styr } = await proeve();
  styr.kontakt = false;
  const post = falskPost();
  await tik(s, post, styr);
  assert.deepEqual(skabeloner(post), []);
  assert.deepEqual(await s.db.query('SELECT * FROM udsendte_mails'), []);
});

test('a gift (beta) account whose Clawco is klar gets the welcome only, without a trial line', async () => {
  const s = await stativ();
  const { konto } = await findEllerOpretKonto(s.db, 'gave@example.test', s.u.nu());
  await saetGave(s.db, konto.id, 'sky-solo', s.priser, s.u.nu());
  const styr: Styr = { klarVed: s.u.nu(), tips: true, sprog: 'da', kontakt: true, afmeld: 0 };
  const post = falskPost();
  const d = deps(s, post, styr, {
    kontakt: async (id) => (id === konto.id ? { email: 'gave@example.test', sprog: 'da' } : null),
    clawco: async (id) => (id === konto.id ? { klarVed: styr.klarVed!, link: CLAWCO } : null),
    nyligtKlare: async () => [konto.id],
  });
  assert.deepEqual(await kontiTilVelkomst(d), [konto.id], 'found through the fleet (no Stripe trial)');
  for (let i = 0; i < 14; i++) { await fangLog(() => velkomstGennemloeb(d)); s.u.frem(DAG); }
  assert.deepEqual(skabeloner(post), ['velkomst']);
  assert.doesNotMatch(post.udbakke[0]!.data['abonnement']!, /prøve/);
});

test('candidates: Stripe trials (for day 12, klar or not) and recently klar Clawcos, once each, never a deleted account', async () => {
  const { s, styr } = await proeve();
  const post = falskPost();
  assert.deepEqual(await kontiTilVelkomst(deps(s, post, styr)), [s.kontoId]);
  assert.deepEqual(await kontiTilVelkomst(deps(s, post, { ...styr, klarVed: null })), [s.kontoId], 'a trial without a klar Clawco is still a candidate');
  await s.db.query('UPDATE konto SET email = NULL, slettet_ved = now() WHERE id = $1', [s.kontoId]);
  assert.deepEqual(await kontiTilVelkomst(deps(s, post, { ...styr, klarVed: null })), []);
});

test('the job for one account reports what it sent; a converted trial (paid) on day 12 gets no trial-ending mail', async () => {
  const { s, styr } = await proeve();
  const post = falskPost();
  assert.deepEqual(await fangLog(() => velkomstForKonto(deps(s, post, styr), s.kontoId)).then((x) => x.r), { sendt: 1, fejl: 0 });
  // The person adds a card and the trial ends early: Stripe makes the subscription active.
  s.klient.vedhaeftBetalingsmiddel(s.kunde, 'pm_card_visa');
  s.u.frem(14 * DAG + 3_600_000);
  await synk(s);
  assert.equal((await hentRettigheder(s.db, s.kontoId, s.priser, s.u.nu())).status, 'aktiv');
  // Back to day 12 (inside the trial-ending window had it still been a trial): nothing is owed.
  s.u.frem(-2 * DAG);
  await tik(s, post, styr);
  assert.deepEqual(skabeloner(post), ['velkomst']);
});

test('server wiring: the klar time and the link come from the fleet, tips and the unsubscribe link from konto, the reply-to from config/hjaelp.json', async () => {
  const s = await stativ();
  await saetGave(s.db, s.kontoId, 'sky-solo', s.priser, s.u.nu());
  const foer = s.u.nu();
  const post = falskPost();
  const koeb: KoebDeps = { db: s.db, klient: null, priser: s.priser, post, publicUrl: PUBLIC, nu: s.u.nu, saelger: (sp) => SAELGER[sp], vilkaar: { version: 'v', url: () => 'https://clawco.example.test/vilkaar' }, kontakt: async () => ({ email: EMAIL, sprog: 'da' }) };
  const d = velkomstDeps({ db: s.db, basedomain: 'kunder.example.test', koeb });
  assert.equal(await d.clawco(s.kontoId), null, 'no tenant yet');
  await afstem({
    db: s.db, flaade: falskFlaade(), billede: 'clawco:test', laas: laase(), nu: s.u.nu, vent: async () => {},
    sundhed: async () => ({ ok: true, sha: 'abc' }), iGateway: async () => {}, udAfGateway: async () => {}, noegler: falskNoegler(), berettigede: () => kontiMedAdgang(s.db),
  });
  const t = await tenantForEjer(s.db, s.kontoId);
  const c = await d.clawco(s.kontoId);
  assert.ok(t && c);
  assert.equal(c.link, `https://${t.slug}.kunder.example.test/`);
  assert.deepEqual(c.klarVed, t.tider.klar);
  assert.deepEqual(await d.nyligtKlare(foer), [s.kontoId]);
  assert.equal(await d.tips(s.kontoId), true);
  const link = new URL(await d.afmeldLink(s.kontoId, 'en'));
  assert.equal(`${link.origin}${link.pathname}`, `${PUBLIC}/post/afmeld`);
  assert.equal(d.hjaelp.postkasse, HJAELP.postkasse);
  assert.equal(d.hjaelp.svartid('da'), svartid('da'));
  // The whole wiring sends the welcome once the tenant is klar.
  await fangLog(() => velkomstGennemloeb(d));
  assert.deepEqual(skabeloner(post), ['velkomst']);
  assert.equal(post.udbakke[0]!.svarTil, HJAELP.postkasse);
});
