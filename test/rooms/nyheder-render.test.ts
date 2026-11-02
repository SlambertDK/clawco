import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderNyheder, renderNyhederEmpty } from '../../src/rooms/nyheder/render.ts';
import type { NyhederState } from '../../src/rooms/nyheder/schema.ts';
import type { LogEntry } from '../../src/store/types.ts';
import { dubletter, ider } from '../ider.ts';
import { baandDel, taelleTekst } from '../baand.ts';

const state: NyhederState = {
  dato: '2026-10-27', genereret: '2026-10-27T07:10:00Z',
  femLinjer: ['Linje <1>', 'L2', 'L3', 'L4', 'L5'],
  baner: [{ navn: 'AI og agenter', nyheder: [{ id: 'n1', titel: 'GPT-6.1 Terra', hvorfor: 'Relevant for Hermes.', kilde: 'Simon Willison', url: 'https://example.org/gpt' }, { id: 'n2', titel: 'Uden link', hvorfor: 'x' }] }],
  forslag: [{ id: 'f1', tekst: 'Skal jeg lave et testrum?', handling: { id: 'forslag-1-testrum', label: 'Ja, lav testrum', instruktion: 'i' } }],
  nyhedsbreve: [{ mailId: '7', emne: 'Ugens energinyt', fra: 'Eksempel Energi' }],
  kilder: { antal: 25, medNyheder: 9, nyheder: 39, fejlede: ['r/LocalLLaMA', 'r/OpenAI'] },
  gemt: ['n2'],
  hermesStatus: 'Følger AI-nyheder',
};

test('renderNyheder shows five lines, lanes with items as elements, links and Gem/Spørg per item', () => {
  const out = String(renderNyheder(state, [], new Date()));
  assert.match(out, /Linje &lt;1&gt;/);
  assert.match(out, /AI og agenter/);
  assert.match(out, /href="https:\/\/example\.org\/gpt"[^>]*rel="noopener"/);
  assert.match(out, /data-element="Nyheden: GPT-6\.1 Terra"/);
  assert.match(out, /data-aktion="gem"[^>]*data-arg="[^"]*n1/);
  assert.match(out, /data-ask="Nyheden: GPT-6\.1 Terra"/);
});

test('renderNyheder marks saved items, lists newsletters, source stats and the forslag button', () => {
  const out = String(renderNyheder(state, [], new Date()));
  assert.match(out, /Gemt/);
  assert.doesNotMatch(out, /data-aktion="gem"[^>]*data-arg="[^"]*n2/);
  assert.match(out, /Ugens energinyt/);
  assert.match(out, /9 af 25 kilder/);
  assert.match(out, /r\/LocalLLaMA/);
  assert.match(out, /data-handling="forslag-1-testrum"/);
});

test('renderNyhederEmpty offers the hent button', () => {
  assert.match(String(renderNyhederEmpty('Ingen avis endnu.')), /data-opdater="hent"/);
});

test('renderNyheder shows a forslag result in place of the button once Hermes has done it', () => {
  const out = String(renderNyheder(state, [{ id: 'l1', tid: '2026-10-27T08:00:00Z', kilde: 'hermes', tekst: 'Resumé: risiciene er …', handlingId: 'forslag-1-testrum', fortryd: 'x' }], new Date()));
  assert.match(out, /class="resultat"[^>]*>[\s\S]*Resumé: risiciene er …/);
  assert.doesNotMatch(out, /data-handling="forslag-1-testrum"/);
});

test('renderNyheder gives every lane a data-element so it can be marked', () => {
  assert.match(String(renderNyheder(state, [], new Date())), /data-element="Banen: AI og agenter"/);
});

test('renderNyheder shows relevans notes as labelled chips per item', () => {
  const s: NyhederState = { ...state, baner: [{ navn: 'X', nyheder: [{ id: 'n1', titel: 'T', hvorfor: 'h', relevans: [{ for: 'arbejde', note: 'Rammer reserverne.' }, { for: 'familie', note: 'Noras skole.' }] }] }] };
  const out = String(renderNyheder(s, [], new Date()));
  assert.match(out, /class="relevans"/);
  assert.match(out, /<span class="rel rel-arbejde"><b>Arbejde<\/b> Rammer reserverne\.<\/span>/);
  assert.match(out, /<b>Familien<\/b> Noras skole\./);
});

test('KC-0024: on the phone Nyheder keeps the five lines and the proposals; the lanes, newsletters and log fold', async () => {
  const { foldet, iFold } = await import('../foldet.ts');
  const out = String(renderNyheder(state, [], new Date()));
  for (const n of ['Banerne', 'ordnet (1)']) assert.ok(foldet(out).has(n), n);
  assert.ok(!foldet(out).has('Nyhedsbreve') && !foldet(out).has("Hermes' arbejde"), 'no folds of their own inside Ordnet');
  assert.ok(!iFold(out, 'I dag i fem linjer'));
});

// ---- KC-0064: one look per meaning ----
test('KC-0064: Gemt is the ordnet chip and every ask control is the spoerg look', () => {
  const out = String(renderNyheder(state, [], new Date()));
  assert.match(out, /class="chip tilstand-ordnet"><svg[^>]*>[\s\S]*?<\/svg>Gemt</);
  assert.doesNotMatch(out, /chip-done/);
  assert.doesNotMatch(out, /class="ask"/);
  assert.match(out, /class="btn btn-ghost spoerg" data-ask="I dag i fem linjer"/);
  assert.match(out, /class="btn btn-ghost spoerg" data-ask="Nyheden: GPT-6\.1 Terra"/);
  assert.match(out, /class="btn btn-ghost spoerg" data-ask="Nyhedsbrevet: Ugens energinyt"/);
});

