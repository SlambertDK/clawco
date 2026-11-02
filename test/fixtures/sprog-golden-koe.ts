// KC-0170 slice 3: the Kø panel's server-rendered lists (what Clawco has done, the cost card) and the shared picture
// renderer, as fixed cases. The goldens in test/fixtures/sprog-koe/ were captured before the strings moved into the
// shell table; Danish (no language chosen) must still match them byte for byte.

import { renderRevision } from '../../src/shell/revision.ts';
import { renderOmkostninger } from '../../src/shell/omkostninger.ts';
import { billede, mere } from '../../src/shell/visuel.ts';
import { html } from '../../src/shell/html.ts';
import { daekning, validerOmkostninger } from '../../src/omkostninger/regnskab.ts';
import type { Revisionslinje } from '../../src/graenser/revisionslog.ts';

export const NU = new Date('2026-10-31T13:30:00Z'); // 14.30 in Copenhagen
const l = (o: Partial<Revisionslinje>): Revisionslinje => ({
  tid: '2026-10-31T13:05:00.000Z', person: 'henrik', kanal: 'knap', rum: 'dagen', verb: 'laes', udfald: 'tillad', hvorfor: 'Inden for grænserne.', zoner: ['privat'], kilde: 'graense', forrige: '0'.repeat(64), ...o,
});
const navne = { henrik: 'Henrik', maja: 'Maja' };
const rev = (linjer: Revisionslinje[]) => (): string => String(renderRevision(linjer, { nu: NU, navne }));

/** Every verb, channel and outcome once. `hvorfor` is the reason the policy layer wrote (src/graenser, Danish there). */
const VERBER = ['laes', 'sorter', 'bogfoer', 'forbered', 'udfoer-med-fortryd', 'send-til-andre', 'slet', 'betal', 'kopier-paa-tvaers', 'ukendt-verb'];
const KANALER = ['knap', 'stemme', 'chat', 'agent', 'planlagt', 'stoette'] as const;

export const REVISION: Record<string, () => string> = {
  tom: rev([]),
  fuld: rev([
    ...VERBER.map((verb, i) => l({ verb, rum: i % 2 ? 'mail' : 'dagen', tid: `2026-10-${30 - (i % 2)}T0${i % 10}:15:00.000Z` })),
    ...VERBER.map((verb) => l({ verb, udfald: 'afvist', rum: 'mail', hvorfor: 'Reason one.' })),
    ...VERBER.map((verb) => l({ verb, udfald: 'kraever-ja', rum: 'univers-ab12', hvorfor: 'Reason two.' })),
    ...KANALER.map((kanal) => l({ kanal })),
    l({ udfald: 'stop', verb: 'stop', rum: 'alle', kilde: 'nodstop', person: 'maja', zoner: [], hvorfor: 'Stopped: 2 tasks.' }),
    l({ udfald: 'genoptag', verb: 'genoptag', rum: 'alle', kilde: 'nodstop', zoner: [] }),
    l({ tid: 'ikke en tid' }),
  ]),
  ingenNej: rev([l({}), l({ kanal: 'chat', verb: 'sorter', rum: 'mail' })]),
  stoette: rev([
    l({ kilde: 'stoette', verb: 'stoette-givet', kanal: 'stoette', hvorfor: 'Granted.' }),
    l({ kilde: 'stoette', verb: 'stoette-start', kanal: 'stoette', person: 'stoette:42', hvorfor: 'Started.' }),
    l({ kilde: 'stoette', verb: 'stoette-aabnet', kanal: 'stoette', person: 'stoette:42', rum: '/rum/mail' }),
    l({ kilde: 'stoette', verb: 'stoette-aabnet', kanal: 'stoette', person: 'stoette', rum: '/rum/start', udfald: 'afvist', hvorfor: 'No.' }),
    l({ kilde: 'stoette', verb: 'stoette-slut', kanal: 'stoette', hvorfor: 'Ended.' }),
    l({ kilde: 'stoette', verb: 'stoette-udloeb', kanal: 'stoette', hvorfor: 'Expired.' }),
    l({ kilde: 'stoette', verb: 'stoette-andet', kanal: 'stoette', hvorfor: 'Other.' }),
  ]),
};

const betalt = (aktiv: boolean, navn: string, maanedlig = 5600) => ({ navn, maanedlig, aktiv, kilde: 'k', laest: '2026-10-31', udloeser: { mrrGange: 2 } });
const gratis = (navn: string) => ({ navn, maanedlig: 0, aktiv: true, udloeser: null });
const omk = (r: Record<string, unknown>, mrr: number) => (): string => String(renderOmkostninger(daekning(validerOmkostninger({ ressourcer: r }), mrr)));

export const OMKOSTNINGER: Record<string, () => string> = {
  fejl: () => String(renderOmkostninger('fejl')),
  groen: omk({ a: gratis('Server A'), b: gratis('Server B') }, 0),
  gratisEn: omk({ a: gratis('Server A') }, 0),
  roed: omk({ a: gratis('Server A'), b: betalt(true, 'Extra server') }, 0),
  gul: omk({ a: gratis('Server A'), b: betalt(false, 'Extra server') }, 9000),
  klar: omk({ a: betalt(true, 'First', 100), b: betalt(false, 'Second', 129000) }, 500000),
  daekket: omk({ a: betalt(true, 'First', 140) }, 100000),
  stort: omk({ a: betalt(true, 'Big', 129000), b: betalt(false, 'Spare', 5600) }, 1000000),
};

export const BILLEDER: Record<string, () => string> = {
  beloebOver: () => String(billede({ art: 'beloeb', vaerdi: 18400, graense: 15800, enhed: 'kr.', tekst: 'Offer', graenseTekst: 'Budget' })),
  beloebLige: () => String(billede({ art: 'beloeb', vaerdi: 4210, graense: 4210, enhed: 'kr.', tekst: 'Invoice', graenseTekst: 'Offer' })),
  beloebUnder: () => String(billede({ art: 'beloeb', vaerdi: 1290000, graense: 1500000, enhed: 'kr.', tekst: 'Offer', graenseTekst: 'Budget' })),
  nedtaelling: () => String(billede({ art: 'nedtaelling', minutter: 10, ialt: 60, tekst: 'Leave' })),
  prikker: () => String(billede({ art: 'prikker', antal: 3, ialt: 12, tekst: 'opened' })),
  dagslinjeNu: () => String(billede({ art: 'dagslinje', fra: 6, til: 22, zoner: [], punkter: [{ tid: '12:00', ikon: 'footprints', tekst: 'Run' }] }, { nu: new Date('2026-10-31T10:30:00Z'), dag: '2026-10-31' })),
  mere: () => String(mere(html`<p>Body</p>`)),
};
