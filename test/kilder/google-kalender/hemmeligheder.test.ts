// KC-0133: no token and no client secret ever leaves the secret stores — not
// in a card, the overview (/api/kilder), the Kilder panel HTML, kilder.json,
// the store's log, an error message or anything written to the console,
// across connect, read, refresh, a refused refresh and disconnect.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { googleKalender, GOOGLE_KALENDER_ID } from '../../../src/kilder/google-kalender/kilde.ts';
import { falskGoogle } from '../../../src/kilder/google/falsk-google.ts';
import { KILDER_LOG, lavRegister } from '../../../src/kilder/register.ts';
import { laesKildeHemmelighed } from '../../../src/kilder/hemmeligheder.ts';
import { renderKilder } from '../../../src/shell/kilder.ts';
import type { Person } from '../../../src/identitet/husstand.ts';
import { medData, NU } from '../hjaelp.ts';

const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const KLIENT_HEMMELIGHED = 'GOCSPX-klient-hemmelighed-xyz';
const ADR = 'https://kontrol.example.ts.net';

test('tokens and the client secret never reach a card, the overview, HTML, kilder.json, the log, an error or the console', async () => {
  await medData(async (dir, store) => {
    const konsol: string[] = [];
    const gemt = { log: console.log, error: console.error, warn: console.warn, info: console.info };
    for (const n of ['log', 'error', 'warn', 'info'] as const) console[n] = (...a: unknown[]) => { konsol.push(a.map(String).join(' ')); };
    const fejl: string[] = [];
    let nu = NU;
    try {
      const env: Record<string, string | undefined> = {};
      const g = falskGoogle({ klient: { id: 'klient-1.apps.googleusercontent.com', hemmelighed: KLIENT_HEMMELIGHED }, kalendere: () => [{ id: 'p@example.test', summary: 'p@example.test', events: [] }] });
      const r = lavRegister({ dataDir: dir, store, nu: () => nu, adresse: ADR, miljoe: { fil: path.join(dir, 'app.env'), env } });
      r.registrer(googleKalender({ env, adresse: ADR, hent: g.hent }));
      const svar = await r.forbind(GOOGLE_KALENDER_ID, { felter: { klient_id: 'klient-1.apps.googleusercontent.com', klient_hemmelighed: KLIENT_HEMMELIGHED } }, EJER);
      assert.ok('omdiriger' in svar);
      const tilbage = new URL(g.samtykke(svar.omdiriger));
      const f = await r.tilbage(GOOGLE_KALENDER_ID, tilbage.searchParams.get('state')!, tilbage.searchParams.get('code')!, EJER);
      await r.laes(GOOGLE_KALENDER_ID);
      nu = new Date(NU.getTime() + 2 * 3600_000);
      await r.laes(GOOGLE_KALENDER_ID); // refresh
      const oversigt = await r.oversigt();
      const html = String(renderKilder(oversigt, { nu, maaFrakoble: true }));
      g.tilbagekaldAlt();
      nu = new Date(NU.getTime() + 4 * 3600_000);
      await r.laes(GOOGLE_KALENDER_ID).catch((e: Error) => { fejl.push(e.message); });
      const efter = await r.oversigt();
      const efterHtml = String(renderKilder(efter, { nu, maaFrakoble: true }));

      const refresh = (await laesKildeHemmelighed(dir, GOOGLE_KALENDER_ID))?.['refresh_token'] ?? '';
      assert.ok(refresh.length > 10, 'the refresh token is in the secret file');
      const vaerdier = [refresh, ...g.udstedteAdgange(), KLIENT_HEMMELIGHED, tilbage.searchParams.get('code')!];
      await r.frakobl(GOOGLE_KALENDER_ID, EJER);

      const filer = await readdir(dir);
      const kilderJson = await readFile(path.join(dir, 'kilder.json'), 'utf8');
      const log = JSON.stringify(await store.readLog(KILDER_LOG, 100));
      const overflader = { f: JSON.stringify(f), oversigt: JSON.stringify(oversigt), html, efter: JSON.stringify(efter), efterHtml, kilderJson, log, fejl: fejl.join('\n'), konsol: konsol.join('\n'), filer: filer.join(' ') };
      for (const [hvor, tekst] of Object.entries(overflader)) {
        for (const v of vaerdier) assert.ok(!tekst.includes(v), `${hvor} contains a secret value (${v.length} chars)`);
      }
      assert.match(efterHtml, /data-kilde-tilstand="log-ind-igen"/);
    } finally { Object.assign(console, gemt); }
  });
});
