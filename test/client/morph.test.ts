// KC-0064 phase 3: the keyed morph in public/morph.js, run on a real (linkedom) DOM.
// The morph only changes what the server rendered; everything the client added survives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

type Resultat = { nye: Element[]; endrede: Element[] };
type KcMorph = { merk(root: Element): void; morph(root: Element, html: string): Resultat };

const SRC = readFileSync(new URL('../../public/morph.js', import.meta.url), 'utf8');
function kcMorph(): KcMorph {
  const win: { kcMorph?: KcMorph } = {};
  new Function('window', SRC)(win);
  assert.ok(win.kcMorph, 'morph.js sets window.kcMorph');
  return win.kcMorph;
}

// A room as the server renders it; merk() runs on load, before any client decoration.
function rum(inner: string) {
  const { document, window } = parseHTML(`<!doctype html><html><body><main id="room">${inner}</main></body></html>`);
  const room = document.getElementById('room')!;
  const m = kcMorph();
  m.merk(room);
  return { document, window, room, m };
}

const kort = (id: string, tekst: string, ekstra = '') => `<div class="card" data-id="${id}" data-element="${tekst}"><p>${tekst}</p>${ekstra}</div>`;
const baand = (kraever: string, ordnet: string) =>
  `<section data-baand="kraever" class="baand-kraever">${kraever}</section><section data-baand="ordnet" class="baand-ordnet altid-foldet">${ordnet}</section>`;
const ids = (el: Element) => Array.from(el.querySelectorAll('[data-id]')).map((e) => e.getAttribute('data-id'));

test('unchanged html leaves every node object in place and reports nothing', () => {
  const html = baand(kort('kort:a', 'A') + kort('kort:b', 'B'), kort('log:1', 'L'));
  const { room, m } = rum(html);
  const foer = Array.from(room.querySelectorAll('*'));
  const r = m.morph(room, html);
  assert.deepEqual(r.nye, []);
  assert.deepEqual(r.endrede, []);
  const efter = Array.from(room.querySelectorAll('*'));
  assert.equal(efter.length, foer.length);
  efter.forEach((el, i) => assert.ok(el === foer[i], `node ${i} is the same object`));
});

test('one card changes: only that card is replaced and reported as changed', () => {
  const { room, m } = rum(baand(kort('kort:a', 'A') + kort('kort:b', 'B'), ''));
  const a = room.querySelector('[data-id="kort:a"]');
  const b = room.querySelector('[data-id="kort:b"]');
  const r = m.morph(room, baand(kort('kort:a', 'A') + kort('kort:b', 'B2'), ''));
  const b2 = room.querySelector('[data-id="kort:b"]')!;
  assert.ok(room.querySelector('[data-id="kort:a"]') === a, 'sibling is the same object');
  assert.ok(b2 !== b, 'changed card is a new node');
  assert.equal(b2.textContent, 'B2');
  assert.deepEqual(r.endrede, [b2]);
  assert.deepEqual(r.nye, []);
});

test('a new id is inserted at its index and reported as new', () => {
  const { room, m } = rum(baand(kort('kort:a', 'A') + kort('kort:c', 'C'), ''));
  const r = m.morph(room, baand(kort('kort:a', 'A') + kort('kort:b', 'B') + kort('kort:c', 'C'), ''));
  assert.deepEqual(ids(room), ['kort:a', 'kort:b', 'kort:c']);
  assert.deepEqual(r.nye, [room.querySelector('[data-id="kort:b"]')]);
  assert.deepEqual(r.endrede, []);
});

test('a removed id is gone', () => {
  const { room, m } = rum(baand(kort('kort:a', 'A') + kort('kort:b', 'B'), ''));
  const r = m.morph(room, baand(kort('kort:a', 'A'), ''));
  assert.deepEqual(ids(room), ['kort:a']);
  assert.deepEqual(r.nye, []);
  assert.deepEqual(r.endrede, []);
});

test('the order of the result follows the html', () => {
  const { room, m } = rum(baand(kort('kort:a', 'A') + kort('kort:b', 'B') + kort('kort:c', 'C'), ''));
  const a = room.querySelector('[data-id="kort:a"]');
  m.morph(room, baand(kort('kort:c', 'C') + kort('kort:a', 'A') + kort('kort:b', 'B'), ''));
  assert.deepEqual(ids(room), ['kort:c', 'kort:a', 'kort:b']);
  assert.ok(room.querySelector('[data-id="kort:a"]') === a, 'a reordered unchanged card keeps its node');
});

