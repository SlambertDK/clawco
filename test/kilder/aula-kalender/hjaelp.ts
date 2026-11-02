// KC-0235: helpers for the Aula reader's tests — an invented calendar file, a scripted fetcher, a context. Nothing here is a
// real address, a real person or a real Aula file: the format is ASSUMED (KC-0238 will confirm it with a real parent).

import { HentFejl, type Henter } from '../../../src/kilder/nyheder-rss/hent.ts';
import type { KildeKontekst } from '../../../src/kilder/types.ts';

/** The invented link: on an Aula host, with an invented token (never a real one). */
export const LINK = 'https://www.aula.dk/kalender/ugekalender/TESTVAERDI-0000-1111-2222';
export const TOKEN = 'TESTVAERDI-0000-1111-2222';
/** A Monday in the Copenhagen winter; the week is 2.–8. November. */
export const NU = new Date('2026-11-02T08:00:00Z');

export const ctx = (o: { link?: string | null; nu?: Date; valg?: Record<string, string> } = {}): KildeKontekst => {
  const link = o.link === undefined ? LINK : o.link;
  return { nu: o.nu ?? NU, zone: 'husstand', valg: o.valg ?? {}, hemmelighed: async () => (link === null ? null : { link }) };
};

const LANG = 'Meget lang beskrivelse om børnenes tur: '.repeat(40);

/** An invented family's week: Alma (2.B) and Mads (kindergarten). Organizer, attendees, a long description and a link are in it to be dropped. */
export function ics(): string {
  const med = (...l: string[]): string => `BEGIN:VEVENT\r\n${l.join('\r\n')}\r\nEND:VEVENT\r\n`;
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Opdigtet//Ugekalender//DA', 'X-WR-CALNAME:Kløvermarkskolen', '',
  ].join('\r\n') + [
    med('UID:hemmelig-uid-4711@aula.example', 'SUMMARY:Forældremøde i 2.B', 'DTSTART;TZID=Europe/Copenhagen:20261103T190000', 'DTEND;TZID=Europe/Copenhagen:20261103T203000', 'LOCATION:Klasselokale 2.B',
      'ORGANIZER;CN=Lærer Lund:mailto:lund@kloevermark.example', 'ATTENDEE;CN=Alma Opdigtet:mailto:alma@kloevermark.example', 'ATTENDEE;CN=Mads Opdigtet:mailto:mads@boernehuset.example',
      `DESCRIPTION:${LANG}`, 'URL:https://www.aula.dk/besked/12345'),
    med('UID:uid-2', 'SUMMARY:Skolefri', 'DTSTART;VALUE=DATE:20261104', 'DTEND;VALUE=DATE:20261105'),
    med('UID:uid-3', 'SUMMARY:Gymnastik', 'DTSTART;TZID=Europe/Copenhagen:20261029T143000', 'DTEND;TZID=Europe/Copenhagen:20261029T153000', 'RRULE:FREQ=WEEKLY;BYDAY=TH', 'LOCATION:Gymnastiksalen'),
    med('UID:uid-4', 'SUMMARY:Aflyst tur', 'STATUS:CANCELLED', 'DTSTART:20261105T080000Z'),
    med('UID:uid-5', 'SUMMARY:Næste uge', 'DTSTART:20261112T080000Z'),
    med('UID:uid-6', 'SUMMARY:Sommerfest i Børnehuset', 'DTSTART;TZID=Europe/Copenhagen:20261106T150000', 'DTEND;TZID=Europe/Copenhagen:20261106T170000', 'LOCATION:Børnehuset Solsikken'),
  ].join('') + 'END:VCALENDAR\r\n';
}
export const LANG_MARKER = 'Meget lang beskrivelse';

export type Kald = { adresse: string; etag?: string; sidstRettet?: string }[];
type Opskrift = { tekst: string; etag?: string } | HentFejl | ((n: number) => Promise<{ tekst: string; etag?: string } | HentFejl>);

/** A fetcher that answers from one recipe (a file, a failure, or a function of the call number) and records every call. */
export function falskHenter(opskrift: Opskrift, kald: Kald = []): Henter {
  return async (adresse, o) => {
    kald.push({ adresse, ...(o.etag ? { etag: o.etag } : {}), ...(o.sidstRettet ? { sidstRettet: o.sidstRettet } : {}) });
    const s = typeof opskrift === 'function' ? await opskrift(kald.length) : opskrift;
    if (s instanceof HentFejl) throw s;
    if (s.etag && o.etag === s.etag) return { status: 'uaendret' };
    return { status: 'ny', tekst: s.tekst, ...(s.etag ? { etag: s.etag } : {}), endeligAdresse: adresse };
  };
}
export const status = (n: number): HentFejl => new HentFejl('status', `Kilden svarede ${n}.`, n);
