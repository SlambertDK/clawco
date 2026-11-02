// In-flight Hermes runs. The HTTP layer starts a run and returns its id at
// once; the browser subscribes to the run's events (SSE) and gets status
// lines while Hermes works, then a `done` event with whatever the handler
// produced (usually re-rendered HTML), or an `error` event.

import { randomUUID } from 'node:crypto';
import type { AgentClient, AgentEvent } from './agent/types.ts';
import { SvarFejl } from './svarfejl.ts';
import type { IgangRaekke } from './shell/sprog.ts';
import type { DataZone } from './identitet/zoner.ts';
import { omslutData } from './agent/prompt.ts';
import { STANDARD_VERB, VERB_NU, vaerktoejTilladt } from './graenser/opsyn.ts';
import { lavPause, PauseFejl, PAUSE_TEKST, type Pause, type PauseTilstand } from './graenser/nodstop.ts';
import type { Profil } from './store/profil.ts';
import { redigeres } from './graenser/redaktion.ts';

export type RunEvent =
  | { type: 'status'; text: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; html?: string; text?: string; venter?: Record<string, number>; hermesStatus?: string; url?: string; genindlaes?: true }
  | { type: 'error'; text: string };

/**
 * `url`: where the browser should go once the run is done (a new or archived univers). `genindlaes` (KC-0170): the
 * whole page changes (the screen's language), so the browser reloads instead of swapping the room.
 */
export type DoneResult = { html?: string; text?: string; venter?: Record<string, number>; hermesStatus?: string; url?: string; genindlaes?: true };

export type RunRecord = {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  room?: string;
  label?: string;
  /** KC-0064: true from creation until Hermes has answered (the room's I gang band reads it). */
  hosHermes?: boolean;
  error?: string;
  result?: DoneResult;
  startedAt: number;
  /** KC-0100: when the run left the queue and Hermes began (absent while it still waits for a slot). */
  begyndtAt?: number;
  finishedAt?: number;
  /** KC-0117: the run's data zone and whose it is; absent = the owner's privat (the Kø panel shows it only to the owner). */
  zone?: DataZone;
  ejer?: string;
  finished: Promise<RunRecord>;
};

/** KC-0023: said to Hermes on every run, whatever the room. Who Henrik's people are lives in his vault's
 * people register (personer) and Hermes' own memory, never in this code. */
export function omMennesker(personer?: string): string {
  const kilde = personer
    ? `Slå personen op i Henriks kartotek over mennesker i hans vault (${personer}: familie/, arbejde/, andre/ — én fil pr. person med relation, fødselsdag m.m.) og i din hukommelse. Kan du koble en e-mailadresse til en person derfra, så notér adressen under "Vigtige fakta" i personens fil, så du genkender den næste gang.`
    : 'Brug det du ved om Henrik og hans familie i din hukommelse.';
  return `Når du omtaler mennesker (fx hvem der har oprettet en aftale, en afsender eller en deltager), så sig navn og relation til Henrik — fx "<fornavn>, din kone", "<fornavn>, din datter" eller "dig selv" — og aldrig en e-mailadresse, medmindre Henrik beder om adressen. ${kilde} Kender du ikke personen, så sig navnet og at du ikke ved hvem det er.

Kalenderen er fælles for familien: en aftale tilhører den, der har oprettet den, eller den titlen nævner — ikke automatisk Henrik. To aftaler på samme tid er ikke en konflikt, hvis de tilhører hver sin person; kald det kun en konflikt, når samme person er dobbeltbooket, eller når Henrik selv skal noget i begge (fx køre, hente eller være hjemme).`;
}

/** KC-0126: the profile from Start's step 1, said to Hermes on every run — how to address the user and which language to answer in. */
export function omProfil(p: Profil | null): string {
  if (!p) return '';
  // KC-0170: the instructions above are Danish and say "Sprog: dansk"; the user's choice wins over that line.
  const sprog = p.sprog === 'en' ? 'Answer in English, even though these instructions are in Danish and say "Sprog: dansk".' : 'Svar på dansk.';
  return `Brugeren hedder ${p.navn}; tiltal brugeren sådan. ${sprog} Brugeren bor ${p.husstand === 'husstand' ? 'i en husstand med andre' : 'alene'}.`;
}

