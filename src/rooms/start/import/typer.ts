// KC-0129: the plain shapes the import step's parsers hand on. Parsers are pure (text in, data out) and bounded:
// whatever a file holds, they never throw and never return more than the caps below. Phone numbers, e-mail
// addresses and photos are deliberately not read: the people register needs none of them (spec: files the user owns).

import { START_TEKSTER, startTekst } from '../tekster.ts';

/** One person as a contact file or an export holds them. */
export type Kontakt = { navn: string; org?: string; foedselsdag?: string; noter?: string };

export const KONTAKTER_MAKS = 2000;
export const FELT_MAKS = { navn: 120, org: 200, foedselsdag: 40, noter: 2000 } as const;

/** Control characters except newline and tab, removed. */
export const renTekst = (s: string): string => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

/** A contact from loose fields: trimmed, capped, empty fields left out; null when there is no name. */
export function lavKontakt(f: { navn?: string | undefined; org?: string | undefined; foedselsdag?: string | undefined; noter?: string | undefined }): Kontakt | null {
  const navn = renTekst(f.navn ?? '').replace(/\s+/g, ' ').trim().slice(0, FELT_MAKS.navn);
  if (!navn) return null;
  const org = renTekst(f.org ?? '').replace(/\s+/g, ' ').trim().slice(0, FELT_MAKS.org);
  const foedselsdag = renTekst(f.foedselsdag ?? '').trim().slice(0, FELT_MAKS.foedselsdag);
  const noter = renTekst(f.noter ?? '').trim().slice(0, FELT_MAKS.noter);
  return { navn, ...(org ? { org } : {}), ...(foedselsdag ? { foedselsdag } : {}), ...(noter ? { noter } : {}) };
}

/** The names that do not change with the language. */
const EGENNAVNE: Readonly<Record<string, string>> = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini' };
export const ASSISTENTER = ['chatgpt', 'claude', 'gemini', 'andet'] as const;

/**
 * What a note's `kilde` says (`import-<slags>`), in the user's words: the card, the pile and the log use these. `sprog` = a language
 * to force (the text written into the user's own files is always Danish); none = the language being rendered.
 */
export const slagsNavn = (slags: string, sprog?: 'da'): string => EGENNAVNE[slags] ?? (sprog ? START_TEKSTER[sprog] : startTekst()).imp.slags[slags] ?? slags;
