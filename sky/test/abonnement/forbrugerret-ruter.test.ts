// KC-0209 over HTTP: the statement before the pay button with its two unticked boxes (and the server-side refusal
// without them), the stored order, "Opsig" and "Fortryd aftale" with their confirmation steps, and the receipt a
// webhook triggers. Fake Stripe, fake mail, PGlite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stativ, haendelse, EMAIL, type Stativ } from './stativ.ts';
import { app, SAELGER, VILKAAR_URL, VILKAAR_VERSION } from './appstativ.ts';
import { falskPost } from '../../src/delt/post.ts';
import { aabneRefusioner, hentBestilling } from '../../src/abonnement/bestilling.ts';

const DAG = 86_400_000;
const SOLO = { plan: 'sky-solo', interval: 'maaned', land: 'DK' };
const BEKRAEFT = '/konto/abonnement/bekraeft?plan=sky-solo&interval=maaned&land=DK';
const sessioner = (s: Stativ) => s.klient.kald.filter((k) => k.metode === 'opretCheckout');
const ordrer = async (s: Stativ) => s.db.query<{ n: number }>('SELECT count(*)::int AS n FROM abonnement.bestilling');
const tagsMed = (html: string, tag: string): string[] => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map((m) => m[0]);

async function betalt(s: Stativ, a: ReturnType<typeof app>, felter: Record<string, string> = SOLO): Promise<string> {
  await s.db.query('UPDATE abonnement.kunde SET proeve_brugt = true');
  const r = await a.vaelg(felter);
  assert.equal(r.status, 303);
  const id = new URL(r.headers.get('location')!).pathname.split('/').at(-1)!;
  s.klient.fuldfoerCheckout(id, s.u.nu());
  const h = haendelse('customer.subscription.created', s.kunde);
  assert.equal((await a.webhook(h.raw, h.signatur)).status, 200);
  return id;
}

