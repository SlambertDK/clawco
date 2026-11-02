import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFile } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// KC-0156: deploy/install.sh against a temp HOME and a local bare repo — no network, no service.
const ROD = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = path.join(ROD, 'deploy', 'install.sh');
const PORT = '8773';

let tmp = '';
let bare = '';

// A git hook (pre-push runs npm test) exports GIT_DIR & co.; they would point these calls at the real repo.
const GIT_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', env: GIT_ENV });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'kc-install-'));
  const kilde = path.join(tmp, 'kilde');
  mkdirSync(kilde);
  writeFileSync(path.join(kilde, 'package.json'), '{"name":"clawco-fixture","version":"0.0.0","private":true}\n');
  writeFileSync(path.join(kilde, 'package-lock.json'), JSON.stringify({ name: 'clawco-fixture', version: '0.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'clawco-fixture', version: '0.0.0' } } }, null, 2) + '\n');
  copyFileSync(path.join(ROD, '.env.example'), path.join(kilde, '.env.example'));
  git(kilde, 'init', '-q');
  git(kilde, 'add', '.');
  git(kilde, 'commit', '-q', '-m', 'fixture');
  bare = path.join(tmp, 'clawco.git');
  git(tmp, 'clone', '-q', '--bare', kilde, bare);
});

after(() => { rmSync(tmp, { recursive: true, force: true }); });

function nyHome(): string {
  return mkdtempSync(path.join(tmp, 'home-'));
}

type Resultat = { code: number | null; out: string; err: string };

function koer(home: string, args: string[], opts: { input?: string; pathForan?: string; script?: string; underVejs?: () => void; env?: Record<string, string> } = {}): Promise<Resultat> {
  return new Promise((resolve) => {
    const env: Record<string, string> = {
      PATH: (opts.pathForan ? opts.pathForan + ':' : '') + (process.env['PATH'] ?? ''),
      HOME: home,
      CLAWCO_REPO: bare,
      TMPDIR: tmp,
      ...(opts.env ?? {}),
    };
    const p = spawn('bash', [opts.script ?? SCRIPT, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += String(d); });
    p.stderr.on('data', (d) => { err += String(d); });
    const tik = opts.underVejs ? setInterval(opts.underVejs, 15) : undefined;
    p.on('close', (code) => { if (tik) clearInterval(tik); resolve({ code, out, err }); });
    // A script that exits before reading stdin (a truncated download) closes the pipe: EPIPE is expected, not a failure.
    p.stdin.on('error', () => {});
    p.stdin.end(opts.input ?? '');
  });
}

function falskBin(navn: string, indhold: string): string {
  const dir = mkdtempSync(path.join(tmp, 'bin-'));
  writeFileSync(path.join(dir, navn), `#!/bin/sh\n${indhold}\n`);
  chmodSync(path.join(dir, navn), 0o755);
  return dir;
}

test('install.sh is wrapped in one function and called on the last line (a truncated download runs nothing)', async () => {
  const tekst = readFileSync(SCRIPT, 'utf8');
  assert.equal(tekst.trimEnd().split('\n').at(-1), 'main "$@"');
  for (const andel of [0.2, 0.5, 0.8, 0.97]) {
    const kort = path.join(tmp, `kort-${andel}.sh`);
    writeFileSync(kort, tekst.slice(0, Math.floor(tekst.length * andel)));
    const home = nyHome();
    await koer(home, ['--yes', '--no-service', '--port', PORT], { script: kort });
    assert.deepEqual(readdirSync(home), [], `a ${andel * 100}% download must not create anything`);
  }
});

test('--dry-run --yes prints every planned step and changes nothing', async () => {
  const home = nyHome();
  const r = await koer(home, ['--dry-run', '--yes', '--port', PORT]);
  assert.equal(r.code, 0, r.err);
  const app = path.join(home, '.clawco', 'app');
  assert.match(r.out, /node v\d+\.\d+/);
  assert.ok(r.out.includes(`${bare} → ${app}`), r.out);
  assert.match(r.out, /npm ci --omit=dev/);
  assert.ok(r.out.includes(path.join(home, '.clawco', 'data')), r.out);
  assert.ok(r.out.includes(path.join(home, '.clawco', '.env')), r.out);
  const service = process.platform === 'darwin'
    ? path.join(home, 'Library', 'LaunchAgents', 'work.clawco.plist')
    : path.join(home, '.config', 'systemd', 'user', 'clawco.service');
  assert.ok(r.out.includes(service), r.out);
  assert.ok(r.out.includes(`http://127.0.0.1:${PORT}/health`), r.out);
  assert.deepEqual(readdirSync(home), [], '--dry-run must not change anything');
});

test('a fresh install with --no-service clones the code, makes the user folder and a mode-600 .env', async () => {
  const home = nyHome();
  const r = await koer(home, ['--yes', '--no-service', '--port', PORT]);
  assert.equal(r.code, 0, r.out + r.err);
  const rod = path.join(home, '.clawco');
  assert.equal(git(path.join(rod, 'app'), 'rev-parse', 'HEAD'), git(bare, 'rev-parse', 'HEAD'));
  assert.ok(statSync(path.join(rod, 'data')).isDirectory(), 'the user folder exists');
  const envFil = path.join(rod, '.env');
  assert.equal(statSync(envFil).mode & 0o777, 0o600);
  const env = readFileSync(envFil, 'utf8');
  assert.match(env, new RegExp(`^KC_PORT=${PORT}$`, 'm'));
  assert.ok(env.split('\n').includes(`KC_DATA_DIR=${path.join(rod, 'data')}`), env);
  // KC-0127: a key saved in Start (KC_HERMES_API_KEY) goes to this .env — the one the service reads — so it survives a restart.
  assert.ok(env.split('\n').includes(`KC_ENV_FILE=${envFil}`), env);
  // Every active key comes from .env.example (one place); nothing of Henrik's own setup leaks in.
  const kendte = new Set(readFileSync(path.join(ROD, '.env.example'), 'utf8').split('\n').map((l) => /^([A-Z0-9_]+)=/.exec(l)?.[1]).filter(Boolean));
  for (const l of env.split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l))) assert.ok(kendte.has(l.split('=')[0]), `unknown key in .env: ${l.split('=')[0]}`);
  assert.doesNotMatch(env, /^KC_ADRESSE=\S/m);
  assert.doesNotMatch(env, /henrik/i);
});

