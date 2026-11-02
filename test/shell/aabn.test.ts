import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rumFraBesked, erHjaelp, hvadKanJegSige, hjaelpSvar } from '../../src/shell/aabn.ts';
import { ROOMS } from '../../src/rooms/registry.ts';
import { medSprog } from '../../src/store/sprog.ts';

const UNIVERS = [{ id: 'min-arena', navn: 'Min arena' }];
const aabn = (besked: string) => rumFraBesked(besked, UNIVERS);

test('KC-0052: the wish to write opens Skrive', () => {
  for (const b of ['jeg vil skrive', 'Jeg vil gerne skrive noget', 'lad os skrive', 'Hjælp mig med at skrive', 'Okay, jeg skal skrive en tekst.'])
    assert.deepEqual(aabn(b), { id: 'skrive', videre: false }, b);
});

test('KC-0052: an opening verb with a room name opens that room', () => {
  assert.deepEqual(aabn('åbn mail'), { id: 'mail', videre: false });
  assert.deepEqual(aabn('Vis mig nyhederne'), { id: 'nyheder', videre: false });
  assert.deepEqual(aabn('gå til dagen'), { id: 'dagen', videre: false });
  assert.deepEqual(aabn('kan du åbne kalenderen?'), { id: 'dagen', videre: false });
  assert.deepEqual(aabn('tilbage til forsiden'), { id: 'hjem', videre: false });
  assert.deepEqual(aabn('åbn universerne'), { id: 'univers', videre: false });
});

test('KC-0052: the wish to do a room\'s thing opens it', () => {
  assert.deepEqual(aabn('jeg vil læse nyhederne'), { id: 'nyheder', videre: false });
  assert.deepEqual(aabn('jeg skal lige tjekke min mail'), { id: 'mail', videre: false });
  assert.deepEqual(aabn('jeg vil se kalenderen'), { id: 'dagen', videre: false });
});

test('KC-0052: a univers opens by its name', () => {
  assert.deepEqual(aabn('åbn min arena'), { id: 'univers-min-arena', videre: false });
  assert.deepEqual(aabn('jeg vil arbejde på Min arena'), { id: 'univers-min-arena', videre: false });
});

test('KC-0052: a sentence that says more than the wish goes on to the room (videre)', () => {
  assert.deepEqual(aabn('jeg vil skrive en tekst om fredagens møde'), { id: 'skrive', videre: true });
  assert.deepEqual(aabn('vis mig mailen fra skolen'), { id: 'mail', videre: true });
});

test('KC-0098: "hvad kan jeg sige" and its short forms ask for the help, whatever the case or punctuation', () => {
  for (const b of ['hvad kan jeg sige', 'Hvad kan jeg sige?', '  HVAD KAN JEG SIGE?! ', 'hjælp', 'Hjælp.', 'hvad kan du', 'Hvad kan du?'])
    assert.equal(erHjaelp(b), true, b);
});

test('KC-0098: ordinary sentences to Hermes are not swallowed by the help', () => {
  for (const b of ['hjælp mig med at skrive til Maja', 'hvad kan jeg sige til Maja?', 'hvad kan du se i min kalender', 'hvad kan jeg gøre i dag', 'jeg har brug for hjælp med mailen', 'hjælp mig'])
    assert.equal(erHjaelp(b), false, b);
});

test('KC-0098: the list has one phrase for every room the matcher can open, and every phrase really opens its room', () => {
  const liste = hvadKanJegSige(UNIVERS, { husstand: true });
  for (const r of ROOMS) assert.ok(liste.some((e) => e.id === r.id), `${r.id} is in the list`);
  assert.ok(liste.some((e) => e.id === 'univers-min-arena'), 'a univers is listed by name');
  for (const e of liste) assert.deepEqual(rumFraBesked(e.saet, UNIVERS, { husstand: true }), { id: e.id, videre: false }, `"${e.saet}" opens ${e.id}`);
});

