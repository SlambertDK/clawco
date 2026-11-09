import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { agentValg, lavAgent } from '../../src/server.ts';

test('KC_AGENT picks the agent; hermes-http is the default', () => {
  assert.equal(agentValg({}), 'hermes-http');
  assert.equal(agentValg({ KC_AGENT: 'fake' }), 'fake');
  assert.equal(agentValg({ KC_AGENT: 'hermes-http' }), 'hermes-http');
  assert.throws(() => agentValg({ KC_AGENT: 'openclaw' }), /KC_AGENT/);
});

test("KC_HERMES_MODE still works, so kira-home's .env needs no change", () => {
  assert.equal(agentValg({ KC_HERMES_MODE: 'http' }), 'hermes-http');
  assert.equal(agentValg({ KC_HERMES_MODE: 'fake' }), 'fake');
  assert.equal(agentValg({ KC_AGENT: 'fake', KC_HERMES_MODE: 'http' }), 'fake', 'KC_AGENT wins');
  assert.throws(() => agentValg({ KC_HERMES_MODE: 'grpc' }), /KC_HERMES_MODE/);
});

test('KC-0180: KC_AGENT=direkte picks the direct-model agent; junk still refuses to start', () => {
  assert.equal(agentValg({ KC_AGENT: 'direkte' }), 'direkte');
  assert.equal(agentValg({ KC_AGENT: 'direkte', KC_HERMES_MODE: 'http' }), 'direkte', 'KC_AGENT wins');
  assert.throws(() => agentValg({ KC_AGENT: 'direct' }), /KC_AGENT skal være hermes-http, direkte eller fake/);
});

test("KC-0180: Henrik's kira-home env still picks hermes-http", () => {
  assert.equal(agentValg({ KC_HERMES_MODE: 'http', KC_HERMES_URL: 'http://127.0.0.1:8642' }), 'hermes-http');
  assert.equal(lavAgent({ KC_HERMES_MODE: 'http' }, { env: {} }).mode, 'hermes-http');
});

test('KC-0181: lavAgent builds direkte; KC_HEMMELIGHEDER_FIL selects the encrypted key file (fail closed until Sky delivers the key)', async () => {
  assert.equal(lavAgent({ KC_AGENT: 'direkte', KC_DATA_DIR: '/nonexistent' }).mode, 'direkte');
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-valg-'));
  try {
    const nf = path.join(dir, 'lager-noegle');
    const a = lavAgent({ KC_AGENT: 'direkte', KC_DATA_DIR: path.join(dir, 'data'), KC_HEMMELIGHEDER_FIL: nf });
    assert.equal(a.mode, 'direkte');
    // Not delivered yet: the store is chosen and refuses to save, instead of silently keeping keys in memory.
    const r = await a.saetModelNoegle({ envNavn: 'ANTHROPIC_API_KEY' }, 'sk-ant-test-1234').then(() => 'ok', (e: Error) => e.message);
    assert.notEqual(r, 'ok', 'no key file means no save');
    await writeFile(nf, `${randomBytes(32).toString('base64')}\n`);
    await a.saetModelNoegle({ envNavn: 'ANTHROPIC_API_KEY' }, 'sk-ant-test-1234');
    assert.ok((await readdir(path.join(dir, 'data'))).includes('hemmeligheder.enc'), 'saved into the encrypted file');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('KC-0259: every agent says whether it has tools — Hermes and the default fake do, the built-in agent does not', () => {
  assert.equal(lavAgent({ KC_HERMES_MODE: 'http' }, { env: {} }).harVaerktoejer, true);
  assert.equal(lavAgent({ KC_AGENT: 'fake' }).harVaerktoejer, true);
  assert.equal(lavAgent({ KC_AGENT: 'direkte', KC_DATA_DIR: '/nonexistent' }).harVaerktoejer, false);
});
