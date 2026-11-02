import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, html, raw, Markup } from '../../src/delt/html.ts';

test('esc escapes the five HTML-special characters and nothing else', () => {
  assert.equal(esc(`<script>"x"&'y'</script>`), '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;');
  assert.equal(esc('Æble ø å'), 'Æble ø å');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(42), '42');
});

test('html`` escapes every interpolation but passes Markup through', () => {
  const ond = '"><img src=x onerror=alert(1)>';
  const m = html`<p title="${ond}">${ond}${raw('<b>ok</b>')}${[html`<i>${'<'}</i>`, 'a&b']}${false}${null}</p>`;
  assert.ok(m instanceof Markup);
  assert.equal(m.toString(), '<p title="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;">&quot;&gt;&lt;img src=x onerror=alert(1)&gt;<b>ok</b><i>&lt;</i>a&amp;b</p>');
});
