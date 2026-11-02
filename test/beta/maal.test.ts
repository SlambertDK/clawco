// KC-0203: the closed set of numbers a beta tenant may hand to Clawco Sky (the answer to GET /api/beta/maal), and the
// feedback answer's validation. The schema is closed in two ways: a type (a new field is a compile error until it is
// handled) and a test that serialises the answer and compares its keys with the list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byggMaal, dageFraDagstal, foersteVaerdiFraStart, MAAL_FELTER, type MaalKilder } from '../../src/beta/maal.ts';
import { parseFeedbackSvar } from '../../src/beta/feedback.ts';
import type { BetaTilstand } from '../../src/beta/tilstand.ts';
import type { StartState } from '../../src/rooms/start/schema.ts';

const tilstand = (o: Partial<BetaTilstand> = {}): BetaTilstand => ({ startet: '2026-11-01T08:00:00.000Z', samtykke: true, svaret: { 3: '2026-11-04T08:00:00.000Z' }, feedback: [{ dag: 3, vurdering: 4, tekst: 'Mailen drillede', betale: null, tid: '2026-11-04T08:00:00.000Z' }], ...o });
const kilder = (t: BetaTilstand, laest: string[] = []): MaalKilder => ({
  tilstand: t,
  foersteVaerdi: async () => { laest.push('foersteVaerdi'); return { kildeForbundetMs: 60_000, foersteVaerdiMs: 90_000 }; },
  dage: async () => { laest.push('dage'); return [{ dag: '2026-11-03', kraever: 7 }, { dag: '2026-11-04', kraever: 5 }]; },
});

test('the list of fields is the contract with Sky: exactly these, in this order', () => {
  assert.deepEqual([...MAAL_FELTER], ['version', 'samtykke', 'foersteVaerdi', 'dage', 'feedback']);
});

test('consent on: the answer has exactly the listed keys, and its nested objects have exactly theirs', async () => {
  const svar = await byggMaal(kilder(tilstand()));
  const json = JSON.parse(JSON.stringify(svar)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(json), [...MAAL_FELTER]);
  assert.deepEqual(json, {
    version: 1, samtykke: true,
    foersteVaerdi: { kildeForbundetMs: 60_000, foersteVaerdiMs: 90_000 },
    dage: [{ dag: '2026-11-03', kraever: 7 }, { dag: '2026-11-04', kraever: 5 }],
    feedback: [{ dag: 3, vurdering: 4, tekst: 'Mailen drillede', betale: null, tid: '2026-11-04T08:00:00.000Z' }],
  });
  assert.deepEqual(Object.keys((json['feedback'] as object[])[0]!), ['dag', 'vurdering', 'tekst', 'betale', 'tid']);
});

test('consent off: only version, samtykke:false and the feedback the person sent on purpose — and the numbers are not even read', async () => {
  const laest: string[] = [];
  const svar = await byggMaal(kilder(tilstand({ samtykke: false }), laest));
  assert.deepEqual(JSON.parse(JSON.stringify(svar)), { version: 1, samtykke: false, feedback: [{ dag: 3, vurdering: 4, tekst: 'Mailen drillede', betale: null, tid: '2026-11-04T08:00:00.000Z' }] });
  assert.deepEqual(laest, [], 'with consent off the first-value time and the daily counts are never read');
});

test('a stored field that is not on the list never reaches the answer (extra keys in a feedback row or in the state are dropped)', async () => {
  const t = tilstand({ feedback: [{ dag: 3, vurdering: 4, tekst: 't', betale: null, tid: '2026-11-04T08:00:00.000Z', hemmelig: 'x' } as never] });
  const json = JSON.stringify(await byggMaal({ ...kilder(t), tilstand: { ...t, navn: 'Henrik' } as never }));
  assert.doesNotMatch(json, /hemmelig|navn|Henrik/);
});

