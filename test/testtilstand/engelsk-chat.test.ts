// KC-0242: the test world's scripted Hermes answers an English chat message like the Danish one. At the English moments
// (`engelsk`, `kold-engelsk`) Henrik types English, so every intent in indhold/samtale.ts also matches the English
// phrasing of the same question and gives the SAME scripted answer. The answers stay Danish on purpose (KC-0170/KC-0241):
// only the matching is bilingual. The Danish phrasings stay green in forslag.test.ts and indhold.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatSvar } from '../../src/testtilstand/indhold/samtale.ts';
import { ALLE_MOMENTER, froe, svar } from '../../src/testtilstand/indhold.ts';
import { ENGELSK, ENGELSK_MOMENT, fakta, momentPlus, plusDag } from '../../src/testtilstand/indhold/fakta.ts';
import { bilBooking, TEST_HUSSTAND } from '../../src/testtilstand/indhold/husstand.ts';
import type { Moment } from '../../src/testtilstand/typer.ts';
import type { AgentRunRequest } from '../../src/agent/types.ts';
import type { DagenState } from '../../src/rooms/dagen/schema.ts';
import type { MailState } from '../../src/rooms/mail/schema.ts';
import type { NyhederState } from '../../src/rooms/nyheder/schema.ts';
import { buildChatRun } from '../../src/rooms/dagen/prompt.ts';
import { buildMailChatRun } from '../../src/rooms/mail/prompt.ts';
import { buildNyhederChatRun } from '../../src/rooms/nyheder/prompt.ts';
import { buildNytRun } from '../../src/rooms/skrive/prompt.ts';
import { buildHjemChatRun } from '../../src/rooms/hjem/prompt.ts';
import { universRum } from '../../src/rooms/univers/lager.ts';
import type { UniversIndeks, UniversState } from '../../src/rooms/univers/schema.ts';
import { buildOversigtChatRun, buildUniversChatRun } from '../../src/rooms/univers/prompt.ts';
import { koebenhavnTilIso } from '../../src/rooms/univers/tid.ts';
import { buildHusstandChatRun } from '../../src/hushold/prompt.ts';
import { medlemmerAf } from '../../src/hushold/personer.ts';
import { UNIVERS_TEKSTER } from '../../src/rooms/univers/tekster.ts';
import { FORSLAG, forslagTil } from '../../src/shell/forslag.ts';
import { medSprog } from '../../src/store/sprog.ts';

