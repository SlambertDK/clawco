// KC-0276: the deploy and supply-chain hardening is text in shell scripts, units and docs; these tests read
// the files and pin what must stay true (the repo's way for such files, see docker-files.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const laes = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
/** The file without comment-only lines. */
const kode = (f: string) => laes(f).split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');

test('F3: every npm ci in an install, update or deploy script runs with --ignore-scripts (the Dockerfile precedent)', () => {
  for (const f of ['deploy/install.sh', 'deploy/opdater.sh', 'deploy/deploy.sh', 'sky/deploy/deploy.sh', 'deploy/arbejder/opsaet.sh', 'Dockerfile']) {
    const ci = kode(f).split('\n').filter((l) => /\bnpm ci (--|$)/.test(l) && !/^\s*(info|echo|fejl)\b/.test(l.trim()) && !/fejlede|\bnpm ci --omit=dev i /.test(l));
    assert.ok(ci.length > 0, `${f} has an npm ci`);
    for (const l of ci) assert.match(l, /--ignore-scripts/, `${f}: ${l.trim()}`);
  }
});

test('F3: the deploy scripts keep their npm log private (mktemp), not a predictable /tmp name', () => {
  for (const f of ['deploy/deploy.sh', 'sky/deploy/deploy.sh']) {
    assert.match(kode(f), /log="\$\(mktemp\)"/, f);
    assert.ok(!/\/tmp\/(kc|sky)-npm\.log/.test(laes(f)), f);
  }
});

test('F4: the Docker backup commands write under umask 077 into a 0700 folder, never into the repository clone', () => {
  for (const f of ['deploy/docker/README.md', 'site/docs/docker.html']) {
    const t = laes(f);
    assert.match(t, /mkdir -p -m 700 "\$HOME\/Clawco-backups"/, f);
    const kopier = t.split('\n').filter((l) => /busybox tar czf/.test(l));
    assert.equal(kopier.length, 2, f);
    for (const l of kopier) {
      assert.match(l, /umask 077/, `${f}: ${l.trim()}`);
      assert.match(l, /> "\$HOME\/Clawco-backups\/|&gt; "\$HOME\/Clawco-backups\//, `${f}: the tarball lands in the 0700 folder`);
      assert.ok(!/-v "\$PWD"/.test(l), `${f}: no bind mount of the working directory (a root-owned file in the clone)`);
    }
  }
  assert.match(laes('site/strings.js'), /must not be kept inside the repository clone/);
});

test('F4: .gitignore covers backups and key material, keeps the sanctioned test keys tracked and does not hide src/hemmeligheder', () => {
  const g = laes('.gitignore').split('\n');
  for (const m of ['*.tgz', '*.tar.gz', '*.key', '*.enc', '/hemmeligheder*', 'Clawco-backups/', '!test/helpers/certifikater/*.key']) assert.ok(g.includes(m), m);
  assert.ok(!g.includes('hemmeligheder*'), 'an unanchored hemmeligheder* would hide the src/hemmeligheder/ folders');
  assert.ok(g.indexOf('!test/helpers/certifikater/*.key') > g.indexOf('*.key'), 'the negation comes after the rule it undoes');
});

test('F4: hetzner.sh cuts containers off from the metadata address and says the auth key must be one-time', () => {
  const t = laes('deploy/egen-sky/hetzner.sh');
  assert.match(t, /iptables -I DOCKER-USER -d "\\\$maal" -j DROP/);
  assert.match(t, /for maal in 169\.254\.169\.254\/32 169\.254\.0\.0\/16; do/);
  assert.match(t, /ExecStart=\/usr\/local\/sbin\/clawco-metadata-blok/);
  assert.match(t, /systemctl enable --now clawco-metadata-blok\.service/);
  assert.ok(t.indexOf('systemctl enable --now clawco-metadata-blok.service') < t.indexOf('  - /usr/local/sbin/clawco-start'), 'the rule is in place before the containers start');
  assert.match(t, /MUST be a\n# one-time \(non-reusable\) key/);
  assert.match(t, /cloud-init\) gemmer en kopi i serverens metadata/);
  assert.match(t, /shred -u \$NOEGLEFIL_PAA_VM/, 'the shred stays');
});

test('F5: kontrolcenter.service runs with no new privileges; the full sandbox waits for the real paths (ticket log)', () => {
  const u = laes('deploy/kontrolcenter.service');
  assert.match(u, /^NoNewPrivileges=yes$/m);
  assert.ok(!/^(PrivateTmp|ProtectSystem|ProtectHome|RuntimeDirectory)=/m.test(u), 'a private /tmp would hide the morning paper Kira still writes there');
});

test('F5: the product unit (clawco.service) only adds what works on every distro', () => {
  const u = laes('deploy/clawco.service');
  assert.match(u, /^NoNewPrivileges=yes$/m);
  assert.ok(!/^(PrivateTmp|ProtectSystem|ProtectHome)=/m.test(u), 'those need user namespaces and a list of writable paths we do not know');
});

/** A scratch checkout layout for a script under scripts/, plus a PATH with the given stubs. */
function scratch(stubs: Record<string, string> = {}) {
  const rod = mkdtempSync(path.join(tmpdir(), 'kc0276-scripts-'));
  mkdirSync(path.join(rod, 'scripts'));
  mkdirSync(path.join(rod, 'bin'));
  for (const [navn, krop] of Object.entries(stubs)) { writeFileSync(path.join(rod, 'bin', navn), `#!/bin/sh\n${krop}\n`); chmodSync(path.join(rod, 'bin', navn), 0o755); }
  const env = (ekstra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ PATH: `${path.join(rod, 'bin')}:${process.env['PATH']}`, HOME: rod, ...ekstra });
  return { rod, env, ryd: () => rmSync(rod, { recursive: true, force: true }) };
}

