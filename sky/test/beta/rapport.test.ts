// KC-0203: the beta report and the end criteria (a)-(d) evaluated from numbers; (e) and (f) are for a human.
// Invariants: nothing in the report names an account, an address or a tenant; consent-bound numbers count only
// households that consented; a criterion is "ja" only when its numbers are there and meet the bar (never by default).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lavRapport, rapportTekst, median, percentil, type HusstandData } from '../../src/beta/rapport.ts';

const START = new Date('2026-10-01T08:00:00Z');
const NU = new Date('2026-11-01T08:00:00Z'); // 31 days later: everyone has run 14 days
const dag = (nr: number): string => new Date(Date.UTC(2026, 9, nr)).toISOString().slice(0, 10); // day nr counted from Oct 1 (day 1 = Oct 1)

function h(i: number, over: Partial<HusstandData> = {}): HusstandData {
  return {
    kontoId: 100 + i, samtykke: true, bestilt: new Date(START.getTime() - (30 + i) * 1000), klar: START,
    tilmeldingMs: 60_000, kildeForbundetMs: 30_000, foersteVaerdiMs: 90_000,
    sete: [dag(2), dag(8), dag(9), dag(10), dag(14)], dagtal: [{ dag: dag(3), kraever: 9 }, { dag: dag(14), kraever: 3 }],
    feedback: [{ dag: 14, vurdering: 4, tekst: null, betale: 'ja' }], ...over,
  };
}

