// KC-0064: the block catalog's states and helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tilstandFraTone, tilstandChip, spoerg, delKnap, knap, handlinger, taellelinje, antal, baand, igangGruppe, medId, unikIder, type Baand } from '../../src/shell/sprog.ts';
import { html } from '../../src/shell/html.ts';
import { foldet } from '../foldet.ts';
import { baandDel, taelleTekst } from '../baand.ts';

test('tilstandFraTone maps adv→kraever, god→ordnet, rolig→rolig, undefined→rolig', () => {
  assert.equal(tilstandFraTone('adv'), 'kraever');
  assert.equal(tilstandFraTone('god'), 'ordnet');
  assert.equal(tilstandFraTone('rolig'), 'rolig');
  assert.equal(tilstandFraTone(undefined), 'rolig');
});

test('tilstandChip ordnet has the class, a check pictogram and the text', () => {
  const s = String(tilstandChip('ordnet', 'Gjort'));
  assert.match(s, /class="chip tilstand-ordnet"/);
  assert.match(s, /<svg/);
  assert.match(s, /Gjort/);
});

test('tilstandChip kraever has no pictogram', () => {
  assert.doesNotMatch(String(tilstandChip('kraever', 'Frist 3. nov')), /<svg/);
});

test('spoerg renders the one ask look with the element and label', () => {
  const s = String(spoerg('Kortet: Elregning'));
  assert.match(s, /data-ask="Kortet: Elregning"/);
  assert.match(s, /class="btn btn-ghost spoerg"/);
  assert.match(s, /<span>Spørg<\/span>/);
  assert.match(String(spoerg('x', 'Ret')), /<span>Ret<\/span>/);
});

test('spoerg escapes the element text', () => {
  const s = String(spoerg('<b>'));
  assert.match(s, /data-ask="&lt;b&gt;"/);
  assert.doesNotMatch(s, /<b>/);
});

test('knap picks the class from slags', () => {
  assert.match(String(knap({ label: 'A', attrs: {}, slags: 'primaer' })), /class="btn btn-primary"/);
  assert.match(String(knap({ label: 'A', attrs: {}, slags: 'graense' })), /class="btn btn-graense"/);
  assert.match(String(knap({ label: 'A', attrs: {}, slags: 'ghost' })), /class="btn btn-ghost"/);
  assert.match(String(knap({ label: 'A', attrs: { 'data-x': '"1"' } })), /^<button type="button" class="btn" data-x="&quot;1&quot;">A<\/button>$/);
});

test('knap with href renders an anchor', () => {
  const s = String(knap({ label: 'Åbn', attrs: {}, href: '/rum/mail', slags: 'primaer' }));
  assert.match(s, /^<a class="btn btn-primary" href="\/rum\/mail">Åbn<\/a>$/);
});

test('handlinger renders nothing when empty', () => {
  assert.equal(String(handlinger(undefined, [])), '');
});

test('handlinger wraps the primary first, then the others', () => {
  const s = String(handlinger(knap({ label: 'P', attrs: {}, slags: 'primaer' }), [knap({ label: 'N', attrs: {} })]));
  assert.match(s, /^<div class="actions"><button[^>]*btn-primary[^>]*>P<\/button><button[^>]*>N<\/button><\/div>$/);
});

test('handlinger throws when a second primary is passed in andre', () => {
  assert.throws(() => handlinger(knap({ label: 'P', attrs: {}, slags: 'primaer' }), [knap({ label: 'Q', attrs: {}, slags: 'primaer' })]));
  assert.throws(() => handlinger(undefined, [knap({ label: 'Q', attrs: {}, slags: 'primaer' })]));
});

const gr = (titel: string, ...e: string[]) => ({ titel, form: 'kort' as const, elementer: e.map((x) => ({ id: `t:${x}`, html: html`<i>${x}</i>` })) });
const ORDEN: Baand = {
  kraever: [gr('K', 'k1', 'k2')],
  igang: [gr('I', 'i1')],
  ordnet: [gr('O', 'o1', 'o2', 'o3')],
};

test('KC-0064: taellelinje omits zero parts', () => {
  assert.equal(taelleTekst(String(taellelinje({ kraever: 2, igang: 1, ordnet: 38 }))), '2 venter på dig · 1 i gang · 38 ordnet');
  assert.equal(taelleTekst(String(taellelinje({ kraever: 0, igang: 0, ordnet: 5 }))), 'Intet venter på dig · 5 ordnet');
  assert.equal(taelleTekst(String(taellelinje({ kraever: 0, igang: 0, ordnet: 0 }))), 'Intet venter på dig');
  assert.equal(taelleTekst(String(taellelinje({ kraever: 0, igang: 3, ordnet: 0 }))), 'Intet venter på dig · 3 i gang');
});

test('KC-0064: only a non-zero venter part is amber', () => {
  assert.match(String(taellelinje({ kraever: 1, igang: 0, ordnet: 0 })), /class="tilstand-kraever"/);
  assert.doesNotMatch(String(taellelinje({ kraever: 0, igang: 2, ordnet: 2 })), /tilstand-kraever/);
});

test('KC-0064: antal counts elements, not groups', () => {
  assert.deepEqual(antal({ kraever: [gr('a', '1', '2'), gr('b', '3')], igang: [gr('c', '4')], ordnet: [gr('d', '5', '6', '7'), gr('e')] }), { kraever: 3, igang: 1, ordnet: 3 });
});

