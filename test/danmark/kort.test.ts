// KC-0233: the Nu card "Ny Digital Post" and Start's step. App-driven (no Hermes): a card exists only while the server says
// there is an unseen notice, it is gone once marked (not greyed), it holds ONE link (the viewer's fixed front page) and
// ONE button, and nothing a handling could run. Every text through the escaper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hjemEgne, kraeverIder, renderHjem, type HjemData } from '../../src/rooms/hjem/render.ts';
import { renderDigitalPostStart } from '../../src/rooms/start/digitalpost.ts';
import type { Person } from '../../src/identitet/husstand.ts';

const NOW = new Date('2026-11-02T10:00:00Z');
const henrik: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const data = (o: Partial<HjemData> = {}): HjemData => ({ hilsen: 'Goddag, Henrik', venter: [], hermes: [], now: NOW, person: henrik, ...o });
const side = (d: HjemData): string => String(renderHjem(d));
const A = 'post@notifikation.digitalpost.example';
const MIT = { navn: 'mit.dk', url: 'https://mit.dk/' };
const notits = (id: string, o: Partial<{ emne: string | null; modtaget: string }> = {}) => ({ id, modtaget: '2026-11-01T08:00:00.000Z', afsender: A, emne: null as string | null, ...o });
const visning = (n: ReturnType<typeof notits>[], viser = MIT): NonNullable<HjemData['digitalPost']> => ({ slags: 'notitser', notitser: n, viser });
/** The card's own markup: from its marker to the end of its article. */
const kortAf = (h: string): string => { const i = h.indexOf('data-post-kort'); return h.slice(h.lastIndexOf('<article', i), h.indexOf('</article>', i) + 10); };

test('nothing without a notice: no card, no group, no marker', () => {
  assert.doesNotMatch(side(data()), /data-post|Digital Post/);
});

test('one unseen notice: the sentence with sender and date, one link to the viewer, one button — and the standing line', () => {
  const k = kortAf(side(data({ digitalPost: visning([notits('<1@x.example>')]) })));
  assert.match(k, /Der er kommet ny Digital Post \(fra post@notifikation\.digitalpost\.example, 1\. november\)/);
  assert.match(k, /Clawco ser kun notifikationen: hverken brevet eller mailens tekst\./);
  assert.equal((k.match(/<a /g) ?? []).length, 1, 'one link and only one');
  assert.match(k, /<a class="btn btn-primary" href="https:\/\/mit\.dk\/" target="_blank" rel="noopener noreferrer" data-post-viser>Åbn mit\.dk<\/a>/);
  assert.match(k, /<button type="button" class="btn" data-post-set="&lt;1@x\.example&gt;">Set den<\/button>/);
  assert.equal((k.match(/<button/g) ?? []).length, 1, 'Set den is the only button');
  assert.equal((k.match(/btn-primary/g) ?? []).length, 1);
  assert.match(k, /data-datazone="privat"/);
});

test('the chosen viewer decides the link and its label; nothing but the viewer\'s fixed address is ever linked', () => {
  const e = kortAf(side(data({ digitalPost: visning([notits('1')], { navn: 'e-Boks', url: 'https://www.e-boks.dk/' }) })));
  assert.match(e, /href="https:\/\/www\.e-boks\.dk\/"/);
  assert.match(e, />Åbn e-Boks</);
  const b = kortAf(side(data({ digitalPost: visning([notits('1')], { navn: 'borger.dk', url: 'https://www.borger.dk/' }) })));
  assert.match(b, /href="https:\/\/www\.borger\.dk\/"/);
});

