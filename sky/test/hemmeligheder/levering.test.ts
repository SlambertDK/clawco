// KC-0181: the tenant's `lager` key reaches its container as a file on a tmpfs (/run/secrets), mode
// 0400, through `docker exec -i` with the key on stdin: never in argv, never in an env var (both are
// visible in `docker inspect` / ps), never on disk. On stop the tmpfs and the file are gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afled } from '../../src/hemmeligheder/afled.ts';
import { nyDataNoegle } from '../../src/hemmeligheder/kuvert.ts';
import { koerMedInput, leverLagerNoegle, leverTilTenant, NOEGLE_STI, noegleRunFlag, type KoerselMedInput } from '../../src/hemmeligheder/levering.ts';
import { hentDataNoegle, opretTenantNoegle } from '../../src/hemmeligheder/tenantnoegle.ts';
import { former, migreretDb, ring } from './hjaelp.ts';

type Kald = { argv: string[]; input: string };
function falskKoer(svar: { kode: number; fejl?: string } = { kode: 0 }): { koer: KoerselMedInput; kald: Kald[] } {
  const kald: Kald[] = [];
  return { kald, koer: async (argv, input) => { kald.push({ argv, input }); return { kode: svar.kode, ud: '', fejl: svar.fejl ?? '' }; } };
}

test('run flags: a small private tmpfs for the node user, and only the PATH in the env', () => {
  const f = noegleRunFlag();
  assert.deepEqual(f, [
    '--tmpfs', '/run/secrets:rw,noexec,nosuid,nodev,size=16k,mode=0700,uid=1000,gid=1000',
    '--env', `KC_HEMMELIGHEDER_FIL=${NOEGLE_STI}`,
  ]);
  assert.equal(NOEGLE_STI, '/run/secrets/clawco-lager');
});

test('delivery: docker exec -i with the key on stdin only; a failure names the container, never the key', async () => {
  const db = await migreretDb();
  const r = ring();
  await opretTenantNoegle(db, r, 'hus-aaaaaaaa', new Date());
  const lager = afled(await hentDataNoegle(db, r, 'hus-aaaaaaaa'), 'hus-aaaaaaaa', 'lager').aaben();
  const { koer, kald } = falskKoer();
  await leverTilTenant({ db, ring: r, tenant: 'hus-aaaaaaaa', container: 'clawco-t-hus-aaaaaaaa', koer });
  assert.equal(kald.length, 1);
  const [k] = kald;
  assert.deepEqual(k!.argv.slice(0, 6), ['docker', 'exec', '-i', 'clawco-t-hus-aaaaaaaa', 'node', '-e']);
  assert.equal(k!.argv.at(-1), NOEGLE_STI);
  assert.equal(k!.input, `${lager.toString('base64')}\n`);
  for (const f of former(lager)) assert.ok(!k!.argv.join(' ').includes(f), 'the key is never in argv');
  assert.ok(!k!.argv.includes('--env'), 'no env flag on exec');

  const fejl = falskKoer({ kode: 1, fejl: 'Error response from daemon: container is not running' });
  await assert.rejects(leverLagerNoegle({ koer: fejl.koer, container: 'clawco-t-hus-aaaaaaaa', noegle: afled(await hentDataNoegle(db, r, 'hus-aaaaaaaa'), 'hus-aaaaaaaa', 'lager') }),
    (e: Error) => /nøglen kunne ikke leveres til clawco-t-hus-aaaaaaaa \(1\): Error response from daemon: container is not running/.test(e.message) && former(lager).every((f) => !e.message.includes(f)));
  await assert.rejects(leverLagerNoegle({ koer, container: 'clawco-t; rm -rf /', noegle: afled(await hentDataNoegle(db, r, 'hus-aaaaaaaa'), 'hus-aaaaaaaa', 'lager') }), /ugyldigt containernavn/);
  await db.close();
});

test('the in-container writer (run here with node) writes the key 0400 atomically and refuses junk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-levering-'));
  try {
    const { koer, kald } = falskKoer();
    const noegle = afled(nyDataNoegle(), 'hus-aaaaaaaa', 'lager');
    await leverLagerNoegle({ koer, container: 'clawco-t-hus-aaaaaaaa', noegle });
    const script = kald[0]!.argv[6]!;
    const maal = path.join(dir, 'clawco-lager');
    const koerScript = (input: string) => spawnSync(process.execPath, ['-e', script, maal], { input, encoding: 'utf8' });

    const a = koerScript(kald[0]!.input);
    assert.equal(a.status, 0, a.stderr);
    assert.equal(fs.readFileSync(maal, 'utf8').trim(), noegle.aaben().toString('base64'));
    assert.equal(fs.statSync(maal).mode & 0o777, 0o400);
    // A second delivery (container restarted) replaces the 0400 file.
    assert.equal(koerScript(kald[0]!.input).status, 0);
    assert.deepEqual(fs.readdirSync(dir), ['clawco-lager'], 'no tmp file left');

    const b = koerScript('ikke en nøgle\n');
    assert.equal(b.status, 2);
    assert.equal(fs.readFileSync(maal, 'utf8').trim(), noegle.aaben().toString('base64'), 'junk never replaces the key');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('koerMedInput passes stdin to the process and never puts it on the command line', async () => {
  const r = await koerMedInput([process.execPath, '-e', 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(String(d.length)))'], 'hemmelig\n');
  assert.deepEqual(r, { kode: 0, ud: '9', fejl: '' });
});