test('KC-0148: Husstanden is opened and listed only when it is there for the person', () => {
  assert.deepEqual(rumFraBesked('åbn husstanden', UNIVERS, { husstand: true }), { id: 'husstand', videre: false });
  assert.equal(aabn('åbn husstanden'), null, 'a single user: the sentence goes to Hermes');
  assert.ok(!hvadKanJegSige(UNIVERS).some((e) => e.id === 'husstand'));
  assert.ok(!hjaelpSvar(UNIVERS).includes('husstand'));
  assert.ok(hjaelpSvar(UNIVERS, { husstand: true }).includes('"Åbn husstanden"'));
});

test('KC-0098: the chat answer lists the phrases and says that the rest goes to Hermes', () => {
  const svar = hjaelpSvar(UNIVERS);
  for (const e of hvadKanJegSige(UNIVERS)) assert.ok(svar.includes(`"${e.saet}"`), e.saet);
  assert.match(svar, /Alt andet kan du bare spørge mig om\./);
});

test('KC-0052: questions and other sentences are for Hermes, not a room switch', () => {
  for (const b of ['Hvad står der i nyhederne?', 'hvad skal jeg skrive til skolen?', 'Har jeg fået mail fra Rikke', 'skriv et kort svar', 'Hvordan går dagen?', 'jeg vil gerne have et overblik'])
    assert.equal(aabn(b), null, b);
});

test('KC-0146: "hvad ved du om mig" and "hvad har du gemt" open the page of what Clawco knows', async () => {
  const { erVidenBesked } = await import('../../src/shell/aabn.ts');
  for (const b of ['hvad ved du om mig', 'Hvad ved du om mig?', 'hvad har du gemt', 'Hvad har du gemt om mig?', 'Hej Hermes, hvad ved du om mig', 'hvad ved Clawco om mig'])
    assert.equal(erVidenBesked(b), true, b);
  for (const b of ['hvad ved du om Maja', 'hvad har du gemt i Skrive i går', 'slet alt', 'slet alt hvad du ved om mig', 'jeg vil slette alt'])
    assert.equal(erVidenBesked(b), false, b);
});

test('KC-0154: "inviter …" opens the invite page; a question about invitations is for Hermes', async () => {
  const { erInviterBesked } = await import('../../src/shell/aabn.ts');
  for (const b of ['inviter', 'Inviter en', 'jeg vil invitere min datter', 'Hej Hermes, jeg vil gerne invitere Maja', 'invitér farmor'])
    assert.equal(erInviterBesked(b), true, b);
  for (const b of ['hvem har jeg inviteret?', 'kan du lave en invitation til festen', 'skriv en invitation til fødselsdagen', 'invitationen til mødet'])
    assert.equal(erInviterBesked(b), false, b);
});

test('KC-0146: no chat phrase ever opens Slet alt', async () => {
  for (const b of ['slet alt', 'åbn slet alt', 'vis slet alt', 'jeg vil slette alt', 'slet alt hvad du ved om mig', 'åbn viden/slet-alt']) {
    const hit = rumFraBesked(b, UNIVERS, { husstand: true });
    assert.ok(!hit || !/slet/.test(hit.id), b);
  }
});

// KC-0170: the reader understands both languages whatever the request's language: a person may type either.
const en = <T,>(fn: () => T): T => medSprog('en', fn);

test('KC-0170: the wish to write opens Skrive in English too', () => {
  for (const b of ['I want to write', 'I want to write something', "Let's write", 'Help me write', 'Help me to write', "Okay, I need to write a text.", 'can we write', 'I would like to write'])
    assert.deepEqual(aabn(b), { id: 'skrive', videre: false }, b);
});

