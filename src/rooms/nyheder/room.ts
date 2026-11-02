// The room Nyheder, wired.

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LogEntry } from '../../store/types.ts';
import type { RunRecord, DoneResult } from '../../runs.ts';
import { synligFor, zoneAf } from '../../identitet/zoner.ts';
import type { Person } from '../../identitet/husstand.ts';
import { ActionError, type RoomDeps, type RoomModule, type RoomView } from '../module.ts';
import { handlingensVerb, kraevJson } from '../dagen/schema.ts';
import { alleNyheder, handlingerINyheder, KORSEL, parseNyhederState, type NyhederState } from './schema.ts';
import { flettNyheder, readNyhederSource, readNyhedsbreve, type TrimmedNyheder } from './source.ts';
import { buildNyhederChatRun, buildNyhederFortrydRun, buildNyhederHandlingRun, buildNyhederHentRun, buildNyhederRefreshRun } from './prompt.ts';
import { renderNyheder, renderNyhederEmpty } from './render.ts';
import { NYHEDER_TEKSTER, nyhederStatus, nyhederTekst } from './tekster.ts';
import { tekst } from '../../shell/tekster.ts';
import { stemmeNyheder } from './stemme.ts';

export const RUM = 'nyheder';
/** The Read-later note's file names, one per language (a note made in the other language is still found and used). */
const LAES_SENERE_NAVNE: readonly string[] = [NYHEDER_TEKSTER.da.laesSenereFil, NYHEDER_TEKSTER.en.laesSenereFil];
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * KC-0117: what `person` may see of the room. Items `synligFor` denies are dropped (a lane left empty goes with them).
 * The five lines and the suggestions are written by Hermes about ALL items, so they are withheld once any item is hidden.
 */
export function synligNyheder(state: NyhederState, person: Person): NyhederState {
  let skjult = false;
  const baner = state.baner
    .map((b) => ({ ...b, nyheder: b.nyheder.filter((n) => { const ok = synligFor(person, n); if (!ok) skjult = true; return ok; }) }))
    .filter((b) => b.nyheder.length);
  const synlige = new Set(baner.flatMap((b) => b.nyheder.map((n) => n.id)));
  return { ...state, baner, gemt: state.gemt.filter((id) => synlige.has(id)), ...(skjult ? { femLinjer: [], forslag: [] } : {}) };
}

export const synligNyhederLog = (log: LogEntry[], person: Person): LogEntry[] => log.filter((e) => synligFor(person, e));

/** The state and log as `deps.person` may see them; the stored files stay whole. */
async function current(deps: RoomDeps): Promise<{ state: NyhederState | null; log: LogEntry[] }> {
  const [state, log] = await Promise.all([deps.store.readState<NyhederState>(RUM), deps.store.readLog(RUM)]);
  return { state: state ? synligNyheder(state, deps.person) : null, log: synligNyhederLog(log, deps.person) };
}

/** The whole stored state, for writes: a write must never persist the person-filtered copy. */
const helState = (deps: RoomDeps): Promise<NyhederState | null> => deps.store.readState<NyhederState>(RUM);

function venterNyheder(state: NyhederState | null, log: LogEntry[]): number {
  if (!state) return 0;
  const done = new Set(log.filter((e) => e.handlingId && !e.fortrudt).map((e) => e.handlingId));
  let n = 0;
  for (const id of handlingerINyheder(state).keys()) if (!done.has(id)) n++;
  return n;
}

async function rendered(deps: RoomDeps, extra: Partial<DoneResult> = {}): Promise<DoneResult> {
  deps.live.notify(RUM);
  const { state, log } = await current(deps);
  const html = state ? String(renderNyheder(state, log, deps.now(), deps.runs.igang(RUM))) : String(renderNyhederEmpty(nyhederTekst().ingenAvis));
  const n = venterNyheder(state, log);
  return { html, venter: n ? { [RUM]: n } : {}, hermesStatus: state ? nyhederStatus(state.hermesStatus) : tekst().klar, ...extra };
}

async function view(deps: RoomDeps): Promise<RoomView> {
  const { state, log } = await current(deps);
  return { main: state ? renderNyheder(state, log, deps.now(), deps.runs.igang(RUM)) : renderNyhederEmpty(nyhederTekst().ingenAvis), hermesStatus: state ? nyhederStatus(state.hermesStatus) : tekst().klar };
}

