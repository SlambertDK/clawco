// KC-0149: the request (forespørgsel) as a pure state machine. Every
// transition, allowed and denied; only a party moves it (and only the one
// whose turn it is); the clock only expires it; reminders at 24 h and 4 h
// before expiry go to whoever decides now.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aftaleTid, alternativFraKl, anvend, beslutter, erPaamindet, erPart, fortrydSvar, kanFortrydes, nyForespoergsel, tik, TILSTANDE, ubesvaret, udloeberFor,
  type Forespoergsel, type Haendelse, type Tilstand,
} from '../../src/hushold/foresp.ts';

const NU = new Date('2026-11-02T08:00:00.000Z');
const TID = { start: '2026-11-05T15:00:00.000Z', slut: '2026-11-05T16:00:00.000Z' };
const ny = (o: Partial<Parameters<typeof nyForespoergsel>[0]> = {}): Forespoergsel =>
  nyForespoergsel({ id: 'f1', fra: 'henrik', til: 'maja', titel: 'Kan du tage Nora torsdag?', tid: TID, ...o }, NU);
const efter = (ms: number): Date => new Date(NU.getTime() + ms);
const T = 3600_000;

/** A request in `tilstand`, reached through the machine itself. */
function i(tilstand: Tilstand, o: Partial<Parameters<typeof nyForespoergsel>[0]> = {}): Forespoergsel {
  const f = ny(o);
  const alt = { start: '2026-11-05T15:30:00.000Z', slut: '2026-11-05T16:30:00.000Z', tekst: 'Kan 16.30' };
  const steps: Record<Tilstand, Haendelse[]> = {
    spurgt: [],
    accepteret: [{ slags: 'ja', af: 'maja' }],
    afvist: [{ slags: 'nej', af: 'maja' }],
    alternativ: [{ slags: 'alternativ', af: 'maja', alternativ: alt }],
    udloebet: [{ slags: 'udloeb' }],
  };
  let x = f;
  for (const h of steps[tilstand]) {
    const r = anvend(x, h, h.slags === 'udloeb' ? efter(49 * T) : efter(T));
    assert.ok(r.ok, `${tilstand}: ${h.slags}`);
    x = r.f;
  }
  return x;
}

test('TILSTANDE is the five states', () => {
  assert.deepEqual([...TILSTANDE], ['spurgt', 'accepteret', 'afvist', 'alternativ', 'udloebet']);
});

test('a new request: spurgt, expires 48 h after creation unless its time is sooner, history starts with the asker', () => {
  const f = nyForespoergsel({ id: 'f1', fra: 'henrik', til: 'maja', titel: 'Kan du hente?' }, NU);
  assert.equal(f.tilstand, 'spurgt');
  assert.equal(f.oprettet, NU.toISOString());
  assert.equal(f.udloeber, efter(48 * T).toISOString());
  assert.deepEqual(f.paamindet, []);
  assert.deepEqual(f.historik, [{ tid: NU.toISOString(), tilstand: 'spurgt', af: 'henrik' }]);
  assert.equal(udloeberFor(NU, { start: efter(5 * T).toISOString(), slut: efter(6 * T).toISOString() }), efter(5 * T).toISOString());
  assert.equal(udloeberFor(NU, TID), efter(48 * T).toISOString());
});

// [from, event, to] — every allowed transition.
const TILLADT: [Tilstand, Haendelse, Tilstand][] = [
  ['spurgt', { slags: 'ja', af: 'maja' }, 'accepteret'],
  ['spurgt', { slags: 'nej', af: 'maja' }, 'afvist'],
  ['spurgt', { slags: 'alternativ', af: 'maja', alternativ: { start: '2026-11-05T15:30:00.000Z', slut: '2026-11-05T16:30:00.000Z', tekst: 'Kan 16.30' } }, 'alternativ'],
  ['spurgt', { slags: 'traek', af: 'henrik' }, 'udloebet'],
  ['spurgt', { slags: 'udloeb' }, 'udloebet'],
  ['alternativ', { slags: 'tag-imod', af: 'henrik' }, 'accepteret'],
  ['alternativ', { slags: 'afslaa', af: 'henrik' }, 'afvist'],
  ['alternativ', { slags: 'traek', af: 'henrik' }, 'udloebet'],
  ['alternativ', { slags: 'udloeb' }, 'udloebet'],
];