test('KC-0170: an English opening verb with a room name opens that room', () => {
  assert.deepEqual(aabn('open mail'), { id: 'mail', videre: false });
  assert.deepEqual(aabn('Show me the news'), { id: 'nyheder', videre: false });
  assert.deepEqual(aabn('go to the day'), { id: 'dagen', videre: false });
  assert.deepEqual(aabn('can you open my calendar?'), { id: 'dagen', videre: false });
  assert.deepEqual(aabn('back to the front page'), { id: 'hjem', videre: false });
  assert.deepEqual(aabn('Take me to the front page'), { id: 'hjem', videre: false });
  assert.deepEqual(aabn('open the universes'), { id: 'univers', videre: false });
  assert.deepEqual(aabn('switch to the inbox'), { id: 'mail', videre: false });
  assert.deepEqual(aabn('show me my mail'), { id: 'mail', videre: false });
  assert.deepEqual(aabn('open the setup'), { id: 'start', videre: false });
  assert.deepEqual(aabn('go back to the setup'), { id: 'start', videre: false });
  assert.deepEqual(rumFraBesked('open the household', UNIVERS, { husstand: true }), { id: 'husstand', videre: false });
  assert.deepEqual(rumFraBesked('go to the writing', UNIVERS, { husstand: true }), { id: 'skrive', videre: false });
  assert.equal(aabn('open the household'), null, 'a single user: the sentence goes to Hermes');
});

test("KC-0170: the English wish to do a room's thing opens it", () => {
  assert.deepEqual(aabn('I want to read the news'), { id: 'nyheder', videre: false });
  assert.deepEqual(aabn('I just need to check my mail'), { id: 'mail', videre: false });
  assert.deepEqual(aabn('I want to see the calendar'), { id: 'dagen', videre: false });
  assert.deepEqual(aabn("let's go through my inbox"), { id: 'mail', videre: false });
  assert.deepEqual(aabn("let's look at my calendar"), { id: 'dagen', videre: false });
});

test('KC-0170: a univers opens by its name in English too, the name used as it is', () => {
  assert.deepEqual(aabn('open Min arena'), { id: 'univers-min-arena', videre: false });
  assert.deepEqual(aabn('I want to work on Min arena'), { id: 'univers-min-arena', videre: false });
  assert.deepEqual(aabn('go to Min arena'), { id: 'univers-min-arena', videre: false });
});

test('KC-0170: an English sentence that says more than the wish goes on to the room (videre)', () => {
  assert.deepEqual(aabn('I want to write a text about Friday\'s meeting'), { id: 'skrive', videre: true });
  assert.deepEqual(aabn('show me the mail from school'), { id: 'mail', videre: true });
  assert.deepEqual(aabn('please, could you open my mail'), { id: 'mail', videre: false });
});

test('KC-0170: "what can I say", "help" and "what can you do" ask for the help in English too', () => {
  for (const b of ['what can I say', 'What can I say?', '  WHAT CAN I SAY?! ', 'help', 'Help.', 'what can you do', 'What can you do?'])
    assert.equal(erHjaelp(b), true, b);
});

test('KC-0170: ordinary English sentences to Hermes are not swallowed by the help', () => {
  for (const b of ['help me write to Maja', 'what can I say to Maja?', 'what can you see in my calendar', 'what can I do today', 'I need help with the mail', 'help me'])
    assert.equal(erHjaelp(b), false, b);
});

test('KC-0170: English questions and other sentences are for Hermes, not a room switch', () => {
  for (const b of ["What does the news say?", 'what should I write to the school?', 'Did I get mail from Rikke', 'write a short reply', 'How is the day going?', 'I want an overview', 'I want to', 'show me what is new'])
    assert.equal(aabn(b), null, b);
});

