// KC-0264: the model price file (config/modelpriser.json) and the price of one call, in whole micro-USD.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { laesModelpriser, MODELPRISFIL, prisMikroUsd, promptTokens, validerModelpriser, type Forbrug } from '../../src/model/priser.ts';

const raa = (): any => JSON.parse(fs.readFileSync(MODELPRISFIL, 'utf8'));
const tom: Forbrug = { input: 0, output: 0, cacheLaes: 0, cacheSkriv5m: 0, cacheSkriv1t: 0 };

test('the real file validates: Haiku 5.5 at the prices read 2026-11-03, both providers map it', () => {
  const p = laesModelpriser();
  assert.equal(p.laest, '2026-11-03');
  const h = p.modeller['claude-haiku-5-5']!;
  assert.deepEqual(h.trin[0], { opTilPromptTokens: 100_000, input: 0.10, cacheSkriv5m: 0.125, cacheSkriv1t: 0.20, cacheLaes: 0.01, output: 0.50 });
  assert.equal(h.trin[1]!.opTilPromptTokens, null);
  assert.equal(p.udbydere['anthropic']!.modelId['claude-haiku-5-5'], 'claude-haiku-5-5');
  assert.equal(p.udbydere['bedrock']!.tillaegProcent, 10);
  assert.equal(p.udbydere['bedrock']!.region, 'eu-central-1');
  assert.equal(p.udbydere['bedrock']!.url, 'https://bedrock-runtime.{region}.amazonaws.com');
  assert.equal(p.udbydere['bedrock']!.modelId['claude-haiku-5-5'], 'eu.anthropic.claude-haiku-5-5', 'the EU cross-region inference profile');
});

test('validation names the path that is wrong', () => {
  const a = raa(); a.modeller['claude-haiku-5-5'].trin[0].input = -1;
  assert.throws(() => validerModelpriser(a), /modeller\.claude-haiku-5-5\.trin\[0\]\.input/);
  const b = raa(); b.modeller['claude-haiku-5-5'].trin[1].opTilPromptTokens = 5;
  assert.throws(() => validerModelpriser(b), /trin\[1\].*(sidste|null)/);
  const c = raa(); delete c.udbydere.bedrock.modelId['claude-haiku-5-5'];
  assert.throws(() => validerModelpriser(c), /udbydere\.bedrock\.modelId.*claude-haiku-5-5/);
  const d = raa(); d.udbydere.anthropic.ekstra = 1;
  assert.throws(() => validerModelpriser(d), /udbydere\.anthropic\.ekstra/);
  const f = raa(); f.udbydere.anthropic.url = 'http://api.anthropic.com';
  assert.throws(() => validerModelpriser(f), /udbydere\.anthropic\.url/);
  const g = raa(); delete g.udbydere.bedrock.region;
  assert.throws(() => validerModelpriser(g), /udbydere\.bedrock\.region/);
  const e = raa(); e.laest = 'i dag';
  assert.throws(() => validerModelpriser(e), /laest/);
});

test('one call: tokens × USD per million = micro-USD, rounded up to a whole micro-USD', () => {
  const p = laesModelpriser();
  // 90 k input at 0.10 and 9 k output at 0.50 USD per million: 9 000 + 4 500 micro-USD.
  assert.equal(prisMikroUsd(p, 'claude-haiku-5-5', 'anthropic', { ...tom, input: 90_000, output: 9_000 }), 9_000 + 4_500);
  assert.equal(prisMikroUsd(p, 'claude-haiku-5-5', 'anthropic', { ...tom, input: 1 }), 1, '0.1 micro-USD is charged as 1');
  assert.equal(prisMikroUsd(p, 'claude-haiku-5-5', 'anthropic', { ...tom, cacheLaes: 50_000, cacheSkriv5m: 8, cacheSkriv1t: 10 }), Math.ceil(500 + 1 + 2));
  assert.equal(prisMikroUsd(p, 'claude-haiku-5-5', 'anthropic', tom), 0);
});

test('a prompt over 100 000 tokens (input + cache reads + cache writes) pays the second tier for every token of the call', () => {
  const p = laesModelpriser();
  assert.equal(promptTokens({ ...tom, input: 40_000, cacheLaes: 60_000 }), 100_000);
  assert.equal(prisMikroUsd(p, 'claude-haiku-5-5', 'anthropic', { ...tom, input: 40_000, cacheLaes: 60_000, output: 1_000 }), 4_000 + 600 + 500);
  assert.equal(prisMikroUsd(p, 'claude-haiku-5-5', 'anthropic', { ...tom, input: 40_001, cacheLaes: 60_000, output: 1_000 }), Math.ceil(40_001 * 0.5 + 60_000 * 0.05 + 1_000 * 2.5));
});

test('Bedrock adds its surcharge; an unknown model or provider is an error, never a free call', () => {
  const p = laesModelpriser();
  assert.equal(prisMikroUsd(p, 'claude-haiku-5-5', 'bedrock', { ...tom, input: 100_000 }), 11_000);
  assert.throws(() => prisMikroUsd(p, 'claude-sonnet-5-5', 'anthropic', tom), /claude-sonnet-5-5/);
  assert.throws(() => prisMikroUsd(p, 'claude-haiku-5-5', 'vertex', tom), /vertex/);
});

test('every model a Sky plan includes (config/priser.json) has a price and an id at every provider', async () => {
  const { laesPriser } = await import('../../src/abonnement/priser.ts');
  const p = laesModelpriser();
  const planer = Object.entries(laesPriser().planer);
  assert.ok(planer.every(([, x]) => x.inkluderetModel), 'every Sky plan includes the Calm model (KC-0253 D1)');
  for (const [id, plan] of planer) {
    for (const m of plan.inkluderetModel!.modeller) {
      assert.ok(p.modeller[m], `${id}: ${m} has a price`);
      for (const [u, x] of Object.entries(p.udbydere)) assert.ok(x.modelId[m], `${id}: ${m} at ${u}`);
    }
  }
});
