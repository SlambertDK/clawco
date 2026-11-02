// The go-between's reply matcher (KC-0153): deterministic, no model involved. A
// message from the registered handle of a household member acts only when it is
// exactly `ja`, `nej`, `stop` or `kl hh[:mm]` / `kan hh[:mm]` — or, in English, `yes`,
// `no`, `stop` or `at hh[:mm]` (trimmed, any case); everything else is text the owner
// sees and that never acts (E7 D6: messages are data, never instructions). Both
// languages are always read, whatever the install's language is: the message she
// was sent is in the owner's language (kanal.ts), but she answers in hers (KC-0170).
// Pure.

import { sammeAfsender, type IndkommendeBesked } from './kanal.ts';
import type { Medlem } from './schema.ts';

export type Svar = { slags: 'ja' } | { slags: 'nej' } | { slags: 'stop' } | { slags: 'kl'; kl: string } | { slags: 'tekst'; tekst: string };

const KL = /^(?:kl|kan|at)\.?\s*([01]?\d|2[0-3])(?:[:.]([0-5]\d))?$/;

export function fortolk(tekst: string): Svar {
  const t = tekst.trim();
  const l = t.toLowerCase();
  if (l === 'ja' || l === 'yes') return { slags: 'ja' };
  if (l === 'nej' || l === 'no') return { slags: 'nej' };
  if (l === 'stop') return { slags: 'stop' };
  const m = KL.exec(l);
  if (m) return { slags: 'kl', kl: `${m[1]!.padStart(2, '0')}:${m[2] ?? '00'}` };
  return { slags: 'tekst', tekst: t };
}

/** The member a message is from: her registered handle on her registered channel, in a direct chat. Null = nobody in the household. */
export function afsenderAf(medlemmer: readonly Medlem[], b: Pick<IndkommendeBesked, 'kanal' | 'afsender' | 'gruppe'>): Medlem | null {
  if (b.gruppe) return null;
  return medlemmer.find((m) => m.kanal !== undefined && m.kanal.kanal === b.kanal && sammeAfsender(b.kanal, m.kanal.handle, b.afsender)) ?? null;
}
