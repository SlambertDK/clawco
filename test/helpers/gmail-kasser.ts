// KC-0135: a Gmail-shaped mailbox for the fake IMAP server: INBOX and one flagged Sent folder.

import type { FalskPostkasse } from './falsk-imap.ts';

export const GMAIL_KASSER: FalskPostkasse[] = [
  { navn: 'INBOX', beskeder: [
    { uid: 11, flags: ['\\Seen'], dato: '2026-10-30T08:15:00Z', emne: 'Tilbud på eltavle', fra: { navn: 'Elektrikeren', adresse: 'tilbud@el.example' }, messageId: '<a1@el.example>' },
    { uid: 12, dato: '2026-10-31T06:00:00Z', emne: 'Svar inden fredag', fra: { adresse: 'ven@x.example' } },
  ] },
  { navn: '[Gmail]/Sent Mail', specialUse: '\\Sent', beskeder: [{ uid: 1, flags: ['\\Seen'], dato: '2026-10-28T10:00:00Z' }] },
];
