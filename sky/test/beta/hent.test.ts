// KC-0203: the daily pull of the beta measures from each klar beta tenant. Invariants: a pull that does not fit the
// closed schema stores nothing; without consent only feedback is stored (and numbers held from an earlier consent are
// cleared); a tenant that does not answer is skipped and counted, never a failure of the whole pass; hand-given gifts
// and paying customers are never pulled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hentMaal, hentLoekke, MAAL_STI, type HentDeps } from '../../src/beta/hent.ts';
import { opsaetBeta, DAG } from './hjaelp.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { saetGave } from '../../src/abonnement/synk.ts';
import { laesPriser } from '../../src/abonnement/priser.ts';
import { antal } from '../konto/hjaelp.ts';

type Kald = { slug: string; adresse: string; sti: string };
const MED = {
  version: 1, samtykke: true,
  foersteVaerdi: { kildeForbundetMs: 40_000, foersteVaerdiMs: 90_000 },
  dage: [{ dag: '2026-11-02', kraever: 6 }, { dag: '2026-11-03', kraever: 4 }],
  feedback: [{ dag: 3, vurdering: 4, tekst: 'Fint', betale: null, tid: '2026-11-04T10:00:00Z' }],
};

function deps(b: Awaited<ReturnType<typeof opsaetBeta>>, svar: Record<string, unknown | Error>): { d: HentDeps; kald: Kald[]; log: string[] } {
  const kald: Kald[] = [];
  const log: string[] = [];
  return {
    kald, log,
    d: {
      db: b.db, log: (l) => { log.push(l); },
      hent: async (t, sti) => {
        kald.push({ slug: t.slug, adresse: t.adresse, sti });
        const s = svar[t.slug];
        if (s instanceof Error) throw s;
        return s;
      },
    },
  };
}

test('a consenting tenant: the maal row, the day counts and the feedback are stored; the sign-up time comes from Sky\'s own row', async () => {
  const b = await opsaetBeta();
  const id = await b.husstand('a@example.test', 'hus-aaaaaaaa', { samtykke: true, tilmeldingMs: 75_000 });
  const { d, kald } = deps(b, { 'hus-aaaaaaaa': MED });
  assert.deepEqual(await hentMaal(d, b.u.nu()), { beta: 1, hentet: 1, afvist: 0, udenSvar: 0 });
  assert.deepEqual(kald, [{ slug: 'hus-aaaaaaaa', adresse: 'http://172.18.0.2:8750', sti: MAAL_STI }]);
  const [m] = await b.db.query<Record<string, unknown>>('SELECT * FROM beta.maal WHERE konto_id = $1', [id]);
  assert.equal(m!['samtykke'], true);
  assert.equal(m!['tilmelding_ms'], 75_000);
  assert.equal(m!['kilde_forbundet_ms'], 40_000);
  assert.equal(m!['foerste_vaerdi_ms'], 90_000);
  assert.equal(new Date(m!['hentet'] as string).getTime(), b.u.nu().getTime());
  const dage = await b.db.query<{ dag: Date | string; kraever: number }>('SELECT dag, kraever FROM beta.dagtal WHERE konto_id = $1 ORDER BY dag', [id]);
  assert.deepEqual(dage.map((r) => [new Date(r.dag).toISOString().slice(0, 10), r.kraever]), [['2026-11-02', 6], ['2026-11-03', 4]]);
  const [f] = await b.db.query<Record<string, unknown>>('SELECT dag, vurdering, tekst, betale FROM beta.feedback WHERE konto_id = $1', [id]);
  assert.deepEqual({ ...f }, { dag: 3, vurdering: 4, tekst: 'Fint', betale: null });
  await b.db.close();
});

