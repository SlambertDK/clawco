// KC-0222: changing the options of a connected source after the connection (a source's own list: the news feeds).
// The connector's function says what to store; the registry checks it as it checks a setup's, writes it (the
// connection's time and owner stay), logs one line, and never lets two changes of one source overlap.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KILDER_LOG, laesKonfig, lavRegister, skrivKonfig } from '../../src/kilder/register.ts';
import { KildeFejl, type Felt } from '../../src/kilder/types.ts';
import type { Person } from '../../src/identitet/husstand.ts';
import { medData, NU, testKilde, KORT } from './hjaelp.ts';

const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const status = (s: number) => (e: unknown): boolean => e instanceof KildeFejl && e.status === s;
const LISTE: Felt = { navn: 'liste', etiket: 'Liste', type: 'tekst', paakraevet: false, skjult: true, maks: 20 };
const kilde = () => testKilde({ kort: async () => ({ ...KORT, felter: [...KORT.felter, LISTE] }) });
const forbundet = { id: 'test-kalender', status: 'forbundet' as const, zone: 'privat' as const, valg: { konto: 'a', liste: '1' }, tid: '2026-10-01T08:00:00.000Z', af: 'maja' };

test('aendreValg: the new options are stored, time and owner of the connection stay, one log line says what changed', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    r.registrer(kilde());
    await skrivKonfig(dir, { kilder: [forbundet] });
    const ud = await r.aendreValg('test-kalender', EJER, async (ctx) => ({ tekst: `Før: ${ctx.valg['liste']}.`, valg: { ...ctx.valg, liste: '1,2' }, ekstra: 42 }));
    assert.equal(ud.ekstra, 42, 'the connector\'s own answer is handed back');
    const p = (await laesKonfig(dir)).kilder[0];
    assert.deepEqual(p?.valg, { konto: 'a', liste: '1,2' });
    assert.deepEqual([p?.tid, p?.af, p?.status], [forbundet.tid, 'maja', 'forbundet']);
    const log = await store.readLog(KILDER_LOG);
    assert.equal(log.length, 1);
    assert.match(log[0]?.tekst ?? '', /Henrik.*Testkalender.*Før: 1\./);
  });
});

test('aendreValg: not connected is 409, unknown is 404; options the card does not have, too long or with control characters are refused and nothing is written', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    r.registrer(kilde());
    const aendr = (valg: Record<string, string>) => r.aendreValg('test-kalender', EJER, async () => ({ tekst: 'x', valg }));
    await assert.rejects(() => aendr({ liste: '2' }), status(409));
    await assert.rejects(() => r.aendreValg('ukendt', EJER, async () => ({ tekst: 'x', valg: {} })), status(404));
    await skrivKonfig(dir, { kilder: [forbundet] });
    await assert.rejects(() => aendr({ andet: '2' }), status(502));
    await assert.rejects(() => aendr({ liste: 'x'.repeat(21) }), status(502));
    await assert.rejects(() => aendr({ liste: 'a\nb' }), status(502));
    await assert.rejects(() => aendr({ adgangskode: 'x' }), status(502), 'a secret field is never an option');
    assert.deepEqual((await laesKonfig(dir)).kilder[0]?.valg, forbundet.valg);
    assert.equal((await store.readLog(KILDER_LOG)).length, 0);
  });
});

test('aendreValg: a connector refusal passes through; two changes of one source run one after the other, not over each other', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    r.registrer(kilde());
    await skrivKonfig(dir, { kilder: [{ ...forbundet, valg: { liste: '' } }] });
    await assert.rejects(() => r.aendreValg('test-kalender', EJER, async () => { throw new KildeFejl(409, 'Den findes allerede.'); }), status(409));
    const tilfoej = (t: string) => r.aendreValg('test-kalender', EJER, async (ctx) => {
      await new Promise((res) => setTimeout(res, 15)); // a slow fetch in the middle of the change
      return { tekst: t, valg: { liste: `${ctx.valg['liste'] ?? ''}${t}` } };
    });
    await Promise.all([tilfoej('a'), tilfoej('b'), tilfoej('c')]);
    assert.equal((await laesKonfig(dir)).kilder[0]?.valg['liste'], 'abc', 'every change saw the one before it');
  });
});
