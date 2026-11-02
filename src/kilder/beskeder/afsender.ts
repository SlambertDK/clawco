// KC-0225: who sent an inbound message, by the id the people register holds for that channel (KC-0136's `kanaler:`;
// this folder imports no notes code — the register arrives as Kontakt, built by the composition root). Pure functions.
// Phone-like ids compare as E.164 digits (Danish eight digits count as +45), handles and uuids case-folded; an id that
// fits nobody, or fits two people, is no match. The ids stay in here: nothing but the person's name leaves.

import type { Kanal } from './jsonl.ts';

/** The ids of a person per channel (`signal`, `whatsapp`, `telegram`) and `telefon` (a number for the phone channels). */
export type KanalIder = Readonly<Record<string, string>>;
/** A person of the register as this connector needs it. */
export type Kontakt = { id: string; navn: string; relation: string; kanaler: KanalIder };

/** The channels a plain phone number identifies someone on. */
const TELEFON_KANALER: readonly Kanal[] = ['whatsapp', 'signal'];

/** Every id this person has on `kanal`: the channel's own entry, then `telefon` on the phone channels. */
function iderAf(p: { kanaler?: KanalIder }, kanal: Kanal): string[] {
  const ud: string[] = [];
  const egen = p.kanaler?.[kanal];
  if (egen) ud.push(egen);
  const tlf = p.kanaler?.['telefon'];
  if (tlf && TELEFON_KANALER.includes(kanal)) ud.push(tlf);
  return ud;
}

/** The id the person has on `kanal` (telefon stands in on WhatsApp and Signal), as written in the register. */
export const kanalIdAf = (p: { kanaler?: KanalIder }, kanal: Kanal): string | undefined => iderAf(p, kanal)[0];

/** The comparable form of an id: `tlf:<E.164 digits>` for a phone number, else `h:<folded text>`. undefined = nothing to compare. */
function noegle(kanal: Kanal, id: string): string | undefined {
  const t = id.normalize('NFKC').trim();
  if (!t) return undefined;
  if (kanal !== 'telegram') {
    const lokal = t.replace(/(?<=.)@[\w.-]+$/, '').replace(/:\d+$/, ''); // a WhatsApp id "<digits>:<device>" plus its host suffix → the digits
    if (/^[+\d\s().-]+$/.test(lokal)) {
      let d = lokal.replace(/\D/g, '');
      if (d.length < 6) return undefined;
      if (d.startsWith('00')) d = d.slice(2);
      else if (d.length === 8 && !lokal.includes('+')) d = `45${d}`;
      return `tlf:${d}`;
    }
  }
  const h = t.replace(/^@/, '').toLowerCase();
  return h ? `h:${h}` : undefined;
}

/** The person this id belongs to on `kanal`; undefined when nobody, or more than one person, has it. */
export function findAfsender(register: readonly Kontakt[], kanal: Kanal, id: string): Kontakt | undefined {
  const maal = noegle(kanal, id);
  if (!maal) return undefined;
  const fundet = register.filter((p) => iderAf(p, kanal).some((x) => noegle(kanal, x) === maal));
  return fundet.length === 1 ? fundet[0] : undefined;
}

/** The person's name for this id on `kanal`, or undefined. */
export const navnForAfsender = (register: readonly Kontakt[], kanal: Kanal, id: string): string | undefined => findAfsender(register, kanal, id)?.navn;
