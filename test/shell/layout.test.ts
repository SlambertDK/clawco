import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shell } from '../../src/shell/layout.ts';
import { html } from '../../src/shell/html.ts';
import { hvadKanJegSige } from '../../src/shell/aabn.ts';
import { PRODUKT } from '../../src/shell/navn.ts';

const page = () => String(shell({
  roomId: 'dagen',
  hermesStatus: 'Holder øje med kalenderen',
  venter: { dagen: 1, mail: 3 },
  main: html`<p id="m">Indhold</p>`,
  kontekst: 'Mødet kl. 10',
  chat: [{ id: 'c1', tid: '2026-10-26T06:00:00.000Z', fra: 'hermes', tekst: 'Godmorgen <b>' }],
}));

test('shell is a full dark html document with the three columns and the design fonts', () => {
  const out = page();
  assert.match(out, /^<!doctype html>/i);
  assert.match(out, /<html lang="da"/);
  assert.match(out, /<nav aria-label="Rum"/);
  assert.match(out, /<main/);
  assert.match(out, /<aside aria-label="Spørg Hermes"/);
  assert.match(out, /rel="preload" href="\/fonts\/inter-latin-wght-normal\.woff2" as="font" type="font\/woff2" crossorigin/);
  assert.ok(!/fonts\.g/.test(out), "KC-0229: no font host");
  assert.match(out, /\/app\.css/);
  assert.match(out, /\/app\.js/);
});

test('shell marks the active room and shows pending counts from venter', () => {
  const out = page();
  assert.match(out, /<a[^>]*href="\/rum\/dagen"[^>]*aria-current="page"/);
  assert.match(out, /href="\/rum\/mail"[^>]*><span>Mail<\/span><span class="count">3<\/span><\/a>/);
  // KC-0093: Hjem's number is everything that waits (1 + 3), the same as the title.
  assert.match(out, /href="\/rum\/hjem"[^>]*><span>Nu<\/span><span class="count">4<\/span><\/a>/);
});

test('shell shows the room name, Hermes status and the context chip, escaping chat text', () => {
  const out = page();
  assert.match(out, /<header[^>]*class="top"[\s\S]*Dagen/);
  assert.match(out, /id="hermes-status"[^>]*>Holder øje med kalenderen/);
  assert.match(out, /id="kontekst"[^>]*>Om: Mødet kl\. 10/);
  assert.match(out, /Godmorgen &lt;b&gt;/);
  assert.match(out, /<form id="chat-form" data-room="dagen"/);
});

test('shell embeds the main markup unescaped', () => {
  assert.match(page(), /<p id="m">Indhold<\/p>/);
});

test('shell has the chat drawer toggle, an addressable aside and a context-aware input placeholder', () => {
  const out = page();
  assert.match(out, /<aside[^>]*id="aside"/);
  assert.match(out, /<button[^>]*id="chat-toggle"[^>]*aria-controls="aside"/);
  assert.match(out, /<input id="chat-input"[^>]*placeholder="Skriv om: Mødet kl\. 10"/);
  assert.match(out, /<button[^>]*id="kontekst-ryd"/);
});