test('KC-0170: the list is in the request\'s language: English phrases, each really opening its room; Danish stays as it was', () => {
  const liste = en(() => hvadKanJegSige(UNIVERS, { husstand: true }));
  for (const r of ROOMS) assert.ok(liste.some((e) => e.id === r.id), `${r.id} is in the English list`);
  assert.deepEqual(liste.find((e) => e.id === 'univers-min-arena'), { id: 'univers-min-arena', saet: 'Open Min arena' });
  for (const e of liste) assert.deepEqual(rumFraBesked(e.saet, UNIVERS, { husstand: true }), { id: e.id, videre: false }, `"${e.saet}" opens ${e.id}`);
  assert.deepEqual(liste.map((e) => e.saet), ['Back to the front page', 'Open the setup', 'Open the day', 'Open mail', 'I want to write', 'I want to read the news', 'Open the universes', 'Open the household', 'Open Min arena']);
  assert.deepEqual(hvadKanJegSige(UNIVERS, { husstand: true }).map((e) => e.saet), ['Tilbage til forsiden', 'Åbn opsætningen', 'Åbn dagen', 'Åbn mail', 'Jeg vil skrive', 'Jeg vil læse nyhederne', 'Åbn universerne', 'Åbn husstanden', 'Åbn Min arena']);
});

test('KC-0170: the English help answer lists the phrases and says that the rest goes to Hermes; the Danish one is byte for byte as before', () => {
  const svar = en(() => hjaelpSvar(UNIVERS));
  assert.match(svar, /^You can say, for example:\n/);
  for (const e of en(() => hvadKanJegSige(UNIVERS))) assert.ok(svar.includes(`• "${e.saet}"`), e.saet);
  assert.match(svar, /\nAnything else, you can just ask me\.$/);
  assert.ok(!svar.includes('husstand') && !svar.includes('household'), 'Husstanden only when it is there for the person');
  assert.ok(en(() => hjaelpSvar(UNIVERS, { husstand: true })).includes('"Open the household"'));
  assert.equal(hjaelpSvar(UNIVERS), 'Du kan sige for eksempel:\n• "Tilbage til forsiden"\n• "Åbn opsætningen"\n• "Åbn dagen"\n• "Åbn mail"\n• "Jeg vil skrive"\n• "Jeg vil læse nyhederne"\n• "Åbn universerne"\n• "Åbn Min arena"\nAlt andet kan du bare spørge mig om.');
});

test('KC-0170: the English phrases are read whatever the request language, and the Danish ones too under English', () => {
  assert.deepEqual(en(() => aabn('åbn mail')), { id: 'mail', videre: false });
  assert.deepEqual(aabn('open mail'), { id: 'mail', videre: false });
  assert.equal(en(() => erHjaelp('hvad kan jeg sige')), true);
});

test('KC-0170: "what do you know about me" and "what have you stored" open the page of what Clawco knows', async () => {
  const { erVidenBesked } = await import('../../src/shell/aabn.ts');
  for (const b of ['what do you know about me', 'What do you know about me?', 'what have you stored', 'What have you saved about me?', 'Hi Hermes, what do you know about me', 'what does Clawco know about me'])
    assert.equal(erVidenBesked(b), true, b);
  for (const b of ['what do you know about Maja', 'what have you stored in Skrive yesterday', 'delete everything', 'delete everything you know about me', 'I want to delete everything'])
    assert.equal(erVidenBesked(b), false, b);
});

test('KC-0170: "invite …" opens the invite page; a question about invitations is for Hermes', async () => {
  const { erInviterBesked } = await import('../../src/shell/aabn.ts');
  for (const b of ['invite', 'Invite someone', 'invite someone', 'I want to invite my daughter', "Hi Hermes, I'd like to invite Maja", 'can I invite grandma', 'let me invite Maja'])
    assert.equal(erInviterBesked(b), true, b);
  for (const b of ['who have I invited?', 'can you make an invitation for the party', 'write an invitation to the birthday', 'the invitation to the meeting', 'invited'])
    assert.equal(erInviterBesked(b), false, b);
});

test('KC-0170: no English chat phrase ever opens Slet alt', () => {
  for (const b of ['delete everything', 'open delete everything', 'show delete all', 'I want to delete everything', 'open viden/slet-alt']) {
    const hit = rumFraBesked(b, UNIVERS, { husstand: true });
    assert.ok(!hit || !/slet/.test(hit.id), b);
  }
});
