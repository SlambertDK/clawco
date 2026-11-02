import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rumFraBesked, erHjaelp, hvadKanJegSige, hjaelpSvar } from '../../src/shell/aabn.ts';
import { ROOMS } from '../../src/rooms/registry.ts';

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
