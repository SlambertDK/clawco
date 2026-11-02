import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeStemme } from '../../src/stemme/fake.ts';
import { StemmeError } from '../../src/stemme/types.ts';
import type { AgentConfig } from '../../src/stemme/types.ts';

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const CONFIG: AgentConfig = {
  name: 'Kontrolcenter',
  language: 'da',
  llm: 'x',
  prompt: 'p',
  firstMessage: 'hej',
  ttsModelId: 'm',
  turnTimeout: 7,
  turnEagerness: 'normal',
  maxDurationSeconds: 600,
  dynamicVariablePlaceholders: {},
  tools: [
    { name: 'vaelg', description: 'd', parameters: { type: 'object', properties: {}, required: [] }, expectsResponse: true },
    { name: 'luk', description: 'd', parameters: { type: 'object', properties: {}, required: [] }, expectsResponse: false },
  ],
};

test('fake mode and lyt returns the canned question', async () => {
  const s = createFakeStemme();
  assert.equal(s.mode, 'fake');
  assert.equal(await s.lyt(new Uint8Array([1, 2]), 'audio/webm', ['a']), 'Hvad venter på mig i dag?');
});

test('sig returns a valid 16-bit mono 16 kHz WAV of 0.5 s', async () => {
  const s = createFakeStemme();
  const { body, contentType } = await s.sig('hej', 'v');
  assert.equal(contentType, 'audio/wav');
  const bytes = await readAll(body);
  const dataLen = 16000 * 0.5 * 2;
  assert.equal(bytes.length, 44 + dataLen);
  const text = (from: number, to: number): string => new TextDecoder().decode(bytes.slice(from, to));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(text(0, 4), 'RIFF');
  assert.equal(view.getUint32(4, true), 36 + dataLen);
  assert.equal(text(8, 12), 'WAVE');
  assert.equal(text(12, 16), 'fmt ');
  assert.equal(view.getUint32(16, true), 16);
  assert.equal(view.getUint16(20, true), 1); // PCM
  assert.equal(view.getUint16(22, true), 1); // mono
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(28, true), 32000);
  assert.equal(view.getUint16(32, true), 2);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(text(36, 40), 'data');
  assert.equal(view.getUint32(40, true), dataLen);
  let peak = 0;
  for (let i = 44; i < bytes.length; i += 2) peak = Math.max(peak, Math.abs(view.getInt16(i, true)));
  assert.ok(peak > 100 && peak < 10000, `peak ${peak} should be audible but quiet`);
});

test('samtaleToken rejects with a 503 StemmeError', async () => {
  const s = createFakeStemme();
  await assert.rejects(s.samtaleToken('a'), (e: unknown) => {
    assert.ok(e instanceof StemmeError);
    assert.equal(e.status, 503);
    assert.equal(e.message, 'Samtale findes ikke i fake-tilstand');
    return true;
  });
});

test('ensureAgent and ensureVoice return fake ids', async () => {
  const s = createFakeStemme();
  assert.deepEqual(await s.ensureAgent(CONFIG, 'v'), {
    agentId: 'fake-agent',
    toolIds: { vaelg: 'fake-vaelg', luk: 'fake-luk' },
  });
  assert.equal(await s.ensureVoice('abc'), 'abc');
  assert.equal(await s.ensureVoice(), 'fake-voice');
  assert.equal(await s.ensureVoice(''), 'fake-voice');
});

test('KC-0241: the fake accepts a language on lyt and sig', async () => {
  const s = createFakeStemme();
  assert.equal(await s.lyt(new Uint8Array([1]), 'audio/webm', [], 'en'), 'Hvad venter på mig i dag?');
  assert.equal((await s.sig('hello', 'v', 'en')).contentType, 'audio/wav');
});
