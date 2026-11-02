// Cohorts and the rollout's constants (KC-0186), in this one file: the order a release reaches tenants in, how
// long each cohort must stay healthy on it before the next one starts, how many tenants of one node are replaced
// at once, and how long the rollout waits around a gateway change and for /health.
import { createHash } from 'node:crypto';

export type Hold = 'intern' | 'kanari' | 'alle';
export const HOLD: readonly Hold[] = ['intern', 'kanari', 'alle'];

/** How long every tenant of a cohort must stay healthy on the new sha before the next cohort starts. */
export const PROEVETID_MS: Readonly<Record<Hold, number>> = { intern: 10 * 60_000, kanari: 60 * 60_000, alle: 0 };
/** Tenants replaced at the same time on one node (never all of a node's tenants, see samtidige). */
export const SAMTIDIGE_PR_NODE = 2;
/** The share of the non-internal tenants in kanari (at least one). */
export const KANARI_ANDEL = 0.05;
/** The gateway caches a route 5 s (gateway/rute.ts); the rollout waits this long around each route change. */
export const GATEWAY_CACHE_MS = 6_000;
/** /health must show the expected sha within 60 s: 30 tries 2 s apart. */
export const SUND_FRIST = { forsoeg: 30, ms: 2_000 } as const;
/** During the soak a healthy tenant may miss a beat: 3 tries 2 s apart before it counts as unhealthy. */
export const PROEVE_FRIST = { forsoeg: 3, ms: 2_000 } as const;
/** Restore points are pruned this many days after the rollout ended. */
export const GENOPRET_DAGE = 7;
/** The lease of one operator command on a rollout; renewed while it works. */
export const LAAS_MS = 2 * 60_000;

export function naesteHold(h: Hold): Hold | null {
  return HOLD[HOLD.indexOf(h) + 1] ?? null;
}

/** At most SAMTIDIGE_PR_NODE at once, and never every tenant of the node (one when it has one or two). */
export function samtidige(antalPaaNode: number): number {
  return Math.max(1, Math.min(SAMTIDIGE_PR_NODE, antalPaaNode - 1));
}

const noegle = (slug: string) => createHash('sha256').update(slug).digest('hex');

/** The `alle` tenants to move into kanari so it holds ceil(5 %) of the non-internal tenants, at least one. Picked by
 *  a hash of the slug: stable across runs and spread over sign-up order, so kanari is not just the oldest. */
export function kanariMangler(t: readonly { slug: string; hold: Hold }[]): string[] {
  const ikkeIntern = t.filter((x) => x.hold !== 'intern');
  if (!ikkeIntern.length) return [];
  const maal = Math.max(1, Math.ceil(ikkeIntern.length * KANARI_ANDEL));
  const mangler = maal - ikkeIntern.filter((x) => x.hold === 'kanari').length;
  if (mangler <= 0) return [];
  return ikkeIntern.filter((x) => x.hold === 'alle').map((x) => x.slug).sort((a, b) => (noegle(a) < noegle(b) ? -1 : 1)).slice(0, mangler);
}
