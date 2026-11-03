// KC-0212: Sky's install on kira-home. Nothing here runs as root, over ssh or against Bitwarden: the
// root script is checked by its dry run and by its structure (every change sits behind a read-only
// check), the sudoers drop-in by visudo when the machine has it, the token and secret scripts with
// temp files, a fake secrets module and a fake ssh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skyRod = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const deploy = path.join(skyRod, 'deploy');
const ROOT_SCRIPT = path.join(deploy, 'opsaet-root.sh');
const laes = (f: string) => fs.readFileSync(path.join(deploy, f), 'utf8');
const erRoot = process.getuid?.() === 0;

/** The environment without git's variables (a hook may run these tests inside a git command). */
function rentMiljoe(ekstra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) e[k] = v;
  return { ...e, ...ekstra };
}
const bash = (args: string[], o: { env?: Record<string, string>; input?: string } = {}) =>
  spawnSync('bash', args, { encoding: 'utf8', env: rentMiljoe(o.env), ...(o.input !== undefined ? { input: o.input } : {}) });

function tmp(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'sky-deploy-')); }

const TRIN = ['brugeren sky', '/srv/sky er 0750', 'sky kan læse /home/henrik/kontrolcenter.git', 'checkout i /srv/sky/kontrolcenter', 'Postgres-serveren installeret uden automatisk klynge', 'én Postgres-klynge til Sky på port 5433', 'Postgres lytter kun på unix-socket', 'Postgres er slået til', 'Postgres-rollen sky', 'databasen sky', '/srv/sky/.env er 0600', 'sky.service installeret', 'clawco-sky-tunnel.service installeret', 'sudoers-filen', 'journald gemmer logs højst 30 dage'];

