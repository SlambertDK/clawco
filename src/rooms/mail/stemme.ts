// The spoken view of Mail (KC-0015): every undecided decision as one short
// Danish passage a voice can read, with the choices Henrik can say.
// "Send" is deliberately never offered: sending stays a button on screen.

import type { StemmePunkt, StemmeRum } from '../../stemme/types.ts';
import { saetning, taleAfsender, taleDato } from '../../stemme/tale.ts';
import type { Beslutning, MailState } from './schema.ts';

/** `laeseKun` (KC-0223): the connection can only read, so no draft is promised. */
export function sigBeslutning(b: Beslutning, laeseKun = false): string {
  const dele = [`Mail fra ${taleAfsender(b.fra)}: ${saetning(b.emne)}`, saetning(b.betydning)];
  if (b.frist) dele.push(`Fristen er ${taleDato(b.frist)}.`);
  if (b.type === 'svar' && !laeseKun) dele.push('Hermes har et udkast til svar klar.');
  return dele.filter(Boolean).join(' ');
}

function resume(antal: number): string {
  if (antal === 0) return 'Ingen mails venter.';
  if (antal === 1) return 'Én mail venter på din beslutning.';
  return `${antal} mails venter på din beslutning.`;
}

export function stemmeMail(state: MailState | null): StemmeRum {
  const venter = (state?.beslutninger ?? []).filter((b) => !b.afgjort);
  const laeseKun = state?.laeseKun === true;
  const punkter: StemmePunkt[] = venter.map((b) => ({
    id: b.mailId,
    sig: sigBeslutning(b, laeseKun),
    // KC-0223: a read-only connection has nothing to say yes to.
    valg: laeseKun ? [] : [
      ...b.muligheder.map((m) => ({ id: m.id, label: m.label })),
      { id: `aktion:faerdig:${b.mailId}`, label: 'Færdig' },
    ],
  }));
  return { rum: 'mail', resume: resume(venter.length), punkter };
}
