// The household roles and what each may do (KC-0116). One table; the policy
// layer (KC-0122), the kill switch (KC-0124), the data zones (synligFor) and the
// household's visibility matrix (KC-0154, src/hushold/rettigheder.ts) ask it.
// Gate G4 (spec §11) is answered: a child gets the same entry as an adult member
// (Henrik 2026-10-31). `se-husstand`: the household's shared things (the shared
// week, the things, who is in it); a guest sees only what is addressed to her.

export const ROLLER = ['ejer', 'medlem', 'barn', 'gaest'] as const;
export type Rolle = (typeof ROLLER)[number];

export const RETTIGHEDER = ['laese', 'handle', 'aendre-indstillinger', 'aendre-husstand', 'nodstop', 'genoptag', 'se-husstand'] as const;
export type Ret = (typeof RETTIGHEDER)[number];

/** Danish display names (UI copy). */
export const ROLLE_NAVN: Record<Rolle, string> = { ejer: 'ejer', medlem: 'medlem', barn: 'barn', gaest: 'gæst' };

const TABEL: Record<Rolle, readonly Ret[]> = {
  ejer: RETTIGHEDER,
  medlem: ['laese', 'handle', 'nodstop', 'se-husstand'],
  barn: ['laese', 'handle', 'nodstop', 'se-husstand'],
  gaest: ['laese'],
};

/** Whether `rolle` has `ret`. Unknown roles or rights are never allowed (fail-closed). */
export function kan(rolle: Rolle, ret: Ret): boolean {
  return Object.hasOwn(TABEL, rolle) && TABEL[rolle].includes(ret);
}

export const erRolle = (v: unknown): v is Rolle => typeof v === 'string' && (ROLLER as readonly string[]).includes(v);