// ---- KC-0064 phase 2: bands ----
test('KC-0064: Nyheder sorts into the bands', () => {
  const NU = new Date('2026-10-27T12:00:00Z');
  const med: NyhederState = {
    ...state,
    forslag: [
      { id: 'f1', tekst: 'Åbent forslag', handling: { id: 'h-f1', label: 'Ja', instruktion: 'i' } },
      { id: 'f2', tekst: 'Besvaret forslag', handling: { id: 'h-f2', label: 'Ja', instruktion: 'i' } },
      { id: 'f3', tekst: 'Svar i chatten' },
    ],
    nyhedsbreve: [{ mailId: '7', emne: 'Ugens energinyt', fra: 'Eksempel Energi' }, { mailId: '8', emne: 'Andet brev', fra: 'X' }],
  };
  const log: LogEntry[] = [{ id: 'l1', tid: '2026-10-27T11:00:00Z', kilde: 'hermes', tekst: 'Lavede testrum.', handlingId: 'h-f2' }];
  const out = String(renderNyheder(med, log, NU));
  assert.equal(taelleTekst(out), '2 venter på dig · 4 ordnet');
  const k = baandDel(out, 'kraever');
  assert.match(k, /Forslaget: Åbent forslag/);
  assert.match(k, /Forslaget: Svar i chatten/);
  assert.doesNotMatch(k, /Besvaret forslag/);
  assert.match(baandDel(out, 'ordnet'), /Besvaret forslag/);
  assert.match(baandDel(out, 'indhold'), /I dag i fem linjer/);
  assert.doesNotMatch(out, /kort-stor/);
});

test('KC-0064 phase 3: Nyheder forslag, nyhedsbreve and log rows carry their stable id', () => {
  const log: LogEntry[] = [{ id: 'l-5', tid: '2026-10-27T07:05:00.000Z', kilde: 'hermes', tekst: 'Byggede Nyheder.' }];
  const out = String(renderNyheder(state, log, new Date('2026-10-27T08:00:00Z')));
  for (const id of ['nyheder-forslag:f1', 'nyhedsbrev:7', 'log:l-5']) assert.ok(out.includes(`data-id="${id}"`), id);
});

test('KC-0064 phase 3: Nyheder items are keyed by url or title, never by position, and unique per room', () => {
  const ud = String(renderNyheder(state, [], new Date()));
  assert.ok(ider(ud).includes('nyhed:https://example.org/gpt'));
  assert.ok(ider(ud).includes('nyhed:Uden link'));
  assert.ok(!ider(ud).some((i) => /^nyhed:n\d/.test(i)));
  assert.deepEqual(ider(String(renderNyheder(state, [], new Date()))), ider(ud));
  const dobbelt: NyhederState = { ...state, baner: [...state.baner, { navn: 'Energi', nyheder: [{ id: 'n9', titel: 'Samme historie', hvorfor: 'x', url: 'https://example.org/gpt' }] }] };
  const d = String(renderNyheder(dobbelt, [], new Date()));
  assert.deepEqual(ider(d).filter((i) => i.startsWith('nyhed:https://example.org/gpt')), ['nyhed:https://example.org/gpt', 'nyhed:https://example.org/gpt#2']);
  assert.deepEqual(dubletter(d), []);
});

test('KC-0102: Nyheder shows Del next to Spørg only for an item with a url', () => {
  const ud = String(renderNyheder(state, [], new Date()));
  assert.match(ud, /data-del-titel="GPT-6\.1 Terra" data-del-url="https:\/\/example\.org\/gpt"/);
  assert.equal((ud.match(/data-del-url=/g) ?? []).length, 1); // "Uden link" has none
  const farlig: NyhederState = { ...state, baner: [{ navn: 'x', nyheder: [{ id: 'z', titel: 'A "B" <i>', hvorfor: 'x', url: 'https://example.org/?a=1&b="2"' }] }] };
  const f = String(renderNyheder(farlig, [], new Date()));
  assert.match(f, /data-del-titel="A &quot;B&quot; &lt;i&gt;"/);
  assert.match(f, /data-del-url="https:\/\/example\.org\/\?a=1&amp;b=&quot;2&quot;"/);
});

test('KC-0078: Nyheder header shows freshness; older than today gets the warning tone; empty room has none', () => {
  const idag = String(renderNyheder(state, [], new Date('2026-10-27T09:00:00Z'))); // built 08.10 CET
  assert.match(idag, /nyheder[^<]*<span class="friskhed">opdateret 08\.10<\/span>/);
  assert.match(idag, /<span class="friskhed">opdateret 08\.10<\/span>/);
  const gammel = String(renderNyheder(state, [], new Date('2026-10-29T09:00:00Z')));
  assert.match(gammel, /<span class="friskhed friskhed-gammel">fra tirsdag 08\.10<\/span>/i);
  assert.doesNotMatch(String(renderNyhederEmpty('x')), /friskhed/);
});
