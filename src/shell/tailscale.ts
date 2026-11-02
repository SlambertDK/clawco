// KC-0161: where the user is on the way to reaching Clawco from the phone. A pure
// state function over what the local Tailscale CLI printed, plus a thin runner.
//
// Invariants:
//  - What the card shows comes only from the local CLI (`status --json`,
//    `serve status --json`); the app holds no Tailscale key, password or login.
//  - The app runs exactly three commands (SIKRE_KOMMANDOER below): the two reads
//    and `serve --bg <port>`. Anything else — Funnel (public exposure, forbidden),
//    login, reset — is refused here, in one place, before the runner is reached.
//  - Nothing here throws into a page: a CLI that errors, hangs or prints garbage
//    reads as `ukendt` (the card says so; no guessing).

import { execFile as nodeExecFile } from 'node:child_process';
import { tekst } from './tekster.ts';

/** The states of the card. `laptop` = a laptop install with no Tailscale (KC-0160); `slukket` = installed and logged in but switched off. */
export const TS_TILSTANDE = ['mangler', 'ikke-logget-ind', 'slukket', 'klar', 'delt', 'laptop', 'ukendt'] as const;
export type TsTilstand = (typeof TS_TILSTANDE)[number];

export type TsSyn = {
  tilstand: TsTilstand;
  /** The port the app listens on (what the button would share). */
  port: number;
  /** A laptop install (KC-0160): the card adds "only when the laptop is awake" and leaves the invitations out. */
  laptop: boolean;
  /** `delt` only: https://<name>.<tailnet>.ts.net (a name that is not a ts.net name is never shown). */
  adresse?: string;
  /** `delt` and Tailscale says it is open to the whole internet (Funnel): the card says so and what to do. */
  offentlig?: boolean;
};

/** What the CLI answered: the parsed JSON of the two reads (undefined = could not be parsed), or no binary at all. */
export type TsRaa = { fundet: false } | { fundet: true; status: unknown; serve?: unknown };

const HOST = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.ts\.net$/i;
const LOKALE = new Set(['127.0.0.1', 'localhost', '[::1]']);

const erObjekt = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Whether a serve proxy target is this machine's own app port (127.0.0.1, localhost or ::1; any path). */
function peger(proxy: unknown, port: number): boolean {
  if (typeof proxy !== 'string') return false;
  try {
    const u = new URL(proxy);
    return LOKALE.has(u.hostname) && u.port === String(port);
  } catch { return false; }
}

/** The serve entry for the app port: its address (when it is a ts.net name) and whether Funnel is on for it. null = not shared; 'ulaeselig' = the answer is not what the CLI prints. */
function deling(serve: unknown, port: number): { adresse?: string; offentlig: boolean } | null | 'ulaeselig' {
  if (!erObjekt(serve)) return 'ulaeselig';
  const web = serve['Web'];
  if (web === undefined) return null;
  if (!erObjekt(web)) return 'ulaeselig';
  for (const [vaertPort, v] of Object.entries(web)) {
    const handlers = erObjekt(v) ? v['Handlers'] : undefined;
    if (!erObjekt(handlers) || !Object.values(handlers).some((h) => erObjekt(h) && peger(h['Proxy'], port))) continue;
    const skel = vaertPort.lastIndexOf(':');
    const host = skel < 0 ? vaertPort : vaertPort.slice(0, skel);
    const p = skel < 0 ? '443' : vaertPort.slice(skel + 1);
    const tcp = erObjekt(serve['TCP']) && erObjekt(serve['TCP'][p]) ? serve['TCP'][p] as Record<string, unknown> : undefined;
    const skema = tcp && tcp['HTTPS'] !== true && tcp['HTTP'] === true ? 'http' : 'https';
    const aaben = erObjekt(serve['AllowFunnel']) && serve['AllowFunnel'][vaertPort] === true;
    const adresse = HOST.test(host) && /^\d{1,5}$/.test(p) ? `${skema}://${host}${(skema === 'https' && p === '443') || (skema === 'http' && p === '80') ? '' : `:${p}`}` : undefined;
    return { ...(adresse ? { adresse } : {}), offentlig: aaben };
  }
  return null;
}