test('KC-0016: the shell can be added to the home screen as a dark standalone app', () => {
  const out = page();
  assert.match(out, /<meta name="viewport" content="[^"]*viewport-fit=cover/);
  assert.match(out, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(out, /<link rel="apple-touch-icon" href="\/icon-180\.png">/);
  assert.match(out, /<link rel="icon" href="\/icon\.svg" type="image\/svg\+xml">/);
  assert.match(out, /<meta name="theme-color" content="#0E1210">/);
  assert.match(out, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(out, /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">/);
  assert.match(out, new RegExp(`<meta name="apple-mobile-web-app-title" content="${PRODUKT}">`));
});

test('active universes are listed as indented links under the Univers entry, with counts and the active one marked', () => {
  const out = String(shell({
    roomId: 'univers-min-arena', hermesStatus: 'Klar', venter: { 'univers-min-arena': 2 }, main: html`<p></p>`, chat: [],
    univers: [{ id: 'min-arena', navn: 'Min <arena>' }, { id: 'andet', navn: 'Andet' }], titel: 'Min <arena>',
  }));
  assert.match(out, /href="\/rum\/univers"[^>]*><span>Univers<\/span><\/a>\s*<ul class="rooms-sub">/);
  assert.match(out, /<a[^>]*href="\/rum\/univers-min-arena"[^>]*aria-current="page"[^>]*><span>Min &lt;arena&gt;<\/span><span class="count">2<\/span><\/a>/);
  assert.match(out, /href="\/rum\/univers-andet"[^>]*><span>Andet<\/span><\/a>/);
  assert.match(out, new RegExp(`<title>Min &lt;arena&gt; · ${PRODUKT}</title>`));
  assert.match(out, /<strong>Min &lt;arena&gt;<\/strong>/);
  assert.doesNotMatch(out, /<a[^>]*href="\/rum\/univers"[^>]*aria-current/);
});

test('without universes there is no sub list', () => {
  assert.doesNotMatch(page(), /rooms-sub/);
});

test('KC-0041: every room has the Send til Claude Code dialog with one choice per project, and the chat can open it', () => {
  const out = page();
  assert.match(out, /<dialog id="cc-dialog"/);
  assert.match(out, /name="projekt" value="kontrolcenter"[^>]*checked/);
  assert.match(out, /name="projekt" value="shelfatlas"/);
  assert.match(out, /<textarea[^>]*name="saetning"[^>]*maxlength="500"/);
  assert.match(out, /id="cc-chat"/);
});

test('KC-0052: with synlige, rooms that are not relevant now are in the nav but hidden; a univers lights its parent', () => {
  const out = String(shell({
    roomId: 'mail', hermesStatus: 'Klar', venter: {}, main: html``, chat: [],
    univers: [{ id: 'min-arena', navn: 'Min arena' }, { id: 'have', navn: 'Have' }],
    synlige: new Set(['hjem', 'mail', 'univers', 'univers-have']),
  }));
  assert.match(out, /<li><a href="\/rum\/hjem"/);
  assert.match(out, /<li><a href="\/rum\/mail"/);
  assert.match(out, /<li hidden data-eget><a href="\/rum\/skrive"/, 'own work: a count does not reveal it');
  assert.match(out, /<li hidden><a href="\/rum\/dagen"/);
  assert.match(out, /<li><a href="\/rum\/univers"/);
  assert.match(out, /<li hidden data-eget><a href="\/rum\/univers-min-arena"/);
  assert.match(out, /<li data-eget><a href="\/rum\/univers-have"/);
});

test('KC-0064: the morph script loads before app.js, which uses it', () => {
  const out = page();
  const morph = out.indexOf('<script src="/morph.js" defer></script>');
  const app = out.indexOf('<script src="/app.js" defer></script>');
  assert.ok(morph >= 0, 'morph.js is loaded');
  assert.ok(morph < app, 'morph.js comes first');
});

// KC-0071: the freshness rules load before app.js, which uses them for the live stream.
test('shell loads the freshness rules before the client script', () => {
  const out = page();
  const frisk = out.indexOf('src="/frisk.js"');
  assert.ok(frisk > 0, 'frisk.js is loaded');
  assert.ok(frisk < out.indexOf('src="/app.js"'), 'frisk.js comes before app.js');
});

// KC-0072: the connection rules (Danish error texts, the lost-connection band) load before app.js.
test('shell loads the connection rules before the client script', () => {
  const out = page();
  const f = out.indexOf('src="/forbindelse.js"');
  assert.ok(f > 0, 'forbindelse.js is loaded');
  assert.ok(f < out.indexOf('src="/app.js"'), 'forbindelse.js comes before app.js');
});

// KC-0094: the service worker is registered by a tiny script, so the offline page works from the second visit.
test('shell registers the offline service worker', () => {
  assert.ok(page().includes('src="/sw-start.js"'), 'sw-start.js is loaded');
});

// KC-0073: the phone button's scroll rules load before app.js.
test('shell loads the chat button rules before the client script', () => {
  const out = page();
  const f = out.indexOf('src="/fab.js"');
  assert.ok(f > 0, 'fab.js is loaded');
  assert.ok(f < out.indexOf('src="/app.js"'), 'fab.js comes before app.js');
});

// KC-0079: the tab title carries what waits (own unfinished work not counted); the base title is on <body> for app.js.
test('the title starts with the number that waits, without own unfinished work', () => {
  const out = String(shell({ roomId: 'mail', hermesStatus: 'Klar', venter: { dagen: 1, mail: 2, skrive: 4 }, main: html`<p>x</p>`, chat: [] }));
  assert.match(out, new RegExp(`<title>\\(3\\) Mail · ${PRODUKT}</title>`));
  assert.match(out, new RegExp(`<body[^>]* data-titel="Mail · ${PRODUKT}"`));
  const tom = String(shell({ roomId: 'mail', hermesStatus: 'Klar', venter: {}, main: html`<p>x</p>`, chat: [] }));
  assert.match(tom, new RegExp(`<title>Mail · ${PRODUKT}</title>`));
});

test('own-work rooms are marked in the nav whether shown or not, so app.js can leave them out of the count', () => {
  const out = String(shell({ roomId: 'skrive', hermesStatus: 'Klar', venter: { skrive: 2 }, main: html`<p>x</p>`, chat: [] }));
  assert.match(out, /<li data-eget><a href="\/rum\/skrive"/);
});

// KC-0080: the shortcuts load before app.js, and the help lists them (on the laptop it is one ? away).
test('shell loads the shortcuts and carries their help', () => {
  const out = page();
  const g = out.indexOf('src="/genveje.js"');
  assert.ok(g > 0 && g < out.indexOf('src="/app.js"'), 'genveje.js before app.js');
  assert.match(out, /<dialog id="genveje-dialog"[^>]*>/);
  assert.match(out, /<kbd>\/<\/kbd>/);
  assert.match(out, /<kbd>\?<\/kbd>/);
});

// KC-0098: the help also tells what the chat understands, from the same list the matcher is tested against.
test('the shortcuts help has a section "I chatten kan du sige" with a phrase per room and the univers by name', () => {
  const univers = [{ id: 'min-arena', navn: 'Min <arena>' }];
  const out = String(shell({ roomId: 'hjem', hermesStatus: 'Klar', venter: {}, main: html`<p>x</p>`, chat: [], univers }));
  const start = out.indexOf('<dialog id="genveje-dialog"');
  const dialog = out.slice(start, out.indexOf('</dialog>', start));
  assert.match(dialog, /I chatten kan du sige/);
  for (const e of hvadKanJegSige(univers)) assert.ok(dialog.includes(String(html`${e.saet}`)), e.saet);
  assert.match(dialog, /Åbn Min &lt;arena&gt;/, 'escaped');
  assert.match(dialog, /Alt andet svarer Hermes på\./);
});

// KC-0088: the countdown on Hjem's "Næste" line is kept true by its own script, before app.js.
test('shell loads the Næste countdown before app.js', () => {
  const out = page();
  const n = out.indexOf('src="/naeste.js"');
  assert.ok(n > 0 && n < out.indexOf('src="/app.js"'), 'naeste.js before app.js');
});

test('KC-0115: the chat carries a Rum list with only the rooms on screen (KC-0052), for the phone where the nav is gone', () => {
  const out = String(shell({ roomId: 'hjem', hermesStatus: 'Klar', venter: {}, main: html``, chat: [], synlige: new Set(['hjem', 'mail']) }));
  const aside = out.slice(out.indexOf('<aside'), out.indexOf('</aside>'));
  assert.match(aside, /<details class="rum-liste" data-rum-liste>\s*<summary[^>]*>Rum<\/summary>/);
  assert.match(aside, /href="\/rum\/mail"/);
  assert.match(aside, /href="\/rum\/hjem"[^>]*>Nu</);
  assert.doesNotMatch(aside, /href="\/rum\/skrive"/);
});
