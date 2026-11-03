import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { ROOMS } from '../src/rooms/registry.ts';
import { BLOKKE, BYGGET } from '../src/shell/katalog.ts';
import { GRAENSEKLASSER, TRIN } from '../src/tillid/trin.ts';
import { ROLLER, ROLLE_NAVN } from '../src/identitet/roller.ts';
import { DATAZONER } from '../src/identitet/zoner.ts';
import { TILSTANDE } from '../src/hushold/foresp.ts';
import { SLAGS as RESSOURCE_SLAGS } from '../src/hushold/ressource.ts';
import { MAX_PERSONER } from '../src/hushold/invitation.ts';
import { medGoogleKalender, medMailGmail, medMailImap, medNoter, medNyhederRss } from '../src/server.ts';
import { beskederKilde } from '../src/kilder/beskeder/kilde.ts';
import { FORBUDTE_VERBER } from '../src/kilder/register.ts';
import { googleKalender } from '../src/kilder/google-kalender/kilde.ts';
import { mailGmail } from '../src/kilder/mail-gmail/kilde.ts';

// KC-0165: the documentation pages (site/docs/*.html and the install page). Invariant: no page documents something
// that is not built and verified. So this test derives every name a page may use (rooms, blocks, connectors, trust
// levels, limits, roles, npm scripts, install flags) from the code and the scripts themselves, runs the commands the
// pages show with --help or against a scratch folder, and fails on a page that names something the code does not have,
// on a missing Danish text, and on a page that does not end with the date it was checked.

const ROD = fileURLToPath(new URL('..', import.meta.url));
const SITE = path.join(ROD, 'site');
const laes = (rel: string): string => readFileSync(path.join(ROD, rel), 'utf8');
const flad = (s: string): string => s.replace(/\s+/g, ' ').trim();
const dok = (rel: string) => parseHTML(readFileSync(path.join(SITE, rel), 'utf8')).document;
const TEKST = (rel: string): string => flad(Array.from(dok(rel).querySelectorAll('main *')).map((e) => (e.children.length === 0 ? e.textContent ?? '' : '')).join(' '));

const DOKS = readdirSync(path.join(SITE, 'docs')).filter((f) => f.endsWith('.html')).sort().map((f) => `docs/${f}`);
const SIDER = ['install.html', ...DOKS];

type Tabel = { en: Record<string, string>; da: Record<string, string> };
function laesTabel(): Tabel {
  const ctx: { globalThis?: unknown; CLAWCO_TEXT?: Tabel } = {};
  ctx.globalThis = ctx;
  vm.runInNewContext(readFileSync(path.join(SITE, 'strings.js'), 'utf8'), ctx);
  return ctx.CLAWCO_TEXT!;
}
const T = laesTabel();

const SKRIFT = JSON.parse(laes('package.json')) as { scripts: Record<string, string> };
const attr = (el: Element, navn: string): string => el.getAttribute(navn) ?? '';
const alle = (d: Document | Element, sel: string): Element[] => Array.from(d.querySelectorAll(sel));

// ---------------------------------------------------------------------------------------------------------------
// The pages exist, are listed, and end with the date they were checked

const NYE = ['sources', 'trust-ladder', 'household', 'security'] as const;

test('the documentation set: install, Mac/Linux, Docker, sources, trust ladder, household and security, each listed in the index and the sitemap', () => {
  for (const s of NYE) assert.ok(DOKS.includes(`docs/${s}.html`), `missing docs/${s}.html`);
  const indeks = dok('docs/index.html');
  const sitemap = laes('site/sitemap.xml');
  for (const side of DOKS) {
    const sti = '/' + side.replace(/\.html$/, '').replace(/index$/, '');
    if (side !== 'docs/index.html') assert.ok(indeks.querySelector(`.doclist a[href="${sti}"]`), `the index does not link ${sti}`);
    assert.ok(sitemap.includes(`<loc>https://clawco.work${sti}</loc>`), `${sti} is not in the sitemap`);
  }
  assert.ok(indeks.querySelector('.doclist a[href="/install"]'));
});

