// KC-0147: the week's number — things that required the owner, per day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { faerdigeDage, lavDagstal, ugeLinje, ugeSoejler, ugeVisning, erMandag, fortrudtPaaDag, mandagFor, raekke, ugeAf, ugeNr, ugetal, type Dagstal, type Ugetal } from '../../src/tillid/dagstal.ts';

const dag = (dato: string, kraevede: number, fortryd = 0): Dagstal => ({ dato, kraevede, fortryd });

test('mandagFor: the Monday of any day in the week (Sunday belongs to the week before)', () => {
  assert.equal(mandagFor('2026-10-28'), '2026-10-26'); // Wednesday
  assert.equal(mandagFor('2026-10-26'), '2026-10-26'); // Monday
  assert.equal(mandagFor('2026-11-01'), '2026-10-26'); // Sunday
  assert.equal(mandagFor('2026-11-02'), '2026-11-02');
});

test('ugeNr: ISO week number of a Monday', () => {
  assert.equal(ugeNr('2026-10-19'), 43);
  assert.equal(ugeNr('2026-10-26'), 44);
  assert.equal(ugeNr('2026-12-28'), 53);
  assert.equal(ugeNr('2027-01-04'), 1);
});

test('week boundary: Monday 00:00 Europe/Copenhagen, also in the week the clocks go back', () => {
  // Winter time (CET, UTC+1): Sunday 23:59 local = 22:59Z, Monday 00:00 local = 23:00Z.
  assert.equal(ugeAf(new Date('2026-11-01T22:59:00Z')), '2026-10-26');
  assert.equal(ugeAf(new Date('2026-11-01T23:00:00Z')), '2026-11-02');
  // Summer time (CEST, UTC+2) until Sunday 25 Oct 2026 03:00: Sunday 23:59 local = 21:59Z, Monday 00:00 local = 22:00Z.
  assert.equal(ugeAf(new Date('2026-10-18T21:59:00Z')), '2026-10-12');
  assert.equal(ugeAf(new Date('2026-10-18T22:00:00Z')), '2026-10-19');
  // The long Sunday (25 Oct, 25 hours): its last minute (CET 23:59 = 22:59Z) is still the old week.
  assert.equal(ugeAf(new Date('2026-10-25T22:59:00Z')), '2026-10-19');
  assert.equal(ugeAf(new Date('2026-10-25T23:00:00Z')), '2026-10-26');
});

test('erMandag: true from Monday 00:00 until Tuesday 00:00 in Copenhagen', () => {
  assert.equal(erMandag(new Date('2026-11-01T22:59:00Z')), false);
  assert.equal(erMandag(new Date('2026-11-01T23:00:00Z')), true);
  assert.equal(erMandag(new Date('2026-11-02T22:59:00Z')), true);
  assert.equal(erMandag(new Date('2026-11-02T23:00:00Z')), false);
});

test('ugetal: the average per day with data, and Fortryd summed over the week', () => {
  const dage = [dag('2026-10-26', 4, 1), dag('2026-10-27', 8), dag('2026-10-28', 6, 2), dag('2026-11-02', 99)];
  assert.deepEqual(ugetal(dage, '2026-10-26'), { uge: '2026-10-26', nr: 44, dage: 3, snit: 6, fortryd: 3 });
});

test('ugetal: a quiet day (0 things) is a day, and lowers the average', () => {
  const t = ugetal([dag('2026-10-26', 6), dag('2026-10-27', 0)], '2026-10-26');
  assert.equal(t.dage, 2);
  assert.equal(t.snit, 3);
});

test('ugetal: a week without data has no days and no average', () => {
  assert.deepEqual(ugetal([dag('2026-10-19', 5)], '2026-10-26'), { uge: '2026-10-26', nr: 44, dage: 0, snit: 0, fortryd: 0 });
});

test('raekke: eight weeks, oldest first, ending with the week of the given Monday; gaps have no days', () => {
  const r = raekke([dag('2026-10-26', 6), dag('2026-09-07', 9)], '2026-10-26');
  assert.equal(r.length, 8);
  assert.equal(r[0]?.uge, '2026-09-07');
  assert.equal(r[7]?.uge, '2026-10-26');
  assert.deepEqual(r.map((u) => u.dage), [1, 0, 0, 0, 0, 0, 0, 1]);
  assert.equal(raekke([], '2026-10-26', 3).length, 3);
});

test('fortrudtPaaDag: counts log lines undone that Copenhagen day, across rooms, ignoring lines never undone', () => {
  const log = [
    { fortrudt: '2026-10-28T09:00:00Z' }, { fortrudt: '2026-10-28T21:59:00Z' }, // 10:00 and 22:59 local (CET)
    { fortrudt: '2026-10-28T23:30:00Z' }, // 00:30 on the 29th local
    {}, { fortrudt: undefined },
  ];
  assert.equal(fortrudtPaaDag(log, '2026-10-28'), 2);
  assert.equal(fortrudtPaaDag(log, '2026-10-29'), 1);
  assert.equal(fortrudtPaaDag([{ fortrudt: 'not a time' }], '2026-10-28'), 0);
});


