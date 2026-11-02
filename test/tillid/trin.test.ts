// KC-0143: a rule grants only what its trin allows, and the limits can never
// be given away. Table-driven over the pure decision in src/tillid/trin.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { GRAENSEKLASSER, TRIN, maksTrinForForslag, tilladtAfRegler, trinForVerb } from '../../src/tillid/trin.ts';
import type { Regel, Trin } from '../../src/tillid/regler.ts';
import type { ReglerLaest } from '../../src/tillid/lager.ts';
import { VERBER } from '../../src/graenser/verber.ts';

let nr = 0;
const regel = (trin: Trin, kilde: string, slags?: string, status: Regel['status'] = 'aktiv'): Regel => ({
  id: `R-${String(++nr).padStart(4, '0')}`, titel: 't', tekst: '', trin, gaelder: { kilde, ...(slags ? { slags } : {}) },
  oprindelse: { art: 'haand', dato: '2026-11-01' }, status,
});
const ok = (...regler: Regel[]): ReglerLaest => ({ tilstand: 'ok', saet: { naesteId: 99, regler, ugyldige: [] }, aendretUdenfor: false });
const h = (kraevetTrin: Trin, o: { kilde?: string; slags?: string; klasse?: 'normal' | (typeof GRAENSEKLASSER)[number] } = {}) =>
  ({ kilde: o.kilde ?? 'mail', ...(o.slags !== undefined ? { slags: o.slags } : { slags: 'regning' }), kraevetTrin, klasse: o.klasse ?? 'normal' as const });

test('the table: trin 0–4 in order, each with its verb and a Danish sentence', () => {
  assert.deepEqual(TRIN.map((t) => t.trin), [0, 1, 2, 3, 4]);
  assert.deepEqual(TRIN.map((t) => t.navn), ['se', 'sortere', 'føre regnskab', 'forberede', 'udføre med fortryd']);
  assert.deepEqual(TRIN.map((t) => t.verb), ['laes', 'sorter', 'bogfoer', 'forbered', 'udfoer-med-fortryd']);
  for (const t of TRIN) assert.match(t.saetning, /^Hermes må /);
  assert.deepEqual([...VERBER], [...TRIN.map((t) => t.verb), ...GRAENSEKLASSER], 'the policy layer\'s verbs are the ladder plus the limits');
  for (const t of TRIN) assert.equal(trinForVerb(t.verb), t.trin);
  for (const g of GRAENSEKLASSER) assert.equal(trinForVerb(g), null);
  assert.equal(trinForVerb('koeb'), null);
});

test('every (rule trin × required trin) pair: a rule at trin N covers exactly required ≤ N', () => {
  for (const rt of [0, 1, 2, 3, 4] as Trin[]) for (const kt of [0, 1, 2, 3, 4] as Trin[]) {
    const r = regel(rt, 'mail', 'regning');
    const a = tilladtAfRegler(ok(r), h(kt));
    assert.deepEqual(a, kt <= rt ? { tilladt: true, regelId: r.id } : { tilladt: false, aarsag: 'for-lavt-trin' }, `regel ${rt} × kræver ${kt}`);
  }
});

test('every limit class is denied, even with an active trin-4 rule for everything', () => {
  const alt = ok(regel(4, '*'), regel(4, 'mail'), regel(4, 'mail', 'regning'));
  for (const klasse of GRAENSEKLASSER) for (const kt of [0, 1, 2, 3, 4] as Trin[]) {
    assert.deepEqual(tilladtAfRegler(alt, h(kt, { klasse })), { tilladt: false, aarsag: 'graense' }, `${klasse} ${kt}`);
    for (const l of [undefined, { tilstand: 'mangler' } as const]) assert.deepEqual(tilladtAfRegler(l, h(kt, { klasse })), { tilladt: false, aarsag: 'graense' });
  }
});

test('a paused rule does not count; the highest matching active rule decides', () => {
  assert.deepEqual(tilladtAfRegler(ok(regel(4, 'mail', 'regning', 'pause')), h(2)), { tilladt: false, aarsag: 'ingen-regel' });
  const lav = regel(1, 'mail', 'regning');
  assert.deepEqual(tilladtAfRegler(ok(lav, regel(4, 'mail', 'regning', 'pause')), h(2)), { tilladt: false, aarsag: 'for-lavt-trin' });
  const hoej = regel(3, 'mail');
  assert.deepEqual(tilladtAfRegler(ok(lav, hoej), h(2)), { tilladt: true, regelId: hoej.id });
});