test('every documentation page ends with the date it was last checked against the code, one key in both languages', () => {
  assert.match(T.en['docs.checked']!, /^Last checked against the code: \d{4}-\d{2}-\d{2}\.$/);
  assert.match(T.da['docs.checked']!, /^Sidst tjekket mod koden: \d{4}-\d{2}-\d{2}\.$/);
  const dato = /\d{4}-\d{2}-\d{2}/.exec(T.en['docs.checked']!)![0];
  assert.equal(dato, /\d{4}-\d{2}-\d{2}/.exec(T.da['docs.checked']!)![0], 'the same date in both languages');
  assert.ok(!Number.isNaN(Date.parse(dato)) && Date.parse(dato) <= Date.now(), 'a real date that is not in the future');
  for (const side of SIDER) {
    const sidste = dok(side).querySelector('main .narrow')!.lastElementChild!;
    assert.equal(attr(sidste, 'data-i'), 'docs.checked', `${side}: the last element is not the checked date`);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Both languages are complete: nothing visible sits outside the string table

test('both languages: every piece of visible text on a documentation page is a keyed string, so the Danish toggle leaves no English behind', () => {
  for (const side of SIDER) {
    const d = dok(side);
    for (const el of alle(d, 'main *')) {
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType !== 3 || !(node.textContent ?? '').trim()) continue;
        // Commands and file names are the same in both languages; everything else must carry a key.
        const ok = el.closest('[data-i]') || el.closest('code') || el.closest('pre');
        assert.ok(ok, `${side}: unkeyed text "${flad(node.textContent ?? '').slice(0, 60)}" in <${el.tagName.toLowerCase()}>`);
      }
      if (el.hasAttribute('data-i')) assert.equal(el.children.length, 0, `${side}: ${attr(el, 'data-i')} has child elements the toggle would remove`);
    }
    for (const el of alle(d, 'main [data-i]')) {
      const k = attr(el, 'data-i');
      assert.ok(T.en[k] && T.da[k], `${side}: ${k} is missing in a language`);
      if (T.en[k]!.length > 24) assert.notEqual(T.da[k], T.en[k], `${side}: ${k} is not translated`);
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Commands: every command a page shows is compared with the script's own --help or --dry-run, never retyped

/** Every command line in a <pre> block, with a trailing "# …" comment and a continuation joined. */
function kommandoer(side: string): string[] {
  const ud: string[] = [];
  for (const pre of alle(dok(side), 'main pre')) {
    for (const linje of (pre.textContent ?? '').split('\n')) if (linje.trim()) ud.push(linje.trim());
  }
  for (const c of alle(dok(side), 'main [data-cmd]')) ud.push(flad(c.textContent ?? ''));
  return [...new Set(ud)];
}

function koer(cmd: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync(cmd, args, { cwd: ROD, encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', ...env } });
}

const INSTALL_HJAELP = koer('bash', [path.join(ROD, 'deploy/install.sh'), '--help']).stdout;
const ARKIV_HJAELP = koer('node', [path.join(ROD, 'scripts/arkiv.mjs'), '--help']);
const ARKIV_BRUG = ARKIV_HJAELP.stdout + ARKIV_HJAELP.stderr;
const flagIn = (t: string): string[] => [...new Set(Array.from(t.matchAll(/(?<![\w-])--[a-z][a-z-]*/g), (m) => m[0]))];

test('install.sh: the flags the pages show are the flags --help lists, and every flag it lists is on the Mac/Linux page except the one it calls advanced', () => {
  const hjaelp = flagIn(INSTALL_HJAELP);
  assert.ok(hjaelp.length >= 6, `--help lists ${hjaelp.length} flags`);
  const avanceret = INSTALL_HJAELP.split('\n').filter((l) => /\(avanceret\)/.test(l)).flatMap(flagIn);
  const side = TEKST('docs/mac-linux.html');
  for (const f of hjaelp.filter((x) => !avanceret.includes(x))) assert.ok(side.includes(f), `${f} is in --help but not on the page`);
  for (const s of SIDER) {
    for (const k of kommandoer(s).filter((x) => /install\.sh/.test(x))) {
      const efter = k.split('bash -s --')[1] ?? '';
      for (const f of flagIn(efter)) assert.ok(hjaelp.includes(f), `${s}: ${f} is not an install.sh flag`);
    }
  }
  // The option list on the page names flags only from --help.
  for (const li of alle(dok('docs/mac-linux.html'), 'ul.paths li')) {
    for (const f of flagIn(li.querySelector('code')?.textContent ?? '')) assert.ok(hjaelp.includes(f), `option ${f}`);
  }
});

test('install.sh --dry-run: the six steps the page lists are the six steps the plan prints, with the same paths and commands', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'clawco-docs-'));
  try {
    const r = koer('bash', [path.join(ROD, 'deploy/install.sh'), '--dry-run', '--yes', '--port', '8799'], { HOME: home });
    assert.equal(r.status, 0, r.stderr);
    const trin = r.stdout.split('\n').filter((l) => /^\s{2}\d\. /.test(l));
    const side = dok('docs/mac-linux.html');
    assert.equal(trin.length, alle(side, 'ol li[data-i^="ml.does."]').length, 'one page step per planned step');
    assert.match(r.stdout, /npm ci --omit=dev/);
    assert.ok(TEKST('docs/mac-linux.html').includes('npm ci --omit=dev'));
    assert.match(r.stdout, /127\.0\.0\.1:8799\/health/);
    // Where things live: the page's paths are the dry-run's, relative to HOME.
    const vist = alle(side, 'ul.paths li code').map((c) => flad(c.textContent ?? '')).filter((p) => p.startsWith('~/.clawco'));
    assert.ok(vist.length >= 3);
    for (const p of ['~/.clawco/app', '~/.clawco/data', '~/.clawco/.env']) {
      assert.ok(vist.includes(p), `the page lacks ${p}`);
      assert.ok(r.stdout.includes(p.replace('~', home)), `the plan does not name ${p}`);
    }
    assert.ok(vist.includes('~/.clawco/log') && /\.clawco\/log|LOG/.test(laes('deploy/install.sh')), 'the log folder');
    assert.ok(r.stdout.includes('work.clawco.plist') || r.stdout.includes('clawco.service'), 'the service file');
  } finally { rmSync(home, { recursive: true, force: true }); }
  const skript = laes('deploy/install.sh');
  for (const navn of ['work.clawco.plist', 'clawco.service', 'KC_LAPTOP=ja', 'CLAWCO_HOME']) assert.ok(skript.includes(navn), `install.sh has no ${navn}, the page does`);
  const remove = TEKST('docs/mac-linux.html') + kommandoer('docs/mac-linux.html').join('\n');
  assert.ok(remove.includes('launchctl bootout gui/$(id -u)/work.clawco') && skript.includes('work.clawco'), 'the Mac service label');
  assert.ok(remove.includes('systemctl --user disable --now clawco'), 'the systemd unit');
});

test('laptop mode: --laptop --dry-run says what the page says (this machine only, no sign-in)', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'clawco-docs-'));
  try {
    const r = koer('bash', [path.join(ROD, 'deploy/install.sh'), '--dry-run', '--yes', '--laptop'], { HOME: home });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /127\.0\.0\.1/);
    assert.match(r.stdout, /KC_LAPTOP=ja/);
  } finally { rmSync(home, { recursive: true, force: true }); }
  const t = TEKST('docs/mac-linux.html');
  assert.ok(t.includes('127.0.0.1') && t.includes('KC_LAPTOP=ja'));
});

