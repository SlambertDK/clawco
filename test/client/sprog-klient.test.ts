// KC-0170 slice 3, part A: the browser scripts speak English or Danish. public/koe.js and public/forbindelse.js read the
// page's table (window.KC_TEKST, the shell table's `klient` part) at call time and keep today's Danish words when there is
// none; public/app.js has no Danish literal left on the screen: every word goes through tk() and every key it asks for exists.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../public/koe.js';
import '../../public/forbindelse.js';
import { TEKSTER } from '../../src/shell/tekster.ts';
import { PRODUKT } from '../../src/shell/navn.ts';
import { danskeLinjer } from '../fixtures/sprog-tjek.ts';

type Raekke = { status: string; startedAt: number; begyndt?: number | null };
const g = globalThis as unknown as { KCKoe: { modelNavn(id: string): string; status(r: Raekke, nu: number): string }; KCForbindelse: { fejlTekst(e: unknown): string; ingenForbindelse(): string }; KC_TEKST?: unknown; document?: unknown };
const named = (name: string, message: string) => Object.assign(new Error(message), { name });
function medTabel<T>(klient: Record<string, string> | undefined, fn: () => T, produkt = ''): T {
  if (klient) g.KC_TEKST = klient;
  g.document = { querySelector: (s: string) => (s === 'meta[name="application-name"]' && produkt ? { getAttribute: (a: string) => (a === 'content' ? produkt : null) } : null) };
  try { return fn(); } finally { delete g.KC_TEKST; delete g.document; }
}
const en = TEKSTER.en.klient as unknown as Record<string, string>;
const da = TEKSTER.da.klient as unknown as Record<string, string>;
const MIN = 60_000;

test('koe.js: the model names and the status words follow the page\'s table; the Danish table says what the fallback says', () => {
  const alle = (): string[] => [
    g.KCKoe.modelNavn('claude-haiku-5.5'), g.KCKoe.modelNavn('claude-sonnet-5.5'), g.KCKoe.modelNavn('claude-opus-5.5'), g.KCKoe.modelNavn(''),
    g.KCKoe.status({ status: 'queued', startedAt: 0 }, 5000), g.KCKoe.status({ status: 'done', startedAt: 0 }, 5000), g.KCKoe.status({ status: 'failed', startedAt: 0 }, 5000),
    g.KCKoe.status({ status: 'running', startedAt: 0 }, 30_000), g.KCKoe.status({ status: 'running', startedAt: 0 }, 2 * MIN),
    g.KCKoe.status({ status: 'running', startedAt: 0 }, 60 * MIN), g.KCKoe.status({ status: 'running', startedAt: 0 }, 120 * MIN), g.KCKoe.status({ status: 'running', startedAt: 0, begyndt: 3 * MIN }, 5 * MIN),
  ];
  const dansk = ['Haiku 5.5 — hurtig', 'Sonnet 5.5', 'Opus 5.5 — grundig', "Hermes' standard", 'i kø', 'klar', 'mislykkedes', 'lige startet', 'startet for 2 min siden', 'startet for 1 time siden', 'startet for 2 timer siden', 'startet for 2 min siden'];
  assert.deepEqual(alle(), dansk, 'no table: today\'s words');
  assert.deepEqual(medTabel(da, alle), dansk, 'the Danish table');
  const engelsk = medTabel(en, alle);
  assert.deepEqual(engelsk, ['Haiku 5.5 — fast', 'Sonnet 5.5', 'Opus 5.5 — thorough', "Hermes' default", 'queued', 'done', 'failed', 'just started', 'started 2 min ago', 'started 1 hour ago', 'started 2 hours ago', 'started 2 min ago']);
  for (const l of engelsk) assert.deepEqual(danskeLinjer(l), [], l);
});

test('forbindelse.js: what a failed request says follows the table; the product name still comes from the page', () => {
  const alle = (produkt: string): string[] => [
    g.KCForbindelse.ingenForbindelse(), g.KCForbindelse.fejlTekst(named('TypeError', 'x')), g.KCForbindelse.fejlTekst(new Error('HTTP 502')), g.KCForbindelse.fejlTekst(named('SyntaxError', 'x')),
    g.KCForbindelse.fejlTekst(named('NotAllowedError', 'x')), g.KCForbindelse.fejlTekst(named('NotFoundError', 'x')), g.KCForbindelse.fejlTekst(new Error('')), g.KCForbindelse.fejlTekst(new Error('Server says no')),
  ].map((s) => (produkt ? s : s));
  assert.deepEqual(alle(''), ['Ingen forbindelse', 'Ingen forbindelse', 'Serveren svarer ikke lige nu', 'Serveren svarer ikke lige nu', 'du har ikke givet lov', 'ingen mikrofon fundet', 'Noget gik galt', 'Server says no']);
  assert.deepEqual(medTabel(da, () => alle(''), ''), alle(''));
  assert.deepEqual(medTabel(da, () => alle(PRODUKT), PRODUKT), [`Ingen forbindelse til ${PRODUKT}`, `Ingen forbindelse til ${PRODUKT}`, `${PRODUKT} svarer ikke lige nu`, `${PRODUKT} svarer ikke lige nu`, 'du har ikke givet lov', 'ingen mikrofon fundet', 'Noget gik galt', 'Server says no']);
  const e1 = medTabel(en, () => alle(''), '');
  assert.deepEqual(e1, ['No connection', 'No connection', 'The server is not answering right now', 'The server is not answering right now', 'you have not given permission', 'no microphone found', 'Something went wrong', 'Server says no']);
  assert.deepEqual(medTabel(en, () => alle(PRODUKT), PRODUKT).slice(0, 4), [`No connection to ${PRODUKT}`, `No connection to ${PRODUKT}`, `${PRODUKT} is not answering right now`, `${PRODUKT} is not answering right now`]);
  for (const l of e1) assert.deepEqual(danskeLinjer(l), [], l);
});

