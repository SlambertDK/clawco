import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold } from '../../src/shell/fold.ts';
import { html } from '../../src/shell/html.ts';
import { foldet } from '../foldet.ts';

test('KC-0024: fold puts a phone-only button before content that is folded on the phone, open on the laptop', () => {
  const out = String(fold('Morgenavisen', html`<section>nyheder</section>`));
  assert.match(out, /<button type="button" class="btn btn-ghost kun-telefon fold-knap" data-fold aria-expanded="false">Vis Morgenavisen<\/button>/);
  assert.equal(foldet(out).get('Morgenavisen'), '<section>nyheder</section>');
  assert.match(String(fold('<x>', html``)), /Vis &lt;x&gt;/);
});

test('fold with a key: same visible name, its own key for the client', () => {
  const out = String(fold('grundlag', html`x`, 'grundlag:k:1'));
  assert.match(out, /Vis grundlag<\/button><div data-fold-id="grundlag:k:1" class="foldbar" data-fold-navn="grundlag">x<\/div><!--\/fold-->/);
  assert.ok(!String(fold('grundlag', html`x`)).includes('data-fold-id'));
});
