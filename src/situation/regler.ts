// KC-0114: what each situation puts first. One row per situation; adding one
// (training, travel) is one row here. Pure data, no room imported.
//   elementer — the optional kinds Nu shows (KC-0115); Kræver dig is not in the
//               list because a decision always shows, whatever the situation
//   rum       — rooms that count as relevant in this situation (feeds shell/synlig.ts)
//   stemme    — the order the voice's spoken overview goes through the rooms

/** Nu's optional kinds: the next appointment, the meeting on now, the I gang and Ordnet bands, the room tiles. */
export const NU_ELEMENTER = ['naeste', 'moede', 'igang', 'ordnet', 'fliser'] as const;
export type NuElement = (typeof NU_ELEMENTER)[number];

export type SituationRegel = { elementer: readonly NuElement[]; rum: readonly string[]; stemme: readonly string[] };

export const SITUATIONER = {
  morgen: { elementer: ['naeste', 'igang', 'ordnet', 'fliser'], rum: ['dagen'], stemme: ['dagen', 'mail', 'nyheder', 'skrive', 'univers'] },
  dagen: { elementer: ['naeste', 'igang', 'ordnet', 'fliser'], rum: [], stemme: ['mail', 'dagen', 'nyheder', 'skrive', 'univers'] },
  moede: { elementer: ['moede', 'igang'], rum: [], stemme: ['univers', 'mail', 'dagen', 'nyheder', 'skrive'] },
  aften: { elementer: ['naeste', 'igang', 'ordnet'], rum: [], stemme: ['mail', 'skrive', 'dagen', 'nyheder', 'univers'] },
} as const satisfies Record<string, SituationRegel>;

export type Situation = keyof typeof SITUATIONER;

export const SITUATION_IDER = Object.keys(SITUATIONER) as Situation[];
