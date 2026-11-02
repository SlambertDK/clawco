import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// KC-0158: deploy/opdater.sh against a temp install (made by install.sh --no-service), a local bare origin with
// two commits, a stub service runner and a stub health probe — no network, no systemd/launchd, no real server.
const ROD = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = path.join(ROD, 'deploy', 'opdater.sh');
const INSTALL = path.join(ROD, 'deploy', 'install.sh');
const PORT = '8794';

let tmp = '';

// A git hook (pre-push runs npm test) exports GIT_DIR & co.; they would point these calls at the real repo.
const GIT_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', env: GIT_ENV });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

before(() => { tmp = mkdtempSync(path.join(os.tmpdir(), 'kc-opdater-')); });
after(() => { rmSync(tmp, { recursive: true, force: true }); });

type Resultat = { code: number | null; out: string; err: string };

function koer(script: string, args: string[], env: Record<string, string>): Promise<Resultat> {
  return new Promise((resolve) => {
    const p = spawn('bash', [script, ...args], { env: { PATH: process.env['PATH'] ?? '', TMPDIR: tmp, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += String(d); });
    p.stderr.on('data', (d) => { err += String(d); });
    p.on('close', (code) => { resolve({ code, out, err }); });
    p.stdin.end('');
  });
}

/** sha256 over every file's relative path and bytes, in a stable order; '' for a folder that does not exist. */
function trae(dir: string): string {
  if (!existsSync(dir)) return '';
  const h = createHash('sha256');
  const gaa = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { h.update(`D:${path.relative(dir, p)}\n`); gaa(p); } else { h.update(`F:${path.relative(dir, p)}\n`); h.update(readFileSync(p)); }
    }
  };
  gaa(dir);
  return h.digest('hex');
}
const fil = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

type Fixture = {
  home: string; rod: string; app: string; env: string; data: string; vault: string; stub: string; bare: string;
  opEnv: Record<string, string>;
  gammel: string;
  /** Commit and push one more commit to the origin; returns its full sha. */
  pushNy: (filer?: Record<string, string>) => string;
  kort: (sha: string) => string;
};

let taeller = 0;
const SECRET = 'kc-sentinel-opdater-nogle-1234567890';