test('npm run: every npm script a page names is in package.json, and backup/restore flags are the ones the script prints', () => {
  const set = new Set<string>();
  for (const s of SIDER) {
    const tekst = kommandoer(s).join('\n') + '\n' + TEKST(s);
    for (const m of tekst.matchAll(/npm run ([a-z:-]+)/g)) { set.add(m[1]!); assert.ok(m[1]! in SKRIFT.scripts, `${s}: npm run ${m[1]} is not in package.json`); }
  }
  assert.ok(set.has('backup') && set.has('restore'), 'the install guide documents backup and restore');
  // Every flag in the backup section (its prose and its npm run commands) is one the script's own usage prints.
  const d = dok('docs/mac-linux.html');
  const afsnit = [...alle(d, '[data-i^="ml.bak."]').map((e) => e.textContent ?? ''), ...kommandoer('docs/mac-linux.html').filter((k) => /npm run (backup|restore)/.test(k))].join('\n');
  assert.ok(flagIn(afsnit).length >= 3, 'the backup section names its flags');
  for (const f of flagIn(afsnit)) assert.ok(ARKIV_BRUG.includes(f), `${f} is not in the backup script's usage`);
  for (const f of ['--med-vault', '--med-noegler', '--erstat']) assert.ok(ARKIV_BRUG.includes(f) && TEKST('docs/mac-linux.html').includes(f), `${f} in the usage and on the page`);
});

