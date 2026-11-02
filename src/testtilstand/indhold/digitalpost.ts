// KC-0232/KC-0233 in the test world (AGENTS §4 r11): the Danmark-pakke's Digital Post rule, two moments.
//   "Digital Post: Start-trinnet"  the mail is connected, no sender confirmed yet: Start shows the step with the one candidate
//                                  address the inbox offers (the spoof's address is not a candidate)
//   "Digital Post: mailen svarer ikke"  the sender is confirmed but the mail does not answer: Nu says "kan ikke se", never "ingen ny post"
//   "Ny Digital Post"              the sender is confirmed, one notice unseen (the other was marked "Set den" earlier): Nu shows
//                                  the card with the link to the person's chosen viewer; "Set den" in the browser makes it go
// Everything is invented: the senders are on `.example` (the world adds `digitalpost.example` to the hint domains, since no
// real address may stand in test data), no subject is a real letter, nothing is a real person or authority.

import type { Moment } from '../typer.ts';
import type { Fakta } from './fakta.ts';
import type { DanmarkTilstand } from '../../danmark/tilstand.ts';
import type { Kuvert as KildeKuvert } from '../../kilder/types.ts';

export const POST_START = 'post-start';
export const POST_KORT = 'post-kort';
export const POST_KAN_IKKE_SE = 'post-kan-ikke-se';
/** The moments, appended to the day's table (indhold/fakta.ts). The morning after the story's day. */
export const POST_MOMENTER: readonly Moment[] = [
  { id: POST_START, tid: '09:30', dagPlus: 1, navn: 'Digital Post: Start-trinnet', url: '/rum/start', replik: 'Hvordan får jeg besked om ny Digital Post?' },
  { id: POST_KORT, tid: '09:40', dagPlus: 1, navn: 'Ny Digital Post', url: '/rum/hjem', replik: 'Er der kommet ny Digital Post?' },
  { id: POST_KAN_IKKE_SE, tid: '09:50', dagPlus: 1, navn: 'Digital Post: mailen svarer ikke', url: '/rum/hjem', replik: 'Er der kommet ny Digital Post?' },
];
export const erPostMoment = (id: string): boolean => POST_MOMENTER.some((m) => m.id === id);

/** The invented notification sender, and the world's extra hint domain it sits on (verden.ts hands it to the app). */
export const POST_AFSENDER = 'post@notifikation.digitalpost.example';
export const POST_DOMAENE = 'digitalpost.example';
/** A look-alike that is not on a hint domain: the same subject, from another address. It never gives a card or a candidate. */
const SPOOF = 'post@notifikation-digitalpost.example';
const SET_ID = '<post-9102@notifikation.digitalpost.example>';

/** The envelopes the fake mail source adds at the two moments (an invented inbox: three notifications-looking mails). */
export function postKuverter(f: Fakta): KildeKuvert[] {
  const k = (id: string, emne: string, adresse: string, tid: string, plus: number): KildeKuvert => ({
    id, emne, fra: 'Digital Post (opdigtet)', fraEmail: adresse, modtaget: f.iso(tid, plus), laest: false, flag: false, vedhaeftning: false, messageId: `<post-${id}@${adresse.split('@')[1]}>`,
  });
  return [
    k('9101', 'Ny besked fra Fiktiv Kommune', POST_AFSENDER, '06:12', 1),
    k('9102', 'Du har ny Digital Post', POST_AFSENDER, '18:30', 0),
    k('9103', 'Du har ny Digital Post', SPOOF, '07:55', 1),
  ];
}

/** danmark/digital-post.json at the moment: none at "Start-trinnet" (nothing confirmed yet), the confirmed sender at "Ny Digital Post" with the older notice already marked. */
export function danmarkFroe(momentId: string): DanmarkTilstand | undefined {
  if (momentId === POST_KORT) return { afsendere: [POST_AFSENDER], set: [SET_ID], viser: 'mit.dk' };
  return momentId === POST_KAN_IKKE_SE ? { afsendere: [POST_AFSENDER], set: [], viser: 'borger.dk' } : undefined;
}
