// KC-0264: reading the token counts out of a provider's answer as it streams past, without touching its content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forbrugsLaeser, tilLejer } from '../../src/model/forbrug.ts';
import { afregning } from '../../src/model/afregning.ts';
import { maanedFor, nulstilles, procent } from '../../src/model/kvote.ts';
import { SENTINEL, sseSvar } from './hjaelp.ts';

const enc = new TextEncoder();

function laes(tekst: string, stykker: number, json = false) {
  const l = forbrugsLaeser(json ? 'application/json' : 'text/event-stream; charset=utf-8');
  const b = enc.encode(tekst);
  const str = Math.max(1, Math.ceil(b.length / stykker));
  for (let i = 0; i < b.length; i += str) l.laes(b.subarray(i, i + str));
  return l.resultat();
}

test('SSE: message_start gives the input side, the last message_delta the output, whatever the chunk boundaries', () => {
  const s = sseSvar({ input: 120, output: 42, cacheLaes: 900, cacheSkriv: 30, cache1t: 7 });
  for (const n of [1, 3, 17, 200, s.length]) {
    assert.deepEqual(laes(s, n), { input: 120, output: 42, cacheLaes: 900, cacheSkriv5m: 30, cacheSkriv1t: 7 }, `${n} stykker`);
  }
});

test('SSE: CRLF line ends and a message_delta that repeats the input counts (cumulative) are read the same way', () => {
  const s = sseSvar({ input: 10, output: 3 }).replace(/\n/g, '\r\n')
    + 'event: message_delta\r\ndata: {"type":"message_delta","delta":{},"usage":{"input_tokens":11,"output_tokens":9,"cache_read_input_tokens":2}}\r\n\r\n';
  assert.deepEqual(laes(s, 5), { input: 11, output: 9, cacheLaes: 2, cacheSkriv5m: 0, cacheSkriv1t: 0 });
});

test('SSE: only cache_creation_input_tokens (no split) counts as 5-minute writes', () => {
  const s = 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5,"cache_creation_input_tokens":40,"output_tokens":1}}}\n\n';
  assert.deepEqual(laes(s, 1), { input: 5, output: 1, cacheLaes: 0, cacheSkriv5m: 40, cacheSkriv1t: 0 });
});

test('no message_start (an error event, a broken stream) = no usage, so nothing is charged or recorded', () => {
  assert.equal(laes('event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"x"}}\n\n', 2), null);
  assert.equal(laes('', 1), null);
});

test('content events are never parsed: a content line that is not JSON does not break the counting', () => {
  const s = sseSvar({ input: 3, output: 4 }).replace(/event: content_block_delta\ndata: [^\n]*/, `event: content_block_delta\ndata: {ikke json ${SENTINEL}`);
  assert.deepEqual(laes(s, 4), { input: 3, output: 4, cacheLaes: 0, cacheSkriv5m: 0, cacheSkriv1t: 0 });
});

test('a non-streamed JSON answer is read from its usage object', () => {
  const j = JSON.stringify({ id: 'msg_1', content: [{ type: 'text', text: SENTINEL }], usage: { input_tokens: 8, output_tokens: 2, cache_read_input_tokens: 1 } });
  assert.deepEqual(laes(j, 3, true), { input: 8, output: 2, cacheLaes: 1, cacheSkriv5m: 0, cacheSkriv1t: 0 });
  assert.equal(laes('{"ikke": ', 1, true), null);
});

test('the result is numbers only: the sentinel text never appears in it', () => {
  const r = laes(sseSvar({ tekst: SENTINEL }), 7);
  assert.ok(!JSON.stringify(r).includes(SENTINEL));
});

test('the month and the reset date are UTC calendar months', () => {
  assert.equal(maanedFor(new Date('2026-11-03T12:00:00Z')), '2026-11-01');
  assert.equal(maanedFor(new Date('2026-11-30T23:59:59Z')), '2026-11-01');
  assert.equal(nulstilles(new Date('2026-11-03T12:00:00Z')), '2026-12-01');
  assert.equal(nulstilles(new Date('2026-12-31T23:00:00Z')), '2027-01-01');
});

