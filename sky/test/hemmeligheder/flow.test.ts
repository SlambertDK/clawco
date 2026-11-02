// KC-0181 invariant: no key is ever written to a log. A full flow (read the master key, create two
// tenants, deliver their keys, rotate, delete, purge, plus every failure path's message) runs with
// console captured; the captured text, every argv, every error message and the database rows (other
// than the wrapped envelope) are searched for every key in hex and base64. Count must be 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import util from 'node:util';
import { afled, FORMAAL } from '../../src/hemmeligheder/afled.ts';
import { leverTilTenant, type KoerselMedInput } from '../../src/hemmeligheder/levering.ts';
import { laesMasternoegle } from '../../src/hemmeligheder/masternoegle.ts';
import { destruerUdloebne, hentDataNoegle, markerSlettet, opretTenantNoegle, roterMasternoegle } from '../../src/hemmeligheder/tenantnoegle.ts';
import { former, migreretDb, nyKek } from './hjaelp.ts';

test('a full key flow leaves no key bytes in logs, argv, errors or plain columns', async () => {
  const fanget: string[] = [];
  const metoder = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const gemte = metoder.map((m) => console[m]);
  for (const m of metoder) console[m] = (...a: unknown[]) => { fanget.push(util.format(...a)); };
  const noegler: Buffer[] = [];
  try {
    const db = await migreretDb();
    const kek1 = nyKek();
    const kek2 = nyKek();
    noegler.push(Buffer.from(kek1, 'base64'), Buffer.from(kek2, 'base64'));
    const r1 = laesMasternoegle({ SKY_MASTERNOEGLE: kek1 });
    console.log('ring', r1, JSON.stringify(r1));
    const argv: string[][] = [];
    const koer: KoerselMedInput = async (a) => { argv.push(a); return { kode: 0, ud: '', fejl: '' }; };
    const NU = new Date('2026-10-31T12:00:00Z');

    for (const t of ['hus-aaaaaaaa', 'hus-bbbbbbbb']) {
      await opretTenantNoegle(db, r1, t, NU);
      const dek = await hentDataNoegle(db, r1, t);
      noegler.push(Buffer.from(dek.aaben()));
      for (const f of FORMAAL) { const k = afled(dek, t, f); noegler.push(Buffer.from(k.aaben())); console.log('afledt', f, k); }
      console.log('dek', dek, { dek });
      await leverTilTenant({ db, ring: r1, tenant: t, container: `clawco-t-${t}`, koer });
    }
    const r2 = laesMasternoegle({ SKY_MASTERNOEGLE: kek2, SKY_MASTERNOEGLE_VERSION: '2', SKY_MASTERNOEGLE_FORRIGE: kek1 });
    console.log('rotation', await roterMasternoegle(db, r2, NU), r2);
    await markerSlettet(db, 'hus-aaaaaaaa', NU);
    console.log('destrueret', await destruerUdloebne(db, new Date(NU.getTime() + 31 * 86_400_000)));

    // Failure paths: their messages are logged too.
    for (const fn of [
      () => hentDataNoegle(db, r1, 'hus-bbbbbbbb'),
      () => hentDataNoegle(db, r2, 'hus-aaaaaaaa'),
      () => leverTilTenant({ db, ring: r2, tenant: 'hus-bbbbbbbb', container: 'clawco-t-hus-bbbbbbbb', koer: async () => ({ kode: 1, ud: '', fejl: 'nej' }) }),
      async () => laesMasternoegle({ SKY_MASTERNOEGLE: kek1.slice(0, 20) }),
    ]) {
      try { await fn(); } catch (err) { console.error('fejl:', err); }
    }
    const raekker = await db.query('SELECT tenant, kek_version, status, oprettet, roteret, slettet_ved, destrueres, destrueret FROM hemmeligheder.tenant_noegle');
    fanget.push(JSON.stringify(raekker), ...argv.map((a) => a.join(' ')));
    await db.close();
  } finally {
    metoder.forEach((m, i) => { console[m] = gemte[i]!; });
  }
  assert.ok(fanget.length > 10, 'the flow logged something to search');
  const alt = fanget.join('\n');
  const fund = noegler.flatMap((k) => former(k)).filter((f) => alt.includes(f));
  assert.equal(fund.length, 0, `key material found in captured output (${fund.length} hits)`);
  assert.ok(alt.includes('[nøgle]'), 'keys printed as [nøgle]');
});
