// "Lad support se med" in the test world (KC-0188): in the moment "Mailen svarer ikke" Henrik has let support look
// along for an hour (since 08.25, until 09.25) to find out why; one staff member has started a session and opened Nu
// and Mail. Every other moment shows the switch off (the owner's card in the Kø panel). All invented.

import type { Fakta } from './fakta.ts';
import type { Revision } from '../../graenser/revisionslog.ts';
import type { StoetteAdgang } from '../../identitet/stoette.ts';

/** The moment with support looking along (coverage `stoette-aktiv`); every other moment has the card off (`stoette-slaaet-fra`). */
export const STOETTE_MOMENT = 'kilde-nede';

export function stoetteFroe(f: Fakta): { stoette: StoetteAdgang; revision: Revision[] } {
  const t = (hhmm: string): string => f.iso(hhmm, 1);
  const s = { kanal: 'stoette' as const, udfald: 'tillad' as const, zoner: [], kilde: 'stoette', handlingId: 'adgang:41' };
  return {
    stoette: { id: '41', givet: t('08:25'), udloeber: t('09:25'), timer: 1, grund: 'Mailen svarer ikke', sessioner: ['0123456789abcdef'] },
    revision: [
      { ...s, tid: t('08:25'), person: 'henrik', kanal: 'knap', rum: 'stoette', verb: 'stoette-givet', hvorfor: 'Ejeren lod support se med til kl. 09.25.' },
      { ...s, tid: t('08:27'), person: 'stoette:7', rum: 'stoette', verb: 'stoette-start', hvorfor: 'Support begyndte at kigge med.' },
      { ...s, tid: t('08:27'), person: 'stoette:7', rum: '/rum/hjem', verb: 'stoette-aabnet', hvorfor: 'Support åbnede en side.' },
      { ...s, tid: t('08:28'), person: 'stoette:7', rum: '/rum/mail', verb: 'stoette-aabnet', hvorfor: 'Support åbnede en side.' },
    ],
  };
}
