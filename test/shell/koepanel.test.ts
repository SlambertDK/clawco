// KC-0100: the Kø panel has no technical words on screen: "Stemme" instead of "ElevenLabs voice id",
// and the model fields have a spot for the human name of the chosen model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shell } from '../../src/shell/layout.ts';
import { html } from '../../src/shell/html.ts';

const side = (stemme?: 'samtale' | 'lyt') => String(shell({ roomId: 'dagen', hermesStatus: 'Klar', venter: {}, main: html`<p>x</p>`, chat: [], ...(stemme ? { stemme } : {}) }));
const panel = (s: string) => /<div class="koe-panel"[\s\S]*?<div class="room"/.exec(s)![0];

test('the voice field is called Stemme with a plain hint, and keeps its name', () => {
  const p = panel(side('samtale'));
  assert.match(p, /<span class="row-note">Stemme<\/span>/);
  assert.match(p, /name="voiceId"/);
  assert.match(p, /Tom = jeg vælger selv en dansk stemme\./);
  assert.doesNotMatch(p, /voice id/i);
  assert.doesNotMatch(p, /ElevenLabs/);
});

test('the model fields have a spot that tells the human name of the chosen model', () => {
  const p = panel(side());
  assert.match(p, /name="lille"[^>]*>[\s\S]*?data-model-navn="lille"/);
  assert.match(p, /name="taenker"[^>]*>[\s\S]*?data-model-navn="taenker"/);
  assert.doesNotMatch(p, /claude-/);
});

test('no technical word in the panel markup', () => {
  const tekst = panel(side('samtale')).replace(/<[^>]*>/g, ' ');
  for (const ord of [/\bvoice\b/i, /\bid\b/i, /\bmodel\b/i, /\bapi\b/i, /\bkørsel\b/i, /\btoken\b/i]) assert.doesNotMatch(tekst, ord);
});

// KC-0124: Stop alt, the pause band and "Hvad Clawco har gjort".
const EJER = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' as const };
const MEDLEM = { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' as const };
const GAEST = { id: 'farmor', login: null, navn: 'Farmor', rolle: 'gaest' as const };
const med = (o: Partial<Parameters<typeof shell>[0]>) => String(shell({ roomId: 'dagen', hermesStatus: 'Klar', venter: {}, main: html`<p>x</p>`, chat: [], ...o }));
const PAUSE = { pause: true, tid: '2026-10-31T13:05:00.000Z', person: 'maja' };

test('the panel opens with Stop alt for anyone who may stop, and never for a guest', () => {
  for (const person of [EJER, MEDLEM]) {
    const p = panel(med({ person }));
    assert.match(p, /<button type="button" class="btn btn-nodstop" data-nodstop="stop">Stop alt<\/button>/, person.id);
    assert.ok(p.indexOf('data-nodstop="stop"') < p.indexOf('id="koe-list"'), 'Stop alt comes before the queue');
  }
  assert.doesNotMatch(panel(med({ person: GAEST })), /data-nodstop="stop"/);
});

test('the panel has "Hvad Clawco har gjort" with the filter "Det Clawco sagde nej til"', () => {
  const p = panel(med({ person: EJER }));
  assert.match(p, /<h3 class="eyebrow">Hvad Clawco har gjort<\/h3>/);
  assert.match(p, /data-revision-filter aria-pressed="false">Det Clawco sagde nej til<\/button>/);
  assert.match(p, /data-revision="liste"/);
  assert.doesNotMatch(panel(med({ person: GAEST })), /data-revision="liste"/, 'a guest does not read the audit log');
});

test('while paused: a calm band above the room, Start igen for the owner only, and no Stop alt', () => {
  const ejer = med({ person: EJER, pause: PAUSE, husstand: [EJER, MEDLEM] });
  const baand = /<div class="pause-baand"[\s\S]*?<\/div>/.exec(ejer)![0];
  assert.match(baand, /data-nodstop="pause"/);
  assert.match(baand, /role="status"/);
  assert.match(baand, /Clawco er sat på pause/);
  assert.match(baand, /Maja stoppede alt kl\. 14\.05/);
  assert.match(baand, /<button type="button" class="btn btn-primary" data-nodstop="genoptag">Start igen<\/button>/);
  assert.ok(ejer.indexOf('class="pause-baand"') < ejer.indexOf('<div class="room"'), 'the band sits above the room');
  assert.doesNotMatch(ejer, /data-nodstop="stop"/);

  const maja = med({ person: MEDLEM, pause: PAUSE });
  assert.match(maja, /data-nodstop="pause"/);
  assert.doesNotMatch(maja, /data-nodstop="genoptag"/);
  assert.match(maja, /Kun ejeren kan starte Clawco igen\./);
  assert.doesNotMatch(med({ person: EJER }), /data-nodstop="pause"/, 'no band when not paused');
});

// KC-0120: the panel has an empty, hidden spot for "Kilder"; app.js fills it from /api/koe?kilder=1 while the panel is open.
test('the panel holds a hidden Kilder spot above the settings, for every role', () => {
  for (const person of [EJER, MEDLEM, GAEST]) {
    const p = panel(med({ person }));
    assert.match(p, /<div class="kilder-panel" data-kilder="panel" hidden><\/div>/);
    assert.ok(p.indexOf('data-kilder="panel"') < p.indexOf('id="indstillinger"'));
  }
});