/** A fresh install of an origin that has ONE commit; the stubs say the code at that commit is what runs. */
function lavFixture(opts: { medDeploy?: boolean } = {}): Fixture {
  const dir = path.join(tmp, `f${++taeller}`);
  mkdirSync(dir);
  const kilde = path.join(dir, 'kilde');
  mkdirSync(kilde);
  writeFileSync(path.join(kilde, 'package.json'), '{"name":"clawco-fixture","version":"0.0.0","private":true}\n');
  writeFileSync(path.join(kilde, 'package-lock.json'), JSON.stringify({ name: 'clawco-fixture', version: '0.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'clawco-fixture', version: '0.0.0' } } }, null, 2) + '\n');
  copyFileSync(path.join(ROD, '.env.example'), path.join(kilde, '.env.example'));
  if (opts.medDeploy) {
    mkdirSync(path.join(kilde, 'deploy'));
    copyFileSync(INSTALL, path.join(kilde, 'deploy', 'install.sh'));
    copyFileSync(SCRIPT, path.join(kilde, 'deploy', 'opdater.sh'));
  }
  git(kilde, 'init', '-q');
  git(kilde, 'add', '.');
  git(kilde, 'commit', '-q', '-m', 'et');
  const bare = path.join(dir, 'clawco.git');
  git(dir, 'clone', '-q', '--bare', kilde, bare);
  const home = path.join(dir, 'hjem');
  mkdirSync(home);
  const rod = path.join(home, '.clawco');
  const base: Record<string, string> = { HOME: home, CLAWCO_REPO: bare, CLAWCO_HOME: rod };
  const inst = spawnSync('bash', [INSTALL, '--yes', '--no-service', '--port', PORT], { env: { PATH: process.env['PATH'] ?? '', TMPDIR: tmp, ...base }, encoding: 'utf8' });
  assert.equal(inst.status, 0, inst.stdout + inst.stderr);

  const app = path.join(rod, 'app');
  const env = path.join(rod, '.env');
  const data = path.join(rod, 'data');
  const vault = path.join(rod, 'noter');
  mkdirSync(vault);
  writeFileSync(path.join(data, 'min-note.md'), 'min egen\n');
  writeFileSync(path.join(data, 'indstillinger.json'), '{"udbyder":"min-egen"}\n');
  writeFileSync(path.join(vault, 'regler.md'), 'mine regler\n');
  appendFileSync(env, `KC_VAULT_DIR=${vault}\nKC_HERMES_API_KEY=${SECRET}\n`);

  // The stub service: "restarting" starts whatever the app folder's HEAD is, unless that sha is listed as bad.
  const stub = path.join(dir, 'stub');
  mkdirSync(stub);
  writeFileSync(path.join(stub, 'genstart.sh'), `#!/bin/sh
sha=$(git -C "$CLAWCO_HOME/app" rev-parse --short HEAD) || exit 1
echo "$sha" >> "${stub}/genstarter"
if grep -qx "$sha" "${stub}/daarlig" 2>/dev/null; then rm -f "${stub}/koerer"; else echo "$sha" > "${stub}/koerer"; fi
`);
  writeFileSync(path.join(stub, 'health.sh'), `#!/bin/sh
[ -f "${stub}/koerer" ] || exit 1
printf '{"sha":"%s","uptimeSec":7}\\n' "$(cat "${stub}/koerer")"
`);
  chmodSync(path.join(stub, 'genstart.sh'), 0o755);
  chmodSync(path.join(stub, 'health.sh'), 0o755);
  const gammel = git(app, 'rev-parse', '--short', 'HEAD');
  writeFileSync(path.join(stub, 'koerer'), gammel + '\n');

  const arbejde = path.join(dir, 'arbejde');
  git(dir, 'clone', '-q', bare, arbejde);
  const pushNy = (filer: Record<string, string> = { 'NY.md': 'ny\n' }): string => {
    for (const [n, t] of Object.entries(filer)) { mkdirSync(path.dirname(path.join(arbejde, n)), { recursive: true }); writeFileSync(path.join(arbejde, n), t); }
    git(arbejde, 'add', '.');
    git(arbejde, 'commit', '-q', '-m', 'to');
    git(arbejde, 'push', '-q', 'origin', 'HEAD');
    return git(arbejde, 'rev-parse', 'HEAD');
  };
  const opEnv = {
    ...base,
    CLAWCO_GENSTART: path.join(stub, 'genstart.sh'),
    CLAWCO_HEALTH_KOMMANDO: path.join(stub, 'health.sh'),
    CLAWCO_VENTETID: '2',
    CLAWCO_VENTEPAUSE: '0.1',
  };
  return { home, rod, app, env, data, vault, stub, bare, opEnv, gammel, pushNy, kort: (sha) => git(app, 'rev-parse', '--short', sha) };
}

const genstarter = (f: Fixture): string[] => (existsSync(path.join(f.stub, 'genstarter')) ? readFileSync(path.join(f.stub, 'genstarter'), 'utf8').trim().split('\n') : []);

test('opdater.sh is wrapped in one function and called on the last line (a truncated download runs nothing)', async () => {
  const tekst = readFileSync(SCRIPT, 'utf8');
  assert.equal(tekst.trimEnd().split('\n').at(-1), 'opdater "$@"');
  const f = lavFixture();
  f.pushNy();
  const foer = trae(f.rod);
  for (const andel of [0.3, 0.6, 0.9]) {
    const kort = path.join(tmp, `kort-${andel}.sh`);
    writeFileSync(kort, tekst.slice(0, Math.floor(tekst.length * andel)));
    await koer(kort, [], f.opEnv);
  }
  assert.equal(trae(f.rod), foer, 'a truncated script must not change anything');
  assert.deepEqual(genstarter(f), []);
});

test('happy path: the code moves to the new sha, the service restarts once, and data, notes and .env are byte-identical', async () => {
  const f = lavFixture();
  const ny = f.pushNy();
  const nyKort = git(f.bare, 'rev-parse', '--short', ny);
  const foer = { data: trae(f.data), vault: trae(f.vault), env: fil(f.env), envMode: statSync(f.env).mode & 0o777, envMtime: statSync(f.env).mtimeMs };
  const r = await koer(SCRIPT, [], f.opEnv);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(git(f.app, 'rev-parse', 'HEAD'), ny);
  assert.equal(git(f.app, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.deepEqual(genstarter(f), [nyKort], 'exactly one restart, on the new code');
  // Plain Danish: old sha, new sha and uptime.
  assert.ok(r.out.includes(f.gammel), r.out);
  assert.ok(r.out.includes(nyKort), r.out);
  assert.match(r.out, /opdateret/i);
  assert.match(r.out, /7 sekunder/);
  // The invariant: nothing the user owns changed.
  assert.equal(trae(f.data), foer.data, 'user folder');
  assert.equal(trae(f.vault), foer.vault, 'notes folder');
  assert.equal(fil(f.env), foer.env, '.env content');
  assert.equal(statSync(f.env).mode & 0o777, foer.envMode);
  assert.equal(statSync(f.env).mtimeMs, foer.envMtime, '.env is never rewritten');
  // The safety copy: .env and the settings file, private, overwritten each time, never printed.
  const sikker = path.join(f.rod, 'backup-before-update');
  assert.equal(statSync(sikker).mode & 0o777, 0o700);
  assert.equal(readFileSync(path.join(sikker, '.env'), 'utf8'), readFileSync(f.env, 'utf8'));
  assert.equal(statSync(path.join(sikker, '.env')).mode & 0o777, 0o600);
  assert.equal(readFileSync(path.join(sikker, 'indstillinger.json'), 'utf8'), '{"udbyder":"min-egen"}\n');
  assert.equal(statSync(path.join(sikker, 'indstillinger.json')).mode & 0o777, 0o600);
  assert.ok(!(r.out + r.err).includes(SECRET), 'a key must never be printed');
  // A second update overwrites the copy instead of piling up.
  writeFileSync(path.join(f.data, 'indstillinger.json'), '{"udbyder":"anden"}\n');
  f.pushNy({ 'TRE.md': 'tre\n' });
  assert.equal((await koer(SCRIPT, [], f.opEnv)).code, 0);
  assert.deepEqual(readdirSync(sikker).sort(), ['.env', 'indstillinger.json']);
  assert.equal(readFileSync(path.join(sikker, 'indstillinger.json'), 'utf8'), '{"udbyder":"anden"}\n');
});

test('already current: says so, restarts nothing, writes nothing', async () => {
  const f = lavFixture();
  const foer = { data: trae(f.data), vault: trae(f.vault), env: fil(f.env), envMtime: statSync(f.env).mtimeMs };
  const r = await koer(SCRIPT, [], f.opEnv);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /allerede/i);
  assert.ok(r.out.includes(f.gammel), r.out);
  assert.deepEqual(genstarter(f), []);
  assert.equal(existsSync(path.join(f.rod, 'backup-before-update')), false);
  assert.equal(git(f.app, 'rev-parse', '--short', 'HEAD'), f.gammel);
  assert.equal(trae(f.data), foer.data);
  assert.equal(trae(f.vault), foer.vault);
  assert.equal(fil(f.env), foer.env);
  assert.equal(statSync(f.env).mtimeMs, foer.envMtime);
});

test('health never answers on the new version: rolled back to the old sha, restarted, old sha answers, Danish message with a filtered log tail, exit non-zero', async () => {
  const f = lavFixture();
  const ny = f.pushNy();
  const nyKort = git(f.bare, 'rev-parse', '--short', ny);
  writeFileSync(path.join(f.stub, 'daarlig'), nyKort + '\n');
  mkdirSync(path.join(f.rod, 'log'), { recursive: true });
  const linjer: string[] = [];
  for (let i = 1; i <= 25; i++) linjer.push(`logline ${i}`);
  linjer[22] = `KC_HERMES_API_KEY=${SECRET}`;
  linjer[23] = 'curl -H "Authorization: Bearer abcdefghijklmnop" x'; // gitleaks:allow (a fake token: the log filter must hide it)
  linjer[24] = 'Error: cannot find module (linje 25)';
  writeFileSync(path.join(f.rod, 'log', 'clawco.log'), linjer.join('\n') + '\n');
  const foer = { data: trae(f.data), vault: trae(f.vault), env: fil(f.env) };
  const r = await koer(SCRIPT, [], f.opEnv);
  assert.notEqual(r.code, 0, r.out + r.err);
  assert.equal(git(f.app, 'rev-parse', '--short', 'HEAD'), f.gammel, 'back on the old sha');
  assert.equal(git(f.app, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.deepEqual(genstarter(f), [nyKort, f.gammel], 'restarted on the new code, then on the old');
  assert.equal(readFileSync(path.join(f.stub, 'koerer'), 'utf8').trim(), f.gammel, 'the old version answers again');
  const tekst = r.out + r.err;
  assert.match(tekst, /tilbage/i);
  assert.ok(tekst.includes(f.gammel) && tekst.includes(nyKort), tekst);
  assert.ok(tekst.includes('logline 6') && tekst.includes('logline 21') && tekst.includes('cannot find module'), 'the last 20 log lines');
  assert.ok(!tekst.includes('logline 5\n') && !tekst.includes('logline 4'), 'only the last 20');
  assert.ok(!tekst.includes(SECRET) && !/Bearer abcdef/.test(tekst), 'nothing that looks like a key is printed');
  assert.equal(trae(f.data), foer.data);
  assert.equal(trae(f.vault), foer.vault);
  assert.equal(fil(f.env), foer.env);
});

test('a new version whose dependencies fail to install is rolled back too', async () => {
  const f = lavFixture();
  const ny = f.pushNy({ 'package-lock.json': 'ikke json\n' });
  const nyKort = git(f.bare, 'rev-parse', '--short', ny);
  const r = await koer(SCRIPT, [], f.opEnv);
  assert.notEqual(r.code, 0, r.out + r.err);
  assert.equal(git(f.app, 'rev-parse', '--short', 'HEAD'), f.gammel);
  assert.match(r.out + r.err, /tilbage/i);
  assert.ok((r.out + r.err).includes(nyKort));
  assert.equal(readFileSync(path.join(f.stub, 'koerer'), 'utf8').trim(), f.gammel);
});

test('a user folder (or notes folder) inside the code folder, or containing it, is refused before anything changes', async () => {
  const tilfaelde: Array<[string, string]> = [
    ['data inside app', `KC_DATA_DIR=@APP@/data`],
    ['data is the app itself', `KC_DATA_DIR=@APP@`],
    ['data relative (the service runs in the app folder)', 'KC_DATA_DIR=./data'],
    ['data contains the app', `KC_DATA_DIR=@ROD@`],
    ['notes inside app', `KC_VAULT_DIR=@APP@/noter`],
    ['inbox inside app', `KC_VAULT_INBOX=@APP@/noter/00-Indbakke`],
  ];
  for (const [navn, linje] of tilfaelde) {
    const f = lavFixture();
    f.pushNy();
    const tekst = readFileSync(f.env, 'utf8').split('\n').filter((l) => !/^KC_(DATA_DIR|VAULT_DIR|VAULT_INBOX)=/.test(l) || (navn.startsWith('notes') && l.startsWith('KC_DATA_DIR')) || (navn.startsWith('inbox') && l.startsWith('KC_DATA_DIR')));
    writeFileSync(f.env, tekst.join('\n') + '\n' + linje.replace(/@APP@/g, f.app).replace(/@ROD@/g, f.rod) + '\n');
    const foer = { env: fil(f.env), data: trae(f.data), kode: trae(f.app) };
    const r = await koer(SCRIPT, [], f.opEnv);
    assert.notEqual(r.code, 0, `${navn}: ${r.out}${r.err}`);
    assert.match(r.out + r.err, /må ikke ligge i|må ikke indeholde/, navn);
    assert.equal(git(f.app, 'rev-parse', '--short', 'HEAD'), f.gammel, `${navn}: code untouched`);
    assert.equal(trae(f.app), foer.kode, `${navn}: app folder untouched`);
    assert.equal(fil(f.env), foer.env, navn);
    assert.equal(trae(f.data), foer.data, navn);
    assert.deepEqual(genstarter(f), [], navn);
    assert.equal(existsSync(path.join(f.rod, 'backup-before-update')), false, navn);
  }
});

test('no install in this place: a plain message and nothing created', async () => {
  const home = mkdtempSync(path.join(tmp, 'tom-'));
  const r = await koer(SCRIPT, [], { HOME: home, CLAWCO_HOME: path.join(home, '.clawco') });
  assert.notEqual(r.code, 0);
  assert.match(r.out + r.err, /ikke installeret|install\.sh/i);
  assert.deepEqual(readdirSync(home), []);
});

test('an install made without a background service gets the new code and a plain note to start it yourself', async () => {
  const f = lavFixture();
  const ny = f.pushNy();
  const { CLAWCO_GENSTART: _g, CLAWCO_HEALTH_KOMMANDO: _h, ...udenStubs } = f.opEnv;
  const r = await koer(SCRIPT, [], udenStubs);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(git(f.app, 'rev-parse', 'HEAD'), ny);
  assert.match(r.out, /baggrundstjeneste/i);
  assert.deepEqual(genstarter(f), []);
});

test('install.sh on a re-run hands over to opdater.sh (the update path), and a first run does not', async () => {
  const f = lavFixture({ medDeploy: true });
  assert.ok(existsSync(path.join(f.app, 'deploy', 'opdater.sh')));
  const ny = f.pushNy();
  const foer = { env: fil(f.env), data: trae(f.data) };
  const r = await koer(INSTALL, ['--yes', '--no-service'], f.opEnv);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /opdater/i);
  assert.equal(git(f.app, 'rev-parse', 'HEAD'), ny);
  assert.equal(fil(f.env), foer.env);
  assert.equal(trae(f.data), foer.data);
  assert.ok(existsSync(path.join(f.rod, 'backup-before-update', '.env')), 'it ran through opdater.sh (safety copy made)');
});

test('shellcheck finds nothing in opdater.sh', (t) => {
  if (spawnSync('shellcheck', ['--version']).error) { t.skip('shellcheck is not installed'); return; }
  const r = spawnSync('shellcheck', ['-s', 'bash', '-x', '-P', path.join(ROD, 'deploy'), SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
});

test('the container path is documented: compose pull and up, user folder untouched', () => {
  const t = readFileSync(path.join(ROD, 'deploy', 'docker', 'opdater.md'), 'utf8');
  assert.match(t, /docker compose pull/);
  assert.match(t, /docker compose up -d/);
  assert.match(t, /clawco-data/);
});
