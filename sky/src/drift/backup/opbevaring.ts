// Retention (KC-0185, spec §2 `drift/` and §4): a snapshot is kept exactly OPBEVARING_DAGE (30 × 24 h) and
// never deleted earlier; the newest snapshot of a scope is never deleted by age, so a long run of failed
// nights still leaves the last good copy. A deleted tenant's snapshots stay until its data key's purge date
// (hemmeligheder.tenant_noegle.destrueres, KC-0181: the same 30 days) and then all go, together with the key.
// The time of a snapshot is read from its id, so the store's own listing is the truth (no clock skew from
// object metadata, no database needed to prune).

export const OPBEVARING_DAGE = 30;
const DAG_MS = 86_400_000;

/** 20261101T021345Z-0a1b2c3d: UTC to the second, then 8 random hex (two snapshots in one second differ). */
const ID = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-[0-9a-f]{8}$/;

export function snapshotId(nu: Date, tilfaeldig: string): string {
  if (!/^[0-9a-f]{8}$/.test(tilfaeldig)) throw new Error('et snapshot-id slutter med 8 hex-tegn');
  return `${nu.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z-${tilfaeldig}`;
}

export function snapshotTid(id: string): Date | null {
  const m = ID.exec(id);
  if (!m) return null;
  const t = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
  return Number.isNaN(t.getTime()) ? null : t;
}

/** Of one scope's snapshot ids: those older than 30 days, except the newest. Anything not an id is left alone. */
export function udloebne(ids: string[], nu: Date): string[] {
  const kendte = ids.map((id) => ({ id, t: snapshotTid(id) })).filter((x): x is { id: string; t: Date } => x.t !== null);
  if (!kendte.length) return [];
  const nyeste = kendte.reduce((a, b) => (b.t > a.t ? b : a));
  const graense = nu.getTime() - OPBEVARING_DAGE * DAG_MS;
  return kendte.filter((x) => x !== nyeste && x.t.getTime() < graense).map((x) => x.id);
}

/** A deleted tenant: every snapshot once the data key's purge date has come (or the key is already destroyed). */
export function purgeSlettet(ids: string[], noegle: { destrueres: Date | null; destrueret: boolean }, nu: Date): string[] {
  if (noegle.destrueret) return [...ids];
  if (noegle.destrueres && noegle.destrueres.getTime() <= nu.getTime()) return [...ids];
  return [];
}
