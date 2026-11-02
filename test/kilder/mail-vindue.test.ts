// KC-0214: the composition root's window on the mail connector that can act.
// Invariant (golden): when the host's own mail source (kira-mail, Hermes'
// himalaya path) is connected, the window is closed — even when an IMAP
// account is connected too — so Henrik's install keeps its tool path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medData, NU } from './hjaelp.ts';
import { lavRegister } from '../../src/kilder/register.ts';
import { mailForbindelse } from '../../src/kilder/mail-vindue.ts';
import type { Kilde, Laesning } from '../../src/kilder/types.ts';
import type { Person } from '../../src/identitet/husstand.ts';

const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const KUVERT = { id: '7', emne: 'Middag', fra: 'Søster', modtaget: '2026-10-31T06:00:00Z', laest: false, flag: false, vedhaeftning: false };
const laesning: Laesning = { slags: 'mail', hentet: NU.toISOString(), uklar: true, data: [KUVERT] };
const kort = async () => ({ titel: 'Mail', tekst: '', felter: [], handling: 'Forbind' });

const vaert: Kilde = { id: 'kira-mail', navn: 'Mail gennem Hermes', slags: 'mail', zone: 'privat', auth: 'bridge', standard: 'forbundet', read: async () => laesning, kort, helbred: async () => ({ status: 'ok' }) };
const kald: { navn: string; args: unknown }[] = [];
const imap: Kilde = {
  id: 'mail-imap', navn: 'Mail', slags: 'mail', zone: 'privat', auth: 'local', read: async () => laesning, kort, helbred: async () => ({ status: 'ok' }),
  verber: { flyt: { verb: 'sorter', tekst: 'flyt' }, kladde: { verb: 'forbered', tekst: 'kladde' } },
  act: async (navn, args) => { kald.push({ navn, args }); return { ok: true, tekst: `${navn} gjort`, fortryd: { navn: 'flyt', args: { id: '1', fra: 'Arkiv', til: 'INBOX' } } }; },
};
const { verber: _v, act: _a, ...uden } = imap;
const kunLaes: Kilde = { ...uden, id: 'mail-laes' };

test('no connected mail source that can act: no window', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    assert.equal(await mailForbindelse(r), null);
    r.registrer(imap); // registered, not connected
    assert.equal(await mailForbindelse(r), null);
  });
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    r.registrer(kunLaes);
    await r.forbind('mail-laes', { felter: {} }, EJER);
    const v = await mailForbindelse(r);
    assert.equal(v?.kanHandle, false, 'a mail source without verbs is a read-only window (KC-0223)');
    assert.deepEqual(await v?.laes(), [KUVERT]);
  });
});

test('a source that declares only some verbs is neither acting nor read-only: no window', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    r.registrer({ ...imap, id: 'mail-halv', verber: { flyt: { verb: 'sorter', tekst: 'flyt' } } });
    await r.forbind('mail-halv', { felter: {} }, EJER);
    assert.equal(await mailForbindelse(r), null);
  });
});

test('with a read-only and an acting source connected, the acting one is the window', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    r.registrer(kunLaes);
    r.registrer(imap);
    await r.forbind('mail-laes', { felter: {} }, EJER);
    await r.forbind('mail-imap', { felter: {} }, EJER);
    const v = await mailForbindelse(r);
    assert.deepEqual([v?.navn, v?.kanHandle], ['Mail', true]);
  });
});

test('golden: the host\'s own mail source connected closes the window, even with an IMAP account connected too', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    r.registrer(vaert);
    r.registrer(imap);
    await r.forbind('mail-imap', { felter: {} }, EJER);
    assert.equal(await mailForbindelse(r), null);
    // Henrik disconnects his host source: the IMAP account is the mail source now.
    await r.frakobl('kira-mail', EJER);
    assert.equal((await mailForbindelse(r))?.navn, 'Mail');
  });
});

test('the window reads the connector\'s envelopes and acts through the registry (policy layer + one audit line)', async () => {
  await medData(async (dir, store) => {
    const linjer: Record<string, unknown>[] = [];
    const r = lavRegister({ dataDir: dir, store, nu: () => NU, revision: { skriv: async (l: unknown) => { linjer.push(l as Record<string, unknown>); } } as never });
    r.registrer(imap);
    await r.forbind('mail-imap', { felter: {} }, EJER);
    const v = await mailForbindelse(r);
    assert.ok(v);
    assert.deepEqual(await v.laes(), [KUVERT]);
    const svar = await v.handl('flyt', { id: '7', til: 'Archive' }, { person: EJER, kanal: 'knap' });
    assert.deepEqual(svar, { ok: true, tekst: 'flyt gjort', fortryd: { navn: 'flyt', args: { id: '1', fra: 'Arkiv', til: 'INBOX' } } });
    assert.deepEqual(kald.at(-1), { navn: 'flyt', args: { id: '7', til: 'Archive' } });
    assert.equal(linjer.length, 1);
    assert.equal(linjer[0]?.['rum'], 'kilde:mail-imap');
  });
});