test('pulling again updates the day counts and never duplicates feedback: the first answer for a day stands', async () => {
  const b = await opsaetBeta();
  const id = await b.husstand('a@example.test', 'hus-aaaaaaaa', { samtykke: true });
  const { d } = deps(b, { 'hus-aaaaaaaa': MED });
  await hentMaal(d, b.u.nu());
  const igen = { ...MED, dage: [{ dag: '2026-11-03', kraever: 1 }, { dag: '2026-11-04', kraever: 2 }], feedback: [{ ...MED.feedback[0]!, vurdering: 1, tekst: 'skiftet' }, { dag: 7, vurdering: 5, tekst: null, betale: 'ja', tid: '2026-11-08T10:00:00Z' }] };
  d.hent = async () => igen;
  await hentMaal(d, b.u.nu());
  const dage = await b.db.query<{ kraever: number }>('SELECT kraever FROM beta.dagtal WHERE konto_id = $1 ORDER BY dag', [id]);
  assert.deepEqual(dage.map((r) => r.kraever), [6, 1, 2]);
  const f = await b.db.query<{ dag: number; vurdering: number; tekst: string | null }>('SELECT dag, vurdering, tekst FROM beta.feedback WHERE konto_id = $1 ORDER BY dag', [id]);
  assert.deepEqual(f.map((r) => [r.dag, r.vurdering, r.tekst]), [[3, 4, 'Fint'], [7, 5, null]]);
  await b.db.close();
});

test('without consent only feedback is stored; numbers held from an earlier consent are cleared (withdrawal)', async () => {
  const b = await opsaetBeta();
  const id = await b.husstand('a@example.test', 'hus-aaaaaaaa', { samtykke: true, tilmeldingMs: 75_000 });
  const { d } = deps(b, { 'hus-aaaaaaaa': MED });
  await hentMaal(d, b.u.nu());
  assert.equal(await antal(b.db, 'beta.dagtal'), 2);
  d.hent = async () => ({ version: 1, samtykke: false, feedback: [{ dag: 7, vurdering: 2, tekst: 'for meget', betale: null, tid: '2026-11-08T10:00:00Z' }] });
  assert.equal((await hentMaal(d, b.u.nu())).hentet, 1);
  const [m] = await b.db.query<Record<string, unknown>>('SELECT * FROM beta.maal WHERE konto_id = $1', [id]);
  assert.equal(m!['samtykke'], false);
  assert.deepEqual([m!['tilmelding_ms'], m!['kilde_forbundet_ms'], m!['foerste_vaerdi_ms']], [null, null, null]);
  assert.equal(await antal(b.db, 'beta.dagtal'), 0);
  assert.equal(await antal(b.db, 'beta.feedback'), 2, 'the feedback the person sent stays');
  await b.db.close();
});

test('a pull with an unknown field or the wrong types is refused: nothing is stored, the others go on, the journal says which', async () => {
  const b = await opsaetBeta();
  await b.husstand('a@example.test', 'hus-aaaaaaaa', { samtykke: true });
  await b.husstand('b@example.test', 'hus-bbbbbbbb', { samtykke: true });
  await b.husstand('c@example.test', 'hus-cccccccc', { samtykke: true });
  const { d, log } = deps(b, { 'hus-aaaaaaaa': { ...MED, titler: ['Tandlæge torsdag'] }, 'hus-bbbbbbbb': { ...MED, dage: [{ dag: 'i går', kraever: '6' }] }, 'hus-cccccccc': MED });
  assert.deepEqual(await hentMaal(d, b.u.nu()), { beta: 3, hentet: 1, afvist: 2, udenSvar: 0 });
  assert.equal(await antal(b.db, 'beta.dagtal'), 2, 'only the third tenant stored anything');
  assert.equal((await b.db.query('SELECT 1 FROM beta.maal WHERE hentet IS NOT NULL')).length, 1);
  assert.ok(log.some((l) => l.includes('hus-aaaaaaaa') && /afvist/.test(l)));
  assert.ok(!log.join('\n').includes('Tandlæge'), 'the refused content is never logged');
  await b.db.close();
});

