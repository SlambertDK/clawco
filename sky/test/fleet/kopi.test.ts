// KC-0185: the lokal fleet's side of backups (the KopiNode seam, Docker on the Sky host). A tenant's volume is
// only ever mounted read-only (and must exist first: `docker run -v` would silently create an empty one); a
// restore or drill always gets NEW names (clawco-g-/clawco-p-) with their own label, so the reconciler never
// sees them; removal refuses any tenant's own names. A fake runner stands in for the Docker CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { koerBinaer, lokalKopiNode, type KoerselBinaer } from '../../src/fleet/kopi.ts';
import { tenanterTilKopi, bestil, skift } from '../../src/fleet/tilstand.ts';
import { opsaet } from './hjaelp.ts';

const T = 'hus-aaaaaaaa';
const PUBKEY = 'A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg';

function falsk(start: { volumener?: string[] } = {}) {
  const volumener = new Set(start.volumener ?? []);
  const containere = new Set<string>();
  const kald: { argv: string[]; input: Buffer | null }[] = [];
  const ok = (ud: string | Buffer = '') => ({ kode: 0, ud: Buffer.isBuffer(ud) ? ud : Buffer.from(ud), fejl: '' });
  const koer: KoerselBinaer = async (argv, input) => {
    kald.push({ argv, input: input ?? null });
    const [, a, b] = argv;
    const sidste = argv[argv.length - 1]!;
    if (a === 'volume' && b === 'inspect') return volumener.has(sidste) ? ok('[]') : { kode: 1, ud: Buffer.alloc(0), fejl: `Error response from daemon: get ${sidste}: no such volume` };
    if (a === 'volume' && b === 'create') { volumener.add(sidste); return ok(sidste); }
    if (a === 'volume' && b === 'rm') { volumener.delete(sidste); return ok(); }
    if (a === 'rm') { containere.delete(sidste); return ok(); }
    if (a === 'container' && b === 'inspect') {
      if (!containere.has(sidste)) return { kode: 1, ud: Buffer.alloc(0), fejl: `Error response from daemon: No such container: ${sidste}` };
      return ok(JSON.stringify({ 'clawco-sky': { IPAddress: '172.18.0.9' } }));
    }
    if (a === 'network' && b === 'inspect') return ok(JSON.stringify([{ Options: { 'com.docker.network.bridge.enable_icc': 'false' }, IPAM: { Config: [{ Gateway: '172.18.0.1' }] } }]));
    if (a === 'run' && argv.includes('--detach')) { containere.add(argv[argv.indexOf('--name') + 1]!); return ok('id'); }
    if (a === 'run') return ok(argv.includes('-cf') ? Buffer.from('TAR-BYTES') : '');
    return { kode: 125, ud: Buffer.alloc(0), fejl: `ukendt: ${argv.slice(0, 3).join(' ')}` };
  };
  const node = lokalKopiNode({ koer, billede: 'clawco:test', netvaerk: 'clawco-sky', kontoPubkey: PUBKEY, skyUrl: 'https://konto.example.dk', noegleFlag: ['--tmpfs', '/run/secrets:rw', '--env', 'KC_HEMMELIGHEDER_FIL=/run/secrets/clawco-lager'] });
  return { node, kald, volumener, containere };
}

test("pak reads the tenant's own volume read-only, after seeing it exists, with no network", async () => {
  const f = falsk({ volumener: [`clawco-t-${T}-data`] });
  assert.deepEqual(await f.node.pak(T), Buffer.from('TAR-BYTES'));
  assert.deepEqual(f.kald[0]!.argv, ['docker', 'volume', 'inspect', `clawco-t-${T}-data`]);
  const run = f.kald[1]!.argv;
  assert.deepEqual(run.slice(0, 3), ['docker', 'run', '--rm']);
  assert.ok(run.includes(`clawco-t-${T}-data:/data:ro`));
  for (const a of ['--read-only', '--cap-drop', 'ALL', 'no-new-privileges:true', '1000:1000']) assert.ok(run.includes(a), a);
  assert.equal(run[run.indexOf('--network') + 1], 'none');
  assert.deepEqual(run.slice(run.indexOf('--entrypoint')), ['--entrypoint', 'tar', 'clawco:test', '-C', '/data', '-cf', '-', '.']);
});

test('a tenant whose volume is gone is refused before any run (no empty volume is created)', async () => {
  const f = falsk();
  await assert.rejects(f.node.pak(T), /findes ikke/);
  assert.equal(f.kald.length, 1);
  assert.equal(f.volumener.size, 0);
});