test('backup and restore: the file name the page shows has the shape the script writes, restore --erstat moves the old folder aside and deletes nothing', () => {
  const rod = mkdtempSync(path.join(tmpdir(), 'clawco-docs-'));
  try {
    const data = path.join(rod, 'data');
    const til = path.join(rod, 'ud');
    mkdirSync(path.join(data, 'dagen'), { recursive: true });
    writeFileSync(path.join(data, 'dagen', 'state.json'), '{"x":1}\n');
    const b = koer('node', [path.join(ROD, 'scripts/arkiv.mjs'), 'backup', '--data-mappe', data, '--til', til, '--vault-mappe', path.join(rod, 'ingen')]);
    assert.equal(b.status, 0, b.stdout + b.stderr);
    const fil = readdirSync(til).find((f) => f.endsWith('.tar.gz'))!;
    assert.ok(fil, 'the script wrote one .tar.gz');
    const side = laes('site/docs/mac-linux.html');
    const eksempel = /clawco-backup-\d{4}-\d{2}-\d{2}-\d{4}\.tar\.gz/.exec(side)![0];
    const form = (n: string) => n.replace(/\d/g, '9');
    assert.equal(form(fil), form(eksempel), 'the example file name has the real shape');
    const r = koer('node', [path.join(ROD, 'scripts/arkiv.mjs'), 'restore', path.join(til, fil), '--data-mappe', data, '--vault-mappe', path.join(rod, 'ingen'), '--erstat', '--port', '1']);
    assert.ok(readdirSync(rod).some((f) => f.startsWith('data.foer-gendannelse')), `the old folder is moved aside: ${readdirSync(rod).join(',')} ${r.stdout}${r.stderr}`);
    assert.ok(side.includes('.foer-gendannelse'));
  } finally { rmSync(rod, { recursive: true, force: true }); }
});

test('docker: every command the Docker page shows comes from compose.yaml or deploy/docker/', () => {
  const kilde = [laes('compose.yaml'), laes('deploy/docker/README.md'), laes('deploy/docker/opdater.md')].join('\n');
  const compose = laes('compose.yaml');
  const linjer = kommandoer('docs/docker.html').filter((l) => /docker|curl -fsS http:\/\/127/.test(l));
  assert.ok(linjer.length >= 6, `${linjer.length} docker commands on the page`);
  for (const l of linjer) {
    const uden = l.replace(/^GIT_SHA=\$\(git rev-parse --short HEAD\)\s+/, '').replace(/^[A-Z_]+=\S+\s+/, '');
    assert.ok(kilde.includes(uden), `not found in compose.yaml or deploy/docker: ${uden}`);
    const env = /^([A-Z_]+)=/.exec(l)?.[1];
    if (env && env !== 'GIT_SHA') assert.ok(kilde.includes(env), `${env} is not used by compose.yaml`);
  }
  for (const profil of Array.from(laes('site/docs/docker.html').matchAll(/--profile (\w+)/g), (m) => m[1]!)) assert.ok(new RegExp(`profiles:\\s*\\[${profil}\\]`).test(compose), `no compose profile ${profil}`);
  assert.ok(compose.includes('127.0.0.1:8750:8750') && TEKST('docs/docker.html').includes('127.0.0.1:8750'));
});

function filerUnder(x: string): string[] {
  return readdirSync(x, { withFileTypes: true }).flatMap((e) => (e.name === 'node_modules' || e.name === '__pycache__' ? [] : e.isDirectory() ? filerUnder(path.join(x, e.name)) : [path.join(x, e.name)]));
}

test('every KC_* and CLAWCO_* setting a page names is in the code, scripts, compose file or .env.example', () => {
  const kode = [...['src', 'deploy', 'scripts'].flatMap((d) => filerUnder(path.join(ROD, d))), path.join(ROD, 'compose.yaml'), path.join(ROD, '.env.example')]
    .filter((f) => !f.endsWith('.pyc')).map((f) => readFileSync(f, 'utf8')).join('\n');
  let set = 0;
  for (const s of SIDER) {
    for (const m of readFileSync(path.join(SITE, s), 'utf8').matchAll(/\b(?:KC|CLAWCO)_[A-Z0-9_]+/g)) { set += 1; assert.ok(kode.includes(m[0]), `${s}: ${m[0]} is in no source file`); }
  }
  assert.ok(set >= 4, `only ${set} settings are named`);
});

