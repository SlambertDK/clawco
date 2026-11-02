#!/usr/bin/env node
// Usage: npm run live:tjek -- [path | moment …] [--skaermbillede <dir>] [--sha <sha>] [--test | --kold]
// KC-0054: the post-deploy live check (AGENTS.md §5.7), run headless from the
// terminal. The app's in-app browser treats the Tailscale address as a private
// network site and asks Henrik to approve every single action on it, whatever
// the session's permission mode — so live checks never drive that browser.
// Checks /health (sha, Hermes reachable), then loads each path at phone width
// in dark mode: console/page errors, horizontal overflow. Exit 1 on any problem.
// Interactions beyond this: a scratch script that imports playwright-core from
// this repo's node_modules, the same way.
// --test (KC-0068): with the test cookie, start a clean test world and check
// every moment at the page its jump lands on (each page must carry the test band).
// KC-0069: paths and moment ids limit it, as in the plain mode: `--test /viden`
// checks /viden at every moment, `--test formiddag` only that moment, both together
// that route at that moment (scripts/live-argumenter.ts reads the command line). The
// real rum-lager is never touched, but the run resets the server's one shared
// test world (a phone in test mode sees it change) and leaves it at the last moment.
// --kold (KC-0131): never the tailnet — starts its own fresh dev server (fake agent,
// fake connectors, a temporary data dir, a free loopback port), turns the test world
// on and checks the cold start's moments (Start first), then stops the server.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { parseLiveArgumenter, testPlan } from './live-argumenter.ts';

const arg = parseLiveArgumenter(process.argv.slice(2));
if (arg.fejl.length) { for (const f of arg.fejl) console.error(`live:tjek: ${f}`); process.exit(2); }
const { skaermDir, kold, test: testtilstand } = arg;

/** KC-0131: a fresh dev server of this checkout on a free loopback port; its own empty data dir. */
async function startKold() {
  const port = await new Promise((res, rej) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }).on('error', rej); });
  const dir = mkdtempSync(path.join(tmpdir(), 'kc-kold-'));
  const rod = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const env = {
    PATH: process.env.PATH ?? '', HOME: dir, KC_AGENT: 'fake', KC_KILDER_MODE: 'fake', KC_STEMME_MODE: 'fake', KC_HOST: '127.0.0.1', KC_PORT: String(port),
    KC_DATA_DIR: path.join(dir, 'data'), KC_TEST_DATA_DIR: path.join(dir, 'data-test'), KC_FRONTLOAD: '', KC_KURATOR: 'fra',
  };
  const server = spawn(process.execPath, ['src/server.ts'], { cwd: rod, env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  server.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
  const adresse = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`dev-serveren stoppede: ${stderr.slice(-300)}`);
    if (await fetch(`${adresse}/health`).then((r) => r.ok, () => false)) return { adresse, stop: () => { server.kill(); rmSync(dir, { recursive: true, force: true }); } };
    await new Promise((r) => setTimeout(r, 200));
  }
  server.kill();
  throw new Error(`dev-serveren svarede ikke: ${stderr.slice(-300)}`);
}
const koldServer = kold ? await startKold() : null;
process.on('exit', () => koldServer?.stop()); // also when a check throws
// The address is this installation's own (KC-0228: never in the code): KC_ADRESSE, else `git config clawco.adresse`.
const gitAdresse = () => { try { return execFileSync('git', ['config', '--get', 'clawco.adresse'], { encoding: 'utf8' }).trim() || null; } catch { return null; } };
const ADRESSE = koldServer?.adresse ?? process.env.KC_ADRESSE ?? gitAdresse();
if (!ADRESSE) { console.error('Hvilken Clawco? Sæt KC_ADRESSE=https://… eller git config clawco.adresse https://…'); process.exit(2); }
// Docs-only pushes to main are never deployed, so the expected sha is the newest code commit.
const forventetSha = kold ? null : arg.sha ?? execFileSync('git', ['log', '-1', '--format=%h', 'origin/main', '--', '.', ':!docs'], { encoding: 'utf8' }).trim();

let problemer = 0;
let landing = null; // --test: where the last jump landed
const fejl = (msg) => { problemer++; console.log(`FEJL ${msg}`); };

