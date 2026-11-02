// KC-0077: what the chat offers as one-tap sentences above the field, per room,
// until Henrik sends something. On a phone
// Henrik does not type (docs/VISION.md principle 5); a tap sends the sentence
// exactly as if he had typed it. "Jeg vil skrive" is read by shell/aabn.ts and
// opens Skrive. Pure data; layout.ts renders it escaped.

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

/** One univers (`univers-<slug>`, a room of its own) is about its own pile. */
const ET_UNIVERS: readonly string[] = ['Hvad er åbent her?', 'Hvad er næste skridt?'];

/** KC-0098: always the last chip, so it never pushes a room's own out; shell/aabn.ts answers it in the chat. */
const HVAD_KAN_JEG_SIGE = 'Hvad kan jeg sige?';

export function forslagTil(roomId: string): readonly string[] {
  const egne = FORSLAG[roomId] ?? (roomId.startsWith('univers-') ? ET_UNIVERS : []);
  return egne.length > 0 ? [...egne, HVAD_KAN_JEG_SIGE] : [];
}
