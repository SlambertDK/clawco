import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, html } from '../../src/shell/html.ts';

test('esc escapes the five HTML-significant characters', () => {
  assert.equal(esc(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
});

test('esc turns null and undefined into an empty string', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('html tag escapes interpolated values but not the literal parts', () => {
  const name = '<Henrik>';
  assert.equal(String(html`<b>${name}</b>`), '<b>&lt;Henrik&gt;</b>');
});

test('html tag passes through values marked as trusted markup', () => {
  const inner = html`<i>${'x'}</i>`;
  assert.equal(String(html`<b>${inner}</b>`), '<b><i>x</i></b>');
});

test('html tag joins arrays of trusted markup without commas', () => {
  const items = ['a', 'b'].map((s) => html`<li>${s}</li>`);
  assert.equal(String(html`<ul>${items}</ul>`), '<ul><li>a</li><li>b</li></ul>');
});
