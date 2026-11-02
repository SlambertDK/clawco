// KC-0161: the Tailscale card in Start. Pure render per state: exactly where you are and ONE next step; one button
// at most, and only `klar` has one (Del Clawco på dit tailnet); never a Funnel word; plain Danish with the two hard
// words explained; laptop mode hides the invitations and says "kun når laptoppen er vågen".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTailscaleKort, visTailscaleKort, FAMILIE_GRAENSE } from '../../../src/rooms/start/tailscalekort.ts';
import { TS_TILSTANDE, type TsSyn, type TsTilstand } from '../../../src/shell/tailscale.ts';

const tekstAf = (h: string): string => h.replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const syn = (tilstand: TsTilstand, ekstra: Partial<TsSyn> = {}): TsSyn => ({ tilstand, port: 8750, laptop: tilstand === 'laptop', ...ekstra });
const kort = (s: TsSyn, kanDele = true): string => String(renderTailscaleKort({ syn: s, kanDele }));
const DELT = syn('delt', { adresse: 'https://laptop.example.ts.net' });

test('every state renders its own marker, as one kort block', () => {
  for (const t of TS_TILSTANDE) {
    const h = kort(t === 'delt' ? DELT : syn(t));
    assert.match(h, new RegExp(`data-tailscale="${t}"`), t);
    assert.match(h, /data-blok="kort"/);
    assert.equal(h.match(/<article/g)?.length, 1);
  }
});

test('one next step per state: the button only in klar, a link where Tailscale must be fetched', () => {
  const knapper = (h: string): number => (h.match(/data-aktion=/g) ?? []).length;
  for (const t of TS_TILSTANDE) assert.equal(knapper(kort(t === 'delt' ? DELT : syn(t))), t === 'klar' ? 1 : 0, t);
  assert.match(kort(syn('mangler')), /href="https:\/\/tailscale\.com\/download"/);
  assert.match(kort(syn('laptop')), /href="https:\/\/tailscale\.com\/download"/);
  for (const t of ['ikke-logget-ind', 'slukket', 'klar', 'ukendt'] as const) assert.doesNotMatch(kort(syn(t)), /tailscale\.com\/download/, t);
});

test('klar: shows the exact command first and one button bound to the configured port, needing a human yes', () => {
  const h = kort(syn('klar'));
  assert.match(h, /tailscale serve --bg 8750/);
  assert.ok(h.indexOf('tailscale serve --bg 8750') < h.indexOf('data-aktion="tailscale-del"'), 'the command is shown before the button');
  assert.match(h, /data-aktion="tailscale-del"/);
  assert.match(h, /data-kraever-ja/);
  assert.match(h, /data-arg="\{&quot;port&quot;:8750\}"/);
  assert.match(h, />Del Clawco på dit tailnet</);
  const port = kort({ ...syn('klar'), port: 9001 });
  assert.match(port, /tailscale serve --bg 9001/);
  assert.match(port, /&quot;port&quot;:9001/);
});

test('a person who is not the owner gets no button, and is told who shares', () => {
  const h = kort(syn('klar'), false);
  assert.doesNotMatch(h, /data-aktion=/);
  assert.match(tekstAf(h), /Ejeren/);
});

test('delt: the address to open on the phone, with a copy button, and the invitations', () => {
  const h = kort(DELT);
  assert.match(h, /https:\/\/laptop\.example\.ts\.net/);
  assert.match(h, /data-kopier="https:\/\/laptop\.example\.ts\.net"/);
  const t = tekstAf(h);
  assert.match(t, /seks/i);
  assert.match(t, /invit/i);
  assert.match(h, /href="https:\/\/login\.tailscale\.com\/admin\/users"/);
  assert.equal(FAMILIE_GRAENSE, 6);
});

test('delt without a readable address says so instead of inventing one', () => {
  const h = kort(syn('delt'));
  assert.doesNotMatch(h, /data-kopier/);
  assert.match(tekstAf(h), /kan ikke læse adressen/i);
});

test('delt but open to the whole internet: the card says so and how to close it; no invitations then', () => {
  const t = tekstAf(kort(syn('delt', { adresse: 'https://laptop.example.ts.net', offentlig: true })));
  assert.match(t, /hele internettet/i);
  assert.match(t, /tailscale serve reset/);
  assert.doesNotMatch(t, /invit/i);
});

test('laptop: the phone limit in the honest words, and no invitations', () => {
  const t = tekstAf(kort(syn('laptop')));
  assert.match(t, /uden Tailscale kan telefonen ikke nå Clawco; med Tailscale kan den, men kun når den bærbare er vågen/i);
  assert.doesNotMatch(t, /invit|seks/i);
});

test('a laptop that does have Tailscale shared: kun når laptoppen er vågen, invitations hidden', () => {
  const t = tekstAf(kort(syn('delt', { adresse: 'https://laptop.example.ts.net', laptop: true })));
  assert.match(t, /kun når laptoppen er vågen/i);
  assert.doesNotMatch(t, /invit|seks/i);
  assert.match(tekstAf(kort(syn('klar', { laptop: true }))), /kun når laptoppen er vågen/i);
});

test('ukendt says it does not know and does not guess', () => {
  const t = tekstAf(kort(syn('ukendt')));
  assert.match(t, /kan ikke se/i);
  assert.match(t, /gætte/i);
});

test('plain words: Tailscale and tailnet are explained wherever they appear; no Funnel, no jargon', () => {
  for (const tilst of TS_TILSTANDE) {
    const h = kort(tilst === 'delt' ? DELT : syn(tilst));
    const t = tekstAf(h);
    assert.ok(!/funnel/i.test(h), `${tilst}: no funnel`);
    for (const jargon of ['acl', 'proxy', 'daemon', 'magicdns', 'auth key', 'api']) assert.ok(!t.toLowerCase().includes(jargon), `${tilst}: ${jargon}`);
    if (/tailnet/i.test(t)) assert.match(t, /privat net/i, `${tilst}: tailnet is explained`);
  }
  assert.match(tekstAf(kort(syn('mangler'))), /gratis program/i);
});

test('every piece of text goes through the escaper', () => {
  const h = kort(syn('delt', { adresse: 'https://x"><script>.example.ts.net' }));
  assert.ok(!/<script/i.test(h));
  assert.ok(!h.includes('undefined'));
});

test('the card is shown while the journey is open, and after Done only when it asks for something', () => {
  for (const t of TS_TILSTANDE) assert.equal(visTailscaleKort(t === 'delt' ? DELT : syn(t), false), true, `${t} while open`);
  const efter = (s: TsSyn): boolean => visTailscaleKort(s, true);
  for (const t of ['mangler', 'ikke-logget-ind', 'slukket', 'klar'] as const) assert.equal(efter(syn(t)), true, t);
  for (const s of [syn('laptop'), syn('ukendt'), DELT]) assert.equal(efter(s), false, s.tilstand);
  assert.equal(efter(syn('delt', { offentlig: true })), true, 'open to the internet always asks');
});
