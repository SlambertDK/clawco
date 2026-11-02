// KC-0193: the scenario table against the fake client, in the gate. The same table runs against Stripe's test
// mode with test clocks (`npm run betaling:tjek`); one table, so a scenario cannot exist in one layer only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIER, UDESTAAENDE, ALLE_IDER, type Scenarie } from './betaling/scenarier.ts';
import { koerScenarie, koerAlle } from './betaling/koer.ts';
import { falskVerden } from './betaling/falsk-verden.ts';
import { planTekst } from './betaling/tjek.ts';

for (const sc of SCENARIER) {
  test(`${sc.id}: ${sc.navn}`, async () => {
    await koerScenarie(falskVerden(), sc);
  });
}

test('every scenario of the ticket is either in the table or waiting on the ticket that adds it, never both', () => {
  const iTabel = SCENARIER.map((s) => s.id);
  assert.equal(new Set(iTabel).size, iTabel.length, 'a scenario id twice in the table');
  for (const id of ALLE_IDER) assert.ok(iTabel.includes(id) !== Object.hasOwn(UDESTAAENDE, id), `${id} must be in exactly one place`);
  for (const id of [...iTabel, ...Object.keys(UDESTAAENDE)]) assert.ok((ALLE_IDER as readonly string[]).includes(id), `${id} is not one of the ticket's scenarios`);
  assert.deepEqual(iTabel, ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']);
  assert.deepEqual(UDESTAAENDE, {});
});

test('both layers run the same list: the fake run and the Stripe run\'s plan name exactly the table\'s scenarios', async () => {
  const falsk = await koerAlle(falskVerden(), SCENARIER, () => {});
  assert.deepEqual(falsk.map((r) => r.id), SCENARIER.map((s) => s.id));
  assert.deepEqual(falsk.filter((r) => !r.ok), []);
  const plan = planTekst('kørsel-x').filter((l) => /^S\d /.test(l)).map((l) => l.split(' ')[0]);
  assert.deepEqual(plan, SCENARIER.map((s) => s.id));
});

test('a scenario that cannot reach its expected state fails with the step, the expected and the actual entitlement', async () => {
  const s1 = SCENARIER.find((s) => s.id === 'S1')!;
  const forkert: Scenarie = { ...s1, skridt: [s1.skridt[0]!, { ...s1.skridt[1]!, forvent: { ...s1.skridt[1]!.forvent, status: 'aktiv', skrivebeskyttet: false } }] };
  await assert.rejects(koerScenarie(falskVerden(), forkert), (e: Error) => {
    assert.match(e.message, /^S1 trin 2: 14 dage frem: forventet aktiv\/sky-solo max 1, \+1 i udbakken, fik pause\/sky-solo max 1 skrivebeskyttet, \+1 i udbakken/);
    return true;
  });
});

test('KC-0194 S8: a German customer is billed in euro at the config\'s euro amount, and a Danish one in kroner; the runner fails on the wrong currency', async () => {
  const s8 = SCENARIER.find((s) => s.id === 'S8')!;
  assert.equal(s8.land, 'DE');
  assert.equal(s8.skridt.at(-1)?.forvent.faktura?.valuta, 'eur');
  const s2 = SCENARIER.find((s) => s.id === 'S2')!;
  assert.equal(s2.land ?? 'DK', 'DK');
  assert.equal(s2.skridt.at(-1)?.forvent.faktura?.valuta, 'dkk');
  // The same steps for a Danish customer cannot pass as a euro invoice.
  await assert.rejects(koerScenarie(falskVerden(), { ...s8, land: 'DK' }), (e: Error) => {
    assert.match(e.message, /^S8 trin 3: .*faktura.*eur.*dkk/);
    return true;
  });
});

test('the fake layer is deterministic: two runs give the same lines', async () => {
  const linjer = async () => { const ud: string[] = []; await koerAlle(falskVerden(), SCENARIER, (l) => ud.push(l)); return ud; };
  assert.deepEqual(await linjer(), await linjer());
});
