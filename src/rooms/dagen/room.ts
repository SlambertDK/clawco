// The room Dagen, wired: view, refresh, handlinger, fortryd and chat. Every
// Hermes round-trip is a run in the registry; each onDone validates Hermes'
// answer, writes to the rum-lager and returns the re-rendered room.

import type { LogEntry } from '../../store/types.ts';
import type { RunRecord, DoneResult } from '../../runs.ts';
import type { RoomDeps, RoomModule, RoomView } from '../module.ts';
import { extractJson, handlingensVerb, handlingerI, KORSEL, kraevJson, parseDagenState, synligDagen, venterDagen, type DagenState } from './schema.ts';
import { synligFor, type DataZone } from '../../identitet/zoner.ts';
import { dagFraUge, readDagenSource } from './source.ts';
import { trimUge } from './uge.ts';
import { buildChatRun, buildFortrydRun, buildHandlingRun, buildHentRun, buildRefreshRun } from './prompt.ts';
import { renderDagen, renderDagenEmpty } from './render.ts';
import { dagenTekst, ventendeLinjer } from './tekster.ts';
import { tekst } from '../../shell/tekster.ts';
import { stemmeDagen } from './stemme.ts';
import { naesteAftale } from './naeste.ts';

export const RUM = 'dagen';

type DagenDeps = RoomDeps;

async function current(deps: DagenDeps): Promise<{ state: DagenState | null; log: LogEntry[] }> {
  const [state, log] = await Promise.all([deps.store.readState<DagenState>(RUM), deps.store.readLog(RUM)]);
  return { state, log };
}

/** KC-0117: what the person looking may see — the only thing shown, counted, spoken or acted on (writes go on the full `current`). */
async function synlig(deps: DagenDeps): Promise<{ state: DagenState | null; log: LogEntry[] }> {
  const { state, log } = await current(deps);
  return { state: state ? synligDagen(state, deps.person) : null, log: log.filter((e) => synligFor(deps.person, e)) };
}

async function rendered(deps: DagenDeps, extra: Partial<DoneResult> = {}): Promise<DoneResult> {
  deps.live.notify(RUM);
  const { state, log } = await synlig(deps);
  const html = state ? String(renderDagen(state, log, deps.now(), deps.runs.igang(RUM), await deps.kildeFriskhed?.('kalender'))) : String(renderDagenEmpty(dagenTekst().ingenDataIDagEndnu));
  return { html, venter: { [RUM]: venterDagen(state, log, deps.now()) }, hermesStatus: state?.hermesStatus ?? tekst().klar, ...extra };
}

export async function viewDagen(deps: DagenDeps): Promise<RoomView> {
  const { state, log } = await synlig(deps);
  const main = state ? renderDagen(state, log, deps.now(), deps.runs.igang(RUM), await deps.kildeFriskhed?.('kalender')) : renderDagenEmpty(dagenTekst().ingenDataIDagEndnu);
  return { main, hermesStatus: state?.hermesStatus ?? tekst().klar };
}

export async function startOpdater(deps: DagenDeps, mode: string): Promise<RunRecord | null> {
  if (mode !== 'opdater' && mode !== 'hent') return null;
  const now = deps.now();
  let spec;
  if (mode === 'hent') {
    spec = buildHentRun(now);
  } else {
    // KC-0133: the week from the connected calendar source. Without a morning paper, a calendar the user connected
    // builds the day; the host's own (Kira's) install still asks Hermes to fetch the paper, as before.
    const kal = deps.ugeKalender ? await deps.ugeKalender() : null;
    const data = (await readDagenSource(deps.dagenSourceGlob, now)) ?? (kal && !kal.fraVaerten ? dagFraUge(kal.uge, now) : null);
    spec = data ? buildRefreshRun(data, now, kal ? trimUge(kal.uge) : null) : buildHentRun(now);
  }
  return deps.runs.start({
    kind: 'opdater',
    spec,
    onDone: async (output) => {
      const raw = kraevJson(output);
      const state = parseDagenState(raw, deps.now());
      await deps.store.writeState(RUM, state);
      await deps.store.appendLog(RUM, { kilde: 'hermes', tekst: `Hermes byggede Dagen (${state.kalender.length} aftaler, ${state.morgenavis.length} nyheder).` });
      return rendered(deps);
    },
  });
}

export async function startHandling(deps: DagenDeps, id: string): Promise<RunRecord | null> {
  const { state } = await synlig(deps);
  if (!state) return null;
  const h = handlingerI(state).get(id);
  if (!h) return null;
  return deps.runs.start({
    kind: 'handling',
    spec: buildHandlingRun(h, state),
    onDone: async (output) => {
      const tekst = output.trim().slice(0, 600) || `${h.label}: gjort.`;
      const entry = h.fortryd ? { kilde: 'hermes' as const, tekst, handlingId: h.id, fortryd: h.fortryd } : { kilde: 'hermes' as const, tekst, handlingId: h.id };
      await deps.store.appendLog(RUM, entry);
      return rendered(deps, { text: tekst });
    },
  });
}