test('every allowed transition, each a line in the history with who', () => {
  for (const [fra, h, til] of TILLADT) {
    const f = i(fra);
    const nu = h.slags === 'udloeb' ? efter(49 * T) : efter(2 * T);
    const r = anvend(f, h, nu);
    assert.ok(r.ok, `${fra} --${h.slags}--> ${til}`);
    assert.equal(r.f.tilstand, til, `${fra} --${h.slags}`);
    assert.equal(r.aendret, true);
    assert.deepEqual(r.f.historik.at(-1), { tid: nu.toISOString(), tilstand: til, af: h.slags === 'udloeb' ? 'ur' : h.af });
    assert.equal(f.tilstand, fra, 'the input is not mutated');
  }
  assert.equal((anvend(i('spurgt'), { slags: 'traek', af: 'henrik' }, efter(T)) as { f: Forespoergsel }).f.aarsag, 'trukket');
  assert.equal((anvend(i('spurgt'), { slags: 'udloeb' }, efter(49 * T)) as { f: Forespoergsel }).f.aarsag, undefined);
});

test('every other (state, event) is denied, with the reason kind', () => {
  const haendelser: Haendelse[] = [
    { slags: 'ja', af: 'maja' }, { slags: 'nej', af: 'maja' },
    { slags: 'alternativ', af: 'maja', alternativ: { start: '2026-11-05T15:30:00.000Z', slut: '2026-11-05T16:30:00.000Z', tekst: 'x' } },
    { slags: 'tag-imod', af: 'henrik' }, { slags: 'afslaa', af: 'henrik' }, { slags: 'traek', af: 'henrik' }, { slags: 'udloeb' },
  ];
  for (const fra of TILSTANDE) {
    for (const h of haendelser) {
      if (TILLADT.some(([a, b]) => a === fra && b.slags === h.slags)) continue;
      // The same answer again from its author is a double tap (idempotent, tested below), not a transition.
      if ((fra === 'accepteret' && h.slags === 'ja') || (fra === 'afvist' && h.slags === 'nej') || (fra === 'alternativ' && h.slags === 'alternativ')) continue;
      const r = anvend(i(fra), h, efter(49 * T));
      assert.equal(r.ok, false, `${fra} --${h.slags} must be denied`);
    }
  }
});

test('the wrong side is denied: the asker cannot answer, the recipient cannot withdraw or take the alternative', () => {
  for (const h of [{ slags: 'ja', af: 'henrik' }, { slags: 'nej', af: 'henrik' }, { slags: 'traek', af: 'maja' }] as Haendelse[]) {
    const r = anvend(i('spurgt'), h, efter(T));
    assert.equal(r.ok ? 'ok' : r.fejl, 'ikke-din-tur', h.slags);
  }
  for (const h of [{ slags: 'tag-imod', af: 'maja' }, { slags: 'afslaa', af: 'maja' }] as Haendelse[]) {
    const r = anvend(i('alternativ'), h, efter(T));
    assert.equal(r.ok ? 'ok' : r.fejl, 'ikke-din-tur', h.slags);
  }
});

test('a third person is never a party: every human event from them is ikke-part', () => {
  for (const s of ['ja', 'nej', 'traek', 'tag-imod', 'afslaa'] as const) {
    const r = anvend(i(s === 'tag-imod' || s === 'afslaa' ? 'alternativ' : 'spurgt'), { slags: s, af: 'ella' }, efter(T));
    assert.equal(r.ok ? 'ok' : r.fejl, 'ikke-part', s);
  }
  assert.equal(erPart(ny(), 'henrik'), true);
  assert.equal(erPart(ny(), 'maja'), true);
  assert.equal(erPart(ny(), 'ella'), false);
});