test('udpak makes a NEW labelled volume and pipes the tar in on stdin; it refuses an existing name or a tenant name', async () => {
  const f = falsk();
  const navn = `clawco-g-${T}-0a1b2c3d`;
  await f.node.udpak(navn, T, Buffer.from('TAR'));
  assert.deepEqual(f.kald[1]!.argv, ['docker', 'volume', 'create', '--label', `clawco.kopi=${T}`, `${navn}-data`]);
  const run = f.kald[2]!;
  assert.ok(run.argv.includes(`${navn}-data:/data`));
  assert.deepEqual(run.argv.slice(run.argv.indexOf('--entrypoint')), ['--entrypoint', 'tar', 'clawco:test', '-C', '/data', '-xpf', '-']);
  assert.ok(run.argv.includes('-i'));
  assert.deepEqual(run.input, Buffer.from('TAR'));
  await assert.rejects(f.node.udpak(navn, T, Buffer.from('TAR')), /findes allerede/);
  await assert.rejects(f.node.udpak(`clawco-t-${T}`, T, Buffer.from('TAR')), /ugyldigt navn/);
  await assert.rejects(f.node.udpak(`clawco-g-hus-bbbbbbbb-0a1b2c3d`, T, Buffer.from('TAR')), /ugyldigt navn/, 'the name must carry the same tenant');
  for (const k of f.kald) assert.ok(!k.argv.some((a) => a.startsWith(`clawco-t-${T}`)), k.argv.join(' '));
});

test("start runs the restored volume like the tenant (same image, identity and hardening), with its own name and label, no restart policy", async () => {
  const f = falsk({ volumener: [`clawco-p-${T}-0a1b2c3d-data`] });
  const navn = `clawco-p-${T}-0a1b2c3d`;
  assert.deepEqual(await f.node.start(navn, T), { adresse: 'http://172.18.0.9:8750' });
  const run = f.kald.find((k) => k.argv[1] === 'run')!.argv;
  assert.deepEqual(run.slice(0, 9), ['docker', 'run', '--detach', '--name', navn, '--label', `clawco.kopi=${T}`, '--network', 'clawco-sky']);
  assert.ok(!run.includes('--restart'));
  for (const a of ['--read-only', `${navn}-data:/data`, `KC_KONTO_TENANT=${T}`, `KC_KONTO_PUBKEY=${PUBKEY}`, 'KC_KONTO_GATEWAY=172.18.0.1', 'KC_IDENTITET=konto', 'KC_HEMMELIGHEDER_FIL=/run/secrets/clawco-lager', '--pids-limit']) assert.ok(run.includes(a), a);
  assert.equal(run.at(-1), 'clawco:test');
});

test("fjern removes a restored container and volume and checks they are gone; a tenant's own names are refused", async () => {
  const f = falsk({ volumener: [`clawco-g-${T}-0a1b2c3d-data`, `clawco-t-${T}-data`] });
  await f.node.fjern(`clawco-g-${T}-0a1b2c3d`);
  assert.ok(!f.volumener.has(`clawco-g-${T}-0a1b2c3d-data`));
  await assert.rejects(f.node.fjern(`clawco-t-${T}`), /ugyldigt navn/);
  assert.ok(f.volumener.has(`clawco-t-${T}-data`));
});

test('pakGendannet reads a restored volume read-only', async () => {
  const f = falsk({ volumener: [`clawco-p-${T}-0a1b2c3d-data`] });
  assert.deepEqual(await f.node.pakGendannet(`clawco-p-${T}-0a1b2c3d`), Buffer.from('TAR-BYTES'));
  assert.ok(f.kald[1]!.argv.includes(`clawco-p-${T}-0a1b2c3d-data:/data:ro`));
});

test("the fleet's tenant list for the copy job: every row with its state and when it first had a volume", async () => {
  const { db, kontoId, ur } = await opsaet();
  const t = await bestil(db, { kontoId, driver: 'lokal', nu: ur.nu(), nySlug: () => 'hus-abcdefgh' });
  ur.frem(60_000);
  await skift(db, t.slug, ['bestilt'], 'startet', ur.nu());
  assert.deepEqual(await tenanterTilKopi(db), [{ slug: 'hus-abcdefgh', tilstand: 'startet', siden: ur.nu() }]);
});

test('the real binary runner passes bytes through stdin and stdout untouched, adds env, and uses no shell', async () => {
  const bytes = Buffer.from([0, 255, 1, 128, 10, 13]);
  const r = await koerBinaer([process.execPath, '-e', "process.stdin.on('data',(d)=>process.stdout.write(d));process.stdin.on('end',()=>process.stdout.write(process.env.KC_PROEVE ?? ''))"], bytes, { KC_PROEVE: '$(echo nej)' });
  assert.equal(r.kode, 0);
  assert.deepEqual(r.ud, Buffer.concat([bytes, Buffer.from('$(echo nej)')]));
});
