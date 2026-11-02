import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChatEntry, LogEntry, NewChatEntry, NewLogEntry, RumLager } from './types.ts';
import { skrivAtomisk } from './atomisk.ts';

const RUM_ID = /^[a-z0-9-]{1,40}$/;

async function laesLinjer<T>(fil: string): Promise<T[]> {
  let tekst: string;
  try {
    tekst = await readFile(fil, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return tekst
    .split('\n')
    .filter((linje) => linje.trim() !== '')
    .map((linje) => JSON.parse(linje) as T);
}

/** `opts.now` is the clock for default log/chat timestamps (the test world's own clock, KC-0068); default = the real time. */
export function createFileStore(rootDir: string, opts: { now?: () => Date } = {}): RumLager {
  const nu = opts.now ?? (() => new Date());
  const rumMappe = (rum: string): string => {
    if (!RUM_ID.test(rum)) throw new Error('ugyldigt rum-id');
    return join(rootDir, 'rum', rum);
  };
  const chatFil = (rum: string): string => join(rumMappe(rum), 'chat.jsonl');
  const logFil = (rum: string): string => join(rumMappe(rum), 'log.jsonl');
  const stateFil = (rum: string): string => join(rumMappe(rum), 'state.json');

  return {
    async readState<T>(rum: string): Promise<T | null> {
      try {
        return JSON.parse(await readFile(stateFil(rum), 'utf8')) as T;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
    async writeState<T>(rum: string, state: T): Promise<void> {
      await mkdir(rumMappe(rum), { recursive: true });
      await skrivAtomisk(stateFil(rum), JSON.stringify(state, null, 2));
    },
    async appendLog(rum: string, entry: NewLogEntry): Promise<LogEntry> {
      await mkdir(rumMappe(rum), { recursive: true });
      const gemt: LogEntry = { ...entry, id: entry.id ?? randomUUID(), tid: entry.tid ?? nu().toISOString(), zone: entry.zone ?? 'privat' };
      await appendFile(logFil(rum), `${JSON.stringify(gemt)}\n`, 'utf8');
      return gemt;
    },
    async readLog(rum: string, limit = 50): Promise<LogEntry[]> {
      const alle = await laesLinjer<LogEntry>(logFil(rum));
      return alle.reverse().slice(0, limit);
    },
    async appendChat(rum: string, entry: NewChatEntry): Promise<ChatEntry> {
      await mkdir(rumMappe(rum), { recursive: true });
      const gemt: ChatEntry = { ...entry, id: entry.id ?? randomUUID(), tid: entry.tid ?? nu().toISOString() };
      await appendFile(chatFil(rum), `${JSON.stringify(gemt)}\n`, 'utf8');
      return gemt;
    },
    async readChat(rum: string, limit = 50): Promise<ChatEntry[]> {
      const alle = await laesLinjer<ChatEntry>(chatFil(rum));
      return limit <= 0 ? [] : alle.slice(-limit);
    },
    async updateLog(rum: string, id: string, patch: Partial<Omit<LogEntry, 'id'>>): Promise<LogEntry | null> {
      const fil = logFil(rum);
      const alle = await laesLinjer<LogEntry>(fil);
      const i = alle.findIndex((e) => e.id === id);
      const gammel = alle[i];
      if (gammel === undefined) return null;
      // `id` er ikke en del af patch-typen, men en kalder kan alligevel sende den med.
      const { id: _ignoreret, ...ren } = patch as Partial<LogEntry>;
      const ny: LogEntry = { ...gammel, ...ren, id: gammel.id };
      alle[i] = ny;
      await skrivAtomisk(fil, alle.map((e) => `${JSON.stringify(e)}\n`).join(''));
      return ny;
    },
  };
}
