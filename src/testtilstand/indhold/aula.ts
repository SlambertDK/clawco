// KC-0235 in the test world (AGENTS §4 r11): an invented family's Aula calendar. The real `aula-kalender` connector runs
// over a fake fetcher (verden.ts) that answers the invented link with this file — so the real parser reads it, and the
// organizer, attendees, long description and links in it are proved dropped on a real screen. Nothing here is a real person,
// school, address or Aula file; the link is on aula.dk only because the connector accepts nothing else (it is never fetched).

import { type Fakta } from './fakta.ts';

/** The invented Ugekalender link of the world's family (never fetched: the world's fetcher answers it). */
export const AULA_LINK = 'https://www.aula.dk/kalender/ugekalender/opdigtet-testverden-0001';
/**
 * The link seeded at a moment: one per moment, so what the connector remembers of a link (a revoked one stays revoked until a
 * new link is given) is not carried into another moment — as the world's Google refresh token is one per moment.
 */
export const aulaLink = (momentId: string): string => `${AULA_LINK}/${momentId}`;
/** The moment the link is connected and reading, in the household's week. */
export const AULA_KOBLET = 'aula-koblet';
/** The moment Aula answers 410 Gone: the family's link was revoked. */
export const AULA_TILBAGEKALDT = 'aula-tilbagekaldt';
/** The moments where Aula is connected (the link is seeded into the secret store by verden.ts). */
export const AULA_FORBUNDET: readonly string[] = [AULA_KOBLET, AULA_TILBAGEKALDT];

const dato = (dag: string): string => dag.replaceAll('-', '');
const LANG_TEKST = 'En lang tekst til forældrene om turen, madpakker, skiftetøj og hvem der skal med bussen. '.repeat(12);

/**
 * The week the moment's day starts: Ella (2.B) at Kløvermarkskolen, Mads at the kindergarten Solsikken (today: a sports day, tomorrow:
 * the parent-teacher talk; both are for Nu, KC-0236). Each event carries an
 * organizer, invitees and a long description to be dropped. The moment is on the day after the story's day (dagPlus 1).
 */
export function aulaIcs(f: Fakta): string {
  const d = (n: number): string => dato(f.plus(1 + n));
  const hendelse = (uid: string, ...linjer: string[]): string => `BEGIN:VEVENT\r\nUID:${uid}\r\n${linjer.join('\r\n')}\r\nEND:VEVENT\r\n`;
  const kun = (navn: string, adr: string): string => `ATTENDEE;CN=${navn}:mailto:${adr}`;
  const tz = 'TZID=Europe/Copenhagen';
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Opdigtet//Ugekalender//DA', 'X-WR-CALNAME:Kløvermarkskolen',
  ].join('\r\n') + '\r\n' + [
    hendelse('opdigtet-1@aula.example', 'SUMMARY:Skole-hjem-samtale for Ella', `DTSTART;${tz}:${d(1)}T163000`, `DTEND;${tz}:${d(1)}T171500`, 'LOCATION:Klasselokale 2.B',
      'ORGANIZER;CN=Lærer Lund:mailto:lund@kloevermark.example', kun('Ella Opdigtet', 'ella@kloevermark.example'), kun('Mads Opdigtet', 'mads@boernehuset.example'),
      `DESCRIPTION:${LANG_TEKST}`, 'URL:https://www.aula.dk/besked/12345'),
    // KC-0236: today, later in the day (Nu shows it as "I dag" and it leaves the screen once it is over); the first event above is tomorrow.
    hendelse('opdigtet-7@aula.example', 'SUMMARY:Idrætsdag i 2.B', `DTSTART;${tz}:${d(0)}T130000`, `DTEND;${tz}:${d(0)}T143000`, 'LOCATION:Idrætsanlægget', 'ORGANIZER;CN=Lærer Lund:mailto:lund@kloevermark.example', `DESCRIPTION:${LANG_TEKST}`),
    hendelse('opdigtet-2@aula.example', 'SUMMARY:Skolen holder fri (lærerkursus)', `DTSTART;VALUE=DATE:${d(2)}`, `DTEND;VALUE=DATE:${d(3)}`, `DESCRIPTION:${LANG_TEKST}`),
    hendelse('opdigtet-3@aula.example', 'SUMMARY:Gymnastik i 2.B', `DTSTART;${tz}:${dato(f.plus(1 + 3 - 7))}T143000`, `DTEND;${tz}:${dato(f.plus(1 + 3 - 7))}T153000`, 'RRULE:FREQ=WEEKLY', 'LOCATION:Gymnastiksalen',
      'ORGANIZER;CN=Lærer Lund:mailto:lund@kloevermark.example'),
    hendelse('opdigtet-4@aula.example', 'SUMMARY:Sommerfest i Børnehuset Solsikken for Mads', `DTSTART;${tz}:${d(4)}T150000`, `DTEND;${tz}:${d(4)}T170000`, 'LOCATION:Børnehuset Solsikken', kun('Mads Opdigtet', 'mads@boernehuset.example'), `DESCRIPTION:${LANG_TEKST}`),
    hendelse('opdigtet-5@aula.example', 'SUMMARY:Aflyst skovtur', 'STATUS:CANCELLED', `DTSTART;${tz}:${d(2)}T090000`),
    hendelse('opdigtet-6@aula.example', 'SUMMARY:Næste måneds forældrekaffe', `DTSTART;${tz}:${dato(f.plus(1 + 20))}T080000`),
  ].join('') + 'END:VCALENDAR\r\n';
}
