// Rum-lager: the per-room files (state, log, chat). Only the store touches
// the filesystem for room data.

export type Kilde = 'hermes' | 'henrik' | 'system';

export type LogEntry = {
  id: string;
  /** ISO timestamp. */
  tid: string;
  kilde: Kilde;
  tekst: string;
  /** The handling (from the room state) that produced this entry, if any. */
  handlingId?: string;
  /** Instruction Hermes runs to undo this entry; absent = cannot be undone. */
  fortryd?: string;
  /** ISO timestamp when the entry was undone. */
  fortrudt?: string;
  /** KC-0117: the data zone (src/identitet/zoner.ts DATAZONER; the store depends on nothing else, so the union is spelled out — zoner.ts checks they agree). appendLog always writes it; old lines read as privat. */
  zone?: 'privat' | 'arbejde' | 'husstand';
  /** KC-0117: whose entry (person id) for privat/arbejde; absent = the household's owner. */
  ejer?: string;
  /** KC-0122: a line the policy layer wrote: what Clawco did not do ('afvist') or waits for a yes on ('kraever-ja'). */
  graense?: 'afvist' | 'kraever-ja';
};

export type ChatEntry = {
  id: string;
  tid: string;
  fra: 'henrik' | 'hermes';
  tekst: string;
  /** The element the message was about ("Om: …"), if any. */
  kontekst?: string;
};

export type NewLogEntry = Omit<LogEntry, 'id' | 'tid'> & Partial<Pick<LogEntry, 'id' | 'tid'>>;
export type NewChatEntry = Omit<ChatEntry, 'id' | 'tid'> & Partial<Pick<ChatEntry, 'id' | 'tid'>>;

export interface RumLager {
  /** null when the room has no stored state yet. */
  readState<T>(rum: string): Promise<T | null>;
  /** Atomic write (tmp file + rename). */
  writeState<T>(rum: string, state: T): Promise<void>;
  /** Appends and returns the entry with id and tid filled in. */
  appendLog(rum: string, entry: NewLogEntry): Promise<LogEntry>;
  /** Newest first, at most `limit` (default 50). */
  readLog(rum: string, limit?: number): Promise<LogEntry[]>;
  /** Patches one entry by id; returns the updated entry or null if unknown. */
  updateLog(rum: string, id: string, patch: Partial<Omit<LogEntry, 'id'>>): Promise<LogEntry | null>;
  appendChat(rum: string, entry: NewChatEntry): Promise<ChatEntry>;
  /** Oldest first, the last `limit` entries (default 50). */
  readChat(rum: string, limit?: number): Promise<ChatEntry[]>;
}