test('the clock only expires, and only once the expiry has passed', () => {
  const r = anvend(i('spurgt'), { slags: 'udloeb' }, efter(47 * T));
  assert.equal(r.ok ? 'ok' : r.fejl, 'ikke-endnu');
});

test('a final state is final: answering again with something else is afgjort', () => {
  for (const s of ['accepteret', 'afvist', 'udloebet'] as const) {
    const r = anvend(i(s), { slags: s === 'afvist' ? 'ja' : 'nej', af: 'maja' }, efter(2 * T));
    assert.equal(r.ok ? 'ok' : r.fejl, 'afgjort', s);
  }
});

test('a double tap is idempotent: the same answer from the same person again changes nothing', () => {
  const f = i('accepteret');
  const r = anvend(f, { slags: 'ja', af: 'maja' }, efter(3 * T));
  assert.ok(r.ok);
  assert.equal(r.aendret, false);
  assert.deepEqual(r.f, f);
  const trukket = (anvend(i('spurgt'), { slags: 'traek', af: 'henrik' }, efter(T)) as { f: Forespoergsel }).f;
  const t = anvend(trukket, { slags: 'traek', af: 'henrik' }, efter(2 * T));
  assert.ok(t.ok && !t.aendret);
});

test('who decides now: the recipient on spurgt, the asker on alternativ, nobody when final', () => {
  assert.equal(beslutter(i('spurgt')), 'maja');
  assert.equal(beslutter(i('alternativ')), 'henrik');
  for (const s of ['accepteret', 'afvist', 'udloebet'] as const) assert.equal(beslutter(i(s)), null);
});

test('the agreed time: the request\'s own, or the alternative once the asker took it; none unless accepted', () => {
  assert.deepEqual(aftaleTid(i('accepteret')), TID);
  const alt = i('alternativ');
  assert.equal(aftaleTid(alt), undefined);
  const taget = anvend(alt, { slags: 'tag-imod', af: 'henrik' }, efter(2 * T));
  assert.ok(taget.ok);
  assert.deepEqual(aftaleTid(taget.f), { start: '2026-11-05T15:30:00.000Z', slut: '2026-11-05T16:30:00.000Z' });
});

test('an alternative from a clock time: the same day in Copenhagen, the same duration; none without a time or a bad clock', () => {
  assert.deepEqual(alternativFraKl(ny(), '16:30', 'Kan 16.30'), { start: '2026-11-05T15:30:00.000Z', slut: '2026-11-05T16:30:00.000Z', tekst: 'Kan 16.30' });
  assert.deepEqual(alternativFraKl(ny(), '16.30', 'x')?.start, '2026-11-05T15:30:00.000Z');
  assert.equal(alternativFraKl(nyForespoergsel({ id: 'f2', fra: 'henrik', til: 'maja', titel: 'x' }, NU), '16:30', 'x'), null);
  for (const kl of ['25:00', 'nu', '', '7']) assert.equal(alternativFraKl(ny(), kl, 'x'), null, kl);
});

test('tik: a reminder to the decider at 24 h and at 4 h before expiry, each once; then expiry', () => {
  let f = ny({ tid: undefined }); // expires at +48 h
  let r = tik(f, efter(23 * T));
  assert.equal(r.aendret, false);
  r = tik(f, efter(24 * T));
  assert.equal(r.paamindelse, true);
  assert.deepEqual(r.f.paamindet, ['maja:24t']);
  assert.equal(erPaamindet(r.f), true);
  f = r.f;
  r = tik(f, efter(30 * T));
  assert.equal(r.aendret, false, 'the 24 h reminder fires once');
  r = tik(f, efter(44 * T));
  assert.equal(r.paamindelse, true);
  assert.deepEqual(r.f.paamindet, ['maja:24t', 'maja:4t']);
  f = r.f;
  r = tik(f, efter(48 * T));
  assert.equal(r.udloeb, true);
  assert.equal(r.f.tilstand, 'udloebet');
  assert.equal(r.f.historik.at(-1)?.af, 'ur');
  assert.equal(tik(r.f, efter(60 * T)).aendret, false, 'a final request is left alone');
});

