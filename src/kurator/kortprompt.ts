// What we ask Hermes when Henrik acts on a card in Hjem: press a handling
// button, or dismiss a card with a reason ("laer"). Pure: data in, spec out.

import { KORSEL, type Handling, type Kort } from '../rooms/hjem/kort.ts';
import { byggPrompt, fortrydOpgave, handlingsOpgave } from '../agent/prompt.ts';
import type { DataSegment } from '../agent/udtroet.ts';
import { agentGulv } from '../graenser/verber.ts';
import { reglerTilPrompt, regelforslagTekst } from '../tillid/prompt.ts';
import { kuratorPromptTekst } from './prompt-tekster.ts';
import type { ReglerLaest } from '../tillid/lager.ts';
import type { Regel } from '../tillid/regler.ts';
import { SKJULT_KILDE } from '../tillid/skjulte.ts';

export type RunSpec = ReturnType<typeof byggPrompt>;

// KC-0241: the words are in prompt-tekster.ts, read at call time in the language of the run.
const dato = (now: Date): string => new Intl.DateTimeFormat(kuratorPromptTekst().datoSted, { timeZone: 'Europe/Copenhagen', dateStyle: 'full', timeStyle: 'short' }).format(now);

const RUM = 'kurator';

/** KC-0123: a card is Kuratoren's text from mail — an afledt segment. */
const kortSegment = (k: Kort, foer = ''): DataSegment => ({
  kilde: 'kort', zone: KORSEL, tillid: 'afledt',
  tekst: kuratorPromptTekst().kortSegment(foer, k.titel, k.betyder, k.anbefaling),
});

/** The stored instruction of a card's handling, run as the button says. Nothing from the request body gets in. */
export function buildKortHandlingRun(k: Kort, h: Handling, now: Date): RunSpec {
  const T = kuratorPromptTekst();
  // The verb is the app's floor for a card's free-form handling, the same the card route passes the policy layer with.
  const opgave = T.handlingOpgave(T.kortRolle, dato(now), handlingsOpgave(agentGulv({})), T.kortRegler);
  return byggPrompt({ rum: RUM, zone: KORSEL, opgave, data: [{ kilde: 'handling', zone: KORSEL, tillid: 'afledt', tekst: h.instruktion }, kortSegment(k, T.knap(h.label))] });
}

/** Henrik pressed "Fortryd" on a Hjem log entry: Hermes runs the instruction stored with it. */
export function buildKortFortrydRun(fortryd: string, now: Date): RunSpec {
  const T = kuratorPromptTekst();
  const opgave = T.fortrydOpgave(T.kortRolle, dato(now), fortrydOpgave(), T.kortRegler);
  return byggPrompt({ rum: RUM, zone: KORSEL, opgave, data: [{ kilde: 'fortryd', zone: KORSEL, tillid: 'afledt', tekst: fortryd }] });
}

/** Henrik closed a card and said why: Hermes reads what the closing means from his words and stores the lesson. */
/** `forslag`: Henrik is the owner and the app can store a proposal — Hermes may add one block, and sees his rules (KC-0144). */
export function buildLaerRun(k: Kort, grund: string, now: Date, personer?: string, forslag?: { regler: ReglerLaest | undefined }): RunSpec {
  const T = kuratorPromptTekst();
  const opgave = T.laerOpgave(T.kortRolle, dato(now), T.laerHvor(personer), T.kortRegler, forslag ? `\n\n${regelforslagTekst()}` : '');
  return byggPrompt({ rum: RUM, zone: KORSEL, opgave, ...(forslag ? { regler: reglerTilPrompt(forslag.regler) } : {}), data: [kortSegment(k), { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: T.grund(grund) }] });
}

/**
 * KC-0145: Henrik saw an item Clawco hid this week in the Sunday sample and said "Skulle have vist mig det". Hermes learns
 * it and may add ONE rule proposal (the KC-0144 block). With `regel` (the rule that hid it), the app has already proposed
 * to pause that rule; Hermes may propose a narrower rule instead, which then replaces it. Only the title, where it came
 * from and the rule go in — nothing else of the item.
 */
export function buildSkjultRun(p: { titel: string; kilde: string }, regel: Regel | undefined, now: Date, regler: ReglerLaest | undefined): RunSpec {
  const T = kuratorPromptTekst();
  const regelDel = regel ? T.skjultRegel(regel.id, regel.gaelder.slags ?? T.reglensSlags) : T.skjultUdenRegel;
  const opgave = T.skjultOpgave(T.kortRolle, dato(now), regelDel, T.kortRegler, regelforslagTekst());
  const tekst = T.skjultTekst(p.titel, SKJULT_KILDE[p.kilde] ?? p.kilde, regel ? { id: regel.id, titel: regel.titel, tekst: regel.tekst ? regel.tekst.replace(/\s+/g, ' ').trim() : '' } : undefined);
  return byggPrompt({ rum: RUM, zone: KORSEL, opgave, regler: reglerTilPrompt(regler), data: [{ kilde: 'skjult', zone: KORSEL, tillid: 'afledt', tekst }, { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: T.skjultSvar }] });
}
