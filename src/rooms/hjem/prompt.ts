// KC-0019: what we ask Hermes when Henrik chats from Hjem. Hjem has no state of
// its own; its context is the spoken overview of every room (stemme/oversigt).

import { byggPrompt, peger as pegerLinje } from '../../agent/prompt.ts';
import type { DataSegment } from '../../agent/udtroet.ts';
import { KORSEL, type Kort } from './kort.ts';
import { reglerTilPrompt, regelforslagTekst } from '../../tillid/prompt.ts';
import type { ReglerLaest } from '../../tillid/lager.ts';
import type { Regelforslag } from '../../tillid/forslag.ts';
import { hjemPromptTekst } from './prompt-tekster.ts';

export const RUM = 'hjem';

export type RunSpec = ReturnType<typeof byggPrompt>;

export type HjemKort = { id: string; titel: string; betyder: string; /** The ledger the card's written row is in now. */ hvor?: 'shelfatlas' | 'privat' };

/** The open Kuratoren cards (KC-0028) — Hermes' text from mail: an afledt segment (KC-0123). */
const kortListe = (kort: HjemKort[]): string => {
  const T = hjemPromptTekst();
  return T.kortListe(kort.map((k) => `- ${k.id}: ${k.titel} — ${k.betyder}${k.hvor ? T.ligger(T.regnskab[k.hvor]) : ''}`).join('\n'));
};

/** "Ret" on a card: the element Henrik points at, and what that card says (Hermes' text). */
export type HjemPeger = { kontekst: string; kort?: Pick<Kort, 'type' | 'titel' | 'betyder' | 'anbefaling' | 'grundlag' | 'kilder'>;
  /** KC-0144: Henrik is the owner and points at a card (Ret) or at a pending proposal (Ret reglen): Hermes may add ONE regelforslag block. */
  forslag?: true;
  /** KC-0144: "Ret reglen" — the pending proposal Henrik is correcting (Hermes' own earlier text: afledt data). */
  revideret?: Pick<Regelforslag, 'titel' | 'tekst' | 'trin' | 'gaelder'>;
};

/** `regler`: Henrik's rules file as read for this run (KC-0142); absent = no rules (trin 0). */
export function buildHjemChatRun(besked: string, oversigt: string, now: Date, kort?: HjemKort[], regler?: ReglerLaest, peger?: HjemPeger): RunSpec {
  const medKort = Boolean(kort && kort.length > 0);
  const T = hjemPromptTekst();
  const dato = new Intl.DateTimeFormat(T.datoLokale, { timeZone: 'Europe/Copenhagen', dateStyle: 'full', timeStyle: 'short' }).format(now);
  const opgave = `${T.rolle}
${T.nuEr(dato)}

${T.overblikStaar} ${pegerLinje()}

${T.chatRegler}${medKort ? `\n\n${T.kortAfsnit}` : ''}${peger?.forslag ? `\n\n${regelforslagTekst()}${peger.revideret ? `\n${T.reviderForslag}` : ''}` : ''}`;
  const k = peger?.kort;
  const data: DataSegment[] = [
    { kilde: 'oversigt', zone: KORSEL, tillid: 'afledt', tekst: T.oversigt(oversigt) },
    ...(medKort && kort ? [{ kilde: 'kort', zone: KORSEL, tillid: 'afledt' as const, tekst: kortListe(kort) }] : []),
    ...(peger ? [{ kilde: 'element', zone: KORSEL, tillid: 'afledt' as const, tekst: `${T.peger(peger.kontekst)}${k ? T.pegerKort(JSON.stringify({ type: k.type, titel: k.titel, betyder: k.betyder, anbefaling: k.anbefaling, grundlag: k.grundlag, kilder: k.kilder })) : ''}` }] : []),
    ...(peger?.revideret ? [{ kilde: 'regelforslag', zone: KORSEL, tillid: 'afledt' as const, tekst: T.forslagRettes(JSON.stringify({ titel: peger.revideret.titel, tekst: peger.revideret.tekst, trin: peger.revideret.trin, gaelder: peger.revideret.gaelder })) }] : []),
    { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: besked },
  ];
  return byggPrompt({ rum: RUM, zone: KORSEL, opgave, regler: reglerTilPrompt(regler), data });
}