test('foersteVaerdiFraStart: the first source by time; ms from the beta start to its connection, and its own first-value time; null without one', () => {
  const start = (kilder: StartState['kilder']): StartState => ({ startet: '2026-11-01T07:00:00.000Z', trin: {}, afvist: {}, ...(kilder ? { kilder } : {}) } as StartState);
  const k = (tid: string, ms: number) => ({ foersteVaerdiMs: ms, tid, forhaandsvisning: {} as never });
  assert.equal(foersteVaerdiFraStart(null, '2026-11-01T08:00:00.000Z'), null);
  assert.equal(foersteVaerdiFraStart(start(undefined), '2026-11-01T08:00:00.000Z'), null);
  // Connected 08:10 (read at 08:11:30 → 90 s), a later source connected at 09:00 is not the first.
  const s = start({ 'google-kalender': k('2026-11-01T08:11:30.000Z', 90_000), 'mail-imap': k('2026-11-01T09:01:00.000Z', 60_000) });
  assert.deepEqual(foersteVaerdiFraStart(s, '2026-11-01T08:00:00.000Z'), { kildeForbundetMs: 600_000, foersteVaerdiMs: 90_000 });
  // Connected before the beta clock started (the state existed first): never negative.
  assert.deepEqual(foersteVaerdiFraStart(s, '2026-11-02T08:00:00.000Z'), { kildeForbundetMs: 0, foersteVaerdiMs: 90_000 });
});

test('dageFraDagstal: finished days only (today still grows), the last 21, oldest first, only the two fields', () => {
  const dage = Array.from({ length: 30 }, (_, i) => ({ dato: `2026-10-${String(i + 1).padStart(2, '0')}`, kraevede: i, fortryd: 9, regler: 3 }));
  const ud = dageFraDagstal(dage, '2026-10-30');
  assert.equal(ud.length, 21);
  assert.deepEqual(ud[0], { dag: '2026-10-09', kraever: 8 });
  assert.deepEqual(ud.at(-1), { dag: '2026-10-29', kraever: 28 });
  assert.deepEqual(Object.keys(ud[0]!), ['dag', 'kraever']);
});

// ---------- the feedback answer ----------

const gyldig = { dag: 3, vurdering: 4, tekst: 'Mailen drillede', betale: null };
test('parseFeedbackSvar: a good answer is cut to its fields; the text is trimmed and an empty one becomes null', () => {
  assert.deepEqual(parseFeedbackSvar(gyldig, { due: 3 }), { ok: true, svar: { dag: 3, vurdering: 4, tekst: 'Mailen drillede', betale: null } });
  assert.deepEqual(parseFeedbackSvar({ dag: 3, vurdering: 5, tekst: '   ' }, { due: 3 }), { ok: true, svar: { dag: 3, vurdering: 5, tekst: null, betale: null } });
  assert.deepEqual(parseFeedbackSvar({ dag: 14, vurdering: 2, betale: 'maaske', ekstra: 1, ja: 'x' }, { due: 14 }), { ok: true, svar: { dag: 14, vurdering: 2, tekst: null, betale: 'maaske' } });
});

test('parseFeedbackSvar refuses: a day that is not due or not a feedback day, rating outside 1–5, text over 500, pay on another day than 14, pay missing on 14 only when asked', () => {
  const nej = (raw: unknown, due: 3 | 7 | 14 | null, status: number) => { const r = parseFeedbackSvar(raw, { due }); assert.equal(r.ok, false, JSON.stringify(raw)); assert.equal((r as { status: number }).status, status, JSON.stringify(raw)); };
  nej({ ...gyldig, dag: 4 }, 3, 400);
  nej({ ...gyldig, dag: 7 }, 3, 409);
  nej(gyldig, null, 409);
  for (const v of [0, 6, 3.5, '4', null, undefined]) nej({ ...gyldig, vurdering: v }, 3, 400);
  nej({ ...gyldig, tekst: 'x'.repeat(501) }, 3, 400);
  nej({ ...gyldig, tekst: 7 }, 3, 400);
  nej({ ...gyldig, betale: 'ja' }, 3, 400);
  nej({ dag: 14, vurdering: 3, betale: 'kanske' }, 14, 400);
  nej(null, 3, 400);
  nej([], 3, 400);
  assert.equal(parseFeedbackSvar({ ...gyldig, tekst: 'x'.repeat(500) }, { due: 3 }).ok, true, '500 is allowed');
});

test('parseFeedbackSvar: day 14 may be answered without the pay question (the price file could not be read), and the pay answer is optional there', () => {
  assert.deepEqual(parseFeedbackSvar({ dag: 14, vurdering: 4 }, { due: 14 }), { ok: true, svar: { dag: 14, vurdering: 4, tekst: null, betale: null } });
});

test('the text is plain text: markup and control characters are kept out of what is stored and sent', () => {
  const r = parseFeedbackSvar({ ...gyldig, tekst: 'a\u0000b\u0007c\nd<script>' }, { due: 3 });
  assert.equal(r.ok, true);
  assert.equal((r as { svar: { tekst: string } }).svar.tekst, 'abc d<script>', 'control characters are dropped and a line break is a space; markup is escaped by whoever shows it, never trusted');
});