test('opsaet-root.sh --dry-run prints every step and changes nothing (no root needed)', () => {
  const r = bash([ROOT_SCRIPT, '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  for (const t of TRIN) assert.match(r.stdout, new RegExp(`^  (ok|ville) +${t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`, 'm'), t);
  assert.match(r.stdout, /Tørkørsel: intet er ændret\./);
  assert.ok(!/^  gør /m.test(r.stdout), 'a dry run never acts');
});

test('opsaet-root.sh refuses to run for real without root', { skip: erRoot }, () => {
  const r = bash([ROOT_SCRIPT]);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /Kør med sudo/);
  assert.equal(bash([ROOT_SCRIPT, '--noget']).status, 2);
});

/** Function name → its body lines, for a script whose functions are `name() { … }` (one line or many). */
function funktioner(kilde: string): { navn: string | null; linje: string }[] {
  const ud: { navn: string | null; linje: string }[] = [];
  let navn: string | null = null;
  let heredoc: string | null = null;
  for (const linje of kilde.split('\n')) {
    if (heredoc) { ud.push({ navn, linje }); if (linje.trim() === heredoc) heredoc = null; continue; }
    const start = /^([a-z_]+)\(\) \{/.exec(linje);
    if (start && !navn) {
      ud.push({ navn: start[1]!, linje });
      if (!/\}\s*(#.*)?$/.test(linje)) navn = start[1]!;
      continue;
    }
    ud.push({ navn, linje });
    const hd = /<<'?([A-Z]+)'?/.exec(linje);
    if (hd) heredoc = hd[1]!;
    if (navn && linje === '}') navn = null;
  }
  return ud;
}

test('opsaet-root.sh: every change sits in a goer_ step behind its read-only tjek_ (idempotence by construction)', () => {
  const kilde = fs.readFileSync(ROOT_SCRIPT, 'utf8');
  const MUTERER = /\b(useradd|usermod|setfacl -|install -|chmod|chown|createuser|createdb|pg_createcluster|apt-get (install|update)|sed -i|create_main_cluster = false|git clone|git config --global --add|systemctl (enable|restart|start|daemon-reload)|printf .* > |>> "\$ENV_FIL")/;
  const tilladt = (n: string | null) => !!n && (n.startsWith('goer_') || n === 'installer_unit' || n === 'sudoers_tekst');
  const brud = funktioner(kilde).filter(({ navn, linje }) => !linje.trimStart().startsWith('#') && MUTERER.test(linje) && !tilladt(navn)).map(({ navn, linje }) => `${navn ?? '(top)'}: ${linje.trim()}`);
  assert.deepEqual(brud, []);
  // Each step pairs a check with its action, and every action has its check.
  const trin = [...kilde.matchAll(/^trin "[^"]+" (tjek_[a-z_]+) (goer_[a-z_]+)$/gm)];
  assert.equal(trin.length, TRIN.length);
  for (const [, tjek, goer] of trin) assert.equal(tjek!.slice(5), goer!.slice(5));
  const goere = [...kilde.matchAll(/^(goer_[a-z_]+)\(\)/gm)].map((m) => m[1]);
  assert.deepEqual(goere.sort(), trin.map((m) => m[2]).sort(), 'no action outside a step');
});

test('opsaet-root.sh: the system Postgres is socket-only before it first starts', () => {
  const kilde = fs.readFileSync(ROOT_SCRIPT, 'utf8');
  assert.match(kilde, /listen_addresses = ''/);
  const pos = (t: string) => kilde.indexOf(`trin "${t}`);
  const raekke = ['Postgres-serveren installeret', 'én Postgres-klynge til Sky', 'Postgres lytter kun på unix-socket', 'Postgres er slået til'].map(pos);
  assert.ok(raekke.every((p) => p > 0), 'all four Postgres steps exist');
  assert.deepEqual([...raekke].sort((a, b) => a - b), raekke, 'install (no auto cluster) → Sky cluster → socket-only → first start');
  assert.match(kilde, /create_main_cluster = false/);
  assert.match(kilde, /pg_createcluster "\$ver" main -p 5433/);
  assert.ok(!/pg_createcluster[^\n]*--start/.test(kilde), 'the cluster is never started before it is socket-only');
  assert.ok(!kilde.includes('netop én Postgres-klynge'), 'a missing server is a step, not a stop');
  for (const m of kilde.matchAll(/listen_addresses\s*=\s*('[^']*')/g)) assert.equal(m[1], "''", 'never a TCP address');
  assert.ok(!/^\s*port\s*=/m.test(kilde), 'never sets a port');
});

test('opsaet-root.sh: journald keeps logs at most 30 days, as the legal texts promise (KC-0204)', () => {
  const kilde = fs.readFileSync(ROOT_SCRIPT, 'utf8');
  assert.match(kilde, /^JOURNALD_KONF=\/etc\/systemd\/journald\.conf\.d\/clawco-30-dage\.conf$/m);
  assert.match(kilde, /MaxRetentionSec=30day/);
  assert.match(kilde, /systemctl restart systemd-journald/);
});

test('the two foreign cloudflared units are never named outside the guard list', () => {
  for (const f of fs.readdirSync(deploy).filter((n) => !n.endsWith('.md') && fs.statSync(path.join(deploy, n)).isFile())) {
    const linjer = laes(f).split('\n').filter((l) => /cloudflared(-petrilab)?\.service/.test(l));
    for (const l of linjer) assert.match(l, /^FREMMEDE_UNITS=/, `${f}: ${l.trim()}`);
  }
});

test('the sudoers drop-in parses (visudo -cf), grants nothing that opens a pager as root and acts as sky only through three fixed scripts', { skip: !fs.existsSync('/usr/sbin/visudo') && !fs.existsSync('/usr/bin/visudo') }, () => {
  const tekst = bash([ROOT_SCRIPT, '--sudoers']).stdout;
  const dir = tmp();
  try {
    const f = path.join(dir, 'clawco-sky');
    fs.writeFileSync(f, tekst, { mode: 0o440 });
    const visudo = fs.existsSync('/usr/sbin/visudo') ? '/usr/sbin/visudo' : '/usr/bin/visudo';
    const r = spawnSync(visudo, ['-cf', f], { encoding: 'utf8', env: rentMiljoe() });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const rod = tekst.split('\n').filter((l) => /\(root\)/.test(l));
  assert.equal(rod.length, 2);
  for (const l of rod) assert.ok(!/journalctl|systemctl status|less|ALL$/.test(l), l);
  // KC-0276: henrik acts as sky only through three fixed scripts of sky's checkout, never "ALL" or a shell.
  const sky = tekst.split('\n').filter((l) => /^henrik ALL=\(sky\)/.test(l));
  assert.equal(sky.length, 1);
  assert.ok(!/NOPASSWD:\s*ALL\b/.test(sky[0]!), sky[0]);
  const regler = sky[0]!.replace(/^[^:]*NOPASSWD:\s*/, '').split(/,\s*(?=\/)/);
  assert.equal(regler.length, 5);
  for (const r of regler) assert.match(r, /^\/usr\/bin\/bash \/srv\/sky\/kontrolcenter\/sky\/deploy\/(deploy|saet-env|masternoegle)\.sh /, r);
  assert.ok(!/bash -c/.test(sky[0]!), 'no shell text as sky');
  // Every script the sudoers line names exists in this checkout, and what the two Mac-side scripts call is on the list.
  for (const m of sky[0]!.matchAll(/\/srv\/sky\/kontrolcenter\/(sky\/deploy\/[a-z-]+\.sh)/g)) assert.ok(fs.existsSync(path.join(skyRod, '..', m[1]!)), m[1]);
  const kald = (f: string) => fs.readFileSync(path.join(skyRod, 'scripts', f), 'utf8').match(/sudo -n -u sky (\/usr\/bin\/bash \/srv\/sky\/kontrolcenter\/sky\/deploy\/[a-z-]+\.sh)/)?.[1];
  assert.ok(kald('saet-hemmelighed.sh') && sky[0]!.includes(kald('saet-hemmelighed.sh')!));
  assert.ok(kald('ny-masternoegle.sh') && sky[0]!.includes(kald('ny-masternoegle.sh')!));
  assert.ok(sky[0]!.includes('/usr/bin/bash /srv/sky/kontrolcenter/sky/deploy/deploy.sh ""'));
  // KC-0273: sky itself may run exactly two things as root: restart its unit, and the netfilter script by path.
  const somRod = tekst.split('\n').filter((l) => /^sky ALL=\(root\)/.test(l));
  assert.equal(somRod.length, 1);
  assert.deepEqual(somRod[0]!.replace(/^[^:]*NOPASSWD:\s*/, '').split(/,\s*(?=\/)/), ['/usr/bin/systemctl restart sky', '/usr/bin/bash /srv/sky/kontrolcenter/sky/deploy/netfilter.sh *']);
  assert.ok(fs.existsSync(path.join(skyRod, 'deploy', 'netfilter.sh')));
});

test('the tunnel unit runs as sky and reads its token from a file, never from a command line or the environment', () => {
  const u = laes('clawco-sky-tunnel.service');
  assert.match(u, /^User=sky$/m);
  const exec = u.split('\n').filter((l) => l.startsWith('ExecStart'));
  assert.ok(exec.some((l) => /cloudflared tunnel --no-autoupdate run --token-file %t\/clawco-sky-tunnel\/token$/.test(l)));
  for (const l of exec) assert.ok(!/--token(\s|=)/.test(l) && !l.includes('TUNNEL_TOKEN='), l);
  assert.ok(!/^EnvironmentFile=/m.test(u), 'the tunnel gets no environment file');
  assert.match(u, /^RuntimeDirectoryMode=0700$/m);
});

test('sky.service: user sky, the checkout under /srv/sky, secrets outside it', () => {
  const u = laes('sky.service');
  assert.match(u, /^User=sky$/m);
  assert.match(u, /^WorkingDirectory=\/srv\/sky\/kontrolcenter\/sky$/m);
  assert.match(u, /^EnvironmentFile=\/srv\/sky\/\.env$/m);
  // KC-0221: Sky drains for 5 s on SIGTERM; systemd must not wait its default 90 s if that ever fails.
  assert.match(u, /^TimeoutStopSec=20s$/m);
});

test('tunnel-token.sh writes the token 0600 and prints only its length; a missing key writes nothing', () => {
  const dir = tmp();
  try {
    const env = path.join(dir, '.env');
    const ud = path.join(dir, 'token');
    const token = 'eyJhIjoiZmFrZS10dW5uZWwtdG9rZW4ifQ';
    fs.writeFileSync(env, `SKY_PORT=8781\nSKY_CLOUDFLARE_TUNNEL_TOKEN=${token}\n`);
    const r = bash([path.join(deploy, 'tunnel-token.sh'), env, ud]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(ud, 'utf8'), token);
    assert.equal(fs.statSync(ud).mode & 0o777, 0o600);
    assert.ok(!r.stdout.includes(token) && !r.stderr.includes(token));
    assert.match(r.stdout, new RegExp(`længde ${token.length}`));

    fs.writeFileSync(env, 'SKY_PORT=8781\n');
    fs.rmSync(ud);
    const t = bash([path.join(deploy, 'tunnel-token.sh'), env, ud]);
    assert.equal(t.status, 1);
    assert.match(t.stderr, /SKY_CLOUDFLARE_TUNNEL_TOKEN mangler/);
    assert.ok(!fs.existsSync(ud));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/** A fake ShelfAtlas secrets dir (same exports as runtime.mjs/lib.mjs) and a fake ssh that runs the remote command locally on a temp .env. */
function falskVaert(dir: string, hemmeligheder: Record<string, string>) {
  const bws = path.join(dir, 'secrets');
  fs.mkdirSync(bws);
  fs.writeFileSync(path.join(bws, 'runtime.mjs'), `const S = ${JSON.stringify(Object.entries(hemmeligheder).map(([key, value]) => ({ key, value })))};
export function resolveProject(n) { if (n !== 'shelfatlas') throw new Error('forkert projekt ' + n); return { id: 'p1', name: n }; }
export function listSecrets(id) { if (id !== 'p1') throw new Error('forkert id'); return S; }\n`);
  fs.writeFileSync(path.join(bws, 'lib.mjs'), `export function pickSecret(s, key) { const h = s.filter((x) => x.key === key); if (h.length !== 1) throw new Error('No secret with key "' + key + '"'); return h[0]; }\n`);
  const envFil = path.join(dir, 'env');
  const argvFil = path.join(dir, 'ssh-argv');
  const ssh = path.join(dir, 'ssh');
  fs.writeFileSync(ssh, `#!/usr/bin/env bash
printf '%s\\n' "$@" > ${JSON.stringify(argvFil)}
cmd="\${@: -1}"
# KC-0276: the host command is now "sudo -n -u sky /usr/bin/bash /srv/sky/kontrolcenter/<script> <arg>"; run the
# same script from this checkout against the temp .env (SKY_ENV_FIL, which sudo's env_reset would drop for real).
cmd="\${cmd/sudo -n -u sky \\/usr\\/bin\\/bash \\/srv\\/sky\\/kontrolcenter\\//SKY_ENV_FIL=${envFil} bash ${path.dirname(skyRod)}/}"
bash -c "$cmd"
`, { mode: 0o755 });
  return { env: { SKY_BWS_DIR: bws, SKY_SSH_CMD: ssh, SKY_NODE: process.execPath, SKY_SSH_KEY: '/dev/null' }, envFil, argvFil };
}

test('saet-hemmelighed.sh --fra-bws: DEV__ key → SKY_ name, value over stdin into a 0600 .env, only name and length printed', () => {
  const dir = tmp();
  try {
    const vaerdi = 'rk_test_FAKE0123456789abcdef';
    const v = falskVaert(dir, { DEV__STRIPE_SECRET_KEY: vaerdi, R2_ACCESS_KEY_ID: 'r2-fake-id' });
    fs.writeFileSync(v.envFil, 'SKY_PORT=8781\nSKY_STRIPE_SECRET_KEY=gammel\n');
    const r = bash([path.join(skyRod, 'scripts', 'saet-hemmelighed.sh'), '--fra-bws', 'DEV__STRIPE_SECRET_KEY'], { env: v.env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`^SKY_STRIPE_SECRET_KEY sat i /srv/sky/\\.env på henrik@kira-home \\(længde ${vaerdi.length}\\)$`, 'm'));
    assert.ok(!r.stdout.includes(vaerdi) && !r.stderr.includes(vaerdi), 'the value is never printed');
    assert.ok(!fs.readFileSync(v.argvFil, 'utf8').includes(vaerdi), 'the value is never on the ssh command line');
    assert.equal(fs.readFileSync(v.envFil, 'utf8'), `SKY_PORT=8781\nSKY_STRIPE_SECRET_KEY=${vaerdi}\n`, 'the old line replaced, the rest kept');
    assert.equal(fs.statSync(v.envFil).mode & 0o777, 0o600);

    const s = bash([path.join(skyRod, 'scripts', 'saet-hemmelighed.sh'), '--fra-bws', 'R2_ACCESS_KEY_ID', '--som', 'SKY_R2_ACCESS_KEY_ID'], { env: v.env });
    assert.equal(s.status, 0, s.stdout + s.stderr);
    assert.match(fs.readFileSync(v.envFil, 'utf8'), /^SKY_R2_ACCESS_KEY_ID=r2-fake-id$/m);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('saet-hemmelighed.sh refuses a non-SKY_ name and an unknown key, and writes nothing', () => {
  const dir = tmp();
  try {
    const v = falskVaert(dir, { PROD__RESEND_API_KEY: 're_fake' });
    fs.writeFileSync(v.envFil, 'SKY_PORT=8781\n');
    const navn = bash([path.join(skyRod, 'scripts', 'saet-hemmelighed.sh'), '--fra-bws', 'PROD__RESEND_API_KEY', '--som', 'RESEND_API_KEY'], { env: v.env });
    assert.equal(navn.status, 1);
    assert.match(navn.stdout, /ugyldigt navn/);
    const ukendt = bash([path.join(skyRod, 'scripts', 'saet-hemmelighed.sh'), '--fra-bws', 'PROD__FINDES_IKKE'], { env: v.env });
    assert.notEqual(ukendt.status, 0);
    assert.equal(fs.readFileSync(v.envFil, 'utf8'), 'SKY_PORT=8781\n');
    assert.ok(!fs.existsSync(v.argvFil), 'ssh was never called');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('deploy.sh installs with --ignore-scripts and a private log file (KC-0276)', () => {
  const k = laes('deploy.sh');
  assert.match(k, /npm ci --omit=dev --ignore-scripts /);
  assert.ok(!k.includes('/tmp/sky-npm.log'));
});

test('KC-0273: deploy.sh puts the host-side filter in place right after the restart, by the sudoers path, for SKY_TENANT_POOL or the same default Sky uses', async () => {
  const k = laes('deploy.sh');
  const { STANDARD_POOL } = await import('../src/fleet/netfilter.ts');
  const iRestart = k.indexOf('sudo -n /usr/bin/systemctl restart sky');
  const iFilter = k.indexOf('sudo -n /usr/bin/bash "$(pwd)/deploy/netfilter.sh" "$pool"');
  assert.ok(iRestart > 0 && iFilter > iRestart, 'after the restart');
  assert.ok(iFilter < k.indexOf('curl -fsS'), 'before the health check, so a failure stops the deploy');
  assert.match(k, /pool="\$\(grep -E '\^SKY_TENANT_POOL=' \/srv\/sky\/\.env \| cut -d= -f2 \|\| true\)"/);
  assert.ok(k.includes(`pool="\${pool:-${STANDARD_POOL}}"`), 'the default is the one fleet/netfilter.ts uses');
  assert.ok(!/sudo[^\n]*netfilter/.test(fs.readFileSync(path.join(skyRod, 'src', 'fleet', 'lokal.ts'), 'utf8')), 'Sky itself never runs it');
});

test('the sky-side wrappers refuse a bad name or mode and need no shell text from the caller (KC-0276)', () => {
  const dir = tmp();
  try {
    const env = path.join(dir, '.env');
    fs.writeFileSync(env, 'SKY_PORT=8781\n');
    const e = { SKY_ENV_FIL: env };
    assert.equal(bash([path.join(deploy, 'saet-env.sh'), 'RESEND_KEY'], { env: e, input: 'x\n' }).status, 2);
    assert.equal(bash([path.join(deploy, 'saet-env.sh'), 'SKY_X; id'], { env: e, input: 'x\n' }).status, 2);
    assert.equal(bash([path.join(deploy, 'saet-env.sh'), 'SKY_X'], { env: e, input: '' }).status, 2, 'an empty value writes nothing');
    assert.equal(bash([path.join(deploy, 'masternoegle.sh'), '--noget'], { env: e }).status, 2);
    assert.equal(bash([path.join(deploy, 'masternoegle.sh')], { env: e }).status, 2);
    assert.equal(fs.readFileSync(env, 'utf8'), 'SKY_PORT=8781\n');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
