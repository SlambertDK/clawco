// KC-0230: the operator's free-text notice to affected customers, through Sky's mailer. Invariants: nothing unresolved
// ever leaves (a placeholder, markup, an empty or over-long text is refused before anyone is looked up); a dry run sends
// nothing; the recipients are the owners of the named tenants or every live entitlement, never a deleted account; one
// mail per recipient through the one mailer, once per file and account; no address is ever printed or logged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { nyDb, ur, antal } from '../konto/hjaelp.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { saetGave } from '../../src/abonnement/synk.ts';
import { laesPriser } from '../../src/abonnement/priser.ts';
import { falskPost, PostFejl, renderBesked, type Post } from '../../src/delt/post.ts';
import { HJAELP } from '../../src/konto/hjaelp.ts';
import type { Database } from '../../src/db/pool.ts';
import { beskedTilKunder, BeskedFejl, kommando, laesBeskedFil } from '../../scripts/besked-til-kunder.ts';

const priser = laesPriser();
const REPO = path.resolve(import.meta.dirname, '../../..');
const skabelon = (sprog: 'da' | 'en') => fs.readFileSync(path.join(REPO, `docs/beredskab/skabeloner/kunder.${sprog}.md`), 'utf8');

/** The real template with every field filled in (the greeting without a name: one file goes to many people). */
function udfyldt(sprog: 'da' | 'en' = 'da'): string {
  return skabelon(sprog).replace(/ \[FORNAVN\]/, '').replace(/\[([A-Z0-9-]+)\]/g, (_, n: string) => `fylder-${n.toLowerCase()}`);
}

const mappe = fs.mkdtempSync(path.join(os.tmpdir(), 'besked-'));
let taeller = 0;
function fil(indhold: string): string {
  const p = path.join(mappe, `besked-${++taeller}.md`);
  fs.writeFileSync(p, indhold);
  return p;
}
test.after(() => fs.rmSync(mappe, { recursive: true, force: true }));

// --- the file ------------------------------------------------------------------------------------------------------

test('the filled Danish and English templates parse: subject from the Emne/Subject line, the rest as the text, headings as plain lines', () => {
  const da = laesBeskedFil(udfyldt('da'));
  assert.equal(da.sprog, 'da');
  assert.equal(da.emne, 'Vigtig besked om din Clawco: fylder-emne');
  assert.ok(da.tekst.startsWith('Hej,'), da.tekst.slice(0, 40));
  assert.ok(da.tekst.includes('\nHvad der er sket\n'), 'a ## heading becomes a plain line');
  assert.ok(da.tekst.trimEnd().endsWith('Henrik Lambert, Clawco'));
  assert.ok(!da.tekst.includes('Udkast, ikke juridisk'), 'the note above the subject is not part of the mail');
  assert.ok(!da.tekst.includes('##') && !da.tekst.includes('**'));
  const en = laesBeskedFil(udfyldt('en'));
  assert.equal(en.sprog, 'en');
  assert.equal(en.emne, 'Important notice about your Clawco: fylder-emne');
  assert.ok(en.tekst.includes('\nWhat happened\n'));
});

test('an unresolved placeholder is refused and named, wherever it stands', () => {
  assert.throws(() => laesBeskedFil(skabelon('da')), (e: unknown) => e instanceof BeskedFejl && /udfyldt/.test(e.message) && e.message.includes('[EMNE]'));
  assert.throws(() => laesBeskedFil(udfyldt().replace('fylder-tiltag', '[TILTAG]')), /\[TILTAG\]/);
  assert.throws(() => laesBeskedFil('**Emne:** Hej [EMNE]\n\nTekst.'), /\[EMNE\]/);
  assert.throws(() => laesBeskedFil('**Emne:** Hej\n\nSe [her](https://eksempel.test).'), /\[her\]/, 'a markdown link is not supported either');
});

