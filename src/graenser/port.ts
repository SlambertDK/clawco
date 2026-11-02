// The port (KC-0122, spec D5): the only way from a route to a room's handling.
// Every module the server can reach is wrapped here; the wrapped form has no
// `start*` methods, so a route cannot skip `afgoer`. Each decision goes to the
// injected sink (default, KC-0124: a line in the room's log for every refusal
// and one audit line per decision in the revisionslog).

import type { RoomDeps, RoomModule } from '../rooms/module.ts';
import type { RunRecord } from '../runs.ts';
import type { DataZone } from '../identitet/zoner.ts';
import { afgoer, type Afgoerelse, type Forslag, type Kontekst } from './afgoer.ts';
import { lavTegn, type Tegn } from './tegn.ts';
import { VERB_NU } from './opsyn.ts';
import type { Kanal } from './revisionslog.ts';

/** How a handling was asked for: the channel, and a human-tap token when the button needed a yes. */
export type Indgang = { kanal: Kontekst['kanal']; ja?: string };
/** `runId`: the run an allowed handling started (known only after it started). */
export type Rapport = Afgoerelse & { forslag: Forslag; kanal: Kontekst['kanal']; runId?: string };
export type Sink = (d: RoomDeps, r: Rapport) => Promise<void>;

export class GraenseAfvist extends Error {
  readonly udfald: 'afvis' | 'kraever-ja';
  constructor(a: Afgoerelse) { super(a.hvorfor); this.name = 'GraenseAfvist'; this.udfald = a.udfald === 'kraever-ja' ? 'kraever-ja' : 'afvis'; }
}

type Startere = 'startHandling' | 'startAction' | 'startFortryd' | 'startOpdater' | 'startChat';
export type VogtetRum = Omit<RoomModule, Startere> & {
  handling(d: RoomDeps, id: string, i: Indgang): Promise<RunRecord | null>;
  aktion?(d: RoomDeps, name: string, body: Record<string, unknown>, i: Indgang): Promise<RunRecord | null>;
  fortryd(d: RoomDeps, logId: string, i: Indgang): Promise<RunRecord | null>;
  opdater(d: RoomDeps, mode: string, i: Indgang): Promise<RunRecord | null>;
  chat(d: RoomDeps, besked: string, kontekst: string | undefined, i: Indgang): Promise<RunRecord>;
};

/** A refusal is a line in the room's log that says what Clawco did not do (AGENTS §4 r10). */
export const logSink: Sink = async (d, r) => {
  if (r.udfald === 'tillad') return;
  await d.store.appendLog(r.forslag.rum, { kilde: 'system', tekst: `Ikke gjort: ${r.hvorfor}`, zone: r.forslag.zoner[0] ?? 'privat', graense: r.udfald === 'kraever-ja' ? 'kraever-ja' : 'afvist' });
};

const KANAL: Record<Kontekst['kanal'], Kanal> = { knap: 'knap', stemme: 'stemme', chat: 'chat', baggrund: 'planlagt' };

