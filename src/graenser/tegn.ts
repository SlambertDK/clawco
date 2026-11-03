// Human-tap tokens (KC-0122): a yes for exactly one handling. Issued when a
// person taps a button that needs a yes, redeemed once when the handling is
// posted, gone after two minutes. Bound to person, room, kind and element id,
// and (KC-0270 B4) to a hash of the content the button carried when it was
// shown, so a refresh that swaps the instruction behind the same id makes the
// token worthless. The model's JSON has no field for it, and the voice never
// asks for one.

import { createHash, randomBytes } from 'node:crypto';

/** `indhold`: the hash of what the button runs (handlingIndhold), when the handling is free text. */
export type Binding = { person: string; rum: string; slags: string; id: string; indhold?: string };

const LEVETID_MS = 120_000;
const noegle = (b: Binding): string => JSON.stringify([b.person, b.rum, b.slags, b.id, b.indhold ?? '']);

/** The hash a token binds for free text (the household's sendJaId pattern): 64 bits of sha256 over the parts. */
export const indholdsHash = (...dele: string[]): string => createHash('sha256').update(JSON.stringify(dele)).digest('hex').slice(0, 16);
/** The content of an agent handling a token binds: its label and its instruction (what the person sees, what runs). */
export const handlingIndhold = (h: { label: string; instruktion: string }): string => indholdsHash(h.label, h.instruktion);
/** KC-0270 (B5): the content of an agent-written Fortryd a token binds: its text, as shown on the button. */
export const fortrydIndhold = (tekst: string): string => indholdsHash('fortryd', tekst);

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
