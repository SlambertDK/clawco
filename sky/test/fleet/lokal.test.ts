// KC-0212/KC-0182: the lokal fleet driver — Docker on the host Sky runs on (kira-home for the beta).
// One hardened container per tenant from the tenant image, one named volume per tenant, on a Docker
// network with inter-container traffic off (tenants cannot see each other; the host reaches each one
// on its own address). Never a published port, never a shell. A fake runner stands in for the Docker CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noegleRunFlag } from '../../src/hemmeligheder/levering.ts';
import { lokalFlaade, koerProces, SKRIV_HUSSTAND, type Koersel } from '../../src/fleet/lokal.ts';
import { ingenKryptering } from '../../src/fleet/kryptering.ts';

type Svar = { kode: number; ud: string; fejl: string };
type C = { koerer: boolean; ip: string; labels: Record<string, string>; startet: string; billede: string };

/** The image id a container started from a tag gets in the fake (what `{{.Image}}` prints). */
export const GAMMEL = `sha256:${'a'.repeat(64)}`;
const NY = `sha256:${'b'.repeat(64)}`;

export const PUBKEY = 'A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg';

/** A fake Docker host: containers, volumes and networks in memory, every argv recorded. */
export function falskDocker(start: { containere?: Record<string, boolean>; volumener?: string[]; netvaerk?: Record<string, { icc: boolean }>; fejlPaa?: (argv: string[]) => string | null } = {}) {
  const containere = new Map<string, C>();
  let naesteIp = 2;
  const nyIp = () => `172.18.0.${naesteIp++}`;
  let starter = 0;
  const nyStart = () => `2026-11-01T10:00:${String(starter++).padStart(2, '0')}.123456789Z`;
  for (const [n, k] of Object.entries(start.containere ?? {})) containere.set(n, { koerer: k, ip: nyIp(), labels: { 'clawco.tenant': n.replace(/^clawco-t-/, '') }, startet: nyStart(), billede: GAMMEL });
  const volumener = new Map<string, Record<string, string>>((start.volumener ?? []).map((v) => [v, { 'clawco.tenant': v.replace(/^clawco-t-/, '').replace(/-data$/, '') }]));
  const netvaerk = new Map(Object.entries(start.netvaerk ?? {}));
  const husstande = new Map<string, string>();
  const kald: string[][] = [];
  const ok = (ud = ''): Svar => ({ kode: 0, ud, fejl: '' });
  // Docker's own "absent" wordings, captured from Docker 29.9.2 on kira-home: they differ per object type.
  const ingen = (hvad: string): Svar => ({ kode: 1, ud: '', fejl: `Error response from daemon: No such ${hvad}` });
  const ingenNetvaerk = (navn: string): Svar => ({ kode: 1, ud: '', fejl: `Error response from daemon: network ${navn} not found` });
  const ingenVolumen = (navn: string): Svar => ({ kode: 1, ud: '', fejl: `Error response from daemon: get ${navn}: no such volume` });
  const labels = (argv: string[]): Record<string, string> => {
    const l: Record<string, string> = {};
    argv.forEach((a, i) => { if (a === '--label') { const [k, v] = argv[i + 1]!.split('='); l[k!] = v ?? ''; } });
    return l;
  };
  const koer: Koersel = async (argv) => {
    kald.push(argv);
    assert.equal(argv[0], 'docker');
    const fejl = start.fejlPaa?.(argv);
    if (fejl) return { kode: 1, ud: '', fejl };
    const [, a, b] = argv;
    const sidste = argv[argv.length - 1]!;
    if (a === 'container' && b === 'inspect') {
      const c = containere.get(sidste);
      if (!c) return ingen('container: ' + sidste);
      const format = argv[argv.indexOf('--format') + 1];
      if (format === '{{.State.Running}}') return ok(`${c.koerer}\n`);
      if (format === '{{.State.Running}}\t{{.Image}}') return ok(`${c.koerer}\t${c.billede}\n`);
      if (format?.includes('.State.StartedAt')) {
        // Several names in one call; Docker prints the ones it found and fails if any is missing.
        const navne = argv.slice(argv.indexOf('--format') + 2);
        const fundne = navne.map((n) => [n, containere.get(n)] as const).filter((x): x is readonly [string, C] => !!x[1]);
        if (fundne.length < navne.length) return ingen('container: ' + navne.find((n) => !containere.has(n)));
        return ok(fundne.map(([n, x]) => `${x.labels['clawco.tenant']}\t/${n}\t${x.startet}`).join('\n') + '\n');
      }
      if (format === '{{json .NetworkSettings.Networks}}') return ok(JSON.stringify(c.koerer ? { 'clawco-sky': { IPAddress: c.ip, Gateway: '172.18.0.1' } } : { 'clawco-sky': { IPAddress: '' } }) + '\n');
      return { kode: 125, ud: '', fejl: 'ukendt format' };
    }
    if (a === 'container' && b === 'ls' && argv.includes('status=running')) {
      return ok([...containere].filter(([, c]) => c.koerer && c.labels['clawco.tenant']).map(([n]) => n).join('\n'));
    }
    if (a === 'container' && b === 'ls') return ok([...containere.values()].map((c) => c.labels['clawco.tenant']).join('\n'));
    if (a === 'network' && b === 'inspect') {
      const n = netvaerk.get(sidste);
      if (!n) return ingenNetvaerk(sidste);
      return ok(JSON.stringify([{ Name: sidste, Options: n.icc ? {} : { 'com.docker.network.bridge.enable_icc': 'false' }, IPAM: { Config: [{ Subnet: '172.18.0.0/16', Gateway: '172.18.0.1' }] } }]));
    }
    if (a === 'network' && b === 'create') { netvaerk.set(sidste, { icc: !argv.includes('com.docker.network.bridge.enable_icc=false') }); return ok(); }
    if (a === 'volume' && b === 'create') { if (!volumener.has(sidste)) volumener.set(sidste, labels(argv)); return ok(sidste); }
    if (a === 'volume' && b === 'inspect') return volumener.has(sidste) ? ok('[]') : ingenVolumen(sidste);
    if (a === 'volume' && b === 'ls') return ok([...volumener.values()].map((l) => l['clawco.tenant']).join('\n'));
    if (a === 'volume' && b === 'rm') return volumener.delete(sidste) ? ok() : { kode: 1, ud: '', fejl: 'Error: no such volume' };
    if (a === 'run' && argv.includes('--rm')) {
      // The household helper: writes the file into the volume only if none is there.
      const vol = argv[argv.indexOf('--volume') + 1]!.split(':')[0]!;
      if (!volumener.has(vol)) volumener.set(vol, {});
      if (!husstande.has(vol)) husstande.set(vol, sidste);
      return ok();
    }
    if (a === 'run') {
      const navn = argv[argv.indexOf('--name') + 1]!;
      if (containere.has(navn)) return { kode: 125, ud: '', fejl: 'Conflict. The container name is already in use' };
      containere.set(navn, { koerer: true, ip: nyIp(), labels: labels(argv), startet: nyStart(), billede: sidste.startsWith('sha256:') ? sidste : GAMMEL });
      return ok('abc123');
    }
    if (a === 'start') { const c = containere.get(b!); if (!c) return ingen('container'); c.koerer = true; c.startet = nyStart(); return ok(); }
    if (a === 'stop') { const c = containere.get(b!); if (!c) return ingen('container'); c.koerer = false; return ok(); }
    if (a === 'rm') return containere.delete(sidste) ? ok() : ingen('container');
    return { kode: 125, ud: '', fejl: `ukendt kald ${argv.join(' ')}` };
  };
  return { koer, kald, containere, volumener, netvaerk, husstande };
}

