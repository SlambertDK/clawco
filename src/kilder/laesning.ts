// What a read may carry (KC-0132): the registry passes every Laesning through
// `renLaesning` before anyone sees it. The slags must be the connector's own,
// content is always untrusted (`uklar: true`, spec D6), and a mail envelope is
// cut to its declared keys — so a body can never reach a room or a prompt,
// whatever a connector returns.

import { KildeFejl, type Kilde, type Kuvert, type Laesning } from './types.ts';

/** The keys a mail envelope may carry — nothing else (never a body). */
export const KUVERT_NOEGLER: readonly (keyof Kuvert)[] = ['id', 'emne', 'fra', 'fraEmail', 'modtaget', 'laest', 'flag', 'vedhaeftning', 'messageId'];

const erObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function renKuvert(raw: unknown): Kuvert {
  const o = erObj(raw) ? raw : {};
  return Object.fromEntries(KUVERT_NOEGLER.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])) as Kuvert;
}

export function renLaesning(k: Kilde, raw: unknown): Laesning {
  if (!erObj(raw) || raw['slags'] !== k.slags) throw new KildeFejl(502, `${k.navn} svarede med noget andet end ${k.slags}`);
  const hentet = typeof raw['hentet'] === 'string' ? raw['hentet'] : '';
  const l = { ...raw, hentet, uklar: true } as Laesning;
  if (l.slags === 'mail') return { ...l, data: Array.isArray(l.data) ? l.data.map(renKuvert) : [] };
  return l;
}

/** How many items a read holds (events, mails, news, notes, messages) — for the first-read answer. */
export function antalI(l: Laesning): number {
  switch (l.slags) {
    case 'kalender': return l.data.days.reduce((n, d) => n + d.events.length, 0);
    case 'nyheder': return l.data.nyheder.length;
    case 'noter': return l.data.noter.length;
    default: return l.data.length;
  }
}
