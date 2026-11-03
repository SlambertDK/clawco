// KC-0264: rotating a tenant's model token from the operator's command line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roterOgLever } from '../../scripts/roter-modeltoken.ts';
import { modelToken, sikrModelToken, tenantForModelToken, MODEL_TOKEN_STI } from '../../src/hemmeligheder/modeltoken.ts';
import { opretTenantNoegle } from '../../src/hemmeligheder/tenantnoegle.ts';
import type { KoerselMedInput } from '../../src/hemmeligheder/levering.ts';
import { migreretDb, ring } from '../hemmeligheder/hjaelp.ts';

test('the new token is stored and piped into the running container; the old one stops working; the output names no token', async () => {
  const db = await migreretDb();
  const r = ring();
  const nu = new Date('2026-11-03T10:00:00Z');
  await opretTenantNoegle(db, r, 'hus-aaaaaaaa', nu);
  await sikrModelToken(db, r, 'hus-aaaaaaaa', nu);
  const gammel = await modelToken(db, r, 'hus-aaaaaaaa');
  const kald: { argv: string[]; input: string }[] = [];
  const koer: KoerselMedInput = async (argv, input) => { kald.push({ argv, input }); return { kode: 0, ud: '', fejl: '' }; };
  const ud = await roterOgLever({ db, ring: r, koer, beholder: async () => ({ container: 'clawco-t-hus-aaaaaaaa' }), nu }, 'hus-aaaaaaaa');
  const ny = await modelToken(db, r, 'hus-aaaaaaaa');
  assert.notEqual(ny, gammel);
  assert.equal(await tenantForModelToken(db, gammel), null);
  assert.equal(kald[0]!.argv.at(-1), MODEL_TOKEN_STI);
  assert.equal(kald[0]!.input, `${ny}\n`);
  assert.ok(!ud.includes(ny) && !ud.includes(gammel));
  const stoppet = await roterOgLever({ db, ring: r, koer, beholder: async () => null, nu }, 'hus-aaaaaaaa');
  assert.match(stoppet, /næste start/);
  assert.equal(kald.length, 1);
  await db.close();
});
