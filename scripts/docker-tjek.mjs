#!/usr/bin/env node
// Usage: node scripts/docker-tjek.mjs [--port N] [--adresse URL]
// KC-0157: the cold-start smoke for containers (product spec §10) — the test that must pass
// before anything is put out on clawco.work. On a machine with Docker:
//   1. `docker compose config` with and without the tailscale profile (compose.yaml parses)
//   2. build the image with this checkout's sha as GIT_SHA
//   3. run it read-only on 127.0.0.1:<free port> with an empty, new volume at /data
//   4. /health answers with that sha; the process is not root; the port is bound to 127.0.0.1 only;
//      /app holds only what the app runs on
//   5. headless (playwright-core on the host, as live:tjek): / lands on Start, Nu shows at least
//      one real element, no console errors, dark theme, no horizontal overflow at 375 px
//   6. replace the container on the same volume: every file the first one wrote is still there
// Everything it creates carries one unique name (clawco-tjek-<hex>) and is removed at the end;
// it never touches another container, volume or image. Exit 0 ok, 1 problems, 2 Docker missing.
// --adresse URL skips Docker and runs only the smoke (step 5, without the Start check) against
// an instance that is already running — never a Tailscale address from the app's in-app browser
// (AGENTS.md §5 r8); this script is headless, so any address works.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROD = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args.splice(i, 2)[1]; };
const portArg = flag('--port');
const adresseArg = flag('--adresse');
if (args.length) { console.error(`ukendt valg: ${args.join(' ')}`); process.exit(2); }

let problemer = 0;
let tjek = 0;
const fejl = (msg) => { problemer++; console.log(`FEJL ${msg}`); };
const ok = (msg) => { tjek++; console.log(`ok   ${msg}`); };
const hvis = (betingelse, godt, daarligt) => (betingelse ? ok(godt) : fejl(daarligt ?? godt));

