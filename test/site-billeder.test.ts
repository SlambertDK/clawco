import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { ALLE_MOMENTER } from '../src/testtilstand/indhold.ts';
import { momentSprog } from '../src/testtilstand/indhold/froe.ts';
import { webpMaal } from '../scripts/site-billeder/webp.ts';

// KC-0244: the screenshots on the front page of clawco.work show the interface in the language of the page. The English page
// shows English screens, the Danish page Danish ones (site.js swaps src, width and height with the same data-i-attr mechanism
// as the alt text); both sets are made by scripts/site-billeder.mjs from site/billeder/liste.json out of the test world, and
// nothing on the page says the screens are in Danish. The script itself needs a browser and a server, so it is run by hand
// (site/README.md); what is held here is everything that can silently drift: the list, the files, the table, the page.

const ROD = fileURLToPath(new URL('..', import.meta.url));
const SITE = path.join(ROD, 'site');
type Tabel = { en: Record<string, string>; da: Record<string, string> };
const ctx: { globalThis?: unknown; CLAWCO_TEXT?: Tabel } = {};
ctx.globalThis = ctx;
vm.runInNewContext(readFileSync(path.join(SITE, 'strings.js'), 'utf8'), ctx);
const T = ctx.CLAWCO_TEXT!;
const liste = JSON.parse(readFileSync(path.join(SITE, 'billeder/liste.json'), 'utf8')) as {
  images: { file: string; lang: 'en' | 'da'; moment: string; route: string; scale?: number; crop?: { element?: { selector: string }; from?: unknown; to?: unknown } }[];
  viewport: { width: number; height: number; scale: number };
  og: { template: string; file: string; width: number; height: number };
};
const forside = parseHTML(readFileSync(path.join(SITE, 'index.html'), 'utf8')).document;
const maal = (fil: string) => webpMaal(readFileSync(path.join(SITE, 'billeder', fil)));
const NOEGLER = ['home.hero.img', 'home.journey.img', 'home.screen.img', 'home.house.img1', 'home.house.img2'];

test('every front-page image has an English and a Danish file, each in the list the script reads, in the right language of the test world', () => {
  assert.deepEqual(liste.viewport, { width: 375, height: 900, scale: 2 });
  const filer = liste.images.map((i) => i.file);
  assert.equal(new Set(filer).size, filer.length, 'a file is listed once');
  for (const k of NOEGLER) for (const l of ['en', 'da'] as const) {
    const src = T[l][`${k}.src`]!;
    assert.ok(src.startsWith('/billeder/') && src.endsWith('.webp'), `${l} ${k}.src`);
    assert.equal(src.endsWith('.da.webp'), l === 'da', `${k}: Danish files end in .da.webp, English ones keep the name`);
    const i = liste.images.find((x) => `/billeder/${x.file}` === src);
    assert.ok(i, `${src} is in liste.json`);
    assert.equal(i.lang, l);
    assert.ok(existsSync(path.join(SITE, 'billeder', i.file)), `${i.file} exists`);
  }
  for (const i of liste.images) {
    assert.ok(ALLE_MOMENTER.some((m) => m.id === i.moment), `${i.file}: unknown moment ${i.moment}`);
    assert.equal(momentSprog(i.moment), i.lang, `${i.file}: moment ${i.moment} is written in ${momentSprog(i.moment)}`);
    assert.ok(i.route.startsWith('/rum/'), `${i.file}: route ${i.route}`);
  }
  assert.equal(liste.images.length, NOEGLER.length * 2, 'no image in the list that the page does not use');
});