/** The state from what the CLI said. Pure. `laptop` is the install's mode, not something the CLI knows. */
export function tilstandAf(raa: TsRaa, o: { port: number; laptop: boolean }): TsSyn {
  const base = { port: o.port, laptop: o.laptop };
  if (!raa.fundet) return { ...base, tilstand: o.laptop ? 'laptop' : 'mangler' };
  const s = raa.status;
  const bs = erObjekt(s) ? s['BackendState'] : undefined;
  if (typeof bs !== 'string') return { ...base, tilstand: 'ukendt' };
  if (bs === 'NeedsLogin' || bs === 'NoState') return { ...base, tilstand: 'ikke-logget-ind' };
  if (bs === 'Stopped') return { ...base, tilstand: 'slukket' };
  if (bs !== 'Running') return { ...base, tilstand: 'ukendt' }; // Starting, NeedsMachineAuth, anything newer: say so, do not guess
  const d = deling(raa.serve, o.port);
  if (d === 'ulaeselig') return { ...base, tilstand: 'ukendt' };
  if (d === null) return { ...base, tilstand: 'klar' };
  return { ...base, tilstand: 'delt', ...(d.adresse ? { adresse: d.adresse } : {}), ...(d.offentlig ? { offentlig: true } : {}) };
}

// ---------- the runner ----------

/** No binary (`fundet: false`) or the CLI's answer; a non-zero exit is an answer. Rejects when the CLI did not answer in time. */
export type TsSvar = { fundet: false } | { fundet: true; kode: number; stdout: string; stderr: string };
export type TsKoerer = (argv: readonly string[]) => Promise<TsSvar>;

