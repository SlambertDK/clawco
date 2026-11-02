// KC-0124: "Hvad Clawco har gjort" — the audit lines in plain Danish for the Kø
// panel, newest first, times in Copenhagen, refusals marked for the filter
// "Det Clawco sagde nej til". Pure: lines in, HTML out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRevision } from '../../src/shell/revision.ts';
import type { Revisionslinje } from '../../src/graenser/revisionslog.ts';

const NU = new Date('2026-10-31T13:30:00Z'); // 14.30 in Copenhagen
const l = (o: Partial<Revisionslinje>): Revisionslinje => ({
  tid: '2026-10-31T13:05:00.000Z', person: 'henrik', kanal: 'knap', rum: 'dagen', verb: 'laes', udfald: 'tillad', hvorfor: 'Inden for grænserne.', zoner: ['privat'], kilde: 'graense', forrige: '0'.repeat(64), ...o,
});
const navne = { henrik: 'Henrik', maja: 'Maja' };

test('each line says when, where and what in plain Danish; Copenhagen time; the date only when not today', () => {
  const h = String(renderRevision([
    l({}),
    l({ tid: '2026-10-30T07:15:00.000Z', rum: 'mail', verb: 'sorter', kanal: 'stemme' }),
  ], { nu: NU, navne }));
  assert.match(h, /data-revision-linje/);
  assert.match(h, />14\.05</);
  assert.match(h, /30\. okt\. 08\.15/);
  assert.match(h, /Dagen: læste og byggede rummet/);
  assert.match(h, /Mail: sorterede/);
  assert.match(h, /fra stemmen/);
  assert.match(h, /fra en knap/);
  assert.doesNotMatch(h, /Inden for grænserne/, 'no noise on an allowed line');
});

test('a refusal says what Clawco said no to and why, and carries data-nej for the filter', () => {
  const h = String(renderRevision([
    l({ udfald: 'afvist', rum: 'mail', verb: 'betal', hvorfor: 'Clawco betaler aldrig noget. Det gør du selv.' }),
    l({ udfald: 'kraever-ja', rum: 'mail', verb: 'send-til-andre', hvorfor: 'Clawco må kun skrive til andre, når du selv har trykket ja på knappen.' }),
    l({}),
  ], { nu: NU, navne }));
  assert.match(h, /data-udfald="afvist" data-nej/);
  assert.match(h, /data-udfald="kraever-ja" data-nej/);
  assert.match(h, /data-udfald="tillad">/);
  assert.match(h, /Mail: sagde nej til at betale/);
  assert.match(h, /Mail: ventede på dit ja til at skrive til andre/);
  assert.match(h, /Clawco betaler aldrig noget\. Det gør du selv\./);
  assert.doesNotMatch(h, /data-ingen-nej/);
});

test('stop and resume name who did it', () => {
  const h = String(renderRevision([
    l({ udfald: 'genoptag', verb: 'genoptag', rum: 'alle', kilde: 'nodstop', zoner: [] }),
    l({ udfald: 'stop', verb: 'stop', rum: 'alle', kilde: 'nodstop', person: 'maja', zoner: [], hvorfor: 'Stop alt: 2 opgaver blev standset.' }),
  ], { nu: NU, navne }));
  assert.match(h, /Henrik startede Clawco igen/);
  assert.match(h, /Maja trykkede Stop alt/);
  assert.match(h, /2 opgaver blev standset/);
});

test('empty log and a log without refusals say so plainly', () => {
  assert.match(String(renderRevision([], { nu: NU, navne })), /Clawco har ikke gjort noget endnu\./);
  assert.match(String(renderRevision([l({})], { nu: NU, navne })), /data-ingen-nej[^>]*>Clawco har ikke sagt nej til noget af det seneste\./);
});

test('every text is escaped', () => {
  const h = String(renderRevision([l({ udfald: 'afvist', hvorfor: '<script>x</script>', rum: '<b>' })], { nu: NU, navne }));
  assert.doesNotMatch(h, /<script>|<b>/);
  assert.match(h, /&lt;script&gt;/);
});
