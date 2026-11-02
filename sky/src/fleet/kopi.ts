// The lokal fleet's backup node (KC-0185): the KopiNode seam of drift/backup over the Docker CLI on the Sky host
// (kira-home for the beta). A Hetzner node agent offers the same five calls later. Invariants (AGENTS §4 r5):
// a tenant's own volume is only ever mounted read-only, and only after `docker volume inspect` has seen it (a
// `docker run -v` would otherwise create an empty one); everything a restore or drill creates has a NEW name,
// clawco-g-<tenant>-<8 hex> (restore) or clawco-p-<tenant>-<8 hex> (drill), and the label clawco.kopi=<tenant>
// instead of the fleet's tenant label, so the reconciler (afstem.ts) never counts or removes it; nothing here
// accepts a tenant's own container or volume name for a write or a removal. Typed structurally: fleet/ never
// imports drift/. No shell, ever; tar travels on stdin/stdout as bytes.
import { spawn } from 'node:child_process';
import { tjekTenantId } from './flaade.ts';
import { BRUGER, HAERDNING, beholderAdresse, dockerKommando, sikrNetvaerk, tenantKoersel, type Koersel } from './lokal.ts';

export type KoerselBinaer = (argv: string[], input?: Buffer, env?: Record<string, string>) => Promise<{ kode: number; ud: Buffer; fejl: string }>;

/** Runs argv[0] with the rest as arguments (no shell); stdout as bytes, `input` on stdin, `env` added to the
 *  process environment (which no longer holds Sky's keys: they are removed from it when read). */
export const koerBinaer: KoerselBinaer = (argv, input, env) => new Promise((resolve, reject) => {
  const [cmd, ...args] = argv;
  if (!cmd) { reject(new Error('tom kommando')); return; }
  const p = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'], ...(env ? { env: { ...process.env, ...env } } : {}) });
  const ud: Buffer[] = [];
  let fejl = '';
  p.stdout!.on('data', (d: Buffer) => { ud.push(d); });
  p.stderr!.setEncoding('utf8').on('data', (d: string) => { fejl += d; });
  p.on('error', reject);
  p.on('close', (kode) => resolve({ kode: kode ?? 1, ud: Buffer.concat(ud), fejl }));
  if (input && p.stdin) { p.stdin.on('error', () => { /* exited early; its exit code reports it */ }); p.stdin.end(input); }
});

const ETIKET = 'clawco.kopi';

export function lokalKopiNode(o: { koer: KoerselBinaer; billede: string; netvaerk: string; kontoPubkey: string; noegleFlag: string[] }) {
  const tekst: Koersel = async (argv) => { const r = await o.koer(argv); return { kode: r.kode, ud: r.ud.toString('utf8'), fejl: r.fejl }; };
  const docker = dockerKommando(tekst);

  /** A restore/drill name for exactly this tenant: clawco-[gp]-<tenant>-<8 hex>. */
  function tjekNavn(navn: string, tenant?: string): string {
    const m = /^clawco-[gp]-(.+)-[0-9a-f]{8}$/.exec(navn);
    let ok = !!m;
    try { if (m) tjekTenantId(m[1]!); } catch { ok = false; }
    if (!ok || (tenant !== undefined && m![1] !== tenant)) throw new Error('ugyldigt navn til en gendannelse');
    return navn;
  }

  async function findes(volumen: string): Promise<boolean> {
    return (await docker(['volume', 'inspect', volumen], true)) !== null;
  }

  async function tarAf(volumen: string): Promise<Buffer> {
    if (!(await findes(volumen))) throw new Error(`disken ${volumen} findes ikke`);
    const args = [
      'run', '--rm', '--label', `${ETIKET}=1`, '--network', 'none', '--read-only', ...HAERDNING, '--user', BRUGER,
      '--volume', `${volumen}:/data:ro`, '--entrypoint', 'tar', o.billede, '-C', '/data', '-cf', '-', '.',
    ];
    const r = await o.koer(['docker', ...args]);
    if (r.kode !== 0) throw new Error(`Docker: tar af ${volumen} fejlede (${r.kode}): ${r.fejl.trim().slice(0, 200)}`);
    return r.ud;
  }

  return {
    pak: (tenant: string) => tarAf(`clawco-t-${tjekTenantId(tenant)}-data`),
    pakGendannet: (navn: string) => tarAf(`${tjekNavn(navn)}-data`),
    async udpak(navn: string, tenant: string, tar: Buffer) {
      const volumen = `${tjekNavn(navn, tjekTenantId(tenant))}-data`;
      if (await findes(volumen)) throw new Error(`disken ${volumen} findes allerede`);
      await docker(['volume', 'create', '--label', `${ETIKET}=${tenant}`, volumen]);
      const args = [
        'run', '--rm', '-i', '--label', `${ETIKET}=${tenant}`, '--network', 'none', '--read-only', ...HAERDNING, '--user', BRUGER,
        '--volume', `${volumen}:/data`, '--entrypoint', 'tar', o.billede, '-C', '/data', '-xpf', '-',
      ];
      const r = await o.koer(['docker', ...args], tar);
      if (r.kode !== 0) throw new Error(`Docker: udpakning i ${volumen} fejlede (${r.kode}): ${r.fejl.trim().slice(0, 200)}`);
    },
    async start(navn: string, tenant: string) {
      tjekNavn(navn, tjekTenantId(tenant));
      const gateway = await sikrNetvaerk(docker, o.netvaerk);
      // No restart policy: a restored or scratch container never comes back on its own after a host restart.
      await docker([
        'run', '--detach', '--name', navn, '--label', `${ETIKET}=${tenant}`, '--network', o.netvaerk,
        '--volume', `${navn}-data:/data`,
        ...tenantKoersel({ tenantId: tenant, gateway, kontoPubkey: o.kontoPubkey, noegleFlag: o.noegleFlag }),
        o.billede,
      ]);
      return { adresse: await beholderAdresse(docker, o.netvaerk, navn) };
    },
    async fjern(navn: string) {
      tjekNavn(navn);
      await docker(['rm', '--force', navn], true);
      await docker(['volume', 'rm', `${navn}-data`], true);
      // Seen gone, not assumed gone.
      if ((await docker(['container', 'inspect', '--format', '{{.State.Running}}', navn], true)) !== null) throw new Error(`beholderen ${navn} findes stadig`);
      if (await findes(`${navn}-data`)) throw new Error(`disken ${navn}-data findes stadig`);
    },
  };
}