test('scope: kilde and slags must match; a rule with slags never covers a handling without one; * covers every kilde', () => {
  assert.deepEqual(tilladtAfRegler(ok(regel(4, 'kalender')), h(2)), { tilladt: false, aarsag: 'ingen-regel' });
  assert.deepEqual(tilladtAfRegler(ok(regel(4, 'mail', 'nyhedsbrev')), h(2)), { tilladt: false, aarsag: 'ingen-regel' });
  assert.deepEqual(tilladtAfRegler(ok(regel(4, 'mail', 'regning')), { kilde: 'mail', kraevetTrin: 2, klasse: 'normal' }), { tilladt: false, aarsag: 'ingen-regel' });
  const bred = regel(2, 'mail');
  assert.deepEqual(tilladtAfRegler(ok(bred), h(2)), { tilladt: true, regelId: bred.id }, 'a rule without slags covers every slags of its kilde');
  const stjerne = regel(2, '*');
  assert.deepEqual(tilladtAfRegler(ok(stjerne), h(2, { kilde: 'kalender', slags: 'møde' })), { tilladt: true, regelId: stjerne.id });
  const sr = regel(2, 'Mail', 'Regning');
  assert.deepEqual(tilladtAfRegler(ok(sr), h(2, { kilde: 'MAIL', slags: 'regning' })), { tilladt: true, regelId: sr.id }, 'case does not matter');
});

test('fail closed: no file, an unreadable file or no rules → ingen-regel for everything', () => {
  for (const l of [undefined, { tilstand: 'mangler' } as const, { tilstand: 'ulaeselig', hvorfor: 'x', aendretUdenfor: false } as const, ok()]) {
    for (const kt of [0, 1, 2, 3, 4] as Trin[]) assert.deepEqual(tilladtAfRegler(l, h(kt)), { tilladt: false, aarsag: 'ingen-regel' });
  }
});

test('maksTrinForForslag: one above the highest covering active rule, at least 1, at most 4', () => {
  const g = { kilde: 'mail', slags: 'regning' };
  assert.equal(maksTrinForForslag(undefined, g), 1);
  assert.equal(maksTrinForForslag({ tilstand: 'ulaeselig', hvorfor: 'x', aendretUdenfor: false }, g), 1);
  assert.equal(maksTrinForForslag(ok(), g), 1);
  assert.equal(maksTrinForForslag(ok(regel(0, 'mail', 'regning')), g), 1);
  assert.equal(maksTrinForForslag(ok(regel(1, 'mail', 'regning')), g), 2);
  assert.equal(maksTrinForForslag(ok(regel(2, 'mail')), g), 3, 'a broader rule for the kilde counts');
  assert.equal(maksTrinForForslag(ok(regel(3, 'mail', 'regning', 'pause')), g), 1, 'a paused rule does not lift the cap');
  assert.equal(maksTrinForForslag(ok(regel(3, 'kalender')), g), 1, 'another kilde does not count');
  assert.equal(maksTrinForForslag(ok(regel(4, 'mail', 'regning')), g), 4, 'never above 4');
});

// AGENTS.md lives in the private record only; the public mirror (KC-0228) skips this check.
const MED_AGENTS = existsSync(new URL('../../AGENTS.md', import.meta.url));
test('GRAENSEKLASSER and the limits in AGENTS.md §9 cannot drift apart', { skip: !MED_AGENTS && 'no AGENTS.md in the public mirror' }, async () => {
  const agents = await readFile(new URL('../../AGENTS.md', import.meta.url), 'utf8');
  const s9 = agents.slice(agents.indexOf('## §9'));
  const m = /Hermes must never be given a key to ([\s\S]+?) from this app/.exec(s9);
  assert.ok(m, 'the §9 limits bullet');
  const ting = (m[1] as string).replace(/\s+/g, ' ').split(/,\s*|\s+or\s+/).map((t) => t.trim()).filter(Boolean);
  const KORT: Record<(typeof GRAENSEKLASSER)[number], RegExp> = { betal: /^pay$/, 'send-til-andre': /^send mail to others$/, slet: /^delete data$/, 'kopier-paa-tvaers': /^copy data across zones$/ };
  assert.deepEqual(Object.keys(KORT).sort(), [...GRAENSEKLASSER].sort(), 'every limit class has its §9 wording here');
  for (const t of ting) assert.equal(GRAENSEKLASSER.filter((g) => KORT[g].test(t)).length, 1, `§9 names "${t}": exactly one limit class must match it`);
  for (const g of GRAENSEKLASSER) assert.ok(ting.some((t) => KORT[g].test(t)), `${g} is named in §9`);
});
