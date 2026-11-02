// KC-0186: the lokal image runner behind a release's compatibility check (drift/udrulning/udgave.ts). It reads a
// local image's id and the git sha baked into it, and runs images on SCRATCH disks only: names clawco-u-<8 hex>,
// the label clawco.udgave (never the tenant label, so the reconciler never counts or removes them), no restart
// policy, no published port, no shell. A fake runner stands in for the Docker CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lokalBilledKoerer } from '../../src/fleet/udgave-koerer.ts';
import { SKRIV_HUSSTAND, type Koersel } from '../../src/fleet/lokal.ts';

const ID = `sha256:${'c'.repeat(64)}`;
const PUBKEY = 'A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg';

function falsk(o: { sha?: string; doerStraks?: boolean } = {}) {
  const kald: string[][] = [];
  const volumener = new Set<string>();
  const containere = new Set<string>();
  const ok = (ud = '') => ({ kode: 0, ud, fejl: '' });
  const koer: Koersel = async (argv) => {
    kald.push(argv);
    const [, a, b] = argv;
    const sidste = argv[argv.length - 1]!;
    if (a === 'image' && b === 'inspect') return sidste === 'clawco:abc1234' || sidste === ID ? ok(`${ID}\n`) : { kode: 1, ud: '', fejl: `Error response from daemon: No such image: ${sidste}` };
    if (a === 'run' && argv.includes('cat')) return ok(`${o.sha ?? 'abc1234'}\n`);
    if (a === 'run' && argv.includes('--rm')) return ok();
    if (a === 'volume' && b === 'create') { volumener.add(sidste); return ok(sidste); }
    if (a === 'volume' && b === 'inspect') return volumener.has(sidste) ? ok('[]') : { kode: 1, ud: '', fejl: `get ${sidste}: no such volume` };
    if (a === 'volume' && b === 'rm') { volumener.delete(sidste); return ok(); }
    if (a === 'network' && b === 'inspect') return ok(JSON.stringify([{ Options: { 'com.docker.network.bridge.enable_icc': 'false' }, IPAM: { Config: [{ Gateway: '172.18.0.1' }] } }]));
    if (a === 'run') { containere.add(argv[argv.indexOf('--name') + 1]!); return ok('id'); }
    if (a === 'rm') { containere.delete(sidste); return ok(); }
    if (a === 'container' && b === 'inspect') {
      if (!containere.has(sidste)) return { kode: 1, ud: '', fejl: `No such container: ${sidste}` };
      // A container that exited at once has no address on the network (seen live on kira-home, 2026-11-01).
      if (o.doerStraks && argv.includes('{{json .NetworkSettings.Networks}}')) return ok(JSON.stringify({ 'clawco-sky': { IPAddress: '' } }));
      return ok(JSON.stringify({ 'clawco-sky': { IPAddress: '172.18.0.50' } }));
    }
    return { kode: 125, ud: '', fejl: `ukendt: ${argv.slice(0, 3).join(' ')}` };
  };
  const k = lokalBilledKoerer({ koer, netvaerk: 'clawco-sky', kontoPubkey: PUBKEY, skyUrl: 'https://konto.example.dk', noegleFlag: ['--tmpfs', '/run/secrets:rw'], tilfaeldig: () => '0123abcd' });
  return { k, kald, volumener, containere };
}

test('info reads the image id and the sha in /app/GIT_SHA (a hardened throwaway run, no network); null when absent', async () => {
  const f = falsk();
  assert.deepEqual(await f.k.info('clawco:abc1234'), { id: ID, sha: 'abc1234' });
  assert.deepEqual(f.kald[0], ['docker', 'image', 'inspect', '--format', '{{.Id}}', 'clawco:abc1234']);
  assert.deepEqual(f.kald[1], ['docker', 'run', '--rm', '--label', 'clawco.udgave=1', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--user', '1000:1000', '--entrypoint', 'cat', ID, '/app/GIT_SHA']);
  assert.equal(await f.k.info('clawco:findesikke'), null);
  await assert.rejects(falsk({ sha: 'dev' }).k.info('clawco:abc1234'), /GIT_SHA/);
});

test('a scratch disk gets a household file and a scratch container runs on it with the tenant flags, never the tenant label', async () => {
  const f = falsk();
  const disk = await f.k.nyDisk(ID);
  assert.equal(disk, 'clawco-u-0123abcd-data');
  assert.deepEqual(f.kald.find((a) => a[1] === 'volume' && a[2] === 'create'), ['docker', 'volume', 'create', '--label', 'clawco.udgave=1', disk]);
  const hj = f.kald.find((a) => a[1] === 'run' && a.includes('--rm'))!;
  assert.ok(hj.includes(SKRIV_HUSSTAND) && hj.includes('none') && hj.includes(`${disk}:/data`));
  const s = await f.k.start(ID, disk);
  assert.deepEqual(s, { navn: 'clawco-u-0123abcd', adresse: 'http://172.18.0.50:8750' });
  const run = f.kald.find((a) => a[1] === 'run' && a.includes('--detach'))!;
  assert.deepEqual(run.slice(0, 9), ['docker', 'run', '--detach', '--name', 'clawco-u-0123abcd', '--label', 'clawco.udgave=1', '--network', 'clawco-sky']);
  assert.ok(run.includes('--read-only') && run.includes('--cap-drop') && run.includes(`${disk}:/data`) && run.at(-1) === ID);
  assert.ok(!run.includes('--restart'), 'a scratch container never comes back on its own');
  assert.ok(!f.kald.flat().some((a) => a.startsWith('clawco.tenant')), 'never the tenant label');
  assert.ok(!f.kald.flat().some((a) => a === 'sh' || a === 'bash' || a === '-c'), 'no shell');
});

test('stop and fjernDisk remove scratch objects and see them gone; tenant names are refused', async () => {
  const f = falsk();
  const disk = await f.k.nyDisk(ID);
  const s = await f.k.start(ID, disk);
  await f.k.stop(s.navn);
  await f.k.stop(s.navn); // quiet when gone
  await f.k.fjernDisk(disk);
  assert.equal(f.containere.size + f.volumener.size, 0);
  await assert.rejects(f.k.stop('clawco-t-hus-abcdefgh'), /kladde/);
  await assert.rejects(f.k.fjernDisk('clawco-t-hus-abcdefgh-data'), /kladde/);
  await assert.rejects(f.k.start(ID, 'clawco-t-hus-abcdefgh-data'), /kladde/);
});

test('a scratch container that exits at once is removed by start itself, so its disk can go (found live 2026-11-01)', async () => {
  const f = falsk({ doerStraks: true });
  const disk = await f.k.nyDisk(ID);
  await assert.rejects(f.k.start(ID, disk), /stoppede med det samme/);
  assert.equal(f.containere.size, 0, 'no scratch container outlives a failed start');
  await f.k.fjernDisk(disk);
  assert.equal(f.volumener.size, 0);
});
