import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseUniversSvar, parseForberedelse, parseNytUnivers, htmlTilTekst, deltagereFraTekst,
  normaliserUnivers, normaliserIndeks, tomtUnivers, tomtIndeks,
} from '../../src/rooms/univers/schema.ts';
import { SchemaError } from '../../src/rooms/dagen/schema.ts';

test('parseUniversSvar accepts documents, notes and tasks and fills defaults', () => {
  const r = parseUniversSvar({ elementer: [
    { type: 'dokument', titel: 'Pitch', html: '<section>Hej</section>' },
    { type: 'note', id: 'note-abc12345', titel: 'Tanker', tekst: 'Husk X' },
    { type: 'opgave', titel: 'Ring til Tom', note: 'før fredag' },
    { type: 'opgave', id: 'opg-1', titel: 'Klar', status: 'faerdig' },
  ] });
  assert.equal(r.length, 4);
  assert.deepEqual(r[0], { type: 'dokument', titel: 'Pitch', html: '<section>Hej</section>', zone: 'privat' });
  assert.equal(r[1]?.type === 'note' && r[1].id, 'note-abc12345');
  assert.equal(r[2]?.type === 'opgave' && r[2].status, undefined);
  assert.equal(r[3]?.type === 'opgave' && r[3].status, 'faerdig');
});

test('parseUniversSvar skips unusable elements, drops bad ids and rejects an answer with none usable', () => {
  const r = parseUniversSvar({ elementer: [
    { type: 'dokument', titel: '', html: '<p>x</p>' },
    { type: 'ukendt', titel: 'x' },
    { type: 'note', id: '../../etc', titel: 'N', tekst: 't' },
    { type: 'opgave', titel: 'O', status: 'tosset' },
    'streng',
  ] });
  assert.equal(r.length, 2);
  assert.equal(r[0]?.type === 'note' && 'id' in r[0], false);
  assert.equal(r[1]?.type === 'opgave' && r[1].status, undefined);
  assert.throws(() => parseUniversSvar({ elementer: [] }), SchemaError);
  assert.throws(() => parseUniversSvar({ elementer: [{ type: 'note', titel: '' }] }), SchemaError);
  assert.throws(() => parseUniversSvar('nej'), SchemaError);
  assert.throws(() => parseUniversSvar({}), SchemaError);
});

test('parseUniversSvar bounds lengths and the number of elements', () => {
  const stor = 'x'.repeat(300_000);
  const r = parseUniversSvar({ elementer: [{ type: 'dokument', titel: 'T'.repeat(500), html: stor }] });
  assert.ok((r[0]?.type === 'dokument' ? r[0].html.length : 0) <= 200_000);
  assert.ok((r[0]?.titel.length ?? 0) <= 200);
  const mange = Array.from({ length: 80 }, (_, i) => ({ type: 'opgave', titel: `O${i}` }));
  assert.ok(parseUniversSvar({ elementer: mange }).length <= 30);
});

test('parseForberedelse validates the preparation and keeps optional parts', () => {
  const r = parseForberedelse({ forberedelse: {
    maal: 'Få rollen afklaret',
    deltagere: [{ navn: 'Jonas Holm', hvem: 'Chef', baggrund: 'Kom fra Ørsted', vil: 'Trygge leverancen' }, { navn: '', hvem: 'x' }],
    talepunkter: ['Først dette', '', 'Så dette'],
    opgaver: [{ titel: 'Find tal', note: 'fra Q3' }, { titel: '' }],
    praesentation: { titel: 'Arena-pitch', html: '<section>1</section>' },
  } });
  assert.equal(r.maal, 'Få rollen afklaret');
  assert.equal(r.deltagere.length, 1);
  assert.equal(r.deltagere[0]?.vil, 'Trygge leverancen');
  assert.deepEqual(r.talepunkter, ['Først dette', 'Så dette']);
  assert.deepEqual(r.opgaver, [{ titel: 'Find tal', note: 'fra Q3' }]);
  assert.equal(r.praesentation?.titel, 'Arena-pitch');
  const lille = parseForberedelse({ forberedelse: { maal: 'm', deltagere: [], talepunkter: ['a'] } });
  assert.deepEqual(lille.opgaver, []);
  assert.equal(lille.praesentation, undefined);
});