const lav = (d: ReturnType<typeof falskDocker>) => lokalFlaade({ koer: d.koer, billede: 'clawco:test', netvaerk: 'clawco-sky', kontoPubkey: PUBKEY, kryptering: ingenKryptering(), noegleFlag: noegleRunFlag() });
const EJER = { id: 'hus-abcdefgh', ejer: 'Mette.Hansen@example.test' };

test('klargoer on a clean host: an ICC-off network, the volume, the household file, then one hardened container — exact argv', async () => {
  const d = falskDocker();
  const k = await lav(d).klargoer(EJER);
  assert.deepEqual(k, { tenantId: 'hus-abcdefgh', container: 'clawco-t-hus-abcdefgh', volumen: 'clawco-t-hus-abcdefgh-data', adresse: 'http://172.18.0.2:8750', krypteret: false });
  assert.deepEqual(d.kald.find((a) => a[1] === 'network' && a[2] === 'create'), [
    'docker', 'network', 'create', '--driver', 'bridge', '--label', 'clawco.sky=1', '--opt', 'com.docker.network.bridge.enable_icc=false', 'clawco-sky',
  ]);
  assert.deepEqual(d.kald.find((a) => a[1] === 'volume' && a[2] === 'create'), ['docker', 'volume', 'create', '--label', 'clawco.tenant=hus-abcdefgh', 'clawco-t-hus-abcdefgh-data']);
  const run = d.kald.find((a) => a[1] === 'run' && !a.includes('--rm'))!;
  assert.deepEqual(run, [
    'docker', 'run', '--detach', '--name', 'clawco-t-hus-abcdefgh', '--label', 'clawco.tenant=hus-abcdefgh',
    '--network', 'clawco-sky', '--restart', 'unless-stopped',
    '--volume', 'clawco-t-hus-abcdefgh-data:/data',
    '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
    '--tmpfs', '/run/secrets:rw,noexec,nosuid,nodev,size=16k,mode=0700,uid=1000,gid=1000', '--env', 'KC_HEMMELIGHEDER_FIL=/run/secrets/clawco-lager',
    '--user', '1000:1000',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--memory', '1g', '--memory-swap', '1g', '--cpu-shares', '512', '--pids-limit', '256',
    '--env', 'KC_DATA_DIR=/data', '--env', 'KC_PORT=8750', '--env', 'KC_HOST=0.0.0.0',
    '--env', 'KC_IDENTITET=konto', '--env', 'KC_KONTO_TENANT=hus-abcdefgh', '--env', `KC_KONTO_PUBKEY=${PUBKEY}`,
    '--env', 'KC_KONTO_GATEWAY=172.18.0.1', '--env', 'KC_AGENT=direkte',
    'clawco:test',
  ]);
  for (const [i, a] of run.entries()) {
    if (run[i - 1] === '--user') continue;
    assert.ok(!/^(-p|-P|--publish.*|--network=host|--privileged|--cap-add.*)$/.test(a), `never ${a}`);
    assert.ok(!a.includes('0.0.0.0:') && !/^\d+:\d+$/.test(a), `no host port mapping: ${a}`);
  }
  assert.ok(!d.kald.flat().some((a) => a === 'sh' || a === '-c' || a === 'bash'), 'no shell anywhere');
});

