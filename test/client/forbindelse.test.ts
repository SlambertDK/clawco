// KC-0072: when the connection to the app is lost (Tailscale down, a deploy restarting
// the service) Henrik reads one calm Danish sentence — never "Failed to fetch" or a JSON parse error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../public/forbindelse.js';
import { PRODUKT } from '../../src/shell/navn.ts';

type Forbindelse = { fejlTekst(err: unknown): string; erNetfejl(err: unknown): boolean; ingenForbindelse(): string; VENT_FOER_BAAND: number };
const KC = (globalThis as unknown as { KCForbindelse: Forbindelse }).KCForbindelse;
const named = (name: string, message: string) => Object.assign(new Error(message), { name });

// KC-0121: the name comes from the page (<meta name="application-name">, written by the layout from
// PRODUKT), so no browser script spells it. A page without the meta still reads a calm sentence.
const g = globalThis as unknown as { document?: unknown };
function medSide<T>(fn: () => T): T {
  g.document = { querySelector: (s: string) => (s === 'meta[name="application-name"]' ? { getAttribute: (a: string) => (a === 'content' ? PRODUKT : null) } : null) };
  try { return fn(); } finally { delete g.document; }
}

test('KC-0121: the lost-connection sentence names the product from the page, and has a nameless fallback', () => {
  assert.equal(medSide(() => KC.ingenForbindelse()), `Ingen forbindelse til ${PRODUKT}`);
  assert.equal(KC.ingenForbindelse(), 'Ingen forbindelse');
  assert.equal(KC.fejlTekst(new Error('HTTP 502')), 'Serveren svarer ikke lige nu');
});

test('a fetch that never reached the server is "no connection", in every browser\'s wording', () => {
  for (const m of ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.']) {
    assert.equal(medSide(() => KC.fejlTekst(new TypeError(m))), `Ingen forbindelse til ${PRODUKT}`, m);
    assert.equal(KC.erNetfejl(new TypeError(m)), true, m);
  }
});

test('an HTML error page where JSON was expected (502 from Tailscale Serve) means the service is not answering', () => {
  const e = new SyntaxError('Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON');
  assert.equal(medSide(() => KC.fejlTekst(e)), `${PRODUKT} svarer ikke lige nu`);
  assert.equal(KC.erNetfejl(e), true);
});

test('a 5xx without a message from the server means the service is not answering', () => {
  assert.equal(medSide(() => KC.fejlTekst(new Error('HTTP 502'))), `${PRODUKT} svarer ikke lige nu`);
  assert.equal(medSide(() => KC.fejlTekst(new Error('HTTP 503'))), `${PRODUKT} svarer ikke lige nu`);
});

test('the server\'s own Danish error text is kept as it is', () => {
  assert.equal(KC.fejlTekst(new Error('Handlingen findes ikke længere')), 'Handlingen findes ikke længere');
  assert.equal(KC.erNetfejl(new Error('Handlingen findes ikke længere')), false);
});

test('the browser\'s English permission errors become Danish', () => {
  assert.equal(KC.fejlTekst(named('NotAllowedError', 'Permission denied')), 'du har ikke givet lov');
  assert.equal(KC.fejlTekst(named('NotFoundError', 'Requested device not found')), 'ingen mikrofon fundet');
});

test('nothing usable gives a plain fallback, never "undefined"', () => {
  assert.equal(KC.fejlTekst(undefined), 'Noget gik galt');
  assert.equal(KC.fejlTekst(new Error('')), 'Noget gik galt');
});

test('a short drop (a reconnect) does not flash the band', () => {
  assert.ok(KC.VENT_FOER_BAAND >= 2000 && KC.VENT_FOER_BAAND <= 6000, String(KC.VENT_FOER_BAAND));
});

test('the band is styled: fixed on top of the room, calm (no red), and hidden really hides it', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../../public/app.css', import.meta.url), 'utf8');
  const regel = /\.forbindelse-baand\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(regel, /position:\s*fixed/);
  assert.doesNotMatch(regel, /graense/);
  assert.match(css, /(^|\n)\[hidden\]\s*\{\s*display:\s*none/, 'hidden wins everywhere (KC-0076)');
});