/** The morning paper and the user's own feeds (KC-0137) as one TrimmedNyheder; null = neither is there. */
async function laesAvis(deps: RoomDeps, now: Date): Promise<TrimmedNyheder | null> {
  const [papir, rss] = await Promise.all([readNyhederSource(deps.dagenSourceGlob, now), deps.rssNyheder ? deps.rssNyheder() : Promise.resolve(null)]);
  return flettNyheder(papir, rss, now);
}

async function startOpdater(deps: RoomDeps, mode: string): Promise<RunRecord | null> {
  if (mode !== 'opdater' && mode !== 'hent') return null;
  const now = deps.now();
  const papir = mode === 'hent' ? null : await readNyhederSource(deps.dagenSourceGlob, now);
  const rss = mode === 'hent' || !deps.rssNyheder ? null : await deps.rssNyheder();
  const data = mode === 'hent' ? null : flettNyheder(papir, rss, now);
  // KC-0137: only the user's own feeds, and none of them gave anything: nothing to build from, and not the paper's fetch either.
  if (data && !papir && data.nyheder.length === 0) return null;
  const spec = data ? buildNyhederRefreshRun(data, now) : buildNyhederHentRun(now);
  return deps.runs.start({
    kind: 'opdater',
    spec,
    onDone: async (output) => {
      const raw = kraevJson(output);
      const [{ state: previous }, nyhedsbreve, fresh] = await Promise.all([
        helState(deps).then((state) => ({ state })),
        readNyhedsbreve(deps.mailRunner, deps.himalaya, deps.now()),
        data ? Promise.resolve(data) : laesAvis(deps, deps.now()),
      ]);
      const kilder = fresh?.kilder ?? { antal: 0, medNyheder: 0, nyheder: 0, fejlede: [] };
      const state = parseNyhederState(raw, { nyhedsbreve, kilder }, deps.now(), previous);
      await deps.store.writeState(RUM, state);
      await deps.store.appendLog(RUM, { kilde: 'hermes', zone: KORSEL, tekst: nyhederTekst().logUdvalgte(state.baner.reduce((n, b) => n + b.nyheder.length, 0), state.baner.length, kilder.nyheder, kilder.medNyheder) });
      return rendered(deps);
    },
  });
}

async function startHandling(deps: RoomDeps, id: string): Promise<RunRecord | null> {
  const { state } = await current(deps);
  if (!state) return null;
  const h = handlingerINyheder(state).get(id);
  if (!h) return null;
  return deps.runs.start({
    kind: 'handling',
    spec: buildNyhederHandlingRun(h.label, h.instruktion, state, handlingensVerb(h)),
    onDone: async (output) => {
      const tekst = output.trim().slice(0, 600) || nyhederTekst().gjort(h.label);
      await deps.store.appendLog(RUM, h.fortryd ? { kilde: 'hermes', tekst, handlingId: h.id, fortryd: h.fortryd } : { kilde: 'hermes', tekst, handlingId: h.id });
      return rendered(deps, { text: tekst });
    },
  });
}

/** The Read-later note of the inbox: the one that exists (either language's name), else the current language's. */
async function laesSenereFil(inbox: string): Promise<string> {
  const kandidater = [nyhederTekst().laesSenereFil, ...LAES_SENERE_NAVNE].map((n) => path.join(inbox, n));
  for (const k of kandidater) if (await readFile(k, 'utf8').then(() => true, () => false)) return k;
  return kandidater[0]!;
}

async function startAction(deps: RoomDeps, name: string, body: Record<string, unknown>): Promise<RunRecord | null> {
  if (name !== 'gem') return null;
  const nyhedId = str(body['nyhedId'], 20);
  if (!deps.vaultInbox) throw new ActionError(nyhederTekst().fejlIngenMappe);
  const state = await helState(deps);
  const n = state ? alleNyheder(synligNyheder(state, deps.person)).get(nyhedId) : undefined;
  if (!state || !n) throw new ActionError(nyhederTekst().fejlNyhedFindesIkke);
  return deps.runs.local('gem', async () => {
    const T = nyhederTekst();
    const linje = `- ${n.url ? `[${n.titel}](${n.url})` : n.titel} — ${n.hvorfor} (${n.kilde ?? T.ukendtKilde}, ${state.dato})`;
    await mkdir(deps.vaultInbox, { recursive: true });
    const fil = await laesSenereFil(deps.vaultInbox);
    const findes = await readFile(fil, 'utf8').catch(() => null);
    if (findes === null) await writeFile(fil, `# ${T.laesSenereTitel}\n\n${linje}\n`, 'utf8');
    else await appendFile(fil, (findes.endsWith('\n') ? '' : '\n') + linje + '\n', 'utf8');
    if (!state.gemt.includes(nyhedId)) state.gemt.push(nyhedId);
    await deps.store.writeState(RUM, state);
    await deps.store.appendLog(RUM, { kilde: 'henrik', zone: zoneAf(n), tekst: nyhederTekst().logGemte(n.titel), handlingId: `gem-${nyhedId}`, fortryd: `lokal:${JSON.stringify({ nyhedId, linje, fil })}` });
    return rendered(deps, { text: T.gemtTilSenere });
  });
}