const health = await fetch(`${ADRESSE}/health`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch((e) => ({ fejl: String(e) }));
if (health.fejl) fejl(`/health svarer ikke: ${health.fejl}`);
else {
  console.log(`health sha=${health.sha} (forventet ${forventetSha ?? 'denne checkout'}) hermes=${health.hermes?.reachable ? 'ok' : 'nede'} oppe=${health.uptimeSec}s`);
  // A deploy runs main's tip, which may be a docs-only commit after the newest code commit: same code, so it counts.
  const sammeKode = (sha) => { try { execFileSync('git', ['diff', '--quiet', forventetSha, sha, '--', '.', ':!docs'], { stdio: 'ignore' }); return true; } catch { return false; } };
  if (forventetSha && !forventetSha.startsWith(health.sha) && !health.sha.startsWith(forventetSha) && !sammeKode(health.sha)) fejl('live kører ikke den forventede sha');
  if (!health.hermes?.reachable) fejl('Hermes svarer ikke');
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: 'dark' });
async function tjek(sti, navn = sti) {
  const side = await ctx.newPage();
  const konsol = [];
  side.on('console', (m) => { if (m.type() === 'error') konsol.push(m.text()); });
  side.on('pageerror', (e) => konsol.push(String(e)));
  // Not 'networkidle': the live bus keeps an SSE stream open, so the network is never idle.
  const svar = await side.goto(ADRESSE + sti, { waitUntil: 'load', timeout: 20000 }).catch((e) => fejl(`${sti}: ${e.message}`));
  await side.waitForTimeout(1500);
  const m = await side.evaluate(() => ({ titel: document.title, bredde: document.documentElement.scrollWidth, test: Boolean(window.KC_TEST) }));
  console.log(`${navn} status=${svar?.status() ?? '-'} titel="${m.titel}" bredde=${m.bredde}/375 konsolfejl=${konsol.length}`);
  if (svar && !svar.ok()) fejl(`${navn}: HTTP ${svar.status()}`);
  if (m.bredde > 375) fejl(`${navn}: siden er ${m.bredde} px bred på en 375 px telefon`);
  if (konsol.length) fejl(`${navn}: ${konsol[0].slice(0, 160)}`);
  if (m.test !== testtilstand) fejl(`${navn}: ${testtilstand ? 'testbåndet mangler' : 'siden er i testtilstand'}`);
  if (skaermDir) {
    mkdirSync(skaermDir, { recursive: true });
    const fil = path.join(skaermDir, `${navn.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'forside'}.png`);
    await side.screenshot({ path: fil });
    console.log(`  skærmbillede: ${fil}`);
  }
  await side.close();
}
if (testtilstand) {
  await ctx.addCookies([{ name: 'kc_test', value: '1', url: ADRESSE }]);
  const taend = await ctx.request.post(`${ADRESSE}/test/taend`);
  if (!taend.ok()) fejl(`/test/taend: HTTP ${taend.status()}`);
  const { momenter = [] } = taend.ok() ? await (await ctx.request.get(`${ADRESSE}/test/status`)).json() : {};
  // --kold: the cold start's moments only, the fresh install (Start) first; paths and moment ids (KC-0069) limit the walk.
  const { plan, fejl: planFejl } = testPlan(momenter, arg);
  for (const f of planFejl) fejl(f);
  let sidste = null;
  let hopOk = false;
  for (const trin of plan) {
    if (trin.moment !== sidste) { // one jump per moment, then each of its pages
      sidste = trin.moment;
      const hop = await ctx.request.post(`${ADRESSE}/test/moment/${trin.moment}`);
      hopOk = hop.ok();
      if (hopOk) landing = (await hop.json()).url;
      else fejl(`/test/moment/${trin.moment}: HTTP ${hop.status()}`);
    }
    if (hopOk) await tjek(trin.sti ?? landing, trin.navn);
  }
} else for (const sti of arg.stier) await tjek(sti);
await browser.close();
koldServer?.stop();
console.log(problemer ? `${problemer} problem(er)` : kold ? 'kold start ok' : 'live ok');
process.exit(problemer ? 1 : 0);
