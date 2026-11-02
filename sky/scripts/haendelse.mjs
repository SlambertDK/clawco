// The operator's incident list on the public status feed (KC-0189), by hand on the Sky host as `sky`:
//   node --env-file=/srv/sky/.env sky/scripts/haendelse.mjs <kommando> …
//   liste                                   the last 50 incidents with their ids (ids are never published)
//   ny "<titel>" "<tekst>" [start] [slut]   a new incident; start defaults to now, an ISO time or "nu"; no slut = open
//   slut <id> [tid]                         ends an open incident (now, or an ISO time)
// Plain text only: a customer's address, an email address, an IP address or markup is refused (drift/helbred/haendelse.ts).
// The feed caches 30 seconds. Exit 0 done, 1 refused, 2 usage.
const BRUG = 'brug: haendelse.mjs liste | ny "<titel>" "<tekst>" [start] [slut] | slut <id> [tid]';

const [kommando, ...args] = process.argv.slice(2);
const tid = (v) => (!v || v === 'nu' ? new Date() : new Date(v));

if (!['liste', 'ny', 'slut'].includes(kommando ?? '') || (kommando === 'ny' && args.length < 2) || (kommando === 'slut' && !/^\d+$/.test(args[0] ?? ''))) {
  console.error(BRUG);
  process.exit(2);
}

const { laesConfig } = await import('../src/config.ts');
const { pgDatabase } = await import('../src/db/pool.ts');
const h = await import('../src/drift/helbred/haendelse.ts');
const db = pgDatabase(laesConfig(process.env).databaseUrl);
try {
  if (kommando === 'liste') {
    const alle = await h.alleHaendelser(db);
    if (!alle.length) console.log('ingen hændelser');
    for (const x of alle) console.log(`${x.id}\t${x.start.toISOString()} → ${x.slut ? x.slut.toISOString() : 'åben'}\t${x.titel}`);
  } else if (kommando === 'ny') {
    const [titel, tekst, start, slut] = args;
    const ny = { titel, tekst, start: tid(start), slut: slut ? tid(slut) : null };
    const fejl = h.tjekHaendelse(ny);
    if (fejl) { console.error(`afvist: ${fejl}`); process.exitCode = 1; } else console.log(`hændelse ${await h.nyHaendelse(db, ny, new Date())} oprettet`);
  } else {
    const ok = await h.afslutHaendelse(db, Number(args[0]), tid(args[1]));
    console.log(ok ? `hændelse ${args[0]} afsluttet` : `ingen åben hændelse med id ${args[0]}`);
    process.exitCode = ok ? 0 : 1;
  }
} finally {
  await db.close();
}