const f = fakta('2026-10-30');
const MOMENTER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** [room, intent id, a Danish phrasing, the English phrasing of the same question]. */
const PAR: [string, string, string, string][] = [
  ['husstand', 'husstand', 'Hvad skal vi i denne uge?', 'What are we doing this week?'],
  ['husstand', 'husstand', 'Hvad sker der i husstanden?', 'What is happening in the household?'],
  ['husstand', 'husstand', 'Hvad laver familien?', 'What is the family up to?'],
  ['hjem', 'venter', 'Hvad venter på mig?', 'What is waiting for me?'],
  ['hjem', 'venter', 'Hvad venter på mig i dag?', 'What is waiting for me today?'],
  ['mail', 'kan-vente', 'Hvad kan vente?', 'What can wait?'],
  ['dagen', 'ledig-tid', 'Hvornår har jeg tid?', 'When do I have time?'],
  ['dagen', 'ledig-tid', 'Har jeg ledig tid i dag?', 'Do I have any free time today?'],
  ['nyheder', 'nyhederne', 'Hvad betyder nyhederne for mig?', 'What does the news mean for me?'],
  ['univers-havvind-nord', 'univers-status', 'Hvad er der gang i?', 'What is going on?'],
  ['univers-havvind-nord', 'univers-status', 'Hvad er åbent her?', 'What is open here?'],
  ['univers-havvind-nord', 'univers-status', 'Hvad skal jeg følge op på?', 'What should I follow up on?'],
  ['skrive', 'kortere', 'Gør udkastet kortere', 'Make the draft shorter'],
  ['skrive', 'kortere', 'Stram teksten op', 'Tighten the text'],
  ['skrive', 'kortere', 'Forkort det', 'Shorten it'],
  ['hjem', 'kortere', 'Gør den kortere', 'Make it shorter'],
  ['dagen', 'flyt', 'Flyt løbeturen til 17.30', 'Move my run to 17.30'],
  ['dagen', 'flyt', 'Flyt løbet til kl. 14', 'Reschedule the run to 14:00'],
  ['hjem', 'sidst', 'Hvad sagde vi sidst?', 'What did we say last time?'],
  ['hjem', 'sidst', 'Hvordan gik sidste uge?', 'How did last week go?'],
  ['hjem', 'bekymring', 'Hvad er Claras største bekymring?', "What is Clara's biggest concern?"],
  ['hjem', 'bekymring', 'Er hun nervøs?', 'Is she worried?'],
  ['hjem', 'moede', 'Hvad blev vi enige om?', 'What did we agree on?'],
  ['hjem', 'moede', 'Hvad kom der ud af mødet?', 'What came out of the meeting?'],
  ['mail', 'elektriker', 'Hvad skal jeg svare elektrikeren?', 'What should I reply to the electrician?'],
  ['mail', 'elektriker', 'Hvad med tilbuddet?', 'What about the quote?'],
  ['hjem', 'regnskab', 'Hvad står der i regnskabet?', 'What is in the accounts?'],
  ['hjem', 'regnskab', 'Hvad med elregningen og bredbånd?', 'What about the electricity bill and the broadband?'],
  ['hjem', 'vvs', 'Hvad med VVS-fakturaen?', 'What about the plumber invoice?'],
  ['hjem', 'claude-code', 'Hvad laver Claude Code?', 'What is Claude Code working on?'],
  ['hjem', 'claude-code', 'Hvad er status på min opgave?', 'What is the status of my task?'],
  ['hjem', 'loerdag', 'Er jeg fri lørdag?', 'Am I free on Saturday?'],
  ['hjem', 'loerdag', 'Hvad er der i weekenden?', 'What is on this weekend?'],
  ['hjem', 'loerdag', 'Hvad med Birthes fødselsdag?', "What about Birthe's birthday?"],
  ['hjem', 'tilbage', 'Er jeg tilbage fra løbeturen?', 'Am I back from my run?'],
  ['hjem', 'tilbage', 'Er jeg hjemme tidligt?', 'Will I be home early?'],
  ['hjem', 'mangler', 'Hvad skal jeg hente?', 'What do I have to pick up?'],
  ['hjem', 'mangler', 'Hvornår slutter Ella i SFO?', 'When does Ella finish at after-school care?'],
  ['hjem', 'dag', 'Godmorgen, hvad skal jeg i dag?', 'Good morning, what am I doing today?'],
  ['hjem', 'dag', 'Hvad er planen?', 'What is the plan?'],
  ['hjem', 'dag', 'Giv mig et overblik', 'Give me an overview'],
  ['mail', 'vigtigst', 'Hvilken mail haster mest?', 'Which mail is most urgent?'],
  ['hjem', 'vigtigst', 'Hvad er vigtigst?', 'What is most important?'],
  ['start', 'start', 'Hvad skal jeg nu?', 'What should I do now?'],
  ['hjem', 'vigtigst', 'Hvad skal jeg nu?', 'What should I do now?'],
  ['hjem', 'vigtigst', 'Hvad er mit næste skridt?', 'What is my next step?'],
  ['hjem', 'vigtigst', 'Hvad er prioriteten?', 'What is the priority?'],
  ['hjem', 'hvem', 'Hvem er Clara?', 'Who is Clara?'],
  ['hjem', 'godnat', 'Godnat', 'Good night'],
  ['hjem', 'godnat', 'Sov godt', 'Sleep well'],
];

test('every intent answers the English phrasing exactly like the Danish one, in every room-moment', () => {
  for (const [rum, art, da, en] of PAR) {
    for (const n of MOMENTER) {
      const d = chatSvar(rum, n, da, f);
      const e = chatSvar(rum, n, en, f);
      assert.equal(d.art, art, `Danish "${da}" in ${rum} moment ${n} answers as ${d.art}, expected ${art}`);
      assert.deepEqual(e, d, `English "${en}" in ${rum} moment ${n} must give the Danish answer (${art}), got ${e.art}`);
    }
  }
});

test('the moves carry the same new start and end from an English sentence', () => {
  const r = chatSvar('dagen', 0, 'Move my run to 17.30', f);
  assert.equal(r.art, 'flyt');
  assert.deepEqual(r.flyt, { tid: '17.30', slut: '18.30' });
  assert.match(r.tekst, /^Løbeturen ligger nu klokken 17\.30\./);
  assert.equal(chatSvar('dagen', 0, 'Move my run to 5.30 pm', f).flyt?.tid, '17.30');
  assert.equal(chatSvar('dagen', 0, 'Move my run to 5 pm', f).flyt?.tid, '17.00');
  assert.equal(chatSvar('dagen', 0, 'Move my run to 9 am', f).flyt?.tid, '09.00');
  assert.equal(chatSvar('mail', 0, 'Make it shorter', f).kortere, undefined);
  assert.equal(chatSvar('skrive', 0, 'Make the draft shorter', f).kortere, true);
});

