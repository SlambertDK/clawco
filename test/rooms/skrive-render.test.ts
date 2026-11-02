import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSkrive } from '../../src/rooms/skrive/render.ts';
import type { SkriveState } from '../../src/rooms/skrive/schema.ts';
import { dubletter, ider } from '../ider.ts';
import { baandDel, taelleTekst } from '../baand.ts';

const state: SkriveState = {
  dokumenter: [
    { id: 'dok-1', titel: 'Udkast til <driften>', brief: 'Kort mail', afsnit: [{ id: 'a1', tekst: 'Første afsnit.' }, { id: 'a2', tekst: 'Andet afsnit.' }], kilder: ['Eksempel Energi-rapport'], oprettet: '2026-10-27T10:00:00Z', aendret: '2026-10-27T10:05:00Z' },
    { id: 'dok-2', titel: 'Andet udkast', brief: 'x', afsnit: [{ id: 'a1', tekst: 'Y' }], kilder: [], oprettet: '2026-10-27T09:00:00Z', aendret: '2026-10-27T09:00:00Z', gemtSom: '/vault/00-Indbakke/2026-10-27 Andet udkast.md' },
  ],
  aktivt: 'dok-1',
  forslag: [{ id: 'f-1', dokId: 'dok-1', afsnitId: 'a2', ny: 'Andet afsnit, strammet.', hvorfor: 'Kortere og mere konkret.', tid: '2026-10-27T10:04:00Z' }],
  hermesStatus: 'Klar til at skrive',
};

test('renderSkrive shows the active document as paragraphs that are elements with per-paragraph proposal buttons', () => {
  const out = String(renderSkrive(state, [], new Date()));
  assert.match(out, /Udkast til &lt;driften&gt;/);
  assert.match(out, /data-element="Afsnit 2"/);
  assert.match(out, /data-aktion="forslag"[^>]*data-arg="[^"]*a2[^"]*stram/);
  assert.match(out, /Eksempel Energi-rapport/);
});

test('renderSkrive shows proposals with Brug and Afvis and marks the paragraph they touch', () => {
  const out = String(renderSkrive(state, [], new Date()));
  assert.match(out, /Andet afsnit, strammet\./);
  assert.match(out, /data-aktion="brug"[^>]*data-arg="[^"]*f-1/);
  assert.match(out, /data-aktion="afvis"[^>]*data-arg="[^"]*f-1/);
  assert.match(out, /class="afsnit has-forslag"[^>]*data-element="Afsnit 2"/);
});

test('renderSkrive lists the documents, lets Henrik switch, create, download and save to Obsidian', () => {
  const out = String(renderSkrive(state, [], new Date()));
  assert.match(out, /data-aktion="vaelg"[^>]*data-arg="[^"]*dok-2/);
  assert.match(out, /data-aktion="nyt"/);
  assert.match(out, /href="\/rum\/skrive\/dok\/dok-1\.md"/);
  assert.match(out, /data-aktion="gem"[^>]*data-arg="[^"]*dok-1/);
});

test('renderSkrive with no documents explains and offers Nyt udkast', () => {
  const out = String(renderSkrive({ dokumenter: [], aktivt: null, forslag: [], hermesStatus: 'Klar' }, [], new Date()));
  assert.match(out, /Ingen udkast endnu/);
  assert.match(out, /data-aktion="nyt"/);
});

test('KC-0024: on the phone Skrive keeps the text and the proposals; the change log folds', async () => {
  const { foldet, iFold } = await import('../foldet.ts');
  const log = [{ id: 'l1', tid: '2026-10-27T10:00:00Z', kilde: 'hermes' as const, tekst: 'Skrev udkastet.' }];
  const out = String(renderSkrive(state, log, new Date('2026-10-27T12:00:00Z')));
  assert.ok(foldet(out).has('ordnet (1)'));
  assert.ok(!iFold(out, 'afsnit-liste'));
  assert.ok(!iFold(out, "Hermes' forslag"));
});

