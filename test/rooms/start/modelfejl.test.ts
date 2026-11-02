// KC-0127: why a model test failed, as one fixed Danish sentence per kind. The
// provider's error text decides the kind only; it is never shown (it can hold
// a fragment of the key).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_FEJL, modelFejlArt, type ModelFejlArt } from '../../../src/rooms/start/modelfejl.ts';

const NOEGLE = 'sk-test-HEMMELIG-1234567890';

const TILFAELDE: [string, ModelFejlArt][] = [
  [`Error code: 401 - {'error': {'message': 'invalid x-api-key ${NOEGLE}'}}`, 'noegle'],
  ['HTTP 403 Forbidden', 'noegle'],
  ['AuthenticationError: Incorrect API key provided', 'noegle'],
  ['Error code: 402 - insufficient credits', 'kredit'],
  ['You exceeded your current quota, please check your plan and billing details', 'kredit'],
  ['Error code: 404 - model_not_found', 'model'],
  ['The model `gpt-9` does not exist', 'model'],
  ['connect ECONNREFUSED 127.0.0.1:1234', 'forbindelse'],
  ['fetch failed', 'forbindelse'],
  ['APIConnectionError: Connection error.', 'forbindelse'],
  ['Request timed out.', 'tid'],
  ['Hermes svarede ikke i tide', 'tid'],
  ['Hermes afviste kørslen: HTTP 401 unauthorized', 'agent-afvist'],
  ['Clawco har ingen nøgle til Hermes endnu', 'agent-noegle'],
  // The agent's connection errors in English (src/agent speaks the screen language).
  ['Clawco has no key to Hermes yet', 'agent-noegle'],
  ['Hermes rejected the run: HTTP 401 unauthorized', 'agent-afvist'],
  ['Hermes rejected the run: HTTP 403', 'agent-afvist'],
  ['Hermes rejected the run: HTTP 500', 'ukendt'],
  ['noget helt andet', 'ukendt'],
];

for (const [besked, art] of TILFAELDE) {
  test(`"${besked.slice(0, 40)}" → ${art}`, () => {
    assert.equal(modelFejlArt(besked), art);
  });
}

test('an abort by the test timer is always tid, whatever the message', () => {
  assert.equal(modelFejlArt('afbrudt', { tid: true }), 'tid');
});

test('the Danish sentences are fixed', () => {
  assert.equal(MODEL_FEJL.noegle, 'Nøglen er afvist. Tjek, at du har kopieret hele nøglen, og at den stadig findes hos udbyderen.');
  assert.equal(MODEL_FEJL.kredit, 'Kontoen hos udbyderen har ikke mere kredit. Fyld op hos udbyderen, og prøv igen.');
  assert.equal(MODEL_FEJL.model, 'Udbyderen kender ikke modellen. Vælg en anden model.');
  assert.equal(MODEL_FEJL.forbindelse, 'Serveren svarer ikke. Tjek, at den kører, og at adressen er rigtig.');
  assert.equal(MODEL_FEJL.tid, 'Modellen svarede ikke inden for 20 sekunder.');
  assert.equal(MODEL_FEJL['agent-noegle'], 'Clawco har ingen nøgle til Hermes endnu.');
  assert.equal(MODEL_FEJL['agent-afvist'], 'Hermes afviste Clawcos nøgle. Tjek nøglen til Hermes.');
  assert.equal(MODEL_FEJL.tom, 'Modellen svarede, men uden tekst.');
  assert.equal(MODEL_FEJL.ukendt, 'Modellen svarede ikke som ventet. Prøv igen om lidt.');
});

test('no sentence ever carries the provider text or the key', () => {
  for (const [besked] of TILFAELDE) {
    const tekst = MODEL_FEJL[modelFejlArt(besked)];
    assert.ok(!tekst.includes(NOEGLE) && !tekst.includes('x-api-key') && !tekst.includes('Error code'), tekst);
  }
});

test('KC-0180: the direct agent fails with the fixed sentences themselves; each maps back to its own kind', () => {
  for (const art of Object.keys(MODEL_FEJL) as ModelFejlArt[]) assert.equal(modelFejlArt(MODEL_FEJL[art]), art, art);
  assert.equal(modelFejlArt('Modellen svarede ikke i tide.'), 'tid', "the direct agent's own timer");
});

test('KC-0180: the sentences for no model key yet and a provider that only works through Hermes', () => {
  assert.equal(MODEL_FEJL['model-noegle'], 'Clawco har ingen nøgle til en sprogmodel endnu. Vælg en udbyder, og indsæt din nøgle i Start.');
  assert.equal(MODEL_FEJL['kun-hermes'], 'Den udbyder virker kun gennem Hermes. Vælg en anden udbyder i Start.');
});
