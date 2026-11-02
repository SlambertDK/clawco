// KC-0134: an IMAP fetch result (envelope, flags, structure — never a body)
// as the envelope the Mail room reads. Same trimming, fallbacks, order and
// cap as parseAll/parseEnvelopes in src/rooms/mail/source.ts (which src/kilder
// may not import); test/kilder/mail-imap/parse.test.ts holds them equal.

import type { Kuvert } from '../types.ts';

/** The Mail room's cap on the list (MAX_HANDLING in src/rooms/mail/source.ts). */
export const MAX_KUVERTER = 20;

type Adresse = { name?: string | undefined; address?: string | undefined };
type Struktur = { type?: string; disposition?: string | undefined; dispositionParameters?: Record<string, string> | undefined; childNodes?: Struktur[] | undefined };
/** The part of imapflow's FetchMessageObject this module reads. */
export type ImapBesked = {
  uid: number;
  flags?: Set<string> | undefined;
  envelope?: { date?: Date | string | undefined; subject?: string | undefined; messageId?: string | undefined; from?: Adresse[] | undefined } | undefined;
  bodyStructure?: Struktur | undefined;
};

const s = (v: unknown, max = 300): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function harVedhaeftning(st: Struktur | undefined, dybde = 0): boolean {
  if (!st || dybde > 20) return false;
  if (st.disposition?.toLowerCase() === 'attachment' || Boolean(st.dispositionParameters?.['filename'])) return true;
  return (st.childNodes ?? []).some((c) => harVedhaeftning(c, dybde + 1));
}

function dato(d: Date | string | undefined): string {
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  return s(d, 40);
}

export function tilKuvert(m: ImapBesked): Kuvert | null {
  if (!Number.isInteger(m.uid) || m.uid <= 0) return null;
  const e = m.envelope ?? {};
  const fra = e.from?.[0];
  const fraEmail = s(fra?.address, 200);
  const flag = m.flags ?? new Set<string>();
  const k: Kuvert = {
    id: String(m.uid),
    emne: s(e.subject) || '(uden emne)',
    fra: s(fra?.name, 120) || fraEmail || '(ukendt afsender)',
    modtaget: dato(e.date),
    laest: flag.has('\\Seen'),
    flag: flag.has('\\Flagged'),
    vedhaeftning: harVedhaeftning(m.bodyStructure),
  };
  if (fraEmail) k.fraEmail = fraEmail;
  const messageId = s(e.messageId);
  if (messageId) k.messageId = messageId;
  return k;
}

/** Newest first (an unreadable date sorts last), capped at MAX_KUVERTER. */
export function kuverter(liste: ImapBesked[]): Kuvert[] {
  const ts = (k: Kuvert): number => { const n = Date.parse(k.modtaget); return Number.isNaN(n) ? 0 : n; };
  return liste.map(tilKuvert).filter((k): k is Kuvert => k !== null).sort((a, b) => ts(b) - ts(a)).slice(0, MAX_KUVERTER);
}
