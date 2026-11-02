// What is kept after an account is deleted, and why (KC-0206). The one list: the deletion receipt stores it
// (sletkvittering.beholdt) and the inventory proof (sky/test/konto/inventar.test.ts) allows exactly these places
// to still name the account id or its tenant's slug — anything else that does is a failed deletion.
// Claude's draft, not legal advice: every `lovkrav: true` reason is for a Danish lawyer (and the accountant) to
// confirm before it is relied on.
import { createHash } from 'node:crypto';

/** Backups holding the account are gone at most this many days after deletion: the nightly copies keep 30 days
 *  (drift/backup/opbevaring.ts) and a deleted tenant's data key is destroyed after 30 (hemmeligheder/). */
export const KOPIER_DAGE = 30;

export type Beholdt = { sted: string; hvad: string; hvorfor: string; lovkrav: boolean };

export const BEHOLDT: readonly Beholdt[] = [
  { sted: 'konto', hvad: 'kontoens nummer, oprettet, slettet, og hvilke vilkår og privatlivsversion der blev accepteret og hvornår (ingen mail, land eller sprog)',
    hvorfor: 'fakturaer og kvitteringen henviser til nummeret; vilkårsversionen viser hvilke vilkår aftalen fulgte, i forældelsesfristen', lovkrav: true },
  { sted: 'abonnement.kunde', hvad: 'Stripe-kundens id og landet til moms',
    hvorfor: 'bogføringsloven: regnskabsmateriale opbevares i 5 år; landet afgør momsen på fakturaerne', lovkrav: true },
  { sted: 'abonnement.rettigheder', hvad: 'den sidste plan og status (opsagt)',
    hvorfor: 'Stripes sene hændelser for et opsagt abonnement skal kunne slås op uden at give adgang igen', lovkrav: false },
  { sted: 'abonnement.rettigheds_haendelser', hvad: 'hvornår planen skiftede',
    hvorfor: 'dokumenterer de fakturerede perioder (bogføringsloven, 5 år)', lovkrav: true },
  { sted: 'abonnement.bestilling', hvad: 'hvad du blev vist ved købet (plan, pris, periode), hvilken version af vilkårene du sagde ja til, og hvornår du sagde ja til at starte med det samme',
    hvorfor: 'viser, hvad aftalen var, og at du blev oplyst om fortrydelsesretten; regnskabsmateriale i 5 år (bogføringsloven) og så længe et krav kan opstå', lovkrav: true },
  { sted: 'abonnement.fortrydelse', hvad: 'at du fortrød, hvornår, og hvad der skulle gives tilbage',
    hvorfor: 'beviset for fortrydelsen og for, hvad der blev gjort op (bogføringsloven, 5 år)', lovkrav: true },
  { sted: 'abonnement.refusion_opgave', hvad: 'en opgave om at tilbagebetale et beløb, og om den er udført',
    hvorfor: 'regnskabsmateriale: viser, at tilbagebetalingen er sket (bogføringsloven, 5 år)', lovkrav: true },
  { sted: 'stripe', hvad: 'kunden og fakturaerne hos Stripe (abonnementet er opsagt)',
    hvorfor: 'bogføringsloven: fakturaer opbevares i 5 år; Stripe er databehandler', lovkrav: true },
  { sted: 'flaade.tenant', hvad: 'din Clawcos tilfældige navn og tidspunkter, uden adresse',
    hvorfor: 'navnet gives aldrig til en anden kunde, og oprydningen kan se, at rester med navnet er vores at fjerne', lovkrav: false },
  { sted: 'hemmeligheder.tenant_noegle', hvad: 'at nøglen fandtes og hvornår den blev destrueret (selve nøglen slettes efter 30 dage)',
    hvorfor: 'beviset på, at sikkerhedskopierne ikke længere kan åbnes', lovkrav: false },
  { sted: 'drift.kopi', hvad: 'tidspunkter for sikkerhedskopierne af din Clawco (kopierne selv slettes efter 30 dage)',
    hvorfor: 'driftsstatus, uden indhold', lovkrav: false },
  { sted: 'drift.proeve', hvad: 'udfaldet af en gendannelsesprøve, hvis din Clawco var med i en',
    hvorfor: 'beviset på at sikkerhedskopier virker; uden indhold', lovkrav: false },
  { sted: 'sletkvittering', hvad: 'denne kvittering: et tal afledt af kontoens nummer, tidspunktet og denne liste',
    hvorfor: 'beviset på, at sletningen skete og hvornår', lovkrav: true },
];

/** The account id as the receipt holds it. */
export function kontoHash(kontoId: number): string {
  return createHash('sha256').update(`clawco-konto:${kontoId}`).digest('hex');
}
