// KC-0170: the words of the limits, Danish and English (the shape of src/kilder/tekster.ts): the reason a handling was
// refused or waits for a tap (shown on the card and written to the revision log at decision time, in the language of
// that request), the words of the kill switch and the line a refusal leaves in a room's log. Read at call time through
// the language of the request (src/store/sprog.ts), English with exactly Danish's keys (test/graenser/tekster.test.ts).
// Not here, on purpose: the operator's own messages (a malformed audit line, a rule asked for without a tap, the
// redactor's mask) which are written for whoever runs the installation, not shown to the user.

import { sprogNu } from '../store/sprog.ts';

const da = {
  // afgoer.ts
  ukendtVerb: 'Clawco gjorde det ikke: handlingen siger ikke, hvad den gør, så den bliver ikke kørt.',
  betalAldrig: 'Clawco betaler aldrig noget. Det gør du selv.',
  zoneGraense: 'Clawco flytter eller kopierer aldrig noget mellem zonerne privat, arbejde og husstand.',
  kraeverTrykBaggrund: 'Clawco gør aldrig det her af sig selv. Det kræver dit eget tryk på knappen.',
  indenForGraenserne: 'Inden for grænserne.',
  rolleMaaIkke: 'Din rolle i husstanden må ikke sætte det her i gang.',
  tapStemme: 'Clawco gør ikke det her på et ord fra stemmen. Tryk selv på knappen på skærmen.',
  tapUdenJa: 'Clawco gør kun det her, når du selv har trykket ja på knappen.',
  /** The two things Clawco never does without a tap: what it is (an infinitive phrase). */
  hvadSlet: 'slette noget',
  hvadSend: 'skrive til andre',
  stemmeMaaIkke: (hvad: string): string => `Clawco må ikke ${hvad} på et ord fra stemmen. Tryk selv på knappen på skærmen.`,
  kraeverJa: (hvad: string): string => `Clawco må kun ${hvad}, når du selv har trykket ja på knappen.`,
  trykkedeJa: (hvad: string): string => `Du trykkede ja, så Clawco må ${hvad} denne ene gang.`,
  aldrigAfSigSelv: (hvad: string): string => `Clawco må aldrig ${hvad} af sig selv. Det kræver dit eget tryk.`,
  /** The verbs a handling without a covering rule asks to do, as an infinitive (the unknown one: "do"). */
  ikkeEndnuVerb: { sorter: 'sortere', bogfoer: 'bogføre', forbered: 'forberede', 'udfoer-med-fortryd': 'gøre' } as Record<string, string>,
  gore: 'gøre',
  ikkeEndnu: (hvad: string): string => `Jeg må ikke ${hvad} dette endnu: hvilken regel skal dække det?`,
  forLavtTrin: (hvad: string, trin: number): string => `Jeg må ikke ${hvad} dette endnu: reglen, der dækker det, står på et for lavt trin (det kræver trin ${trin}). Hvilken regel skal dække det?`,

  // opsyn.ts: a run stopped because Hermes reached past its verb
  stoppedeKoerslen: (hvad: string): string => `Clawco stoppede kørslen: Hermes ville ${hvad}, og det må handlingen ikke.`,
  hvadVaerktoej: (tool: string): string => `bruge værktøjet ${tool}`,
  hvadSendMail: 'sende en mail',

  // nodstop.ts: the kill switch
  pause: 'Clawco er sat på pause',
  rolleKanIkkeStoppe: 'Din rolle i husstanden kan ikke stoppe Clawco.',
  kunEjerenStarter: 'Kun ejeren kan starte Clawco igen.',
  stopIntet: 'Stop alt: intet var i gang.',
  stopEn: 'Stop alt: 1 opgave blev standset.',
  stopFlere: (n: number): string => `Stop alt: ${n} opgaver blev standset.`,
  startIgen: 'Start igen: Clawco arbejder igen.',

  // port.ts: the line a refusal leaves in the room's log
  ikkeGjort: (hvorfor: string): string => `Ikke gjort: ${hvorfor}`,
};

export type GraenserTekster = typeof da;

const en: GraenserTekster = {
  ukendtVerb: 'Clawco did not do it: the action does not say what it does, so it is not run.',
  betalAldrig: 'Clawco never pays for anything. You do that yourself.',
  zoneGraense: 'Clawco never moves or copies anything between the zones private, work and household.',
  kraeverTrykBaggrund: 'Clawco never does this on its own. It needs your own press on the button.',
  indenForGraenserne: 'Within the limits.',
  rolleMaaIkke: 'Your role in the household may not start this.',
  tapStemme: 'Clawco does not do this on a word from the voice. Press the button on the screen yourself.',
  tapUdenJa: 'Clawco only does this when you have pressed yes on the button yourself.',
  hvadSlet: 'delete something',
  hvadSend: 'write to others',
  stemmeMaaIkke: (hvad) => `Clawco may not ${hvad} on a word from the voice. Press the button on the screen yourself.`,
  kraeverJa: (hvad) => `Clawco may only ${hvad} when you have pressed yes on the button yourself.`,
  trykkedeJa: (hvad) => `You pressed yes, so Clawco may ${hvad} this one time.`,
  aldrigAfSigSelv: (hvad) => `Clawco may never ${hvad} on its own. It needs your own press.`,
  ikkeEndnuVerb: { sorter: 'sort this', bogfoer: 'enter this in the ledger', forbered: 'prepare this', 'udfoer-med-fortryd': 'do this' },
  gore: 'do this',
  ikkeEndnu: (hvad) => `I may not ${hvad} yet: which rule should cover it?`,
  forLavtTrin: (hvad, trin) => `I may not ${hvad} yet: the rule that covers it is at too low a step (it needs step ${trin}). Which rule should cover it?`,

  stoppedeKoerslen: (hvad) => `Clawco stopped the run: Hermes wanted to ${hvad}, and the action may not do that.`,
  hvadVaerktoej: (tool) => `use the tool ${tool}`,
  hvadSendMail: 'send an email',

  pause: 'Clawco is paused',
  rolleKanIkkeStoppe: 'Your role in the household cannot stop Clawco.',
  kunEjerenStarter: 'Only the owner can start Clawco again.',
  stopIntet: 'Stop everything: nothing was running.',
  stopEn: 'Stop everything: 1 task was stopped.',
  stopFlere: (n) => `Stop everything: ${n} tasks were stopped.`,
  startIgen: 'Start again: Clawco is working again.',

  ikkeGjort: (hvorfor) => `Not done: ${hvorfor}`,
};

export const GRAENSER_TEKSTER = { da, en };
/** The limits' words in the language of the request (Danish when none is set). */
export const graenserTekst = (): GraenserTekster => GRAENSER_TEKSTER[sprogNu()];
