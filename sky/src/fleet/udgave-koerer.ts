// The lokal image runner (KC-0186): what a release's compatibility check (drift/udrulning/udgave.ts) needs from
// Docker on the Sky host — a local image's id and the git sha baked into it (/app/GIT_SHA, KC-0157), and images run
// on SCRATCH disks. Scratch names are clawco-u-<8 hex> (container) and clawco-u-<8 hex>-data (disk) with the label
// clawco.udgave, never the fleet's tenant label, so the reconciler (afstem.ts) never counts or removes them; no call
// here accepts any other name. No restart policy, no published port, no shell. Typed structurally: fleet/ never
// imports drift/.
import { randomBytes } from 'node:crypto';
import { BILLED_ID } from './flaade.ts';
import { BRUGER, HAERDNING, SKRIV_HUSSTAND, beholderAdresse, dockerKommando, sikrNetvaerk, tenantKoersel, type Koersel } from './lokal.ts';
import { kraevFilter, type Undernet, type Vaern } from './netfilter.ts';

const ETIKET = 'clawco.udgave=1';
const KLADDE = /^clawco-u-[0-9a-f]{8}$/;
const SHA = /^[0-9a-f]{7,40}$/;
/** The household of a scratch disk: a fictional owner on a reserved domain (never a real person). */
const KLADDE_HUSSTAND = JSON.stringify({ personer: [{ id: 'ejer', login: 'kompatibilitet@clawco.invalid', navn: 'kompatibilitet', rolle: 'ejer' }] });

function kladde(navn: string): string {
  if (!KLADDE.test(navn)) throw new Error('kun en kladde (clawco-u-…) kan bruges her');
  return navn;
}

function kladdeDisk(disk: string): string {
  if (!disk.endsWith('-data')) throw new Error('kun en kladde-disk (clawco-u-…-data) kan bruges her');
  kladde(disk.slice(0, -'-data'.length));
  return disk;
}

export function lokalBilledKoerer(o: { koer: Koersel; netvaerk: string; kontoPubkey: string; skyUrl: string; noegleFlag: string[]; tilfaeldig?: () => string;
  /** KC-0273: `netvaerk` is the shared pool network (lokal.ts deltNetvaerk) on this /24 (index 0); `vaern` must be ok. */
  undernet: Undernet; vaern: Vaern }) {
  const docker = dockerKommando(o.koer);
  const ny = () => (o.tilfaeldig ?? (() => randomBytes(4).toString('hex')))();

  return {
    /** The local image's id and its baked-in git sha; null when there is no such image. */
    async info(ref: string): Promise<{ id: string; sha: string } | null> {
      // Docker words a missing image "No such image: x" (older: "No such object"); anything else is a real error.
      const r = await o.koer(['docker', 'image', 'inspect', '--format', '{{.Id}}', ref]);
      if (r.kode !== 0) {
        if (/no such (image|object)/i.test(r.fejl)) return null;
        throw new Error(`Docker: image inspect fejlede (${r.kode}): ${r.fejl.trim().slice(0, 200)}`);
      }
      const id = r.ud.trim();
      if (!BILLED_ID.test(id)) throw new Error(`billedet ${ref} har intet gyldigt id`);
      const sha = ((await docker(['run', '--rm', '--label', ETIKET, '--network', 'none', '--read-only', ...HAERDNING, '--user', BRUGER, '--entrypoint', 'cat', id, '/app/GIT_SHA'])) ?? '').trim();
      if (!SHA.test(sha)) throw new Error(`billedet ${ref} har ingen git-sha i /app/GIT_SHA (byg det med --build-arg GIT_SHA=<sha>)`);
      return { id, sha };
    },
    /** A new scratch disk with a household file (written by `billede`, so identity has one as on a tenant). */
    async nyDisk(billede: string): Promise<string> {
      const disk = `clawco-u-${ny()}-data`;
      kladdeDisk(disk);
      await docker(['volume', 'create', '--label', ETIKET, disk]);
      await docker([
        'run', '--rm', '--label', ETIKET, '--network', 'none', '--read-only', ...HAERDNING, '--user', BRUGER,
        '--volume', `${disk}:/data`, '--entrypoint', 'node', billede, '-e', SKRIV_HUSSTAND, KLADDE_HUSSTAND,
      ]);
      return disk;
    },
    /** Runs `billede` on scratch `disk` like a tenant (same flags), without a restart policy or a gateway route. */
    async start(billede: string, disk: string): Promise<{ navn: string; adresse: string }> {
      const navn = kladdeDisk(disk).slice(0, -'-data'.length);
      if ((await docker(['volume', 'inspect', disk], true)) === null) throw new Error(`disken ${disk} findes ikke`);
      await kraevFilter(o.vaern);
      const gateway = await sikrNetvaerk(docker, o.netvaerk, o.undernet);
      await docker([
        'run', '--detach', '--name', navn, '--label', ETIKET, '--network', o.netvaerk, '--volume', `${disk}:/data`,
        ...tenantKoersel({ tenantId: navn, gateway, kontoPubkey: o.kontoPubkey, skyUrl: o.skyUrl, noegleFlag: o.noegleFlag }),
        billede,
      ]);
      try {
        return { navn, adresse: await beholderAdresse(docker, o.netvaerk, navn) };
      } catch {
        // Exited before it got an address (seen live: a crash in the first second). Removed here, since the caller
        // never learns the name of a start that failed.
        await docker(['rm', '--force', navn], true).catch(() => {});
        throw new Error(`beholderen ${navn} stoppede med det samme`);
      }
    },
    /** Removes a scratch container, seen gone; quiet when it is already gone. */
    async stop(navn: string): Promise<void> {
      await docker(['rm', '--force', kladde(navn)], true);
      if ((await docker(['container', 'inspect', '--format', '{{.State.Running}}', navn], true)) !== null) throw new Error(`kladden ${navn} findes stadig`);
    },
    async fjernDisk(disk: string): Promise<void> {
      await docker(['volume', 'rm', kladdeDisk(disk)], true);
      if ((await docker(['volume', 'inspect', disk], true)) !== null) throw new Error(`kladde-disken ${disk} findes stadig`);
    },
  };
}
