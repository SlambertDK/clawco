// KC-0248: step 0 — "What should Clawco take off your plate?". The pick (mail and deadlines · the family's logistics ·
// everything, I run things myself) is stored in Start's state; a tap previews it (the example Nu under the picks, every
// card marked as an example, and the three things Clawco never does), going on with it makes the step Klaret. The pick
// steers the order of the sources and of the optional steps and nothing else.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { efterSlags, efterTrinOrden, slagsRaekkefoelge } from '../../../src/rooms/start/situation.ts';
import { flereKilderKoe, type KildeTrin } from '../../../src/rooms/start/trin.ts';
import { parseStartState, SITUATIONER, type StartState } from '../../../src/rooms/start/schema.ts';
import { renderStart, type StartVisning } from '../../../src/rooms/start/render.ts';
import { alleTrin } from '../../../src/rooms/start/trin.ts';
import { START_TEKSTER } from '../../../src/rooms/start/tekster.ts';
import { ActionError } from '../../../src/rooms/module.ts';
import { medSprog } from '../../../src/shell/tekster.ts';
import { startRoom } from '../../../src/rooms/start/room.ts';
import { medStart, STARTET } from '../../helpers/start-deps.ts';

const NU = new Date('2026-11-09T09:00:00.000Z');
const TOM: StartState = { startet: STARTET, trin: {}, afvist: {} };
const kilde = (id: string, slags: string, forbundet = false): KildeTrin => ({ id, navn: id, slags, forbundet });
const ALLE: KildeTrin[] = [kilde('kal', 'kalender', true), kilde('mail', 'mail'), kilde('noter', 'noter'), kilde('nyh', 'nyheder'), kilde('besk', 'beskeder')];

// An installation from before step 0 must not get a new mandatory step.
test('an installation with a profile and no pick reads step 0 as done, writes nothing, and keeps today\'s order and count', async () => {
  const s0 = alleTrin()[0]!;
  assert.equal(s0.erKlaret(TOM, { profil: { navn: 'A', sprog: 'da', husstand: 'alene' } }), true);
  assert.equal(s0.erKlaret(null, { profil: { navn: 'A', sprog: 'da', husstand: 'alene' } }), true);
  assert.equal(s0.erKlaret(TOM, { profil: null }), false, 'a fresh install still starts with the pick');
  assert.equal(s0.erKlaret({ ...TOM, situation: { valg: 'mail', tid: STARTET } }, { profil: { navn: 'A', sprog: 'da', husstand: 'alene' } }), false, 'a pick under way is not skipped');
  await medStart({ forbi: true, udenSituation: true, state: { startet: STARTET, trin: {}, afvist: {} } }, async (s) => {
    const h = await s.main();
    assert.match(h, /data-trin="situation" data-trin-status="klaret"/);
    assert.doesNotMatch(h, /data-trin="situation"[^>]*data-trin-aaben/);
    assert.match(h, /data-trin="foerste-ret"[^>]*data-trin-aaben/, 'the open step is the one it always was');
    assert.equal((await s.state())?.situation, undefined, 'nothing written');
    assert.equal(await startRoom.venter!(s.d), 1, 'only the first Ret waits, as before');
  });
});

// ---- the order the pick gives -------------------------------------------------------------------------------------------

test('the sources come in the pick\'s order; no pick and "everything" leave the registry\'s own order', () => {
  const kort = [kilde('k', 'kalender'), kilde('m', 'mail'), kilde('k2', 'kalender')];
  assert.deepEqual(efterSlags(kort, (k) => k.slags, 'mail').map((k) => k.id), ['m', 'k', 'k2'], 'mail first for mail and deadlines');
  assert.deepEqual(efterSlags(kort, (k) => k.slags, 'familie').map((k) => k.id), ['k', 'k2', 'm'], 'the calendar first for the family');
  assert.deepEqual(efterSlags(kort, (k) => k.slags, 'alt').map((k) => k.id), ['k', 'm', 'k2'], 'untouched');
  assert.deepEqual(efterSlags(kort, (k) => k.slags, undefined).map((k) => k.id), ['k', 'm', 'k2'], 'untouched');
  assert.deepEqual(slagsRaekkefoelge('mail').slice(0, 2), ['mail', 'kalender']);
});

test('step 4\'s pile follows the pick: messages right after the second of calendar/mail for the family, news for mail and deadlines', () => {
  const foerste: StartState = { ...TOM, kilder: { kal: { foersteVaerdiMs: 1, tid: STARTET, forhaandsvisning: { kildeId: 'kal', navn: 'kal', slags: 'kalender', titel: 't', linje: '', hentet: STARTET } } } };
  const pile = (situation?: StartState['situation']): string[] => flereKilderKoe({ ...foerste, ...(situation ? { situation } : {}) }, { profil: null, kilder: ALLE }).map((k) => k.slags);
  assert.deepEqual(pile(), ['mail', 'noter', 'nyheder', 'beskeder'], 'the journey\'s own order today');
  assert.deepEqual(pile({ valg: 'alt', tid: STARTET }), ['mail', 'noter', 'nyheder', 'beskeder']);
  assert.deepEqual(pile({ valg: 'familie', tid: STARTET }), ['mail', 'beskeder', 'noter', 'nyheder']);
  assert.deepEqual(pile({ valg: 'mail', tid: STARTET }), ['mail', 'nyheder', 'noter', 'beskeder']);
});

