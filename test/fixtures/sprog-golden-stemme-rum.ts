// KC-0241: fixed inputs for the spoken passages of Dagen, Mail, Nyheder and Skrive (src/rooms/<room>/stemme.ts): the
// résumé, the punkter with their choices and the sig sentences that also land on screen as data-sig. The files in
// test/fixtures/sprog-stemme-rum/ were captured from these inputs BEFORE the fixed words moved into the rooms' tables;
// the four test/rooms/<room>-stemme.test.ts hold the output to them byte for byte, with no language set and inside
// medSprog('da'). The shared content (titles, senders) has no Danish letters or words, so an English run shows only
// words the code owns; a few cases carry Danish content on purpose (punctuation, markdown, the "kl"-lead of a clock).
// A clock or a date is spoken by src/stemme/tale.ts, which is not the room's: an English check uses a `tid` that is no
// clock (CLOCKLESS) and leaves `frist` out, so it passes whatever that helper says. Change a golden only when the Danish
// copy changes on purpose.

import { stemmeDagen, sigAnbefaling, sigKalender } from '../../src/rooms/dagen/stemme.ts';
import { stemmeMail, sigBeslutning } from '../../src/rooms/mail/stemme.ts';
import { stemmeNyheder } from '../../src/rooms/nyheder/stemme.ts';
import { stemmeSkrive } from '../../src/rooms/skrive/stemme.ts';
import type { DagenState, KalenderPost } from '../../src/rooms/dagen/schema.ts';
import type { Beslutning, MailState } from '../../src/rooms/mail/schema.ts';
import type { NyhederState } from '../../src/rooms/nyheder/schema.ts';
import type { Dokument, SkriveState } from '../../src/rooms/skrive/schema.ts';
import type { StemmeRum } from '../../src/stemme/types.ts';
import type { LogEntry } from '../../src/store/types.ts';

const entry = (handlingId: string, extra: Partial<LogEntry> = {}): LogEntry => ({ id: `l-${handlingId}`, tid: '2026-10-27T08:00:00Z', kilde: 'hermes', tekst: 'Done.', handlingId, ...extra });
const h = (id: string, label: string) => ({ id, label, instruktion: 'i' });

// ---- Dagen ------------------------------------------------------------------------------------------------------------

export const dagenAnbefaling: DagenState['anbefaling'] = { tekst: 'Move the meeting to 14 <soon>', handling: h('rec-move', 'Move the meeting') };

/** Calendar posts with a clock time (the Danish goldens say "klokken 10"; an English check leaves these out). */
export const dagenMedTid: KalenderPost[] = [
  { tid: '10:00', titel: 'Status meeting', handling: h('cal-1-call', 'Call Anne') },
  { tid: '13.30', titel: 'Lunch' },
  { tid: '15:00', titel: 'Review', handling: h('cal-3-cancel', 'Cancel') },
];
/** The same without a clock: `tid` is a word, so tale.ts hands it back as it came in any language. */
export const dagenUdenKlokke: KalenderPost[] = [
  { tid: 'noon', titel: 'Status meeting', handling: h('cal-1-call', 'Call Anne') },
  { tid: 'evening', titel: 'Lunch' },
  { tid: 'night', titel: 'Review', handling: h('cal-3-cancel', 'Cancel') },
];

export const dagenState = (kalender: KalenderPost[]): DagenState => ({
  dato: '2026-10-27', genereret: '2026-10-27T05:00:00Z',
  treLinjer: ['Four meetings today', 'Rain in the afternoon.', 'The bill is due', ''],
  anbefaling: dagenAnbefaling, kalender, morgenavis: [], hermesStatus: 'ok',
});
const dagenDansk: DagenState = {
  ...dagenState([{ tid: 'kl. 9', titel: 'Møde med Anne', handling: h('d-1', 'Ring til Anne') }, { tid: 'i morgen', titel: 'Frokost' }]),
  treLinjer: ['Fire møder i dag', 'Regn om eftermiddagen.', 'Elregningen forfalder'],
  anbefaling: { tekst: 'Flyt mødet kl. 14 **hurtigt** [her](https://x.example/y)', handling: h('d-anb', 'Flyt mødet') },
};
const dagenUdenAnbefalingHandling: DagenState = { ...dagenState(dagenMedTid), anbefaling: { tekst: 'Just a note' } };

// ---- Mail -------------------------------------------------------------------------------------------------------------

