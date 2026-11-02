// Delivering a tenant's `lager` key to its container (KC-0181). The only key that ever enters a tenant
// container is the one for its own secrets file (src/hemmeligheder/lager-fil.ts); the volume and
// backup keys stay with Sky and the node side.
//
// The beta's path (lokal driver, Docker on kira-home, no root): the container is run with a small
// private tmpfs on /run/secrets (noegleRunFlag), and after every start Sky pipes the key into
// `docker exec -i <container> node -e <writer> /run/secrets/clawco-lager`. The key travels on stdin
// only: never in argv or an env var (both show in `docker inspect` and ps), never on any disk. The
// writer stores it 0400 with an atomic rename. On stop the tmpfs and the key are gone, so Sky must
// deliver again after each (re)start (the reconciler does, KC-0216: afstem.ts); until then the tenant's secrets file
// refuses (fail closed).
import { spawn } from 'node:child_process';
import type { Database } from '../db/pool.ts';
import { afled } from './afled.ts';
import type { Noeglering } from './masternoegle.ts';
import type { Hemmelig } from './skjul.ts';
import { hentDataNoegle } from './tenantnoegle.ts';

export const NOEGLE_MAPPE = '/run/secrets';
export const NOEGLE_STI = `${NOEGLE_MAPPE}/clawco-lager`;
/** The tenant image's user (`USER node` in the Dockerfile): the tmpfs belongs to it, nobody else. */
const BEHOLDER_UID = 1000;

/** Extra `docker run` arguments: the private tmpfs and the PATH of the key file (never the key). */
export function noegleRunFlag(): string[] {
  return [
    '--tmpfs', `${NOEGLE_MAPPE}:rw,noexec,nosuid,nodev,size=16k,mode=0700,uid=${BEHOLDER_UID},gid=${BEHOLDER_UID}`,
    '--env', `KC_HEMMELIGHEDER_FIL=${NOEGLE_STI}`,
  ];
}

export type KoerselMedInput = (argv: string[], input: string) => Promise<{ kode: number; ud: string; fejl: string }>;

/** Runs argv[0] with the rest as arguments (no shell) and writes `input` to its stdin. */
export const koerMedInput: KoerselMedInput = (argv, input) => new Promise((resolve, reject) => {
  const [cmd, ...args] = argv;
  if (!cmd) { reject(new Error('tom kommando')); return; }
  const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let ud = '';
  let fejl = '';
  p.stdout.setEncoding('utf8').on('data', (d: string) => { ud += d; });
  p.stderr.setEncoding('utf8').on('data', (d: string) => { fejl += d; });
  p.on('error', reject);
  p.on('close', (kode) => resolve({ kode: kode ?? 1, ud, fejl }));
  p.stdin.on('error', () => { /* the process exited before reading; its exit code reports it */ });
  p.stdin.end(input);
});

// Runs inside the container as its own user. Reads one base64 key (32 bytes) from stdin, writes it
// 0400 next to the target and renames it into place. Fixed text: nothing is ever interpolated into it.
const SKRIVER = [
  "const fs=require('node:fs'),path=require('node:path');const maal=process.argv[1];let d='';",
  "process.stdin.setEncoding('utf8');process.stdin.on('data',(c)=>{d+=c;});process.stdin.on('end',()=>{",
  "const v=d.trim();if(!/^[A-Za-z0-9+/]{43}=$/.test(v)){process.stderr.write('ugyldig nøgle på stdin\\n');process.exit(2);}",
  "const t=path.join(path.dirname(maal),'.'+path.basename(maal)+'.tmp');fs.rmSync(t,{force:true});",
  "fs.writeFileSync(t,v+'\\n',{mode:0o400});fs.renameSync(t,maal);});",
].join('');

const CONTAINER = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

/** Pipes one key into the running container's tmpfs. A failure names the container and Docker's message, never the key. */
export async function leverLagerNoegle(o: { koer: KoerselMedInput; container: string; noegle: Hemmelig }): Promise<void> {
  if (!CONTAINER.test(o.container)) throw new Error('ugyldigt containernavn');
  const r = await o.koer(['docker', 'exec', '-i', o.container, 'node', '-e', SKRIVER, NOEGLE_STI], `${o.noegle.aaben().toString('base64')}\n`);
  if (r.kode !== 0) throw new Error(`nøglen kunne ikke leveres til ${o.container} (${r.kode}): ${r.fejl.trim().slice(0, 200)}`);
}

/** The one call after a tenant container starts: open its DEK, derive `lager`, deliver it, forget both. */
export async function leverTilTenant(o: { db: Database; ring: Noeglering; tenant: string; container: string; koer: KoerselMedInput }): Promise<void> {
  const dek = await hentDataNoegle(o.db, o.ring, o.tenant);
  const lager = afled(dek, o.tenant, 'lager');
  dek.oedelaeg();
  try {
    await leverLagerNoegle({ koer: o.koer, container: o.container, noegle: lager });
  } finally {
    lager.oedelaeg();
  }
}
