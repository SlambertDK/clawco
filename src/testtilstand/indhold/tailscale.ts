// The test world's Tailscale (KC-0161): one moment per state of the card in Start, and a scripted stand-in for the
// local CLI that answers what that moment says. Nothing here runs a real binary or names a real tailnet (the address
// is on example.ts.net). The day's moments are Henrik's reference install (shared, journey Done: the card is out of
// sight); the cold start's moments are a fresh install with no Tailscale.

import type { Moment } from '../typer.ts';
import type { TsKoerer, TsSvar } from '../../shell/tailscale.ts';

const ADRESSE = 'laptop.example.ts.net';
const PORT = 8750;

type Forlaeg = { binaer: boolean; status: unknown; serve: unknown; laptop: boolean };

const KOERT = { BackendState: 'Running', Self: { DNSName: `${ADRESSE}.` } };
const DELT = { TCP: { '443': { HTTPS: true } }, Web: { [`${ADRESSE}:443`]: { Handlers: { '/': { Proxy: `http://127.0.0.1:${PORT}` } } } } };

/** What the stand-in CLI says at each Tailscale moment; any other cold moment: nothing installed; the day: shared. */
const FORLAEG: Record<string, Omit<Forlaeg, 'laptop'> & { laptop?: boolean }> = {
  'tailscale-mangler': { binaer: false, status: null, serve: null },
  'tailscale-login': { binaer: true, status: { BackendState: 'NeedsLogin' }, serve: {} },
  'tailscale-slukket': { binaer: true, status: { BackendState: 'Stopped' }, serve: {} },
  'tailscale-klar': { binaer: true, status: KOERT, serve: {} },
  'tailscale-delt': { binaer: true, status: KOERT, serve: DELT },
  'tailscale-offentlig': { binaer: true, status: KOERT, serve: { ...DELT, AllowFunnel: { [`${ADRESSE}:443`]: true } } },
  'tailscale-laptop': { binaer: false, status: null, serve: null, laptop: true },
  'tailscale-ukendt': { binaer: true, status: { BackendState: 'Starting' }, serve: {} },
};

/** KC-0161: one cold-start moment per state of the Tailscale card (coverage: src/testtilstand/daekning.ts). */
export const KOLD_TAILSCALE: readonly Moment[] = [
  { id: 'tailscale-mangler', tid: '09:40', navn: 'Tailscale: mangler', url: '/rum/start', replik: 'Hvordan når jeg Clawco fra telefonen?' },
  { id: 'tailscale-login', tid: '09:41', navn: 'Tailscale: ikke logget ind', url: '/rum/start', replik: 'Hvad mangler der for telefonen?' },
  { id: 'tailscale-slukket', tid: '09:42', navn: 'Tailscale: slukket', url: '/rum/start', replik: 'Hvorfor når telefonen ikke Clawco?' },
  { id: 'tailscale-klar', tid: '09:43', navn: 'Tailscale: klar til deling', url: '/rum/start', replik: 'Hvad er næste skridt for telefonen?' },
  { id: 'tailscale-delt', tid: '09:44', navn: 'Tailscale: Clawco er delt', url: '/rum/start', replik: 'Hvilken adresse skal telefonen åbne?' },
  { id: 'tailscale-offentlig', tid: '09:45', navn: 'Tailscale: åbent for internettet', url: '/rum/start', replik: 'Er Clawco åbent for andre?' },
  { id: 'tailscale-laptop', tid: '09:46', navn: 'Tailscale: kun bærbar', url: '/rum/start', replik: 'Kan telefonen nå Clawco?' },
  { id: 'tailscale-ukendt', tid: '09:47', navn: 'Tailscale: kan ikke aflæses', url: '/rum/start', replik: 'Hvad siger Tailscale?' },
];

export const erTailscaleMoment = (momentId: string): boolean => KOLD_TAILSCALE.some((m) => m.id === momentId);

/** The moment's stand-in CLI state. `kold` says the moment belongs to the cold start (a fresh install has none). */
function forlaeg(momentId: string, kold: boolean): Forlaeg {
  const f = FORLAEG[momentId];
  if (f) return { laptop: false, ...f };
  return kold ? { binaer: false, status: null, serve: null, laptop: false } : { binaer: true, status: KOERT, serve: DELT, laptop: false };
}

/** Whether the moment is a laptop install (the card's `laptop` mode). */
export const tailscaleLaptop = (momentId: string): boolean => forlaeg(momentId, false).laptop;

/**
 * The scripted CLI. `delte` remembers which moments the user shared on a tap (the world is wiped by every jump); the
 * share command is accepted only when the moment has Tailscale logged in and not shared yet.
 */
export function falskTailscale(moment: () => { id: string; kold: boolean }, delte: Set<string>): TsKoerer {
  const ok = (x: unknown): TsSvar => ({ fundet: true, kode: 0, stdout: typeof x === 'string' ? x : JSON.stringify(x), stderr: '' });
  return async (argv) => {
    const m = moment();
    const f = forlaeg(m.id, m.kold);
    if (!f.binaer) return { fundet: false };
    const a = argv.join(' ');
    if (a === 'status --json') return ok(f.status);
    if (a === 'serve status --json') return ok(delte.has(m.id) ? DELT : f.serve);
    if (/^serve --bg \d+$/.test(a)) {
      if ((f.status as { BackendState?: string }).BackendState !== 'Running') return { fundet: true, kode: 1, stdout: '', stderr: 'not running' };
      delte.add(m.id);
      return ok('');
    }
    return { fundet: true, kode: 1, stdout: '', stderr: 'unknown command' };
  };
}
