// KC-0138: messages in Kuratoren. Which messages a run may send (those of the run's own zone — KC-0226: one run per
// zone, privat by default — with an id and not sent before), and the app's own sender line on a card Hermes built on one. Pure: data in, data out.
//
// Invariant: a card's `besked` (channel and sender) comes from the connector's read, never from Hermes' text; a
// beskedId this app did not send (or no longer knows) is dropped, so a card can never claim a sender.

import type { Kort } from '../rooms/hjem/kort.ts';
import type { KuratorBesked } from '../rooms/module.ts';
import type { DataZone } from '../identitet/zoner.ts';

const MAKS_BESKEDER = 30;
const MAKS_SETE = 500;

/** The messages to send a run over `zone` (default privat; a message with no zone reads as privat), newest first: with an id, not among `sete`. */
export function nyeBeskeder(alle: readonly KuratorBesked[], sete: readonly string[], zone: DataZone = 'privat'): KuratorBesked[] {
  const set = new Set(sete);
  return alle
    .filter((b): b is KuratorBesked & { id: string } => typeof b.id === 'string' && (b.zone ?? 'privat') === zone && !set.has(b.id))
    .sort((a, b) => b.tid.localeCompare(a.tid))
    .slice(0, MAKS_BESKEDER);
}

/** `sete` after a successful run that sent `sendt`. */
export const seteEfter = (sete: readonly string[], sendt: readonly KuratorBesked[]): string[] =>
  [...sete, ...sendt.flatMap((b) => (b.id && !sete.includes(b.id) ? [b.id] : []))].slice(-MAKS_SETE);

/**
 * Hermes' cards with the app's sender line: from this run's messages, else from the stored card on the same message
 * (an update keeps its line); an unknown beskedId is removed together with any line Hermes wrote.
 */
export function knytBeskeder(kort: readonly Kort[], beskeder: readonly KuratorBesked[], foer: readonly Kort[]): Kort[] {
  const kendte = new Map<string, { kanal: string; afsender: string }>();
  for (const k of foer) if (k.beskedId && k.besked) kendte.set(k.beskedId, k.besked);
  for (const b of beskeder) if (b.id) kendte.set(b.id, { kanal: b.kanal, afsender: b.afsender.navn });
  return kort.map((k) => {
    const { beskedId, besked: _hermes, ...rest } = k;
    const linje = beskedId ? kendte.get(beskedId) : undefined;
    return linje && beskedId ? { ...rest, beskedId, besked: linje } : rest;
  });
}
