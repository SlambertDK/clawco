// A tenant's slug format and the names Sky keeps for itself (KC-0182), shared by the fleet (which draws slugs,
// fleet/slug.ts) and the gateway (which routes on them, KC-0183) — one list, in one place.

export const SLUG = /^hus-[a-z2-7]{8}$/;

/** Names Sky keeps for itself on the base domain. The `hus-` prefix already keeps them out; the explicit
 *  list keeps that true if the format ever changes. */
export const RESERVEREDE: ReadonlySet<string> = new Set(['www', 'konto', 'status', 'api', 'mail', 'sky', 'docs', 'admin']);

export function erSlug(s: string): boolean {
  return SLUG.test(s) && !RESERVEREDE.has(s);
}