test('the subject: shown short when it says more than "new post", left out when generic; markup and a link in it are text', () => {
  const med = kortAf(side(data({ digitalPost: visning([notits('1', { emne: 'Ny besked fra Fiktiv Kommune' })]) })));
  assert.match(med, /data-post-emne[^>]*>Ny besked fra Fiktiv Kommune</);
  assert.doesNotMatch(kortAf(side(data({ digitalPost: visning([notits('1', { emne: null })]) }))), /data-post-emne/);
  const ond = kortAf(side(data({ digitalPost: visning([notits('1', { emne: '<img src=x onerror=alert(1)> <a href="https://svindel.example">klik</a>' })]) })));
  assert.doesNotMatch(ond, /<img|<a href="https:\/\/svindel/);
  assert.match(ond, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal((ond.match(/<a /g) ?? []).length, 1, 'still only the viewer link');
  const a = kortAf(side(data({ digitalPost: visning([{ ...notits('1'), afsender: '<b>x</b>@y.example' }]) })));
  assert.doesNotMatch(a, /<b>x/);
});

test('the invariant: no handling, no instruction, nothing Hermes could run, no ask control', () => {
  for (const d of [visning([notits('1')]), visning([1, 2, 3, 4, 5].map((n) => notits(String(n)))), { slags: 'kan-ikke-se', viser: MIT } as const]) {
    const k = kortAf(side(data({ digitalPost: d })));
    assert.doesNotMatch(k, /data-handling|data-aktion|data-arg|data-instruktion|data-ask|data-kraever-ja|data-graense|data-fortryd|data-kladde|data-form|<form|<input|<textarea/);
    assert.match(k, /data-blok="kort"/);
  }
});

test('more than three: one card, "N nye breve", still one link; one button that marks them all', () => {
  const h = side(data({ digitalPost: visning([5, 4, 3, 2, 1].map((n) => notits(String(n), { modtaget: `2026-11-0${n}T08:00:00.000Z` }))) }));
  assert.equal((h.match(/data-post-kort/g) ?? []).length, 1);
  const k = kortAf(h);
  assert.match(k, /Der er kommet 5 nye breve i Digital Post \(seneste fra post@notifikation\.digitalpost\.example, 5\. november\)/);
  assert.equal((k.match(/<a /g) ?? []).length, 1);
  assert.match(k, /data-post-set-alle/);
  assert.equal((k.match(/<button/g) ?? []).length, 1);
});

test('up to three: one card each', () => {
  const h = side(data({ digitalPost: visning([1, 2, 3].map((n) => notits(String(n)))) }));
  assert.equal((h.match(/data-post-kort/g) ?? []).length, 3);
});

test('the mail cannot be read: "kan ikke se", never "ingen ny post"; the viewer link stays', () => {
  const k = kortAf(side(data({ digitalPost: { slags: 'kan-ikke-se', viser: MIT } })));
  assert.match(k, /Clawco kan ikke se, om der er ny Digital Post lige nu/);
  assert.match(k, /href="https:\/\/mit\.dk\/"/);
  assert.doesNotMatch(k, /[Ii]ngen ny|Ingen post|ingen nye/);
  assert.doesNotMatch(k, /data-post-set/);
});

test('the cards count in the band and the nav number and in the day count of what required the person; the card has its own group title', () => {
  const d = data({ digitalPost: visning([notits('1'), notits('2')]) });
  assert.equal(hjemEgne(d), 2);
  assert.equal(kraeverIder(d).length, 2);
  assert.match(side(d), /data-gruppe="Digital Post"/);
  assert.equal(hjemEgne(data()), 0);
});

test('only the owner sees them: a member gets nothing even if the server passed the data (zone privat)', () => {
  const maja: Person = { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' };
  assert.doesNotMatch(side(data({ person: maja, digitalPost: visning([notits('1')]) })), /data-post|Digital Post/);
  assert.equal(hjemEgne(data({ person: maja, digitalPost: visning([notits('1')]) })), 0);
});

// ---------- Start's step ----------

const start = (o: Partial<Parameters<typeof renderDigitalPostStart>[0]> = {}): string => String(renderDigitalPostStart({
  kandidater: [A], laeser: 'ok', viser: 'mit.dk', visere: [{ id: 'mit.dk', navn: 'mit.dk' }, { id: 'e-boks', navn: 'e-Boks' }, { id: 'borger.dk', navn: 'borger.dk' }],
  domaener: ['digitalpost.dk', 'e-boks.dk', 'mit.dk', 'borger.dk'], kanGemme: true, ...o,
}));

test('Start: the three plain steps, the candidates as addresses only, a free field, the viewer choice, the standing sentence', () => {
  const h = start();
  assert.match(h, /data-post-start/);
  assert.match(h, /Notifikation på e-mail/);
  assert.match(h, /Giv den e-mailadresse, som Clawco læser/);
  assert.match(h, /type="radio" name="afsender" value="post@notifikation\.digitalpost\.example"/);
  assert.match(h, /name="egen"/);
  for (const v of ['mit.dk', 'e-boks', 'borger.dk']) assert.match(h, new RegExp(`type="radio" name="viser" value="${v}"`));
  assert.match(h, /<input type="radio" name="viser" value="mit\.dk" checked>/);
  assert.match(h, /Clawco ser kun notifikationen: hverken brevet eller mailens tekst\./);
  assert.match(h, /data-aktion="post-afsender-gem" data-form="post-form"/);
  assert.match(h, /data-aktion="post-ikke-nu"/);
});

test('Start: no candidate yet — the step says so in plain words (no subjects are ever shown)', () => {
  const h = start({ kandidater: [] });
  assert.doesNotMatch(h, /name="afsender"/);
  assert.match(h, /Clawco har ikke set nogen notifikationsmail endnu/);
  assert.match(h, /name="egen"/);
});

test('Start: the inbox cannot be read — it says so and the free field still works', () => {
  const h = start({ kandidater: [], laeser: 'kan-ikke-se' });
  assert.match(h, /Clawco kan ikke se din indbakke lige nu/);
  assert.match(h, /name="egen"/);
});

test('Start: a candidate address is escaped; a non-owner sees the step read-only (no form)', () => {
  const h = start({ kandidater: ['<b>x</b>@mit.dk'] });
  assert.doesNotMatch(h, /<b>x<\/b>/);
  const m = start({ kanGemme: false });
  assert.doesNotMatch(m, /<form|<input|data-aktion/);
  assert.match(m, /Ejeren/);
});
