// The lokal fleet driver (KC-0212, spec D18; hardened in KC-0182): Docker on the host Sky runs on, through
// the Docker CLI and an injected runner (tests use a fake; nothing here talks to a real daemon in tests).
// One container per tenant from the tenant image and one named volume per tenant, on one user-defined
// bridge network with inter-container traffic switched off: tenants cannot reach each other, while the
// host (Sky and the edge, KC-0183, both run on the host) reaches each tenant on its own address on that
// network. No port is ever published on the host, and no argument is ever given to a shell.
import { spawn } from 'node:child_process';
import { BILLED_ID, tjekTenantId, type Flaade, type Klargjort, type TenantStatus } from './flaade.ts';
import type { VolumenKryptering } from './kryptering.ts';

export type Koersel = (argv: string[]) => Promise<{ kode: number; ud: string; fejl: string }>;

/** The tenant app's port inside its container (the app's own default, KC_PORT). */
export const TENANT_PORT = 8750;
/** The `node` user of the tenant image (Dockerfile: USER node; /data is chowned to it). Stated explicitly so
 *  an image that forgot its USER line still never runs a tenant as root. */
export const BRUGER = '1000:1000';
const ICC = 'com.docker.network.bridge.enable_icc';
const ETIKET = 'clawco.tenant';
/** A Docker container name as `container ls` prints it; anything else is never passed on to another call. */
const CONTAINER_NAVN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
// Docker words "absent" differently per object (Docker 29.9: "No such container: x", "get x: no such volume",
// "network x not found"), so all three count as absent; any other error is real and is thrown.
const INGEN = /no such (container|object|volume|network)|network \S+ not found/i;
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

/** Writes /data/husstand.json from argv[1] unless one is already there (a resumed tenant keeps the household
 *  its owner may have changed). Atomic: tmp file, then a hard link that fails if the name exists. Runs as
 *  `node -e` in a helper container: a fixed program text, the household as a plain argument, no shell. */
export const SKRIV_HUSSTAND = [
  "const fs = process.getBuiltinModule('node:fs');",
  "const f = '/data/husstand.json';",
  "const t = '/data/husstand.json.ny';",
  'if (!fs.existsSync(f)) {',
  '  fs.writeFileSync(t, process.argv[1], { mode: 0o600 });',
  "  try { fs.linkSync(t, f); } catch (e) { if (e.code !== 'EEXIST') throw e; }",
  '  fs.unlinkSync(t);',
  '}',
].join('\n');

/** Runs argv[0] with the rest as arguments — no shell, so nothing in an argument is ever interpreted. */
export const koerProces: Koersel = (argv) => new Promise((resolve, reject) => {
  const [cmd, ...args] = argv;
  if (!cmd) { reject(new Error('tom kommando')); return; }
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let ud = '';
  let fejl = '';
  p.stdout.setEncoding('utf8').on('data', (d: string) => { ud += d; });
  p.stderr.setEncoding('utf8').on('data', (d: string) => { fejl += d; });
  p.on('error', reject);
  p.on('close', (kode) => resolve({ kode: kode ?? 1, ud, fejl }));
});

/** The owner as the household's one `ejer` (src/identitet/husstand.ts format, matched by login = email). */
function husstandFor(ejer: string): string {
  const e = ejer.toLowerCase();
  if (e.length > 254 || /[\u0000-\u001f\u007f\s]/.test(e) || !/^[^@]+@[^@]+\.[^@]+$/.test(e)) throw new Error('ugyldig ejer: skal være en verificeret mailadresse');
  const navn = e.slice(0, e.indexOf('@')).slice(0, 80);
  return JSON.stringify({ personer: [{ id: 'ejer', login: e, navn, rolle: 'ejer' }] });
}

export type Docker = (args: string[], tilladIngen?: boolean) => Promise<string | null>;

/** `docker <args>` through the runner: stdout on success, null for "absent" when allowed, else an error naming
 *  the first two arguments and Docker's own short message. Shared with the backup node (fleet/kopi.ts). */
export function dockerKommando(koer: Koersel): Docker {
  return async (args, tilladIngen = false) => {
    const r = await koer(['docker', ...args]);
    if (r.kode === 0) return r.ud;
    if (tilladIngen && INGEN.test(r.fejl)) return null;
    throw new Error(`Docker: ${args.slice(0, 2).join(' ')} fejlede (${r.kode}): ${r.fejl.trim().slice(0, 200)}`);
  };
}

/** The tenant network, created with inter-container traffic off; an existing one must have it off too.
 *  Returns the network's gateway address: the host's side of the bridge, where Sky's edge connects from. */
