// KC-0076: "Kø 0" showed although the page had marked the count hidden — `.count { display:
// inline-flex }` beat the hidden attribute. Invariant: an element marked hidden is never shown,
// whatever class it has (counts, bands, chips). One global rule, no per-class exceptions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shell } from '../../src/shell/layout.ts';
import { html } from '../../src/shell/html.ts';

const css = readFileSync(new URL('../../public/app.css', import.meta.url), 'utf8');

test('the hidden attribute always wins over a class display', () => {
  assert.match(css, /(^|\n)\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
});

test('the Kø count starts hidden: nothing in the queue, no number', () => {
  const out = String(shell({ roomId: 'dagen', hermesStatus: 'Klar', venter: {}, main: html`<p>x</p>`, chat: [] }));
  assert.match(out, /<span class="count" id="koe-count" hidden><\/span>/);
});