test('faerdigeDage: today is not finished — its count is still growing — and later days do not exist yet', () => {
  const dage = [dag('2026-10-26', 6), dag('2026-10-27', 5), dag('2026-10-28', 1)];
  assert.deepEqual(faerdigeDage(dage, '2026-10-28').map((d) => d.dato), ['2026-10-26', '2026-10-27']);
  assert.deepEqual(faerdigeDage(dage, '2026-10-26'), []);
});

// ---- the store ----
const med = async (fn: (dir: string, fil: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-dagstal-'));
  try { await fn(dir, path.join(dir, 'tillid', 'dagstal.jsonl')); } finally { await rm(dir, { recursive: true, force: true }); }
};

test('noter: distinct per element id per day; the same id twice in a day counts once', () => med(async (dir) => {
  const l = lavDagstal({ dir });
  await l.noter('2026-10-26', ['kort:a', 'kort:b']);
  await l.noter('2026-10-26', ['kort:b', 'kort:c']);
  assert.deepEqual(await l.dage(), [{ dato: '2026-10-26', kraevede: 3, fortryd: 0 }]);
}));

test('noter: the same id on two days counts twice', () => med(async (dir) => {
  const l = lavDagstal({ dir });
  await l.noter('2026-10-26', ['kort:a']);
  await l.noter('2026-10-27', ['kort:a']);
  assert.deepEqual((await l.dage()).map((d) => d.kraevede), [1, 1]);
}));

test('noter: a new lager (a restart) continues the day and still counts each id once', () => med(async (dir) => {
  await lavDagstal({ dir }).noter('2026-10-26', ['kort:a', 'kort:b']);
  const l2 = lavDagstal({ dir });
  await l2.noter('2026-10-26', ['kort:b', 'kort:c']);
  assert.equal((await l2.dage())[0]?.kraevede, 3);
}));

test('noter: an empty band still makes the day (a 0 lowers the week)', () => med(async (dir) => {
  const l = lavDagstal({ dir });
  await l.noter('2026-10-26', []);
  assert.deepEqual(await l.dage(), [{ dato: '2026-10-26', kraevede: 0, fortryd: 0 }]);
}));

test('noter: Fortryd and regler are per-day figures, the latest wins; an unchanged call appends nothing', () => med(async (dir, fil) => {
  const l = lavDagstal({ dir });
  await l.noter('2026-10-26', ['kort:a'], { fortryd: 0, regler: 4 });
  await l.noter('2026-10-26', ['kort:a'], { fortryd: 0, regler: 4 });
  const foer = await readFile(fil, 'utf8');
  assert.equal(foer.trim().split('\n').length, 1);
  await l.noter('2026-10-26', ['kort:a'], { fortryd: 2, regler: 4 });
  assert.deepEqual(await l.dage(), [{ dato: '2026-10-26', kraevede: 1, fortryd: 2, regler: 4 }]);
  assert.ok((await readFile(fil, 'utf8')).startsWith(foer), 'earlier lines are never rewritten');
}));

test('noter: calls at the same time do not lose or double ids', () => med(async (dir) => {
  const l = lavDagstal({ dir });
  await Promise.all([l.noter('2026-10-26', ['a', 'b']), l.noter('2026-10-26', ['b', 'c']), l.noter('2026-10-26', ['c', 'd'])]);
  assert.equal((await l.dage())[0]?.kraevede, 4);
}));

test('dage: reads seeded snapshots without ids, skips a broken line, and none at all is an empty list', () => med(async (dir, fil) => {
  const l = lavDagstal({ dir });
  assert.deepEqual(await l.dage(), []);
  await l.noter('2026-10-27', ['x']);
  await appendFile(fil, 'not json\n{"dato":"nope"}\n', 'utf8');
  await appendFile(fil, `${JSON.stringify({ dato: '2026-10-20', kraevede: 9, fortryd: 1 })}\n`, 'utf8');
  assert.deepEqual((await l.dage()).map((d) => [d.dato, d.kraevede, d.fortryd]), [['2026-10-20', 9, 1], ['2026-10-27', 1, 0]]);
}));

test('the file is gone (Slet alt, a re-seed): the next noter starts clean', () => med(async (dir, fil) => {
  const l = lavDagstal({ dir });
  await l.noter('2026-10-26', ['a', 'b']);
  await rm(path.dirname(fil), { recursive: true });
  await l.noter('2026-10-26', ['c']);
  assert.equal((await l.dage())[0]?.kraevede, 1);
}));

test('a replaced file (the test world re-seeds a moment) is read afresh', () => med(async (dir, fil) => {
  const l = lavDagstal({ dir });
  await l.noter('2026-10-26', ['a', 'b']);
  await writeFile(fil, `${JSON.stringify({ dato: '2026-10-26', kraevede: 7, fortryd: 0 })}\n`, 'utf8');
  await l.noter('2026-10-26', ['a']);
  assert.equal((await l.dage())[0]?.kraevede, 8);
}));

// ---- the line and the bars ----
/** `snit`/`fortryd` per week, oldest first, ending at the week of 2026-10-26 (week 44); 7 days of data in each given week. */
const uger = (...v: ([number, number] | null)[]): Ugetal[] => {
  const n = v.length;
  return v.map((x, i) => {
    const mandag = new Date(Date.UTC(2026, 9, 26) - (n - 1 - i) * 7 * 86_400_000).toISOString().slice(0, 10);
    return x ? { uge: mandag, nr: ugeNr(mandag), dage: 7, snit: x[0], fortryd: x[1] } : { uge: mandag, nr: ugeNr(mandag), dage: 0, snit: 0, fortryd: 0 };
  });
};
const linje = (r: Ugetal[], sidsteEr: 'denne' | 'sidste' = 'denne', hjaelp = false): string => String(ugeLinje(ugeVisning(r, sidsteEr)!, { hjaelp }));
const tekst = (h: string): string => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');

test('ugeVisning: nothing at all means no line', () => {
  assert.equal(ugeVisning(uger(null, null, null), 'denne'), undefined);
});

test('ugeLinje: this week against last week, with Fortryd', () => {
  assert.equal(tekst(linje(uger([9, 2], [6, 2]))), 'I denne uge krævede i snit 6 ting dig om dagen (sidste uge 9). Fortryd: 2.' + ' Det er faldet, uden at Fortryd steg.');
});

test('ugeLinje: the claim "uden at Fortryd steg" only when it is literally true', () => {
  const stiger = tekst(linje(uger([9, 1], [6, 3])));
  assert.equal(stiger, 'I denne uge krævede i snit 6 ting dig om dagen (sidste uge 9). Fortryd: 3 (sidste uge 1).');
  assert.ok(!stiger.includes('uden at Fortryd steg'));
  const ikkeFaldet = tekst(linje(uger([6, 0], [9, 0])));
  assert.ok(!ikkeFaldet.includes('uden at Fortryd steg') && !ikkeFaldet.includes('faldet'));
  assert.equal(ikkeFaldet, 'I denne uge krævede i snit 9 ting dig om dagen (sidste uge 6). Fortryd: 0.');
  // Same number once rounded: nothing fell as far as the reader can see.
  assert.ok(!tekst(linje(uger([6.2, 0], [5.8, 0]))).includes('faldet'));
});

test('ugeLinje: an unfinished week (fewer days than the one before) never claims Fortryd did not rise', () => {
  const r = uger([9, 2], [6, 0]);
  r[1] = { ...r[1]!, dage: 3 };
  assert.equal(tekst(linje(r)), 'I denne uge krævede i snit 6 ting dig om dagen (sidste uge 9). Fortryd: 0.');
});

test('ugeLinje: under two weeks of data, one number and a promise', () => {
  assert.equal(tekst(linje(uger(null, null, [6, 1]))), 'Første uge: 6 om dagen. Sammenligning kommer næste uge.');
  assert.equal(tekst(linje(uger([6, 1], null))), 'Første uge: 6 om dagen. Sammenligning kommer næste uge.');
});

test('ugeLinje in Nu on Monday: the finished week against the one before', () => {
  // The last element is last week; this week has barely begun.
  assert.equal(tekst(linje(uger([9, 1], [6, 1]), 'sidste')), 'Sidste uge krævede i snit 6 ting dig om dagen (ugen før 9). Fortryd: 1. Det er faldet, uden at Fortryd steg.');
});

test('ugeLinje: when the current week has no data yet the line is about the week before', () => {
  assert.equal(tekst(linje(uger([9, 1], [6, 1], null))), 'Sidste uge krævede i snit 6 ting dig om dagen (ugen før 9). Fortryd: 1. Det er faldet, uden at Fortryd steg.');
});

test('ugeLinje: a gap in the data compares with the last week that has data, by name', () => {
  assert.equal(tekst(linje(uger([9, 0], null, [6, 0]))), 'I denne uge krævede i snit 6 ting dig om dagen (uge 42: 9). Fortryd: 0. Det er faldet, uden at Fortryd steg.');
});

test('ugeLinje: help text states the definition, only when asked for', () => {
  const r = uger([9, 0], [6, 0]);
  assert.ok(!linje(r).includes('data-ugetal="hjaelp"'));
  const h = linje(r, 'denne', true);
  assert.match(h, /data-ugetal="hjaelp"/);
  assert.match(tekst(h), /stod under Kræver dig/);
  assert.match(tekst(h), /én gang/);
});

test('ugeSoejler: eight bars and a text alternative that names every week', () => {
  const h = String(ugeSoejler(uger([9, 0], [8, 0], [7, 0], [6, 0], [5, 0], null, [3, 0], [6, 1])));
  assert.match(h, /data-ugetal="soejler"/);
  assert.equal((h.match(/<rect /g) ?? []).length, 8);
  const alt = /aria-label="([^"]+)"/.exec(h)?.[1];
  assert.equal(alt, 'Ting der krævede dig om dagen, uge for uge: uge 37: 9, uge 38: 8, uge 39: 7, uge 40: 6, uge 41: 5, uge 42: –, uge 43: 3, uge 44: 6');
  assert.ok(h.includes('uge 37: 9, uge 38: 8'), 'the same text is on the page as a caption');
});