test('median and the nearest-rank percentile', () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(percentil([], 95), null);
  assert.equal(percentil([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assert.equal(percentil(Array.from({ length: 20 }, (_, i) => i + 1), 95), 19);
});

test('ten households that all meet the bars: every computed criterion is ja, the manual ones say so', () => {
  const hs = Array.from({ length: 10 }, (_, i) => h(i));
  const r = lavRapport(hs, NU);
  assert.equal(r.husstande, 10);
  assert.equal(r.koert14, 10);
  assert.deepEqual(r.fastholdt14, { n: 10, af: 10 });
  assert.equal(r.provisionering.n, 10);
  assert.equal(r.provisionering.medianMs, 34_500);
  assert.equal(r.provisionering.p95Ms, 39_000);
  assert.equal(r.foersteVaerdi.n, 10);
  assert.equal(r.foersteVaerdi.medianEfterKildeMs, 90_000);
  assert.equal(r.foersteVaerdi.medianFraTilmeldingMs, 180_000);
  assert.deepEqual(r.kraever, { delte: 10, sammenlignet: 10, lavere: 10 });
  assert.deepEqual(r.vurdering, { n: 10, gennemsnit: 4 });
  assert.deepEqual(r.betale, { ja: 10, maaske: 0, nej: 0 });
  assert.deepEqual(r.kriterier.map((k) => [k.id, k.opfyldt]), [['a', true], ['b', true], ['c', true], ['d', true], ['e', null], ['f', null]]);
});

test('retention counts only households that have run 14 days; a household that has not is not a failure yet', () => {
  const nyligt = h(9, { klar: new Date(NU.getTime() - 5 * 86_400_000), sete: [] });
  const r = lavRapport([h(0), h(1, { sete: [dag(2)] }), nyligt], NU);
  assert.equal(r.husstande, 3);
  assert.equal(r.koert14, 2);
  assert.deepEqual(r.fastholdt14, { n: 1, af: 2 });
});

test('(a) needs ten households that ran 14 days AND 7 retained; with fewer households it says which is missing', () => {
  const syv = [...Array.from({ length: 7 }, (_, i) => h(i)), ...Array.from({ length: 3 }, (_, i) => h(7 + i, { sete: [dag(2)] }))];
  assert.equal(lavRapport(syv, NU).kriterier[0]!.opfyldt, true, '7 of 10');
  const seks = [...Array.from({ length: 6 }, (_, i) => h(i)), ...Array.from({ length: 4 }, (_, i) => h(6 + i, { sete: [dag(2)] }))];
  const k = lavRapport(seks, NU).kriterier[0]!;
  assert.equal(k.opfyldt, false);
  assert.match(k.tekst, /6 af 10/);
  const faa = lavRapport(Array.from({ length: 8 }, (_, i) => h(i)), NU).kriterier[0]!;
  assert.equal(faa.opfyldt, false, 'all retained but only 8 households');
  assert.match(faa.tekst, /8 af 10 husstande har kørt 14 dage/);
});

test('consent-bound numbers count only households that consented; the retention does not depend on consent', () => {
  const hs = [h(0, { samtykke: false, tilmeldingMs: null, kildeForbundetMs: null, foersteVaerdiMs: null, dagtal: [] }), h(1)];
  const r = lavRapport(hs, NU);
  assert.equal(r.foersteVaerdi.n, 1);
  assert.deepEqual(r.kraever, { delte: 1, sammenlignet: 1, lavere: 1 });
  assert.deepEqual(r.fastholdt14, { n: 2, af: 2 });
});

test('(b) both the first-value median and the provisioning p95 must be at most 120 s, and must exist', () => {
  const godt = Array.from({ length: 10 }, (_, i) => h(i));
  assert.equal(lavRapport(godt, NU).kriterier[1]!.opfyldt, true);
  const langsomVaerdi = godt.map((x, i) => ({ ...x, foersteVaerdiMs: i < 6 ? 130_000 : 50_000 }));
  assert.equal(lavRapport(langsomVaerdi, NU).kriterier[1]!.opfyldt, false);
  const langsomOpret = godt.map((x, i) => (i === 9 ? { ...x, bestilt: new Date(START.getTime() - 200_000) } : x));
  const k = lavRapport(langsomOpret, NU).kriterier[1]!;
  assert.equal(k.opfyldt, false, 'p95 of 10 is the slowest: 200 s');
  assert.match(k.tekst, /200 s/);
  assert.equal(lavRapport([h(0, { foersteVaerdiMs: null })], NU).kriterier[1]!.opfyldt, false, 'no first-value number: not ja');
});

test('(c) "ting der krævede dig" lower on day 14 than on day 3 for at least 6 households that shared numbers', () => {
  const mix = (lavere: number) => Array.from({ length: 10 }, (_, i) => h(i, { dagtal: [{ dag: dag(3), kraever: 5 }, { dag: dag(14), kraever: i < lavere ? 2 : 5 }] }));
  assert.equal(lavRapport(mix(6), NU).kriterier[2]!.opfyldt, true);
  const fem = lavRapport(mix(5), NU);
  assert.equal(fem.kriterier[2]!.opfyldt, false);
  assert.deepEqual(fem.kraever, { delte: 10, sammenlignet: 10, lavere: 5 });
  const mangler = lavRapport([h(0, { dagtal: [{ dag: dag(3), kraever: 5 }] })], NU);
  assert.deepEqual(mangler.kraever, { delte: 1, sammenlignet: 0, lavere: 0 }, 'a household without day 14 is not compared');
});

test('(d) the average of each household\'s latest rating is at least 4 and at least 6 answer ja or måske', () => {
  const vurd = (v: number, b: 'ja' | 'maaske' | 'nej' | null) => ({ feedback: [{ dag: 3, vurdering: 1, tekst: null, betale: null }, { dag: 14, vurdering: v, tekst: null, betale: b }] });
  const ok = [...Array.from({ length: 4 }, (_, i) => h(i, vurd(5, 'ja'))), ...Array.from({ length: 2 }, (_, i) => h(4 + i, vurd(4, 'maaske'))), ...Array.from({ length: 4 }, (_, i) => h(6 + i, vurd(3, 'nej')))];
  const r = lavRapport(ok, NU);
  assert.deepEqual(r.vurdering, { n: 10, gennemsnit: 4 }, 'the day-14 answer is the latest, the day-3 one does not count twice');
  assert.deepEqual(r.betale, { ja: 4, maaske: 2, nej: 4 });
  assert.equal(r.kriterier[3]!.opfyldt, true);
  const lav = Array.from({ length: 10 }, (_, i) => h(i, vurd(3, 'ja')));
  assert.equal(lavRapport(lav, NU).kriterier[3]!.opfyldt, false, 'rating 3 on average');
  const faaBetaler = Array.from({ length: 10 }, (_, i) => h(i, vurd(5, i < 5 ? 'ja' : 'nej')));
  assert.equal(lavRapport(faaBetaler, NU).kriterier[3]!.opfyldt, false, 'only 5 would pay');
});

test('no households at all: nothing is ja, nothing divides by zero', () => {
  const r = lavRapport([], NU);
  assert.equal(r.husstande, 0);
  assert.equal(r.provisionering.medianMs, null);
  assert.equal(r.vurdering.gennemsnit, null);
  assert.ok(r.kriterier.slice(0, 4).every((k) => k.opfyldt === false));
  assert.ok(rapportTekst(r).length > 5);
});

test('the free-text list carries the texts only, with day and rating, no account and no tenant', () => {
  const hs = [h(0, { feedback: [{ dag: 7, vurdering: 2, tekst: 'Mailrummet drillede', betale: null }, { dag: 14, vurdering: 4, tekst: null, betale: 'maaske' }] }), h(1, { feedback: [{ dag: 3, vurdering: 5, tekst: 'Fedt', betale: null }] })];
  const r = lavRapport(hs, NU);
  assert.deepEqual(r.tekster.map((t) => `${t.dag}:${t.vurdering}:${t.tekst}`), ['3:5:Fedt', '7:2:Mailrummet drillede']);
  const alt = JSON.stringify(r) + rapportTekst(r).join('\n');
  assert.ok(!/kontoId|konto_id/.test(alt));
  assert.ok(!/@|hus-[a-z2-7]{8}/.test(alt));
  assert.ok(alt.includes('Mailrummet drillede'));
});

test('the text: plain Danish, one fact per line, the criteria with ja/nej and the numbers, (e) and (f) as manuelt', () => {
  const linjer = rapportTekst(lavRapport(Array.from({ length: 10 }, (_, i) => h(i)), NU));
  assert.ok(linjer.every((l) => l.trim().length > 0 && !l.includes('\n')));
  const t = linjer.join('\n');
  assert.match(t, /10 husstande/);
  assert.match(t, /Fastholdelse dag 14: 10 af 10/);
  assert.match(t, /^a\) ja: /m);
  assert.match(t, /^e\) manuelt: /m);
  assert.match(t, /^f\) manuelt: /m);
  assert.match(t, /median 35 s/);
});