/** KC-0064: runs that are a chat answer, never shown as I gang. */
export const CHAT_KINDS: ReadonlySet<string> = new Set(['chat', 'univers']);

export type Tier = 'lille' | 'taenker';
export const TIER_KINDS: Record<Tier, string[]> = {
  lille: ['chat', 'handling', 'fortryd', 'kladde', 'baggrund', 'afmeld', 'laer'],
  taenker: ['opdater', 'frontload', 'forslag', 'nyt', 'analyse', 'kurator', 'univers', 'forbered'],
};
export function tierFor(kind: string): Tier { return TIER_KINDS.taenker.includes(kind) ? 'taenker' : 'lille'; }

type StartOpts = {
  kind: string;
  room?: string;
  label?: string;
  tier?: Tier;
  /** KC-0226: the one data zone this run reads (a Kuratoren run per zone); absent = privat, as before. It decides who sees the run in the Kø panel. */
  zone?: DataZone;
  spec: { input: string; instructions: string; sessionId?: string };
  /** Turns Hermes' final text into what the browser needs. May throw. */
  onDone: (output: string) => Promise<DoneResult>;
};

const KEEP_MS = 6 * 60 * 60 * 1000;
const RET_REGEL = 'Du retter nu et svar, du allerede har givet. Brug ingen værktøjer og gentag ingen handlinger: send kun hele svaret igen, rettet, i det format instruktionerne ovenfor beskriver.';
const RET_MAX = 40_000;

/**
 * KC-0123: the unusable answer was written from untrusted data and may echo an order, and the reason can quote it —
 * both go back as afledt blocks with a fresh boundary; `linje` names that boundary in the retry's instructions.
 */
function returInput(output: string, fejl: string, zone: DataZone): { input: string; linje: string | null } {
  const svar = output.length > RET_MAX ? `${output.slice(0, RET_MAX)}\n[… afkortet]` : output;
  return omslutData([
    { kilde: 'app', zone, tillid: 'betroet', tekst: 'Dit forrige svar kunne ikke bruges. Grunden og dit forrige svar står nedenfor som afledt data.' },
    { kilde: 'grund', zone, tillid: 'afledt', tekst: `Dit forrige svar kunne ikke bruges: ${fejl}` },
    { kilde: 'dit-svar', zone, tillid: 'afledt', tekst: `Dit forrige svar var:\n${svar}` },
  ]);
}
const TOOL_NAMES: Record<string, string> = {
  terminal: 'kører en kommando', read_file: 'læser en fil', write_file: 'skriver en fil', patch: 'retter en fil',
  web_search: 'søger på nettet', web_extract: 'læser en side', browser_navigate: 'åbner en side', search_files: 'søger i filer',
  delegate_task: 'sætter en hjælper i gang', todo: 'noterer', memory: 'husker',
};

function statusText(e: AgentEvent): string | undefined {
  if (e.type === 'tool.started') {
    const what = TOOL_NAMES[e.tool] ?? e.tool;
    return e.preview ? `${what}: ${e.preview.slice(0, 80)}` : what;
  }
  if (e.type === 'tool.completed') return e.error ? `${e.tool} fejlede, prøver videre` : 'tænker';
  return undefined;
}

/** What a run stopped by "Stop alt" ends with (KC-0124). */
const STOPPET = `Stoppet: ${PAUSE_TEKST}.`;

/**
 * `pause` (KC-0124): the kill switch's state; absent = in memory only (tests without a data dir). `personer`: the
 * people register's path, or (KC-0136) a function read when each run starts — the vault chosen on the notes card.
 */