test('a card moving from Ordnet to Kræver dig arrives in kraever, reported as new, absent from ordnet', () => {
  const { room, m } = rum(baand(kort('kort:a', 'A'), kort('kort:b', 'B')));
  const r = m.morph(room, baand(kort('kort:a', 'A') + kort('kort:b', 'B'), ''));
  const kraever = room.querySelector('[data-baand="kraever"]')!;
  const ordnet = room.querySelector('[data-baand="ordnet"]')!;
  assert.deepEqual(ids(kraever), ['kort:a', 'kort:b']);
  assert.deepEqual(ids(ordnet), []);
  assert.deepEqual(r.nye, [kraever.querySelector('[data-id="kort:b"]')]);
});

test('an open details stays open in an unchanged card and is open in the replacement of a changed one', () => {
  const hvorfor = '<details><summary>Hvorfor?</summary><p>fordi</p></details>';
  const { room, m } = rum(baand(kort('kort:a', 'A', hvorfor) + kort('kort:b', 'B', hvorfor), ''));
  room.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''));
  m.morph(room, baand(kort('kort:a', 'A', hvorfor) + kort('kort:b', 'B2', hvorfor), ''));
  assert.ok(room.querySelector('[data-id="kort:a"] details')!.hasAttribute('open'), 'unchanged card keeps open');
  assert.ok(room.querySelector('[data-id="kort:b"] details')!.hasAttribute('open'), 'replacement is open too');
});

test('a focused textarea in a changed element keeps its typed value, focus and caret', (t) => {
  const afsnit = (tekst: string) => `<div class="afsnit" data-id="afsnit:d:1"><p>${tekst}</p><textarea name="tekst">gammel</textarea></div>`;
  const { document, window, room, m } = rum(afsnit('før'));
  const gammel = room.querySelector('textarea')!;
  gammel.value = 'halv sætning';
  // linkedom has no focus model and no selection API: fake both on this document.
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => gammel });
  Object.assign(gammel, { selectionStart: 3, selectionEnd: 7 });
  const proto = (window as unknown as { HTMLTextAreaElement: { prototype: Record<string, unknown> } }).HTMLTextAreaElement.prototype;
  const fokus: unknown[] = [];
  const valg: unknown[] = [];
  const foerFocus = proto.focus;
  proto.focus = function (this: unknown) { fokus.push(this); };
  proto.setSelectionRange = function (this: unknown, s: number, e: number) { valg.push([this, s, e]); };
  t.after(() => { proto.focus = foerFocus; delete proto.setSelectionRange; });
  const r = m.morph(room, afsnit('efter'));
  const ny = room.querySelector('textarea')!;
  assert.ok(ny !== gammel, 'the element was replaced');
  assert.equal(r.endrede.length, 1);
  assert.equal(ny.value, 'halv sætning');
  assert.deepEqual(fokus, [ny], 'focus() called on the replacement field');
  assert.deepEqual(valg, [[ny, 3, 7]], 'caret carried over');
});

test('a focused field without a name is matched by its index among fields', (t) => {
  const el = (tekst: string) => `<div data-id="mail:1"><p>${tekst}</p><input name="emne" value="x"><textarea>t</textarea></div>`;
  const { document, window, room, m } = rum(el('a'));
  const gammel = room.querySelector('textarea')!;
  gammel.value = 'skrevet';
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => gammel });
  const proto = (window as unknown as { HTMLTextAreaElement: { prototype: Record<string, unknown> } }).HTMLTextAreaElement.prototype;
  const fokus: unknown[] = [];
  const foerFocus = proto.focus;
  proto.focus = function (this: unknown) { fokus.push(this); };
  t.after(() => { proto.focus = foerFocus; });
  m.morph(room, el('b'));
  const ny = room.querySelector('textarea')!;
  assert.equal(ny.value, 'skrevet');
  assert.deepEqual(fokus, [ny]);
  assert.equal(room.querySelector('input')!.getAttribute('value'), 'x');
});