test('a tenant that does not answer (an error, a refused call) is skipped and counted; the pass never throws', async () => {
  const b = await opsaetBeta();
  await b.husstand('a@example.test', 'hus-aaaaaaaa', { samtykke: true });
  await b.husstand('b@example.test', 'hus-bbbbbbbb', { samtykke: true });
  const { d, log } = deps(b, { 'hus-aaaaaaaa': new Error('kundens Clawco svarede 503 på /api/beta/maal'), 'hus-bbbbbbbb': MED });
  assert.deepEqual(await hentMaal(d, b.u.nu()), { beta: 2, hentet: 1, afvist: 0, udenSvar: 1 });
  assert.ok(log.some((l) => l.includes('hus-aaaaaaaa') && l.includes('503')));
  await b.db.close();
});

test('only klar beta tenants are asked: not a hand-given gift, not a paying customer, not a tenant that is not klar, not a deleted one', async () => {
  const b = await opsaetBeta();
  await b.husstand('beta@example.test', 'hus-aaaaaaaa', { samtykke: true });
  await b.husstand('ikke-klar@example.test', 'hus-bbbbbbbb', { klar: null });
  const slettet = await b.husstand('slettet@example.test', 'hus-cccccccc');
  await b.db.query("UPDATE flaade.tenant SET tilstand = 'slettet', adresse = NULL WHERE slug = 'hus-cccccccc'");
  void slettet;
  const haand = (await findEllerOpretKonto(b.db, 'haand@example.test', b.u.nu())).konto.id;
  await saetGave(b.db, haand, 'sky-husstand', laesPriser(), b.u.nu());
  await b.db.query("INSERT INTO flaade.tenant (slug, ejer_konto_id, driver, tilstand, bestilt, klar, adresse, oprettet, opdateret) VALUES ('hus-dddddddd', $1, 'lokal', 'klar', now(), now(), 'http://172.18.0.9:8750', now(), now())", [haand]);
  const betalende = (await findEllerOpretKonto(b.db, 'betaler@example.test', b.u.nu())).konto.id;
  await b.db.query("INSERT INTO flaade.tenant (slug, ejer_konto_id, driver, tilstand, bestilt, klar, adresse, oprettet, opdateret) VALUES ('hus-eeeeeeee', $1, 'lokal', 'klar', now(), now(), 'http://172.18.0.10:8750', now(), now())", [betalende]);
  const { d, kald } = deps(b, { 'hus-aaaaaaaa': MED });
  assert.deepEqual(await hentMaal(d, b.u.nu()), { beta: 1, hentet: 1, afvist: 0, udenSvar: 0 });
  assert.deepEqual(kald.map((k) => k.slug), ['hus-aaaaaaaa']);
  await b.db.close();
});

test('no beta tenant: nothing is asked and the pass costs one query', async () => {
  const b = await opsaetBeta();
  const { d, kald } = deps(b, {});
  assert.deepEqual(await hentMaal(d, b.u.nu()), { beta: 0, hentet: 0, afvist: 0, udenSvar: 0 });
  assert.equal(kald.length, 0);
  await b.db.close();
});

test('the daily loop: one pass per UTC day (a pass now, none again the same day), the next day another', async () => {
  const b = await opsaetBeta();
  await b.husstand('a@example.test', 'hus-aaaaaaaa', { samtykke: true });
  const { d, kald } = deps(b, { 'hus-aaaaaaaa': MED });
  let tik: () => void = () => {};
  const loekke = hentLoekke(d, { nu: () => b.u.nu(), saetInterval: (fn) => { tik = fn; return () => {}; } });
  await loekke.foerste;
  assert.equal(kald.length, 1);
  tik(); await loekke.vent();
  assert.equal(kald.length, 1, 'same day: no second pull');
  b.u.frem(DAG);
  tik(); await loekke.vent();
  assert.equal(kald.length, 2, 'next day: pulled again');
  loekke.stop();
  await b.db.close();
});