test('F6: enable-hermes-api.sh makes the .env it creates mode 600 (it holds the Hermes key)', () => {
  const s = scratch();
  try {
    copyFileSync(new URL('../scripts/enable-hermes-api.sh', import.meta.url), path.join(s.rod, 'scripts', 'enable-hermes-api.sh'));
    writeFileSync(path.join(s.rod, '.env.example'), 'KC_PORT=8750\nKC_HERMES_API_KEY=\n', { mode: 0o644 });
    mkdirSync(path.join(s.rod, 'hermes'));
    writeFileSync(path.join(s.rod, 'hermes', '.env'), 'X=1\n', { mode: 0o644 });
    const r = spawnSync('bash', [path.join(s.rod, 'scripts', 'enable-hermes-api.sh')], { encoding: 'utf8', env: s.env({ HERMES_HOME: path.join(s.rod, 'hermes') }) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(statSync(path.join(s.rod, '.env')).mode & 0o777, 0o600);
    const nogle = /^KC_HERMES_API_KEY=(.+)$/m.exec(readFileSync(path.join(s.rod, '.env'), 'utf8'))![1]!;
    assert.ok(!r.stdout.includes(nogle), 'the key is never printed');
  } finally { s.ryd(); }
});

test('F6: set-secret.sh writes atomically into a 0600 file, replaces one line, keeps the rest and puts no value on a command line', () => {
  const s = scratch({ ssh: 'printf "%s\\n" "$@" > "$HOME/ssh-argv"; bash -c "${@: -1}"' });
  try {
    copyFileSync(new URL('../scripts/set-secret.sh', import.meta.url), path.join(s.rod, 'scripts', 'set-secret.sh'));
    mkdirSync(path.join(s.rod, 'kontrolcenter'));
    const envFil = path.join(s.rod, 'kontrolcenter', '.env');
    writeFileSync(envFil, 'KC_PORT=8750\nKC_ELEVENLABS_API_KEY=gammel\n', { mode: 0o644 });
    const r = spawnSync('bash', [path.join(s.rod, 'scripts', 'set-secret.sh'), 'KC_ELEVENLABS_API_KEY'], { encoding: 'utf8', env: s.env(), input: 'ny-hemmelig-vaerdi\n' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(readFileSync(envFil, 'utf8'), 'KC_PORT=8750\nKC_ELEVENLABS_API_KEY=ny-hemmelig-vaerdi\n');
    assert.equal(statSync(envFil).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(path.join(s.rod, 'kontrolcenter')), ['.env'], 'no temp file left behind');
    assert.match(r.stdout, /KC_ELEVENLABS_API_KEY sat i .* \(længde 18\)/);
    assert.ok(!(r.stdout + r.stderr).includes('ny-hemmelig-vaerdi') && !readFileSync(path.join(s.rod, 'ssh-argv'), 'utf8').includes('ny-hemmelig-vaerdi'));
    const k = kode('scripts/set-secret.sh');
    assert.ok(!/cat "\\?\$tmp" > "\\?\$f"/.test(k), 'no in-place overwrite');
    assert.match(k, /mv -f "\$tmp" "\$f"/);
  } finally { s.ryd(); }
});

test('F6: the Bitwarden CLI is pinned to one exact version, the same in both scripts', () => {
  const v = (f: string) => /^BW_CLI_VERSION=(\d+\.\d+\.\d+)$/m.exec(laes(f))?.[1];
  assert.ok(v('scripts/set-secret.sh'));
  assert.equal(v('sky/scripts/saet-hemmelighed.sh'), v('scripts/set-secret.sh'));
  for (const f of ['scripts/set-secret.sh', 'sky/scripts/saet-hemmelighed.sh']) {
    for (const l of kode(f).split('\n').filter((l) => l.includes('@bitwarden/cli'))) assert.match(l, /@bitwarden\/cli@"?\$\{?BW_CLI_VERSION/, `${f}: ${l.trim()}`);
  }
});

test('F6: the app container drops every capability and both services forbid new privileges', () => {
  const c = laes('compose.yaml');
  const [app, ts] = c.split(/^  tailscale:$/m);
  assert.match(app!, /^    cap_drop:\n      - ALL$/m);
  assert.doesNotMatch(app!, /cap_add:/);
  assert.match(app!, /no-new-privileges:true/);
  assert.match(ts!, /no-new-privileges:true/);
  assert.doesNotMatch(ts!, /^    cap_add:/m, 'no capability is added to the Tailscale container either');
});