test('markup, an empty subject or text, a missing subject line and the limits are refused', () => {
  const nej = (t: string, m: RegExp) => assert.throws(() => laesBeskedFil(t), (e: unknown) => e instanceof BeskedFejl && m.test(e.message), t.slice(0, 40));
  nej('**Emne:** Hej\n\nTekst med <b>fed</b>.', /<|markup|HTML/i);
  nej('**Emne:** Hej <script>\n\nTekst.', /<|markup|HTML/i);
  nej('**Emne:** Hej\n\nTekst {{titel}}.', /markup|pladsholder|\{\{/i);
  nej('**Emne:**   \n\nTekst.', /emne/i);
  nej('**Emne:** Hej\n\n   \n', /tekst|brødtekst/i);
  nej('# Ingen emnelinje\n\nTekst.', /emne/i);
  nej(`**Emne:** ${'x'.repeat(151)}\n\nTekst.`, /emne/i);
  nej(`**Emne:** Hej\n\n${'x'.repeat(4001)}`, /4000/);
  nej('**Emne:** Hej\n\nTekst\u202Emed tegn.', /tegn/i);
  assert.doesNotThrow(() => laesBeskedFil(`**Emne:** Hej\n\n${'x'.repeat(4000)}`));
  assert.equal(laesBeskedFil('Emne: Hej\r\n\r\nLinje et.\r\nLinje to.\r\n').tekst, 'Linje et.\nLinje to.');
});

// --- recipients ----------------------------------------------------------------------------------------------------

type Verden = { db: Database; post: ReturnType<typeof falskPost>; u: ReturnType<typeof ur>; ids: Record<string, number> };

async function lavKunde(db: Database, email: string, slug: string | null, nu: Date, gave = true): Promise<number> {
  const { konto } = await findEllerOpretKonto(db, email, nu);
  if (gave) await saetGave(db, konto.id, 'sky-husstand', priser, nu);
  if (slug) {
    await db.query("INSERT INTO flaade.tenant (slug, ejer_konto_id, driver, tilstand, bestilt, oprettet, opdateret) VALUES ($1, $2, 'lokal', 'klar', $3, $3, $3)", [slug, konto.id, nu.toISOString()]);
  }
  return konto.id;
}

async function verden(): Promise<Verden> {
  const db = await nyDb();
  const u = ur();
  const nu = u.nu();
  const ids = {
    anna: await lavKunde(db, 'anna@kunde.test', 'hus-aaaaaaaa', nu),
    bo: await lavKunde(db, 'bo@kunde.test', 'hus-bbbbbbbb', nu),
    cai: await lavKunde(db, 'cai@kunde.test', 'hus-cccccccc', nu),
    pause: await lavKunde(db, 'pause@kunde.test', null, nu),
    ingen: await lavKunde(db, 'ingen@kunde.test', null, nu, false),
    slettet: await lavKunde(db, 'slettet@kunde.test', 'hus-dddddddd', nu),
  };
  await db.query("UPDATE abonnement.rettigheder SET status = 'pause' WHERE konto_id = $1", [ids.pause]);
  await db.query("UPDATE konto SET email = NULL, slettet_ved = $2 WHERE id = $1", [ids.slettet, nu.toISOString()]);
  return { db, post: falskPost(), u, ids };
}

const modtagere = (v: Verden): string[] => v.post.udbakke.map((b) => b.til).sort();
const stille = () => { const linjer: string[] = []; return { linjer, ud: (l: string) => { linjer.push(l); } }; };

test('a dry run looks up the recipients and sends nothing, and records nothing', async () => {
  const v = await verden();
  const { linjer, ud } = stille();
  const r = await beskedTilKunder(v.db, v.post, { fil: fil(udfyldt()), modtagere: { slugs: ['hus-aaaaaaaa', 'hus-bbbbbbbb'] }, send: false, nu: v.u.nu(), ud });
  assert.deepEqual(r, { modtagere: 2, sendt: 0, fejlede: 0, sprunget: 0 });
  assert.equal(v.post.udbakke.length, 0);
  assert.equal(await antal(v.db, 'udsendte_mails'), 0);
  assert.ok(linjer.some((l) => /2 modtagere/.test(l)));
  assert.ok(linjer.some((l) => /prøvekørsel|--send/i.test(l)), 'says that it was a dry run');
  await v.db.close();
});

test('named slugs go to those tenants\' owners; duplicates and the same owner twice count once', async () => {
  const v = await verden();
  const r = await beskedTilKunder(v.db, v.post, { fil: fil(udfyldt()), modtagere: { slugs: ['hus-bbbbbbbb', 'hus-aaaaaaaa', 'hus-bbbbbbbb'] }, send: true, nu: v.u.nu(), ud: () => {} });
  assert.deepEqual(r, { modtagere: 2, sendt: 2, fejlede: 0, sprunget: 0 });
  assert.deepEqual(modtagere(v), ['anna@kunde.test', 'bo@kunde.test']);
  await v.db.close();
});

test('an unknown or malformed slug, or a tenant whose owner is deleted, refuses the whole run before anything is sent', async () => {
  const v = await verden();
  for (const slugs of [['hus-aaaaaaaa', 'hus-eeeeeeee'], ['ikke-et-id'], ['hus-dddddddd'], []]) {
    await assert.rejects(beskedTilKunder(v.db, v.post, { fil: fil(udfyldt()), modtagere: { slugs }, send: true, nu: v.u.nu(), ud: () => {} }), BeskedFejl, JSON.stringify(slugs));
  }
  assert.equal(v.post.udbakke.length, 0);
  assert.equal(await antal(v.db, 'udsendte_mails'), 0);
  await v.db.close();
});

test('--alle is every account with a live entitlement: not paused, not without one, never a deleted account', async () => {
  const v = await verden();
  const r = await beskedTilKunder(v.db, v.post, { fil: fil(udfyldt()), modtagere: { alle: true }, send: true, nu: v.u.nu(), ud: () => {} });
  assert.deepEqual(r, { modtagere: 3, sendt: 3, fejlede: 0, sprunget: 0 });
  assert.deepEqual(modtagere(v), ['anna@kunde.test', 'bo@kunde.test', 'cai@kunde.test']);
  await v.db.close();
});

test('--alle with nobody to write to refuses', async () => {
  const db = await nyDb();
  await assert.rejects(beskedTilKunder(db, falskPost(), { fil: fil(udfyldt()), modtagere: { alle: true }, send: true, nu: ur().nu(), ud: () => {} }), /ingen modtagere/i);
  await db.close();
});

// --- sending -------------------------------------------------------------------------------------------------------

test('send: one mail per recipient through the mailer with the file\'s subject and text, the help mailbox as reply-to and the Danish footer', async () => {
  const v = await verden();
  const kilde = udfyldt('da');
  const f = laesBeskedFil(kilde);
  const r = await beskedTilKunder(v.db, v.post, { fil: fil(kilde), modtagere: { slugs: ['hus-aaaaaaaa'] }, send: true, nu: v.u.nu(), ud: () => {} });
  assert.equal(r.sendt, 1);
  const b = v.post.udbakke[0]!;
  assert.equal(b.skabelon, 'driftsbesked');
  assert.equal(b.sprog, 'da');
  assert.equal(b.svarTil, HJAELP.postkasse);
  assert.deepEqual(b.data, { titel: f.emne, tekst: f.tekst });
  const m = renderBesked(b);
  assert.equal(m.emne, f.emne);
  assert.ok(m.tekst.includes(f.tekst), 'the operator\'s text is in the mail as written');
  assert.match(m.tekst, /Du får denne mail, fordi du har en konto hos Clawco/);
  const en = laesBeskedFil(udfyldt('en'));
  await beskedTilKunder(v.db, v.post, { fil: fil(udfyldt('en')), modtagere: { slugs: ['hus-bbbbbbbb'] }, send: true, nu: v.u.nu(), ud: () => {} });
  const mEn = renderBesked(v.post.udbakke[1]!);
  assert.equal(mEn.emne, en.emne);
  assert.match(mEn.tekst, /You are getting this mail because you have a Clawco account/);
  await v.db.close();
});

test('no address is printed or logged: stdout shows counts, the text once and the file\'s sha256', async () => {
  const v = await verden();
  const kilde = udfyldt();
  const { linjer, ud } = stille();
  const logget: string[] = [];
  const orig = { log: console.log, error: console.error };
  console.log = (...a: unknown[]) => { logget.push(a.join(' ')); };
  console.error = (...a: unknown[]) => { logget.push(a.join(' ')); };
  try {
    await beskedTilKunder(v.db, v.post, { fil: fil(kilde), modtagere: { alle: true }, send: true, nu: v.u.nu(), ud });
  } finally { console.log = orig.log; console.error = orig.error; }
  const alt = linjer.join('\n') + '\n' + logget.join('\n');
  assert.ok(!/@kunde\.test/.test(alt), 'an address was printed');
  const f = laesBeskedFil(kilde);
  assert.equal(alt.split(f.tekst).length - 1, 1, 'the text is shown exactly once');
  const sha = createHash('sha256').update(kilde).digest('hex');
  assert.ok(alt.includes(sha), 'the file\'s sha256 is logged');
  assert.ok(linjer.some((l) => /^sky besked: 3 modtagere, 3 sendt, 0 fejlede/.test(l)), linjer.join('|'));
  await v.db.close();
});

test('the same file never goes twice to the same account: a second run skips them, a changed text goes out again', async () => {
  const v = await verden();
  const k = fil(udfyldt());
  const a = { modtagere: { alle: true as const }, send: true, nu: v.u.nu(), ud: () => {} };
  assert.equal((await beskedTilKunder(v.db, v.post, { fil: k, ...a })).sendt, 3);
  assert.deepEqual(await beskedTilKunder(v.db, v.post, { fil: k, ...a }), { modtagere: 3, sendt: 0, fejlede: 0, sprunget: 3 });
  assert.equal(v.post.udbakke.length, 3);
  const nyt = await beskedTilKunder(v.db, v.post, { fil: fil(udfyldt() + '\nEn opfølgning.\n'), ...a });
  assert.equal(nyt.sendt, 3);
  await v.db.close();
});

test('a refused mail is counted, given back, and a rerun sends only to those who did not get it', async () => {
  const v = await verden();
  const k = fil(udfyldt());
  const a = { modtagere: { alle: true as const }, send: true, nu: v.u.nu(), ud: () => {} };
  const grim: Post = { async send(b) { if (b.til === 'bo@kunde.test') throw new PostFejl('afvist', 'afvist'); return v.post.send(b); } };
  const r = await beskedTilKunder(v.db, grim, { fil: k, ...a });
  assert.deepEqual(r, { modtagere: 3, sendt: 2, fejlede: 1, sprunget: 0 });
  v.u.frem(1000);
  const igen = await beskedTilKunder(v.db, v.post, { fil: k, ...a, nu: v.u.nu() });
  assert.deepEqual(igen, { modtagere: 3, sendt: 1, fejlede: 0, sprunget: 2 });
  assert.deepEqual(modtagere(v), ['anna@kunde.test', 'bo@kunde.test', 'cai@kunde.test']);
  await v.db.close();
});

test('a failure that will repeat for everyone (no provider, a bad key) stops the run at once; the rest count as not sent', async () => {
  const v = await verden();
  let kald = 0;
  const ingen: Post = { async send() { kald++; throw new PostFejl('ingen-udbyder', 'ingen'); } };
  const r = await beskedTilKunder(v.db, ingen, { fil: fil(udfyldt()), modtagere: { alle: true }, send: true, nu: v.u.nu(), ud: () => {} });
  assert.equal(kald, 1);
  assert.deepEqual(r, { modtagere: 3, sendt: 0, fejlede: 3, sprunget: 0 });
  await v.db.close();
});

test('a bad file refuses before any recipient is looked up or any mail is sent', async () => {
  const v = await verden();
  await assert.rejects(beskedTilKunder(v.db, v.post, { fil: fil(skabelon('da')), modtagere: { alle: true }, send: true, nu: v.u.nu(), ud: () => {} }), BeskedFejl);
  await assert.rejects(beskedTilKunder(v.db, v.post, { fil: path.join(mappe, 'findes-ikke.md'), modtagere: { alle: true }, send: true, nu: v.u.nu(), ud: () => {} }), BeskedFejl);
  assert.equal(v.post.udbakke.length, 0);
  await v.db.close();
});

test('the confirmation sits between the text and the sending: no answer, no mail', async () => {
  const v = await verden();
  const a = { fil: fil(udfyldt()), modtagere: { alle: true as const }, send: true, nu: v.u.nu(), ud: () => {} };
  await assert.rejects(beskedTilKunder(v.db, v.post, { ...a, bekraeft: async () => false }), /afbrudt/i);
  assert.equal(v.post.udbakke.length, 0);
  assert.equal((await beskedTilKunder(v.db, v.post, { ...a, bekraeft: async () => true })).sendt, 3);
  await v.db.close();
});

// --- the command line ----------------------------------------------------------------------------------------------

test('kommando: usage errors exit 2 and change nothing; a refusal exits 1; a dry run exits 0', async () => {
  const v = await verden();
  const k = fil(udfyldt());
  const koer = async (argv: string[], bekraeft = async () => true) => { const s = stille(); const kode = await kommando(argv, v.db, v.post, v.u.nu(), s.ud, bekraeft); return { kode, ud: s.linjer.join('\n') }; };
  for (const argv of [[], [k], [k, '--send'], [k, '--alle', '--slug', 'hus-aaaaaaaa'], [k, '--slug'], [k, '--ukendt'], [k, k, '--alle'], ['--alle']]) {
    const r = await koer(argv);
    assert.equal(r.kode, 2, JSON.stringify(argv));
    assert.match(r.ud, /brug:/);
  }
  assert.equal((await koer([fil(skabelon('da')), '--alle'])).kode, 1);
  assert.equal((await koer([k, '--slug', 'hus-eeeeeeee'])).kode, 1);
  const tor = await koer([k, '--alle']);
  assert.equal(tor.kode, 0);
  assert.equal(v.post.udbakke.length, 0, 'without --send nothing is sent');
  assert.match(tor.ud, /3 modtagere/);
  await v.db.close();
});

test('kommando --send: sends after a yes, sends nothing after a no (exit 1); --slug takes several ids, repeated or in a row', async () => {
  const v = await verden();
  const k = fil(udfyldt());
  const s = stille();
  assert.equal(await kommando([k, '--slug', 'hus-aaaaaaaa', '--send'], v.db, v.post, v.u.nu(), s.ud, async () => false), 1);
  assert.equal(v.post.udbakke.length, 0);
  assert.equal(await kommando([k, '--slug', 'hus-aaaaaaaa', 'hus-bbbbbbbb', '--slug', 'hus-cccccccc', '--send'], v.db, v.post, v.u.nu(), s.ud, async () => true), 0);
  assert.deepEqual(modtagere(v), ['anna@kunde.test', 'bo@kunde.test', 'cai@kunde.test']);
  await v.db.close();
});
