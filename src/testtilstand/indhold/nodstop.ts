// The moment "Sat på pause" (KC-0124): the next morning, Maja pressed Stop alt
// at 07.52 and Clawco waits for Henrik to start it again. Its audit log shows
// what Clawco did before the stop and what it said no to. All invented.

import type { Fakta } from './fakta.ts';
import type { PauseTilstand } from '../../graenser/nodstop.ts';
import type { Revision } from '../../graenser/revisionslog.ts';

export function pauseFroe(f: Fakta): { pause: PauseTilstand; revision: Revision[] } {
  const t = (hhmm: string): string => f.iso(hhmm, 1);
  const g = { zoner: ['privat' as const], kilde: 'graense' };
  return {
    pause: { pause: true, tid: t('07:52'), person: 'maja' },
    revision: [
      { ...g, tid: t('07:08'), person: 'ingen', kanal: 'planlagt', rum: 'nyheder', verb: 'laes', udfald: 'tillad', hvorfor: 'Inden for grænserne.', handlingId: 'opdater' },
      { ...g, tid: t('07:21'), person: 'henrik', kanal: 'knap', rum: 'mail', verb: 'sorter', udfald: 'tillad', hvorfor: 'Inden for grænserne.', handlingId: 'faerdig|mailId=4102' },
      { ...g, tid: t('07:30'), person: 'henrik', kanal: 'stemme', rum: 'mail', verb: 'send-til-andre', udfald: 'afvist', hvorfor: 'Clawco må ikke skrive til andre på et ord fra stemmen. Tryk selv på knappen på skærmen.', handlingId: 'svar-elektriker' },
      { ...g, tid: t('07:44'), person: 'henrik', kanal: 'knap', rum: 'hjem', verb: 'betal', udfald: 'afvist', hvorfor: 'Clawco betaler aldrig noget. Det gør du selv.', handlingId: 'regning:roervang-vvs' },
      { tid: t('07:52'), person: 'maja', kanal: 'knap', rum: 'alle', verb: 'stop', udfald: 'stop', hvorfor: 'Stop alt: 1 opgave blev standset.', zoner: [], kilde: 'nodstop' },
    ],
  };
}
