// The fleet's reconciler (KC-0182). Level-triggered, so nothing depends on an event arriving or on Sky
// staying up: each pass (at start and then every interval)
//   1. orders a tenant for every account that may have one and has none (who may: `berettigede`, from
//      billing — an active plan or a trial; a drive-by sign-up gets no container),
//   2. carries on every tenant not yet klar, and finishes every deletion that stopped half-way,
//   3. pipes the lager key into every klar tenant whose container started since Sky last delivered it (KC-0216:
//      the key lives on the container's tmpfs and is gone after a restart; `leveret` remembers the start time),
//   4. removes leftover Docker objects only when the tenant table proves they were ours and the tenant is
//      deleted (a `slettet` tombstone). A label with no row at all is reported and left alone: it may
//      belong to another Sky on the same host, so it is not provably unowned.
// Losing an entitlement does not deprovision here: what happens to a lapsed customer's data is billing's
// and Henrik's call (KC-0173/KC-0175), not the reconciler's.
import { afprovisioner } from './afprovisioner.ts';
import { provisioner, type ProvisionerDeps } from './provisioner.ts';
import { bestil, kendte, klare, slettede, tenantForEjer, ufaerdige } from './tilstand.ts';

export type AfstemDeps = ProvisionerDeps & {
  udAfGateway: (slug: string) => Promise<void>;
  /** Account ids that should have a tenant now (billing's view, injected: fleet/ never imports abonnement/). */
  berettigede: () => Promise<number[]>;
};

export type AfstemResultat = {
  bestilt: string[]; genoptaget: string[]; genleveret: string[]; fejlede: { slug: string; fejl: string }[]; fjernet: string[]; ukendte: string[];
};

/** `leveret`: slug → the container start the key was last delivered for. The loop keeps it between passes; after a
 *  Sky restart it is empty, so every running klar tenant gets one (idempotent) delivery. */
export async function afstem(d: AfstemDeps, leveret: Map<string, string> = new Map()): Promise<AfstemResultat> {
  const r: AfstemResultat = { bestilt: [], genoptaget: [], genleveret: [], fejlede: [], fjernet: [], ukendte: [] };
  const fejl = (slug: string, err: unknown) => { r.fejlede.push({ slug, fejl: (err as Error).message }); };

  for (const kontoId of await d.berettigede()) {
    if (await tenantForEjer(d.db, kontoId)) continue;
    r.bestilt.push((await bestil(d.db, { kontoId, driver: d.flaade.navn, nu: d.nu() })).slug);
  }

  await Promise.all((await ufaerdige(d.db)).map(async (t) => {
    try {
      if (t.tilstand === 'afvikles') await afprovisioner(d, t.slug);
      else await provisioner(d, t.slug);
      r.genoptaget.push(t.slug);
    } catch (err) { fejl(t.slug, err); }
  }));

  await genlever(d, leveret, r);

  let maerkede: string[];
  try { maerkede = [...(await d.flaade.maerkede())].sort(); } catch (err) { fejl('(flåden)', err); return r; }
  const doede = await slettede(d.db, maerkede);
  const vores = await kendte(d.db, maerkede);
  for (const slug of maerkede) {
    if (!vores.has(slug)) { r.ukendte.push(slug); continue; }
    if (!doede.has(slug)) continue;
    try {
      await d.laas(slug, () => d.flaade.slet(slug));
      r.fjernet.push(slug);
    } catch (err) { fejl(slug, err); }
  }
  r.genoptaget.sort();
  return r;
}

async function genlever(d: AfstemDeps, leveret: Map<string, string>, r: AfstemResultat): Promise<void> {
  let startede: Map<string, { container: string; startet: string }>;
  try { startede = await d.flaade.startede(); } catch (err) { r.fejlede.push({ slug: '(flåden)', fejl: (err as Error).message }); return; }
  for (const slug of [...leveret.keys()]) if (!startede.has(slug)) leveret.delete(slug);
  for (const slug of await klare(d.db)) {
    const s = startede.get(slug);
    if (!s || leveret.get(slug) === s.startet) continue;
    try {
      await d.laas(slug, () => d.noegler.lever(slug, s.container));
      leveret.set(slug, s.startet);
      r.genleveret.push(slug);
    } catch (err) { r.fejlede.push({ slug, fejl: (err as Error).message }); }
  }
}

/** KC-0198 "Prøv igen": carries one account's tenant on now instead of at the next pass. Idempotent: ordering
 *  is keyed on the account (bestil returns the live tenant; the index allows one live row per owner) and every
 *  step runs under the tenant's lock, so a double click or a second tab never makes a second tenant. null when
 *  the account may not have one. A failed step throws after being recorded, as in provisioner. */
export async function klargoerKonto(d: AfstemDeps, kontoId: number): Promise<string | null> {
  if (!(await d.berettigede()).includes(kontoId)) return null;
  const t = await bestil(d.db, { kontoId, driver: d.flaade.navn, nu: d.nu() });
  await provisioner(d, t.slug);
  return t.slug;
}

function linjer(r: AfstemResultat): string[] {
  return [
    ...r.bestilt.map((s) => `bestilte ${s}`),
    ...r.genleveret.map((s) => `leverede nøglen igen til ${s} (beholderen var startet på ny)`),
    ...r.fejlede.map((f) => `${f.slug}: ${f.fejl}`),
    ...r.fjernet.map((s) => `fjernede rester af den slettede ${s}`),
    ...r.ukendte.map((s) => `${s} har Docker-objekter med Clawco-etiketten, men ingen række her: rørt ikke`),
  ];
}

/** Runs a pass now and then every `interval` ms; a tick while a pass runs is skipped. A line is logged when
 *  it first appears, not on every pass while the same problem lasts. */
export function afstemLoekke(
  d: AfstemDeps,
  o: { interval: number; log?: (linje: string) => void; saetInterval?: (fn: () => void, ms: number) => () => void },
): { foerste: Promise<void>; vent(): Promise<void>; stop(): void } {
  const log = o.log ?? ((s: string) => console.log(`sky flåde: ${s}`));
  let forrige = new Set<string>();
  const leveret = new Map<string, string>();
  let igang: Promise<void> | null = null;
  const pass = (): Promise<void> => {
    if (igang) return igang;
    igang = (async () => {
      try {
        const nu = linjer(await afstem(d, leveret));
        for (const l of nu) if (!forrige.has(l)) log(l);
        forrige = new Set(nu);
      } catch (err) {
        const l = `afstemning fejlede: ${(err as Error).message}`;
        if (!forrige.has(l)) log(l);
        forrige = new Set([l]);
      } finally { igang = null; }
    })();
    return igang;
  };
  const saet = o.saetInterval ?? ((fn, ms) => { const h = setInterval(fn, ms); h.unref(); return () => clearInterval(h); });
  const foerste = pass();
  const stop = saet(() => { void pass(); }, o.interval);
  return { foerste, vent: async () => { await igang; }, stop };
}