/** An action's binding id without its body text: the name plus the ids it names (`nyt|dokId=d1`). Metadata only (KC-0124). */
export function metaId(id: string): string {
  const skel = id.indexOf('|');
  if (skel < 0) return id.slice(0, 200);
  let body: unknown;
  try { body = JSON.parse(id.slice(skel + 1)); } catch { body = {}; }
  const ider = Object.entries(typeof body === 'object' && body !== null ? body : {})
    .filter(([k, v]) => /Ids?$/.test(k) && (typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'))))
    .map(([k, v]) => `${k}=${(Array.isArray(v) ? v.join(',') : String(v)).slice(0, 80)}`);
  return [id.slice(0, skel), ...ider].join('|').slice(0, 200);
}

/** The default sink (KC-0124): the room-log line for a refusal, and one audit line per decision when the app has an audit log. */
export const revisionsSink: Sink = async (d, r) => {
  await logSink(d, r);
  await d.revision?.skriv({
    person: d.person.id, kanal: KANAL[r.kanal], rum: r.forslag.rum, verb: r.forslag.verb, udfald: r.udfald === 'afvis' ? 'afvist' : r.udfald,
    hvorfor: r.hvorfor, handlingId: metaId(r.forslag.id), ...(r.runId ? { runId: r.runId } : {}), zoner: r.forslag.zoner, kilde: 'graense',
  });
};

/** The id of the run a handling started: a RunRecord, or a card route's `{ run }`. */
function runIdAf(x: unknown): string | undefined {
  if (typeof x !== 'object' || x === null) return undefined;
  const o = x as { id?: unknown; status?: unknown; run?: unknown };
  if (typeof o.id === 'string' && typeof o.status === 'string') return o.id;
  return o.run ? runIdAf(o.run) : undefined;
}

/** One process-wide token store: the token route issues, the port redeems. */
export const TEGN: Tegn = lavTegn();

/** The binding id of an action: its name and the exact body it runs with (the token field left out). */
export const aktionId = (name: string, body: Record<string, unknown>): string => {
  const { ja: _ja, ...rest } = body;
  return `${name}|${JSON.stringify(rest)}`;
};

/**
 * Passes `forslag` through `afgoer` (redeeming the token for exactly this handling) and runs `koer` only on tillad.
 * Throws GraenseAfvist otherwise. For routes that are not room modules (Hjem's cards) as well as for the wrapper.
 */
export async function gennem<T>(d: RoomDeps, forslag: Forslag, slags: string, i: Indgang, koer: () => Promise<T>, o: { tegn?: Tegn; rapporter?: Sink } = {}): Promise<T> {
  const tegn = o.tegn ?? TEGN;
  const ja = i.kanal !== 'stemme' && tegn.indloes(i.ja, { person: d.person.id, rum: forslag.rum, slags, id: forslag.id });
  const a = afgoer(forslag, { person: d.person, kanal: i.kanal, ja });
  const rapporter = o.rapporter ?? revisionsSink;
  if (a.udfald !== 'tillad') {
    await rapporter(d, { ...a, forslag, kanal: i.kanal });
    throw new GraenseAfvist(a);
  }
  // An allowed handling is reported once, after it started, so its line carries the run (or none, when it failed to start).
  let svar: T | undefined;
  try {
    // The run(s) the handling starts are watched against this verb (opsyn.ts, runs.ts).
    svar = await VERB_NU.run(forslag.verb, koer);
    return svar;
  } finally {
    const runId = runIdAf(svar);
    await rapporter(d, { ...a, forslag, kanal: i.kanal, ...(runId ? { runId } : {}) });
  }
}

export function vogt(m: RoomModule, o: { tegn?: Tegn; rapporter?: Sink } = {}): VogtetRum {
  const { startHandling, startAction, startFortryd, startOpdater, startChat, ...resten } = m;
  const zoner = (): DataZone[] => [m.korsel];
  const f = (id: string, verb: string, z: DataZone[] = zoner()): Forslag => ({ rum: m.id, id, verb, zoner: z });
  const vogtet: VogtetRum = {
    ...resten,
    async handling(d, id, i) {
      const v = m.handlingVerb ? await m.handlingVerb(d, id) : null;
      if (!v) return null; // not in the state the person sees: nothing runs (the route answers 404 as before)
      return gennem(d, f(id, v.verb, v.zoner), 'handling', i, () => startHandling.call(m, d, id), o);
    },
    async fortryd(d, logId, i) { return gennem(d, f(logId, 'udfoer-med-fortryd'), 'fortryd', i, () => startFortryd.call(m, d, logId), o); },
    async opdater(d, mode, i) { return gennem(d, f(mode, 'laes'), 'opdater', i, () => startOpdater.call(m, d, mode), o); },
    async chat(d, besked, kontekst, i) { return gennem(d, f('chat', 'forbered'), 'chat', i, () => startChat.call(m, d, besked, kontekst), o); },
  };
  if (startAction) {
    vogtet.aktion = async (d, name, body, i) => {
      const verb = m.aktionVerber?.[name];
      if (!verb) return null; // an action the room does not name a verb for never runs
      return gennem(d, { ...f(aktionId(name, body), verb), ...(m.aktionTap?.includes(name) ? { tap: true as const } : {}) }, 'aktion', i, () => startAction.call(m, d, name, body), o);
    };
  }
  return vogtet;
}
