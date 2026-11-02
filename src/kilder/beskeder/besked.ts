// KC-0138: one inbound line shaped into the Besked a room or a prompt may see. The text is cut to 500 characters
// and stripped of phone numbers, platform addresses and @handles; the sender is a person from the register (KC-0136,
// injected as Kontakt — this folder imports no notes code) matched by its id on the channel (KC-0225), then by display name; else the
// channel's display name if it is a name; else "ukendt afsender". Ids and numbers never leave this function.

import { createHash } from 'node:crypto';
import type { DataZone } from '../../identitet/zoner.ts';
import type { Besked } from '../types.ts';
import type { RaaBesked } from './jsonl.ts';
import { findAfsender, type Kontakt } from './afsender.ts';
import { BESKEDER_TEKSTER, beskederTekst } from './tekster.ts';
import { erId, samtaleNoegle, standardNavn } from './valg.ts';

export const MAKS_TEKST = 500;
/** The placeholder for an unknown sender in Danish; a read writes it in the language of the request (beskederTekst().ukendtAfsender). */
export const UKENDT = BESKEDER_TEKSTER.da.ukendtAfsender;

export type { Kontakt };

const norm = (s: string): string => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

function findKontakt(r: RaaBesked, kontakter: readonly Kontakt[]): Kontakt | undefined {
  const paaKanal = findAfsender(kontakter, r.kanal, r.afsender); // KC-0225: the id the register holds for this channel
  if (paaKanal) return paaKanal;
  if (!r.afsenderNavn) return undefined;
  const n = norm(r.afsenderNavn);
  const hel = kontakter.filter((x) => norm(x.navn) === n);
  if (hel.length === 1) return hel[0];
  const fornavn = kontakter.filter((x) => norm(x.navn).split(' ')[0] === n);
  return fornavn.length === 1 ? fornavn[0] : undefined;
}

/** Phone numbers (6+ digits with phone punctuation), platform addresses and @handles out of a text. */
export function skjulIder(tekst: string, ider: readonly string[] = []): string {
  let t = tekst;
  for (const id of ider) if (id.length >= 3) t = t.split(id).join(beskederTekst().skjult);
  return t
    .replace(/\S+@(?:s\.whatsapp\.net|g\.us|c\.us|lid)\b/gi, beskederTekst().skjult)
    .replace(/\+?\d[\d\s().-]{4,}\d/g, (m) => (m.replace(/\D/g, '').length >= 6 ? beskederTekst().nummer : m))
    .replace(/(^|[^\w.])@[A-Za-z0-9_]{3,}/g, (_m, foer: string) => `${foer}${beskederTekst().skjult}`);
}

export function tilBesked(r: RaaBesked, o: { kontakter: readonly Kontakt[]; zone: DataZone; laest?: boolean }): Besked {
  const k = findKontakt(r, o.kontakter);
  const visNavn = r.afsenderNavn && !erId(r.afsenderNavn) ? r.afsenderNavn : undefined;
  const afsender = k ? { navn: k.relation ? `${k.navn} (${k.relation})` : k.navn, personId: k.id } : { navn: visNavn ?? beskederTekst().ukendtAfsender };
  const samtaleNavn = r.samtaleNavn && !erId(r.samtaleNavn) ? r.samtaleNavn : !r.gruppe && k ? k.navn : standardNavn(r.kanal, r.gruppe);
  const id = `b-${createHash('sha256').update(`${r.kanal}\u0000${r.samtale}\u0000${r.afsender}\u0000${r.tid}\u0000${r.tekst}`).digest('hex').slice(0, 16)}`;
  const ud: Besked = {
    id, kanal: r.kanal, samtaleId: samtaleNoegle(r.kanal, r.samtale), samtaleNavn: skjulIder(samtaleNavn), afsender,
    tid: r.tid, tekst: skjulIder(r.tekst, [r.afsender, r.samtale]).slice(0, MAKS_TEKST), laest: o.laest ?? false, zone: o.zone,
  };
  if (r.vedhaeftning?.length) ud.vedhaeftning = r.vedhaeftning.map((v) => ({ navn: skjulIder(v.navn), type: v.type }));
  return ud;
}