test('the optional steps: bringing the other assistants\' knowledge comes first for mail and deadlines, the rest keep the journey\'s order', () => {
  const trin = ['foerste-ret', 'flere-kilder', 'import'];
  assert.deepEqual(efterTrinOrden(trin, (x) => x, 'mail'), ['foerste-ret', 'import', 'flere-kilder']);
  for (const s of ['familie', 'alt', undefined] as const) assert.deepEqual(efterTrinOrden(trin, (x) => x, s), trin, String(s));
  assert.deepEqual(efterTrinOrden(['import'], (x) => x, 'mail'), ['import'], 'nothing to move without the other step');
});

// ---- the state --------------------------------------------------------------------------------------------------------

test('the pick is validated when Start\'s state is read: a known pick and times only', () => {
  const rå = (situation: unknown): unknown => ({ startet: STARTET, trin: {}, afvist: {}, situation });
  assert.deepEqual(parseStartState(rå({ valg: 'familie', tid: STARTET, bekraeftet: STARTET }))?.situation, { valg: 'familie', tid: STARTET, bekraeftet: STARTET });
  assert.deepEqual(parseStartState(rå({ valg: 'mail', tid: STARTET }))?.situation, { valg: 'mail', tid: STARTET });
  assert.deepEqual(parseStartState(rå({ valg: 'mail', tid: STARTET, bekraeftet: 'i går' }))?.situation, { valg: 'mail', tid: STARTET }, 'a bad confirmation time is dropped');
  for (const dårlig of [{ valg: 'betal', tid: STARTET }, { valg: 'mail' }, { valg: 'mail', tid: 'aldrig' }, 'mail', null, []]) {
    assert.equal(parseStartState(rå(dårlig))?.situation, undefined, JSON.stringify(dårlig));
  }
  assert.deepEqual([...SITUATIONER], ['mail', 'familie', 'alt']);
});

// ---- what is on screen ------------------------------------------------------------------------------------------------

const trin = (status: 'ikke-startet' | 'i-gang' | 'klaret') => alleTrin().map((t) => ({ trin: t, status: t.id === 'situation' ? status : ('ikke-startet' as const) }));
const render = (o: Partial<StartVisning> = {}): string => String(renderStart({ trin: trin('ikke-startet'), profil: null, standardNavn: '', forslag: [], kanGemme: true, now: NU, ...o }));
const kort0 = (h: string): string => /<article[^>]*data-trin="situation"[\s\S]*?<\/article>/.exec(h)?.[0] ?? '';

test('step 0 open: the three picks as buttons, the first pick\'s example under them, no Gå videre before a pick is made', () => {
  const k = kort0(render());
  assert.deepEqual([...k.matchAll(/data-situation="([a-z]+)"/g)].map((m) => m[1]), ['mail', 'familie', 'alt']);
  assert.equal((k.match(/data-aktion="situation-vaelg"/g) ?? []).length, 3);
  assert.ok(!k.includes('aria-pressed="true"'), 'nothing is pressed');
  assert.match(k, /data-eksempel="mail"/);
  assert.doesNotMatch(k, /situation-bekraeft/);
});

test('each pick has its own example Nu: three cards, each marked as an example, and the three refusals', () => {
  for (const valg of SITUATIONER) {
    const k = kort0(render({ trin: trin('i-gang'), situation: { valg, tid: STARTET } }));
    assert.match(k, new RegExp(`data-situation="${valg}"[^>]*aria-pressed="true"`), `${valg} is pressed`);
    assert.match(k, new RegExp(`data-eksempel="${valg}"`));
    assert.equal((k.match(/data-eksempel-kort/g) ?? []).length, 3, `${valg}: three cards`);
    assert.equal((k.match(/>Eksempel<\/span>/g) ?? []).length, 3, `${valg}: every card is labelled`);
    assert.equal((k.match(/<li>Clawco (betaler|sender|sletter) aldrig[^<]*<\/li>/g) ?? []).length, 3, `${valg}: the three refusals`);
    assert.match(k, /data-aktion="situation-bekraeft"/, `${valg}: Gå videre is offered`);
    const eksempel = /<div class="eksempel"[\s\S]*?<div class="aldrig"/.exec(k)?.[0] ?? '';
    assert.ok(eksempel.includes('data-eksempel-kort'));
    assert.doesNotMatch(eksempel, /data-element=|data-aktion=|data-ask=/, 'an example card is not an element to correct or act on');
  }
});