test('KC-0261: every image is exactly one card: an element crop, never a span from a section header or a room heading down to a card', () => {
  for (const i of liste.images) {
    assert.ok(i.crop?.element, `${i.file}: a single element`);
    assert.equal(i.crop.from, undefined, `${i.file}: no from/to span (it would carry a header or heading)`);
    assert.equal(i.crop.to, undefined, `${i.file}`);
    assert.match(i.crop.element.selector, /^(#room article\.kort-stor|#room article\.trin-kort|article\[data-(id|foresp|sammenfald)="[^"]+"\])$/, `${i.file}: the selector names a card (${i.crop.element.selector})`);
  }
  assert.equal(liste.images.find((i) => i.file === 'hero-nu.webp')!.crop!.element!.selector, '#room article.kort-stor', 'the hero is the one big card of the Now screen, without its "Right now" band header');
  assert.equal(liste.images.find((i) => i.file === 'start-kold.da.webp')!.crop!.element!.selector, '#room article.trin-kort', 'the Start image is the first step card, without the room heading');
});

test('KC-0261: the page puts no frame of its own around an image: the card already has its border (a second one read as a double frame)', () => {
  const css = readFileSync(path.join(SITE, 'site.css'), 'utf8');
  for (const m of css.matchAll(/(^|\n)([^{}\n]*\.(?:shot|phone|card-shot)[^{}\n]*\bimg[^{}\n]*)\{([^}]*)\}/g)) {
    assert.ok(!/border\s*:|border-radius|background\s*:/.test(m[3]!), `${m[2]!.trim()} must not add a border, radius or background: ${m[3]!.trim()}`);
  }
});

test('width and height in the table are the pixel size of the files (so regenerating them cannot leave the page reserving the wrong space)', () => {
  for (const k of NOEGLER) for (const l of ['en', 'da'] as const) {
    const m = maal(T[l][`${k}.src`]!.replace('/billeder/', ''));
    assert.equal(T[l][`${k}.w`], String(m.width), `${l} ${k}.w`);
    assert.equal(T[l][`${k}.h`], String(m.height), `${l} ${k}.h`);
  }
});

test('the landing page swaps each image with the language: the HTML is the English entry, ?lang=da shows the Danish file', () => {
  const bilag = Array.from(forside.querySelectorAll('img'));
  assert.equal(bilag.length, NOEGLER.length);
  for (const [i, img] of bilag.entries()) {
    const k = NOEGLER[i]!;
    assert.equal(img.getAttribute('data-i-attr'), `alt:${k}.alt;src:${k}.src;width:${k}.w;height:${k}.h`);
    assert.equal(img.getAttribute('src'), T.en[`${k}.src`]);
    assert.equal(img.getAttribute('width'), T.en[`${k}.w`]);
    assert.equal(img.getAttribute('height'), T.en[`${k}.h`]);
  }
});

test('the site script writes the Danish src, width and height on ?lang=da (data-i-attr, the mechanism of the alt text)', () => {
  const { document, window } = parseHTML(readFileSync(path.join(SITE, 'index.html'), 'utf8'));
  const sc: Record<string, unknown> = { document, window, localStorage: { getItem: () => null, setItem() {} }, navigator: {}, setTimeout, clearTimeout, location: { search: '?lang=da', pathname: '/', hash: '' }, history: { replaceState() {} }, URLSearchParams, console };
  sc['globalThis'] = sc;
  vm.runInNewContext(readFileSync(path.join(SITE, 'strings.js'), 'utf8'), sc);
  vm.runInNewContext(readFileSync(path.join(SITE, 'site.js'), 'utf8'), sc);
  const bilag = Array.from(document.querySelectorAll('img'));
  for (const [i, img] of bilag.entries()) {
    const k = NOEGLER[i]!;
    assert.equal(img.getAttribute('src'), T.da[`${k}.src`]);
    assert.match(img.getAttribute('src')!, /\.da\.webp$/);
    assert.equal(img.getAttribute('width'), T.da[`${k}.w`]);
    assert.equal(img.getAttribute('height'), T.da[`${k}.h`]);
    assert.equal(img.getAttribute('alt'), T.da[`${k}.alt`]);
  }
});

test('nothing on the page says the screens are in Danish, and no alt text carries a date that the world moves along', () => {
  for (const l of ['en', 'da'] as const) {
    for (const k of Object.keys(T[l]).filter((x) => x.startsWith('home.'))) {
      assert.ok(!/\b(in danish|is in danish|på dansk i dag|er på dansk|screens are in)\b/i.test(T[l][k]!), `${l} ${k}: ${T[l][k]}`);
    }
    for (const k of NOEGLER) {
      const alt = T[l][`${k}.alt`]!;
      assert.ok(!/\b(danish|dansk|på dansk)\b/i.test(alt), `${l} ${k}.alt names a language`);
      assert.ok(!/\b(monday|tuesday|wednesday|thursday|friday|mandag|tirsdag|onsdag|torsdag|fredag)\b[^.]*\b\d{1,2}\.? ?(nov|november)/i.test(alt), `${l} ${k}.alt has a date`);
    }
  }
  assert.match(T.en['home.faq.6.a']!, /English and Danish/);
  assert.match(T.da['home.faq.6.a']!, /Engelsk og dansk/);
  assert.match(T.da['home.faq.6.a']!, /Start/);
});

test('og.png is rendered from the committed template and is the 1200x630 preview the page names', () => {
  assert.ok(existsSync(path.join(ROD, liste.og.template)));
  assert.ok(readFileSync(path.join(ROD, liste.og.template), 'utf8').includes('billeder/hero-nu.webp'), 'the template shows the English hero capture');
  const png = readFileSync(path.join(SITE, 'billeder', liste.og.file));
  assert.equal(png.toString('latin1', 1, 4), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [liste.og.width, liste.og.height]);
  assert.ok(forside.querySelector('meta[property="og:image"]')!.getAttribute('content')!.endsWith(`/billeder/${liste.og.file}`));
});
