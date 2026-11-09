// KC-0249: until a model works the Start chat answers the journey's own questions from a fixed list (no model, no run to
// Hermes); once a model works the chat is the model's, as before. A question outside the list says what can be asked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ikkeEndnuSvar, rejseEmne, rejseSvar } from '../../../src/rooms/start/rejsesvar.ts';
import { START_TEKSTER } from '../../../src/rooms/start/tekster.ts';
import { startRoom } from '../../../src/rooms/start/room.ts';
import { medSprog } from '../../../src/shell/tekster.ts';
import type { createFakeAgent } from '../../../src/agent/fake.ts';
import type { RoomDeps } from '../../../src/rooms/module.ts';
import { medStart } from '../../helpers/start-deps.ts';

const AABENT = { titel: 'Vælg din model', tekst: 'Indsæt en nøgle fra din udbyder.' };

test('each question the journey raises finds its answer, in Danish and in English, whatever the case', () => {
  const sporgsmaal: [string, string][] = [
    ['Hvad er en modelnøgle?', 'modelnoegle'], ['what is a MODEL KEY', 'modelnoegle'], ['Hvad er en API-nøgle', 'modelnoegle'],
    ['Hvorfor Tailscale?', 'tailscale'], ['why do I need tailscale', 'tailscale'],
    ['Hvad giver det her trin mig?', 'trinet'], ['what does this step give me?', 'trinet'], ['Hvad er det her trin?', 'trinet'],
    ['Hvad skal jeg nu?', 'trinet'], ['What should I do now?', 'trinet'], ['What can I say?', 'hjaelp'], ['Hvad kan jeg sige?', 'hjaelp'],
    ['Hvad er Clawco?', 'hvadEr'], ['what is hermes', 'hvadEr'],
    ['Hvor ligger mine data?', 'sikkerhed'], ['is my data safe?', 'sikkerhed'],
    ['Hvad gør Clawco aldrig?', 'aldrig'], ['what will Clawco never do', 'aldrig'],
    ['Hvor lang tid tager det?', 'tid'], ['how long does it take', 'tid'], ['Hvor lang tid tager det her?', 'tid'],
    ['Hvad er en kilde?', 'kilde'], ['what is a source', 'kilde'],
  ];
  for (const [q, emne] of sporgsmaal) assert.equal(rejseEmne(q), emne, q);
  for (const q of ['Hvad er vejret i morgen?', '', 'hej', 'skriv et digt om en kat']) assert.equal(rejseEmne(q), null, q);
});

test('ordinary chat is not a journey question: near misses fire nothing', () => {
  for (const q of [
    'jeg har aldrig fået mailen', 'what is this email about?', 'how long was the meeting',
    'Hvad er det her for en mail?', 'Show me my data for March', 'what is a source of this problem?', 'I never pay late',
    'Hvad skal jeg nu med den mail fra banken?', 'is it safe to leave at five?', 'I finished this step of the renovation',
  ]) assert.equal(rejseEmne(q), null, q);
});

test('"what is this step" is tried before "what is this": the step\'s own sentence, not the product\'s', () => {
  assert.equal(rejseEmne('hvad er det her trin'), 'trinet');
  assert.equal(rejseEmne('hvad er det her'), null, 'too vague to claim');
});

test('every answer is a real sentence in both languages, and the English one is English', () => {
  for (const sprog of ['da', 'en'] as const) {
    const T = START_TEKSTER[sprog].rejsesvar;
    for (const [id, svar] of Object.entries(T.emner)) assert.ok(svar.length > 40, `${sprog} ${id}`);
    assert.ok(T.ikkeEndnu.length > 40 && T.ingenTrin.length > 20);
  }
  assert.deepEqual(Object.keys(START_TEKSTER.en.rejsesvar.emner), Object.keys(START_TEKSTER.da.rejsesvar.emner));
  assert.match(medSprog('en', () => rejseSvar('what is a model key?', undefined) ?? ''), /^A model key is a long password/);
  assert.match(medSprog('en', () => rejseSvar('Hvad er en modelnøgle?', undefined) ?? ''), /^A model key is a long password/, 'a Danish question on an English screen is answered in English');
  assert.match(rejseSvar('Hvad er en modelnøgle?', undefined) ?? '', /^En modelnøgle er en lang adgangskode/);
});

