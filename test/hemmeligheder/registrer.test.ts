import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registrerNoegleLager } from '../../src/hemmeligheder/registrer.ts';
import { envNoegleLager } from '../../src/agent/noeglelager.ts';
import { MASKE, nulstilRegistrerede, redigeres } from '../../src/graenser/redaktion.ts';

// KC-0125: a model key a store reads or saves is registered with the one redactor (the env default is also covered by name).
const NOEGLE = 'sk-ant-dummy-model-key-0001';
beforeEach(() => nulstilRegistrerede());

test('a key saved in the store is masked from then on, and one read from it too', async () => {
  const lager = registrerNoegleLager(envNoegleLager({ udbydere: ['anthropic'], env: {} }));
  assert.equal(redigeres(`nøgle ${NOEGLE}`, {}), `nøgle ${NOEGLE}`);
  assert.deepEqual(await lager.saet('anthropic', ` ${NOEGLE} `), { laengde: NOEGLE.length });
  assert.equal(redigeres(`nøgle ${NOEGLE}`, {}), `nøgle ${MASKE}`);
  nulstilRegistrerede();
  assert.equal(await lager.hent('anthropic'), NOEGLE);
  assert.equal(redigeres(`nøgle ${NOEGLE}`, {}), `nøgle ${MASKE}`);
});

test('the wrapper changes nothing else: unknown provider still refused, findes still answers', async () => {
  const lager = registrerNoegleLager(envNoegleLager({ udbydere: ['anthropic'], env: {} }));
  await assert.rejects(() => lager.saet('nope', 'x'), /ukendt udbyder/);
  assert.equal(await lager.findes('anthropic'), false);
});