const mulighed = (id: string, label: string) => ({ id, label, instruktion: 'i' });
export const mailSvar: Beslutning = { mailId: '242', emne: 'Quote for <b>the panel</b>', fra: 'Acme Electric <post@acme.example>', modtaget: '2026-10-26T18:57:39Z', type: 'svar', resume: 'A quote.', betydning: 'Reply before Friday', frist: '2026-10-30', udkast: 'Hello', arkivmappe: 'Folders/Afventer', muligheder: [mulighed('242-call', 'Call them')] };
const { frist: _frist, ...svarUdenFrist } = mailSvar;
export const mailSvarUdenFrist: Beslutning = { ...svarUdenFrist, mailId: '241' };
export const mailBrev: Beslutning = { mailId: '243', emne: 'Weekly energy news', fra: 'Newsletter', modtaget: '2026-10-25T12:40:00Z', type: 'nyhedsbrev', resume: 'x', betydning: 'You never open it.', arkivmappe: 'Archive', muligheder: [mulighed('243-unsub', 'Unsubscribe')] };
export const mailKlar: Beslutning = { mailId: '244', emne: 'Receipt', fra: 'Shop', modtaget: '2026-10-24T09:12:00Z', type: 'kvittering', resume: 'x', betydning: 'Nothing to do.', arkivmappe: 'Folders/koeb', muligheder: [], afgjort: { mulighedId: 'faerdig', tid: '2026-10-27T08:00:00Z' } };
const mailDansk: Beslutning = { mailId: '250', emne: 'Tilbud på eltavle', fra: 'Elektrikeren ApS <post@elek.example>', modtaget: '2026-10-26T18:57:39Z', type: 'svar', resume: 'x', betydning: 'Du skal svare inden fredag', frist: '2026-10-30T10:00:00', arkivmappe: 'Folders/Afventer', muligheder: [mulighed('250-ring', 'Ring til dem')] };
const mailUdenAfsender: Beslutning = { ...mailBrev, mailId: '251', fra: '<ghost@x.example>', betydning: '' };

export const mailState = (beslutninger: Beslutning[], extra: Partial<MailState> = {}): MailState => ({
  dato: '2026-10-27', genereret: '2026-10-27T08:40:00.000Z', tal: { handling: 3, afventer: 0, regninger: 0, sorteretIDag: 0 }, beslutninger, ordnet: [], hermesStatus: 'ok', ...extra,
});

// ---- Nyheder ----------------------------------------------------------------------------------------------------------

export const nyhederState = (extra: Partial<NyhederState> = {}): NyhederState => ({
  dato: '2026-10-27', genereret: '2026-10-27T05:00:00Z',
  femLinjer: ['Power prices fall', 'A new wind deal.', 'The budget is tabled', ''],
  baner: [{ navn: 'Me', nyheder: [{ id: 'n1', titel: 'x', hvorfor: 'y' }] }],
  forslag: [
    { id: 'f1', tekst: 'Save the wind article as a note', handling: h('forslag-1-gem', 'Save the note') },
    { id: 'f2', tekst: 'Consider subscribing to the weekly letter' },
    { id: 'f3', tekst: 'Read the report at the weekend **soon**', handling: h('forslag-3-laes', 'Add to reading list') },
  ],
  nyhedsbreve: [], kilder: { antal: 1, medNyheder: 1, nyheder: 1, fejlede: [] }, gemt: [], hermesStatus: 'ok', ...extra,
});

// ---- Skrive -----------------------------------------------------------------------------------------------------------

const dok = (id: string, titel: string): Dokument => ({ id, titel, brief: 'b', afsnit: [{ id: 'a1', tekst: 't' }], kilder: [], oprettet: '2026-10-27T10:00:00Z', aendret: '2026-10-27T10:00:00Z' });
export const skriveState = (dokumenter: Dokument[], aktivt: string | null): SkriveState => ({ dokumenter, aktivt, forslag: [], hermesStatus: 'ok' });
export const skriveAktiv = skriveState([dok('dok-1', 'First'), dok('dok-2', 'Mail to **Anne**!')], 'dok-2');
export const skriveFoerste = skriveState([dok('dok-1', 'First draft')], null);
export const skriveTom = skriveState([], null);

// ---- The cases --------------------------------------------------------------------------------------------------------

/** Every string a spoken view hands the voice: the résumé, each sig and each choice's label. */
export const stemmeTekster = (r: StemmeRum): string[] => [r.resume, ...r.punkter.flatMap((p) => [p.sig, ...p.valg.map((v) => v.label)])];

const j = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;

