import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../public/lyt.js';

// KC-0022: the hands-free loop decides from the mic level alone when Henrik
// has finished a sentence, and from the words when he wants to stop.
type Maaler = { feed(rms: number, t: number): 'venter' | 'taler' | 'faerdig' | 'stille' };
const KC = (globalThis as unknown as { KCLyt: { maaler(o?: Record<string, number>): Maaler; erStop(t: string): boolean } }).KCLyt;

function run(levels: [number, number][], o?: Record<string, number>) {
  const m = KC.maaler(o);
  return levels.map(([rms, t]) => m.feed(rms, t));
}

test('speech then a pause ends the sentence', () => {
  const quiet = 0.005, loud = 0.08;
  const seq: [number, number][] = [];
  for (let t = 0; t <= 500; t += 50) seq.push([quiet, t]);       // room noise
  for (let t = 550; t <= 1500; t += 50) seq.push([loud, t]);     // talking
  for (let t = 1550; t <= 3000; t += 50) seq.push([quiet, t]);   // pause
  const out = run(seq, { pauseMs: 1200 });
  assert.equal(out[5], 'venter');
  assert.equal(out[15], 'taler');
  const done = out.indexOf('faerdig');
  assert.ok(done > 0, 'never finished');
  assert.ok(seq[done]![1] >= 1500 + 1200 && seq[done]![1] <= 1500 + 1300, `finished at ${seq[done]![1]}`);
});

test('a short pause inside a sentence does not end it', () => {
  const seq: [number, number][] = [];
  for (let t = 0; t <= 800; t += 50) seq.push([0.08, t]);
  for (let t = 850; t <= 1500; t += 50) seq.push([0.005, t]);     // 650 ms breath
  for (let t = 1550; t <= 2000; t += 50) seq.push([0.08, t]);
  assert.ok(!run(seq, { pauseMs: 1200 }).includes('faerdig'));
});

test('nothing said for a long time is silence, not a sentence', () => {
  const seq: [number, number][] = [];
  for (let t = 0; t <= 9000; t += 100) seq.push([0.004, t]);
  const out = run(seq, { stilleMs: 8000 });
  assert.equal(out.at(-1), 'stille');
  assert.ok(!out.includes('taler'));
});

test('a single click is not speech', () => {
  const seq: [number, number][] = [[0.005, 0], [0.2, 50], [0.005, 100]];
  for (let t = 150; t <= 3000; t += 50) seq.push([0.005, t]);
  assert.ok(!run(seq).includes('faerdig'));
});

test('stop words end the conversation; ordinary sentences do not', () => {
  for (const s of ['Stop', 'stop.', 'Tak, det var det', 'Farvel!', 'slut', 'Det var alt']) assert.ok(KC.erStop(s), s);
  for (const s of ['Hvad venter på mig?', 'Stop mødet kl. 10 i kalenderen og flyt det', 'tak for svaret, hvad med mail?']) assert.ok(!KC.erStop(s), s);
});