export async function sikrNetvaerk(docker: Docker, netvaerk: string): Promise<string> {
  let ud = await docker(['network', 'inspect', netvaerk], true);
  if (ud === null) {
    await docker(['network', 'create', '--driver', 'bridge', '--label', 'clawco.sky=1', '--opt', `${ICC}=false`, netvaerk]);
    ud = await docker(['network', 'inspect', netvaerk]);
  }
  const [n] = JSON.parse(ud ?? '[]') as { Options?: Record<string, string>; IPAM?: { Config?: { Gateway?: string }[] } }[];
  if (n?.Options?.[ICC] !== 'false') throw new Error(`Docker-netværket ${netvaerk} tillader trafik mellem beholdere (${ICC} er ikke false): lejerne kunne se hinanden — slet netværket eller vælg et andet i SKY_TENANT_NETVAERK`);
  const gateway = n.IPAM?.Config?.find((c) => c.Gateway && IPV4.test(c.Gateway))?.Gateway;
  if (!gateway) throw new Error(`Docker-netværket ${netvaerk} har ingen IPv4-gateway`);
  return gateway;
}

export async function beholderAdresse(docker: Docker, netvaerk: string, container: string): Promise<string> {
  const ud = await docker(['container', 'inspect', '--format', '{{json .NetworkSettings.Networks}}', container]);
  const net = (JSON.parse(ud ?? '{}') as Record<string, { IPAddress?: string }>)[netvaerk];
  const ip = net?.IPAddress ?? '';
  if (!IPV4.test(ip)) throw new Error(`beholderen ${container} har ingen adresse på ${netvaerk}`);
  return `http://${ip}:${TENANT_PORT}`;
}

export const HAERDNING = ['--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true'];

/** How a tenant's app runs, after `--volume …:/data`: read-only root, its key tmpfs, its user, hardening,
 *  limits and identity. The same for a tenant and for a restored copy of it (fleet/kopi.ts). */
export function tenantKoersel(o: { tenantId: string; gateway: string; kontoPubkey: string; noegleFlag: string[] }): string[] {
  return [
    // Read-only root; only /data (the volume) and a small /tmp are writable.
    '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
    // KC-0181: `noegleFlag` (from hemmeligheder/levering.ts, injected) is a private tmpfs for the tenant's
    // lager key (delivered after start, gone with every stop) and the key file's PATH — never the key.
    ...o.noegleFlag,
    '--user', BRUGER,
    ...HAERDNING,
    '--memory', '1g', '--memory-swap', '1g', '--cpu-shares', '512', '--pids-limit', '256',
    // Logs go to journald, whose retention limit (deploy/opsaet-root.sh) keeps the legal texts' 30 days (KC-0204).
    '--log-driver', 'journald',
    '--env', 'KC_DATA_DIR=/data', '--env', `KC_PORT=${TENANT_PORT}`,
    // Listen on the container's own interface (reached only through the Docker network above).
    '--env', 'KC_HOST=0.0.0.0',
    // Identity from Sky's signed header only (KC-0179); the gateway connects from the bridge's host side.
    '--env', 'KC_IDENTITET=konto', '--env', `KC_KONTO_TENANT=${o.tenantId}`, '--env', `KC_KONTO_PUBKEY=${o.kontoPubkey}`,
    '--env', `KC_KONTO_GATEWAY=${o.gateway}`,
    '--env', 'KC_AGENT=direkte',
  ];
}