test('every English chip the empty chat offers is answered like its Danish twin, and is not the fall-through', () => {
  const rum = [...Object.keys(FORSLAG), 'univers-havvind-nord'];
  const ikkeSendt = (s: string): boolean => s !== 'Jeg vil skrive' && s !== 'Hvad kan jeg sige?' && s !== 'I want to write' && s !== 'What can I say?';
  for (const r of rum) {
    const da = forslagTil(r).filter(ikkeSendt);
    const en = medSprog('en', () => forslagTil(r)).filter(ikkeSendt);
    assert.equal(en.length, da.length, `${r}: as many English chips as Danish`);
    for (let i = 0; i < en.length; i++) {
      for (const n of MOMENTER) {
        const e = chatSvar(r, n, en[i] as string, f);
        assert.notEqual(e.art, 'fallback', `${r} / "${en[i]}" / moment ${n} falls through`);
        assert.deepEqual(e, chatSvar(r, n, da[i] as string, f), `${r} / "${en[i]}" / moment ${n} differs from its Danish twin`);
      }
    }
  }
});

test('the English moment\'s own line is answered, not the fall-through', () => {
  for (const n of MOMENTER) {
    const e = chatSvar('hjem', n, ENGELSK_MOMENT.replik, f);
    assert.equal(e.art, 'venter');
    assert.deepEqual(e, chatSvar('hjem', n, 'Hvad venter på mig i dag?', f));
  }
});

test('an unrelated English sentence still gets the fall-through, and the pointed-at element still gets the context answer', () => {
  assert.equal(chatSvar('hjem', 0, 'Please recite a poem about a lighthouse', f).art, 'fallback');
  const k = chatSvar('hjem', 0, 'Please recite a poem about a lighthouse', f, 'Card: Weather');
  assert.equal(k.art, 'kontekst');
  assert.match(k.tekst, /^Om Card: Weather: /);
});

test('the car booking reads an English sentence like the Danish one', () => {
  const d = bilBooking('Jeg skal bruge den store bil lørdag 10 til 15', f, 'bil-loerdag');
  assert.ok(d);
  assert.deepEqual(bilBooking('I need the big car on Saturday 10 to 15', f, 'bil-loerdag'), d);
  assert.deepEqual(bilBooking('I need the large car Saturday 10-15', f, 'bil-loerdag'), d);
  const lille = bilBooking('Jeg skal bruge den lille bil lørdag 9 til 12.30', f, 'bil-loerdag');
  assert.ok(lille);
  assert.deepEqual(bilBooking('Can I have the small car on Saturday 9 to 12.30?', f, 'bil-loerdag'), lille);
  assert.equal(bilBooking('I need the big car on Saturday', f, 'bil-loerdag'), null);
  assert.equal(bilBooking('I need a bike on Saturday 10 to 15', f, 'bil-loerdag'), null);
});

// ---------- Through the scripted Hermes (svar.ts): the sentences read inside a run ----------
// Both sentences are sent inside the English run (medSprog('en', …) and the English element labels), so the only thing that
// differs between the two answers is the language of Henrik's own words.

const DAG = '2026-10-29';
const m = ALLE_MOMENTER.find((x) => x.id === ENGELSK) as Moment;
const nu = (): Date => new Date(koebenhavnTilIso(`${plusDag(DAG, momentPlus(m, DAG))}T${m.tid}`) as string);
const staten = <T>(rum: string): T => froe(m.id, DAG).rum[rum]?.state as T;
const hermes = (req: AgentRunRequest): string => svar(req, { moment: m, dag: DAG });
const pa = (...bygger: (() => AgentRunRequest)[]): string[] => medSprog('en', () => bygger.map((b) => hermes(b())));

test('Skrive: a brief in English picks the same scripted draft as the Danish brief', () => {
  const par: [string, string][] = [
    ['Skriv en kort opfølgning til Clara efter mødet i dag', 'Write a short follow-up to Clara after the meeting today'],
    ['Svar elektrikeren på tilbuddet', 'Reply to the electrician about the quote'],
    ['En hilsen til min mor på fødselsdagen', 'A greeting to my mum for her birthday'],
    ['En hilsen til min mor på fødselsdagen', 'A greeting to my mom for her birthday'],
  ];
  for (const [da, en] of par) {
    const [d, e] = pa(() => buildNytRun('', da), () => buildNytRun('', en));
    assert.equal(e, d, `"${en}" must give the draft "${da}" gives`);
  }
  const [ukendt] = pa(() => buildNytRun('', 'A note about the garden shed'));
  assert.doesNotMatch(ukendt as string, /Opfølgning|elektrikeren|Birthe/);
});