test('the household file is written before the first start, by a short-lived helper without network, with the owner as the one ejer', async () => {
  const d = falskDocker();
  await lav(d).klargoer(EJER);
  const i = d.kald.findIndex((a) => a[1] === 'run' && a.includes('--rm'));
  const j = d.kald.findIndex((a) => a[1] === 'run' && !a.includes('--rm'));
  assert.ok(i >= 0 && j > i, 'helper before the tenant container');
  const hj = d.kald[i]!;
  assert.deepEqual(hj.slice(0, -1), [
    'docker', 'run', '--rm', '--label', 'clawco.tenant=hus-abcdefgh', '--network', 'none', '--read-only',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--user', '1000:1000',
    '--volume', 'clawco-t-hus-abcdefgh-data:/data', '--entrypoint', 'node', 'clawco:test', '-e', SKRIV_HUSSTAND,
  ]);
  assert.deepEqual(JSON.parse(hj[hj.length - 1]!), { personer: [{ id: 'ejer', login: 'mette.hansen@example.test', navn: 'mette.hansen', rolle: 'ejer' }] });
});

test('the helper script writes husstand.json once and never overwrites an existing one (run for real in a temp dir)', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kc0182-'));
  const script = SKRIV_HUSSTAND.replaceAll('/data/', `${dir}/`);
  assert.notEqual(script, SKRIV_HUSSTAND, 'the script names /data/ so the test can point it elsewhere');
  const r1 = await koerProces([process.execPath, '-e', script, '{"personer":[1]}']);
  assert.equal(r1.kode, 0, r1.fejl);
  const r2 = await koerProces([process.execPath, '-e', script, '{"personer":[2]}']);
  assert.equal(r2.kode, 0, r2.fejl);
  assert.equal(await fs.readFile(path.join(dir, 'husstand.json'), 'utf8'), '{"personer":[1]}');
  assert.deepEqual((await fs.readdir(dir)).sort(), ['husstand.json'], 'no tmp file left');
  await fs.rm(dir, { recursive: true });
});