test('the example and the refusals are in the language being rendered, with no Danish left over', () => {
  for (const valg of SITUATIONER) {
    const en = medSprog('en', () => kort0(render({ trin: trin('i-gang'), situation: { valg, tid: STARTET } })));
    assert.match(en, /What should Clawco take off your plate\?/);
    assert.match(en, />Example<\/span>/);
    assert.match(en, /Clawco never pays for anything on your behalf\./);
    assert.match(en, /Clawco never sends mail to others\./);
    assert.match(en, /Clawco never deletes anything on its own\./);
    assert.doesNotMatch(en.replace(/<[^>]+>/g, ' '), /\b(aldrig|Eksempel|dig|jeg|og|til)\b/, 'no Danish word');
  }
  assert.equal(START_TEKSTER.da.situation.aldrig.length, 3);
  assert.equal(START_TEKSTER.en.situation.aldrig.length, 3);
  for (const v of SITUATIONER) assert.equal(START_TEKSTER.en.situation.eksempler[v].length, START_TEKSTER.da.situation.eksempler[v].length);
});

test('read-only for anyone but the owner: the example is shown, there is nothing to press', () => {
  const k = kort0(render({ kanGemme: false }));
  assert.doesNotMatch(k, /data-aktion=/);
  assert.match(k, /data-eksempel=/);
});

test('step 0 Klaret folds to its pick; the picks behind "Ret valget", no example repeated', () => {
  const h = render({ trin: trin('klaret'), situation: { valg: 'alt', tid: STARTET, bekraeftet: STARTET } });
  const l = /<article[^>]*data-trin="situation"[\s\S]*?<\/article>/.exec(h)?.[0] ?? '';
  assert.match(l, /data-trin-foldet/);
  assert.match(l, /data-situation-valgt="alt"/);
  assert.doesNotMatch(l, /data-eksempel/);
  assert.match(l, /data-aktion="situation-vaelg"/, 'the pick can be changed');
});

// ---- the handlings -----------------------------------------------------------------------------------------------------

test('a tap stores the pick and previews it; the step is not Klaret until the person goes on', async () => {
  await medStart({}, async (s) => {
    await s.aktion('situation-vaelg', { valg: 'familie' });
    const st = await s.state();
    assert.equal(st?.situation?.valg, 'familie');
    assert.equal(st?.situation?.bekraeftet, undefined);
    assert.equal(st?.trin['situation']?.status, 'i-gang');
    assert.match(await s.main(), /data-trin="situation" data-trin-status="i-gang"[^>]*data-trin-aaben/);
    assert.deepEqual(await s.log(), ['Valgte: Familiens logistik.']);
  });
});

test('going on needs a pick; with one it makes the step Klaret and logs it once', async () => {
  await medStart({}, async (s) => {
    await assert.rejects(() => s.aktion('situation-bekraeft'), (e: unknown) => e instanceof ActionError && /Vælg først/.test(e.message));
    await s.aktion('situation-vaelg', { valg: 'mail' });
    await s.aktion('situation-bekraeft');
    const st = await s.state();
    assert.equal(st?.trin['situation']?.status, 'klaret');
    assert.ok(st?.situation?.bekraeftet);
    assert.match(await s.main(), /data-trin="situation" data-trin-status="klaret"/);
    assert.deepEqual(await s.log(), ['Gik videre med: Mail og deadlines.', 'Valgte: Mail og deadlines.'], 'newest first');
  });
});

test('changing the pick after going on keeps the step Klaret (and changes the order of what comes)', async () => {
  await medStart({}, async (s) => {
    await s.aktion('situation-vaelg', { valg: 'mail' });
    await s.aktion('situation-bekraeft');
    const foer = (await s.state())?.situation?.bekraeftet;
    await s.aktion('situation-vaelg', { valg: 'familie' });
    const st = await s.state();
    assert.equal(st?.situation?.valg, 'familie');
    assert.equal(st?.situation?.bekraeftet, foer, 'the confirmation stays');
    assert.equal(st?.trin['situation']?.status, 'klaret');
  });
});

test('an unknown pick is refused and writes nothing; so does anyone but the owner', async () => {
  await medStart({}, async (s) => {
    for (const valg of ['betal-min-regning', '', 7, undefined, null, {}]) {
      await assert.rejects(() => s.aktion('situation-vaelg', { valg }), (e: unknown) => e instanceof ActionError && e.status === 400, JSON.stringify(valg) ?? 'undefined');
    }
    assert.equal(await s.state().then((x) => x?.situation), undefined);
  });
  await medStart({ person: { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' } }, async (s) => {
    for (const a of ['situation-vaelg', 'situation-bekraeft']) await assert.rejects(() => s.aktion(a, { valg: 'mail' }), (e: unknown) => e instanceof ActionError && /Kun ejeren/.test(e.message));
    assert.equal(await s.state().then((x) => x?.situation), undefined);
  });
});

test('the pick reaches the optional steps\' order in the room: mail and deadlines bring the import first', async () => {
  const importSkriver = { klar: async () => true, skriv: async () => {}, laes: async () => null } as never;
  await medStart({ forbi: true, importSkriver, state: { startet: STARTET, trin: {}, afvist: {}, ret: { art: 'ret', tid: STARTET, titel: 'x' }, situation: { valg: 'mail', tid: STARTET, bekraeftet: STARTET } } }, async (s) => {
    assert.match(await s.main(), /data-trin="import"[^>]*data-trin-aaben/);
  });
});
