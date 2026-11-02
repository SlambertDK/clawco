// One backup, restore or drill by hand (KC-0185) — the same code the Sky process runs every night. On the Sky host:
//   node --env-file=/srv/sky/.env sky/scripts/sikkerhedskopi.ts <kommando> …
//   status                         counts only: scopes, copies within 36 h, late, bytes, the last drill
//   koer alle|db|<tenant>          a copy now, whatever the schedule says
//   liste db|<tenant>              the snapshots: id, time, bytes, files
//   gendan <tenant> [<id>]         restore into a NEW volume and container (clawco-g-…); the original is untouched
//   fjern <clawco-g-…|clawco-p-…>  remove a restored container and its volume
//   proeve db|<tenant>             one restore drill now (stored like the monthly one)
//   db-gendan <database> [<id>]    the newest (or given) dump into another, existing, empty database
// Prints counts and ids only, never a key. Exit 0 ok, 1 failed, 2 usage.
import { DB, kopierDb, kopierTenant } from '../src/drift/backup/koer.ts';
import { aabnDbDump, gendan } from '../src/drift/backup/gendan.ts';
import { forsinkede, levendeOmfang } from '../src/drift/backup/planlaeg.ts';
import { proev, proevDb, type ProeveDeps } from '../src/drift/backup/proeve.ts';
import { kopiTilstand, proeverSiden, samletBytes, snapshotsFor } from '../src/drift/backup/tilstand.ts';

const BRUG = 'brug: sikkerhedskopi.ts status | koer alle|db|<tenant> | liste db|<tenant> | gendan <tenant> [<id>] | fjern <navn> | proeve db|<tenant> | db-gendan <database> [<id>]';
const T = 3_600_000;

export async function kommando(argv: string[], d: ProeveDeps, ud: (linje: string) => void): Promise<number> {
  const [k, a, b] = argv;
  try {
    switch (k) {
      case 'status': {
        const omfang = levendeOmfang(await d.tenanter());
        const tilstand = await kopiTilstand(d.db);
        omfang.push({ omfang: DB, siden: tilstand.get(DB)?.oprettet ?? d.nu() });
        const nu = d.nu().getTime();
        const friske = omfang.filter((o) => { const s = tilstand.get(o.omfang)?.sidsteSucces; return s && nu - s.getTime() <= 36 * T; }).length;
        ud(`${omfang.length} omfang (${omfang.length - 1} kunder + databasen): ${friske} med en kopi inden for 36 timer, ${forsinkede(omfang, tilstand, d.nu())} forsinkede`);
        ud(`kopierne fylder ${await samletBytes(d.db)} bytes i R2`);
        const p = await proeverSiden(d.db, new Date(nu - 62 * 24 * T));
        const sidste = p.at(-1);
        ud(sidste ? `sidste gendannelsesprøve ${sidste.startet.toISOString()}: ${p.filter((x) => x.startet.getTime() >= sidste.startet.getTime() - 24 * T && x.ok).length} ok, ${p.filter((x) => x.startet.getTime() >= sidste.startet.getTime() - 24 * T && !x.ok).length} fejlede` : 'ingen gendannelsesprøve endnu');
        return 0;
      }
      case 'koer': {
        if (!a) break;
        const maal = a === 'alle' ? [...levendeOmfang(await d.tenanter()).map((o) => o.omfang), DB] : [a];
        let fejl = 0;
        for (const o of maal) {
          try {
            const r = o === DB ? await kopierDb(d) : await kopierTenant(d, o);
            ud(`${o}: ${r.id} ${r.bytes} bytes, ${r.manifest.antal} ${r.manifest.antal === 1 ? 'fil' : 'filer'}`);
          } catch (err) { fejl++; ud(`${o}: fejlede: ${(err as Error).message}`); }
        }
        return fejl ? 1 : 0;
      }
      case 'liste': {
        if (!a) break;
        for (const s of await snapshotsFor(d.db, a)) ud(`${s.id}  ${s.tid.toISOString()}  ${s.bytes} bytes  ${s.antalFiler} filer`);
        return 0;
      }
      case 'gendan': {
        if (!a) break;
        const g = await gendan(d, a, b);
        ud(`gendannet ${g.snapshot} (${g.manifest.antal} filer): navn ${g.navn}, adresse ${g.adresse}`);
        ud(`fjern den igen med: sikkerhedskopi.ts fjern ${g.navn}`);
        return 0;
      }
      case 'fjern': {
        if (!a) break;
        await d.node.fjern(a);
        ud(`fjernet: ${a}`);
        return 0;
      }
      case 'proeve': {
        if (!a) break;
        const r = a === DB ? await proevDb(d) : await proev(d, a);
        ud(r.ok ? `prøve ok: ${r.snapshot} (${r.trin})` : `prøve fejlede efter trinnet ${r.trin}: ${r.fejl}`);
        return r.ok ? 0 : 1;
      }
      case 'db-gendan': {
        if (!a) break;
        if (!d.dump) throw new Error('ingen pg_restore på denne vært');
        const { id, dump } = await aabnDbDump(d, b);
        await d.dump.gendan(dump, a);
        ud(`dump ${id} (${dump.length} bytes) gendannet i databasen ${a}`);
        return 0;
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
  const { laesConfig, laesKopiConfig } = await import('../src/config.ts');
  const { pgDatabase } = await import('../src/db/pool.ts');
  const { kopiFra, noeglering } = await import('../src/server.ts');
  const config = laesConfig(process.env);
  const n = noeglering(process.env);
  const kc = laesKopiConfig(process.env);
  const db = pgDatabase(config.databaseUrl);
  try {
    const k = kopiFra({ config, db, ring: n.ring, kopi: kc.kopi });
    if (!k.deps) { console.error(kc.fejl ?? k.grund ?? n.fejl); process.exitCode = 1; } else {
      process.exitCode = await kommando(process.argv.slice(2), { ...k.deps, log: (s) => console.log(s) }, (l) => console.log(l));
    }
  } finally { await db.close(); }
}
