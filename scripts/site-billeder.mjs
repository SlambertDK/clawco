#!/usr/bin/env node
// KC-0244: regenerates the screenshots on the front page of clawco.work (site/billeder/) from the test world, so that the English
// page shows English screens and the Danish page Danish ones. What is captured is listed in site/billeder/liste.json; run
//
//   node scripts/site-billeder.mjs [--only <file>] [--port 8791] [--tmp <dir>]
//
// It starts its OWN Clawco on 127.0.0.1 (fake agent, fake sources, fake voice, an empty data folder in a fresh temp dir; never the
// installation's data), turns the test world on with the cookie kc_test=1, jumps to each image's moment, captures at 375 px wide,
// dark, device scale 2, with the test band, the chat button and the nav hidden, converts with cwebp -q 84, renders og.png from
// scripts/site-billeder/og.html and stops the server. Every request the browser makes to anything but 127.0.0.1 (or a local file for
// the template) is aborted and fails the run. Never real data: the world's family is fictional. Prints each file's size so
// width/height in site/strings.js (home.*.img.w / .h) can be checked; test/site.test.ts holds them equal to the files.
// The week strip on the Saturday card and the dates on the car card follow the day the script is run (the world's day is today).

import { execFileSync, spawn } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { webpMaal } from './site-billeder/webp.ts';

const ROD = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const BILLEDER = path.join(ROD, 'site/billeder');
const arg = (navn, standard) => { const i = process.argv.indexOf(navn); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : standard; };
const PORT = Number(arg('--port', '8791'));
const kun = arg('--only', null);
const BASE = `http://127.0.0.1:${PORT}`;
const liste = JSON.parse(readFileSync(path.join(BILLEDER, 'liste.json'), 'utf8'));
const { width: BREDDE, height: HOEJDE, scale: SKALA } = liste.viewport;
/** What is hidden in every capture: the test band, the chat button (KC-0068), the chat sheet and the bottom nav, which a full-page capture would put over the crop. */
const SKJUL = '.kc-test-baand, #chat-toggle, #aside, nav { display: none !important; }';

const tmp = path.resolve(arg('--tmp', tmpdir()));
mkdirSync(tmp, { recursive: true });
const arbejde = mkdtempSync(path.join(tmp, 'site-billeder-'));
const logFil = path.join(arbejde, 'server.log');
const logFd = openSync(logFil, 'w');
let server = null;
let browser = null;
const ryd = () => {
  if (server && server.exitCode === null) server.kill('SIGTERM');
  closeSync(logFd);
};
const fejl = (tekst) => { console.error(`FEJL ${tekst}`); ryd(); process.exit(1); };

// Only the variables the app needs: a secret in this shell never reaches the capture server.
const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', KC_AGENT: 'fake', KC_KILDER_MODE: 'fake', KC_STEMME_MODE: 'fake', KC_DATA_DIR: path.join(arbejde, 'data'), KC_PORT: String(PORT) };
mkdirSync(env.KC_DATA_DIR, { recursive: true });
server = spawn(process.execPath, ['src/server.ts'], { cwd: ROD, env, stdio: ['ignore', logFd, logFd] });
server.on('error', (e) => fejl(`kunne ikke starte serveren: ${e.message}`));
for (let i = 0; ; i++) {
  if (server.exitCode !== null) fejl(`serveren stoppede (se ${logFil})`);
  if (await fetch(`${BASE}/health`).then((r) => r.ok, () => false)) break;
  if (i > 100) fejl(`serveren svarer ikke på ${BASE} (se ${logFil})`);
  await new Promise((r) => setTimeout(r, 150));
}

const udenfor = [];
/** The context blocks everything that is not this server (or the local template): the capture never talks to the internet. */
async function lavSide(ctx) {
  const side = await ctx.newPage();
  await side.route('**/*', (rute) => {
    const url = rute.request().url();
    if (url.startsWith(`${BASE}/`) || url.startsWith('file://') || url.startsWith('data:') || url.startsWith('blob:')) return rute.continue();
    udenfor.push(url);
    return rute.abort();
  });
  return side;
}

