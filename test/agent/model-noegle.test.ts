// KC-0127: the model key goes to the agent, never into Clawco. hermes-http on
// the same host writes it into Hermes' env file through the writer the
// composition root injects (the secrets module: allowlisted names, 0600,
// atomic) and restarts the gateway through an injected command; without a
// writable file it answers with the one command to run by hand. The fake
// records name and length only, and scripts the live test's outcomes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHermesHttp } from '../../src/agent/hermes-http.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { MODEL_TEST } from '../../src/agent/prompt.ts';
import { AFBRUDT, AgentError } from '../../src/agent/types.ts';
import { lavAgentNoegleSkriver } from '../../src/kilder/hemmeligheder.ts';

const NOEGLE = 'sk-ant-test-HEMMELIG-0123456789';
const TILLADTE = ['ANTHROPIC_API_KEY', 'LM_BASE_URL'] as const;
const sund = (async () => new Response('{"status":"ok"}', { status: 200 })) as typeof fetch;

async function medMappe(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-model-noegle-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('hermes-http writes an allowlisted key into the env file (0600), keeps other lines, restarts once', async () => {
  await medMappe(async (dir) => {
    const fil = path.join(dir, '.env');
    await writeFile(fil, 'API_SERVER_KEY=x\nANTHROPIC_API_KEY=gammel\n');
    let genstart = 0;
    const h = createHermesHttp({ baseUrl: 'http://h', apiKey: 'k', fetchImpl: sund, noegler: { skriv: lavAgentNoegleSkriver(fil, TILLADTE), genstart: async () => { genstart += 1; }, ventMs: 1000 } });
    const svar = await h.saetModelNoegle({ envNavn: 'ANTHROPIC_API_KEY' }, NOEGLE);
    assert.deepEqual(svar, { slags: 'gemt', noegle: 'ANTHROPIC_API_KEY', laengde: NOEGLE.length });
    assert.equal(await readFile(fil, 'utf8'), `API_SERVER_KEY=x\nANTHROPIC_API_KEY=${NOEGLE}\n`);
    assert.equal((await stat(fil)).mode & 0o777, 0o600);
    assert.equal(genstart, 1);
    assert.ok(!JSON.stringify(svar).includes(NOEGLE));
    assert.equal(process.env['ANTHROPIC_API_KEY'], undefined, 'never kept in Clawco\'s own environment');
  });
});

test('hermes-http refuses a name outside the allowlist, and writes nothing', async () => {
  await medMappe(async (dir) => {
    const fil = path.join(dir, '.env');
    let genstart = 0;
    const h = createHermesHttp({ baseUrl: 'http://h', apiKey: 'k', fetchImpl: sund, noegler: { skriv: lavAgentNoegleSkriver(fil, TILLADTE), genstart: async () => { genstart += 1; } } });
    await assert.rejects(h.saetModelNoegle({ envNavn: 'API_SERVER_KEY' }, NOEGLE), (e: unknown) => e instanceof Error && !e.message.includes(NOEGLE));
    await assert.rejects(readFile(fil, 'utf8'));
    assert.equal(genstart, 0);
  });
});

test('hermes-http without an env file, or with one it cannot write, answers with the one command (never the key)', async () => {
  await medMappe(async (dir) => {
    for (const fil of [undefined, path.join(dir, 'findes-ikke', 'under', '.env')]) {
      let genstart = 0;
      const h = createHermesHttp({ baseUrl: 'http://h', apiKey: 'k', fetchImpl: sund, noegler: { ...(fil ? { skriv: lavAgentNoegleSkriver(fil, TILLADTE) } : {}), genstart: async () => { genstart += 1; } } });
      const svar = await h.saetModelNoegle({ envNavn: 'ANTHROPIC_API_KEY' }, NOEGLE);
      assert.equal(svar.slags, 'kommando');
      assert.ok(svar.slags === 'kommando' && svar.kommando.includes('ANTHROPIC_API_KEY') && svar.kommando.includes('hermes gateway restart'));
      assert.ok(!JSON.stringify(svar).includes(NOEGLE));
      assert.equal(genstart, 0);
    }
  });
});

test('fake: saetModelNoegle records name and length only', async () => {
  const f = createFakeAgent();
  assert.deepEqual(await f.saetModelNoegle({ envNavn: 'OPENAI_API_KEY' }, NOEGLE), { slags: 'gemt', noegle: 'OPENAI_API_KEY', laengde: NOEGLE.length });
  assert.deepEqual(f.noegler, [{ envNavn: 'OPENAI_API_KEY', laengde: NOEGLE.length }]);
  assert.ok(!JSON.stringify(f.noegler).includes(NOEGLE));
  assert.equal(await f.status(), 'klar');
});

test('fake: the live test answers klar, fails with 401, or never answers until aborted', async () => {
  const req = { ...MODEL_TEST, model: 'm' };
  assert.equal((await createFakeAgent().run(req)).output, 'klar');
  assert.equal((await createFakeAgent({ answer: () => 'andet' }).run({ input: 'x', instructions: 'y' })).output, 'andet', 'other runs keep their answer');
  await assert.rejects(createFakeAgent({ modelTest: () => '401' }).run(req), (e: unknown) => e instanceof AgentError && /401/.test(e.message));
  const ac = new AbortController();
  const p = createFakeAgent({ modelTest: () => 'timeout' }).run({ ...req, signal: ac.signal });
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(p, (e: unknown) => e instanceof AgentError && e.message === AFBRUDT);
});
