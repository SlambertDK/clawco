import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNytRun, buildForslagRun, buildSkriveChatRun } from '../../src/rooms/skrive/prompt.ts';
import { GRAENSER } from '../../src/agent/prompt.ts';
import { udenData, udpak } from '../../src/agent/udtroet.ts';
import type { Dokument } from '../../src/rooms/skrive/schema.ts';

const dok: Dokument = { id: 'dok-1', titel: 'Udkast', brief: 'Kort mail til driften om vinterberedskab', afsnit: [{ id: 'a1', tekst: 'Hej Tom.' }, { id: 'a2', tekst: 'Vi strammer reserverne.' }], kilder: [], oprettet: 'x', aendret: 'x' };

test('nyt run carries the brief and asks for the document schema in Danish', () => {
  const r = buildNytRun('Takkemail', 'Kort mail til driften om vinterberedskab');
  assert.match(r.instructions, /```json/);
  for (const k of ['titel', 'afsnit', 'kilder']) assert.ok(r.instructions.includes(`"${k}"`), k);
  assert.match(r.input, /Kort mail til driften om vinterberedskab/);
  assert.match(r.input, /Takkemail/);
});

test('KC-0118: the nyt run is built by the shared prompt builder: limits once, zone line', () => {
  const r = buildNytRun('Takkemail', 'Kort mail');
  assert.equal(r.instructions.split(GRAENSER).length - 1, 1);
  assert.match(r.instructions, /Zone: privat/);
});

// KC-0123: the draft is Hermes' text — an afledt segment, never the instructions.
const udkast = (r: { input: string }): string => udpak(r.input).find((d) => d.kilde === 'udkast' && d.tillid === 'afledt')?.tekst ?? '';

test('forslag run numbers the paragraphs with their ids (as afledt data) and names the requested change', () => {
  const r = buildForslagRun(dok, 'a2', 'stram');
  assert.match(udkast(r), /\[a1\] Hej Tom\./);
  assert.ok(!r.instructions.includes('Hej Tom.'));
  assert.match(r.instructions, /"forslag"/);
  assert.match(r.instructions, /højst 3/i);
  assert.match(r.input, /a2/);
  assert.match(r.input, /stram/i);
  const hele = buildForslagRun(dok, null, 'konkret');
  assert.match(hele.input, /hele teksten/i);
});

test('chat run includes the document and the context and allows a forslag block', () => {
  const r = buildSkriveChatRun('Gør afslutningen varmere', 'Afsnit 2', dok);
  assert.ok(udpak(r.input).some((d) => d.kilde === 'element' && /Om: Afsnit 2/.test(d.tekst)));
  assert.match(udkast(r), /\[a2\] Vi strammer reserverne\./);
  assert.match(r.instructions, /"forslag"/);
  assert.equal(udenData(r.input), 'Gør afslutningen varmere');
});
