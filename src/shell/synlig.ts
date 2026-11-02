// KC-0052: which rooms are on screen. Only what is relevant now: Hjem, the room
// on screen, rooms where something new waits for Henrik, and rooms he opened
// today (Copenhagen day), and rooms the situation counts as relevant (KC-0114).
// Everything else he asks for in the chat. Start has its own rule (KC-0126). Pure.

import { SITUATIONER, type Situation } from '../situation/regler.ts';

export type SynligInput = {
  roomId: string;
  /** The fixed rooms, by id. */
  rum: readonly string[];
  /** Active universes, by slug (their room id is `univers-<slug>`). */
  univers: readonly string[];
  venter: Record<string, number>;
  /** When each room was last opened (ISO). */
  aabnet: Record<string, string>;
  now: Date;
  /** KC-0114: the situation now; its rooms count as relevant. */
  situation?: Situation;
  /** KC-0126: Start's own rule — whether the journey is Done, and how many sources are worth adding now. */
  start?: { faerdig: boolean; forslag: number };
  /** KC-0148: Husstanden's own rule — whether the household universe is there for the person looking (src/hushold/personer.ts maaSeHusstand). */
  husstand?: boolean;
};

/** KC-0148: the household universe, drawn under Univers; shown exactly when it exists for the person looking. */
export const HUSSTAND = 'husstand';

/** KC-0126: the onboarding room shows only while the journey is not Done, or when a source is worth adding (spec §3). */
export const START = 'start';

/** Rooms whose count is Henrik's own unfinished work (a proposal in Skrive, tasks in a univers), not something new for him: it never keeps them in the nav. */
export const EGET_ARBEJDE = (id: string): boolean => id === 'skrive' || id.startsWith('univers-');

/** KC-0079: what waits on Henrik in all, for the tab title and the app icon — own unfinished work not counted. */
export function antalVenter(venter: Record<string, number>): number {
  return Object.entries(venter).reduce((n, [id, k]) => (EGET_ARBEJDE(id) ? n : n + k), 0);
}

const dag = (d: Date): string => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

export function synligeRum(i: SynligInput): Set<string> {
  const idag = dag(i.now);
  const iDag = (iso: string | undefined): boolean => {
    if (!iso) return false;
    const d = new Date(iso);
    return !Number.isNaN(d.getTime()) && dag(d) === idag;
  };
  const situationens: readonly string[] = i.situation ? SITUATIONER[i.situation].rum : [];
  const startRelevant = (): boolean => i.roomId === START || (i.start !== undefined && (!i.start.faerdig || i.start.forslag > 0));
  const relevant = (id: string): boolean => id === HUSSTAND ? i.husstand === true : id === START ? startRelevant() : id === 'hjem' || id === i.roomId || situationens.includes(id) || (!EGET_ARBEJDE(id) && (i.venter[id] ?? 0) > 0) || iDag(i.aabnet[id]);
  const ud = new Set(i.rum.filter(relevant));
  for (const u of i.univers) if (relevant(`univers-${u}`)) ud.add(`univers-${u}`).add('univers');
  if (ud.has(HUSSTAND)) ud.add('univers');
  return ud;
}
