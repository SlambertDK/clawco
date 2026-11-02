// The owner's cost card in the test world (KC-0212): a small invented ledger and the paid MRR per
// moment, so the card is green most of the day, amber in the evening (the extra server's trigger is
// near) and red late in the evening (it was switched on before the customers covered it). Validated
// by the same validator as the real ledger. All names invented (the deny-list holds).

import { validerOmkostninger, type Omkostninger } from '../../omkostninger/regnskab.ts';

const gratis = (navn: string, note: string) => ({ navn, maanedlig: 0, aktiv: true, note, udloeser: null });
const ekstraServer = (aktiv: boolean) => ({
  navn: 'Ekstra server', maanedlig: 5600, fra: true, aktiv, kilde: 'Udbyderens prisside, billigste model', laest: '2026-10-01',
  note: 'Når betaen vokser ud af serveren i kælderen.', udloeser: { mrrGange: 2 },
});

function regnskab(ekstraTaendt: boolean): Omkostninger {
  return validerOmkostninger({
    ressourcer: {
      kaelder: gratis('Serveren i kælderen', 'Allerede betalt.'),
      tunnel: gratis('Tunnel ud til nettet', 'Gratis; ingen port åbnes.'),
      kopier: gratis('Sikkerhedskopier, gratis lag', '0 kr op til 10 GB.'),
      betalinger: gratis('Betalinger', 'Kun gebyr per betaling.'),
      'ekstra-server': ekstraServer(ekstraTaendt),
    },
  });
}

/** Paid MRR in øre per moment; absent = 0 (no paying customers yet). 9.000 øre is 80 % of the extra server's 11.200 trigger. */
const MRR: Record<string, number> = { aften: 9000, 'sent-aften': 4000 };
/** The moments where the extra server is switched on. */
const TAENDT = new Set(['sent-aften']);

export function testOmkostninger(momentId: string): { regnskab: Omkostninger; mrr: number } {
  return { regnskab: regnskab(TAENDT.has(momentId)), mrr: MRR[momentId] ?? 0 };
}
