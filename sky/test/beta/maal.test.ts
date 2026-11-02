// KC-0203: the retention rule (the ticket's definition, so it cannot drift) and the closed schema of what a tenant may
// report. Invariants: unknown fields refuse the whole pull; nothing but feedback is accepted without consent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dagNr, fastholdtDag14, valider } from '../../src/beta/maal.ts';

// Day 1 = the UTC day of the start. 2026-11-01 is day 1, so 2026-11-08 is day 8 and 2026-11-14 is day 14.
const START = new Date('2026-11-01T23:30:00Z');
const d = (nr: number): string => new Date(Date.UTC(2026, 10, nr)).toISOString().slice(0, 10);

test('dagNr counts UTC days from the start day: the start day is day 1, also late in the evening', () => {
  assert.equal(dagNr('2026-11-01', START), 1);
  assert.equal(dagNr('2026-11-02', START), 2);
  assert.equal(dagNr('2026-11-15', START), 15);
  assert.equal(dagNr('2026-10-31', START), 0);
});

test('retained: at least three distinct days in days 8-14 and one in days 13-15', () => {
  assert.equal(fastholdtDag14([d(8), d(9), d(13)], START), true, 'exactly three days, one of them day 13');
  assert.equal(fastholdtDag14([d(8), d(13)], START), false, 'two days');
  assert.equal(fastholdtDag14([d(13)], START), false, 'only day 13');
  assert.equal(fastholdtDag14([d(8), d(9), d(10), d(15)], START), true, 'three in 8-14 and day 15');
  assert.equal(fastholdtDag14([d(8), d(9), d(10)], START), false, 'three days but none in 13-15');
  assert.equal(fastholdtDag14([d(8), d(9), d(10), d(11), d(12)], START), false, 'five days, none late');
  assert.equal(fastholdtDag14([d(12), d(13), d(14)], START), true, 'the last three days of the window');
});

test('retained: the same day twice counts once; days outside 8-14 and 13-15 do not count', () => {
  assert.equal(fastholdtDag14([d(8), d(8), d(13)], START), false, 'duplicates are one day');
  assert.equal(fastholdtDag14([d(1), d(2), d(3), d(4), d(5), d(6), d(7), d(13)], START), false, 'the first week does not count');
  assert.equal(fastholdtDag14([d(8), d(9), d(15), d(16)], START), false, 'day 15 and 16 are not in 8-14 (only 8 and 9 are), and 16 is outside 13-15');
  assert.equal(fastholdtDag14([d(14), d(15), d(8), d(9)], START), true);
});

const OK_UDEN = { version: 1, samtykke: false };
const OK_MED = {
  version: 1, samtykke: true,
  foersteVaerdi: { kildeForbundetMs: 40_000, foersteVaerdiMs: 90_000 },
  dage: [{ dag: '2026-11-02', kraever: 5 }, { dag: '2026-11-03', kraever: 3 }],
  feedback: [{ dag: 3, vurdering: 4, tekst: 'Det drillede ikke', betale: null, tid: '2026-11-04T10:00:00.000Z' }],
};

test('valider accepts the contract\'s two shapes', () => {
  assert.deepEqual(valider(OK_UDEN), { samtykke: false, foersteVaerdi: null, dage: [], feedback: [] });
  const m = valider(OK_MED)!;
  assert.equal(m.samtykke, true);
  assert.deepEqual(m.foersteVaerdi, { kildeForbundetMs: 40_000, foersteVaerdiMs: 90_000 });
  assert.equal(m.dage.length, 2);
  assert.deepEqual(m.feedback[0], { dag: 3, vurdering: 4, tekst: 'Det drillede ikke', betale: null, tid: new Date('2026-11-04T10:00:00.000Z') });
  assert.deepEqual(valider({ ...OK_MED, foersteVaerdi: null, dage: [], feedback: [] })!.foersteVaerdi, null);
});