test('KC-0064: baand keeps the fixed order', () => {
  const out = String(baand({ ...ORDEN, indhold: html`<em>INDHOLD</em>` }));
  const at = (s: string) => out.indexOf(s);
  assert.ok(at('class="taellelinje"') >= 0 && at('class="taellelinje"') < at('data-baand="kraever"'));
  assert.ok(at('data-baand="kraever"') < at('INDHOLD'));
  assert.ok(at('INDHOLD') < at('data-baand="igang"'));
  assert.ok(at('data-baand="igang"') < at('data-baand="ordnet"'));
});

test('KC-0064: empty bands render nothing', () => {
  const tom = String(baand({ kraever: [], igang: [], ordnet: [] }));
  assert.doesNotMatch(tom, /data-baand|baand-titel/);
  assert.equal(taelleTekst(tom), 'Intet venter på dig');
  const out = String(baand({ kraever: [gr('Fuld', 'x'), gr('Tom')], igang: [], ordnet: [] }));
  assert.match(out, /data-gruppe="Fuld"/);
  assert.doesNotMatch(out, /data-gruppe="Tom"/);
});

test('KC-0064: the count line comes from the rendered arrays', () => {
  assert.equal(taelleTekst(String(baand(ORDEN))), taelleTekst(String(taellelinje(antal(ORDEN)))));
  assert.equal(taelleTekst(String(baand(ORDEN))), '2 venter på dig · 1 i gang · 3 ordnet');
});

test('KC-0064: Ordnet is folded on every device', () => {
  const out = String(baand(ORDEN));
  assert.match(out, /class="baand baand-ordnet altid-foldet"/);
  assert.match(out, /data-fold-id="baand-ordnet"/);
  assert.ok(foldet(out).has('ordnet (3)'));
  assert.match(baandDel(out, 'ordnet'), /<i data-id="t:o3">o3<\/i>/);
});

test('KC-0064: a group folds after fold.efter', () => {
  const g = { ...gr('G', 'E1', 'E2', 'E3', 'E4', 'E5'), fold: { efter: 3, navn: 'alle 5' } };
  const out = String(baand({ kraever: [g], igang: [], ordnet: [] }));
  const f = foldet(out).get('alle 5') ?? '';
  assert.match(f, /E4/);
  assert.match(f, /E5/);
  assert.doesNotMatch(f, /E1/);
  assert.match(out, /E1/);
});

test('KC-0064: igangGruppe renders one row per run', () => {
  const g = igangGruppe([{ id: 'a', label: 'Mail: bygger rummet', status: 'running' }, { id: 'b', label: '<b>', status: 'queued' }]);
  const out = String(baand({ kraever: [], igang: [g], ordnet: [] }));
  assert.equal(out.match(/data-run=/g)?.length, 2);
  assert.match(out, /tilstand-rolig">I gang/);
  assert.match(out, /tilstand-rolig">I kø/);
  assert.match(out, /&lt;b&gt;/);
  assert.match(out, /Mail: bygger rummet/);
});

// ---- Phase 3: stable ids ---------------------------------------------------

test('medId stamps an escaped data-id right after the first tag name', () => {
  assert.equal(String(medId('kort:a"b', html`<div class="card">x</div>`)), '<div data-id="kort:a&quot;b" class="card">x</div>');
});

test('medId keeps leading whitespace and stamps the first tag', () => {
  assert.equal(String(medId('a', html`
  <section class="x"><p>y</p></section>`)), '\n  <section data-id="a" class="x"><p>y</p></section>');
});

test('medId throws for markup with no root tag and for a tag that already has an id', () => {
  assert.throws(() => medId('x', html`tekst`), /medId: markup starts with no tag/);
  assert.throws(() => medId('x', html`<div data-id="y"></div>`), /data-id/);
});

test('baand renders every element with its data-id, and antal still counts entries', () => {
  const b: Baand = { kraever: [{ titel: 'T', form: 'raekker', elementer: [{ id: 'a:1', html: html`<div class="row">r</div>` }] }], igang: [], ordnet: [] };
  assert.match(String(baand(b)), /<div data-id="a:1" class="row">r<\/div>/);
  assert.equal(antal(b).kraever, 1);
});

test('igangGruppe rows carry data-id run:<id>', () => {
  const out = String(baand({ kraever: [], igang: [igangGruppe([{ id: 'r1', label: 'L', status: 'running' }])], ordnet: [] }));
  assert.match(out, /data-id="run:r1"/);
});

// KC-0102: the one Del control for a news item that has a link.
test('delKnap renders the quiet Del button with title and url as escaped data attributes', () => {
  const s = String(delKnap('Nyheden: <b>"x"</b>', 'https://example.org/a?x=1&y="2"'));
  assert.match(s, /class="btn btn-ghost del"/);
  assert.match(s, /data-del-titel="Nyheden: &lt;b&gt;&quot;x&quot;&lt;\/b&gt;"/);
  assert.match(s, /data-del-url="https:\/\/example\.org\/a\?x=1&amp;y=&quot;2&quot;"/);
  assert.match(s, />Del<\/button>/);
  assert.doesNotMatch(s, /<b>/);
});

test('delKnap renders nothing without a url', () => {
  assert.equal(String(delKnap('Uden link', undefined)), '');
  assert.equal(String(delKnap('Uden link', '')), '');
});

test('unikIder keeps the first id and numbers repeats #2, #3 in render order', () => {
  const u = unikIder();
  assert.deepEqual(['a', 'b', 'a', 'a', 'b'].map(u), ['a', 'b', 'a#2', 'a#3', 'b#2']);
  assert.deepEqual(['a'].map(unikIder()), ['a']);
});
