// Rolling back (KC-0186): a tenant goes back to the image id it ran before the upgrade (recorded on its rollout row
// before its container was touched), on the same volume — its data stays where it is. It counts as rolled back only
// when its own /health shows the previous sha. `tilbage` does this for every tenant the active rollout upgraded;
// each tenant's row is ended as it is done, so a killed `tilbage` continues where it stopped.
import { GATEWAY_CACHE_MS } from './hold.ts';
import { medLaas } from './laas.ts';
import { afslutTenant, aktivUdrulning, saetUdrulning, tenanterI, type Udrulning } from './tilstand.ts';
import type { UdrulDeps } from './typer.ts';
import { ventPaaSha } from './udgave.ts';

/** Starts `fra.billede` on the tenant's volume and waits for `fra.sha`; then the route follows and the update page
 *  goes. A tenant already back and healthy is not restarted. Throws when it does not come back. */
export async function tilbagerulTenant(d: UdrulDeps, slug: string, fra: { billede: string; sha: string }): Promise<void> {
  // A container that cannot even be looked at is not healthy on the previous image: replace it.
  const b = await d.flaade.beholder(slug).catch(() => null);
  if (b && b.billede === fra.billede) {
    const s = await d.sundhed(b.adresse);
    if (s.ok && s.sha === fra.sha) {
      await d.tenanter.noterKoersel(slug, { billede: fra.billede, release: fra.sha, adresse: b.adresse });
      await d.tenanter.opdateres(slug, false);
      return;
    }
  }
  await d.tenanter.opdateres(slug, true);
  const k = await d.flaade.opgrader({ id: slug, billede: fra.billede });
  await d.noegler.lever(slug, k.container);
  await ventPaaSha(d, k.adresse, fra.sha);
  await d.tenanter.noterKoersel(slug, { billede: fra.billede, release: fra.sha, adresse: k.adresse });
  await d.vent(GATEWAY_CACHE_MS);
  await d.tenanter.opdateres(slug, false);
}

/** Rolls back what is left of rollout `u` (under the caller's lease) and ends it. */
export async function tilbageAlle(d: UdrulDeps, u: Udrulning): Promise<{ tilbagerullet: number; fejlet: number }> {
  const log = d.log ?? (() => {});
  const r = { tilbagerullet: 0, fejlet: 0 };
  for (const t of await tenanterI(d.db, u.id)) {
    // fejlet = its automatic rollback failed, so it is the one most likely down: the operator's tilbage is for it.
    if (t.tilstand !== 'opgraderet' && t.tilstand !== 'igang' && t.tilstand !== 'fejlet') continue;
    if (!t.fraBillede || !t.fraSha) {
      // Taken, but nothing was changed yet.
      await afslutTenant(d.db, u.id, t.slug, ['igang'], 'sprunget-over', d.nu(), 'udrulningen blev rullet tilbage, før den nåede hertil');
      continue;
    }
    try {
      await tilbagerulTenant(d, t.slug, { billede: t.fraBillede, sha: t.fraSha });
      await afslutTenant(d.db, u.id, t.slug, ['opgraderet', 'igang', 'fejlet'], 'tilbagerullet', d.nu(), 'rullet tilbage efter ordre');
      r.tilbagerullet++;
    } catch (err) {
      await afslutTenant(d.db, u.id, t.slug, ['opgraderet', 'igang', 'fejlet'], 'fejlet', d.nu(), `tilbagerulning fejlede: ${(err as Error).message}`);
      await d.tenanter.opdateres(t.slug, false).catch(() => {});
      r.fejlet++;
    }
  }
  if (r.fejlet) log(`ADVARSEL: ${r.fejlet} ${r.fejlet === 1 ? 'kunde kunne' : 'kunder kunne'} ikke rulles tilbage og svarer ikke — se udrul.ts status`);
  await saetUdrulning(d.db, u.id, ['tilbagerulles'], { tilstand: 'tilbagerullet', slut: d.nu(), ...(r.fejlet ? { grund: `${r.fejlet} kunne ikke rulles tilbage` } : {}) }, d.nu());
  return r;
}

/** The operator's `udrul.ts tilbage`: the active rollout (running or halted) is rolled back in full. */
export async function tilbage(d: UdrulDeps): Promise<{ tilbagerullet: number; fejlet: number }> {
  const u = await aktivUdrulning(d.db);
  if (!u) throw new Error('der er ingen aktiv udrulning at rulle tilbage');
  return medLaas(d, u.id, async () => {
    await saetUdrulning(d.db, u.id, ['koerer', 'standset'], { tilstand: 'tilbagerulles' }, d.nu());
    return tilbageAlle(d, { ...u, tilstand: 'tilbagerulles' });
  });
}