async function startFortryd(deps: RoomDeps, logId: string): Promise<RunRecord | null> {
  const [state, log] = await Promise.all([helState(deps), deps.store.readLog(RUM).then((l) => synligNyhederLog(l, deps.person))]);
  const entry = log.find((e) => e.id === logId);
  if (!entry || !entry.fortryd || entry.fortrudt) return null;
  if (entry.fortryd.startsWith('lokal:')) {
    // KC-0213: the file the save wrote (absolute), so a vault changed since still finds it; an older entry has none.
    const spec = JSON.parse(entry.fortryd.slice(6)) as { nyhedId: string; linje: string; fil?: string };
    return deps.runs.local('fortryd', async () => {
      const fil = spec.fil && path.isAbsolute(spec.fil) && LAES_SENERE_NAVNE.includes(path.basename(spec.fil)) ? spec.fil : await laesSenereFil(deps.vaultInbox);
      const text = await readFile(fil, 'utf8').catch(() => null);
      if (text !== null && text.includes(spec.linje + '\n')) await writeFile(fil, text.replace(spec.linje + '\n', ''), 'utf8');
      if (state) { state.gemt = state.gemt.filter((id) => id !== spec.nyhedId); await deps.store.writeState(RUM, state); }
      await deps.store.updateLog(RUM, logId, { fortrudt: deps.now().toISOString() });
      await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: nyhederTekst().logFjernede });
      return rendered(deps, { text: nyhederTekst().fjernetFraLaesSenere });
    });
  }
  const fortryd = entry.fortryd;
  return deps.runs.start({
    kind: 'fortryd',
    spec: buildNyhederFortrydRun(fortryd),
    onDone: async (output) => {
      await deps.store.updateLog(RUM, logId, { fortrudt: deps.now().toISOString() });
      await deps.store.appendLog(RUM, { kilde: 'hermes', tekst: output.trim().slice(0, 600) || nyhederTekst().fortrudt });
      return rendered(deps, { text: output.trim() });
    },
  });
}

async function startChat(deps: RoomDeps, besked: string, kontekst: string | undefined): Promise<RunRecord> {
  const { state } = await current(deps);
  await deps.store.appendChat(RUM, kontekst ? { fra: 'henrik', tekst: besked, kontekst } : { fra: 'henrik', tekst: besked });
  return deps.runs.start({
    kind: 'chat',
    spec: buildNyhederChatRun(besked, kontekst, state),
    onDone: async (output) => {
      const text = output.replace(/```(?:json)?\s*[\s\S]*?```/i, '').trim() || nyhederTekst().intetSvar;
      await deps.store.appendChat(RUM, { fra: 'hermes', tekst: text });
      return { text };
    },
  });
}

export const nyhederRoom: RoomModule = {
  id: RUM,
  korsel: KORSEL,
  aktionVerber: { gem: 'bogfoer' },
  async handlingVerb(deps, id) {
    const { state } = await current(deps);
    const h = state ? handlingerINyheder(state).get(id) : undefined;
    return h ? { verb: handlingensVerb(h), zoner: [KORSEL] } : null;
  },
  view,
  startOpdater,
  startHandling,
  startFortryd,
  startChat,
  startAction,
  stemme: async (deps) => { const { state, log } = await current(deps); return stemmeNyheder(state, log); },
  venter: async (deps) => { const { state, log } = await current(deps); return venterNyheder(state, log); },
  hjemVenter: async (deps) => {
    const { state, log } = await current(deps);
    if (!state) return [];
    const done = new Set(log.filter((e) => e.handlingId && !e.fortrudt).map((e) => e.handlingId));
    return state.forslag.filter((f) => f.handling && !done.has(f.handling.id)).map((f) => ({ roomId: RUM, tekst: nyhederTekst().nuForslag(f.tekst) }));
  },
};
