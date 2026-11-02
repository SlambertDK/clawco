import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// KC-0171: deploy/egen-sky/hetzner.sh — Clawco on a small VM in the user's own Hetzner account, tailnet only.
// Invariants (D3, VISION "Ingen sky hos os"): no public port, no SSH, the auth key lives only in the cloud-init
// (and is shredded on the VM), the token never reaches a command line, and the only hosts the script talks to
// are api.hetzner.cloud (the user's account) and github.com (the public mirror). No network: --dry-run, and a
// fake curl for the apply path.
const ROD = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = path.join(ROD, 'deploy', 'egen-sky', 'hetzner.sh');
const NOEGLE = 'tskey-auth-TESTONLY-xxxx'; // gitleaks:allow
const TOKEN = 'HcloudTestToken0123456789abcdefABCDEF'; // gitleaks:allow

let tmp = '';
let noeglefil = '';

before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'kc-egensky-'));
  noeglefil = path.join(tmp, 'authkey');
  writeFileSync(noeglefil, `${NOEGLE}\n`, { mode: 0o600 });
});
after(() => { rmSync(tmp, { recursive: true, force: true }); });

type Resultat = { code: number | null; out: string; err: string };

function koer(args: string[], env: Record<string, string> = {}, input = ''): Promise<Resultat> {
  return new Promise((resolve) => {
    const p = spawn('bash', [SCRIPT, ...args], { env: { PATH: process.env['PATH'] ?? '', HOME: tmp, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += String(d); });
    p.stderr.on('data', (d) => { err += String(d); });
    p.on('close', (code) => resolve({ code, out, err }));
    p.stdin.on('error', () => {});
    p.stdin.end(input);
  });
}

/** The part of a dry run between two marker lines. */
function afsnit(out: string, fra: string, til: string): string {
  const a = out.indexOf(fra);
  assert.ok(a >= 0, `marker missing: ${fra}`);
  const b = out.indexOf(til, a + fra.length);
  assert.ok(b >= 0, `marker missing: ${til}`);
  return out.slice(a + fra.length, b).replace(/^\n/, '');
}
const FIREWALL_FRA = '--- firewall (JSON) ---';
const CLOUDINIT_FRA = '--- cloud-init ---';
const SLUT = '--- slut ---';

async function toerkoersel(ekstra: string[] = [], env: Record<string, string> = {}) {
  const r = await koer(['--dry-run', '--navn', 'test', '--authkey-fil', noeglefil, ...ekstra], env);
  assert.equal(r.code, 0, r.err);
  return { ...r, firewall: afsnit(r.out, FIREWALL_FRA, CLOUDINIT_FRA), cloudinit: afsnit(r.out, CLOUDINIT_FRA, SLUT) };
}

test('the script parses (bash -n) and is wrapped in one function called on the last line', () => {
  const r = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(SCRIPT, 'utf8').trimEnd().split('\n').at(-1), 'main "$@"');
});

test('--help is Danish, names what the user pays and to whom, the token, the single-use key and that there is no SSH', async () => {
  const r = await koer(['--help']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^Brug: /m);
  assert.match(r.out, /Hetzner/);
  assert.match(r.out, /4.5 euro/, 'the cost to the provider');
  assert.match(r.out, /Tailscale-konto er gratis/i, 'the Tailscale account is free');
  assert.match(r.out, /Clawco er gratis/i);
  assert.match(r.out, /HCLOUD_TOKEN/);
  assert.match(r.out, /SSH/, 'the no-SSH fact');
  assert.match(r.out, /(ingen SSH|uden SSH|ikke SSH)/i);
  assert.match(r.out, /engangs/i, 'single-use key advice');
  assert.match(r.out, /--dry-run/);
});

test('--dry-run with no token still works, prints the plan with the monthly cost, and makes no network call', async () => {
  const r = await toerkoersel();
  assert.match(r.out, /Hetzner/);
  assert.match(r.out, /cx22/);
  assert.match(r.out, /fsn1/);
  assert.match(r.out, /clawco-test/);
  assert.match(r.out, /ca\. 4.5 euro om måneden/);
  assert.match(r.out, /Der sendes intet/i);
});

