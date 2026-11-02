// KC-0226: the fixed input of the pinned privat prompt (privat-prompt.golden.txt). The golden is Kuratoren's prompt as
// it stood before the zone runs: a change to it is a change to every install's privat run, so it is made on purpose
// (regenerate with the script in test/kurator/zoner.test.ts's header comment), never as a side effect.

import type { KuratorInput } from '../../src/kurator/prompt.ts';
import type { KuratorBesked } from '../../src/rooms/module.ts';
import type { Kort } from '../../src/rooms/hjem/kort.ts';

const kort: Kort = {
  id: 'mail:folders-handling:242', type: 'familie', titel: 'Rikke beder om hjælp', betyder: 'Rikke vil have svar inden fredag.',
  grundlag: ['mail fra Rikke'], kilder: ['mail fra Rikke'], anbefaling: 'Svar i dag', prioritet: 1, gyldigTil: '2026-10-30',
};

export const PRIVAT_BESKED: KuratorBesked = { id: 'b-0123456789abcdef', kanal: 'signal', samtaleNavn: 'Maja', afsender: { navn: 'Maja (din kone)', personId: 'maja' }, tid: '2026-11-01T09:40:00.000Z', tekst: 'Kan du hente Ella kl. 15?', zone: 'privat' };

const NOW = new Date('2026-11-01T10:00:00Z');

/** The privat run with everything in it. */
export const PRIVAT_FULD: KuratorInput = {
  mails: [{ id: '242', mappe: 'Folders/Handling', emne: 'Kan du hjælpe?', fra: 'Rikke', modtaget: '2026-10-31T08:00:00Z' }],
  nyheder: ['PHP-sårbarhed rammer mange servere'],
  aabne: [kort],
  lukket: [{ id: 'mail:inbox:3', titel: 'Pakken er hentet', grund: 'Maja hentede den', dato: '2026-10-30' }],
  dyb: false, now: NOW, stier: { vault: '/vault', personer: '/people' },
  beskeder: [PRIVAT_BESKED],
};

/** The deep privat run, mail from a connector, no messages. */
export const PRIVAT_DYB: KuratorInput = {
  mails: [], nyheder: null, aabne: [], dyb: true, now: NOW, stier: { vault: '/vault' }, mailKilde: 'forbindelse',
};