export function lokalFlaade(o: { koer: Koersel; billede: string; netvaerk: string; kontoPubkey: string; kryptering: VolumenKryptering; noegleFlag: string[] }): Flaade {
  const navne = (id: string) => ({ container: `clawco-t-${tjekTenantId(id)}`, volumen: `clawco-t-${id}-data` });
  const docker = dockerKommando(o.koer);
  const adresse = (container: string) => beholderAdresse(docker, o.netvaerk, container);

  /** The tenant container's `docker run`: the same for a first start and for an upgrade or rollback (KC-0186). */
  function koerArgs(id: string, gateway: string, billede: string): string[] {
    const { container, volumen } = navne(id);
    return [
      'run', '--detach', '--name', container, '--label', `${ETIKET}=${id}`,
      '--network', o.netvaerk, '--restart', 'unless-stopped',
      '--volume', `${volumen}:/data`,
      ...tenantKoersel({ tenantId: id, gateway, kontoPubkey: o.kontoPubkey, noegleFlag: o.noegleFlag }),
      billede,
    ];
  }

  async function status(id: string): Promise<TenantStatus> {
    const { container } = navne(id);
    const ud = await docker(['container', 'inspect', '--format', '{{.State.Running}}', container], true);
    if (ud === null) return 'findes-ikke';
    return ud.trim() === 'true' ? 'koerer' : 'stoppet';
  }

  return {
    navn: 'lokal',
    status,
    async klargoer(t) {
      const { container, volumen } = navne(t.id);
      const husstand = husstandFor(t.ejer);
      const s = await status(t.id);
      if (s === 'findes-ikke') {
        const gateway = await sikrNetvaerk(docker, o.netvaerk);
        await docker(['volume', 'create', '--label', `${ETIKET}=${t.id}`, ...(await o.kryptering.volumenFlag(t.id)), volumen]);
        // The household before the first start, so identity (KC-0179) never sees a tenant without one.
        await docker([
          'run', '--rm', '--label', `${ETIKET}=${t.id}`, '--network', 'none', '--read-only', ...HAERDNING, '--user', BRUGER,
          '--volume', `${volumen}:/data`, '--entrypoint', 'node', o.billede, '-e', SKRIV_HUSSTAND, husstand,
        ]);
        await docker(koerArgs(t.id, gateway, o.billede));
      } else if (s === 'stoppet') {
        await docker(['start', container]);
      }
      const ud: Klargjort = { tenantId: t.id, container, volumen, adresse: await adresse(container), krypteret: o.kryptering.krypteret };
      return ud;
    },
    async stop(id) {
      const { container } = navne(id);
      await docker(['stop', container], true);
    },
    async slet(id) {
      const { container, volumen } = navne(id);
      await docker(['rm', '--force', container], true);
      await docker(['volume', 'rm', volumen], true);
      // Seen gone, not assumed gone.
      if ((await status(id)) !== 'findes-ikke') throw new Error(`beholderen ${container} findes stadig efter sletning`);
      if ((await docker(['volume', 'inspect', volumen], true)) !== null) throw new Error(`disken ${volumen} findes stadig efter sletning`);
    },
    async beholder(id) {
      const { container } = navne(id);
      const ud = await docker(['container', 'inspect', '--format', '{{.State.Running}}\t{{.Image}}', container], true);
      if (ud === null) return null;
      const [koerer, billede] = ud.trim().split('\t');
      if (koerer !== 'true') return null;
      if (!billede || !BILLED_ID.test(billede)) throw new Error(`beholderen ${container} har intet gyldigt billed-id`);
      // Running without an address is a crash loop between two restarts (seen live, 2026-11-01): not serving.
      const a = await adresse(container).catch(() => null);
      return a ? { billede, adresse: a, container } : null;
    },
    async opgrader(t) {
      const { container, volumen } = navne(t.id);
      if (!BILLED_ID.test(t.billede)) throw new Error('en kunde kører altid et billed-id (sha256:…), aldrig et tag');
      // Seen before anything goes: `docker run -v` would otherwise make an empty volume under the tenant's name.
      if ((await docker(['volume', 'inspect', volumen], true)) === null) throw new Error(`disken ${volumen} findes ikke`);
      const gateway = await sikrNetvaerk(docker, o.netvaerk);
      await docker(['rm', '--force', container], true);
      await docker(koerArgs(t.id, gateway, t.billede));
      return { tenantId: t.id, container, volumen, adresse: await adresse(container), krypteret: o.kryptering.krypteret };
    },
    async maerkede() {
      const ider = new Set<string>();
      const c = await docker(['container', 'ls', '--all', '--filter', `label=${ETIKET}`, '--format', `{{.Label "${ETIKET}"}}`]);
      const v = await docker(['volume', 'ls', '--filter', `label=${ETIKET}`, '--format', `{{.Label "${ETIKET}"}}`]);
      for (const l of `${c ?? ''}\n${v ?? ''}`.split('\n')) {
        const id = l.trim();
        try { if (id) ider.add(tjekTenantId(id)); } catch { /* not a tenant id we could have made */ }
      }
      return ider;
    },
    async startede() {
      const m = new Map<string, { container: string; startet: string }>();
      const ls = await docker(['container', 'ls', '--filter', `label=${ETIKET}`, '--filter', 'status=running', '--format', '{{.Names}}']);
      const navneListe = (ls ?? '').split('\n').map((l) => l.trim()).filter((n) => CONTAINER_NAVN.test(n));
      if (!navneListe.length) return m;
      // One inspect for all of them. A container that went away between the two calls fails the whole call
      // ("no such"): this pass then sees no starts and the next pass looks again.
      const ud = await docker(['container', 'inspect', '--format', `{{index .Config.Labels "${ETIKET}"}}\t{{.Name}}\t{{.State.StartedAt}}`, ...navneListe], true);
      for (const l of (ud ?? '').split('\n')) {
        const [id, navn, startet] = l.trim().split('\t');
        if (!id || !navn || !startet) continue;
        try { m.set(tjekTenantId(id), { container: navn.replace(/^\//, ''), startet }); } catch { /* not a tenant id we could have made */ }
      }
      return m;
    },
  };
}