test('a second run keeps .env and the user folder untouched', async () => {
  const home = nyHome();
  assert.equal((await koer(home, ['--yes', '--no-service', '--port', PORT])).code, 0);
  const rod = path.join(home, '.clawco');
  const envFil = path.join(rod, '.env');
  const note = path.join(rod, 'data', 'min-note.md');
  writeFileSync(note, 'min egen\n');
  const foer = { env: readFileSync(envFil, 'utf8'), mtime: statSync(envFil).mtimeMs, note: statSync(note).mtimeMs };
  const r = await koer(home, ['--yes', '--no-service', '--port', '9999']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(readFileSync(envFil, 'utf8'), foer.env);
  assert.equal(statSync(envFil).mtimeMs, foer.mtime);
  assert.equal(statSync(note).mtimeMs, foer.note);
  assert.equal(readFileSync(note, 'utf8'), 'min egen\n');
  assert.match(r.out, /\.env.*beholdt/);
});

test('a re-run fast-forwards the code to the newest commit (update)', async () => {
  const home = nyHome();
  assert.equal((await koer(home, ['--yes', '--no-service', '--port', PORT])).code, 0);
  const arbejde = path.join(tmp, `arbejde-${Date.now()}`);
  git(tmp, 'clone', '-q', bare, arbejde);
  writeFileSync(path.join(arbejde, 'NY.md'), 'ny\n');
  git(arbejde, 'add', '.');
  git(arbejde, 'commit', '-q', '-m', 'ny');
  git(arbejde, 'push', '-q', 'origin', 'HEAD');
  const r = await koer(home, ['--yes', '--no-service']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(git(path.join(home, '.clawco', 'app'), 'rev-parse', 'HEAD'), git(arbejde, 'rev-parse', 'HEAD'));
});

test('an agent key on stdin lands in .env and never in output or the process list', async () => {
  const home = nyHome();
  const sentinel = `kc-sentinel-${Math.random().toString(16).slice(2)}${Date.now()}`;
  const fund: string[] = [];
  const kigger = () => {
    execFile('ps', ['-A', '-ww', '-o', 'args='], (_e, stdout) => { if (String(stdout).includes(sentinel)) fund.push('ps'); });
  };
  const r = await koer(home, ['--yes', '--no-service', '--port', PORT, '--agent-url', 'http://agent.test:8642'], { input: sentinel + '\n', underVejs: kigger });
  await new Promise((ok) => setTimeout(ok, 100));
  assert.equal(r.code, 0, r.out + r.err);
  assert.ok(!r.out.includes(sentinel) && !r.err.includes(sentinel), 'the key must never be printed');
  assert.deepEqual(fund, [], 'the key must never be on a command line');
  assert.ok(r.out.includes(`KC_HERMES_API_KEY: ${sentinel.length} tegn`), r.out);
  const env = readFileSync(path.join(home, '.clawco', '.env'), 'utf8').split('\n');
  assert.ok(env.includes(`KC_HERMES_API_KEY=${sentinel}`));
  assert.ok(env.includes('KC_HERMES_URL=http://agent.test:8642'));
  assert.ok(env.includes('KC_AGENT=hermes-http'));
});

test('too old Node stops with a plain message and the one command that fixes it', async () => {
  const home = nyHome();
  const r = await koer(home, ['--yes', '--no-service'], { pathForan: falskBin('node', 'echo v20.11.0') });
  assert.notEqual(r.code, 0);
  const tekst = r.out + r.err;
  assert.match(tekst, /Node/);
  assert.match(tekst, /22\.6/);
  assert.match(tekst, process.platform === 'darwin' ? /brew install node/ : /nodejs/);
  assert.deepEqual(readdirSync(home), []);
});

test('an unsupported system stops with a plain message', async () => {
  const home = nyHome();
  const r = await koer(home, ['--yes', '--no-service'], { pathForan: falskBin('uname', 'echo FreeBSD') });
  assert.notEqual(r.code, 0);
  assert.match(r.out + r.err, /Mac og Linux/);
  assert.deepEqual(readdirSync(home), []);
});

test('a user folder inside the code folder is refused (code and user data stay apart)', async () => {
  const home = nyHome();
  const r = await koer(home, ['--yes', '--no-service', '--data-dir', path.join(home, '.clawco', 'app', 'data')]);
  assert.notEqual(r.code, 0);
  assert.match(r.out + r.err, /brugermappe/i);
  assert.deepEqual(readdirSync(home), []);
});

test('an unknown flag stops before anything happens', async () => {
  const home = nyHome();
  const r = await koer(home, ['--yes', '--hvad']);
  assert.notEqual(r.code, 0);
  assert.match(r.out + r.err, /--hvad/);
  assert.deepEqual(readdirSync(home), []);
});

// ---- KC-0160: laptop mode ----

test('--laptop --dry-run plans a loopback-only, one-user install with the service and no Tailscale step', async () => {
  const home = nyHome();
  const r = await koer(home, ['--dry-run', '--yes', '--laptop', '--port', PORT]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Bærbar-tilstand/);
  assert.match(r.out, /127\.0\.0\.1/);
  assert.match(r.out, /kun denne maskine/);
  assert.doesNotMatch(r.out, /tailscale/i, 'no Tailscale step in the plan');
  assert.doesNotMatch(r.out, /kommer senere/);
  assert.ok(r.out.includes(process.platform === 'darwin' ? 'launchd-agent' : 'systemd-brugertjeneste'), r.out);
  assert.deepEqual(readdirSync(home), [], '--dry-run must not change anything');
});

test('--laptop writes KC_LAPTOP=ja and KC_HOST=127.0.0.1 into .env; without it neither is set', async () => {
  const baerbar = nyHome();
  const r = await koer(baerbar, ['--yes', '--no-service', '--laptop', '--port', PORT]);
  assert.equal(r.code, 0, r.out + r.err);
  const env = readFileSync(path.join(baerbar, '.clawco', '.env'), 'utf8').split('\n');
  assert.ok(env.includes('KC_LAPTOP=ja'), 'laptop mode on');
  assert.ok(env.includes('KC_HOST=127.0.0.1'), 'loopback only, written out');
  assert.match(r.out, /med Tailscale kan den, men kun når den bærbare er vågen/, 'the phone limit is said even without the service');
  const almindelig = nyHome();
  const a = await koer(almindelig, ['--yes', '--no-service', '--port', PORT]);
  assert.equal(a.code, 0, a.out + a.err);
  const env2 = readFileSync(path.join(almindelig, '.clawco', '.env'), 'utf8').split('\n');
  assert.ok(!env2.includes('KC_LAPTOP=ja'), 'a plain install is not laptop mode');
  assert.ok(env2.includes('# KC_LAPTOP='), 'the key is there, commented');
});

test('a finished laptop install says honestly what the phone can and cannot do, and does not push Tailscale', async () => {
  const home = nyHome();
  const sha = git(bare, 'rev-parse', '--short', 'HEAD');
  const helbred = path.join(falskBin('helbred', `echo '{"sha":"${sha}","uptimeSec":3}'`), 'helbred');
  const genstart = path.join(falskBin('genstart', 'exit 0'), 'genstart');
  const r = await koer(home, ['--yes', '--laptop', '--port', PORT], { env: { CLAWCO_GENSTART: genstart, CLAWCO_HEALTH_KOMMANDO: helbred, CLAWCO_VENTETID: '5' } });
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /Uden Tailscale kan telefonen ikke nå Clawco; med Tailscale kan den, men kun når den bærbare er vågen/);
  assert.doesNotMatch(r.out, /Tailscale fundet/);
});

test('--laptop on an install that already has a .env changes nothing and says .env decides', async () => {
  const home = nyHome();
  assert.equal((await koer(home, ['--yes', '--no-service', '--port', PORT])).code, 0);
  const envFil = path.join(home, '.clawco', '.env');
  const foer = readFileSync(envFil, 'utf8');
  const r = await koer(home, ['--yes', '--no-service', '--laptop']);
  assert.match(r.out, /findes og bestemmer/);
  assert.equal(readFileSync(envFil, 'utf8'), foer);
});

test('no Tailscale found: the installer suggests laptop mode and only the user\'s yes turns it on; non-interactive never does', async () => {
  const laptopSat = (home: string): boolean => readFileSync(path.join(home, '.clawco', '.env'), 'utf8').split('\n').includes('KC_LAPTOP=ja');
  const ja = nyHome();
  const r = await koer(ja, ['--no-service', '--port', PORT, '--data-dir', path.join(ja, '.clawco', 'data')], { env: { CLAWCO_TAILSCALE: 'ingen', CLAWCO_BAERBAR_SVAR: 'j' } });
  assert.equal(r.code, 0, r.out + r.err);
  assert.ok(laptopSat(ja), 'yes turns it on');
  const nej = nyHome();
  const n = await koer(nej, ['--no-service', '--port', PORT, '--data-dir', path.join(nej, '.clawco', 'data')], { env: { CLAWCO_TAILSCALE: 'ingen', CLAWCO_BAERBAR_SVAR: 'n' } });
  assert.equal(n.code, 0, n.out + n.err);
  assert.ok(!laptopSat(nej), 'no leaves it off');
  const stille = nyHome();
  const s = await koer(stille, ['--yes', '--no-service', '--port', PORT], { env: { CLAWCO_TAILSCALE: 'ingen', CLAWCO_BAERBAR_SVAR: 'j' } });
  assert.equal(s.code, 0, s.out + s.err);
  assert.ok(!laptopSat(stille), '--yes alone never picks laptop mode, whatever a hook says');
  const med = nyHome();
  const m = await koer(med, ['--no-service', '--port', PORT, '--data-dir', path.join(med, '.clawco', 'data')], { env: { CLAWCO_TAILSCALE: 'findes', CLAWCO_BAERBAR_SVAR: 'j' } });
  assert.equal(m.code, 0, m.out + m.err);
  assert.ok(!laptopSat(med), 'with Tailscale there is nothing to suggest');
});

test('shellcheck finds nothing in install.sh', (t) => {
  if (spawnSync('shellcheck', ['--version']).error) { t.skip('shellcheck is not installed'); return; }
  const r = spawnSync('shellcheck', ['-s', 'bash', SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
});

test('the service templates carry every placeholder the installer fills', () => {
  for (const fil of ['clawco.service', 'work.clawco.plist.template']) {
    const p = path.join(ROD, 'deploy', fil);
    assert.ok(existsSync(p), fil);
    const t = readFileSync(p, 'utf8');
    for (const ph of ['@APP@', '@NODE@', '@ENV@']) assert.ok(t.includes(ph), `${fil} lacks ${ph}`);
  }
});
