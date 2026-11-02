// KC-0126: when the journey is Done (spec §3) — one pure function that Start,
// KC-0130 (first Ret) and KC-0131 (the cold-start test) share.

export type RejseInput = {
  /** Real elements Nu shows (Start's own lines not counted). */
  nuElementer: number;
  /** Ret or Ikke relevant pressed on an element of Nu at least once. */
  rettet: boolean;
};

/** Done = Nu shows at least one real element and the user has pressed Ret or Ikke relevant once. */
export const erRejsenFaerdig = (i: RejseInput): boolean => i.nuElementer >= 1 && i.rettet;
