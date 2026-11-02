// The renewal reminder before an annual renewal (KC-0209): who is due is the pure paamindelseForfald (forbrugerret.ts);
// this reads the rows, sends the mail and remembers the period it was sent for, so one period gets one reminder.
// NOT wired to a clock: Sky has no scheduler that sends mail yet (the loops in server.ts are the fleet, key purge
// and backups). Until someone wires sendPaamindelser to one (follow-up), the terms keep saying that no reminder is
// sent (docs/legal/vilkaar.*.md section 9).
import type { Database } from '../db/pool.ts';
import { dato, paamindelseForfald, type FornyelseRaekke } from './forbrugerret.ts';
import { hentBestilling, markerPaamindet } from './bestilling.ts';
import { kontoLink, prisTekst, produktNavn, sendMail, type KoebDeps } from './kvittering.ts';
import type { IntervalNavn } from './opsaet.ts';

type Raekke = { bestilling_id: unknown; konto_id: unknown; stripe_abonnement: string; interval: IntervalNavn; status: string; periode_slutter: Date | string | null; opsiges: Date | string | null; paamindet_for: Date | string | null };
const dn = (v: Date | string | null): Date | null => (v === null ? null : new Date(v));

/** Every annual order with its subscription's current entitlement (the webhook keeps that row fresh). */
export async function fornyelseRaekker(db: Database): Promise<FornyelseRaekke[]> {
  const rk = await db.query<Raekke>(
    `SELECT b.id AS bestilling_id, b.konto_id, r.stripe_abonnement, b.interval, r.status, r.periode_slutter, r.opsiges, b.paamindet_for
       FROM abonnement.bestilling b JOIN abonnement.rettigheder r ON r.stripe_abonnement = b.stripe_abonnement AND r.konto_id = b.konto_id
      WHERE b.interval = 'aar' AND r.kilde = 'stripe'`);
  return rk.map((r) => ({
    bestillingId: Number(r.bestilling_id), kontoId: Number(r.konto_id), abonnement: r.stripe_abonnement, interval: r.interval, status: r.status,
    periodeSlutter: dn(r.periode_slutter), opsiges: dn(r.opsiges), paamindetFor: dn(r.paamindet_for),
  }));
}

/** Sends the reminders that are due now. A failed mail is counted and tried again on the next pass. */
export async function sendPaamindelser(d: KoebDeps): Promise<{ sendt: number; fejl: number }> {
  let sendt = 0;
  let fejl = 0;
  for (const r of paamindelseForfald(await fornyelseRaekker(d.db), d.nu())) {
    const b = await hentBestilling(d.db, r.bestillingId);
    const k = await d.kontakt(r.kontoId);
    if (!b || !k || !r.periodeSlutter) continue;
    const ok = await sendMail(d, {
      til: k.email, skabelon: 'fornyelse', sprog: k.sprog,
      data: { saelger: d.saelger(k.sprog), produkt: produktNavn(d, b.plan), pris: prisTekst(b, k.sprog), dato: dato(r.periodeSlutter, k.sprog), link: kontoLink(d) },
    }, r.kontoId);
    if (!ok) { fejl++; continue; }
    await markerPaamindet(d.db, b.id, r.periodeSlutter);
    sendt++;
  }
  return { sendt, fejl };
}