/** The top and bottom (in page pixels) and the width of the first box matching `spec`. */
async function boks(side, spec) {
  const loc = side.locator(spec.selector).first();
  await loc.waitFor({ state: 'visible', timeout: 8000 });
  return loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; });
}
async function udsnit(side, crop) {
  if (!crop) return null;
  if (crop.element) { const b = await boks(side, crop.element); return { x: b.x, y: b.y, width: b.w, height: b.h }; }
  const a = await boks(side, crop.from);
  const z = await boks(side, crop.to);
  const x = crop.fullWidth ? 0 : Math.min(a.x, z.x);
  const bredde = crop.fullWidth ? BREDDE : Math.max(a.x + a.w, z.x + z.w) - x;
  return { x, y: a.y, width: bredde, height: z.y + z.h - a.y };
}

const stoerrelser = [];
async function tag(ctx, billede) {
  const side = await lavSide(ctx);
  const tilstand = await side.request.post(`${BASE}/test/taend`);
  if (!tilstand.ok()) fejl(`${billede.file}: /test/taend gav ${tilstand.status()}`);
  const hop = await side.request.post(`${BASE}/test/moment/${billede.moment}`);
  if (!hop.ok()) fejl(`${billede.file}: /test/moment/${billede.moment} gav ${hop.status()}`);
  await side.goto(BASE + billede.route, { waitUntil: 'load', timeout: 20000 }); // not 'networkidle': the live bus keeps a stream open
  const sprog = await side.evaluate(() => document.documentElement.lang);
  if (sprog !== billede.lang) fejl(`${billede.file}: siden er på "${sprog}", forventet "${billede.lang}" (moment ${billede.moment})`);
  await side.addStyleTag({ content: SKJUL });
  await side.evaluate(() => document.fonts.ready);
  await side.waitForTimeout(1200);
  const clip = await udsnit(side, billede.crop);
  const png = path.join(arbejde, billede.file.replace(/\.webp$/, '.png'));
  await side.screenshot({ path: png, fullPage: true, animations: 'disabled', caret: 'hide', ...(clip ? { clip } : {}) });
  await side.close();
  const ud = path.join(BILLEDER, billede.file);
  execFileSync('cwebp', ['-quiet', '-q', '84', png, '-o', ud]);
  const m = webpMaal(readFileSync(ud));
  stoerrelser.push(`${billede.file} ${m.width}x${m.height} ${statSync(ud).size} bytes (${billede.lang}, ${billede.moment})`);
}

async function lavOg() {
  const og = liste.og;
  if (kun && kun !== og.file) return;
  const ctx = await browser.newContext({ viewport: { width: og.width, height: og.height }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const side = await lavSide(ctx);
  await side.goto(pathToFileURL(path.join(ROD, og.template)).href, { waitUntil: 'load' });
  await side.evaluate(() => document.fonts.ready);
  await side.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  const ud = path.join(BILLEDER, og.file);
  await side.screenshot({ path: ud, clip: { x: 0, y: 0, width: og.width, height: og.height } });
  await ctx.close();
  stoerrelser.push(`${og.file} ${og.width}x${og.height} ${statSync(ud).size} bytes (en, template)`);
}

try {
  execFileSync('cwebp', ['-version'], { stdio: 'ignore' });
} catch { fejl('cwebp mangler (brew install webp)'); }
try {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: BREDDE, height: HOEJDE }, deviceScaleFactor: SKALA, colorScheme: 'dark' });
  await ctx.addCookies([{ name: 'kc_test', value: '1', url: BASE }]);
  for (const billede of liste.images) if (!kun || kun === billede.file) await tag(ctx, billede);
  await ctx.close();
  await lavOg();
} catch (e) {
  fejl(e instanceof Error ? e.message : String(e));
} finally {
  if (browser) await browser.close();
}
ryd();
rmSync(arbejde, { recursive: true, force: true });
console.log(stoerrelser.join('\n'));
if (udenfor.length) { console.error(`FEJL ${udenfor.length} forespørgsler til andre adresser blev afvist, første: ${udenfor[0]}`); process.exit(1); }
