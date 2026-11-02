// KC-0214: a reply as an RFC 5322 message, for the connector's `kladde` verb
// (APPENDed to the account's Drafts folder; IMAP cannot send it). Pure. The
// subject and the Message-ID come from the sender (untrusted): control
// characters are dropped and the subject is MIME-encoded, so nothing from the
// mail can add a header line; an address that is not a plain address is
// refused rather than repaired. The body is the user's own text, in base64.

import { KildeFejl } from '../types.ts';

/** A plain address: no space, quote, angle bracket, comma, colon or semicolon (so never a second recipient or header). */
const ADRESSE = /^[^\s@<>()",;:\\[\]]{1,64}@[^\s@<>()",;:\\[\]]{1,190}$/;
const MESSAGE_ID = /^<[^<>\s]{1,250}>$/;
/** Bytes of UTF-8 per encoded word: base64 of 45 bytes is 60 chars, 72 with =?UTF-8?B?…?= (RFC 2047's limit is 75). */
const ORD_BYTES = 45;

// eslint-disable-next-line no-control-regex
const ren = (v: string): string => v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

/** A header value as is when it is printable ASCII, else RFC 2047 encoded words folded onto continuation lines. */
function hovedVaerdi(v: string): string {
  if (/^[\x20-\x7e]*$/.test(v) && v.length <= 900) return v;
  const ord: string[] = [];
  let del = '';
  for (const tegn of v) {
    if (Buffer.byteLength(del + tegn, 'utf8') > ORD_BYTES) { ord.push(del); del = ''; }
    del += tegn;
  }
  if (del) ord.push(del);
  return ord.map((o) => `=?UTF-8?B?${Buffer.from(o, 'utf8').toString('base64')}?=`).join('\r\n ');
}

/** RFC 5322 date in UTC: "Sat, 31 Oct 2026 10:00:00 +0000". */
const dato = (nu: Date): string => nu.toUTCString().replace(/GMT$/, '+0000');

export function kladdeBesked(o: { fra: string; til: string; emne: string; messageId?: string; tekst: string; nu: Date; id: string }): string {
  if (!ADRESSE.test(o.til)) throw new KildeFejl(409, 'Mailen har ingen afsender, Clawco kan skrive en kladde til.');
  if (!ADRESSE.test(o.fra)) throw new KildeFejl(409, 'Mailkontoens adresse er ugyldig.');
  if (!/^[A-Za-z0-9-]{1,80}$/.test(o.id)) throw new Error('ugyldigt kladde-id');
  const emne = ren(o.emne) || '(uden emne)';
  const svarEmne = /^re:/i.test(emne) ? emne : `Re: ${emne}`;
  const messageId = o.messageId && MESSAGE_ID.test(o.messageId) ? o.messageId : undefined;
  const domaene = o.fra.slice(o.fra.indexOf('@') + 1);
  const krop = Buffer.from(o.tekst.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
  return [
    `From: ${o.fra}`,
    `To: ${o.til}`,
    `Subject: ${hovedVaerdi(svarEmne)}`,
    `Date: ${dato(o.nu)}`,
    `Message-ID: <${o.id}@${domaene}>`,
    ...(messageId ? [`In-Reply-To: ${messageId}`, `References: ${messageId}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    krop,
  ].join('\r\n');
}
