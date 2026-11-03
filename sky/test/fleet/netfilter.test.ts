// KC-0273 (C2, Sky half): tenant containers reach the internet (the model proxy through Sky's public address, RSS,
// IMAP) but never the host's networks. Every tenant network is a /24 from one fixed pool (SKY_TENANT_POOL); deploy.sh
// runs sky/deploy/netfilter.sh <pool> as root once per deploy, which filters the WHOLE pool and leaves a marker file.
// Sky never calls sudo: it reads the marker, shows it on /health and refuses to start a tenant unless it is `ok`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { NETFILTER_SCRIPT, STANDARD_POOL, kraevFilter, laesTenantPool, netfilterTilstand, undernetFor } from '../../src/fleet/netfilter.ts';

test('SKY_TENANT_POOL: default 10.200.0.0/16; only a /16 in private space; anything else names the key', () => {
  assert.equal(STANDARD_POOL, '10.200.0.0/16');
  assert.equal(laesTenantPool({}).cidr, '10.200.0.0/16');
  assert.equal(laesTenantPool({ SKY_TENANT_POOL: ' 172.30.0.0/16 ' }).cidr, '172.30.0.0/16');
  assert.equal(laesTenantPool({ SKY_TENANT_POOL: '192.168.0.0/16' }).cidr, '192.168.0.0/16');
  for (const nej of ['10.200.0.0/24', '10.200.1.0/16', '8.8.0.0/16', '172.32.0.0/16', '100.64.0.0/16', '10.200.0.0', '10.256.0.0/16', '10.200.0.0/16;id', '010.200.0.0/16']) {
    assert.throws(() => laesTenantPool({ SKY_TENANT_POOL: nej }), /SKY_TENANT_POOL/, nej);
  }
});

test('undernetFor: tenant n gets 10.200.n.0/24 with the gateway .1; 0 is the shared network; outside 0..255 throws', () => {
  const p = laesTenantPool({});
  assert.deepEqual(undernetFor(p, 1), { subnet: '10.200.1.0/24', gateway: '10.200.1.1' });
  assert.deepEqual(undernetFor(p, 0), { subnet: '10.200.0.0/24', gateway: '10.200.0.1' });
  assert.deepEqual(undernetFor(p, 255), { subnet: '10.200.255.0/24', gateway: '10.200.255.1' });
  for (const n of [-1, 256, 1.5]) assert.throws(() => undernetFor(p, n));
});

function marker(indhold: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kc0273-marker-'));
  const f = path.join(dir, 'netfilter.ok');
  if (indhold !== null) fs.writeFileSync(f, indhold);
  return f;
}

test('the marker: ok when its pool is the configured pool, forældet when it differs, mangler when absent or unreadable', async () => {
  const p = laesTenantPool({});
  assert.equal(await netfilterTilstand(p, marker('pool=10.200.0.0/16\ntid=2026-11-03T20:00:00Z\n')), 'ok');
  assert.equal(await netfilterTilstand(p, marker('pool=172.30.0.0/16\ntid=2026-11-03T20:00:00Z\n')), 'forældet');
  assert.equal(await netfilterTilstand(p, marker('tid=2026-11-03T20:00:00Z\n')), 'forældet');
  assert.equal(await netfilterTilstand(p, marker(null)), 'mangler');
});

test('kraevFilter: passes only on ok; otherwise the error names the state and the fix (deploy.sh)', async () => {
  const p = laesTenantPool({});
  await kraevFilter({ pool: p, tilstand: async () => 'ok' });
  for (const t of ['mangler', 'forældet'] as const) {
    await assert.rejects(kraevFilter({ pool: p, tilstand: async () => t }), new RegExp(`netfilter: ${t}.*deploy\\.sh.*10\\.200\\.0\\.0/16`));
  }
});

test('Sky never calls sudo: no runtime module under sky/src runs sudo', () => {
  const filer = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filer(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []));
  const src = path.resolve(path.dirname(NETFILTER_SCRIPT), '..', 'src');
  for (const f of filer(src)) assert.ok(!/['"]sudo['"]/.test(fs.readFileSync(f, 'utf8')), f);
});

test('the script: the pool as its one argument (a private /16); --vis prints the plan and the marker without root', () => {
  const vis = spawnSync('/bin/bash', [NETFILTER_SCRIPT, '--vis', '10.200.0.0/16'], { encoding: 'utf8' });
  assert.equal(vis.status, 0, vis.stderr);
  const l = vis.stdout.trim().split('\n');
  for (const r of ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '169.254.0.0/16', '127.0.0.0/8']) {
    assert.ok(l.includes(`iptables -w -A CLAWCO-LEJER-UD -d ${r} -j DROP`), r);
  }
  const ud = l.findIndex((x) => x === 'iptables -w -A CLAWCO-LEJER-UD -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN');
  assert.ok(ud >= 0 && ud < l.findIndex((x) => x.includes('-d 10.0.0.0/8')), 'answers to connections already allowed come first');
  assert.ok(l.includes('iptables -w -I DOCKER-USER 1 -s 10.200.0.0/16 -j CLAWCO-LEJER-UD'));
  assert.ok(l.includes('iptables -w -A CLAWCO-LEJER-IND -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN'));
  assert.ok(l.includes('iptables -w -A CLAWCO-LEJER-IND -j DROP'));
  assert.ok(l.includes('iptables -w -I INPUT 1 -s 10.200.0.0/16 -j CLAWCO-LEJER-IND'));
  assert.equal(l[l.length - 1], 'markør /run/sky/netfilter.ok pool=10.200.0.0/16', 'the marker is written last, after every rule');
  for (const argv of [[], ['10.200.0.0/16', 'x'], ['10.200.0.0/16;id'], ['--vis', '999.1.1.1/16'], ['--vis', '10.200.0.0/24'], ['--vis', '8.8.0.0/16'], ['--vis', '172.32.0.0/16'], ['--vis', '10.200.1.0/16']]) {
    const r = spawnSync('/bin/bash', [NETFILTER_SCRIPT, ...argv], { encoding: 'utf8' });
    assert.equal(r.status, 2, JSON.stringify(argv));
    assert.equal(r.stdout, '');
  }
});
