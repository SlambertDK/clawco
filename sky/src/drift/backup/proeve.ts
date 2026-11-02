// The restore drill (KC-0185): a copy is not trusted until a restore of it has passed. Once a calendar month
// (UTC) Sky picks a few tenants at random — always the internal test tenant when it has a copy — restores each
// newest copy into a scratch container (clawco-p-…, on the tenant network, never in the gateway's route table),
// waits for its /health, takes the manifest of the restored volume and compares it with the one taken at backup
// time, and destroys the scratch whatever happened. Sky's own newest dump is opened under its master-key
// version, checked against its digest and read by pg_restore --list. Every result is stored (drift.proeve); a
// failure logs an alert with counts only (KC-0187's channel is not built yet).
import { manifestFraTar } from './manifest.ts';
import { DB } from './koer.ts';
import { aabnDbDump, gendan, vaelgSnapshot, type Trin } from './gendan.ts';
import { levendeOmfang } from './planlaeg.ts';
import { noterProeve, proeverSiden, snapshotsFor } from './tilstand.ts';
import type { KopiDeps } from './typer.ts';

export type ProeveDeps = KopiDeps & {
  /** GET <adresse>/health from Sky (the fleet's hentSundhed). */
  sundhed: (adresse: string) => Promise<{ ok: boolean }>;
  vent: (ms: number) => Promise<void>;
  /** How long to wait for /health: attempts × pause. Default 90 × 1 s. */
  sundFrist?: { forsoeg: number; ms: number };
  /** SKY_KOPI_TESTTENANT: the internal test tenant, always drilled. */
  testTenant: string | null;
  /** A number in [0, 1) for the random pick (Math.random by default). */
  tal?: () => number;
  /** How many tenants besides the test tenant. Default 2. */
  antal?: number;
};

export type ProeveResultat = { omfang: string; snapshot: string; ok: boolean; trin: Trin; fejl: string | null };

async function gem(d: ProeveDeps, startet: Date, r: ProeveResultat): Promise<ProeveResultat> {
  await noterProeve(d.db, { ...r, startet, slut: d.nu() });
  if (!r.ok) d.log?.(`ADVARSEL: gendannelsesprøven fejlede efter trinnet ${r.trin}${r.omfang === DB ? ' (databasen)' : ''}`);
  return r;
}

export async function proev(d: ProeveDeps, slug: string): Promise<ProeveResultat> {
  const startet = d.nu();
  let trin: Trin = 'start';
  let snapshot = '-';
  let navn: string | null = null;
  try {
    const valg = await vaelgSnapshot(d, slug);
    snapshot = valg.id;
    // gendan names its scratch and removes it again if it fails half-way; once started, this drill removes it.
    const g = await gendan({ ...d, art: 'p' }, slug, valg.id, (t) => { trin = t; });
    navn = g.navn;
    const { forsoeg, ms } = d.sundFrist ?? { forsoeg: 90, ms: 1_000 };
    let sund = false;
    for (let i = 0; i < forsoeg && !sund; i++) {
      sund = (await d.sundhed(g.adresse)).ok;
      if (!sund && i < forsoeg - 1) await d.vent(ms);
    }
    if (!sund) throw new Error(`den gendannede beholders /health svarede ikke ok inden for ${Math.round((forsoeg * ms) / 1000)} s`);
    trin = 'sund';
    const efter = manifestFraTar(await d.node.pakGendannet(g.navn));
    if (efter.digest !== g.manifest.digest || efter.antal !== g.manifest.antal) {
      throw new Error(`de gendannede filer passer ikke med manifestet (${efter.antal} mod ${g.manifest.antal} filer)`);
    }
    trin = 'sammenlignet';
    return await gem(d, startet, { omfang: slug, snapshot, ok: true, trin, fejl: null });
  } catch (err) {
    return await gem(d, startet, { omfang: slug, snapshot, ok: false, trin, fejl: (err as Error).message });
  } finally {
    if (navn) await d.node.fjern(navn).catch((e: Error) => { d.log?.(`ADVARSEL: en prøvebeholder kunne ikke fjernes: ${e.name}`); });
  }
}

export async function proevDb(d: ProeveDeps): Promise<ProeveResultat> {
  const startet = d.nu();
  let trin: Trin = 'start';
  let snapshot = '-';
  try {
    if (!d.dump) throw new Error('ingen pg_restore på denne vært');
    const nyeste = (await snapshotsFor(d.db, DB))[0];
    if (!nyeste) throw new Error('der er ingen kopi af databasen');
    snapshot = nyeste.id;
    const { dump } = await aabnDbDump(d, nyeste.id, (t) => { trin = t; });
    await d.dump.tjek(dump);
    trin = 'sammenlignet';
    return await gem(d, startet, { omfang: DB, snapshot, ok: true, trin, fejl: null });
  } catch (err) {
    return await gem(d, startet, { omfang: DB, snapshot, ok: false, trin, fejl: (err as Error).message });
  }
}

/** Due when no drill has started since the first of this UTC month. */
export async function proeveSkyldig(db: KopiDeps['db'], nu: Date): Promise<boolean> {
  const maanedStart = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), 1));
  return (await proeverSiden(db, maanedStart)).length === 0;
}

/** The test tenant first (when it has a copy), then `antal` others at random. */
export function vaelg(medKopi: string[], testTenant: string | null, antal: number, tal: () => number): string[] {
  const ud = testTenant && medKopi.includes(testTenant) ? [testTenant] : [];
  const rest = medKopi.filter((s) => s !== testTenant);
  for (let i = 0; i < antal && rest.length; i++) ud.push(rest.splice(Math.floor(tal() * rest.length), 1)[0]!);
  return ud;
}

export async function proevMaaned(d: ProeveDeps): Promise<{ ok: number; fejlede: number }> {
  const levende = levendeOmfang(await d.tenanter()).map((o) => o.omfang);
  const medKopi: string[] = [];
  for (const s of levende) if ((await snapshotsFor(d.db, s)).length) medKopi.push(s);
  const valgte = vaelg(medKopi, d.testTenant, d.antal ?? 2, d.tal ?? Math.random);
  const r = { ok: 0, fejlede: 0 };
  for (const s of valgte) { if ((await proev(d, s)).ok) r.ok++; else r.fejlede++; }
  if ((await proevDb(d)).ok) r.ok++; else r.fejlede++;
  d.log?.(`gendannelsesprøve: ${r.ok} ok, ${r.fejlede} fejlede`);
  return r;
}