test('the firewall has no inbound rule at all (Hetzner firewalls are allow-lists: no rule = all inbound denied)', async () => {
  const { firewall } = await toerkoersel();
  const j = JSON.parse(firewall) as { name: string; rules: unknown[] };
  assert.equal(j.name, 'clawco-test');
  assert.deepEqual(j.rules, []);
  assert.doesNotMatch(firewall, /"direction"\s*:\s*"in"/);
});

test('the cloud-init denies inbound, opens no SSH/web port, publishes no wide port, and starts the tailscale profile', async () => {
  const { cloudinit } = await toerkoersel();
  assert.match(cloudinit, /^#cloud-config/);
  assert.ok(cloudinit.includes('ufw default deny incoming'));
  assert.ok(cloudinit.includes('ufw default allow outgoing'));
  assert.ok(cloudinit.includes('ufw allow 41641/udp'));
  assert.ok(cloudinit.includes('ufw --force enable'));
  for (const forbudt of ['allow 22', 'allow 80', 'allow 443', 'allow ssh', 'allow OpenSSH', '0.0.0.0:8750', 'openssh-server']) {
    assert.ok(!cloudinit.includes(forbudt), `the cloud-init must not contain: ${forbudt}`);
  }
  assert.ok(cloudinit.includes('docker compose --profile tailscale up -d --build'));
  assert.ok(cloudinit.includes('CLAWCO_TS_NAVN=test'));
  assert.ok(cloudinit.includes('GIT_SHA=$(git rev-parse --short HEAD)'));
  assert.ok(cloudinit.includes('git clone --depth 1 https://github.com/SlambertDK/clawco.git /opt/clawco'));
  assert.ok(cloudinit.includes('unattended-upgrades'));
});

test('a dry run never prints the auth key: the cloud-init holds one masked placeholder where the key goes', async () => {
  const r = await toerkoersel();
  assert.ok(!r.out.includes(NOEGLE), 'the key must not reach the terminal in a dry run');
  assert.ok(!r.err.includes(NOEGLE));
  const pladser = r.cloudinit.split('\n').filter((l) => l.includes('/root/.config/clawco/tailscale-authkey') && l.includes('path:'));
  assert.equal(pladser.length, 1);
  assert.equal(r.cloudinit.split('<NØGLE').length - 1, 1, 'exactly one placeholder');
  assert.ok(r.cloudinit.includes(`<NØGLE, ${NOEGLE.length} tegn, vises ikke>`));
});

test('the key file is written mode 600, read only by the start script, shredded after the node has joined, and recreated empty', async () => {
  const { cloudinit } = await toerkoersel();
  assert.match(cloudinit, /permissions: '0600'/);
  const skrevet = cloudinit.indexOf('<NØGLE');
  const shred = cloudinit.indexOf('shred -u /root/.config/clawco/tailscale-authkey');
  const op = cloudinit.indexOf('docker compose --profile tailscale up -d --build');
  assert.ok(skrevet > 0 && op > skrevet && shred > op, 'order: write key, compose up, shred');
  // Not before the node is on the tailnet: the container reads the file at start.
  const ventet = cloudinit.indexOf('tailscale ip -4');
  assert.ok(ventet > op && ventet < shred, 'waits for the tailnet address before shredding');
  // The compose file bind-mounts the secret: a missing source would stop the container after a reboot.
  assert.match(cloudinit.slice(shred), /: > \/root\/\.config\/clawco\/tailscale-authkey/);
  assert.ok(cloudinit.includes('CLAWCO_TS_AUTHKEY_FIL=/root/.config/clawco/tailscale-authkey'));
});

test('--sha clones in full and checks out that commit; --ref clones that branch or tag at depth 1; not both', async () => {
  const sha = await toerkoersel(['--sha', 'abc1234']);
  assert.ok(sha.cloudinit.includes('git clone https://github.com/SlambertDK/clawco.git /opt/clawco'));
  assert.ok(sha.cloudinit.includes('git -C /opt/clawco checkout abc1234'));
  const ref = await toerkoersel(['--ref', 'v0.3.0']);
  assert.ok(ref.cloudinit.includes('git clone --depth 1 --branch v0.3.0 https://github.com/SlambertDK/clawco.git /opt/clawco'));
  const begge = await koer(['--dry-run', '--sha', 'abc1234', '--ref', 'main', '--authkey-fil', noeglefil]);
  assert.equal(begge.code, 1);
  assert.match(begge.err, /enten/i);
});

test('inputs that could break out of the YAML or the shell are refused', async () => {
  for (const args of [['--navn', 'Test'], ['--navn', 'a b'], ['--navn', 'a;rm'], ['--navn', '-x'], ['--sted', 'ash'], ['--type', 'cx22;id'], ['--sha', 'zzz'], ['--ref', 'x y'], ['--ref', '$(id)'], ['--bogus']]) {
    const r = await koer(['--dry-run', '--authkey-fil', noeglefil, ...args]);
    assert.equal(r.code, 1, args.join(' '));
    assert.ok(r.err.length > 0);
  }
  for (const daarlig of ['tskey-auth-x\nruncmd: [rm]', 'tskey-auth-x y', "tskey-auth-'x", 'andet-x', '']) {
    const f = path.join(tmp, 'daarlig');
    writeFileSync(f, daarlig + '\n');
    const r = await koer(['--dry-run', '--authkey-fil', f]);
    assert.equal(r.code, 1, JSON.stringify(daarlig));
    assert.ok(!r.out.includes('rm]'));
  }
  const mangler = await koer(['--dry-run', '--authkey-fil', path.join(tmp, 'findes-ikke')]);
  assert.equal(mangler.code, 1);
  assert.match(mangler.err, /nøgle/i);
});

test('a dry run without any key file and no terminal still shows the plan (masked placeholder)', async () => {
  const r = await koer(['--dry-run', '--navn', 'test']);
  assert.equal(r.code, 0, r.err);
  assert.ok(r.out.includes('<NØGLE'));
});

test('the script talks to api.hetzner.cloud and github.com only (clawco.work and the consoles appear as pointers, never as a call)', () => {
  const tekst = readFileSync(SCRIPT, 'utf8');
  const vaerter = new Set(Array.from(tekst.matchAll(/https?:\/\/([a-z0-9.-]+)/gi), (m) => m[1]!.toLowerCase()));
  const tilladt = new Set(['api.hetzner.cloud', 'github.com', 'clawco.work', 'console.hetzner.cloud', 'login.tailscale.com', 'tailscale.com']);
  for (const v of vaerter) assert.ok(tilladt.has(v), `unexpected host in the script: ${v}`);
  // Every command that makes a request goes through one function and one base address.
  const curlLinjer = tekst.replace(/\\\n/g, ' ').split('\n').filter((l) => /\bcurl\b/.test(l) && !/^\s*#/.test(l) && !/^\s*(info|printf)\b/.test(l) && !/echo/.test(l));
  for (const l of curlLinjer) assert.ok(/\$HETZNER_API|\$\{HETZNER_API\}|api\.hetzner\.cloud/.test(l) || /curl\s+-V|command -v curl/.test(l), `a curl call outside the API function: ${l.trim()}`);
  assert.match(tekst, /^HETZNER_API=https:\/\/api\.hetzner\.cloud\/v1$/m);
  assert.ok(!/(^|[\s;|&(])(wget|nc|ssh|scp)\s/.test(tekst.replace(/#.*$/gm, '').replace(/<<'?TEKST'?[\s\S]*?\nTEKST/g, '')), 'no other way out');
});

// ---------------------------------------------------------------- apply path, against a fake curl

function falskCurl(svar: { firewall?: [number, string]; server?: [number, string]; hent?: string[]; slet?: [number, string] }): { bin: string; log: string; stdinlog: string } {
  const bin = mkdtempSync(path.join(tmp, 'bin-'));
  const log = path.join(bin, 'kald.log');
  const stdinlog = path.join(bin, 'stdin.log');
  const taeller = path.join(bin, 'taeller');
  const [fwKode, fwKrop] = svar.firewall ?? [201, '{"firewall": {"id": 38, "name": "clawco-test"}}'];
  const [srvKode, srvKrop] = svar.server ?? [201, '{"server": {"id": 4242, "name": "clawco-test", "status": "initializing"}}'];
  const hent = svar.hent ?? ['{"server": {"id": 4242, "status": "initializing"}}', '{"server": {"id": 4242, "status": "running"}}'];
  const [sletKode, sletKrop] = svar.slet ?? [200, '{}'];
  // A sh script: records argv (and any -K config the shell passes as a file), the request body from stdin, and answers per URL.
  writeFileSync(path.join(bin, 'curl'), `#!/bin/sh
echo "ARGV: $*" >> '${log}'
url=''
metode=GET
prev=''
for a in "$@"; do
  case "$prev" in -K) echo "CONFIG: $(cat "$a")" >> '${log}';; -X) metode=$a;; esac
  case "$a" in https://*) url=$a;; esac
  prev=$a
done
case " $* " in *"--data-binary"*) cat >> '${stdinlog}'; echo >> '${stdinlog}';; esac
echo "URL: $metode $url" >> '${log}'
case "$metode $url" in
  "POST https://api.hetzner.cloud/v1/firewalls") printf '%s\\n%s' '${fwKrop}' '${fwKode}';;
  "POST https://api.hetzner.cloud/v1/servers") printf '%s\\n%s' '${srvKrop}' '${srvKode}';;
  "DELETE https://api.hetzner.cloud/v1/firewalls/38") printf '%s\\n%s' '${sletKrop}' '${sletKode}';;
  "GET https://api.hetzner.cloud/v1/servers/4242")
    n=$(cat '${taeller}' 2>/dev/null || echo 0); n=$((n + 1)); echo $n > '${taeller}'
    case $n in ${hent.map((h, i) => `${i + 1}) printf '%s\\n%s' '${h}' 200;;`).join(' ')} *) printf '%s\\n%s' '${hent.at(-1)}' 200;; esac;;
  *) printf '%s\\n%s' '{"error":{"code":"not_found"}}' 404;;
esac
`);
  chmodSync(path.join(bin, 'curl'), 0o755);
  return { bin, log, stdinlog };
}

const laes = (f: string): string => (existsSync(f) ? readFileSync(f, 'utf8') : '');

function anvend(bin: string, ekstra: string[] = [], env: Record<string, string> = {}) {
  return koer(['--navn', 'test', '--authkey-fil', noeglefil, ...ekstra], {
    PATH: `${bin}:${process.env['PATH'] ?? ''}`,
    HCLOUD_TOKEN: TOKEN,
    CLAWCO_VENTEPAUSE: '0',
    ...env,
  });
}

test('apply: creates the firewall, then the server with the cloud-init as user_data and the firewall attached, polls until running, and prints the tailnet address and health command', async () => {
  const f = falskCurl({});
  const r = await anvend(f.bin);
  assert.equal(r.code, 0, r.out + r.err);
  const kald = laes(f.log);
  const urler = kald.split('\n').filter((l) => l.startsWith('URL: '));
  assert.equal(urler[0], 'URL: POST https://api.hetzner.cloud/v1/firewalls');
  assert.equal(urler[1], 'URL: POST https://api.hetzner.cloud/v1/servers');
  assert.equal(urler.filter((u) => u.startsWith('URL: GET https://api.hetzner.cloud/v1/servers/4242')).length, 2, 'polled until running');
  for (const u of urler) assert.match(u, /^URL: (GET|POST) https:\/\/api\.hetzner\.cloud\/v1\//, 'only the Hetzner API');
  const body = laes(f.stdinlog).split('\n').filter(Boolean);
  const fw = JSON.parse(body[0]!) as { rules: unknown[] };
  assert.deepEqual(fw.rules, []);
  const srv = JSON.parse(body[1]!) as { name: string; server_type: string; image: string; location: string; user_data: string; firewalls: { firewall: number }[]; public_net: { enable_ipv4: boolean } };
  assert.equal(srv.name, 'clawco-test');
  assert.equal(srv.server_type, 'cx22');
  assert.equal(srv.image, 'ubuntu-24.04');
  assert.equal(srv.location, 'fsn1');
  assert.deepEqual(srv.firewalls, [{ firewall: 38 }]);
  assert.equal(srv.public_net.enable_ipv4, true);
  // The real key is in the user_data exactly once, followed by the shred.
  assert.equal(srv.user_data.split(NOEGLE).length - 1, 1);
  assert.ok(srv.user_data.indexOf('shred -u') > srv.user_data.indexOf(NOEGLE));
  assert.ok(srv.user_data.includes('ufw default deny incoming'));
  assert.match(r.out, /Clawco kommer op på https:\/\/test\.<dit tailnet>\.ts\.net/);
  assert.match(r.out, /curl -fsS https:\/\/test\.<dit tailnet>\.ts\.net\/health/);
  assert.ok(!r.out.includes(NOEGLE) && !r.err.includes(NOEGLE) && !r.out.includes(TOKEN) && !r.err.includes(TOKEN), 'neither secret is printed');
});

test('apply: the token and the key never appear on a command line; the token goes to curl as a config on a file descriptor', async () => {
  const f = falskCurl({});
  await anvend(f.bin);
  const argv = laes(f.log).split('\n').filter((l) => l.startsWith('ARGV: ')).join('\n');
  assert.ok(!argv.includes(TOKEN), 'token in argv');
  assert.ok(!argv.includes(NOEGLE), 'key in argv');
  assert.ok(laes(f.log).includes(`Authorization: Bearer ${TOKEN}`), 'the token reaches curl through -K');
  // And nothing is left on disk by the script.
  assert.deepEqual(readdirSync(tmp).filter((n) => n.includes('tskey') || n.includes('token')), []);
});

test('apply without HCLOUD_TOKEN stops in plain Danish before any call', async () => {
  const f = falskCurl({});
  const r = await koer(['--navn', 'test', '--authkey-fil', noeglefil], { PATH: `${f.bin}:${process.env['PATH'] ?? ''}` });
  assert.equal(r.code, 1);
  assert.match(r.err, /HCLOUD_TOKEN/);
  assert.equal(laes(f.log), '', 'no call was made');
});

test('apply: a 401 is one plain Danish sentence and exit 1; nothing else is created', async () => {
  const f = falskCurl({ firewall: [401, '{"error":{"code":"unauthorized","message":"unable to authenticate"}}'] });
  const r = await anvend(f.bin);
  assert.equal(r.code, 1);
  assert.match(r.err, /afviste din API-nøgle/i);
  assert.ok(!laes(f.log).includes('/v1/servers'), 'no server call after a refused firewall');
  assert.ok(!r.err.includes(TOKEN));
});

test('apply: a quota error on the server removes the firewall this run created and says so', async () => {
  const f = falskCurl({ server: [403, '{"error":{"code":"resource_limit_exceeded","message":"server limit exceeded"}}'] });
  const r = await anvend(f.bin);
  assert.equal(r.code, 1);
  assert.match(r.err, /grænse|kvote/i);
  assert.ok(laes(f.log).includes('URL: DELETE https://api.hetzner.cloud/v1/firewalls/38'), 'the firewall it made is deleted again');
});

// ---------------------------------------------------------------- wiring

test('the README exists, is English, and states what the script never does and how to destroy and update the server', () => {
  const p = path.join(ROD, 'deploy', 'egen-sky', 'README.md');
  assert.ok(existsSync(p));
  const t = readFileSync(p, 'utf8');
  for (const s of [/no public port/i, /no SSH/i, /destroy/i, /--sha/, /Fly\.io/, /HCLOUD_TOKEN/, /shred/]) assert.match(t, s);
});

test('site-byg publishes the script byte-identically under /egen-sky/hetzner.sh', () => {
  const ud = path.join(tmp, 'site-ud');
  const r = spawnSync('node', [path.join(ROD, 'scripts/site-byg.mjs'), '--ud', ud], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(path.join(ud, 'egen-sky', 'hetzner.sh'), 'utf8'), readFileSync(SCRIPT, 'utf8'));
  assert.match(r.stdout, /hetzner\.sh sha256 [0-9a-f]{64}/);
});
