// Human-tap tokens (KC-0122): a yes for exactly one handling. Issued when a
// person taps a button that needs a yes, redeemed once when the handling is
// posted, gone after two minutes. Bound to person, room, kind and element id.
// The model's JSON has no field for it, and the voice never asks for one.

import { randomBytes } from 'node:crypto';

export type Binding = { person: string; rum: string; slags: string; id: string };

const LEVETID_MS = 120_000;
const noegle = (b: Binding): string => JSON.stringify([b.person, b.rum, b.slags, b.id]);

export function lavTegn(nu: () => number = Date.now) {
  const udstedte = new Map<string, { binding: string; udloeber: number }>();
  const ryd = (): void => { const t = nu(); for (const [k, v] of udstedte) if (v.udloeber < t) udstedte.delete(k); };
  return {
    udsted(b: Binding): string {
      ryd();
      const tegn = randomBytes(18).toString('base64url');
      udstedte.set(tegn, { binding: noegle(b), udloeber: nu() + LEVETID_MS });
      return tegn;
    },
    /** True once, for the binding it was issued for, before it expires. */
    indloes(tegn: string | undefined, b: Binding): boolean {
      if (!tegn) return false;
      const v = udstedte.get(tegn);
      if (!v || v.udloeber < nu() || v.binding !== noegle(b)) return false;
      udstedte.delete(tegn);
      return true;
    },
  };
}
export type Tegn = ReturnType<typeof lavTegn>;
