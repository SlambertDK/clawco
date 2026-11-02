// The household roles and what each may do (KC-0116). One table; the policy
// layer (KC-0122), the kill switch (KC-0124), the data zones (synligFor) and the
// household's visibility matrix (KC-0154, src/hushold/rettigheder.ts) ask it.
// Gate G4 (spec §11) is answered: a child gets the same entry as an adult member
// (Henrik 2026-10-31). `se-husstand`: the household's shared things (the shared
// week, the things, who is in it); a guest sees only what is addressed to her.

// KC-0188: `stoette` is Clawco support looking along under the owner's time-boxed grant (src/identitet/stoette.ts). It
// is not a household role: never in ROLLER (so never in husstand.json, an invitation or a role change), only ever made
// from the Sky gateway's support claim; it reads (laese, se-husstand) and nothing else, so the policy layer refuses it
// every verb but `laes` and the household rules every handling.

/** The household's roles: what husstand.json, an invitation and a role change may hold. */
export const ROLLER = ['ejer', 'medlem', 'barn', 'gaest'] as const;
export type HusRolle = (typeof ROLLER)[number];
export type Rolle = HusRolle | 'stoette';

export const RETTIGHEDER = ['laese', 'handle', 'aendre-indstillinger', 'aendre-husstand', 'nodstop', 'genoptag', 'se-husstand'] as const;
export type Ret = (typeof RETTIGHEDER)[number];

/** Danish display names (UI copy). */
export const ROLLE_NAVN: Record<Rolle, string> = { ejer: 'ejer', medlem: 'medlem', barn: 'barn', gaest: 'gæst', stoette: 'support' };

const TABEL: Record<Rolle, readonly Ret[]> = {
  ejer: RETTIGHEDER,
  medlem: ['laese', 'handle', 'nodstop', 'se-husstand'],
  barn: ['laese', 'handle', 'nodstop', 'se-husstand'],
  gaest: ['laese'],
  stoette: ['laese', 'se-husstand'],
};

/** Whether `rolle` has `ret`. Unknown roles or rights are never allowed (fail-closed). */
export function kan(rolle: Rolle, ret: Ret): boolean {
  return Object.hasOwn(TABEL, rolle) && TABEL[rolle].includes(ret);
}

/** A household role (never stoette). */
export const erRolle = (v: unknown): v is HusRolle => typeof v === 'string' && (ROLLER as readonly string[]).includes(v);