export async function startFortryd(deps: DagenDeps, logId: string): Promise<RunRecord | null> {
  const { state, log } = await synlig(deps);
  const entry = log.find((e) => e.id === logId);
  if (!entry || !entry.fortryd || entry.fortrudt || !state) return null;
  const fortryd = entry.fortryd;
  return deps.runs.start({
    kind: 'fortryd',
    spec: buildFortrydRun(fortryd, state),
    onDone: async (output) => {
      await deps.store.updateLog(RUM, logId, { fortrudt: deps.now().toISOString() });
      await deps.store.appendLog(RUM, { kilde: 'hermes', tekst: output.trim().slice(0, 600) || 'Fortrudt.' });
      return rendered(deps, { text: output.trim() });
    },
  });
}

/**
 * The chat's `opdater` merged into the room: the person's view is the base (so Hermes' edit is validated against what it saw),
 * then the posts that person may not see are put back unchanged — with their stored zone and ejer, which Hermes never wrote.
 */
function flet(fuld: DagenState, synligt: DagenState, opdater: Record<string, unknown>, deps: DagenDeps): DagenState {
  const merged = parseDagenState({ ...synligt, ...opdater }, deps.now());
  // A list the update did not name is the stored one, untouched (parsing would drop each post's ejer).
  merged.kalender = [...('kalender' in opdater ? merged.kalender : synligt.kalender), ...skjulte(fuld.kalender, deps.person)];
  merged.morgenavis = [...('morgenavis' in opdater ? merged.morgenavis : synligt.morgenavis), ...skjulte(fuld.morgenavis, deps.person)];
  return merged;
}

const JSON_BLOCK = /```(?:json)?\s*[\s\S]*?```/i;

/** The stored posts the person may not see: a chat update built from their view must never drop or rewrite them. */
function skjulte<T extends { zone?: DataZone; ejer?: string }>(fuld: T[], person: RoomDeps['person']): T[] {
  return fuld.filter((x) => !synligFor(person, x));
}

export async function startChat(deps: DagenDeps, besked: string, kontekst: string | undefined): Promise<RunRecord> {
  const { state: fuld } = await current(deps);
  const { state } = await synlig(deps);
  await deps.store.appendChat(RUM, kontekst ? { fra: 'henrik', tekst: besked, kontekst } : { fra: 'henrik', tekst: besked });
  return deps.runs.start({
    kind: 'chat',
    spec: buildChatRun(besked, kontekst, state),
    onDone: async (output) => {
      const raw = extractJson(output);
      const opdater = raw && typeof raw === 'object' && 'opdater' in raw ? (raw as { opdater: unknown }).opdater : null;
      // Validated before anything is written, so an unusable answer can go back to Hermes (KC-0050).
      const merged = opdater && typeof opdater === 'object' && state && fuld ? flet(fuld, state, opdater as Record<string, unknown>, deps) : null;
      const text = output.replace(JSON_BLOCK, '').trim() || '(intet svar)';
      await deps.store.appendChat(RUM, { fra: 'hermes', tekst: text });
      if (merged) {
        await deps.store.writeState(RUM, merged);
        await deps.store.appendLog(RUM, { kilde: 'hermes', tekst: 'Opdaterede rummet fra chatten.' });
        return rendered(deps, { text });
      }
      return { text };
    },
  });
}

async function hjemVenter(deps: DagenDeps): Promise<{ roomId: string; tekst: string }[]> {
  const { state, log } = await synlig(deps);
  return ventendeLinjer(state, log, deps.now()).map((tekst) => ({ roomId: RUM, tekst }));
}

export const dagenRoom: RoomModule = {
  id: RUM,
  korsel: KORSEL,
  async handlingVerb(deps, id) {
    const { state } = await synlig(deps);
    const h = state ? handlingerI(state).get(id) : undefined;
    return h ? { verb: handlingensVerb(h), zoner: [KORSEL] } : null;
  },
  view: viewDagen,
  startOpdater,
  startHandling,
  startFortryd,
  startChat,
  venter: async (deps) => { const { state, log } = await synlig(deps); return venterDagen(state, log, deps.now()); },
  hjemVenter,
  naeste: async (deps) => { const { state } = await synlig(deps); return state ? naesteAftale(state, deps.now()) : null; },
  stemme: async (deps) => { const { state, log } = await synlig(deps); return stemmeDagen(state, log); },
};
