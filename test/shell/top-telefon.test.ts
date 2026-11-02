// KC-0075: on a phone the top of a room is ONE row (Hermes status left, Samtale + Kø right).
// Parses public/app.css: the rules must live in the phone media query (KC-0024), never at laptop level.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../../public/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const PHONE = '@media (max-width: 1139px) and (pointer: coarse)';

/** The bodies of every block opened by `head`, brace-matched, concatenated. */
function blocks(head: string): string {
  let out = '';
  for (let i = CSS.indexOf(head); i >= 0; i = CSS.indexOf(head, i + 1)) {
    let depth = 0;
    for (let j = CSS.indexOf('{', i); j < CSS.length; j++) {
      if (CSS[j] === '{') depth++;
      else if (CSS[j] === '}' && --depth === 0) { out += CSS.slice(CSS.indexOf('{', i) + 1, j); break; }
    }
  }
  return out;
}
const rules = (css: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim().replace(/\s+/g, ' '), body: m[2]! }));
const phone = rules(blocks(PHONE));
const decl = (rs: typeof phone, sel: string, prop: string) =>
  rs.filter((r) => r.sel.split(',').map((x) => x.trim()).includes(sel)).map((r) => r.body.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`))?.[1]?.trim()).filter(Boolean).pop();

test('phone: the breadcrumb is hidden (the room name is the headline, the nav marks the room)', () => {
  assert.equal(decl(phone, '.crumb', 'display'), 'none');
});

test('laptop: the breadcrumb stays', () => {
  const outside = rules(CSS.replace(blocks(PHONE), '')).filter((r) => r.sel.split(',').map((x) => x.trim()).includes('.crumb') && /display:\s*none/.test(r.body));
  assert.deepEqual(outside, []);
});

test('phone: the header never wraps and the status can shrink to an ellipsis', () => {
  assert.equal(decl(phone, '.top', 'flex-wrap'), 'nowrap');
  assert.equal(decl(phone, '.hermes', 'min-width'), '0');
  assert.equal(decl(phone, '#hermes-status', 'white-space'), 'nowrap');
  assert.equal(decl(phone, '#hermes-status', 'text-overflow'), 'ellipsis');
  assert.equal(decl(phone, '#hermes-status', 'overflow'), 'hidden');
  assert.equal(decl(phone, '.top-btns', 'flex-shrink'), '0');
});

test('phone: Samtale and Kø stay tap targets of at least 44 px', () => {
  for (const sel of ['.samtale-btn', '.koe-btn']) {
    assert.ok(parseInt(decl(phone, sel, 'min-height') ?? '0', 10) >= 44, `${sel} min-height`);
  }
});

test('KC-0115: on the phone there is no room nav and no room for a tab bar; the Rum list in the chat shows', () => {
  assert.equal(decl(phone, 'nav', 'display'), 'none');
  assert.equal(decl(phone, ':root', '--tabbar'), '0px');
  assert.equal(decl(phone, '.rum-liste', 'display'), 'block');
});

test('KC-0115: on the laptop the nav stays and the Rum list in the chat is hidden', () => {
  const outside = rules(CSS.replace(blocks(PHONE), ''));
  assert.deepEqual(outside.filter((r) => r.sel.split(',').map((x) => x.trim()).includes('nav') && /display:\s*none/.test(r.body)), []);
  assert.ok(outside.some((r) => r.sel.split(',').map((x) => x.trim()).includes('.rum-liste') && /display:\s*none/.test(r.body)));
});
