// KC-0180: the key store of the direct-model agent. The env default reads
// KC_MODEL_NOEGLE_<UDBYDER> (dev, tests) and keeps a saved key in memory only,
// so it never lands in process.env where a child process would inherit it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envNoegleLager, noegleEnvNavn } from '../../src/agent/noeglelager.ts';

const UDBYDERE = ['anthropic', 'openai', 'lmstudio'];

test('the env name is KC_MODEL_NOEGLE_ and the provider id in capitals', () => {
  assert.equal(noegleEnvNavn('anthropic'), 'KC_MODEL_NOEGLE_ANTHROPIC');
  assert.equal(noegleEnvNavn('open-router'), 'KC_MODEL_NOEGLE_OPEN_ROUTER');
});

test('a key from the env is found and read, trimmed', async () => {
  const l = envNoegleLager({ udbydere: UDBYDERE, env: { KC_MODEL_NOEGLE_ANTHROPIC: '  sk-ant-env  ' } });
  assert.equal(await l.findes('anthropic'), true);
  assert.equal(await l.hent('anthropic'), 'sk-ant-env');
  assert.equal(await l.findes('openai'), false);
  assert.equal(await l.hent('openai'), undefined);
});

test('saet keeps the key (trimmed) and answers its length; the env object is not touched', async () => {
  const env: Record<string, string | undefined> = {};
  const l = envNoegleLager({ udbydere: UDBYDERE, env });
  assert.deepEqual(await l.saet('openai', ' sk-ny-noegle '), { laengde: 12 });
  assert.equal(await l.hent('openai'), 'sk-ny-noegle');
  assert.equal(await l.findes('openai'), true);
  assert.deepEqual(env, {}, 'a saved key never goes into the env (child processes inherit it)');
});

test('a saved key wins over the env', async () => {
  const l = envNoegleLager({ udbydere: UDBYDERE, env: { KC_MODEL_NOEGLE_ANTHROPIC: 'gammel' } });
  await l.saet('anthropic', 'ny');
  assert.equal(await l.hent('anthropic'), 'ny');
});

test('an empty key is refused', async () => {
  const l = envNoegleLager({ udbydere: UDBYDERE, env: {} });
  await assert.rejects(() => l.saet('openai', '   '), /tom/);
  assert.equal(await l.findes('openai'), false);
  const blank = envNoegleLager({ udbydere: UDBYDERE, env: { KC_MODEL_NOEGLE_OPENAI: '  ' } });
  assert.equal(await blank.findes('openai'), false);
});

test('an unknown provider is rejected by all three', async () => {
  const l = envNoegleLager({ udbydere: UDBYDERE, env: { KC_MODEL_NOEGLE_FOO: 'x' } });
  await assert.rejects(() => l.saet('foo', 'x'), /ukendt udbyder/);
  await assert.rejects(() => l.hent('foo'), /ukendt udbyder/);
  await assert.rejects(() => l.findes('foo'), /ukendt udbyder/);
});

test('the error for an unknown provider never carries the key', async () => {
  const l = envNoegleLager({ udbydere: UDBYDERE, env: {} });
  await assert.rejects(() => l.saet('foo', 'sk-HEMMELIG'), (e: Error) => !e.message.includes('HEMMELIG'));
});

test('KC-0263: fjern removes a saved key, also one from the env, until a new one is saved', async () => {
  const l = envNoegleLager({ udbydere: UDBYDERE, env: { KC_MODEL_NOEGLE_ANTHROPIC: 'fra-env' } });
  await l.saet('openai', 'sk-gemt');
  await l.fjern('openai');
  await l.fjern('anthropic');
  assert.equal(await l.findes('openai'), false);
  assert.equal(await l.hent('anthropic'), undefined, 'the env value no longer counts');
  await l.saet('anthropic', 'ny');
  assert.equal(await l.hent('anthropic'), 'ny');
  await assert.rejects(() => l.fjern('foo'), /ukendt udbyder/);
});