test('Dagen, Husstanden and Mail chats: an English sentence is answered like its Danish twin', () => {
  const dagen = staten<DagenState>('dagen');
  const medl = medlemmerAf(TEST_HUSSTAND.personer, []);
  const lille = [{ id: 'lille-bil', navn: 'Den lille bil', slags: 'bil' as const, ejere: ['henrik'], kalender: [] }];
  const d0 = nu();
  const par: [() => AgentRunRequest, () => AgentRunRequest][] = [
    [() => buildChatRun('Flyt løbeturen til kl. 17.30', undefined, dagen), () => buildChatRun('Move my run to 5.30 pm', undefined, dagen)],
    [() => buildChatRun('Hvornår har jeg tid?', undefined, dagen), () => buildChatRun('When do I have time?', undefined, dagen)],
    [() => buildHusstandChatRun('Jeg skal bruge den lille bil lørdag 9.30 til 11', undefined, medl, [], lille, d0), () => buildHusstandChatRun('I need the small car on Saturday 9.30 to 11', undefined, medl, [], lille, d0)],
    [() => buildHusstandChatRun('Hvad skal vi i denne uge?', undefined, medl, []), () => buildHusstandChatRun('What are we doing this week?', undefined, medl, [])],
    [() => buildMailChatRun('Hvilken mail haster mest?', undefined, staten<MailState>('mail')), () => buildMailChatRun('Which mail is most urgent?', undefined, staten<MailState>('mail'))],
    [() => buildNyhederChatRun('Hvad betyder nyhederne for mig?', undefined, staten<NyhederState>('nyheder')), () => buildNyhederChatRun('What does the news mean for me?', undefined, staten<NyhederState>('nyheder'))],
    [() => buildHjemChatRun('Hvad venter på mig?', 'Overblik', d0, []), () => buildHjemChatRun('What is waiting for me?', 'Overblik', d0, [])],
  ];
  for (const [da, en] of par) {
    const [d, e] = pa(da, en);
    assert.equal(e, d, `${en().input.split('\n\n').at(-1)} must give the answer of ${da().input.split('\n\n').at(-1)}`);
    assert.notEqual(d, hermes(medSprog('en', () => buildChatRun('Please recite a poem about a lighthouse', undefined, dagen))), 'the twin is a real answer, not the fall-through');
  }
  assert.match(pa(() => buildHusstandChatRun('I need the small car on Saturday 9.30 to 11', undefined, medl, [], lille, d0))[0] as string, /"booking"/);
});

test('Univers: preparing a meeting, a task, a note, a document and a new universe are understood in English', () => {
  const indeks = staten<UniversIndeks>('univers');
  const info = indeks.univers[0]!;
  const uni = staten<UniversState>(universRum(info.id));
  const d0 = nu();
  const moede = uni.moeder[0]!;
  const [d1, e1] = pa(() => buildUniversChatRun(info, uni, 'Forbered mødet igen', UNIVERS_TEKSTER.en.elMoede(moede.titel), d0), () => buildUniversChatRun(info, uni, 'Prepare the meeting again', UNIVERS_TEKSTER.en.elMoede(moede.titel), d0));
  assert.match(d1 as string, /"forberedelse"/);
  assert.equal(e1, d1);
  const [uden] = pa(() => buildUniversChatRun(info, uni, 'Prepare the meeting', undefined, d0));
  assert.match(uden as string, /^Peg på mødet først/);
  const [opg, note, dok, nyt] = pa(
    () => buildUniversChatRun(info, uni, 'Create a task: call Jonas about the capacity', undefined, d0),
    () => buildUniversChatRun(info, uni, 'Write a note about what we agreed', undefined, d0),
    () => buildUniversChatRun(info, uni, 'Make a presentation about the capacity', undefined, d0),
    () => buildOversigtChatRun(indeks, 'Create a universe about my summer holiday', undefined, d0),
  );
  assert.match(opg as string, /"type":\s*"opgave"[\s\S]*Call Jonas about the capacity/);
  assert.match(note as string, /"type":\s*"note"[\s\S]*what we agreed/);
  assert.match(dok as string, /"type":\s*"dokument"[\s\S]*Dokument: the capacity/);
  assert.match(nyt as string, /"nytUnivers"[\s\S]*"navn":\s*"Summer holiday"/);
});