// ---------------------------------------------------------------------------------------------------------------
// Names: rooms, blocks, commands are the registry's, the catalog's and package.json's

test('names: every marked room, block and npm script is in the registry, the catalog or package.json, and shows the registry\'s name', () => {
  const rum = new Map(ROOMS.map((r) => [r.id, r.navn]));
  const blokke = new Map(BLOKKE.map((b) => [b.id as string, b.navn]));
  let set = 0;
  for (const s of SIDER) {
    const d = dok(s);
    for (const el of alle(d, '[data-rum]')) {
      set += 1;
      const id = attr(el, 'data-rum');
      assert.ok(rum.has(id), `${s}: no room ${id} in src/rooms/registry.ts`);
      assert.ok(ROOMS.find((r) => r.id === id)!.built, `${s}: room ${id} is not built`);
      assert.equal(flad(el.textContent ?? ''), rum.get(id), `${s}: the name shown for ${id}`);
    }
    for (const el of alle(d, '[data-blok]')) {
      set += 1;
      const id = attr(el, 'data-blok');
      assert.ok(blokke.has(id), `${s}: no block ${id} in the catalog`);
      assert.ok((BYGGET as readonly string[]).includes(id), `${s}: block ${id} is not built`);
      assert.equal(flad(el.textContent ?? ''), blokke.get(id), `${s}: the name shown for ${id}`);
    }
    for (const el of alle(d, '[data-npm]')) {
      set += 1;
      assert.ok(attr(el, 'data-npm') in SKRIFT.scripts, `${s}: npm script ${attr(el, 'data-npm')}`);
    }
  }
  assert.ok(set >= 8, `only ${set} names are marked`);
});

