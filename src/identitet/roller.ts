// The household roles and what each may do (KC-0116). One table; the policy
// layer (KC-0122) and the kill switch (KC-0124) ask it. Gate G4 (spec §11) is
// answered: a child gets the same entry as an adult member (Henrik 2026-10-31).

export const ROLLER = ['ejer', 'medlem', 'barn', 'gaest'] as const;
export type Rolle = (typeof ROLLER)[number];

export const RETTIGHEDER = ['laese', 'handle', 'aendre-indstillinger', 'aendre-husstand', 'nodstop', 'genoptag'] as const;
export type Ret = (typeof RETTIGHEDER)[number];

/** Danish display names (UI copy). */
export const ROLLE_NAVN: Record<Rolle, string> = { ejer: 'ejer', medlem: 'medlem', barn: 'barn', gaest: 'gæst' };

const TABEL: Record<Rolle, readonly Ret[]> = {
  ejer: RETTIGHEDER,
  medlem: ['laese', 'handle', 'nodstop'],
  barn: ['laese', 'handle', 'nodstop'],
  gaest: ['laese'],
};

/** Whether `rolle` has `ret`. Unknown roles or rights are never allowed (fail-closed). */
export function kan(rolle: Rolle, ret: Ret): boolean {
  return Object.hasOwn(TABEL, rolle) && TABEL[rolle].includes(ret);
}

export const erRolle = (v: unknown): v is Rolle => typeof v === 'string' && (ROLLER as readonly string[]).includes(v);