test('procent: whole percent of the cap, never above 100, 100 for a cap of 0', () => {
  assert.equal(procent(0, 4_000_000), 0);
  assert.equal(procent(1_999_999, 4_000_000), 49);
  assert.equal(procent(4_000_000, 4_000_000), 100);
  assert.equal(procent(9_000_000, 4_000_000), 100);
  assert.equal(procent(1, 0), 100);
});

test('KC-0273: komplet() is true only once the final count arrived (message_delta, or the JSON usage)', () => {
  const hel = sseSvar({ input: 5, output: 9 });
  const l = forbrugsLaeser('text/event-stream');
  l.laes(enc.encode(hel.slice(0, hel.indexOf('event: message_delta'))));
  assert.deepEqual(l.resultat()?.output, 1);
  assert.equal(l.komplet(), false, 'message_start only');
  const k = forbrugsLaeser('text/event-stream');
  k.laes(enc.encode(hel));
  k.resultat();
  assert.equal(k.komplet(), true);
  const j = forbrugsLaeser('application/json');
  j.laes(enc.encode('{"usage":{"input_tokens":1,"output_tokens":2}}'));
  j.resultat();
  assert.equal(j.komplet(), true);
});

test('KC-0273: tilLejer rewrites only the usage, the same for every chunk boundary and CRLF line ends', () => {
  const s = sseSvar({ input: 10, output: 3, cacheLaes: 7, cacheSkriv: 2, tekst: SENTINEL });
  const hel = (tekst: string, n: number) => {
    const t = tilLejer('text/event-stream');
    const b = enc.encode(tekst);
    const str = Math.max(1, Math.ceil(b.length / n));
    let ud = '';
    const dek = new TextDecoder();
    for (let i = 0; i < b.length; i += str) ud += dek.decode(t.stykke(b.subarray(i, i + str)), { stream: true });
    return ud + dek.decode(t.slut());
  };
  const ventet = hel(s, 1);
  assert.match(ventet, /"usage":\{"input_tokens":19,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":1\}/);
  assert.ok(!ventet.includes('cache_creation"'), 'the 5m/1h split is gone');
  assert.equal(ventet.replace(/"usage":\{[^}]*\}/, 'U'), s.replace(/"usage":\{"input_tokens".*?"output_tokens":1\}/, 'U'), 'everything but the usage is byte-identical');
  for (const n of [3, 17, 200, s.length]) assert.equal(hel(s, n), ventet, `${n} stykker`);
  assert.equal(hel(s.replace(/\n/g, '\r\n'), 13), ventet.replace(/\n/g, '\r\n'));
});

test('KC-0273: afregning — measured when complete, nothing for a clean end without usage, else the reservation', () => {
  const res = { forbrug: { input: 900, output: 256, cacheLaes: 0, cacheSkriv5m: 0, cacheSkriv1t: 0 }, pris: 999, maxTokens: 256 };
  const set = { input: 40, output: 1, cacheLaes: 3, cacheSkriv5m: 0, cacheSkriv1t: 0 };
  assert.deepEqual(afregning({ set: { ...set, output: 30 }, komplet: true, ren: true, reservation: res }), { forbrug: { ...set, output: 30 }, regel: 'maalt' });
  assert.deepEqual(afregning({ set: null, komplet: false, ren: true, reservation: res }).regel, 'intet');
  assert.deepEqual(afregning({ set, komplet: false, ren: false, reservation: res }), { forbrug: { ...set, output: 256 }, regel: 'reservation' });
  assert.deepEqual(afregning({ set, komplet: false, ren: true, reservation: res }).forbrug.output, 256, 'a clean end without message_delta is a broken answer');
  assert.deepEqual(afregning({ set: null, komplet: false, ren: false, reservation: res }).forbrug, { input: 900, output: 256, cacheLaes: 0, cacheSkriv5m: 0, cacheSkriv1t: 0 });
});