/** name → output as text; the file test/fixtures/sprog-stemme-rum/<name>.txt holds what no language set produced. */
export const STEMME_RUM: Record<string, () => string> = {
  'dagen-resume-fuld': () => j(stemmeDagen(dagenState(dagenMedTid), [])),
  'dagen-resume-nogle-udfoert': () => j(stemmeDagen(dagenState(dagenMedTid), [entry('rec-move'), entry('cal-1-call', { fortrudt: '2026-10-27T08:30:00Z' })])),
  'dagen-resume-alt-udfoert': () => j(stemmeDagen(dagenState(dagenMedTid), [entry('rec-move'), entry('cal-1-call'), entry('cal-3-cancel')])),
  'dagen-resume-uden-anbefaling-handling': () => j(stemmeDagen(dagenUdenAnbefalingHandling, [])),
  'dagen-resume-dansk-indhold': () => j(stemmeDagen(dagenDansk, [])),
  'dagen-resume-uden-klokke': () => j(stemmeDagen(dagenState(dagenUdenKlokke), [])),
  'dagen-ikke-bygget': () => j(stemmeDagen(null, [])),
  'dagen-sig-anbefaling': () => j(sigAnbefaling(dagenAnbefaling)),
  'dagen-sig-anbefaling-markdown': () => j(sigAnbefaling({ tekst: 'See [the plan](https://x.example/p) **now**' })),
  'dagen-sig-kalender-med-handling': () => j(sigKalender(dagenMedTid[0]!)),
  'dagen-sig-kalender-halv': () => j(sigKalender({ tid: '13.30', titel: 'Lunch', handling: h('x', 'Order food') })),
  'dagen-sig-kalender-uden-handling': () => j(sigKalender(dagenMedTid[1]!)),
  'dagen-sig-kalender-uden-klokke': () => j(sigKalender(dagenUdenKlokke[0]!)),
  'dagen-sig-kalender-kl-foran': () => j(sigKalender({ tid: 'kl. 9', titel: 'Møde med Anne', handling: h('x', 'Ring til Anne') })),
  'dagen-sig-kalender-lille-start': () => j(sigKalender({ tid: 'i morgen', titel: 'Frokost' })),

  'mail-sig-svar': () => j(sigBeslutning(mailSvar)),
  'mail-sig-svar-laese-kun': () => j(sigBeslutning(mailSvar, true)),
  'mail-sig-svar-uden-frist': () => j(sigBeslutning(mailSvarUdenFrist)),
  'mail-sig-nyhedsbrev': () => j(sigBeslutning(mailBrev)),
  'mail-sig-dansk-indhold': () => j(sigBeslutning(mailDansk)),
  'mail-sig-uden-afsender-og-betydning': () => j(sigBeslutning(mailUdenAfsender)),
  'mail-rum-flere': () => j(stemmeMail(mailState([mailSvar, mailBrev, mailKlar]))),
  'mail-rum-en': () => j(stemmeMail(mailState([mailBrev, mailKlar]))),
  'mail-rum-ingen': () => j(stemmeMail(mailState([mailKlar]))),
  'mail-rum-uden-beslutninger': () => j(stemmeMail(mailState([]))),
  'mail-rum-intet-state': () => j(stemmeMail(null)),
  'mail-rum-laese-kun': () => j(stemmeMail(mailState([mailSvar, mailBrev], { forbindelse: 'Gmail', laeseKun: true }))),
  'mail-rum-mange': () => j(stemmeMail(mailState(Array.from({ length: 12 }, (_, i) => ({ ...mailBrev, mailId: String(300 + i) }))))),

  'nyheder-fuld': () => j(stemmeNyheder(nyhederState(), [])),
  'nyheder-nogle-udfoert': () => j(stemmeNyheder(nyhederState(), [entry('forslag-1-gem')])),
  'nyheder-alt-udfoert': () => j(stemmeNyheder(nyhederState(), [entry('forslag-1-gem'), entry('forslag-3-laes')])),
  'nyheder-tom': () => j(stemmeNyheder(nyhederState({ femLinjer: [], forslag: [] }), [])),
  'nyheder-ikke-bygget': () => j(stemmeNyheder(null, [])),

  'skrive-aktivt': () => j(stemmeSkrive(skriveAktiv)),
  'skrive-foerste': () => j(stemmeSkrive(skriveFoerste)),
  'skrive-ingen-dokumenter': () => j(stemmeSkrive(skriveTom)),
  'skrive-intet-state': () => j(stemmeSkrive(null)),
  'skrive-dansk-titel': () => j(stemmeSkrive(skriveState([dok('d1', 'Brev til Søren?')], 'd1'))),
};
