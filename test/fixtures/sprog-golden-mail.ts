// KC-0170 slice 2: fixed inputs for Mail's screens, rendered without a chosen language. The files in
// test/fixtures/sprog-mail/ were captured from these inputs BEFORE the strings moved into src/rooms/mail/tekster.ts;
// test/rooms/mail-tekster.test.ts holds the renders to them byte for byte. The content (subjects, senders) has no
// Danish letters or words, so an English render shows only chrome the room owns. Change a golden only when the Danish
// copy changes on purpose.

import { renderMail, renderMailEmpty } from '../../src/rooms/mail/render.ts';
import type { MailState, Beslutning } from '../../src/rooms/mail/schema.ts';
import type { LogEntry } from '../../src/store/types.ts';
import { krop } from './sprog-golden.ts';

/** 09:00 on 27 Oct 2026 in Copenhagen (CET, UTC+1 since 25 Oct). */
export const MAIL_NU = new Date('2026-10-27T08:00:00.000Z');

const handling = (id: string, label: string, ekstra: Record<string, unknown> = {}) => ({ id, label, instruktion: 'i', ...ekstra });

const beslutninger: Beslutning[] = [
  { mailId: '242', emne: 'Quote for the panel', fra: 'Acme Electric', modtaget: '2026-10-26T18:57:39Z', type: 'svar', resume: 'A quote of 1840 EUR.', betydning: 'Reply before Friday.', frist: '2026-10-31', udkast: 'Hello, thanks for the quote.', arkivmappe: 'Folders/Afventer', muligheder: [handling('242-call', 'Call them'), handling('242-pay', 'Pay the quote', { verb: 'betal' })] },
  { mailId: '243', emne: 'Weekly energy news', fra: 'Newsletter', modtaget: '2026-10-25T12:40:00Z', type: 'nyhedsbrev', resume: 'A newsletter.', betydning: 'You never open it.', arkivmappe: 'Archive', muligheder: [handling('243-unsub', 'Unsubscribe')] },
  { mailId: '245', emne: 'Meeting moved', fra: 'Assistant', modtaget: '2026-10-27T05:12:00Z', type: 'aktion', resume: 'New time.', betydning: 'Check your calendar.', arkivmappe: 'Archive', muligheder: [handling('245-forward', 'Forward to team', { tilAndre: true })], visuel: { ikon: 'calendar', overskrift: 'Meeting moved to 14' } },
  { mailId: '246', emne: 'Shipping update', fra: 'Shop', modtaget: '2026-10-27T06:00:00Z', type: 'info', resume: 'On its way.', betydning: 'Nothing to do.', arkivmappe: 'Archive', muligheder: [] },
  { mailId: '247', emne: 'Parcel delivered', fra: 'Shop', modtaget: '2026-10-27T06:30:00Z', type: 'info', resume: 'Delivered.', betydning: 'Nothing to do.', arkivmappe: 'Archive', muligheder: [] },
  { mailId: '244', emne: 'Receipt', fra: 'Shop', modtaget: '2026-10-24T09:12:00Z', type: 'kvittering', resume: 'Order 123.', betydning: 'Nothing to do.', arkivmappe: 'Folders/koeb', muligheder: [], afgjort: { mulighedId: 'faerdig', tid: '2026-10-27T07:00:00Z' } },
  { mailId: '248', emne: 'Answer sent', fra: 'Acme Electric', modtaget: '2026-10-24T10:12:00Z', type: 'svar', resume: 'Sent.', betydning: 'Done.', arkivmappe: 'Folders/Afventer', muligheder: [], afgjort: { mulighedId: 'sendt', tid: '2026-10-27T07:10:00Z' } },
];

const ordnet = Array.from({ length: 10 }, (_, i) => ({
  mailId: String(300 + i), emne: i === 9 ? '' : `Invoice ${i + 1}`, fra: i % 2 ? 'Utility Co' : '', til: 'Folders/Regninger', hvorfor: i === 9 ? 'invoice' : 'invoice', tid: `2026-10-27T07:${String(10 + i).padStart(2, '0')}:00`, handling: { id: `ordnet-${300 + i}`, label: 'Undo', instruktion: 'i', fortryd: 'f' },
}));

const fuld: MailState = {
  dato: '2026-10-27', genereret: '2026-10-27T07:40:00.000Z',
  tal: { handling: 5, afventer: 1, regninger: 12, sorteretIDag: 10 },
  beslutninger, ordnet, hermesStatus: 'Watching the inbox',
};

const log: LogEntry[] = [
  { id: 'l1', tid: '2026-10-27T07:30:00Z', kilde: 'hermes', tekst: 'Moved the mail to the archive.', handlingId: '243-unsub', fortryd: 'x' },
  { id: 'l2', tid: '2026-10-27T07:20:00Z', kilde: 'hermes', tekst: 'Found the number.', handlingId: '242-call' },
  { id: 'l3', tid: '2026-10-27T06:50:00Z', kilde: 'hermes', tekst: 'Sorted the invoices.', fortrudt: '2026-10-27T06:55:00Z' },
  { id: 'l4', tid: '2026-10-27T07:05:00Z', kilde: 'system', tekst: 'Draft saved.', handlingId: 'kladde-242' },
  { id: 'l5', tid: '2026-10-26T07:05:00Z', kilde: 'hermes', tekst: 'Old entry, past the undo window.', fortryd: 'x' },
];

const igang = [{ id: 'r1', label: 'Reading the inbox', status: 'running' as const }];

export const MAIL: Record<string, () => string> = {
  fuld: () => krop(String(renderMail(fuld, log, MAIL_NU, igang, { slags: 'mail', sidstLaest: '2026-10-27T07:40:00.000Z', ok: true }))),
  gammelKilde: () => krop(String(renderMail({ ...fuld, genereret: '2026-10-25T07:40:00.000Z' }, [], MAIL_NU, [], { slags: 'mail', sidstLaest: '2026-10-25T07:40:00.000Z', ok: false }))),
  forbindelse: () => krop(String(renderMail({ ...fuld, forbindelse: 'me@example.com', tal: { handling: 7, afventer: 0, regninger: 0, sorteretIDag: 0 }, ordnet: [] }, [], MAIL_NU))),
  laeseKun: () => krop(String(renderMail({ ...fuld, forbindelse: 'me@example.com', laeseKun: true, ordnet: [] }, [], MAIL_NU))),
  tom: () => krop(String(renderMail({ ...fuld, beslutninger: [], ordnet: [], tal: { handling: 0, afventer: 0, regninger: 0, sorteretIDag: 0 } }, [], MAIL_NU))),
  rumTomt: () => krop(String(renderMailEmpty('Nothing read yet.'))),
};