test('client decorations survive a morph of a different element and are not duplicated', () => {
  const felt = '<label class="field"><textarea name="besked"></textarea></label>';
  const { document, room, m } = rum(`<div class="actions">${felt}</div>` + baand(kort('kort:a', 'A') + kort('kort:b', 'B'), ''));
  const actions = room.querySelector('.actions')!;
  const knap = document.createElement('button');
  knap.setAttribute('data-klient', '');
  knap.className = 'btn mic';
  actions.appendChild(knap);
  room.querySelector('textarea')!.setAttribute('data-mic-done', '1');
  room.querySelector('.field')!.classList.add('has-mic');
  room.querySelector('[data-id="kort:a"]')!.classList.add('is-selected');
  m.morph(room, `<div class="actions">${felt}</div>` + baand(kort('kort:a', 'A') + kort('kort:b', 'B2'), ''));
  assert.equal(room.querySelectorAll('[data-klient]').length, 1, 'the client button is kept once');
  assert.ok(actions.lastElementChild === knap, 'and in its place');
  assert.equal(room.querySelector('textarea')!.getAttribute('data-mic-done'), '1');
  assert.ok(room.querySelector('.field')!.classList.contains('has-mic'));
  assert.ok(room.querySelector('[data-id="kort:a"]')!.classList.contains('is-selected'));
});

test('a client node after a server node stays right after it', () => {
  const { document, room, m } = rum('<div class="x"><textarea name="a"></textarea><p>p</p></div>');
  const ta = room.querySelector('textarea')!;
  const mic = document.createElement('button');
  mic.setAttribute('data-klient', '');
  ta.after(mic);
  m.morph(room, '<div class="x"><textarea name="a"></textarea><p>p2</p></div>');
  assert.ok(ta.nextElementSibling === mic);
  assert.equal(room.querySelector('p')!.textContent, 'p2');
});

test('a server class change on a band keeps the class the client added', () => {
  const { room, m } = rum(baand('', kort('log:1', 'L')));
  const ordnet = room.querySelector('[data-baand="ordnet"]')!;
  ordnet.classList.add('is-aaben');
  ordnet.setAttribute('aria-hidden', 'false');
  m.morph(room, baand('', kort('log:1', 'L')).replace('baand-ordnet altid-foldet', 'baand-ordnet'));
  assert.ok(room.querySelector('[data-baand="ordnet"]') === ordnet, 'band container kept');
  assert.deepEqual(Array.from(ordnet.classList).sort(), ['baand-ordnet', 'is-aaben']);
  assert.equal(ordnet.getAttribute('aria-hidden'), 'false', 'client attribute untouched');
});

test('server attributes on an unkeyed element follow the server: set, change, remove', () => {
  const { room, m } = rum('<div class="x" title="a" data-n="1"><p>p</p></div>');
  const x = room.querySelector('.x')!;
  m.morph(room, '<div class="x" title="b" hidden><p>p</p></div>');
  assert.ok(room.querySelector('.x') === x);
  assert.equal(x.getAttribute('title'), 'b');
  assert.ok(x.hasAttribute('hidden'));
  assert.equal(x.hasAttribute('data-n'), false);
});

test('a new unkeyed container is inserted with its outermost ids reported as new', () => {
  const { room, m } = rum(baand(kort('kort:a', 'A'), ''));
  const r = m.morph(room, baand(kort('kort:a', 'A'), '') + `<section data-gruppe="ny">${kort('kort:n', 'N', '<span data-id="indre:1">i</span>')}</section>`);
  assert.deepEqual(ids(room), ['kort:a', 'kort:n', 'indre:1']);
  assert.deepEqual(r.nye, [room.querySelector('[data-id="kort:n"]')]);
});

test('an inserted element is recorded, so the next identical morph leaves it alone', () => {
  const { room, m } = rum(baand('', ''));
  const html = baand(kort('kort:a', 'A'), '');
  m.morph(room, html);
  const a = room.querySelector('[data-id="kort:a"]')!;
  a.classList.add('is-ny');
  const r = m.morph(room, html);
  assert.deepEqual(r.nye, []);
  assert.deepEqual(r.endrede, []);
  assert.ok(room.querySelector('[data-id="kort:a"]') === a);
  assert.ok(a.classList.contains('is-ny'));
});

test('morph.js does not reference the global document', () => {
  assert.doesNotMatch(SRC.replace(/\/\/.*$/gm, ''), /(^|[^.\w])document\b/);
});
