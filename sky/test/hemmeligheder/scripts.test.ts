// KC-0181: the master key is made ON the Sky host (sky/scripts/ny-masternoegle.sh): it never travels,
// never appears on a command line and is never printed — only its name and length. A fake ssh runs the
// remote command locally on a temp .env (the same pattern as deploy.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { laesMasternoegle } from '../../src/hemmeligheder/masternoegle.ts';

const skyRod = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(skyRod, 'scripts', 'ny-masternoegle.sh');

function rentMiljoe(ekstra: Record<string, string>): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_') && !k.startsWith('SKY_')) e[k] = v;
  return { ...e, ...ekstra };
}

function falskVaert(dir: string) {
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
  const koer = (args: string[]) => spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env: rentMiljoe({ SKY_SSH_CMD: ssh, SKY_SSH_KEY: '/dev/null' }) });
  const laes = (): Record<string, string> => Object.fromEntries(fs.readFileSync(envFil, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  return { envFil, argvFil, koer, laes };
}

test('first run makes a 32-byte key on the host, 0600, prints name + length only; a second run refuses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-kek-'));
  try {
    const v = falskVaert(dir);
    fs.writeFileSync(v.envFil, 'SKY_PORT=8781\n');
    const r = v.koer([]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const env = v.laes();
    assert.equal(env['SKY_PORT'], '8781');
    const kek = env['SKY_MASTERNOEGLE']!;
    assert.equal(Buffer.from(kek, 'base64').length, 32);
    assert.equal(env['SKY_MASTERNOEGLE_VERSION'], '1');
    assert.equal(laesMasternoegle({ ...env }).aktuel.version, 1, 'Sky accepts what the script wrote');
    assert.match(r.stdout, /SKY_MASTERNOEGLE sat i .* \(længde 44, version 1\)/);
    for (const s of [r.stdout, r.stderr, fs.readFileSync(v.argvFil, 'utf8')]) assert.ok(!s.includes(kek));
    assert.equal(fs.statSync(v.envFil).mode & 0o777, 0o600);

    const igen = v.koer([]);
    assert.equal(igen.status, 3);
    assert.match(igen.stderr, /SKY_MASTERNOEGLE findes allerede/);
    assert.equal(v.laes()['SKY_MASTERNOEGLE'], kek, 'never overwritten');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('--roter keeps the old key as _FORRIGE and bumps the version; --afslut removes _FORRIGE', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-kek-'));
  try {
    const v = falskVaert(dir);
    fs.writeFileSync(v.envFil, 'SKY_PORT=8781\n');
    assert.equal(v.koer([]).status, 0);
    const gammel = v.laes()['SKY_MASTERNOEGLE']!;

    const r = v.koer(['--roter']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const env = v.laes();
    assert.equal(env['SKY_MASTERNOEGLE_FORRIGE'], gammel);
    assert.notEqual(env['SKY_MASTERNOEGLE'], gammel);
    assert.equal(env['SKY_MASTERNOEGLE_VERSION'], '2');
    const ring = laesMasternoegle({ ...env });
    assert.equal(ring.forrige?.version, 1);
    for (const s of [r.stdout, r.stderr]) assert.ok(!s.includes(gammel) && !s.includes(env['SKY_MASTERNOEGLE']!));

    assert.match(v.koer(['--roter']).stderr, /rotation er ikke afsluttet/, 'one rotation at a time');
    const a = v.koer(['--afslut']);
    assert.equal(a.status, 0, a.stdout + a.stderr);
    assert.deepEqual(Object.keys(v.laes()).sort(), ['SKY_MASTERNOEGLE', 'SKY_MASTERNOEGLE_VERSION', 'SKY_PORT']);
    assert.equal(v.laes()['SKY_MASTERNOEGLE'], env['SKY_MASTERNOEGLE']);
    assert.equal(v.koer(['--afslut']).status, 3);
    assert.equal(v.koer(['--noget']).status, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
