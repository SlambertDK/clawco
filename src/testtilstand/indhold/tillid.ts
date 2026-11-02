// The test world's rules file (KC-0142): what the fictional Henrik lets Hermes
// do on its own — one rule per trin 0–4 (KC-0143; the trin-0 one is for every
// source, "gælder alt"), one he wrote wrong (a limit is never a rule) and an id
// he deleted by hand (R-0006 stays taken). In "Næste morgen" he edited the file
// in the night and lost the naeste-id line, so the whole file fails closed, Nu
// shows "Reglerne kan ikke læses" and the night's bill is not written on its
// own (it waits as a card). All invented; dates follow the test day.

import { plusDag } from './fakta.ts';

const regler = (d: (n: number) => string): string => `## R-0001 · Nyhedsbreve sorteres i mapper
- trin: 1
- gaelder: mail / nyhedsbrev
- oprindelse: import ${d(-30)}
- status: aktiv

Nyhedsbreve og kvitteringer flyttes fra Indbakken til deres mapper. Intet slettes.

## R-0002 · Abonnementer skrives i budgettet
- trin: 2
- gaelder: mail / regning
- oprindelse: ret ${d(-19)} (kort regning:streamly)
- status: aktiv

En kvittering fra et abonnement bliver til en linje i det private budget, med Fortryd.

## R-0003 · Møder får en forberedelse
- trin: 3
- gaelder: kalender / møde
- oprindelse: haand ${d(-11)}
- status: aktiv

Dagen før et møde samler Hermes det, vi sagde sidst, i mødets univers. Intet sendes.

## R-0004 · Løbeturen flyttes, når et møde rammer den
- trin: 4
- gælder: kalender / træning
- oprindelse: ikke-relevant ${d(-7)} (kort kalender:loeb)
- status: aktiv

Hermes flytter løbeturen til samme dag senere og skriver det i loggen med Fortryd.

## R-0005 · Betal regninger selv
- trin: grænse
- gaelder: mail / regning
- oprindelse: haand ${d(-3)}
- status: aktiv

Betal vandregningen, når den kommer.

## R-0007 · Hermes ser alt og foreslår
- trin: 0
- gaelder: *
- oprindelse: haand ${d(-2)}
- status: aktiv

Hermes må læse med overalt og foreslå, men gør intet af sig selv ud over de andre regler.
`;

/** The rules file's text at `momentId` on the test day `dag` (markdown, as Henrik would edit it). */
export function reglerTekst(momentId: string, dag: string): string {
  const r = regler((n) => plusDag(dag, n));
  if (momentId === 'naeste-morgen') return `# Regler for Clawco\n\nRettet i nat.\n\n${r}`;
  return `# Regler for Clawco\n\nnaeste-id: R-0008\n\nDet, Hermes må gøre af sig selv.\n\n${r}`;
}
