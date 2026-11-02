// KC-0064: a state colour may only appear in selectors that mean that state.
// Parses public/app.css, so a colour cannot creep into a selector by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../../public/app.css', import.meta.url), 'utf8');
type Rule = { sel: string; body: string };
const RULES: Rule[] = [...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ sel: m[1]!.trim().replace(/\s+/g, ' '), body: m[2]! }))
  .filter((r) => !r.sel.startsWith(':root'));
const using = (token: string): Rule[] => RULES.filter((r) => r.body.includes(`var(${token}`));
const decl = (sel: string, prop: string): string | undefined => RULES.find((r) => r.sel === sel)?.body.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`))?.[1]?.trim();

test('no old token names remain', () => {
  assert.doesNotMatch(CSS, /--(pending|done|danger|action|accent-)/);
});

test('amber is only for kraever', () => {
  const ok = ['tilstand-kraever', '.count', '.pending', '.ny-prik', '.bl-over', '.nt-fyld', '.koe-status', '.kort-stor', '.is-ny', '.friskhed-gammel'];
  const bad = using('--kraever').filter((r) => !ok.some((o) => r.sel.includes(o))).map((r) => r.sel);
  assert.deepEqual(bad, [], `amber used outside kraever: ${bad.join(' | ')}`);
});

test('blue is only for what you press', () => {
  const klasser = ['btn', 'chip-btn', 'is-selected', 'focus', 'spoerg', 'tilstand-handling', 'fyldt', 'punkt', 'kontekst', 'mic', 'lyt', 'tile', 'rooms', 'samtale-btn', 'cc-projekt', 'chat-toggle', 'is-endret'];
  const element = /(^|[\s>+~,])(a|button|summary|input|textarea|select)(?![\w-])/;
  const bad = using('--handling').filter((r) => !klasser.some((k) => r.sel.includes(k)) && !element.test(r.sel)).map((r) => r.sel);
  assert.deepEqual(bad, [], `blue used on something you cannot press: ${bad.join(' | ')}`);
});

test('the sun zone, the nu line and the forslag bar are not amber', () => {
  for (const sel of ['.zone-sol', '.dl-nu', '.afsnit.has-forslag']) {
    const r = RULES.find((x) => x.sel === sel);
    assert.ok(r, `${sel} rule exists`);
    assert.doesNotMatch(r.body, /--kraever/, sel);
  }
});

test('one icon tile size per role: the headline tile, one smaller row size', () => {
  assert.equal(decl('.vis-ikon', 'width'), '56px');
  const smaa = ['.rum-ikon', '.kal-ikon', '.mail-faerdig .vis-ikon'].filter((s) => RULES.some((r) => r.sel === s)).map((s) => decl(s, 'width'));
  assert.ok(smaa.length >= 2);
  assert.deepEqual([...new Set(smaa)], ['32px']);
});

// KC-0064 phase 3: the new dot is kraever, the changed ring is the handling ring, and both stay (static) without motion.
test('the new dot is amber, the changed ring is the handling ring', () => {
  assert.ok(using('--kraever').some((r) => r.sel.includes('.is-ny')), '.is-ny dot uses --kraever');
  assert.ok(using('--handling-ring').some((r) => r.sel.includes('.is-endret')), '.is-endret uses --handling-ring');
});

test('reduced motion keeps the dot and the ring, without animation', () => {
  const blok = CSS.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(blok, /\.is-endret/);
  assert.match(blok, /\.is-ny|\.is-set/);
});