test('tik: a threshold already past at creation is skipped; on alternativ the asker is reminded', () => {
  const kort = ny({ tid: { start: efter(10 * T).toISOString(), slut: efter(11 * T).toISOString() } }); // expires at +10 h
  assert.equal(tik(kort, efter(5 * T)).aendret, false, 'no 24 h reminder for a 10 h request');
  assert.deepEqual(tik(kort, efter(6 * T)).f.paamindet, ['maja:4t']);
  const alt = i('alternativ');
  const r = tik(alt, efter(44 * T));
  assert.deepEqual(r.f.paamindet, ['henrik:24t', 'henrik:4t']);
  assert.equal(erPaamindet(r.f), true);
});

test('fortryd of an answer: back to the state before, by its author only, while it is the latest and not expired', () => {
  const a = i('accepteret');
  assert.equal((fortrydSvar(a, 'henrik', efter(2 * T)) as { fejl?: string }).fejl, 'ikke-din-tur');
  assert.equal((fortrydSvar(a, 'ella', efter(2 * T)) as { fejl?: string }).fejl, 'ikke-part');
  const r = fortrydSvar(a, 'maja', efter(2 * T));
  assert.ok(r.ok);
  assert.equal(r.f.tilstand, 'spurgt');
  assert.equal(r.f.historik.at(-1)?.tilstand, 'spurgt');
  const alt = fortrydSvar(i('alternativ'), 'maja', efter(2 * T));
  assert.ok(alt.ok);
  assert.equal(alt.f.alternativ, undefined, 'the withdrawn alternative is gone');
  assert.equal(fortrydSvar(i('accepteret'), 'maja', efter(49 * T)).ok, false, 'not after the expiry');
  assert.equal(fortrydSvar(i('spurgt'), 'maja', efter(2 * T)).ok, false, 'nothing to undo');
  assert.equal(fortrydSvar(i('udloebet'), 'maja', efter(50 * T)).ok, false, 'the clock is not undone');
});

test('fortryd of an accepted answer clears who took it to their calendar (a later yes offers the card again)', () => {
  const f = { ...i('accepteret'), iKalender: ['maja'] };
  const r = fortrydSvar(f, 'maja', efter(2 * T));
  assert.ok(r.ok);
  assert.equal(r.f.iKalender, undefined);
});

test('kanFortrydes: the creation (n = 1) while unanswered, an answer while it is the latest step by its author', () => {
  const f = ny();
  assert.equal(kanFortrydes(f, 1, 'henrik', efter(T)), true, 'the creation: a withdraw');
  assert.equal(kanFortrydes(f, 1, 'maja', efter(T)), false);
  const svaret = i('accepteret');
  assert.equal(kanFortrydes(svaret, 1, 'henrik', efter(T)), false, 'answered: the creation can no longer be undone');
  assert.equal(kanFortrydes(svaret, 2, 'maja', efter(2 * T)), true);
  assert.equal(kanFortrydes(svaret, 2, 'henrik', efter(2 * T)), false, 'not the author');
  assert.equal(kanFortrydes(svaret, 3, 'maja', efter(2 * T)), false, 'not the latest step');
  assert.equal(kanFortrydes(svaret, 2, 'maja', efter(49 * T)), false, 'expired');
});

test('ubesvaret: expired by the clock and not dealt with; a withdrawn or dropped one is not', () => {
  const u = i('udloebet');
  assert.equal(ubesvaret(u), true);
  assert.equal(ubesvaret({ ...u, lukket: efter(50 * T).toISOString() }), false);
  assert.equal(ubesvaret({ ...u, aarsag: 'trukket' }), false);
  assert.equal(ubesvaret(ny()), false);
});
