// What we ask Hermes in the room Skrive. Pure functions.

import type { RunSpec } from '../dagen/prompt.ts';
import { KORSEL } from './schema.ts';
import type { Dokument } from './schema.ts';
import { byggPrompt, elementSegment, pegerTekst } from '../../agent/prompt.ts';
import { tekst } from '../../shell/tekster.ts';
import { skrivePrompt } from './prompt-tekster.ts';

// KC-0241: the words are in prompt-tekster.ts, Danish and English, read at call time; the room's name is the nav's.
const rolle = (): string => skrivePrompt().rolle(tekst().rum['skrive']!);

function nummereret(dok: Dokument): string {
  return dok.afsnit.map((a) => `[${a.id}] ${a.tekst}`).join('\n\n');
}

export function beskrivType(type: string): string {
  return skrivePrompt().typer[type] ?? type;
}

export function buildNytRun(titel: string, brief: string): RunSpec {
  const T = skrivePrompt();
  return {
    ...byggPrompt({
      rum: 'skrive',
      zone: KORSEL,
      opgave: `${rolle()}\n\n${T.nytOpgave}\n\n${T.dokSkema}`,
      data: [{ kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: T.nytBesked(titel, brief) }],
    }),
  };
}

/** KC-0123: the draft is Hermes' text (and may quote mails or notes it looked up) — an afledt segment, never task text. */
const udkastSegment = (dok: Dokument | null) => ({
  kilde: 'udkast', zone: KORSEL, tillid: 'afledt' as const,
  tekst: dok ? `${skrivePrompt().udkast(dok.titel, dok.brief)}\n\n${nummereret(dok)}` : skrivePrompt().intetUdkast,
});

export function buildForslagRun(dok: Dokument, afsnitId: string | null, type: string): RunSpec {
  const T = skrivePrompt();
  return {
    ...byggPrompt({
      rum: 'skrive',
      zone: KORSEL,
      opgave: `${rolle()}\n\n${T.forslagOpgave}\n\n${T.forslagSkema}`,
      data: [udkastSegment(dok), { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: T.forslagBesked(afsnitId, beskrivType(type)) }],
    }),
  };
}

export function buildSkriveChatRun(besked: string, kontekst: string | undefined, dok: Dokument | null): RunSpec {
  const T = skrivePrompt();
  return {
    ...byggPrompt({
      rum: 'skrive',
      zone: KORSEL,
      opgave: `${rolle()}\n\n${T.chatOpgave(pegerTekst(T.hvem), T.forslagSkema)}`,
      data: [udkastSegment(dok), ...elementSegment(kontekst, KORSEL, T.hvem), { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: besked }],
    }),
  };
}
