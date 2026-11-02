// KC-0170 (slice 3, rooms): the harness the rooms' action tests share. A room is run in a temp data dir with a scripted
// Hermes; an action is run in a language (or none) and what the person would read is returned: the toast text of a
// refusal or a finished run, the log lines the run wrote, the status line.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ENEBRUGER } from '../../src/identitet/identitet.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import type { AgentRunRequest } from '../../src/agent/types.ts';
import { createRunRegistry } from '../../src/runs.ts';
import { createLiveBus } from '../../src/live.ts';
import { ActionError, type RoomDeps, type RoomModule } from '../../src/rooms/module.ts';
import type { RunRecord } from '../../src/runs.ts';
import type { RumLager } from '../../src/store/types.ts';
import { medSprog } from '../../src/store/sprog.ts';
import type { Sprog } from '../../src/store/profil.ts';

export type Verden = { deps: RoomDeps; store: RumLager; dir: string; ryd: () => Promise<void>; kald: (hermes: string[]) => AgentRunRequest[] };

/** A room's world: temp data dir, scripted Hermes (the answers in order; the last one repeats), a fixed clock. */
export async function lavVerden(opts: { svar?: string[]; now?: Date; vault?: boolean; mail?: RoomDeps['mailRunner']; kalenderScript?: string } = {}): Promise<Verden> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-sprog-handling-'));
  const store = createFileStore(path.join(dir, 'data'));
  const svar = opts.svar ?? ['Fake svar'];
  let i = 0;
  const hermes = createFakeAgent({ answer: () => svar[Math.min(i++, svar.length - 1)]! });
  const now = opts.now ?? new Date('2026-10-27T10:00:00Z');
  const deps: RoomDeps = {
    store, hermes, runs: createRunRegistry(hermes), now: () => now, dagenSourceGlob: '', mailStateDir: '',
    mailRunner: opts.mail ?? (async () => ({ code: 0, stdout: '[]', stderr: '' })),
    himalaya: 'himalaya', vaultInbox: opts.vault ? path.join(dir, 'vault') : '', vaultRod: '', regnskabsfil: () => '', live: createLiveBus(), kalenderScript: opts.kalenderScript ?? '', person: ENEBRUGER,
  };
  return { deps, store, dir, ryd: () => rm(dir, { recursive: true, force: true }), kald: () => (hermes as unknown as { calls: AgentRunRequest[] }).calls };
}

/** Runs `fn` in the language (undefined = none chosen, the Danish of an installation without a profile). */
export const iSprog = <T>(sprog: Sprog | undefined, fn: () => T): T => (sprog ? medSprog(sprog, fn) : fn());

/** What the person reads of one action: a refusal (ActionError message), or the finished run's text / error. */
export async function laes(sprog: Sprog | undefined, start: () => Promise<RunRecord | null>): Promise<string> {
  return iSprog(sprog, async () => {
    try {
      const run = await start();
      if (!run) return '(null)';
      const r = await run.finished;
      return r.status === 'done' ? `ok: ${r.result?.text ?? ''}` : `fejl: ${r.error ?? ''}`;
    } catch (e) {
      if (e instanceof ActionError) return `afvist ${e.status}: ${e.message}`;
      throw e;
    }
  });
}

/** The action of a room, as the server calls it. */
export const aktion = (rum: RoomModule, v: Verden, navn: string, body: Record<string, unknown>) => (): Promise<RunRecord | null> => rum.startAction!(v.deps, navn, body);

/** The newest log line's text. */
export const nyesteLog = async (v: Verden, rum: string): Promise<string> => (await v.store.readLog(rum, 1))[0]?.tekst ?? '(ingen)';
