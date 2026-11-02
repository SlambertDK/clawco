// KC-0135: a failed Gmail connection as one sentence (Danish or English, KC-0170) and a health
// status. Fixed texts, never Google's or the server's own words (untrusted, and
// either could echo what it was sent), never a token. Google's refusals (the
// grant is gone) and the mail server refusing the token both mean "log in
// again" (KC-0139 shows it at once); a server that does not answer keeps
// KC-0134's classification.

import { klassificer } from '../mail-imap/fejl.ts';
import { GoogleFejl } from '../google/oauth.ts';
import type { HelbredStatus } from '../types.ts';
import { sproglig } from '../tekst-hjaelp.ts';
import { GMAIL_TEKSTER } from './tekster.ts';

/** The fixed sentences, in the language of the request (read at the time they are used, KC-0170). */
export const GMAIL_FEJLTEKST: { readonly adgang: string; readonly tom: string } = sproglig({ da: GMAIL_TEKSTER.da.fejl, en: GMAIL_TEKSTER.en.fejl });

export type GmailKlassifikation = { status: Extract<HelbredStatus, 'log-ind-igen' | 'nede'>; tekst: string; http: 400 | 502 };

/** The error and its causes, outermost first (imapflow and Node wrap errors). */
function kaede(err: unknown): Record<string, unknown>[] {
  const ud: Record<string, unknown>[] = [];
  let e = err;
  while (typeof e === 'object' && e !== null && ud.length < 5) { ud.push(e as Record<string, unknown>); e = (e as { cause?: unknown }).cause; }
  return ud;
}

/** The mail server refused the access token (imapflow marks a tagged NO as authenticationFailed). */
export const erLoginAfvist = (err: unknown): boolean => kaede(err).some((e) => e['authenticationFailed'] === true);

export function klassificerGmail(err: unknown): GmailKlassifikation {
  if (err instanceof GoogleFejl) return { status: err.art === 'afvist' ? 'log-ind-igen' : 'nede', tekst: err.message, http: err.art === 'afvist' ? 400 : 502 };
  if (erLoginAfvist(err)) return { status: 'log-ind-igen', tekst: GMAIL_FEJLTEKST.adgang, http: 400 };
  const k = klassificer(err, { loopback: false });
  return { status: k.status, tekst: k.tekst, http: k.http };
}
