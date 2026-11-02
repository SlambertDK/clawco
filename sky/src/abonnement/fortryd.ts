// "Fortryd aftale" (KC-0209, Forbrugeraftaleloven § 20 a): the withdrawal function on the account page. One
// confirmation, then, in this order: (1) the request is recorded with its time, and with a payment behind it the
// owner's refund task (a row, with the proportional amount computed from the price and the days used), (2) the
// subscription is cancelled at once, (3) the receipt goes out by mail. The refund itself is made by the owner in
// Stripe by hand: no code in Sky refunds anything (AGENTS §9; sky/test/abonnement/opsigelse-saum.test.ts). If Stripe
// cannot cancel, the request stays recorded with its first time and the next press finishes it, once.
import type { Fortrydelse, Bestilling } from './bestilling.ts';
import {
  frigivFortrydKvittering, hentBestilling, hentFortrydelse, markerOpsagt, paataagFortrydKvittering, registrerFortrydelse, senesteFortrydbare, senesteFortrydelse, senesteStartede,
} from './bestilling.ts';
import { hentKundeRaekke } from './kunde.ts';
import { F } from './forbrugerret-tekster.ts';
import { FRIST_DAGE, beloeb, dato, forholdsmaessig, fristSidsteDag, tidspunkt, type Sprog } from './forbrugerret.ts';
import { produktNavn, sendMail, type KoebDeps } from './kvittering.ts';

const DAG_MS = 86_400_000;

export type Udregning = { periodeDage: number; brugteDage: number; beholdOere: number; tilbageOere: number };

/** The amounts: a trial paid nothing; otherwise the proportional split of the price the order kept (§ 25). */
export function udregn(b: Bestilling, nu: Date): Udregning {
  const u = forholdsmaessig({ prisOere: b.prisOere, interval: b.interval, startet: b.startet ?? nu, nu });
  return b.proeve ? { ...u, beholdOere: 0, tilbageOere: 0 } : u;
}

export type FortrydOversigt =
  | { art: 'klar'; bestilling: Bestilling; frist: Date; proeve: boolean } & Udregning
  | { art: 'udloebet'; frist: Date }
  | { art: 'allerede'; tid: Date }
  | { art: 'intet' };

/** What the confirmation screen says before anything happens: the amounts, or why there is nothing to withdraw. */
export async function fortrydOversigt(d: KoebDeps, kontoId: number): Promise<FortrydOversigt> {
  const nu = d.nu();
  const b = await senesteFortrydbare(d.db, kontoId, nu);
  if (b?.startet) return { art: 'klar', bestilling: b, frist: fristSidsteDag(b.startet), proeve: b.proeve, ...udregn(b, nu) };
  const f = await senesteFortrydelse(d.db, kontoId);
  if (f) return { art: 'allerede', tid: f.tidspunkt };
  const sidste = await senesteStartede(d.db, kontoId);
  return sidste?.startet ? { art: 'udloebet', frist: fristSidsteDag(sidste.startet) } : { art: 'intet' };
}

export type FortrydUdfald =
  | { art: 'fortrudt'; tid: Date; tilbageOere: number; proeve: boolean; mail: boolean }
  | { art: 'allerede'; tid: Date }
  | { art: 'udloebet'; frist: Date }
  | { art: 'intet' };

/** Withdraws. Throws when Stripe could not cancel (the request is recorded; pressing again finishes it). */
export async function fortryd(d: KoebDeps, a: { kontoId: number; email: string; sprog: Sprog }): Promise<FortrydUdfald> {
  const nu = d.nu();
  // A request that was recorded but not finished (Stripe was down): finish that one, with its first time.
  const aaben = await senesteFortrydelse(d.db, a.kontoId);
  let f: Fortrydelse | null = aaben && aaben.opsagtVed === null ? aaben : null;
  let b: Bestilling | null = f ? await hentBestilling(d.db, f.bestillingId) : null;
  if (!f) {
    const o = await fortrydOversigt(d, a.kontoId);
    if (o.art === 'allerede') return { art: 'allerede', tid: o.tid };
    if (o.art === 'udloebet') return { art: 'udloebet', frist: o.frist };
    if (o.art !== 'klar') return { art: 'intet' };
    b = o.bestilling;
    const r = await registrerFortrydelse(d.db, {
      bestillingId: b.id, kontoId: a.kontoId, tidspunkt: nu, brugteDage: o.brugteDage, periodeDage: o.periodeDage, tilbageOere: o.tilbageOere,
      forfald: new Date(nu.getTime() + FRIST_DAGE * DAG_MS), beloebOpgave: o.tilbageOere, valuta: b.valuta,
    });
    f = await hentFortrydelse(d.db, b.id);
    // The one place the owner is told: the journal line and the open row. The refund is his, in Stripe, by hand.
    if (r.ny && r.refusionId !== null) console.error(`sky abonnement: REFUSIONSOPGAVE ${r.refusionId}: konto ${a.kontoId} har fortrudt, ${beloeb(o.tilbageOere, 'da', b.valuta)} skal tilbagebetales i Stripe senest ${dato(new Date(nu.getTime() + FRIST_DAGE * DAG_MS), 'da')} og markeres udført`);
    else if (r.ny) console.log(`sky abonnement: konto ${a.kontoId} har fortrudt en gratis prøve (intet betalt, ingen refusion)`);
  }
  if (!f || !b || !b.stripeAbonnement) return { art: 'intet' };

  // Cancel at once (never at period end: the person has withdrawn). Already gone at Stripe is fine.
  if (d.klient) {
    const k = await hentKundeRaekke(d.db, a.kontoId);
    const ab = k ? (await d.klient.listAbonnementer(k.stripeKunde)).find((x) => x.id === b!.stripeAbonnement) : undefined;
    if (ab && ab.status !== 'canceled') await d.klient.opsigAbonnement(ab.id);
  }
  await markerOpsagt(d.db, b.id, nu);

  let mail = false;
  if (await paataagFortrydKvittering(d.db, b.id, nu)) {
    const t = F[a.sprog];
    mail = await sendMail(d, {
      til: a.email, skabelon: 'fortrydelse', sprog: a.sprog,
      data: {
        saelger: d.saelger(a.sprog), produkt: produktNavn(d, b.plan), tidspunkt: tidspunkt(f.tidspunkt, a.sprog),
        tilbage: f.tilbageOere > 0 ? t.fortrydMailTilbage(beloeb(f.tilbageOere, a.sprog, b.valuta)) : t.fortrydMailIntet,
      },
    }, a.kontoId);
    if (!mail) await frigivFortrydKvittering(d.db, b.id);
  }
  return { art: 'fortrudt', tid: f.tidspunkt, tilbageOere: f.tilbageOere, proeve: b.proeve, mail };
}