test('"what does this step give me" answers with the open step\'s own title and sentence, or says nothing is open', () => {
  assert.equal(rejseSvar('Hvad giver det her trin?', AABENT), 'Trinnet »Vælg din model«: Indsæt en nøgle fra din udbyder.');
  assert.match(rejseSvar('Hvad giver det her trin?', undefined) ?? '', /ikke i gang med noget trin/);
  assert.match(medSprog('en', () => rejseSvar('what does this step give me', AABENT) ?? ''), /^The step "Vælg din model": /);
});

test('the fallback names what can be asked', () => {
  assert.match(ikkeEndnuSvar(), /modelnøgle[\s\S]*Tailscale[\s\S]*trin[\s\S]*aldrig/);
  assert.match(medSprog('en', ikkeEndnuSvar), /model key[\s\S]*Tailscale[\s\S]*step[\s\S]*never/);
});

// ---- the room ------------------------------------------------------------------------------------------------------------

const syn = (virker: boolean): NonNullable<RoomDeps['model']> => {
  const test = { ok: true, tid: '2026-10-31T08:00:00.000Z', ms: 800, rev: 'anthropic:m' };
  return { laes: async () => ({ udbyder: 'anthropic', modeller: { lille: 'm', taenker: 'm' }, test: virker ? { lille: test, taenker: test } : {}, rev: { lille: 'anthropic:m', taenker: 'anthropic:m' } }), testMs: 1000 } as never;
};
const kald = (s: { d: RoomDeps }): number => (s.d.hermes as ReturnType<typeof createFakeAgent>).calls.length;
async function spoerg(s: { d: RoomDeps }, besked: string): Promise<string> {
  const run = await startRoom.startChat!(s.d, besked, undefined);
  const r = await run.finished;
  assert.equal(r.status, 'done', r.error);
  return (r.result?.text ?? '');
}
const hermesSvar = (s: { d: RoomDeps }) => s.d.store.readChat('start', 10).then((l) => l.filter((x) => x.fra === 'hermes').map((x) => x.tekst));

test('before a model works: the question is answered from the list, Hermes is not asked, and both lines are in the chat', async () => {
  await medStart({ model: syn(false), svar: () => 'MODELLEN' }, async (s) => {
    const svar = await spoerg(s, 'Hvad er en modelnøgle?');
    assert.match(svar, /^En modelnøgle er en lang adgangskode/);
    assert.equal(kald(s), 0, 'no run to Hermes');
    assert.deepEqual(await hermesSvar(s), [svar]);
    const chat = await s.d.store.readChat('start', 10);
    assert.deepEqual(chat.map((x) => x.fra), ['henrik', 'hermes']);
    assert.equal(chat[1]!.ejer, s.d.person.id, 'the answer belongs to whoever asked');
  });
});

test('before a model works: "what does this step give me" is about the step the person is on', async () => {
  await medStart({ model: syn(false) }, async (s) => {
    assert.match(await spoerg(s, 'Hvad giver det her trin mig?'), /^Trinnet »Hvad skal Clawco tage fra dig\?«: /, 'step 0 is the first open step');
  });
});

test('before a model works: a question outside the list gets the fixed "what I can answer", still no run to Hermes', async () => {
  await medStart({ model: syn(false) }, async (s) => {
    assert.equal(await spoerg(s, 'Skriv et digt om en kat'), ikkeEndnuSvar());
    assert.equal(kald(s), 0);
  });
});

test('before a model works: the answer follows the screen\'s language', async () => {
  await medStart({ model: syn(false) }, async (s) => {
    const svar = await medSprog('en', () => spoerg(s, 'Why Tailscale?'));
    assert.match(svar, /^Tailscale is a private network between your own devices/);
  });
});

test('once a model works the chat is the model\'s, as before: even a question on the list goes to Hermes', async () => {
  await medStart({ model: syn(true), svar: () => 'Svar fra modellen.' }, async (s) => {
    assert.equal(await spoerg(s, 'Hvad er en modelnøgle?'), 'Svar fra modellen.');
    assert.equal(kald(s), 1);
    assert.deepEqual(await hermesSvar(s), ['Svar fra modellen.']);
  });
});

test('an installation without a model window (no data folder) keeps the old chat: it goes to Hermes', async () => {
  await medStart({ svar: () => 'Hej fra Hermes.' }, async (s) => {
    assert.equal(await spoerg(s, 'Hvad er en modelnøgle?'), 'Hej fra Hermes.');
    assert.equal(kald(s), 1);
  });
});
