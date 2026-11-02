import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSseChunks } from '../../src/agent/sse.ts';

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