// git and docker run without the caller's GIT_* (a hook's GIT_DIR would point git elsewhere).
const MILJOE = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
function koer(cmd, argv, o = {}) {
  const r = spawnSync(cmd, argv, { cwd: ROD, encoding: 'utf8', env: { ...MILJOE, ...(o.env ?? {}) }, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? (r.error ? 127 : 1), out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() || String(r.error ?? '') };
}
const hale = (s, n = 6) => s.split('\n').slice(-n).join('\n    ');

function friPort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer().once('error', reject).listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

async function ventPaaHealth(adresse, sekunder) {
  const slut = Date.now() + sekunder * 1000;
  let sidst = '';
  while (Date.now() < slut) {
    try {
      const r = await fetch(`${adresse}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return await r.json();
      sidst = `HTTP ${r.status}`;
    } catch (e) { sidst = String(e.cause?.code ?? e.message ?? e); }
    await new Promise((ok) => setTimeout(ok, 500));
  }
  return { fejl: sidst || 'intet svar' };
}

/** Step 5: Start first on a cold install, then Nu with one real element, headless at phone width in dark mode. */
async function roeg(adresse, { kold }) {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: 'dark' });
    const side = await ctx.newPage();
    const konsol = [];
    side.on('console', (m) => { if (m.type() === 'error') konsol.push(m.text()); });
    side.on('pageerror', (e) => konsol.push(String(e)));
    if (kold) {
      // Not 'networkidle': the live bus keeps an SSE stream open.
      await side.goto(`${adresse}/`, { waitUntil: 'load', timeout: 20000 });
      const sti = new URL(side.url()).pathname;
      hvis(sti === '/rum/start', `/ fører en ny bruger til Start (${sti})`);
    }
    const svar = await side.goto(`${adresse}/rum/hjem`, { waitUntil: 'load', timeout: 20000 });
    await side.waitForTimeout(1500);
    hvis(svar?.ok(), `/rum/hjem HTTP ${svar?.status()}`);
    const m = await side.evaluate(() => {
      const synlig = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
      const elementer = [...document.querySelectorAll('main [data-blok]:not([data-blok="samtale"])')]
        .filter(synlig)
        .map((el) => ({ blok: el.dataset.blok, tekst: (([...el.querySelectorAll('.row-title')].find(synlig) ?? [...el.querySelectorAll('.row')].find(synlig))?.textContent ?? '').trim().replace(/\s+/g, ' ') }))
        .filter((e) => e.tekst);
      const [r, g, b] = (getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g) ?? ['255', '255', '255']).map(Number);
      return {
        rum: document.querySelector('header.top .crumb strong')?.textContent?.trim() ?? '',
        elementer,
        lys: Math.round((r + g + b) / 3),
        bredde: document.documentElement.scrollWidth,
      };
    });
    hvis(m.rum === 'Now', `rummet hedder "${m.rum}"`, `rummet hedder "${m.rum}", ikke "Now" (en ny installation er engelsk, KC-0170)`);
    hvis(m.elementer.length > 0, `Nu viser ${m.elementer.length} rigtige element(er); første: ${m.elementer[0]?.blok} "${m.elementer[0]?.tekst.slice(0, 60)}"`, 'Nu viser intet rigtigt element');
    hvis(m.lys < 64, `mørkt tema (baggrundens lysstyrke ${m.lys}/255)`);
    hvis(m.bredde <= 375, `ingen vandret overløb (${m.bredde}/375 px)`);
    hvis(konsol.length === 0, 'ingen konsolfejl', `konsolfejl: ${konsol[0]?.slice(0, 160)}`);
  } finally {
    await browser.close();
  }
}

async function medDocker() {
  const v = koer('docker', ['version', '--format', '{{.Server.Version}}']);
  if (v.status !== 0) {
    console.log(`Docker kører ikke på denne maskine (${hale(v.err, 1)}). Intet er prøvet; arbejdet er ikke bevist.`);
    process.exit(2);
  }
  ok(`Docker ${v.out}`);
  const sha = koer('git', ['rev-parse', '--short', 'HEAD']).out || 'unknown';
  const navn = `clawco-tjek-${randomBytes(4).toString('hex')}`;
  const billede = `${navn}:tjek`;
  const volumen = `${navn}-data`;
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'clawco-tjek-'));
  const lavet = { billede: false, volumen: false, container: false };
  const ryd = () => {
    if (lavet.container) koer('docker', ['rm', '-f', navn]);
    if (lavet.volumen) koer('docker', ['volume', 'rm', '-f', volumen]);
    if (lavet.billede) koer('docker', ['image', 'rm', '-f', billede]);
    rmSync(tmp, { recursive: true, force: true });
  };
  const afbryd = () => { ryd(); process.exit(130); };
  process.once('SIGINT', afbryd);
  process.once('SIGTERM', afbryd);
  try {
    // 1. compose.yaml parses, also with the tailscale profile (a dummy key file; nothing starts).
    const noegle = path.join(tmp, 'tailscale-authkey');
    writeFileSync(noegle, 'ikke-en-noegle\n', { mode: 0o600 });
    for (const profil of [[], ['--profile', 'tailscale']]) {
      const c = koer('docker', ['compose', '-f', 'compose.yaml', ...profil, 'config', '--quiet'], { env: { CLAWCO_TS_AUTHKEY_FIL: noegle } });
      hvis(c.status === 0, `docker compose config ${profil.join(' ') || '(uden profil)'}`, `docker compose config ${profil.join(' ')}: ${hale(c.err, 3)}`);
    }

    // 2. Build.
    const t0 = Date.now();
    const b = koer('docker', ['build', '--build-arg', `GIT_SHA=${sha}`, '-t', billede, '.']);
    lavet.billede = b.status === 0;
    if (b.status !== 0) { fejl(`docker build:\n    ${hale(b.err, 12)}`); return; }
    ok(`docker build ${billede} (GIT_SHA=${sha}, ${Math.round((Date.now() - t0) / 1000)} s)`);

    // 3. Run cold: new empty volume, read-only root, loopback publish.
    const port = Number(portArg ?? (await friPort()));
    const adresse = `http://127.0.0.1:${port}`;
    const vol = koer('docker', ['volume', 'create', volumen]);
    lavet.volumen = vol.status === 0;
    if (vol.status !== 0) { fejl(`docker volume create: ${hale(vol.err, 2)}`); return; }
    const start = () => {
      const r = koer('docker', ['run', '-d', '--name', navn, '--read-only', '--tmpfs', '/tmp', '--security-opt', 'no-new-privileges:true',
        '-p', `127.0.0.1:${port}:8750`, '-v', `${volumen}:/data`, billede]);
      lavet.container = r.status === 0;
      return r;
    };
    const r = start();
    if (r.status !== 0) { fejl(`docker run: ${hale(r.err, 4)}`); return; }

    // 4. Health, user, port binding, image contents.
    const health = await ventPaaHealth(adresse, 90);
    if (health.fejl) { fejl(`/health svarer ikke: ${health.fejl}\n    ${hale(koer('docker', ['logs', '--tail', '20', navn]).err, 20)}`); return; }
    hvis(health.ok === true && health.sha === sha, `/health ok, sha=${health.sha}, agent=${health.agent?.mode}/${health.agent?.status}`, `/health sha=${health.sha} (forventet ${sha})`);
    const uid = koer('docker', ['exec', navn, 'id', '-u']).out;
    hvis(uid !== '' && uid !== '0', `processen kører som uid ${uid}, ikke root`);
    const porte = koer('docker', ['port', navn, '8750/tcp']).out.split('\n').filter(Boolean);
    hvis(porte.length > 0 && porte.every((p) => p.startsWith('127.0.0.1:')), `porten er kun bundet til maskinen selv (${porte.join(', ')})`);
    const app = koer('docker', ['exec', navn, 'sh', '-c', 'ls -A /app; echo ---; ls -A /app/test /app/config']).out;
    const [top, under] = app.split('---');
    const tilladt = new Set(['package.json', 'package-lock.json', 'node_modules', 'src', 'public', 'config', 'test', 'GIT_SHA']);
    const fremmede = top.split('\n').filter((f) => f && !tilladt.has(f));
    hvis(fremmede.length === 0, '/app rummer kun det, appen kører på', `/app rummer også: ${fremmede.join(', ')}`);
    hvis(!/omkostninger\.json|\.test\.ts/.test(under ?? ''), 'ingen omkostningsliste og ingen tests i billedet', `for meget i /app/test eller /app/config: ${under?.trim().replace(/\s+/g, ' ')}`);

    // 5. The smoke.
    await roeg(adresse, { kold: true });

    // 6. A new container on the same volume keeps everything the first wrote.
    const foer = koer('docker', ['exec', navn, 'find', '/data', '-type', 'f']).out.split('\n').filter(Boolean).sort();
    hvis(foer.length > 0, `brugermappen /data fik ${foer.length} fil(er) ved første start`);
    koer('docker', ['rm', '-f', navn]);
    lavet.container = false;
    const igen = start();
    if (igen.status !== 0) { fejl(`docker run (igen): ${hale(igen.err, 4)}`); return; }
    const health2 = await ventPaaHealth(adresse, 90);
    hvis(!health2.fejl, 'ny container på samme volumen svarer', `ny container svarer ikke: ${health2.fejl}`);
    const efter = new Set(koer('docker', ['exec', navn, 'find', '/data', '-type', 'f']).out.split('\n').filter(Boolean));
    const mistet = foer.filter((f) => !efter.has(f));
    hvis(mistet.length === 0, 'data overlever en ny container', `mistet efter ny container: ${mistet.slice(0, 3).join(', ')}`);
  } finally {
    ryd();
    const rest = koer('docker', ['ps', '-a', '--filter', `name=${navn}`, '-q']).out;
    hvis(!rest && !koer('docker', ['volume', 'ls', '-q', '--filter', `name=${volumen}`]).out, `ryddet op (${navn})`, `kunne ikke rydde ${navn} helt op`);
  }
}

try {
  if (adresseArg) {
    const health = await ventPaaHealth(adresseArg.replace(/\/$/, ''), 10);
    if (health.fejl) fejl(`/health svarer ikke: ${health.fejl}`);
    else {
      hvis(health.ok === true, `/health ok, sha=${health.sha}, agent=${health.agent?.mode}/${health.agent?.status}`);
      await roeg(adresseArg.replace(/\/$/, ''), { kold: false });
    }
  } else await medDocker();
} catch (e) {
  fejl(String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
}
console.log(problemer ? `${tjek} ok, ${problemer} problem(er)` : `docker-tjek ok (${tjek} tjek)`);
process.exit(problemer ? 1 : 0);
