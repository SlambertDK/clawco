// KC-0086: on a phone every tap target is at least 44 px tall (buttons also 44 wide).
// Parses public/app.css (and testtilstand.css for the test band): the rules must live in the phone
// media query (never at laptop level, which keeps its compact controls) and must be the LAST word on
// the component rules they override — a later same-specificity rule would silently win.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const strip = (f: string) => readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = strip('app.css');
const TEST_CSS = strip('testtilstand.css');
// Same condition as KC-0024's phone block, spelled the other way round so top-telefon.test.ts's block matcher keeps seeing only its own block.
const PHONE = '@media (pointer: coarse) and (max-width: 1139px)';

/** The bodies of every block opened by `head` in `css`, brace-matched, as {start, body}. */
function blocksOf(css: string, head: string): { start: number; body: string }[] {
  const out: { start: number; body: string }[] = [];
  for (let i = css.indexOf(head); i >= 0; i = css.indexOf(head, i + 1)) {
    let depth = 0;
    const open = css.indexOf('{', i);
    for (let j = open; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}' && --depth === 0) { out.push({ start: i, body: css.slice(open + 1, j) }); break; }
    }
  }
  return out;
}
const rules = (css: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim().replace(/\s+/g, ' '), body: m[2]! }));
const decl = (rs: ReturnType<typeof rules>, sel: string, prop: string) =>
  rs.filter((r) => r.sel.split(/,(?![^(]*\))/).map((x) => x.trim()).includes(sel)).map((r) => r.body.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`))?.[1]?.trim()).filter(Boolean).pop();
const px = (v: string | undefined) => parseInt(v ?? '0', 10);

const phoneBlocks = blocksOf(CSS, PHONE);
const phone = rules(phoneBlocks.map((b) => b.body).join('\n'));

// Every kind of control Henrik taps in Hjem, Dagen, Mail, Nyheder, Skrive and the chat sheet.
const TALL = [
  'button', '.btn', '.chip-btn', 'select', '.lyt', '.msg .lyt', '.actions-small .btn', '.vis-smaa .btn',
  '.vis-mere > summary', '#chat-form input', '.field input', '.cc-svar-form input', 'a.row-title',
];
const WIDE = ['button', '.btn', '.field.has-mic .mic-field', '.kladde .mic-field', '.chip-x'];

test('phone: every control kind has a min-height of at least 44 px', () => {
  for (const sel of TALL) assert.ok(px(decl(phone, sel, 'min-height')) >= 44, `${sel} min-height`);
});

test('phone: the room tab bar keeps its 48 px tabs (a.rooms uses --tabbar-h)', () => {
  assert.ok(px(CSS.match(/--tabbar-h:\s*([^;]+);/)?.[1]) >= 44);
  assert.equal(decl(phone, '.rooms a', 'min-height'), undefined, 'the tab bar rule is not overridden below 44');
});

test('phone: buttons and icon buttons are at least 44 px wide', () => {
  for (const sel of WIDE) assert.ok(px(decl(phone, sel, 'min-width')) >= 44, `${sel} min-width`);
});

test('phone: the chat context chip x and the mic keep a 44 px box', () => {
  assert.ok(px(decl(phone, '.chip-x', 'min-height')) >= 44 || px(decl(phone, 'button', 'min-height')) >= 44);
  for (const sel of ['.field.has-mic .mic-field', '.kladde .mic-field']) {
    assert.ok(px(decl(phone, sel, 'width')) >= 44 && px(decl(phone, sel, 'height')) >= 44, `${sel} box`);
  }
});

test('phone: the tap-target block comes after every component rule it overrides', () => {
  // The rules that set a smaller min-height at laptop level, keyed by selector, with their position.
  const last = Math.max(...phoneBlocks.map((b) => b.start));
  const tail = CSS.slice(last);
  for (const sel of ['.vis-smaa .btn', '.actions-small .btn', '.vis-mere > summary', '.msg .lyt']) {
    const laptop = CSS.lastIndexOf(`${sel} {`, last);
    assert.ok(laptop < last && tail.includes(sel), `${sel}: overridden after its laptop rule`);
  }
});

test('laptop: the compact controls stay (no 44 px min-height outside the phone query)', () => {
  let outside = CSS;
  for (const b of phoneBlocks) outside = outside.replace(b.body, '');
  for (const sel of ['.btn', '.lyt', '.btn-primary']) {
    assert.ok(px(decl(rules(outside), sel, 'min-height')) < 44, `${sel} stays compact at laptop level`);
  }
});

test('phone: the test band controls (Sluk, the moment select) are 44 px too', () => {
  const band = rules(blocksOf(TEST_CSS, '@media (pointer: coarse)').map((b) => b.body).join('\n'));
  for (const sel of ['.kc-test-sluk', '.kc-test-valg select']) assert.ok(px(decl(band, sel, 'min-height')) >= 44, sel);
});