test('an existing network with inter-container traffic on is refused (tenants would see each other)', async () => {
  const d = falskDocker({ netvaerk: { 'clawco-sky': { icc: true } } });
  await assert.rejects(lav(d).klargoer(EJER), /enable_icc/);
  assert.ok(!d.kald.some((a) => a[1] === 'run' || (a[1] === 'volume' && a[2] === 'create')));
});

test('a bad owner email is refused before any Docker call', async () => {
  for (const ejer of ['', 'ikke-en-mail', 'a@b', 'a b@c.example', 'a@b.example\n', `${'a'.repeat(250)}@b.example`]) {
    const d = falskDocker();
    await assert.rejects(lav(d).klargoer({ id: 'hus-abcdefgh', ejer }), /ejer/, ejer);
    assert.deepEqual(d.kald, []);
  }
});

test('klargoer is idempotent: a running tenant is left alone, a stopped one is started; both report their address', async () => {
  const d = falskDocker({ containere: { 'clawco-t-a1': true, 'clawco-t-b2': false }, volumener: ['clawco-t-a1-data', 'clawco-t-b2-data'], netvaerk: { 'clawco-sky': { icc: false } } });
  assert.equal((await lav(d).klargoer({ id: 'a1', ejer: 'a@example.test' })).adresse, 'http://172.18.0.2:8750');
  assert.equal((await lav(d).klargoer({ id: 'b2', ejer: 'b@example.test' })).adresse, 'http://172.18.0.3:8750');
  assert.ok(!d.kald.some((a) => a[1] === 'run'), 'no second container and no second household file');
  assert.ok(d.kald.some((a) => a[1] === 'start' && a[2] === 'clawco-t-b2'));
});

test('a half-made tenant (volume and household, no container) resumes without a second volume or household', async () => {
  let pullFejler = true;
  const d = falskDocker({ fejlPaa: (a) => (pullFejler && a[1] === 'run' && !a.includes('--rm') ? 'Error: image pull failed' : null) });
  await assert.rejects(lav(d).klargoer(EJER), /Docker/);
  assert.equal(d.volumener.size, 1);
  const foerste = d.husstande.get('clawco-t-hus-abcdefgh-data');
  pullFejler = false;
  await lav(d).klargoer(EJER);
  assert.equal(d.volumener.size, 1);
  assert.equal(d.containere.size, 1);
  assert.equal(d.husstande.get('clawco-t-hus-abcdefgh-data'), foerste, 'the household is not rewritten');
});

test('status maps Docker onto koerer / stoppet / findes-ikke', async () => {
  const d = falskDocker({ containere: { 'clawco-t-a1': true, 'clawco-t-b2': false } });
  const f = lav(d);
  assert.equal(await f.status('a1'), 'koerer');
  assert.equal(await f.status('b2'), 'stoppet');
  assert.equal(await f.status('c3'), 'findes-ikke');
});

test('stop stops; slet removes the container, then the volume, and verifies both are gone; both are quiet when nothing is there', async () => {
  const d = falskDocker({ containere: { 'clawco-t-a1': true }, volumener: ['clawco-t-a1-data'] });
  const f = lav(d);
  await f.stop('a1');
  assert.equal(d.containere.get('clawco-t-a1')?.koerer, false);
  await f.slet('a1');
  assert.ok(!d.containere.has('clawco-t-a1') && !d.volumener.has('clawco-t-a1-data'));
  const rm = d.kald.findIndex((a) => a[1] === 'rm');
  const vrm = d.kald.findIndex((a) => a[1] === 'volume' && a[2] === 'rm');
  assert.ok(rm >= 0 && vrm > rm, 'container before volume');
  assert.ok(d.kald.slice(vrm).some((a) => a[1] === 'volume' && a[2] === 'inspect'), 'verified after removal');
  await f.stop('a1');
  await f.slet('a1');
});