export function createRunRegistry(hermes: AgentClient, opts: { maxParallel?: number; personer?: string | (() => string); now?: () => Date; pause?: Pause; profil?: () => Profil | null } = {}) {
  const nu = opts.now ?? (() => new Date()); // KC-0068: the test world runs on its own clock
  const maxParallel = Math.max(1, opts.maxParallel ?? 2);
  const mennesker = (): string => omMennesker((typeof opts.personer === 'function' ? opts.personer() : opts.personer) || undefined);
  const pause = opts.pause ?? lavPause();
  const runs = new Map<string, RunRecord & { events: RunEvent[]; listeners: Set<(e: RunEvent) => void> }>();
  const finishedListeners = new Set<(r: RunRecord) => void>();
  const waiting: { res: () => void; rej: (e: Error) => void }[] = [];
  /** KC-0124: every run not yet settled, with the function that stops it now (`grund`: the error it ends with; default the pause). */
  const aktive = new Map<string, (grund?: string) => void>();
  /** KC-0069: answers being written (onDone) and local runs mid-write: the test world's jump waits for these before it wipes (tomgang). */
  const skriver = new Set<Promise<unknown>>();
  function skrivning<T>(p: Promise<T>): Promise<T> {
    skriver.add(p);
    const fjern = (): void => { skriver.delete(p); };
    p.then(fjern, fjern);
    return p;
  }
  let inFlight = 0;
  let seq = 0;
  const order = new Map<string, number>();
  let models: Partial<Record<Tier, string>> = {};
  /** KC-0127: Hermes' provider id sent with a tier model (the provider chosen in Start); undefined = Hermes' own default. */
  let provider: string | undefined;

  function announce(rec: RunRecord): void {
    rec.finishedAt = nu().getTime();
    for (const l of finishedListeners) { try { l(rec); } catch { /* listener bug must not break the run */ } }
  }
  async function slot(): Promise<void> {
    if (inFlight < maxParallel) { inFlight++; return; }
    await new Promise<void>((res, rej) => waiting.push({ res, rej }));
    inFlight++;
  }
  function release(): void {
    inFlight--;
    const next = waiting.shift();
    if (next) next.res();
  }
  /**
   * KC-0125: the one door to the agent. A secret in a request (input, instructions) never reaches Hermes, and one in
   * the answer never reaches a room handler, the store or a log.
   */
  async function kaldAgent(req: Parameters<AgentClient['run']>[0]): ReturnType<AgentClient['run']> {
    const svar = await hermes.run({ ...req, input: redigeres(req.input), instructions: redigeres(req.instructions) });
    return { ...svar, output: redigeres(svar.output) };
  }
  function ikkePaaPause(): void { if (pause.erPaaPause()) throw new PauseFejl(); }

  function emit(id: string, e: RunEvent): void {
    const r = runs.get(id);
    if (!r) return;
    // KC-0125: nothing leaves a run with a secret in it (status lines, streamed text, errors).
    const maskeret: RunEvent = e.type === 'status' || e.type === 'delta' || e.type === 'error' ? { ...e, text: redigeres(e.text) } : e;
    r.events.push(maskeret);
    for (const l of r.listeners) { try { l(maskeret); } catch { /* listener bug must not kill the run */ } }
  }

  function start(o: StartOpts): RunRecord {
    ikkePaaPause();
    const id = `kc_${randomUUID()}`;
    let resolveFinished!: (r: RunRecord) => void;
    const finished = new Promise<RunRecord>((res) => { resolveFinished = res; });
    const rec: RunRecord & { events: RunEvent[]; listeners: Set<(e: RunEvent) => void> } = { id, kind: o.kind, status: 'queued', hosHermes: true, startedAt: nu().getTime(), finished, events: [], listeners: new Set() };
    if (o.room) rec.room = o.room;
    if (o.label) rec.label = o.label;
    if (o.zone) rec.zone = o.zone;
    runs.set(id, rec); order.set(id, ++seq);

    // KC-0124: settled once — by the run itself, or at once by "Stop alt" (the run's own ending is then dropped).
    let afgjort = false;
    const settle = (patch: Partial<RunRecord>, e: RunEvent): void => {
      if (afgjort) return;
      afgjort = true;
      aktive.delete(id);
      Object.assign(rec, patch, { hosHermes: false });
      setTimeout(() => { runs.delete(id); order.delete(id); }, KEEP_MS).unref();
      announce(rec);
      resolveFinished(rec);
      emit(id, e);
    };
    const stop = new AbortController();
    aktive.set(id, (grund = STOPPET) => { stop.abort(); settle({ status: 'failed', error: grund }, { type: 'error', text: grund }); });

    void (async () => {
      let fikPlads = false;
      try {
        await slot(); // rejected only by "Stop alt", which has already settled the run
        fikPlads = true;
        if (afgjort) return;
        rec.status = 'running';
        rec.begyndtAt = nu().getTime();
        // KC-0126: read synchronously, so a run reaches Hermes as soon as before; a profile that cannot be read is left out.
        const profilLinje = omProfil(opts.profil?.() ?? null);
        const spec: { input: string; instructions: string; sessionId?: string; model?: string; provider?: string } = { input: o.spec.input, instructions: `${o.spec.instructions}\n\n${mennesker()}${profilLinje ? `\n\n${profilLinje}` : ''}` };
        if (o.spec.sessionId) spec.sessionId = o.spec.sessionId;
        const model = models[o.tier ?? tierFor(o.kind)];
        if (model) { spec.model = model; if (provider) spec.provider = provider; }
        // KC-0122: the detective control — a tool past the handling's verb aborts the run with the reason.
        const verb = VERB_NU.getStore() ?? STANDARD_VERB;
        let stoppet = '';
        const onEvent = (e: AgentEvent): void => {
          if (e.type === 'tool.started' && !stoppet) {
            const v = vaerktoejTilladt(verb, e.tool, e.preview ?? '');
            if (!v.ok) { stoppet = v.hvorfor; console.warn(`[runs] ${o.kind}: ${v.hvorfor} (${e.tool})`); stop.abort(); }
          }
          if (e.type === 'message.delta') { emit(id, { type: 'delta', text: e.text }); return; }
          const text = statusText(e);
          if (text) emit(id, { type: 'status', text });
        };
        const { output } = await kaldAgent({ ...spec, onEvent, signal: stop.signal }).catch((err: unknown) => { throw stoppet ? new Error(stoppet) : err; });
        if (stoppet) throw new Error(stoppet);
        if (afgjort) return; // "Stop alt" came while Hermes answered: the answer is not applied
        rec.hosHermes = false;
        let result: DoneResult;
        try {
          result = await skrivning(o.onDone(output));
        } catch (err) {
          if (!(err instanceof SvarFejl)) throw err;
          // One correction, no tools: the answer goes back with the reason (KC-0050).
          console.warn(`[runs] ${o.kind}: svaret kunne ikke bruges (${err.message}), sendt tilbage til Hermes`);
          rec.hosHermes = true;
          emit(id, { type: 'status', text: 'retter sit svar' });
          // Its text is not streamed: the chat bubble keeps the first answer until `done` replaces it.
          const retur = returInput(output, err.message, rec.zone ?? 'privat');
          const instructions = [spec.instructions, RET_REGEL, retur.linje].filter((d): d is string => Boolean(d)).join('\n\n');
          const rettet = await kaldAgent({ ...spec, input: retur.input, instructions, onEvent: (e) => { if (e.type !== 'message.delta') onEvent(e); }, signal: stop.signal });
          if (stoppet) throw new Error(stoppet);
          if (afgjort) return;
          rec.hosHermes = false;
          result = await skrivning(o.onDone(rettet.output));
        }
        settle({ status: 'done', result }, { type: 'done', ...result });
      } catch (err) {
        const text = redigeres(err instanceof Error ? err.message : String(err));
        settle({ status: 'failed', error: text }, { type: 'error', text }); // a no-op after "Stop alt"
      } finally {
        if (fikPlads) release();
      }
    })();

    return rec;
  }

  /** Replays buffered events, then streams new ones. Returns an unsubscribe, or undefined for unknown ids. */
  function subscribe(id: string, listener: (e: RunEvent) => void): (() => void) | undefined {
    const r = runs.get(id);
    if (!r) return undefined;
    for (const e of r.events) listener(e);
    if (r.status !== 'running' && r.status !== 'queued') return () => {};
    r.listeners.add(listener);
    return () => { r.listeners.delete(listener); };
  }

  function get(id: string): RunRecord | undefined { return runs.get(id); }

  /** A run without Hermes: completes with fn()'s result, same events as a real run. */
  function local(kind: string, fn: () => Promise<DoneResult>, meta: { room?: string; label?: string } = {}): RunRecord {
    ikkePaaPause();
    const id = `kc_${randomUUID()}`;
    let resolveFinished!: (r: RunRecord) => void;
    const finished = new Promise<RunRecord>((res) => { resolveFinished = res; });
    const rec: RunRecord & { events: RunEvent[]; listeners: Set<(e: RunEvent) => void> } = { id, kind, status: 'running', startedAt: nu().getTime(), begyndtAt: nu().getTime(), finished, events: [], listeners: new Set() };
    if (meta.room) rec.room = meta.room;
    if (meta.label) rec.label = meta.label;
    runs.set(id, rec); order.set(id, ++seq);
    void (async () => {
      try {
        const result = await skrivning((async () => fn())());
        Object.assign(rec, { status: 'done', result });
        emit(id, { type: 'done', ...result });
      } catch (err) {
        const text = redigeres(err instanceof Error ? err.message : String(err));
        Object.assign(rec, { status: 'failed', error: text });
        emit(id, { type: 'error', text });
      } finally {
        setTimeout(() => runs.delete(id), KEEP_MS).unref();
        announce(rec);
        resolveFinished(rec);
      }
    })();
    return rec;
  }

  /** Newest first. */
  function list(): RunRecord[] {
    return [...runs.values()].sort((a, b) => (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0)).map(({ events: _e, listeners: _l, ...r }) => r);
  }

  function onFinished(listener: (r: RunRecord) => void): () => void {
    finishedListeners.add(listener);
    return () => { finishedListeners.delete(listener); };
  }

  /** KC-0064: the room's runs that are with Hermes right now, newest first (rum null = every room); chat answers excluded. */
  function igang(rum: string | null): IgangRaekke[] {
    return list()
      .filter((r) => r.hosHermes && r.room && !CHAT_KINDS.has(r.kind) && (rum === null || r.room === rum))
      .map((r) => ({ id: r.id, label: r.label ?? r.kind, status: r.status === 'queued' ? 'queued' as const : 'running' as const }));
  }

  function setModels(m: Partial<Record<Tier, string>>, p?: string): void { models = { ...m }; provider = p; }
  function getModels(): Partial<Record<Tier, string>> { return { ...models }; }

  /**
   * KC-0124 "Stop alt": pauses first (nothing new can start), then settles every queued and running agent run as
   * stopped and aborts the ones with Hermes. When it returns, nothing is queued or running and the pause is on disk.
   * Returns how many runs it stopped. A local run (no Hermes) already going finishes; no new one starts.
   */
  async function stopAlle(person: string): Promise<number> {
    const skrevet = pause.saet({ pause: true, tid: nu().toISOString(), person });
    const stop = [...aktive.values()];
    for (const s of stop) s();
    for (const w of waiting.splice(0)) w.rej(new PauseFejl());
    await skrevet;
    return stop.length;
  }
  /**
   * KC-0069: settles every queued and running agent run at once as failed with `grund` and aborts the ones with Hermes
   * (the test world's jump to another moment: the old moment's queue must not outlive it). Not the kill switch: nothing
   * is paused. A local run already going finishes. Returns how many runs it settled.
   */
  function annuller(grund: string): number {
    const stop = [...aktive.values()];
    for (const s of stop) s(grund);
    for (const w of waiting.splice(0)) w.rej(new Error(grund));
    return stop.length;
  }
  /** KC-0069: resolves when no answer is being written and no local run is mid-write (a write that throws counts as over). */
  async function tomgang(): Promise<void> {
    while (skriver.size) await Promise.allSettled([...skriver]);
  }
  /** KC-0124: lifts the pause (the caller checks the role: nodstop.ts startIgen). */
  async function genoptag(person: string): Promise<void> { await pause.saet({ pause: false, tid: nu().toISOString(), person }); }
  const paaPause = (): boolean => pause.erPaaPause();
  const pauseTilstand = (): PauseTilstand => pause.tilstand();
  /** Re-reads pause.json (the test world reseeds it on a jump). */
  const genlaesPause = (): Promise<void> => pause.genlaes();

  return { start, local, subscribe, get, list, igang, onFinished, setModels, getModels, stopAlle, annuller, tomgang, genoptag, paaPause, pauseTilstand, genlaesPause };
}

export type RunRegistry = ReturnType<typeof createRunRegistry>;

/** KC-0024: what Hermes hears when Henrik asks from the phone. */
export const PAA_TELEFONEN = 'Henrik er på telefonen (lille skærm, måske på farten, og svaret kan blive læst op): svar i højst 2–3 korte sætninger med det vigtigste først, uden lister, tabeller og overskrifter. Tilbyd at uddybe, hvis der er mere.';

/** The same registry, but every run started through it also carries the phone rule. */
export function fraTelefonen(runs: RunRegistry): RunRegistry {
  return { ...runs, start: (o) => runs.start({ ...o, spec: { ...o.spec, instructions: `${o.spec.instructions}\n\n${PAA_TELEFONEN}` } }) };
}
