// Rolling a new tenant image out (KC-0186), by hand on the Sky host as `sky` (sky/deploy/README.md, Udrulning):
//   node --env-file=/srv/sky/.env sky/scripts/udrul.ts <kommando> …
//   status                          the active (or last) rollout: cohort, counts per cohort and state, slugs to look at
//   hold <slug> intern|kanari|alle  puts a tenant in a cohort (intern = the operator's own test tenant)
//   start <tag>                     a release (a local image, clawco:<sha>) to every klar tenant not on it, cohort by
//                                   cohort, in the foreground until done or halted (sleeps through each soak)
//   fortsaet                        carries on: after a kill, or after a halt (the failed tenants stay on the old release)
//   tilbage                         rolls every tenant of the active rollout back to the image it ran before
// Killed at any point, `fortsaet` continues: no tenant is upgraded twice, none is skipped silently.
// Prints counts and slugs only, never a key or an image id. Exit 0 done, 1 halted or failed, 2 usage.
import { HOLD, type Hold } from '../src/drift/udrulning/hold.ts';
import { tilbage } from '../src/drift/udrulning/tilbagerul.ts';
import type { UdrulDeps } from '../src/drift/udrulning/typer.ts';
import { fortsaet, fremad, startUdrulning, udrulStatus, type Pass } from '../src/drift/udrulning/udrul.ts';

const BRUG = 'brug: udrul.ts status | hold <slug> intern|kanari|alle | start <tag> | fortsaet | tilbage';
/** Wakes at least this often during a soak: each pass re-checks every soaking tenant's /health. */
const VAAGN_MS = 60_000;

type Sov = (ms: number) => Promise<void>;

async function status(d: UdrulDeps, ud: (l: string) => void): Promise<void> {
  const s = await udrulStatus(d);
  const u = s.udrulning;
  if (!u) { ud('ingen udrulning endnu'); return; }
  ud(`udrulning ${u.id} af ${u.udgave.tag}: ${u.tilstand} (hold ${u.hold})`);
  for (const h of HOLD) {
    const a = Object.entries(s.antal[h]);
    if (a.length) ud(`${h}: ${a.map(([t, n]) => `${n} ${t}`).join(', ')}`);
  }
  if (s.ventTil) ud(`prøvetiden for ${u.hold} slutter ${s.ventTil.toISOString()}`);
  if (u.grund) ud(`grund: ${u.grund}`);
  if (s.problemer.length) ud(`kræver et kig: ${s.problemer.map((p) => `${p.slug} (${p.tilstand})`).join(', ')}`);
}

/** Pass after pass until the rollout stops; sleeps through soaks, waking every minute to re-check. */
async function tilEnde(d: UdrulDeps, foerste: () => Promise<Pass>, ud: (l: string) => void, sov: Sov): Promise<number> {
  let r = await foerste();
  for (;;) {
    if (r.ventTil) {
      const ms = Math.max(1_000, Math.min(VAAGN_MS, r.ventTil.getTime() - d.nu().getTime()));
      await sov(ms);
      r = await fremad(d);
      continue;
    }
    await status(d, ud);
    if (r.tilstand === 'faerdig') { ud('udrulningen er færdig'); return 0; }
    if (r.tilstand === 'tilbagerullet') { ud('udrulningen er rullet tilbage'); return 0; }
    ud(r.tilstand === 'standset' ? 'udrulningen er standset: fortsaet eller tilbage' : `udrulningen står i ${r.tilstand ?? 'ingen tilstand'}`);
    return 1;
  }
}

export async function kommando(argv: string[], d: UdrulDeps, ud: (linje: string) => void, sov: Sov = (ms) => new Promise((r) => { setTimeout(r, ms); })): Promise<number> {
  const [k, a, b] = argv;
  const dd: UdrulDeps = { ...d, log: (l) => { ud(l); d.log?.(l); } };
  try {
    switch (k) {
      case 'status': await status(dd, ud); return 0;
      case 'hold': {
        if (!a || !b || !HOLD.includes(b as Hold)) break;
        if (!(await dd.tenanter.saetHold(a, b as Hold))) { ud(`ingen kunde ${a}`); return 1; }
        ud(`${a} er nu i holdet ${b}`);
        return 0;
      }
      case 'start': {
        if (!a) break;
        const s = await startUdrulning(dd, a);
        if (s.kanari.length) ud(`${s.kanari.length} ${s.kanari.length === 1 ? 'kunde' : 'kunder'} sat i kanari: ${s.kanari.join(', ')}`);
        if (s.id === null) { ud(`ingen kunder mangler ${a}`); return 0; }
        return await tilEnde(dd, () => fremad(dd), ud, sov);
      }
      case 'fortsaet': return await tilEnde(dd, () => fortsaet(dd), ud, sov);
      case 'tilbage': {
        const r = await tilbage(dd);
        ud(`${r.tilbagerullet} rullet tilbage, ${r.fejlet} fejlede`);
        return r.fejlet ? 1 : 0;
      }
    }
  } catch (err) {
    ud(`fejlede: ${(err as Error).message}`);
    return 1;
  }
  ud(BRUG);
  return 2;
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
      if (argvKraeverLager(process.argv[2])) console.log(u.lager === 'r2' ? 'genopretningspunkter: R2' : 'genopretningspunkter: lokalt på værten (R2 er ikke sat op), ikke en kopi uden for huset');
      process.exitCode = await kommando(process.argv.slice(2), u.deps, (l) => console.log(l));
    }
  } finally { await db.close(); }
}

function argvKraeverLager(k: string | undefined): boolean {
  return k === 'start' || k === 'fortsaet';
}
