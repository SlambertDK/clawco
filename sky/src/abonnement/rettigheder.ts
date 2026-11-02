// What an account may use (KC-0192): a pure function of the subscription Stripe holds now, the
// price config and the clock. Plan and member limit come from the lookup key through
// config/priser.json (AGENTS §0 r6). Fail closed (§0 r7): an unknown price or status grants nothing
// new and keeps the previous entitlement, with an alert for the log. A gift (kilde "gave", KC-0203)
// is never touched by Stripe state. Nobody is removed or locked out for being over the member limit:
// invites stop and the owner is told (anything stronger is a product decision, §0 r12).
import type { Priser } from './priser.ts';
import type { AbonnementSnapshot } from './stripe-klient.ts';
import { lookupKey } from './opsaet.ts';

export type RettighedsStatus = 'proeve' | 'aktiv' | 'forfalden' | 'pause' | 'opsagt' | 'ingen';

/** Dates as ISO strings: the row compares and serialises (outbox jsonb) without surprises. */
export type Rettighed = {
  kilde: 'stripe' | 'gave';
  /** A plan id from config/priser.json, or "ingen". */
  plan: string;
  status: RettighedsStatus;
  medlemmerMax: number;
  proeveSlutter: string | null;
  periodeSlutter: string | null;
  opsiges: string | null;
  forfaldenSiden: string | null;
  skrivebeskyttet: boolean;
  /** The Stripe subscription the entitlement was computed from. */
  abonnement: string | null;
};

export const INGEN: Rettighed = Object.freeze({
  kilde: 'stripe', plan: 'ingen', status: 'ingen', medlemmerMax: 0,
  proeveSlutter: null, periodeSlutter: null, opsiges: null, forfaldenSiden: null, skrivebeskyttet: false, abonnement: null,
});

const DAG_MS = 86_400_000;
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function planFraLookupKey(key: string | null, priser: Priser): string | null {
  if (!key) return null;
  for (const plan of Object.keys(priser.planer)) {
    if (key === lookupKey(plan, 'maaned') || key === lookupKey(plan, 'aar')) return plan;
  }
  return null;
}

/** The subscription's plan: from its price's lookup key, else (an archived price whose key moved to a new price
 *  after a config change, KC-0193 S7) from the price's clawco_plan metadata. Null when the config knows neither. */
export function planFraAbonnement(s: Pick<AbonnementSnapshot, 'lookupKey' | 'prisPlan'>, priser: Priser): string | null {
  return planFraLookupKey(s.lookupKey, priser) ?? (s.prisPlan && Object.hasOwn(priser.planer, s.prisPlan) ? s.prisPlan : null);
}

const LEVENDE = new Set(['trialing', 'active', 'past_due', 'unpaid', 'paused']);
const KENDTE = new Set([...LEVENDE, 'canceled', 'incomplete', 'incomplete_expired']);
const rang = (s: string): number => (LEVENDE.has(s) ? 3 : !KENDTE.has(s) ? 2 : s === 'incomplete' ? 1 : 0);

/** The subscription that decides: a live one before anything else, then the newest. */
export function vaelgAbonnement(alle: AbonnementSnapshot[]): AbonnementSnapshot | null {
  let bedst: AbonnementSnapshot | null = null;
  for (const a of alle) {
    if (!bedst) { bedst = a; continue; }
    const d = rang(a.status) - rang(bedst.status) || a.oprettet.getTime() - bedst.oprettet.getTime() || a.id.localeCompare(bedst.id);
    if (d > 0) bedst = a;
  }
  return bedst;
}

/** Paused, cancelled, unpaid, or overdue for fristVedFejl days or more. */
export function erSkrivebeskyttet(r: Rettighed, priser: Priser, nu: Date): boolean {
  if (r.skrivebeskyttet || r.status === 'pause' || r.status === 'opsagt') return true;
  return r.status === 'forfalden' && r.forfaldenSiden !== null && nu.getTime() >= new Date(r.forfaldenSiden).getTime() + priser.fristVedFejl * DAG_MS;
}

export function beregnRettigheder(
  a: { snapshot: AbonnementSnapshot | null; forrige: Rettighed | null },
  priser: Priser,
  nu: Date,
): { rettighed: Rettighed; advarsel: string | null } {
  const { snapshot: s, forrige } = a;
  if (forrige?.kilde === 'gave') return { rettighed: forrige, advarsel: null };
  if (!s) return { rettighed: { ...INGEN }, advarsel: null };
  const behold = (advarsel: string) => ({ rettighed: forrige ?? { ...INGEN }, advarsel });

  if (!KENDTE.has(s.status)) return behold(`ukendt status ${s.status} på abonnement ${s.id}: intet ændret`);
  const plan = planFraAbonnement(s, priser);
  if (plan === null) return behold(`ukendt pris ${s.prisId ?? '?'} (lookup key ${s.lookupKey ?? 'ingen'}) på abonnement ${s.id}: intet ændret`);

  const opsiges = iso(s.opsigesVed ?? (s.opsigVedPeriodeslut ? s.periodeSlut : null));
  const med = (status: RettighedsStatus, extra: Partial<Rettighed> = {}): Rettighed => ({
    kilde: 'stripe', plan, status, medlemmerMax: priser.planer[plan]!.medlemmer,
    proeveSlutter: iso(s.proeveSlut), periodeSlutter: iso(s.periodeSlut), opsiges, forfaldenSiden: null, skrivebeskyttet: false, abonnement: s.id, ...extra,
  });
  let r: Rettighed;
  switch (s.status) {
    case 'trialing': r = med('proeve'); break;
    case 'active': r = med('aktiv'); break;
    case 'past_due': r = med('forfalden', { forfaldenSiden: iso(s.forfaldenSiden) }); break;
    case 'unpaid': r = med('forfalden', { forfaldenSiden: iso(s.forfaldenSiden), skrivebeskyttet: true }); break;
    case 'paused': r = med('pause', { opsiges: null, skrivebeskyttet: true }); break;
    case 'canceled': r = { ...INGEN, status: 'opsagt', skrivebeskyttet: true, abonnement: s.id }; break;
    default: r = { ...INGEN, abonnement: s.id }; break; // incomplete, incomplete_expired
  }
  return { rettighed: { ...r, skrivebeskyttet: erSkrivebeskyttet(r, priser, nu) }, advarsel: null };
}

/** True while one more member fits the plan (antal counts the owner). */
export function maaInvitere(r: Rettighed, antal: number): boolean {
  return r.plan !== 'ingen' && antal < r.medlemmerMax;
}

/** Over the limit (after a downgrade): who is over, and the smallest plan that fits, if any. */
export function overGraense(r: Rettighed, antal: number, priser: Priser): { antal: number; max: number; plan: string; forslag: string | null } | null {
  const plan = priser.planer[r.plan];
  if (!plan || antal <= r.medlemmerMax) return null;
  const passer = Object.values(priser.planer).filter((p) => p.medlemmer >= antal).sort((x, y) => x.medlemmer - y.medlemmer)[0];
  return { antal, max: r.medlemmerMax, plan: plan.navn, forslag: passer?.navn ?? null };
}
