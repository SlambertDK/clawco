import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSseChunks, SseForStor } from '../../src/agent/sse.ts';

test('returns data payloads of complete events', () => {
  const p = parseSseChunks();
  assert.deepEqual(p.push('data: {"a":1}\n\ndata: {"b":2}\n\n'), ['{"a":1}', '{"b":2}']);
});

test('buffers chunks split mid-line', () => {
  const p = parseSseChunks();
  assert.deepEqual(p.push('data: {"a"'), []);
  assert.deepEqual(p.push(':1}\n'), []);
  assert.deepEqual(p.push('\ndata: x\n\n'), ['{"a":1}', 'x']);
});

test('ignores comment lines and stray blank lines', () => {
  const p = parseSseChunks();
  assert.deepEqual(p.push(': keepalive\n\n\n: stream closed\n'), []);
  assert.deepEqual(p.push('data: ok\n\n'), ['ok']);
});

test('joins multi-line data with newline and handles CRLF', () => {
  const p = parseSseChunks();
  assert.deepEqual(p.push('data: one\r\ndata: two\r\n\r\n'), ['one\ntwo']);
});

test('accepts data without a space after the colon', () => {
  const p = parseSseChunks();
  assert.deepEqual(p.push('data:{"a":1}\n\n'), ['{"a":1}']);
});

test('KC-0275 (B7): a buffer past the maximum throws instead of growing (a line with no newline, or an event that never ends)', () => {
  const a = parseSseChunks({ maxBytes: 1000 });
  assert.deepEqual(a.push('data: ok\n\n'), ['ok']);
  a.push('x'.repeat(900));
  assert.throws(() => a.push('x'.repeat(200)), SseForStor);
  const b = parseSseChunks({ maxBytes: 1000 });
  assert.throws(() => { for (let i = 0; i < 100; i++) b.push(`data: ${'y'.repeat(50)}\n`); }, SseForStor, 'many data lines of one event that never ends');
  const c = parseSseChunks({ maxBytes: 1000 });
  for (let i = 0; i < 100; i++) assert.deepEqual(c.push(`data: ${'z'.repeat(50)}\n\n`), ['z'.repeat(50)], 'many finished events are fine');
});

test('KC-0275 (B7): the default maximum is 4 MiB', () => {
  const p = parseSseChunks();
  p.push('d'.repeat(4 * 1024 * 1024 - 1));
  assert.throws(() => p.push('dd'), SseForStor);
});
