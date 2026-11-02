// KC-0121: the product is called Clawco wherever Henrik sees it, and every one of those places
// reads the one constant PRODUKT. "Kontrolcenter" survives only where it names Henrik's own
// installation or the GitHub project (the allow-list below), never in what a page renders.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUKT } from '../../src/shell/navn.ts';
import { shell } from '../../src/shell/layout.ts';
import { html } from '../../src/shell/html.ts';
import { renderUdenForbindelse } from '../../src/shell/udenforbindelse.ts';
import { renderIkkeFundet } from '../../src/shell/ikkefundet.ts';
import { AGENT_CONFIG, KEYTERMS } from '../../src/stemme/agent.ts';
import { ROOMS } from '../../src/rooms/registry.ts';
import { createApp } from '../../src/server.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';

const GAMMELT = /Kontrolcenter/;

// The one allowed wording on a page: the project chooser of "Send til Claude Code" names the GitHub
// project SlambertDK/kontrolcenter, which keeps its name until the repo rename (spec D1).
const udenProjektvalg = (t: string): string => t.replace(/<fieldset class="cc-projekter">[\s\S]*?<\/fieldset>/, '');

test('the product name is Clawco', () => {
  assert.equal(PRODUKT, 'Clawco');
});

test('the shell: tab title, header brand and home-screen label come from PRODUKT', () => {
  const out = String(shell({ roomId: 'mail', hermesStatus: 'Klar', venter: {}, main: html`<p>x</p>`, chat: [] }));
  assert.match(out, new RegExp(`<title>Mail · ${PRODUKT}</title>`));
  assert.match(out, new RegExp(`<div class="brand"><span class="dot"></span>${PRODUKT}</div>`));
  assert.match(out, new RegExp(`<meta name="apple-mobile-web-app-title" content="${PRODUKT}">`));
  assert.match(out, new RegExp(`<meta name="application-name" content="${PRODUKT}">`), 'the browser scripts read the name from here');
  assert.doesNotMatch(udenProjektvalg(out), GAMMELT);
});

test('the offline page names PRODUKT in its title and heading', () => {
  const out = renderUdenForbindelse();
  assert.match(out, new RegExp(`<title>${PRODUKT} kan ikke nås</title>`));
  assert.match(out, new RegExp(`<h1>${PRODUKT} kan ikke nås lige nu</h1>`));
  assert.doesNotMatch(out, GAMMELT);
});

test('the 404 lines name PRODUKT where they name the product', () => {
  assert.match(String(renderIkkeFundet('rum')), new RegExp(`et rum i ${PRODUKT}\\.`));
  assert.match(String(renderIkkeFundet('side')), new RegExp(`noget i ${PRODUKT}\\.`));
  for (const k of ['rum', 'side', 'dokument'] as const) assert.doesNotMatch(String(renderIkkeFundet(k)), GAMMELT);
});

test('the voice agent is named PRODUKT and listens for it (only the name string; no re-sync here)', () => {
  assert.equal(AGENT_CONFIG.name, PRODUKT);
  assert.ok(KEYTERMS.includes(PRODUKT));
  assert.ok(!KEYTERMS.some((k) => GAMMELT.test(k)));
});

// The guard: every page the server renders, plus the manifest, carries the new name and never the old.
let dir = '';
let app: ReturnType<typeof createApp>['app'];
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kc-navn-'));
  ({ app } = createApp({ store: createFileStore(dir), hermes: createFakeAgent({ answer: () => 'Intet.' }), sourceGlob: path.join(dir, '{date}.json'), publicDir: 'public' }));
});
after(async () => { await rm(dir, { recursive: true, force: true }); });

test('guard: every rendered page and the manifest say PRODUKT and never the old name', async () => {
  const sider = [...ROOMS.map((r) => `/rum/${r.id}`), '/rum/findes-ikke', '/findes-ikke', '/uden-forbindelse'];
  for (const sti of sider) {
    const t = await (await app.request(sti)).text();
    assert.match(t, new RegExp(`<title>[^<]*${PRODUKT}[^<]*</title>`), sti);
    assert.doesNotMatch(udenProjektvalg(t), GAMMELT, sti);
  }
  const m = await (await app.request('/manifest.webmanifest')).text();
  assert.equal(JSON.parse(m).name, PRODUKT);
  assert.doesNotMatch(m, GAMMELT);
});

// Where "Kontrolcenter" may still be spelled in code: the GitHub project (not renamed, D1), Henrik's
// own setup described to Hermes, and testtilstand's line about that project.
const TILLADT = new Set(['src/udvikling/projekter.ts', 'src/rooms/nyheder/prompt.ts', 'src/testtilstand/indhold/udvikling.ts']);
const rod = fileURLToPath(new URL('../../', import.meta.url));
function filer(mappe: string, endelse: RegExp): string[] {
  return readdirSync(path.join(rod, mappe), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && endelse.test(d.name))
    .map((d) => path.relative(rod, path.join(d.parentPath, d.name)).split(path.sep).join('/'));
}

test('guard: no string in src/ or public/ spells the old name outside the allow-list', () => {
  const streng = /(['"`])(?:(?!\1)[^\n\\]|\\.)*Kontrolcenter(?:(?!\1)[^\n\\]|\\.)*\1/;
  const fund: string[] = [];
  for (const f of [...filer('src', /\.ts$/), ...filer('public', /\.js$/)]) {
    if (TILLADT.has(f)) continue;
    readFileSync(path.join(rod, f), 'utf8').split('\n').forEach((linje, i) => {
      const kode = linje.trimStart();
      if (kode.startsWith('//') || kode.startsWith('*') || kode.startsWith('/*')) return;
      if (streng.test(linje)) fund.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(fund, []);
});
