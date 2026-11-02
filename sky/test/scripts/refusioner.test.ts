// KC-0209: the owner's list of refund tasks. The refund itself is made in Stripe by hand; the script only lists the open
// tasks and marks one done afterwards. It never calls Stripe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stativ } from '../abonnement/stativ.ts';
import { knytBestilling, opretBestilling, registrerFortrydelse, aabneRefusioner } from '../../src/abonnement/bestilling.ts';
import { refusioner } from '../../scripts/refusioner.ts';

async function opgave(s: Awaited<ReturnType<typeof stativ>>, session: string, beloeb: number): Promise<void> {
  const nu = new Date('2026-11-05T10:00:00.000Z');
  const id = await opretBestilling(s.db, { kontoId: s.kontoId, checkoutSession: session, plan: 'sky-solo', interval: 'maaned', prisOere: 7900, valuta: 'dkk' as const, proeve: false, vilkaarVersion: '0.1-udkast', sprog: 'da', nu });
  await knytBestilling(s.db, id, `sub_${session}`, nu);
  await registrerFortrydelse(s.db, { bestillingId: id, kontoId: s.kontoId, tidspunkt: nu, brugteDage: 4, periodeDage: 30, tilbageOere: beloeb, forfald: new Date('2026-11-19T10:00:00.000Z'), beloebOpgave: beloeb, valuta: 'dkk' });
}

test('the list shows each open task with account number, amount and the day it is due; nothing open says so', async () => {
  const s = await stativ();
  assert.deepEqual(await refusioner(s.db, [], s.u.nu()), { linjer: ['Ingen åbne refusionsopgaver.'], kode: 0 });
  await opgave(s, 'cs_a', 6847);
  const r = await refusioner(s.db, [], s.u.nu());
  assert.equal(r.kode, 0);
  assert.equal(r.linjer.length, 2);
  assert.match(r.linjer[1]!, new RegExp(`^1\\s+konto ${s.kontoId}\\s+68,47 kr\\.\\s+senest 19\\. november 2026$`));
});

test('"udfoert <id>" marks a task done once the owner has refunded it by hand; unknown or done tasks say so and fail', async () => {
  const s = await stativ();
  await opgave(s, 'cs_a', 6847);
  const [o] = await aabneRefusioner(s.db);
  assert.deepEqual(await refusioner(s.db, ['udfoert', String(o!.id)], s.u.nu()), { linjer: [`Opgave ${o!.id} er markeret som udført.`], kode: 0 });
  assert.equal((await aabneRefusioner(s.db)).length, 0);
  assert.equal((await refusioner(s.db, ['udfoert', String(o!.id)], s.u.nu())).kode, 1);
  assert.equal((await refusioner(s.db, ['udfoert', '999'], s.u.nu())).kode, 1);
  assert.equal((await refusioner(s.db, ['udfoert', 'abc'], s.u.nu())).kode, 2);
  assert.equal((await refusioner(s.db, ['andet'], s.u.nu())).kode, 2);
});
