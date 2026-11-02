// KC-0077: what the chat offers as one-tap sentences above the field, per room,
// until Henrik sends something. On a phone
// Henrik does not type (docs/VISION.md principle 5); a tap sends the sentence
// exactly as if he had typed it. "Jeg vil skrive" is read by shell/aabn.ts and
// opens Skrive. Pure data; layout.ts renders it escaped.
// KC-0170: the chips come in the language of the request (read at call time); the chat reads both languages.

import { sprogNu } from '../store/sprog.ts';

export const FORSLAG: Readonly<Record<string, readonly string[]>> = {
  hjem: ['Hvad venter på mig?', 'Hvad sker der i dag?', 'Jeg vil skrive'],
  start: ['Hvad skal jeg nu?', 'Hvad giver det her trin?'],
  dagen: ['Hvad er det vigtigste i dag?', 'Hvornår har jeg tid?'],
  mail: ['Hvilken mail haster mest?', 'Hvad kan vente?'],
  skrive: ['Gør udkastet kortere', 'Stram teksten op'],
  nyheder: ['Hvad betyder nyhederne for mig?'],
  univers: ['Hvad er der gang i?', 'Hvad skal jeg følge op på?'],
  husstand: ['Hvad skal vi i denne uge?', 'Hvem er hvor i weekenden?'],
};

const FORSLAG_EN: Readonly<Record<string, readonly string[]>> = {
  hjem: ['What is waiting for me?', 'What is happening today?', 'I want to write'],
  start: ['What should I do now?', 'What does this step give me?'],
  dagen: ['What matters most today?', 'When do I have time?'],
  mail: ['Which mail is most urgent?', 'What can wait?'],
  skrive: ['Make the draft shorter', 'Tighten the text'],
  nyheder: ['What does the news mean for me?'],
  univers: ['What is going on?', 'What should I follow up on?'],
  husstand: ['What are we doing this week?', 'Who is where this weekend?'],
};

/** One univers (`univers-<slug>`, a room of its own) is about its own pile. */
const ET_UNIVERS: readonly string[] = ['Hvad er åbent her?', 'Hvad er næste skridt?'];
const ET_UNIVERS_EN: readonly string[] = ['What is open here?', 'What is the next step?'];

/** KC-0098: always the last chip, so it never pushes a room's own out; shell/aabn.ts answers it in the chat. */
const HVAD_KAN_JEG_SIGE = 'Hvad kan jeg sige?';
const HVAD_KAN_JEG_SIGE_EN = 'What can I say?';

export function forslagTil(roomId: string): readonly string[] {
  const en = sprogNu() === 'en';
  const egne = (en ? FORSLAG_EN : FORSLAG)[roomId] ?? (roomId.startsWith('univers-') ? (en ? ET_UNIVERS_EN : ET_UNIVERS) : []);
  return egne.length > 0 ? [...egne, en ? HVAD_KAN_JEG_SIGE_EN : HVAD_KAN_JEG_SIGE] : [];
}