test('slet throws when the volume is still there afterwards (never claims a wipe it did not see)', async () => {
  const d = falskDocker({ volumener: ['clawco-t-a1-data'], fejlPaa: (a) => (a[1] === 'volume' && a[2] === 'rm' ? 'Error: volume is in use' : null) });
  await assert.rejects(lav(d).slet('a1'), /Docker|findes stadig/);
});

test('maerkede lists every tenant id carrying the label on a container or a volume (invalid labels skipped)', async () => {
  const d = falskDocker({ containere: { 'clawco-t-a1': true }, volumener: ['clawco-t-a1-data', 'clawco-t-b2-data'] });
  d.volumener.set('fremmed', { 'clawco.tenant': '../ikke gyldig' });
  assert.deepEqual([...(await lav(d).maerkede())].sort(), ['a1', 'b2']);
  const ls = d.kald.filter((a) => a[2] === 'ls');
  assert.ok(ls.every((a) => a.includes('label=clawco.tenant')));
});

test('KC-0216: startede maps every running tenant container to its current start, in two Docker calls for the whole fleet', async () => {
  const d = falskDocker({ containere: { 'clawco-t-a1': true, 'clawco-t-b2': false, 'clawco-t-c3': true } });
  d.containere.set('fremmed', { koerer: true, ip: '172.18.0.99', labels: {}, startet: 'x', billede: GAMMEL });
  const f = lav(d);
  const foer = d.kald.length;
  const m = await f.startede();
  assert.deepEqual([...m.keys()].sort(), ['a1', 'c3']);
  assert.deepEqual(m.get('a1'), { container: 'clawco-t-a1', startet: d.containere.get('clawco-t-a1')!.startet });
  assert.equal(d.kald.length - foer, 2);
  assert.ok(d.kald.slice(foer).every((a) => a.includes('label=clawco.tenant') || a[2] === 'inspect'));
  // A restart gives a new start time.
  await d.koer(['docker', 'stop', 'clawco-t-a1']);
  await d.koer(['docker', 'start', 'clawco-t-a1']);
  assert.notEqual((await f.startede()).get('a1')!.startet, m.get('a1')!.startet);
});

test('KC-0216: startede with no running tenant makes one Docker call; a container gone between the calls skips this pass', async () => {
  const d = falskDocker({ containere: { 'clawco-t-a1': false } });
  const foer = d.kald.length;
  assert.equal((await lav(d).startede()).size, 0);
  assert.equal(d.kald.length - foer, 1);
  const d2 = falskDocker({ containere: { 'clawco-t-a1': true }, fejlPaa: (a) => (a[2] === 'inspect' ? 'Error response from daemon: No such container: clawco-t-a1' : null) });
  assert.equal((await lav(d2).startede()).size, 0);
});

test('a Docker error that is not "no such" is not swallowed', async () => {
  const koer: Koersel = async () => ({ kode: 1, ud: '', fejl: 'Cannot connect to the Docker daemon' });
  const f = lokalFlaade({ koer, billede: 'clawco:test', netvaerk: 'clawco-sky', kontoPubkey: PUBKEY, kryptering: ingenKryptering(), noegleFlag: noegleRunFlag() });
  await assert.rejects(f.status('a1'), /Docker/);
  await assert.rejects(f.klargoer(EJER), /Docker/);
});

test('a tenant id that is not a plain slug is refused before any Docker call', async () => {
  const d = falskDocker();
  const f = lav(d);
  for (const id of ['', '../x', 'A1', 'a b', '-a', 'a-', 'a'.repeat(41), 'a;rm -rf /']) {
    await assert.rejects(f.klargoer({ id, ejer: 'a@example.test' }), /tenant-id/, id);
    await assert.rejects(f.slet(id), /tenant-id/, id);
  }
  assert.deepEqual(d.kald, []);
});