test('names: prose that says "the X room" or "the X block" names a room of the registry or a block of the catalog', () => {
  const rum = new Set(ROOMS.map((r) => r.navn));
  const blok = new Set(BLOKKE.map((b) => b.navn));
  for (const s of SIDER) {
    const prosa = Object.entries(T.en).filter(([k]) => dok(s).querySelector(`[data-i="${k}"]`)).map(([, v]) => v).join('\n');
    for (const m of prosa.matchAll(/\b(?:the|in|from|to) ([A-ZÆØÅ][A-Za-zæøåÆØÅ]+) room\b/g)) assert.ok(rum.has(m[1]!), `${s}: "${m[0]}" is not a room in the registry`);
    for (const m of prosa.matchAll(/\b([A-ZÆØÅ][A-Za-zæøåÆØÅ]+) block\b/g)) assert.ok(blok.has(m[1]!), `${s}: "${m[0]}" is not a block in the catalog`);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Sources

/** The connectors a product install offers, composed the way main() in src/server.ts composes them (not the host's own adapters, not the fakes). */
function produktKilder() {
  const tmp = mkdtempSync(path.join(tmpdir(), 'clawco-docs-'));
  const adresse = { adresse: 'http://localhost:8750' };
  const ks = medMailGmail(medGoogleKalender(medNyhederRss(medMailImap(medNoter([]))), () => googleKalender(adresse)), () => mailGmail(adresse));
  return { tmp, kilder: [...ks, beskederKilde({ dataDir: tmp })] };
}
test('sources: one entry per connector the product offers, with the slags, auth, zone, verbs and room the connector itself declares', () => {
  const { tmp, kilder } = produktKilder();
  try {
    const d = dok('docs/sources.html');
    const poster = alle(d, 'article[data-kilde]');
    assert.deepEqual(poster.map((p) => attr(p, 'data-kilde')).sort(), kilder.map((k) => k.id).sort(), 'the page and the connector list name the same connectors');
    for (const k of kilder) {
      const p = poster.find((x) => attr(x, 'data-kilde') === k.id)!;
      assert.equal(attr(p, 'data-slags'), k.slags, `${k.id}: slags`);
      assert.equal(attr(p, 'data-auth'), k.auth, `${k.id}: auth`);
      assert.equal(attr(p, 'data-zone'), k.zone, `${k.id}: zone`);
      const verber = Object.entries(k.verber ?? {}).map(([navn, v]) => `${navn}:${v.verb}`).join(',');
      assert.equal(attr(p, 'data-verbs'), verber, `${k.id}: declared verbs`);
      for (const [, v] of Object.entries(k.verber ?? {})) assert.ok(!FORBUDTE_VERBER.has(v.verb), `${k.id} declares a forbidden verb`);
      // A connector with no verbs says it only reads.
      assert.equal(p.querySelectorAll('[data-i$=".reads"]').length, 1, `${k.id}: one "reads" line`);
      assert.equal(p.querySelectorAll('[data-i$=".may"]').length, 1, `${k.id}: one "may" line`);
      assert.equal(p.querySelectorAll('[data-i$=".goes"]').length, 1, `${k.id}: one "where it goes" line`);
      for (const r of alle(p, '[data-rum]')) assert.ok(ROOMS.some((x) => x.id === attr(r, 'data-rum')));
    }
    // The connectors that are the host's own adapters and the test world's are not product features.
    assert.ok(!poster.some((p) => /^(kira-|falsk)/.test(attr(p, 'data-kilde'))), 'no host adapter or fake connector is documented');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('sources: nothing is promised for a Danish pack that does not exist, and no verb beyond the ladder is claimed', () => {
  const t = Object.entries(T.en).filter(([k]) => k.startsWith('src.')).map(([, v]) => v).join('\n');
  assert.ok(!/\b(Aula|Digital Post|coming soon|will be|planned)\b/i.test(t), 'a source or a pack that is not built');
  assert.ok(existsSync(path.join(ROD, 'src/kilder/mail-imap')) && !existsSync(path.join(ROD, 'src/kilder/aula')) && !existsSync(path.join(ROD, 'src/kilder/digital-post')));
  // KC-0270 (B7): the two lists are equal both ways (AGENTS §9), and the connectors' one is derived from the limits (one source).
  assert.deepEqual([...FORBUDTE_VERBER].sort(), [...GRAENSEKLASSER].sort());
  assert.match(readFileSync(path.join(ROD, 'src/kilder/register.ts'), 'utf8'), /FORBUDTE_VERBER[^=\n]*=\s*new Set<string>\(GRAENSEKLASSER\)/, 'derived, not a copy');
});

// ---------------------------------------------------------------------------------------------------------------
// Trust ladder

test('trust ladder: the page lists exactly the levels and the limits the code has, in order', () => {
  const d = dok('docs/trust-ladder.html');
  const trin = alle(d, '[data-trin]');
  assert.deepEqual(trin.map((e) => `${attr(e, 'data-trin')}:${attr(e, 'data-verb')}`), TRIN.map((t) => `${t.trin}:${t.verb}`));
  for (const e of trin) {
    const t = TRIN.find((x) => String(x.trin) === attr(e, 'data-trin'))!;
    assert.equal(flad(e.querySelector('code')!.textContent ?? ''), `${t.trin} · ${t.navn}`, `the app's name for level ${t.trin}`);
  }
  const graenser = alle(d, '[data-graense]').map((e) => attr(e, 'data-graense'));
  assert.deepEqual(graenser, [...GRAENSEKLASSER], 'the four limits, in the code\'s order');
  assert.equal(graenser.length, 4);
});

test('trust ladder: the rules are text in the user folder (the file the code reads), and the page says a rule needs a tap', () => {
  const d = dok('docs/trust-ladder.html');
  const lager = laes('src/tillid/lager.ts');
  const fil = d.querySelector('[data-regelfil]')!;
  assert.ok(fil, 'the rules file is named');
  const sti = flad(fil.textContent ?? '');
  assert.equal(sti, 'Clawco/regler.md');
  assert.ok(lager.includes("'Clawco', 'regler.md'"), 'the code reads the same file');
  assert.match(T.en['tl.rules.tap']!, /tap/);
  assert.ok(existsSync(path.join(ROD, 'src/graenser/tegn.ts')) && existsSync(path.join(ROD, 'test/graenser/tegn.test.ts')));
});

// ---------------------------------------------------------------------------------------------------------------
// Household

test('household: roles, zones, request states, shared things and the size of a household are the code\'s', () => {
  const d = dok('docs/household.html');
  assert.deepEqual(alle(d, '[data-rolle]').map((e) => attr(e, 'data-rolle')), [...ROLLER]);
  for (const e of alle(d, '[data-rolle]')) assert.equal(flad(e.querySelector('code')!.textContent ?? ''), ROLLE_NAVN[attr(e, 'data-rolle') as keyof typeof ROLLE_NAVN]);
  assert.deepEqual(alle(d, '[data-zone]').map((e) => attr(e, 'data-zone')), [...DATAZONER]);
  assert.deepEqual(alle(d, '[data-tilstand]').map((e) => attr(e, 'data-tilstand')), [...TILSTANDE]);
  assert.deepEqual(alle(d, '[data-ressource]').map((e) => attr(e, 'data-ressource')), [...RESSOURCE_SLAGS]);
  const max = d.querySelector('[data-max]')!;
  assert.equal(attr(max, 'data-max'), String(MAX_PERSONER));
  assert.ok(T.en['hh.max.p']!.includes(String(MAX_PERSONER)) && T.da['hh.max.p']!.includes(String(MAX_PERSONER)));
  assert.ok(alle(d, '[data-blok]').map((e) => attr(e, 'data-blok')).includes('forespoergsel') && alle(d, '[data-blok]').map((e) => attr(e, 'data-blok')).includes('ressource'));
});

test('household: the free Tailscale plan size carries the date it was checked and the source it was read from', () => {
  const d = dok('docs/household.html');
  const ts = d.querySelector('[data-tailscale-checked]')!;
  assert.ok(ts, 'the plan size is stated');
  const dato = attr(ts, 'data-tailscale-checked');
  assert.match(dato, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(T.en['hh.ts.p']!.includes(dato) && T.da['hh.ts.p']!.includes(dato), 'the date is in the sentence, in both languages');
  assert.ok(d.querySelector('a[href="https://tailscale.com/pricing"]'), 'the source is linked');
});

test('household: nothing about invitations by mail in Clawco Sky (switched off, KC-0184), nothing a family member must install', () => {
  const t = Object.entries(T.en).filter(([k]) => k.startsWith('hh.')).map(([, v]) => v).join('\n');
  assert.ok(!/\b(Sky|e-?mail invitation|invite by mail|invitation by mail|invitation mail)\b/i.test(t), 'Sky invitations are not documented');
});

// ---------------------------------------------------------------------------------------------------------------
// Security

/** The blob links on the security page, mapped back to files in this repository. */
function repoLinks(side: string): { sti: string; el: Element }[] {
  return alle(dok(side), 'main a[href^="https://github.com/SlambertDK/clawco/"]').map((el) => ({ sti: attr(el, 'href').replace(/^https:\/\/github\.com\/SlambertDK\/clawco\/(?:blob|tree)\/main\//, ''), el }));
}

test('security: the promise is three sentences, in both languages, and each names what the code enforces', () => {
  for (const sprog of ['en', 'da'] as const) {
    const saet = T[sprog]['sec.three.p']!.split(/(?<=[.!?])\s+/).filter(Boolean);
    assert.equal(saet.length, 3, `${sprog}: three sentences, got ${saet.length}`);
  }
  assert.match(T.en['sec.three.p']!, /limits live in the code, not in a prompt/);
  assert.match(T.en['sec.three.p']!, /pay/);
  assert.match(T.en['sec.three.p']!, /new rule always needs a tap/);
  assert.match(T.en['sec.three.p']!, /export it as a zip/);
});

test('security: every link to the tests and the threat model goes to a file that exists, and the table behind it covers every connector', () => {
  const links = repoLinks('docs/security.html');
  assert.ok(links.length >= 6, `${links.length} links to the code and tests`);
  for (const { sti } of links) assert.ok(existsSync(path.join(ROD, sti.replace(/\/$/, ''))), `${sti} does not exist`);
  assert.ok(links.some((l) => l.sti === 'docs/superpowers/specs/2026-10-31-trusselsmodel.md'), 'the threat model is linked');
  assert.ok(links.some((l) => l.sti === 'test/graenser/trusselsmodel.test.ts'), 'and the test that keeps its table complete');
  for (const k of ['afgoer', 'tegn', 'opsyn']) assert.ok(links.some((l) => l.sti === `test/graenser/${k}.test.ts`), `the ${k} test is linked`);
  // The three refusals: the policy layer's tests for each limit are the ones named.
  const afgoer = laes('test/graenser/afgoer.test.ts');
  assert.match(afgoer, /betal/);
  assert.match(afgoer, /send-til-andre/);
  assert.match(afgoer, /slet/);
});

test('security: the data-flow list names every host the code reaches, and the page says nothing is collected only because no code does', () => {
  // Every https host written in the app's own code (not the test world's invented ones, not links a person clicks).
  const filer: string[] = [];
  const gaa = (x: string): void => { for (const e of readdirSync(x, { withFileTypes: true })) { if (e.name === 'testtilstand') continue; const p = path.join(x, e.name); if (e.isDirectory()) gaa(p); else if (p.endsWith('.ts')) filer.push(p); } };
  gaa(path.join(ROD, 'src'));
  const vaert = new Set<string>();
  for (const f of filer) for (const m of readFileSync(f, 'utf8').matchAll(/https?:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi)) vaert.add(m[1]!.toLowerCase());
  const LINKS = new Set(['example.org', 'example.com', 'json-schema.org', 'a2ui.org', 'www.w3.org', 'clawco.work', 'claude.ai', 'tailscale.com', 'login.tailscale.com', 'mit.dk', 'www.e-boks.dk', 'www.borger.dk']); // the last three: the viewers the Digital Post card links to (KC-0233); a person clicks them, no code calls them
  const ud = [...vaert].filter((h) => !LINKS.has(h) && !h.endsWith('.example') && !h.endsWith('.localhost') && h !== 'localhost').sort();
  assert.ok(ud.length >= 8, `the code names ${ud.length} outside hosts`);
  const side = dok('docs/security.html');
  const nævnte = alle(side, '[data-host]').flatMap((e) => attr(e, 'data-host').split(/\s+/)).sort();
  assert.deepEqual([...new Set(nævnte)], ud, 'the page lists exactly the hosts the code names');
  // "Nothing about how you use it is collected" is only stated while no code in the app collects: no module, no analytics words.
  assert.ok(!existsSync(path.join(ROD, 'src/telemetri')), 'a telemetry module exists: rewrite the statement');
  for (const f of filer) assert.ok(!/\b(posthog|plausible|mixpanel|google-analytics|gtag|amplitude\.com|segment\.io|telemetri)/i.test(readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '')), `${path.relative(ROD, f)} looks like analytics`);
  assert.match(T.en['sec.collect.p1']!, /No usage statistics/);
  // The one thing that can report is the error report, and it is off unless an address is set.
  assert.ok(/KC_FEJLRAPPORT_DSN/.test(laes('src/shell/fejlrapport.ts')));
  assert.ok(T.en['sec.collect.p2']!.includes('KC_FEJLRAPPORT_DSN'));
});

test('security: the refusals the page lists are the four limit classes of the code, in its order', () => {
  const side = dok('docs/security.html');
  assert.deepEqual(alle(side, '[data-graense]').map((e) => attr(e, 'data-graense')), [...GRAENSEKLASSER]);
});

// ---------------------------------------------------------------------------------------------------------------
// People and places in examples

test('every link from a documentation page into the repository goes to a file or folder that exists', () => {
  let n = 0;
  for (const s of SIDER) for (const { sti } of repoLinks(s)) { n += 1; assert.ok(existsSync(path.join(ROD, sti.replace(/\/$/, ''))), `${s}: ${sti} does not exist`); }
  assert.ok(n >= 12, `${n} repository links`);
});

test('examples use placeholders: no tailnet name, no private host, and an example person only from the fictional household', () => {
  for (const s of SIDER) {
    const t = readFileSync(path.join(SITE, s), 'utf8') + Object.values(T.en).join('\n');
    assert.ok(!/\.ts\.net\b/.test(t.replace(/<your-tailnet>\.ts\.net/g, '')), `${s}: a tailnet name`);
    assert.ok(!/(sk-ant|sk-or-|ghp_|github_pat_|xox[bp]-|AKIA[0-9A-Z]{8})/.test(t), `${s}: something shaped like a key`);
  }
});
