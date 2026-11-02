// KC-0130: a RoomDeps for Start's room-level tests — a file store in a temp dir, a live bus, a run
// registry over the fake agent, a clock, an owner, and the window onto Nu (`rejse`) the test controls.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createLiveBus } from '../../src/live.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { createRunRegistry } from '../../src/runs.ts';
import { lavRetBus } from '../../src/rooms/rethaendelse.ts';
import { modtagRet } from '../../src/rooms/start/ret.ts';
import { parseStartState, type StartState } from '../../src/rooms/start/schema.ts';
import { startRoom } from '../../src/rooms/start/room.ts';
import type { RejseKilder, RoomDeps } from '../../src/rooms/module.ts';
import type { RegelSeam } from '../../src/rooms/start/regelforslag.ts';
import type { ImportSkriver } from '../../src/rooms/start/import/skriver.ts';
import type { AgentRunRequest } from '../../src/agent/types.ts';

export const STARTET = '2026-10-31T08:00:00.000Z';
export const NU = new Date('2026-10-31T09:00:00.000Z');
export const EJER = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' } as const;

export type Nu = { elementer: number; rettet: boolean; foersteKort: string | null };
export type Sut = {
  d: RoomDeps;
  nu: Nu;
  state(): Promise<StartState | null>;
  log(): Promise<string[]>;
  main(): Promise<string>;
  /** Runs a Start action and waits for its run to finish. */
  aktion(name: string, body?: Record<string, unknown>): Promise<void>;
};

export async function medStart(o: { state?: StartState | null; nu?: Partial<Nu>; regelforslag?: RegelSeam; person?: RoomDeps['person']; svar?: (req: AgentRunRequest) => string; importSkriver?: ImportSkriver; importTmp?: string; model?: RoomDeps['model'] }, fn: (s: Sut) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-start-sut-'));
  try {
    const store = createFileStore(dir);
    const start = o.state === undefined ? { startet: STARTET, trin: {}, afvist: {} } satisfies StartState : o.state;
    if (start) await store.writeState('start', start);
    const hermes = createFakeAgent({ answer: o.svar ?? (() => 'Hej.') });
    const nu: Nu = { elementer: 1, rettet: false, foersteKort: 'Elregningen', ...o.nu };
    const rejse: RejseKilder = {
      faerdigInput: async () => ({ nuElementer: nu.elementer, rettet: nu.rettet }),
      foersteKort: async () => (nu.foersteKort === null ? null : { titel: nu.foersteKort }),
      kilder: async () => [],
      mail: async () => [],
    };
    const retBus = lavRetBus();
    retBus.lyt(modtagRet);
    const d = { store, hermes, runs: createRunRegistry(hermes), live: createLiveBus(), now: () => NU, person: o.person ?? EJER, rejse, retBus, ...(o.regelforslag ? { regelforslag: o.regelforslag } : {}), ...(o.importSkriver ? { importSkriver: o.importSkriver } : {}), ...(o.importTmp ? { importTmp: o.importTmp } : {}), ...(o.model ? { model: o.model } : {}) } as unknown as RoomDeps;
    await fn({
      d, nu,
      state: async () => parseStartState(await store.readState('start')),
      log: async () => (await store.readLog('start', 50)).map((e) => e.tekst),
      main: async () => String((await startRoom.view(d)).main),
      aktion: async (name, body = {}) => {
        const run = await startRoom.startAction!(d, name, body);
        await run?.finished;
      },
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
