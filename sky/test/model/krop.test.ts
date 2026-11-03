// KC-0273 (D4): the body the proxy forwards is rebuilt from an allowlist, never the tenant's object passed on. What the
// tenant's own Clawco sends (src/agent/direkte.ts: model, max_tokens 8192, system, messages, stream) always passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAKS_TOKENS, MAKS_TAENKE, bygKrop, tjekBeta } from '../../src/model/krop.ts';

const grund = { model: 'claude-haiku-5-5', max_tokens: 8192, system: 'Du er Clawco.', messages: [{ role: 'user', content: 'Hej' }], stream: true };

const fejl = (r: ReturnType<typeof bygKrop>): string => { assert.ok('fejl' in r, 'refused'); return r.fejl; };

test('what the tenant app sends passes unchanged, as a NEW object', () => {
  const r = bygKrop(grund);
  assert.ok('krop' in r);
  assert.deepEqual(r.krop, grund);
  assert.notEqual(r.krop, grund);
  assert.equal(r.maxTokens, 8192);
});

test('every allowed field passes; metadata keeps only user_id', () => {
  const alt = { ...grund, temperature: 0.2, top_p: 0.9, stop_sequences: ['STOP'], metadata: { user_id: 'u1', andet: 'x' }, tool_choice: { type: 'auto' },
    tools: [{ name: 'vejr', description: 'Vejret', input_schema: { type: 'object', properties: {} } }, { type: 'custom', name: 'b', input_schema: { type: 'object' }, cache_control: { type: 'ephemeral' } }],
    thinking: { type: 'enabled', budget_tokens: 2048 } };
  const r = bygKrop(alt);
  assert.ok('krop' in r, JSON.stringify(r));
  assert.deepEqual(r.krop['metadata'], { user_id: 'u1' });
  assert.deepEqual(r.krop['tools'], alt.tools);
  assert.deepEqual(r.krop['thinking'], alt.thinking);
});

test('unknown top-level keys are refused by name: mcp_servers, container, service_tier, anything else', () => {
  for (const k of ['mcp_servers', 'container', 'service_tier', 'top_k', 'betas', '__proto__x']) {
    assert.match(fejl(bygKrop({ ...grund, [k]: [] })), new RegExp(`"${k}"`), k);
  }
});

test('max_tokens is required, a whole number from 1 and capped at MAKS_TOKENS', () => {
  assert.equal(MAKS_TOKENS, 8192);
  assert.match(fejl(bygKrop({ ...grund, max_tokens: 8193 })), /max_tokens.*8192/);
  for (const v of [0, -1, 1.5, '100', undefined]) assert.match(fejl(bygKrop({ ...grund, max_tokens: v })), /max_tokens/, String(v));
});

test('server tools are refused (web search, fetch, code execution, computer, bash, text editor); a custom tool needs input_schema', () => {
  for (const t of ['web_search_20250305', 'web_fetch_20250910', 'code_execution_20250825', 'computer_20250124', 'bash_20250124', 'text_editor_20250728', 'memory_20250818']) {
    assert.match(fejl(bygKrop({ ...grund, tools: [{ type: t, name: 'x' }] })), /værktøj/i, t);
  }
  assert.match(fejl(bygKrop({ ...grund, tools: [{ name: 'uden_skema' }] })), /input_schema/);
  assert.match(fejl(bygKrop({ ...grund, tools: [{ name: 'x', input_schema: {}, allowed_callers: ['code_execution_20250825'] }] })), /"allowed_callers"/);
  assert.match(fejl(bygKrop({ ...grund, tools: 'ikke en liste' })), /tools/);
});

test('thinking: enabled with a budget up to MAKS_TAENKE, or disabled; nothing else', () => {
  assert.ok('krop' in bygKrop({ ...grund, thinking: { type: 'disabled' } }));
  assert.match(fejl(bygKrop({ ...grund, thinking: { type: 'enabled', budget_tokens: MAKS_TAENKE + 1 } })), /budget_tokens/);
  assert.match(fejl(bygKrop({ ...grund, thinking: { type: 'enabled' } })), /budget_tokens/);
  assert.match(fejl(bygKrop({ ...grund, thinking: { type: 'enabled', budget_tokens: 1024, ekstra: 1 } })), /thinking/);
});

test('field types: messages a non-empty list, system text or list, stream boolean, numbers numbers, stop_sequences texts', () => {
  for (const [k, v] of [['messages', []], ['messages', 'hej'], ['system', 5], ['stream', 'ja'], ['temperature', '1'], ['top_p', null], ['stop_sequences', [1]], ['metadata', 'x'], ['tool_choice', 'auto']] as const) {
    assert.match(fejl(bygKrop({ ...grund, [k]: v })), new RegExp(k), `${k}=${JSON.stringify(v)}`);
  }
  assert.match(fejl(bygKrop({ model: 'claude-haiku-5-5', max_tokens: 10 })), /messages/);
});

test('anthropic-beta: the allowlist is empty, so any value is refused by name; no header is fine', () => {
  assert.equal(tjekBeta(undefined), null);
  assert.match(tjekBeta('web-search-2025-03-05') ?? '', /"web-search-2025-03-05"/);
  assert.match(tjekBeta('a, b') ?? '', /"a"/);
});