test('the default runner runs a process and reports code, stdout and stderr (no shell)', async () => {
  const r = await koerProces([process.execPath, '-e', 'process.stdout.write("ud"); process.stderr.write("fejl"); process.exit(3)']);
  assert.deepEqual(r, { kode: 3, ud: 'ud', fejl: 'fejl' });
  const ok = await koerProces([process.execPath, '-e', 'process.stdout.write(process.argv[1])', 'a;b']);
  assert.deepEqual(ok, { kode: 0, ud: 'a;b', fejl: '' });
});

// KC-0186: replacing a tenant's container with another image on the same volume (an upgrade or a rollback).
test("beholder reports the running container's image id and address; null when it is stopped or gone", async () => {
  const d = falskDocker();
  const f = lav(d);
  assert.equal(await f.beholder(EJER.id), null);
  await f.klargoer(EJER);
  assert.deepEqual(await f.beholder(EJER.id), { billede: GAMMEL, adresse: 'http://172.18.0.2:8750', container: 'clawco-t-hus-abcdefgh' });
  await f.stop(EJER.id);
  assert.equal(await f.beholder(EJER.id), null);
});

test('beholder: a container in a crash loop (running for a moment, no address yet) is not a serving container (found live 2026-11-01)', async () => {
  const d = falskDocker();
  const f = lav(d);
  await f.klargoer(EJER);
  d.containere.get('clawco-t-hus-abcdefgh')!.ip = '';
  assert.equal(await f.beholder(EJER.id), null);
});

test("opgrader replaces the container with the given image id on the same volume, with exactly klargoer's flags", async () => {
  const d = falskDocker();
  const f = lav(d);
  await f.klargoer(EJER);
  const foer = d.kald.find((a) => a[1] === 'run' && !a.includes('--rm'))!;
  const n = d.kald.length;
  const k = await f.opgrader({ id: EJER.id, billede: NY });
  const nye = d.kald.slice(n);
  const iVol = nye.findIndex((a) => a[1] === 'volume' && a[2] === 'inspect');
  const iRm = nye.findIndex((a) => a[1] === 'rm');
  const iRun = nye.findIndex((a) => a[1] === 'run');
  assert.ok(iVol >= 0 && iVol < iRm && iRm < iRun, 'the volume is seen before the container goes, the new one after');
  assert.deepEqual(nye[iRm], ['docker', 'rm', '--force', 'clawco-t-hus-abcdefgh']);
  assert.deepEqual(nye[iRun], [...foer.slice(0, -1), NY]);
  assert.ok(!nye.some((a) => a[1] === 'volume' && (a[2] === 'rm' || a[2] === 'create')), 'the volume is never removed or made');
  assert.equal(d.volumener.has('clawco-t-hus-abcdefgh-data'), true);
  assert.deepEqual(k, { tenantId: EJER.id, container: 'clawco-t-hus-abcdefgh', volumen: 'clawco-t-hus-abcdefgh-data', adresse: 'http://172.18.0.3:8750', krypteret: false });
  assert.equal((await f.beholder(EJER.id))!.billede, NY);
});

test('opgrader is idempotent after a kill between remove and run; refuses a tag and a missing volume before touching anything', async () => {
  const d = falskDocker({ volumener: ['clawco-t-hus-abcdefgh-data'] });
  const f = lav(d);
  await f.opgrader({ id: EJER.id, billede: NY }); // no container (killed after rm): just runs the new one
  assert.equal((await f.beholder(EJER.id))!.billede, NY);
  const n = d.kald.length;
  await assert.rejects(f.opgrader({ id: EJER.id, billede: 'clawco:latest' }), /billed-id/);
  await assert.rejects(f.opgrader({ id: 'hus-zzzzzzzz', billede: NY }), /disken clawco-t-hus-zzzzzzzz-data findes ikke/);
  assert.ok(!d.kald.slice(n).some((a) => a[1] === 'rm' || a[1] === 'run'));
});