/** A CLI call that timed out; carries what it had printed (Serve's "not enabled" prompt waits for a login). */
export class TsTid extends Error {
  readonly stdout: string;
  readonly stderr: string;
  constructor(stdout: string, stderr: string) {
    super('Tailscale svarede ikke inden for tiden.');
    this.name = 'TsTid';
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

/** The one write the app does: share the app port on the tailnet, in the background. Never anything public. */
export function delArgv(port: number): string[] {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Ugyldig port: ${String(port).slice(0, 12)}`);
  return ['serve', '--bg', String(port)];
}

/** The only commands the app ever runs (AGENTS.md §9: no Funnel, no login, no ACLs; the card links to Tailscale's own admin page). */
function erSikker(argv: readonly string[]): boolean {
  const a = argv.join(' ');
  if (a === 'status --json' || a === 'serve status --json') return true;
  const m = /^serve --bg (\d{1,5})$/.exec(a);
  return Boolean(m) && argv.length === 3 && Number(m![1]) >= 1 && Number(m![1]) <= 65535;
}

/** The runner with the allow-list in front of it: an argv off the list rejects before anything is spawned. */
export function sikkerKoerer(koerer: TsKoerer): TsKoerer {
  return async (argv) => {
    if (!erSikker(argv)) throw new Error('Den Tailscale-kommando er ikke tilladt.');
    return koerer(argv);
  };
}

export type TsExecFile = (fil: string, argv: readonly string[], opts: { timeout?: number; maxBuffer?: number; windowsHide?: boolean }, cb: (err: (Error & { code?: number | string; killed?: boolean }) | null, stdout: string, stderr: string) => void) => unknown;

/** Where the CLI lives: on PATH, inside the Mac app (which bundles it), Homebrew (Apple silicon, Intel), the Linux package, snap. */
export const TS_STIER: readonly string[] = [
  'tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/opt/homebrew/bin/tailscale',
  '/usr/local/bin/tailscale',
  '/usr/bin/tailscale',
  '/snap/bin/tailscale',
];

/** The real runner: argv, never a shell; every call has a timeout; the first place a binary exists answers. */
export function lavTsKoerer(o: { execFile?: TsExecFile; timeoutMs?: number; stier?: readonly string[] } = {}): TsKoerer {
  const exec = o.execFile ?? (nodeExecFile as unknown as TsExecFile);
  const timeout = o.timeoutMs ?? 8000;
  const stier = o.stier ?? TS_STIER;
  const kald = (fil: string, argv: readonly string[]): Promise<TsSvar | 'findes-ikke'> => new Promise((resolve, reject) => {
    exec(fil, argv, { timeout, maxBuffer: 1 << 20, windowsHide: true }, (err, stdout, stderr) => {
      if (!err) return resolve({ fundet: true, kode: 0, stdout: String(stdout), stderr: String(stderr) });
      if (err.code === 'ENOENT' || err.code === 'EACCES') return resolve('findes-ikke');
      if (err.killed || err.code === 'ETIMEDOUT') return reject(new TsTid(String(stdout ?? ''), String(stderr ?? '')));
      if (typeof err.code === 'number') return resolve({ fundet: true, kode: err.code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      reject(new Error('Tailscale kunne ikke køres.'));
    });
  });
  return async (argv) => {
    for (const fil of stier) {
      const svar = await kald(fil, argv);
      if (svar !== 'findes-ikke') return svar;
    }
    return { fundet: false };
  };
}

function json(tekst: string): unknown {
  try { return JSON.parse(tekst) as unknown; } catch { return undefined; }
}

/** The state now, from the local CLI. Never throws: anything unexpected is `ukendt`. */
export async function laesTailscale(koerer: TsKoerer, o: { port: number; laptop: boolean }): Promise<TsSyn> {
  const sikker = sikkerKoerer(koerer);
  try {
    const st = await sikker(['status', '--json']);
    if (!st.fundet) return tilstandAf({ fundet: false }, o);
    const status = json(st.stdout);
    // Only a running Tailscale has anything to serve; the other states are decided by the first read.
    if (!erObjekt(status) || status['BackendState'] !== 'Running') return tilstandAf({ fundet: true, status }, o);
    const sv = await sikker(['serve', 'status', '--json']);
    if (!sv.fundet || sv.kode !== 0) return tilstandAf({ fundet: true, status, serve: undefined }, o);
    return tilstandAf({ fundet: true, status, serve: json(sv.stdout) }, o);
  } catch {
    return { port: o.port, laptop: o.laptop, tilstand: 'ukendt' };
  }
}

/** Thrown with a sentence fit for the page. */
export class TsFejl extends Error {
  constructor(message: string) { super(message); this.name = 'TsFejl'; }
}

const LOGIN_LINK = /https:\/\/login\.tailscale\.com\/[A-Za-z0-9/_?=&.%-]+/;

/**
 * Shares the app port on the tailnet (`tailscale serve --bg <port>`) and returns the new state. Throws TsFejl with a
 * plain sentence; Tailscale's own text is never passed on, except its login link when Serve has to be switched on first.
 */
export async function delPaaTailnet(koerer: TsKoerer, o: { port: number; laptop: boolean }): Promise<TsSyn> {
  const sikker = sikkerKoerer(koerer);
  let svar: TsSvar;
  try { svar = await sikker(delArgv(o.port)); } catch (err) {
    const link = err instanceof TsTid ? LOGIN_LINK.exec(`${err.stderr}\n${err.stdout}`)?.[0] : undefined;
    throw new TsFejl(link ? tekst().tailscale.harIkkeSlaaetTil(link) : tekst().tailscale.svarerIkke);
  }
  if (!svar.fundet) throw new TsFejl(tekst().tailscale.ikkeInstalleret);
  if (svar.kode !== 0) {
    const link = LOGIN_LINK.exec(`${svar.stderr}\n${svar.stdout}`)?.[0];
    throw new TsFejl(link ? tekst().tailscale.harIkkeSlaaetTil(link) : tekst().tailscale.kunneIkkeDele);
  }
  return laesTailscale(koerer, o);
}

/** The command the button runs, as shown to the user before the tap. */
export const delKommando = (port: number): string => `tailscale ${delArgv(port).join(' ')}`;
