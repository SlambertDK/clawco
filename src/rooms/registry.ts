// Which rooms exist, in nav order, and which are built in v1.

export type Room = { id: string; navn: string; built: boolean; beskrivelse: string };

export const ROOMS: readonly Room[] = [
  { id: 'hjem', navn: 'Nu', built: true, beskrivelse: 'Det, der kalder på dig lige nu.' },
  { id: 'start', navn: 'Start', built: true, beskrivelse: 'Rejsen fra kold start: ét kort per trin, til Clawco kender dig.' },
  { id: 'dagen', navn: 'Dagen', built: true, beskrivelse: 'Dagen i tre linjer, kalenderen og morgenavisen.' },
  { id: 'mail', navn: 'Mail', built: true, beskrivelse: 'Beslutninger om mails i Handling. Hermes sorterer resten.' },
  { id: 'skrive', navn: 'Skrive', built: true, beskrivelse: 'Skriv en tekst sammen med Hermes: udkast, forslag, brug eller afvis.' },
  { id: 'nyheder', navn: 'Nyheder', built: true, beskrivelse: 'Morgenavisen i baner, udvalgt af Hermes, med gem til senere.' },
  { id: 'univers', navn: 'Univers', built: true, beskrivelse: 'Et sted per emne, der vokser: dokumenter, noter, opgaver og møder.' },
  // KC-0148: the household universe; the nav draws it under Univers (shell/layout.ts).
  { id: 'husstand', navn: 'Husstanden', built: true, beskrivelse: 'Hvem der er med i husstanden, og en fælles uge med det, der gælder alle.' },
];

/** One univers is a dynamic room `univers-<slug>` (the slug rules of lager.ts: [a-z0-9-], at most 30). */
export const UNIVERS_ID = /^univers-([a-z0-9][a-z0-9-]{0,31})$/;

export function findRoom(id: string): Room | undefined {
  const fast = ROOMS.find((r) => r.id === id);
  if (fast) return fast;
  const univers = ROOMS.find((r) => r.id === 'univers');
  return univers && UNIVERS_ID.test(id) ? { ...univers, id } : undefined;
}