// ---- public/app.js: no Danish literal on the screen ----

const rod = path.dirname(fileURLToPath(import.meta.url));
const app = readFileSync(path.join(rod, '../../public/app.js'), 'utf8').split('\n');

/** Danish letters and Danish words that are no English words: broader than the shared detector, for literals in code. */
const DANSK_ORD = /[æøåÆØÅ]|\b(?:og|ikke|eller|til|med|jeg|har|dit|din|det|der|ingen|hvad|vil|hvorfor|kunne|virker|fejlede|forbindelsen|fortryder|henter|sender|svarer|bygger|rummet|lytter|starter|slut|taler|skriver|tryk|igen|noget|mikrofonen|Fjern|Frakobl|Kopieret|Fortrudt|Noteret|Sendt|Sat|Mødet|Hvorfor|Hvad|Jeg|Kortet|Handlingen|Filen|Samtale|Lyd|Læs|Lyt|Tal|Intet|Spørgsmålet|Stemme|Oplæsning|Regnskabet|Regnskabslinjen|Svaret|Nej|Det|Ingen|Mikrofonen|Kunne)\b/;
/** The string literals of a line of code (single or double quoted), the comment after `//` cut off. */
function literaler(linje: string): string[] {
  const kode = linje.replace(/\/\/.*$/, '').replace(/\btk\('[A-Za-z0-9]+'\)/g, 'tk()');
  return [...kode.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1] ?? m[2] ?? '');
}
/** What the voice agent (a Danish agent, defined in code) is told: Danish on purpose, marked `// agent` on the line. */
const tilAgent = (linje: string): boolean => /\/\/ agent\b/.test(linje);

test('app.js: no Danish literal reaches the screen — every word goes through tk(), except what is said to the Danish voice agent', () => {
  const fund: string[] = [];
  app.forEach((linje, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(linje) || tilAgent(linje)) return;
    for (const l of literaler(linje)) if (DANSK_ORD.test(l)) fund.push(`${i + 1}: ${l.slice(0, 70)}`);
  });
  assert.deepEqual(fund, []);
});

test('app.js: what the status pill, the toasts and the buttons get is never a bare literal of words (states and speakers excepted)', () => {
  const sink = /(?:setStatus|samSay|setBusy|samLine|toast)\(([^)]*)\)|(?:textContent|title)\s*=\s*('[^']*')/;
  // States, speakers, an SDK mode value, and selectors and attribute names (code, not words).
  const STATE = /^(ok|busy|bad|user|ai|app|hermes|speaking)$|^[.#]|^data-/;
  const fund = app.flatMap((linje, i) => {
    if (/^\s*\/\//.test(linje) || tilAgent(linje)) return [];
    const kode = linje.replace(/\/\/.*$/, '').replace(/\btk\('[A-Za-z0-9]+'\)/g, 'tk()');
    const m = sink.exec(kode);
    const arg = m?.[1] ?? m?.[2] ?? '';
    return literaler(arg).filter((l) => /[A-Za-zæøå]{2}/.test(l) && !STATE.test(l)).map((l) => `${i + 1}: ${l}`);
  });
  assert.deepEqual(fund, []);
});

test('app.js: every tk() key exists in the Danish and the English table, and the Danish agent lines are few', () => {
  const noegler = new Set(app.flatMap((l) => [...l.matchAll(/\btk\('([A-Za-z0-9]+)'\)/g)].map((m) => m[1]!)));
  assert.ok(noegler.size > 60, String(noegler.size));
  for (const k of noegler) {
    assert.equal(typeof da[k], 'string', `da.${k}`);
    assert.equal(typeof en[k], 'string', `en.${k}`);
  }
  assert.ok(app.filter(tilAgent).length <= 12, 'only what the voice agent is told stays Danish');
});

test('the keys of the klient table that koe.js and forbindelse.js read exist in both languages', () => {
  const kilde = ['koe.js', 'forbindelse.js'].map((f) => readFileSync(path.join(rod, '../../public', f), 'utf8')).join('\n');
  const noegler = new Set([...kilde.matchAll(/\bt\('([A-Za-z0-9]+)'/g)].map((m) => m[1]!));
  assert.ok(noegler.size >= 14, String(noegler.size));
  for (const k of noegler) { assert.equal(typeof da[k], 'string', `da.${k}`); assert.equal(typeof en[k], 'string', `en.${k}`); }
});
