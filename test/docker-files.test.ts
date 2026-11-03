import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// KC-0157: the Docker files, read as text. Docker is not needed to run these; scripts/docker-tjek.mjs proves the image.
const ROD = fileURLToPath(new URL('..', import.meta.url));
const laes = (rel: string): string => readFileSync(path.join(ROD, rel), 'utf8');
const SPRING_OVER = new Set(['node_modules', '.git', 'data', 'data-test']);

function filer(dir: string, rel = ''): string[] {
  const ud: string[] = [];
  for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (SPRING_OVER.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) ud.push(...filer(dir, r));
    else ud.push(r);
  }
  return ud;
}
const ALLE = filer(ROD);
const COMPOSE = ALLE.filter((f) => /(^|\/)(docker-)?compose[^/]*\.ya?ml$/.test(f));
const DOCKER_TEKST = ALLE.filter((f) => /(^|\/)Dockerfile[^/]*$/.test(f) || COMPOSE.includes(f) || f.startsWith('deploy/docker/'));

/**
 * Every port a compose text publishes on more than the machine itself. Short syntax must name the host ip
 * (127.0.0.1 or [::1]); long syntax needs `host_ip:` loopback; flow-style lists and host networking are refused
 * outright, so this reader never has to guess.
 */
function offentligePorte(yaml: string): string[] {
  const fund: string[] = [];
  const linjer = yaml.split('\n');
  const loopback = (ip: string) => ip === '127.0.0.1' || ip === '[::1]' || ip === '::1';
  for (let i = 0; i < linjer.length; i++) {
    const l = linjer[i]!.replace(/\s+#.*$/, '');
    if (/^\s*network_mode:\s*["']?host["']?\s*$/.test(l)) fund.push(`linje ${i + 1}: network_mode host`);
    const m = /^(\s*)ports:\s*(.*)$/.exec(l);
    if (!m) continue;
    if (m[2]!.trim()) { fund.push(`linje ${i + 1}: ports skal være en liste med én port pr. linje`); continue; }
    const indryk = m[1]!.length;
    let lang: { linje: number; ip: string } | null = null;
    const slutLang = () => { if (lang && !loopback(lang.ip)) fund.push(`linje ${lang.linje}: lang port uden host_ip 127.0.0.1`); lang = null; };
    for (let j = i + 1; j < linjer.length; j++) {
      const r = linjer[j]!.replace(/\s+#.*$/, '');
      if (!r.trim() || /^\s*#/.test(r)) continue;
      if (r.length - r.trimStart().length <= indryk) break;
      const punkt = /^\s*-\s*(.*)$/.exec(r);
      if (punkt) {
        slutLang();
        const v = punkt[1]!.trim().replace(/^["']|["']$/g, '');
        if (/^[a-z_]+:\s/.test(v) || /^[a-z_]+:$/.test(v)) {
          lang = { linje: j + 1, ip: '' };
          const ip = /^host_ip:\s*["']?([^"'\s]+)/.exec(v);
          if (ip) lang.ip = ip[1]!;
          continue;
        }
        const ip = /^(\[[^\]]+\]|\d+\.\d+\.\d+\.\d+):\d/.exec(v);
        if (!ip || !loopback(ip[1]!)) fund.push(`linje ${j + 1}: ${v}`);
        continue;
      }
      const ip = /^\s*host_ip:\s*["']?([^"'\s]+)/.exec(r);
      if (ip && lang) lang.ip = ip[1]!;
    }
    slutLang();
  }
  return fund;
}

test('the port reader refuses every way of publishing beyond loopback', () => {
  const daarlige = [
    'services:\n  a:\n    ports:\n      - "8750:8750"\n',
    'services:\n  a:\n    ports:\n      - 8750:8750\n',
    'services:\n  a:\n    ports:\n      - "0.0.0.0:8750:8750"\n',
    'services:\n  a:\n    ports:\n      - "8750"\n',
    'services:\n  a:\n    ports:\n      - target: 8750\n        published: 8750\n',
    'services:\n  a:\n    ports:\n      - target: 8750\n        host_ip: 0.0.0.0\n',
    'services:\n  a:\n    ports: ["127.0.0.1:8750:8750"]\n',
    'services:\n  a:\n    network_mode: host\n',
  ];
  for (const y of daarlige) assert.notDeepEqual(offentligePorte(y), [], y);
  const gode = [
    'services:\n  a:\n    ports:\n      - "127.0.0.1:8750:8750"\n      - "[::1]:8751:8750"\n    volumes:\n      - x:/data\n',
    'services:\n  a:\n    ports:\n      - target: 8750\n        published: 8750\n        host_ip: 127.0.0.1\n',
  ];
  for (const y of gode) assert.deepEqual(offentligePorte(y), [], y);
});

test('no compose file in the repo publishes a port beyond the machine itself (Tailscale-only)', () => {
  assert.ok(COMPOSE.includes('compose.yaml'), 'compose.yaml mangler');
  for (const f of COMPOSE) assert.deepEqual(offentligePorte(laes(f)), [], f);
  assert.match(laes('compose.yaml'), /^\s*-\s*"127\.0\.0\.1:8750:8750"\s*$/m);
});

test('no secret-looking literal in the Docker files', () => {
  const mistaenkt = /tskey-|\bsk-[A-Za-z0-9_-]{10,}|\bghp_[A-Za-z0-9]{10,}|\bxox[abp]-|-----BEGIN [A-Z ]*PRIVATE KEY/;
  // An UPPER_CASE key/token/secret/password variable may be empty, interpolated or a Docker secret file — never a value
  // (a name inside ${…} is a lookup, not an assignment).
  const tildeling = /(?<!\{)\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*[:=]\s*["']?([^\s"'#`]*)/g;
  assert.ok(DOCKER_TEKST.includes('Dockerfile'));
  for (const f of DOCKER_TEKST) {
    const t = laes(f);
    assert.doesNotMatch(t, mistaenkt, f);
    for (const m of t.matchAll(tildeling)) {
      const v = m[2]!;
      assert.ok(v === '' || v.startsWith('${') || v.startsWith('$') || /^file:\/run\/secrets\/[a-z_]+$/.test(v), `${f}: ${m[1]} har en værdi`);
    }
  }
});

test('the user folder is a volume at /data, declared in the image and in compose', () => {
  const df = laes('Dockerfile');
  assert.match(df, /^VOLUME \/data\s*$/m);
  assert.match(df, /\bKC_DATA_DIR=\/data\b/);
  const c = laes('compose.yaml');
  assert.match(c, /^\s*-\s*clawco-data:\/data\s*$/m);
  assert.match(c, /^volumes:\s*\n\s+clawco-data:/m);
});

test('the image runs as a non-root user, set after the last RUN', () => {
  const linjer = laes('Dockerfile').split('\n');
  const bruger = linjer.findLastIndex((l) => /^USER\s+/.test(l));
  const run = linjer.findLastIndex((l) => /^RUN\s+/.test(l));
  assert.ok(bruger > run, 'USER skal stå efter sidste RUN');
  assert.doesNotMatch(linjer[bruger]!, /^USER\s+(root|0)(:|\s|$)/);
});

test('the build bakes GIT_SHA into the file /health reads, and the health check calls /health', () => {
  const df = laes('Dockerfile');
  assert.match(df, /^ARG GIT_SHA\s*$/m);
  assert.match(df, /"\$GIT_SHA" > GIT_SHA/);
  assert.match(df, /^HEALTHCHECK\b[\s\S]*\/health/m);
  assert.match(df, /^FROM node:24\.\d+\.\d+-bookworm-slim$/m, 'the exact Node release, not the moving 24 tag (KC-0276)');
});

test('the root filesystem is read-only in compose, so nothing user-owned lands in the image layer', () => {
  const c = laes('compose.yaml');
  assert.match(c, /^\s+read_only:\s*true\s*$/m);
});

test('the Tailscale profile never opens Funnel and reads its key from a Docker secret', () => {
  const serve = JSON.parse(laes('deploy/docker/tailscale/serve.json')) as { AllowFunnel?: Record<string, boolean>; Web?: Record<string, unknown> };
  for (const [k, v] of Object.entries(serve.AllowFunnel ?? {})) assert.equal(v, false, k);
  assert.ok(serve.Web && Object.keys(serve.Web).every((k) => k.startsWith('${TS_CERT_DOMAIN}:')));
  const c = laes('compose.yaml');
  assert.match(c, /TS_AUTHKEY:\s*file:\/run\/secrets\/ts_authkey/);
  assert.match(c, /profiles:\s*\[tailscale\]/);
});

// ---- KC-0245: the built-in agent is the container's default ----

test('the container runs the built-in agent by default, with its key file on a volume of its own outside /data', () => {
  const df = laes('Dockerfile');
  // No KC_AGENT in the image: start.sh picks it, so an older container that ran its own Hermes keeps it.
  assert.doesNotMatch(df, /^\s+KC_AGENT=/m);
  assert.match(df, /\bKC_HEMMELIGHEDER_FIL=\/noegle\/hemmeligheder\.key\b/);
  assert.match(df, /^VOLUME \/noegle\s*$/m);
  assert.match(df, /^ENTRYPOINT \["sh", "\/usr\/local\/bin\/clawco-start\.sh"\]/m);
  const c = laes('compose.yaml');
  assert.match(c, /KC_AGENT:\s*\$\{KC_AGENT:-\}/);
  assert.match(c, /^\s*-\s*clawco-noegle:\/noegle\s*$/m);
  assert.match(c, /^volumes:\s*\n(?:\s+[a-z-]+:\s*\n)*\s+clawco-noegle:/m);
  assert.match(c, /host\.docker\.internal:host-gateway/, 'a local model on the host (LM Studio, Ollama) is reachable from the container');
  const dockerignore = laes('.dockerignore');
  assert.match(dockerignore, /^!deploy\/docker\/start\.sh\s*$/m);
  assert.match(df, /^COPY deploy\/docker\/start\.sh \/usr\/local\/bin\/clawco-start\.sh\s*$/m);
});

test('start.sh makes the key file once (mode 600, 32 random bytes in base64), never overwrites it, and never replaces the key of an existing store', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'kc-start-sh-'));
  try {
    const data = path.join(tmp, 'data');
    const noegle = path.join(tmp, 'noegle', 'hemmeligheder.key');
    mkdirSync(data);
    mkdirSync(path.dirname(noegle));
    const koer = () => spawnSync('sh', [path.join(ROD, 'deploy', 'docker', 'start.sh'), 'sh', '-c', 'echo startet'], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', KC_DATA_DIR: data, KC_HEMMELIGHEDER_FIL: noegle } });
    const a = koer();
    assert.equal(a.status, 0, a.stderr);
    assert.match(a.stdout, /startet/, 'it then runs the command it was given');
    assert.equal(statSync(noegle).mode & 0o777, 0o600);
    const foer = readFileSync(noegle, 'utf8');
    assert.match(foer.trim(), /^[A-Za-z0-9+/]{43}=$/);
    assert.ok(!a.stdout.includes(foer.trim()) && !a.stderr.includes(foer.trim()), 'never printed');
    assert.equal(koer().status, 0);
    assert.equal(readFileSync(noegle, 'utf8'), foer, 'unchanged on the next start');
    // A store whose key file is gone: a new key could never open it, so none is made; the start says why and goes on.
    rmSync(noegle);
    writeFileSync(path.join(data, 'hemmeligheder.enc'), 'chiffer');
    const b = koer();
    assert.equal(b.status, 0);
    assert.ok(!existsSync(noegle));
    assert.match(b.stderr, /hemmeligheder\.enc/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('start.sh picks the built-in agent for a new container and keeps Hermes for one that already used it', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'kc-start-agent-'));
  try {
    const data = path.join(tmp, 'data');
    mkdirSync(data);
    const envFil = path.join(data, '.env');
    const agent = (ekstra: Record<string, string>) => {
      const r = spawnSync('sh', [path.join(ROD, 'deploy', 'docker', 'start.sh'), 'sh', '-c', 'echo "agent=${KC_AGENT-unset}"'], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', KC_DATA_DIR: data, KC_ENV_FILE: envFil, KC_AGENT: '', ...ekstra } });
      assert.equal(r.status, 0, r.stderr);
      return /agent=(.*)/.exec(r.stdout)?.[1];
    };
    assert.equal(agent({}), 'direkte', 'a new container: the built-in agent');
    assert.equal(agent({ KC_HERMES_URL: 'http://hermes.example:8642' }), 'hermes-http', 'a Hermes address set: Hermes');
    writeFileSync(envFil, 'KC_HERMES_API_KEY=falsk-noegle\n');
    assert.equal(agent({}), 'hermes-http', 'a Hermes key saved in Start earlier: Hermes');
    assert.equal(agent({ KC_AGENT: 'direkte' }), 'direkte', 'an explicit choice always wins');
    writeFileSync(envFil, 'KC_AGENT=fake\n');
    // compose passes KC_AGENT as an empty string; Node's --env-file never overrides a variable that is set, so it is
    // removed and the server reads the user folder's choice.
    assert.equal(agent({}), 'unset', 'a choice in the user folder\'s .env wins too');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

/** Docker's .dockerignore, simplified: last matching line wins, a match on a parent folder covers what is inside. */
function ignoreret(regler: string[], fil: string): boolean {
  const regex = (p: string) => new RegExp('^' + p.replace(/\/$/, '').split(/(\*\*\/|\*\*|\*|\?)/).map((d) =>
    d === '**/' ? '(?:.*/)?' : d === '**' ? '.*' : d === '*' ? '[^/]*' : d === '?' ? '[^/]' : d.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('') + '$');
  const dele = fil.split('/');
  const stier = dele.map((_, i) => dele.slice(0, i + 1).join('/'));
  let ud = false;
  for (const r of regler) {
    const ja = r.startsWith('!');
    const re = regex(ja ? r.slice(1) : r);
    if (stier.some((s) => re.test(s))) ud = !ja;
  }
  return ud;
}

test('.dockerignore lets in only what the app runs on', () => {
  const regler = laes('.dockerignore').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const f of ['.env', 'src/.env.local', 'data/rum/x.json', '.git/HEAD', 'sky/src/server.ts', 'config/omkostninger.json', 'node_modules/hono/x.js', 'src/node_modules/x.js', 'docs/VISION.md', 'test/server.test.ts', 'deploy/install.sh', 'AGENTS.md', 'GIT_SHA']) {
    assert.ok(ignoreret(regler, f), `${f} må ikke komme med i billedet`);
  }
  for (const f of ['package.json', 'package-lock.json', 'src/server.ts', 'src/rooms/hjem/render.ts', 'public/app.js', 'config/priser.json', 'test/fixtures/himalaya_handling_sample.json']) {
    assert.ok(!ignoreret(regler, f), `${f} skal med i billedet`);
  }
  for (const f of ['src/server.ts', 'public/app.js', 'test/fixtures/himalaya_handling_sample.json']) assert.ok(existsSync(path.join(ROD, f)), f);
});