test('valider refuses an unknown field anywhere (the schema is closed)', () => {
  for (const k of [{ ...OK_UDEN, navn: 'Ida' }, { ...OK_MED, email: 'a@example.test' }, { ...OK_MED, foersteVaerdi: { kildeForbundetMs: 1, foersteVaerdiMs: 2, kilde: 'mail' } },
    { ...OK_MED, dage: [{ dag: '2026-11-02', kraever: 1, titel: 'x' }] }, { ...OK_MED, feedback: [{ ...OK_MED.feedback[0], extra: 1 }] }]) {
    assert.equal(valider(k), null, JSON.stringify(k).slice(0, 60));
  }
});

test('valider refuses wrong types, ranges and shapes', () => {
  const daarlige: unknown[] = [
    null, 'tekst', [], 7, {}, { samtykke: true }, { version: 2, samtykke: false }, { version: 1, samtykke: 'ja' },
    { ...OK_MED, foersteVaerdi: { kildeForbundetMs: -1, foersteVaerdiMs: 2 } },
    { ...OK_MED, foersteVaerdi: { kildeForbundetMs: 1.5, foersteVaerdiMs: 2 } },
    { ...OK_MED, foersteVaerdi: { kildeForbundetMs: '1', foersteVaerdiMs: 2 } },
    { ...OK_MED, foersteVaerdi: { kildeForbundetMs: 1 } },
    { ...OK_MED, foersteVaerdi: { kildeForbundetMs: 3_000_000_000, foersteVaerdiMs: 2 } },
    { ...OK_MED, dage: 'nej' },
    { ...OK_MED, dage: [{ dag: '2026-13-40', kraever: 1 }] },
    { ...OK_MED, dage: [{ dag: '2026-11-02', kraever: -1 }] },
    { ...OK_MED, dage: [{ dag: '2026-11-02', kraever: 1 }, { dag: '2026-11-02', kraever: 2 }] },
    { ...OK_MED, dage: Array.from({ length: 22 }, (_, i) => ({ dag: new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10), kraever: 1 })) },
    { ...OK_MED, feedback: [{ ...OK_MED.feedback[0], dag: 5 }] },
    { ...OK_MED, feedback: [{ ...OK_MED.feedback[0], vurdering: 6 }] },
    { ...OK_MED, feedback: [{ ...OK_MED.feedback[0], vurdering: 0 }] },
    { ...OK_MED, feedback: [{ ...OK_MED.feedback[0], betale: 'kanske' }] },
    { ...OK_MED, feedback: [{ ...OK_MED.feedback[0], tekst: 'x'.repeat(501) }] },
    { ...OK_MED, feedback: [{ ...OK_MED.feedback[0], tekst: 7 }] },
    { ...OK_MED, feedback: [{ ...OK_MED.feedback[0], tid: 'i går' }] },
    { ...OK_MED, feedback: [OK_MED.feedback[0], OK_MED.feedback[0]] },
  ];
  for (const k of daarlige) assert.equal(valider(k), null, JSON.stringify(k)?.slice(0, 80));
});

test('without consent nothing but feedback is accepted: numbers sent with samtykke:false refuse the whole pull', () => {
  assert.equal(valider({ ...OK_UDEN, dage: [{ dag: '2026-11-02', kraever: 5 }] }), null);
  assert.equal(valider({ ...OK_UDEN, foersteVaerdi: { kildeForbundetMs: 1, foersteVaerdiMs: 2 } }), null);
  assert.ok(valider({ ...OK_UDEN, foersteVaerdi: null, dage: [] }), 'empty values carry nothing and are tolerated');
  const m = valider({ ...OK_UDEN, feedback: OK_MED.feedback })!;
  assert.equal(m.samtykke, false);
  assert.equal(m.feedback.length, 1, 'feedback the person sent on purpose is kept');
  assert.deepEqual(m.dage, []);
});

test('feedback text: control characters become spaces, an empty line becomes null, the length cap is on the cleaned text', () => {
  const t = (tekst: string) => valider({ ...OK_UDEN, feedback: [{ dag: 7, vurdering: 3, tekst, betale: 'maaske', tid: '2026-11-08T08:00:00Z' }] })!.feedback[0]!.tekst;
  assert.equal(t('a\u001b[31mb\nc'), 'a [31mb c');
  assert.equal(t('   \n  '), null);
  assert.equal(t('  hej  '), 'hej');
});