// ---- KC-0064: one look per meaning ----
test('KC-0064: the open document chip is a choice (blue tilstand-handling), not a decorative accent', () => {
  const out = String(renderSkrive(state, [], new Date()));
  assert.match(out, /class="chip tilstand-handling">Udkast til &lt;driften&gt;</);
  assert.doesNotMatch(out, /chip-accent/);
});

// ---- KC-0064 phase 2: bands ----
const NU = new Date('2026-10-27T12:00:00Z');
test('KC-0064: Skrive sorts into the bands', () => {
  const med: SkriveState = { ...state, forslag: [...state.forslag, { id: 'f-2', dokId: 'dok-1', afsnitId: 'a1', ny: 'Første, strammet.', hvorfor: 'Kortere.', tid: '2026-10-27T10:06:00Z' }] };
  const log = [{ id: 'l1', tid: '2026-10-27T10:00:00Z', kilde: 'hermes' as const, tekst: 'Skrev udkastet.' }, { id: 'l2', tid: '2026-10-27T10:05:00Z', kilde: 'hermes' as const, tekst: 'Strammede.' }];
  const out = String(renderSkrive(med, log, NU));
  assert.equal(taelleTekst(out), '2 venter på dig · 2 ordnet');
  assert.match(baandDel(out, 'kraever'), /data-aktion="brug"/);
  assert.match(baandDel(out, 'indhold'), /data-afsnit/);
  assert.match(baandDel(out, 'indhold'), /id="nyt-form"/);
  assert.equal(out.match(/id="nyt-form"/g)?.length, 1);
});

test('KC-0064: no document, nothing waiting', () => {
  const tom: SkriveState = { dokumenter: [], forslag: [], hermesStatus: 'Klar' } as unknown as SkriveState;
  const out = String(renderSkrive(tom, [], NU));
  assert.equal(taelleTekst(out), 'Intet venter på dig');
  assert.equal(out.match(/id="nyt-form"/g)?.length, 1);
});

test('KC-0064 phase 3: Skrive forslag and log rows carry their stable id', () => {
  const log = [{ id: 'l-3', tid: '2026-10-27T10:05:00.000Z', kilde: 'hermes', tekst: 'Strammede afsnit 2.' }] as import('../../src/store/types.ts').LogEntry[];
  const out = String(renderSkrive(state, log, new Date('2026-10-27T11:00:00Z')));
  for (const id of ['forslag:f-1', 'log:l-3']) assert.ok(out.includes(`data-id="${id}"`), id);
});

test('KC-0064 phase 3: Skrive paragraphs are keyed by document and paragraph, unique per room', () => {
  const ud = String(renderSkrive(state, [], new Date()));
  for (const id of ['afsnit:dok-1:a1', 'afsnit:dok-1:a2', 'forslag:f-1']) assert.ok(ider(ud).includes(id), id);
  assert.deepEqual(dubletter(ud), []);
});

// ---- KC-0091: copy the whole text in one tap ----
test('KC-0091: the open document has a Kopiér button whose data-kopier decodes to the paragraphs joined by a blank line (no title, no sources)', () => {
  const afkod = (s: string): string => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const dok = { ...state.dokumenter[0]!, afsnit: [{ id: 'a1', tekst: 'Hej "Tom" & co' }, { id: 'a2', tekst: 'Linje 1\nLinje 2 <b>' }] };
  const out = String(renderSkrive({ ...state, dokumenter: [dok, state.dokumenter[1]!] }, [], new Date()));
  const m = [...out.matchAll(/<button type="button" class="btn" data-kopier="([^"]*)">Kopiér<\/button>/g)];
  assert.equal(m.length, 1);
  assert.equal(afkod(m[0]![1]!), 'Hej "Tom" & co\n\nLinje 1\nLinje 2 <b>');
});

test('KC-0091: no Kopiér when no document is open', () => {
  assert.doesNotMatch(String(renderSkrive({ dokumenter: [], aktivt: null, forslag: [], hermesStatus: 'Klar' }, [], new Date())), /data-kopier/);
});
