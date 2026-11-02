// Recreating every klar tenant's container with the CURRENT environment, on the image it runs now (KC-0217), by hand
// on the Sky host as `sky` (sky/deploy/gateway/README.md, Rotation):
//   node --env-file=/srv/sky/.env sky/scripts/genstart-flaade.ts [--dry-run]
// A container's environment is fixed when it is created, so a key Sky hands out as KC_KONTO_PUBKEY / KC_KONTO_PUBKEY_NY
// reaches a tenant that already runs only through this. It is the rollout's own replacement (lokal.ts opgrader: the
// container removed and run again on the SAME volume — the data stays), with the same order (intern, kanari, alle),
// the same lager-key delivery after every start and the same /health wait (the tenant must answer with the sha it had
// before). One tenant at a time, and it stops on the first failure. No restore point: no image and no data change.
// Not while a rollout is active. Prints slugs and outcomes only, never a key. Exit 0 done, 1 failed, 2 usage.
import { GATEWAY_CACHE_MS, HOLD } from '../src/drift/udrulning/hold.ts';
import { aktivUdrulning } from '../src/drift/udrulning/tilstand.ts';
import type { UdrulDeps } from '../src/drift/udrulning/typer.ts';
import { ventPaaSha } from '../src/drift/udrulning/udgave.ts';

const BRUG = 'brug: genstart-flaade.ts [--dry-run]';

/** The klar tenants in rollout order: intern first, then kanari, then the rest; the fleet's own order within a cohort. */
async function iRaekkefoelge(d: UdrulDeps) {
  const klare = await d.tenanter.klare();
  return HOLD.flatMap((h) => klare.filter((t) => t.hold === h));
}

async function genstartEn(d: UdrulDeps, slug: string): Promise<void> {
  const b = await d.flaade.beholder(slug);
  if (!b) throw new Error('beholderen kører ikke');
  const foer = await d.sundhed(b.adresse);
  // Never recreate a tenant that cannot be told from broken afterwards: it must answer now, and answer the same after.
  if (!foer.ok || !foer.sha) throw new Error('svarede ikke før genstarten');
  await d.tenanter.opdateres(slug, true);
  try {
    await d.vent(GATEWAY_CACHE_MS);
    const k = await d.flaade.opgrader({ id: slug, billede: b.billede });
    await d.noegler.lever(slug, k.container);
    await ventPaaSha(d, k.adresse, foer.sha);
    await d.tenanter.noterKoersel(slug, { billede: b.billede, release: foer.sha, adresse: k.adresse });
  } catch (err) {
    // Never a stuck "Opdaterer" page over a tenant that is down: the gateway's normal error shows instead.
    await d.tenanter.opdateres(slug, false).catch(() => {});
    throw err;
  }
  await d.vent(GATEWAY_CACHE_MS);
  await d.tenanter.opdateres(slug, false);
}

/** Every klar tenant, in order, until one fails. `fejlet` is that tenant's slug (null = all done). */
export async function genstartFlaade(d: UdrulDeps, ud: (linje: string) => void): Promise<{ genstartet: number; fejlet: string | null }> {
  const aktiv = await aktivUdrulning(d.db);
  if (aktiv) throw new Error(`udrulning ${aktiv.id} (${aktiv.udgave.tag}) er i gang: fortsaet eller tilbage først`);
  let genstartet = 0;
  for (const t of await iRaekkefoelge(d)) {
    try {
      await genstartEn(d, t.slug);
      ud(`${t.slug}: genstartet`);
      genstartet++;
    } catch (err) {
      ud(`${t.slug}: fejlede (${(err as Error).message})`);
      ud(`standset efter ${genstartet} genstartet: ret fejlen og kør kommandoen igen (de, der allerede er genstartet, genstartes blot en gang til)`);
      return { genstartet, fejlet: t.slug };
    }
  }
  ud(genstartet ? `${genstartet} genstartet, 0 fejlede` : 'ingen klare kunder at genstarte');
  return { genstartet, fejlet: null };
}

export async function kommando(argv: string[], d: UdrulDeps, ud: (linje: string) => void): Promise<number> {
  if (argv.some((a) => a !== '--dry-run') || argv.length > 1) { ud(BRUG); return 2; }
  try {
    if (argv[0] === '--dry-run') {
      const raekke = await iRaekkefoelge(d);
      for (const t of raekke) ud(`ville genstarte ${t.slug} (${t.hold})`);
      ud(raekke.length ? `${raekke.length} ville blive genstartet (ingen ændring: --dry-run)` : 'ingen klare kunder at genstarte');
      return 0;
    }
    return (await genstartFlaade(d, ud)).fejlet ? 1 : 0;
  } catch (err) {
    ud(`fejlede: ${(err as Error).message}`);
    return 1;
  }
}

if (import.meta.main) {
  const { laesConfig, laesKopiConfig, lokaleKopier } = await import('../src/config.ts');
  const { pgDatabase } = await import('../src/db/pool.ts');
  const { noeglering, udrulFra } = await import('../src/server.ts');
  const config = laesConfig(process.env);
  const n = noeglering(process.env);
  const kc = laesKopiConfig(process.env);
  const db = pgDatabase(config.databaseUrl);
  try {
    const u = udrulFra({ config, db, ring: n.ring, kopi: kc.kopi, lokaleKopier: lokaleKopier(process.env) });
    if (!u.deps) { console.error(u.grund ?? n.fejl); process.exitCode = 1; } else {
      process.exitCode = await kommando(process.argv.slice(2), u.deps, (l) => console.log(l));
    }
  } finally { await db.close(); }
}