// --- The statement ----------------------------------------------------------------------------------
test('the statement shows service, the full price (no VAT line, G6), period, renewal, the 14 days, a link to the terms, and two unticked boxes', async () => {
  const s = await stativ();
  const r = await app(s).side(BEKRAEFT);
  assert.equal(r.status, 200);
  const t = await r.text();
  assert.match(t, /Clawco Sky, Sky Solo\. Til 1 person\./);
  assert.match(t, /79 kr\. om måneden\. Det er den fulde pris\./);
  assert.match(t, /Prøven varer 14 dage\. Du taster intet kort, og der trækkes ingen penge\./);
  assert.match(t, /fornyes automatisk hver måned til samme pris \(79 kr\.\)/);
  assert.match(t, /Du har 14 dages fortrydelsesret fra den dag, du køber\. Du fortryder med knappen &quot;Fortryd aftale&quot; på din kontoside\./);
  assert.ok(t.includes(`href="${VILKAAR_URL}"`));
  const bokse = tagsMed(t, 'input').filter((i) => /type="checkbox"/.test(i));
  assert.equal(bokse.length, 2);
  for (const b of bokse) { assert.doesNotMatch(b, /\bchecked\b/, 'unticked by default'); assert.match(b, /\brequired\b/); }
  assert.ok(bokse.some((b) => b.includes(`name="vilkaar" value="${VILKAAR_VERSION}"`)));
  assert.ok(bokse.some((b) => b.includes('name="straks" value="ja"')));
  assert.match(t, /Jeg har læst og accepterer <a [^>]*>vilkårene<\/a> \(version 0\.1-udkast\)/);
  assert.match(t, /Jeg beder udtrykkeligt om, at tjenesten starter med det samme\. Jeg ved, at jeg mister fortrydelsesretten, når tjenesten er leveret fuldt ud, og at jeg betaler for det, der er leveret indtil da, hvis jeg fortryder efter start\./);
  assert.match(t, /Forbrugeraftaleloven § 18, stk\. 2, nr\. 2 og § 25/);
  assert.match(t, /<button type="submit" class="primaer">Start 14 dages gratis prøve<\/button>/);
  assert.doesNotMatch(t, /moms|\bVAT\b/i, 'no VAT is mentioned while moms.aktiv is false (KC-0194, G6)');
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('the button says what it does: the amount to pay for a paid start, per interval, from the one price file', async () => {
  const s = await stativ();
  await s.db.query('UPDATE abonnement.kunde SET proeve_brugt = true');
  const maaned = await (await app(s).side(BEKRAEFT)).text();
  assert.match(maaned, />Betal 79 kr\. og start nu<\/button>/);
  assert.match(maaned, /Du betaler 79 kr\. nu for den første måned, og abonnementet starter med det samme\./);
  const aar = await (await app(s).side('/konto/abonnement/bekraeft?plan=sky-husstand&interval=aar&land=DK')).text();
  assert.match(aar, />Betal 1\.290 kr\. og start nu<\/button>/);
  assert.match(aar, /1\.290 kr\. om året\. Det er den fulde pris/);
  assert.match(aar, /fornyes automatisk hvert år til samme pris \(1\.290 kr\.\)/);
});

test('the statement follows the account language', async () => {
  const s = await stativ();
  const t = await (await app(s, { sprog: 'en' }).side(BEKRAEFT)).text();
  assert.match(t, /<html lang="en">/);
  assert.match(t, /DKK 79 per month\. This is the full price\./);
  assert.match(t, /I have read and accept the <a [^>]*>terms<\/a> \(version 0\.1-udkast\)/);
  assert.match(t, /I expressly ask that the service starts immediately\./);
  assert.match(t, /Start the 14-day free trial/);
  assert.ok(t.includes('href="https://clawco.example.test/en/vilkaar"'));
});

test('the statement needs a login, a real plan and the owner; an account with a running subscription goes to its status instead', async () => {
  const s = await stativ();
  const a = app(s);
  const ud = await a.side(BEKRAEFT, false);
  assert.equal(ud.status, 303);
  assert.equal(ud.headers.get('location'), '/log-ind?til=/konto/abonnement');
  assert.equal((await a.side('/konto/abonnement/bekraeft?plan=findes-ikke&interval=maaned&land=DK')).headers.get('location'), '/konto/abonnement');
  assert.equal((await a.side('/konto/abonnement/bekraeft?plan=sky-solo&interval=maaned&land=XX')).headers.get('location'), '/konto/abonnement');
  assert.equal((await app(s, { rolle: { rolle: 'medlem', antal: 2 } }).side(BEKRAEFT)).status, 403);
  assert.equal((await app(s, { tilPlan: async () => false }).side(BEKRAEFT)).headers.get('location'), '/tilmeld');
  await betalt(s, a);
  assert.equal((await a.side(BEKRAEFT)).headers.get('location'), '/konto/abonnement');
});

// --- The refusal and the stored order ---------------------------------------------------------------
test('submitting without both boxes is refused by the server: nothing is created at Stripe and nothing is stored', async () => {
  const s = await stativ();
  const a = app(s);
  const foer = s.klient.kald.length;
  const refused: [string, Record<string, string> | null][] = [
    ['no boxes at all', null],
    ['only the terms', { vilkaar: VILKAAR_VERSION }],
    ['only the immediate start', { straks: 'ja' }],
    ['an old terms version', { vilkaar: '0.0', straks: 'ja' }],
    ['the start box with another value', { vilkaar: VILKAAR_VERSION, straks: 'nej' }],
    ['empty values', { vilkaar: '', straks: '' }],
  ];
  for (const [navn, samtykke] of refused) {
    const r = await a.vaelg(SOLO, { samtykke });
    assert.equal(r.status, 400, navn);
    const t = await r.text();
    assert.match(t, /Sæt kryds i begge felter, før du går videre\. Uden dem starter vi ikke noget\./, navn);
    assert.match(t, /name="straks"/, `${navn}: the statement is shown again`);
  }
  assert.equal(s.klient.kald.length, foer, 'not a single write call reached Stripe');
  assert.equal((await ordrer(s))[0]?.n, 0);
});

test('with both boxes the order is stored with the terms version, the price shown and when both were ticked', async () => {
  const s = await stativ();
  const a = app(s);
  const r = await a.vaelg(SOLO);
  assert.equal(r.status, 303);
  assert.match(r.headers.get('location') ?? '', /^https:\/\/checkout\.stripe\.test\/c\/cs_falsk_/);
  const session = new URL(r.headers.get('location')!).pathname.split('/').at(-1)!;
  const [rk] = await s.db.query<{ id: unknown }>('SELECT id FROM abonnement.bestilling WHERE checkout_session = $1', [session]);
  const b = await hentBestilling(s.db, Number(rk!.id));
  assert.equal(b?.vilkaarVersion, VILKAAR_VERSION);
  assert.equal(b?.vilkaarSamtykkeVed.toISOString(), s.u.nu().toISOString());
  assert.equal(b?.straksStartSamtykkeVed.toISOString(), s.u.nu().toISOString());
  assert.deepEqual([b?.plan, b?.interval, b?.prisOere, b?.proeve, b?.sprog], ['sky-solo', 'maaned', 7900, true, 'da']);
  assert.equal(b?.kontoId, s.kontoId);
});

test('a double click is one order and one session', async () => {
  const s = await stativ();
  const a = app(s);
  await Promise.all([a.vaelg(SOLO), a.vaelg(SOLO)]);
  assert.equal((await ordrer(s))[0]?.n, 1);
});

test('what the page said is what happens: a changed price or trial since the page was shown is shown again, never charged', async () => {
  const s = await stativ();
  const a = app(s);
  const gammel = await a.vaelg({ ...SOLO, pris: '9900', proeve: '1' });
  assert.equal(gammel.status, 409);
  assert.match(await gammel.text(), /Prisen eller prøven er ændret, siden du valgte\./);
  const proeve = await a.vaelg({ ...SOLO, pris: '7900', proeve: '0' });
  assert.equal(proeve.status, 409, 'the page promised no trial, but one would start');
  assert.equal(sessioner(s).length, 0);
  assert.equal((await ordrer(s))[0]?.n, 0);
  assert.equal((await a.vaelg({ ...SOLO, pris: '7900', proeve: '1' })).status, 303);
});

test('Stripe holding another amount than the price file is refused: the person is never charged what was not shown', async () => {
  const s = await stativ();
  await s.klient.opretPris({ produkt: 'clawco-sky-solo', navn: 'x', lookupKey: 'clawco-sky-solo-maaned', dkk: 9900, eur: 1300, interval: 'month', metadata: { clawco: 'ja' }, transferLookupKey: true, momsInkl: false }, 'afvigende');
  const r = await app(s).vaelg(SOLO);
  assert.equal(r.status, 503);
  assert.equal(sessioner(s).length, 0);
  assert.equal((await ordrer(s))[0]?.n, 0);
});

// --- KC-0194: currency by country ----------------------------------------------------------------------
test('KC-0194: a German account sees euro on the statement, Checkout charges euro, and the order keeps the euro amount it showed', async () => {
  const s = await stativ();
  await s.db.query('UPDATE abonnement.kunde SET proeve_brugt = true');
  const a = app(s, { sprog: 'en' });
  const t = await (await a.side('/konto/abonnement/bekraeft?plan=sky-solo&interval=maaned&land=DE')).text();
  assert.match(t, /€10\.60 per month\. This is the full price\./);
  assert.match(t, />Pay €10\.60 and start now<\/button>/);
  assert.doesNotMatch(t, /DKK|kr\./, 'a EUR customer is never shown a DKK amount');
  assert.doesNotMatch(t, /moms|\bVAT\b/i);
  assert.ok(t.includes('name="pris" value="1060"'));
  const r = await a.vaelg({ plan: 'sky-solo', interval: 'maaned', land: 'DE', pris: '1060', proeve: '0' });
  assert.equal(r.status, 303);
  const [kald] = sessioner(s);
  assert.equal((kald?.args as { currency?: string }).currency, 'eur');
  const session = new URL(r.headers.get('location')!).pathname.split('/').at(-1)!;
  const [rk] = await s.db.query<{ id: unknown }>('SELECT id FROM abonnement.bestilling WHERE checkout_session = $1', [session]);
  const b = await hentBestilling(s.db, Number(rk!.id));
  assert.deepEqual([b?.prisOere, b?.valuta], [1060, 'eur']);
});

test('KC-0194: a Danish account is never sent a EUR session (and its order is in kroner)', async () => {
  const s = await stativ();
  const r = await app(s).vaelg(SOLO);
  assert.equal(r.status, 303);
  assert.equal((sessioner(s)[0]?.args as { currency?: string }).currency, 'dkk');
  const [rk] = await s.db.query<{ valuta: string; pris_oere: number }>('SELECT valuta, pris_oere FROM abonnement.bestilling');
  assert.deepEqual([rk?.valuta, rk?.pris_oere], ['dkk', 7900]);
});

test('KC-0194: Stripe holding another EUR amount than the price file refuses a EUR Checkout, even when the DKK amount matches', async () => {
  const s = await stativ();
  await s.klient.opretPris({ produkt: 'clawco-sky-solo', navn: 'x', lookupKey: 'clawco-sky-solo-maaned', dkk: 7900, eur: 1300, interval: 'month', metadata: { clawco: 'ja' }, transferLookupKey: true, momsInkl: false }, 'afvigende-eur');
  const r = await app(s).vaelg({ plan: 'sky-solo', interval: 'maaned', land: 'DE' });
  assert.equal(r.status, 503);
  assert.equal(sessioner(s).length, 0);
});

// --- Receipt after the webhook ---------------------------------------------------------------------
test('the webhook of a purchase sends one receipt with seller, price, cancel and withdraw and the accepted terms; a second event sends none', async () => {
  const s = await stativ();
  const post = falskPost();
  const a = app(s, { post });
  await betalt(s, a);
  const kv = post.udbakke.filter((m) => m.skabelon === 'kvittering');
  assert.equal(kv.length, 1);
  assert.equal(kv[0]?.til, EMAIL);
  assert.equal(kv[0]?.data['saelger'], SAELGER);
  assert.equal(kv[0]?.data['vilkaarversion'], VILKAAR_VERSION);
  assert.equal(kv[0]?.data['vilkaarlink'], VILKAAR_URL);
  const h = haendelse('invoice.paid', s.kunde);
  await a.webhook(h.raw, h.signatur);
  assert.equal(post.udbakke.filter((m) => m.skabelon === 'kvittering').length, 1);
});

test('a failing mail never fails the webhook', async () => {
  const s = await stativ();
  const post = falskPost();
  post.fejl = true;
  await betalt(s, app(s, { post }));
  assert.equal(post.udbakke.length, 0);
});

// --- Opsig ------------------------------------------------------------------------------------------
test('Opsig: a confirmation screen with the end date, then the cancellation, the screen and the mail', async () => {
  const s = await stativ();
  const post = falskPost();
  const a = app(s, { post });
  await betalt(s, a);
  const side = await a.side('/konto/abonnement/opsig');
  assert.equal(side.status, 200);
  const t = await side.text();
  assert.match(t, /Siger du op nu, slutter abonnementet 1\. december 2026\. Du har adgang til din Clawco, til det er slut/);
  assert.match(t, /action="\/api\/abonnement\/opsig"/);
  assert.match(t, /Ja, opsig abonnementet/);
  assert.equal((await s.klient.listAbonnementer(s.kunde))[0]?.opsigVedPeriodeslut, false, 'viewing the page changes nothing');
  assert.equal((await a.send('/api/abonnement/opsig', {}, { csrf: 'forkert' })).status, 403);
  assert.equal((await a.send('/api/abonnement/opsig', {}, { origin: 'https://evil.example.test' })).status, 403);
  const r = await a.send('/api/abonnement/opsig', {});
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Abonnementet er opsagt[\s\S]*Det slutter 1\. december 2026\. Du har adgang til din Clawco, til det er slut\. Bekræftelsen er sendt på mail\./);
  assert.equal((await s.klient.listAbonnementer(s.kunde))[0]?.opsigVedPeriodeslut, true);
  assert.equal(post.udbakke.filter((m) => m.skabelon === 'opsigelse').length, 1);
  const igen = await (await a.send('/api/abonnement/opsig', {})).text();
  assert.match(igen, /Abonnementet er allerede opsagt/);
  assert.equal(post.udbakke.filter((m) => m.skabelon === 'opsigelse').length, 1);
});

test('Opsig without a running subscription says so; a member is told to ask the owner; a Stripe failure changes nothing and says so', async () => {
  const s = await stativ();
  const a = app(s);
  assert.match(await (await a.side('/konto/abonnement/opsig')).text(), /Der er intet at opsige/);
  assert.equal((await app(s, { rolle: { rolle: 'medlem', antal: 2 } }).side('/konto/abonnement/opsig')).status, 403);
  assert.equal((await a.side('/konto/abonnement/opsig', false)).status, 303);
  await betalt(s, a);
  s.klient.fejlNaeste('opsigVedPeriodeslut', 'stripe er nede');
  const r = await a.send('/api/abonnement/opsig', {});
  assert.equal(r.status, 502);
  assert.match(await r.text(), /Vi kunne ikke opsige abonnementet lige nu\. Intet er ændret\./);
  assert.equal((await s.klient.listAbonnementer(s.kunde))[0]?.opsigVedPeriodeslut, false);
});

// --- Fortryd aftale ---------------------------------------------------------------------------------
test('Fortryd aftale: the screen shows the amounts and "Vi tilbagebetaler inden for 14 dage"; one confirmation records, cancels, mails and creates the refund task', async () => {
  const s = await stativ();
  const post = falskPost();
  const a = app(s, { post });
  await betalt(s, a);
  s.u.frem(4 * DAG + 3_600_000);
  const side = await a.side('/konto/abonnement/fortryd');
  assert.equal(side.status, 200);
  const t = await side.text();
  assert.match(t, /Du kan fortryde aftalen til og med 14\. november 2026\./);
  assert.match(t, /Du har brugt 5 af 30 dage\. Du betaler 13,17 kr\. for det, du har brugt, og får 65,83 kr\. tilbage\./);
  assert.match(t, /Vi tilbagebetaler inden for 14 dage\./);
  assert.match(t, /action="\/api\/abonnement\/fortryd"/);
  assert.match(t, /Bekræft: fortryd aftalen/);
  assert.equal((await aabneRefusioner(s.db)).length, 0, 'the screen alone records nothing');
  assert.equal((await a.send('/api/abonnement/fortryd', {}, { csrf: 'forkert' })).status, 403);
  const r = await a.send('/api/abonnement/fortryd', {});
  assert.equal(r.status, 200);
  const k = await r.text();
  assert.match(k, /Du har fortrudt aftalen/);
  assert.match(k, /Vi har registreret din fortrydelse .*og opsagt abonnementet\. Din kvittering er sendt på mail\./);
  assert.match(k, /Vi tilbagebetaler inden for 14 dage\./);
  assert.equal((await s.klient.listAbonnementer(s.kunde))[0]?.status, 'canceled');
  assert.equal(post.udbakke.filter((m) => m.skabelon === 'fortrydelse').length, 1);
  const [opgave] = await aabneRefusioner(s.db);
  assert.equal(opgave?.beloebOere, 6583);
  assert.match(await (await a.send('/api/abonnement/fortryd', {})).text(), /Du har allerede fortrudt aftalen/);
  assert.equal((await aabneRefusioner(s.db)).length, 1);
});

test('after the 14 days the Fortryd screen says the right has expired and the button is gone', async () => {
  const s = await stativ();
  const a = app(s);
  await betalt(s, a);
  s.u.frem(16 * DAG);
  const t = await (await a.side('/konto/abonnement/fortryd')).text();
  assert.match(t, /Fortrydelsesretten er udløbet/);
  assert.doesNotMatch(t, /<form/);
  const r = await a.send('/api/abonnement/fortryd', {});
  assert.match(await r.text(), /Fortrydelsesretten er udløbet/);
  assert.equal((await aabneRefusioner(s.db)).length, 0);
  assert.equal((await s.klient.listAbonnementer(s.kunde))[0]?.status, 'active');
});

test('a Stripe failure during Fortryd keeps the request and says to press again', async () => {
  const s = await stativ();
  const a = app(s);
  await betalt(s, a);
  s.klient.fejlNaeste('opsigAbonnement', 'stripe er nede');
  const r = await a.send('/api/abonnement/fortryd', {});
  assert.equal(r.status, 502);
  assert.match(await r.text(), /Din fortrydelse er registreret, men vi kunne ikke opsige abonnementet lige nu\. Tryk på knappen igen om lidt/);
  assert.equal((await aabneRefusioner(s.db)).length, 1);
  assert.match(await (await a.send('/api/abonnement/fortryd', {})).text(), /Du har fortrudt aftalen/);
  assert.equal((await aabneRefusioner(s.db)).length, 1);
});

test('the status page of a running subscription offers both Opsig and Fortryd aftale while the 14 days run, and only Opsig afterwards', async () => {
  const s = await stativ();
  const a = app(s);
  await betalt(s, a);
  const t = await (await a.side('/konto/abonnement')).text();
  assert.match(t, /href="\/konto\/abonnement\/opsig">Opsig abonnement</);
  assert.match(t, /href="\/konto\/abonnement\/fortryd">Fortryd aftale</);
  s.u.frem(20 * DAG);
  const sen = await (await a.side('/konto/abonnement')).text();
  assert.match(sen, /Opsig abonnement/);
  assert.doesNotMatch(sen, /Fortryd aftale/);
});