test('parseForberedelse parses talepunktIkoner in step with the kept talepunkter; an unknown icon becomes an empty slot', () => {
  const r = parseForberedelse({ forberedelse: {
    maal: 'm', deltagere: [],
    talepunkter: ['Først', '', 'Så', 'Til sidst'],
    talepunktIkoner: ['target', 'users', 'findes-ikke', 42],
  } });
  // the blank talepunkt is dropped together with its icon, so the icons stay on the right text
  assert.deepEqual(r.talepunkter, ['Først', 'Så', 'Til sidst']);
  assert.deepEqual(r.talepunktIkoner, ['target', undefined, undefined]);
  const kort = parseForberedelse({ forberedelse: { maal: 'm', deltagere: [], talepunkter: ['a', 'b'], talepunktIkoner: ['users'] } });
  assert.deepEqual(kort.talepunktIkoner, ['users', undefined]);
});

test('parseForberedelse drops talepunktIkoner that is not an array, or has no valid icon at all', () => {
  const base = { maal: 'm', deltagere: [], talepunkter: ['a'] };
  assert.equal(parseForberedelse({ forberedelse: { ...base, talepunktIkoner: 'target' } }).talepunktIkoner, undefined);
  assert.equal(parseForberedelse({ forberedelse: { ...base, talepunktIkoner: ['nope'] } }).talepunktIkoner, undefined);
  assert.equal(parseForberedelse({ forberedelse: base }).talepunktIkoner, undefined);
  assert.ok(!('talepunktIkoner' in parseForberedelse({ forberedelse: base })));
});

test('parseForberedelse rejects answers without goal or talking points', () => {
  assert.throws(() => parseForberedelse({}), SchemaError);
  assert.throws(() => parseForberedelse({ forberedelse: { maal: '', deltagere: [], talepunkter: ['a'] } }), SchemaError);
  assert.throws(() => parseForberedelse({ forberedelse: { maal: 'm', deltagere: [], talepunkter: [] } }), SchemaError);
});

test('parseNytUnivers needs a name and clips the description', () => {
  assert.deepEqual(parseNytUnivers({ nytUnivers: { navn: ' Min arena ', om: 'Lederrollen' } }), { navn: 'Min arena', om: 'Lederrollen' });
  assert.throws(() => parseNytUnivers({ nytUnivers: { navn: '', om: 'x' } }), SchemaError);
  assert.throws(() => parseNytUnivers({}), SchemaError);
  assert.ok(parseNytUnivers({ nytUnivers: { navn: 'n', om: 'o'.repeat(5000) } }).om.length <= 400);
});

test('htmlTilTekst strips tags, scripts, styles and entities, and is bounded', () => {
  const t = htmlTilTekst('<style>p{color:red}</style><section><h1>Titel</h1><p>Hej &amp; farvel</p><script>alert(1)</script></section><!-- skjult -->');
  assert.ok(!/[<>]/.test(t));
  assert.ok(!t.includes('alert'));
  assert.ok(!t.includes('color'));
  assert.ok(!t.includes('skjult'));
  assert.match(t, /Titel/);
  assert.match(t, /Hej & farvel/);
  assert.ok(htmlTilTekst('<p>' + 'a'.repeat(100_000) + '</p>', 500).length <= 500);
});

test('deltagereFraTekst splits free text into names and optional emails', () => {
  assert.deepEqual(deltagereFraTekst('Jonas Holm, Anne <anne@x.example>\nmette@y.example; '), [
    { navn: 'Jonas Holm' }, { navn: 'Anne', email: 'anne@x.example' }, { navn: 'mette', email: 'mette@y.example' },
  ]);
  assert.deepEqual(deltagereFraTekst('  '), []);
});

test('normalising fills missing arrays so older or partial state never crashes readers', () => {
  assert.deepEqual(normaliserUnivers(null), tomtUnivers());
  assert.deepEqual(normaliserUnivers({ dokumenter: 'x' }), tomtUnivers());
  assert.deepEqual(normaliserIndeks(null), tomtIndeks());
  assert.deepEqual(normaliserIndeks({ univers: [{ id: 'a', navn: 'A', om: '', oprettet: 't' }] }).nyeMoeder, []);
});

// KC-0242: the messages this room's answer parser sends back to Hermes follow the language of the run.
import { UNIVERS_PROMPT } from '../../src/rooms/univers/prompt-tekster.ts';
import { form, tomme, ensStrenge } from '../fixtures/sprog-tjek.ts';

test('KC-0242: the room has an English `fejl` table with exactly the Danish keys, no empty text and no Danish copy', () => {
  const { da, en } = { da: UNIVERS_PROMPT.da.fejl, en: UNIVERS_PROMPT.en.fejl };
  assert.ok(da && Object.keys(da).length > 0);
  assert.deepEqual(form(en), form(da));
  assert.deepEqual(tomme(en as never), []);
  assert.deepEqual(ensStrenge(da as never, en as never), []);
});
