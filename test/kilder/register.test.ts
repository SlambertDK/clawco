// KC-0132: the connector registry. Registration (unique ids, declared verbs
// only from the policy layer's list and never pay/send/delete/cross-zone),
// connected sources by slags from $KC_DATA_DIR/kilder.json (atomic, corrupt =
// fail closed), connect/disconnect with a log line each, the first read on the
// live bus, reads stripped to the shape (no mail bodies), and act() only
// through a declared verb and the policy layer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FOERSTE_LAESNING, KILDER_LOG, KonfigFejl, laesKonfig, laesKonfigSync, lavRegister, skrivKonfig } from '../../src/kilder/register.ts';
import { KildeFejl, type Kilde, type Laesning } from '../../src/kilder/types.ts';
import { laesKildeHemmelighed } from '../../src/kilder/hemmeligheder.ts';
import { lavRevisionslog } from '../../src/graenser/revisionslog.ts';
import type { Person } from '../../src/identitet/husstand.ts';
import { medData, NU, testKilde } from './hjaelp.ts';

const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const GAEST: Person = { id: 'farmor', login: null, navn: 'Farmor', rolle: 'gaest' };

const fejlStatus = (status: number) => (e: unknown) => e instanceof KildeFejl && e.status === status;

test('registrer: liste and hent; a duplicate or invalid id is refused', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    r.registrer(testKilde());
    assert.deepEqual(r.liste().map((k) => k.id), ['test-kalender']);
    assert.equal(r.hent('test-kalender')?.navn, 'Testkalender');
    assert.equal(r.hent('ukendt'), undefined);
    assert.throws(() => r.registrer(testKilde()), /findes allerede/);
    assert.throws(() => r.registrer(testKilde({ id: '../ud' })), /ugyldigt/);
    assert.throws(() => r.registrer(testKilde({ id: 'x', slags: 'fax' as never })), /ugyldig/);
  });
});

test('registrer: a declared verb must be on the policy list and never pay, send to others, delete or cross zones', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store });
    const act = async () => ({ ok: true, tekst: 'ok' });
    for (const verb of ['betal', 'send-til-andre', 'slet', 'kopier-paa-tvaers', 'flyv']) {
      assert.throws(() => r.registrer(testKilde({ id: `v-${verb}`, verber: { x: { verb: verb as never, tekst: 'x' } }, act })), /må ikke|ukendt verbum/, verb);
    }
    assert.throws(() => r.registrer(testKilde({ id: 'uden-act', verber: { flyt: { verb: 'sorter', tekst: 'Flyt' } } })), /act/);
    assert.throws(() => r.registrer(testKilde({ id: 'uden-verber', act })), /verber/);
    r.registrer(testKilde({ id: 'ok', verber: { flyt: { verb: 'sorter', tekst: 'Flyt' } }, act }));
  });
});

test('forbundne(slags): connected by kilder.json or by the host (standard), not after frakobl', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    r.registrer(testKilde());
    r.registrer(testKilde({ id: 'vaert-kalender', standard: 'forbundet' }));
    r.registrer(testKilde({ id: 'post', slags: 'mail' }));
    assert.deepEqual((await r.forbundne('kalender')).map((k) => k.id), ['vaert-kalender']);
    await r.forbind('test-kalender', { felter: { konto: 'ella', adgangskode: 'pw-123' } }, EJER);
    assert.deepEqual((await r.forbundne('kalender')).map((k) => k.id), ['test-kalender', 'vaert-kalender']);
    assert.deepEqual(await r.forbundne('mail'), []);
    await r.frakobl('vaert-kalender', EJER);
    assert.deepEqual((await r.forbundne('kalender')).map((k) => k.id), ['test-kalender']);
  });
});

test('kilder.json: round-trip, atomic write (no tmp file left), missing = empty, corrupt = fail closed', async () => {
  await medData(async (dir) => {
    assert.deepEqual(await laesKonfig(dir), { kilder: [] });
    const k = { kilder: [{ id: 'test-kalender', status: 'forbundet' as const, zone: 'arbejde' as const, valg: { konto: 'ella' }, tid: NU.toISOString(), af: 'henrik' }] };
    await skrivKonfig(dir, k);
    assert.deepEqual(await laesKonfig(dir), k);
    assert.deepEqual((await readdir(dir)).filter((f) => f.startsWith('kilder.json')), ['kilder.json']);
    await assert.rejects(skrivKonfig(dir, { kilder: [{ ...k.kilder[0]!, zone: 'ude' as never }] }));
    await writeFile(path.join(dir, 'kilder.json'), '{ ikke json', 'utf8');
    await assert.rejects(laesKonfig(dir), /kilder.json/);
  });
});

test('forbind: fields validated against the card (unknown or missing → 400, unknown id → 404); secrets only in the secret file', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    r.registrer(testKilde());
    await assert.rejects(r.forbind('ukendt', {}, EJER), fejlStatus(404));
    await assert.rejects(r.forbind('test-kalender', { felter: { konto: 'ella' } }, EJER), fejlStatus(400));
    await assert.rejects(r.forbind('test-kalender', { felter: { konto: 'ella', adgangskode: 'x', hvad: 'y' } }, EJER), fejlStatus(400));
    await assert.rejects(r.forbind('test-kalender', { felter: { konto: 'ella', adgangskode: 'x', note: 'alt for lang tekst' } }, EJER), fejlStatus(400));
    await assert.rejects(r.forbind('test-kalender', { felter: { konto: 7, adgangskode: 'x' } }, EJER), fejlStatus(400));
    await assert.rejects(r.forbind('test-kalender', { felter: { konto: 'ella', adgangskode: 'x' }, zone: 'ude' }, EJER), fejlStatus(400));
    await assert.rejects(r.forbind('test-kalender', { felter: { konto: 'ella', adgangskode: 'x' }, ekstra: 1 }, EJER), fejlStatus(400));
    assert.deepEqual(await laesKonfig(dir), { kilder: [] }, 'nothing written on a refusal');

    const svar = await r.forbind('test-kalender', { felter: { konto: 'ella', adgangskode: 'pw-hemmelig' }, zone: 'arbejde' }, EJER);
    assert.deepEqual(svar, { forbundet: true, foersteLaesning: { slags: 'kalender', hentet: NU.toISOString(), antal: 2 } });
    const konfig = await readFile(path.join(dir, 'kilder.json'), 'utf8');
    assert.ok(!konfig.includes('pw-hemmelig'), 'kilder.json holds no secret');
    assert.deepEqual((await laesKonfig(dir)).kilder, [{ id: 'test-kalender', status: 'forbundet', zone: 'arbejde', valg: { konto: 'ella' }, tid: NU.toISOString(), af: 'henrik' }]);
    assert.deepEqual(await laesKildeHemmelighed(dir, 'test-kalender'), { adgangskode: 'pw-hemmelig' });
  });
});

test('forbind and frakobl each write a log line with time and source; frakobl removes the credentials; frakobl of an unconnected source is 409', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    r.registrer(testKilde());
    await assert.rejects(r.frakobl('test-kalender', EJER), fejlStatus(409));
    await r.forbind('test-kalender', { felter: { konto: 'ella', adgangskode: 'pw-1' } }, EJER);
    await r.frakobl('test-kalender', EJER);
    const log = await store.readLog(KILDER_LOG);
    assert.equal(log.length, 2);
    assert.match(log[1]!.tekst, /Henrik forbandt Testkalender/);
    assert.match(log[0]!.tekst, /Henrik frakoblede Testkalender/);
    assert.ok(log.every((e) => e.tid === NU.toISOString() && e.kilde === 'henrik' && e.ejer === 'henrik'));
    assert.ok(!JSON.stringify(log).includes('pw-1'));
    assert.equal(await laesKildeHemmelighed(dir, 'test-kalender'), null);
    assert.equal((await laesKonfig(dir)).kilder[0]?.status, 'frakoblet');
    await assert.rejects(r.laes('test-kalender'), fejlStatus(409));
  });
});

test('forbind: the first read is announced on the live bus; a failing first read still connects but announces nothing', async () => {
  await medData(async (dir, store) => {
    const kanaler: string[] = [];
    const r = lavRegister({ dataDir: dir, store, nu: () => NU, live: { notify: (id) => kanaler.push(id) } });
    r.registrer(testKilde());
    r.registrer(testKilde({ id: 'nede', read: async () => { throw new Error('nede'); } }));
    await r.forbind('test-kalender', { felter: { konto: 'a', adgangskode: 'b' } }, EJER);
    assert.deepEqual(kanaler, [FOERSTE_LAESNING]);
    const svar = await r.forbind('nede', { felter: { konto: 'a', adgangskode: 'b' } }, EJER);
    assert.deepEqual(svar, { forbundet: true, foersteLaesning: null });
    assert.deepEqual(kanaler, [FOERSTE_LAESNING]);
  });
});

test('laes: never a mail body — envelope keys outside the shape are dropped; a read of the wrong slags is refused; uklar is always true', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    const post = { id: '1', emne: 'Hej', fra: 'Clara', modtaget: NU.toISOString(), laest: false, flag: false, vedhaeftning: false, messageId: '<a@b>', tekst: 'BRØDTEKST', body: 'BODY' };
    r.registrer(testKilde({ id: 'post', slags: 'mail', standard: 'forbundet', read: async () => ({ slags: 'mail', hentet: 'x', uklar: true, data: [post] }) as unknown as Laesning }));
    r.registrer(testKilde({ id: 'forkert', slags: 'mail', standard: 'forbundet' }));
    r.registrer(testKilde({ id: 'tillid', standard: 'forbundet', read: async () => ({ slags: 'kalender', hentet: 'x', uklar: false, data: { generated: '', days: [], errors: [] } }) as unknown as Laesning }));
    const l = await r.laes('post');
    assert.equal(l.slags, 'mail');
    assert.ok(!JSON.stringify(l).includes('BRØDTEKST') && !JSON.stringify(l).includes('BODY'));
    assert.deepEqual(l.data, [{ id: '1', emne: 'Hej', fra: 'Clara', modtaget: NU.toISOString(), laest: false, flag: false, vedhaeftning: false, messageId: '<a@b>' }]);
    await assert.rejects(r.laes('forkert'), fejlStatus(502));
    assert.equal((await r.laes('tillid')).uklar, true);
    await assert.rejects(r.laes('ukendt'), fejlStatus(404));
  });
});

test('oversigt: every registered source with its card, connection and health; a throwing health check reads as nede', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    r.registrer(testKilde({ standard: 'forbundet' }));
    r.registrer(testKilde({ id: 'syg', standard: 'forbundet', helbred: async () => { throw new Error('bum'); } }));
    r.registrer(testKilde({ id: 'ny', slags: 'noter' }));
    const o = await r.oversigt();
    assert.deepEqual(o.map((k) => [k.id, k.forbundet, k.helbred?.status ?? null]), [['test-kalender', true, 'ok'], ['syg', true, 'nede'], ['ny', false, null]]);
    assert.equal(o[0]?.kort.titel, 'Testkalender');
    assert.equal(o[0]?.tillid, 'uklar');
  });
});

test('handl: only a declared verb, only on a connected source, through the policy layer (a guest is refused), one audit line per decision', async () => {
  await medData(async (dir, store) => {
    const revision = lavRevisionslog(dir, { nu: () => NU });
    const r = lavRegister({ dataDir: dir, store, nu: () => NU, revision });
    const kald: unknown[] = [];
    r.registrer(testKilde({ id: 'post', slags: 'mail', verber: { flyt: { verb: 'sorter', tekst: 'Flyt mailen' } }, act: async (navn, args) => { kald.push([navn, args]); return { ok: true, tekst: 'Flyttet.' }; } }));
    await assert.rejects(r.handl('post', 'flyt', {}, { person: EJER, kanal: 'knap' }), fejlStatus(409));
    await r.forbind('post', { felter: { konto: 'a', adgangskode: 'b' } }, EJER);
    await assert.rejects(r.handl('post', 'slet', {}, { person: EJER, kanal: 'knap' }), fejlStatus(400));
    await assert.rejects(r.handl('post', 'toString', {}, { person: EJER, kanal: 'knap' }), fejlStatus(400));
    await assert.rejects(r.handl('ukendt', 'flyt', {}, { person: EJER, kanal: 'knap' }), fejlStatus(404));
    await assert.rejects(r.handl('post', 'flyt', { id: '1' }, { person: GAEST, kanal: 'knap' }), fejlStatus(403));
    assert.deepEqual(kald, []);
    assert.deepEqual(await r.handl('post', 'flyt', { id: '1' }, { person: EJER, kanal: 'knap' }), { ok: true, tekst: 'Flyttet.' });
    assert.deepEqual(kald, [['flyt', { id: '1' }]]);
    const linjer = await revision.seneste(10);
    assert.deepEqual(linjer.map((l) => [l.person, l.rum, l.verb, l.udfald, l.handlingId]), [['henrik', 'kilde:post', 'sorter', 'tillad', 'flyt'], ['farmor', 'kilde:post', 'sorter', 'afvist', 'flyt']]);
  });
});

test('a connector only sees its own secrets and options through its context', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    let set: unknown;
    r.registrer(testKilde({ read: async (ctx) => { set = { zone: ctx.zone, valg: ctx.valg, h: await ctx.hemmelighed() }; return testKilde().read(ctx); } }));
    r.registrer(testKilde({ id: 'anden' }));
    await r.forbind('anden', { felter: { konto: 'x', adgangskode: 'ANDEN' } }, EJER);
    await r.forbind('test-kalender', { felter: { konto: 'ella', adgangskode: 'EGEN' }, zone: 'husstand' }, EJER);
    assert.deepEqual(set, { zone: 'husstand', valg: { konto: 'ella' }, h: { adgangskode: 'EGEN' } });
  });
});

// KC-0120 invariant (§0 r2): a source that is disconnected or not working contributes nothing to any read through
// the registry. Working = health ok, or snart-udloebet (it still reads; the panel shows it as Forbundet).
test('laes: a connected source whose health is not working gives no read — read() is never called', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU, helbredMaksMs: 30 });
    let laeste = 0;
    const read: Kilde['read'] = async (ctx) => { laeste += 1; return testKilde().read(ctx); };
    const syge: [string, Kilde['helbred']][] = [
      ['nede', async () => ({ status: 'nede' })], ['log-ind-igen', async () => ({ status: 'log-ind-igen' })], ['langsomt', async () => ({ status: 'langsomt' })],
      ['kaster', async () => { throw new Error('bum'); }], ['haenger', () => new Promise(() => {})],
    ];
    for (const [id, helbred] of syge) r.registrer(testKilde({ id, standard: 'forbundet', read, helbred }));
    for (const [id] of syge) await assert.rejects(r.laes(id), fejlStatus(502), id);
    assert.equal(laeste, 0);
    r.registrer(testKilde({ id: 'snart', standard: 'forbundet', read, helbred: async () => ({ status: 'snart-udloebet' }) }));
    assert.equal((await r.laes('snart')).slags, 'kalender');
    assert.equal(laeste, 1);
    r.registrer(testKilde({ id: 'fra', read }));
    await assert.rejects(r.laes('fra'), fejlStatus(409));
    assert.equal(laeste, 1);
  });
});

test('oversigt: sidstLaest is the time of the last successful read through the registry, else null', async () => {
  await medData(async (dir, store) => {
    let nu = NU;
    const r = lavRegister({ dataDir: dir, store, nu: () => nu });
    r.registrer(testKilde({ standard: 'forbundet' }));
    r.registrer(testKilde({ id: 'fejler', standard: 'forbundet', read: async () => { throw new KildeFejl(502, 'nede'); } }));
    assert.deepEqual((await r.oversigt()).map((k) => k.sidstLaest), [null, null]);
    await r.laes('test-kalender');
    nu = new Date(NU.getTime() + 60_000);
    await assert.rejects(r.laes('fejler'));
    assert.deepEqual((await r.oversigt()).map((k) => k.sidstLaest), [NU.toISOString(), null]);
  });
});

// KC-0136: a field may offer fixed choices (muligheder) and suggestions (forslag); a local source may prepare
// itself (opsaet, e.g. create the notes folder) before it is recorded — its options are what is stored, its text
// is logged and answered; a refusal records nothing.
test('forbind: a value outside the field\'s muligheder is refused (400)', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    const kort = { titel: 'Noter', tekst: 'Vælg.', handling: 'Vælg', felter: [{ navn: 'opsaetning', etiket: 'Opsætning', type: 'tekst' as const, paakraevet: true, muligheder: [{ vaerdi: 'ny', etiket: 'Ny' }, { vaerdi: 'eksisterende', etiket: 'Eksisterende' }] }, { navn: 'mappe', etiket: 'Mappe', type: 'mappe' as const, paakraevet: false, forslag: ['/a'] }] };
    r.registrer(testKilde({ id: 'n', slags: 'noter', auth: 'local', kort: async () => kort }));
    await assert.rejects(r.forbind('n', { felter: { opsaetning: 'begge' } }, EJER), fejlStatus(400));
    assert.deepEqual(await laesKonfig(dir), { kilder: [] });
    await r.forbind('n', { felter: { opsaetning: 'ny', mappe: '/b' } }, EJER); // a suggestion is not a limit
    assert.deepEqual((await laesKonfig(dir)).kilder[0]?.valg, { opsaetning: 'ny', mappe: '/b' });
  });
});

test('forbind: opsaet runs before the source is recorded; its options are stored and its text logged and answered', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    const kald: { zone: string; valg: Record<string, string> }[] = [];
    r.registrer(testKilde({
      id: 'n', slags: 'noter', auth: 'local', kort: async () => ({ titel: 'Noter', tekst: 'x', handling: 'Vælg', felter: [{ navn: 'mappe', etiket: 'Mappe', type: 'mappe', paakraevet: false }] }),
      opsaet: async (ctx) => { kald.push({ zone: ctx.zone, valg: { ...ctx.valg } }); return { tekst: 'Lavede mappen /hjem/Clawco/Vault.', valg: { mappe: '/hjem/Clawco/Vault' } }; },
    }));
    const svar = await r.forbind('n', { zone: 'husstand' }, EJER);
    assert.deepEqual(kald, [{ zone: 'husstand', valg: {} }]);
    assert.ok('forbundet' in svar);
    assert.equal(svar.opsat, 'Lavede mappen /hjem/Clawco/Vault.');
    assert.deepEqual((await laesKonfig(dir)).kilder[0]?.valg, { mappe: '/hjem/Clawco/Vault' });
    assert.match((await store.readLog(KILDER_LOG))[0]?.tekst ?? '', /forbandt Testkalender \(noter\)\. Lavede mappen \/hjem\/Clawco\/Vault\./);
  });
});

test('forbind: an opsaet refusal records nothing; options outside the card are refused', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    const felter = [{ navn: 'mappe', etiket: 'Mappe', type: 'mappe' as const, paakraevet: false }];
    r.registrer(testKilde({ id: 'nej', slags: 'noter', auth: 'local', kort: async () => ({ titel: 'N', tekst: 'x', handling: 'V', felter }), opsaet: async () => { throw new KildeFejl(409, 'Mappen er ikke tom.'); } }));
    r.registrer(testKilde({ id: 'snyd', slags: 'noter', auth: 'local', kort: async () => ({ titel: 'N', tekst: 'x', handling: 'V', felter }), opsaet: async () => ({ tekst: 'x', valg: { hemmelig: 'y' } }) }));
    await assert.rejects(r.forbind('nej', {}, EJER), fejlStatus(409));
    await assert.rejects(r.forbind('snyd', {}, EJER), fejlStatus(502));
    assert.deepEqual(await laesKonfig(dir), { kilder: [] });
    assert.deepEqual(await store.readLog(KILDER_LOG), []);
  });
});

// KC-0134: a source that checks its login in opsaet needs the password typed in the same request, before it is stored;
// a refusal stores no secret.
test('forbind: opsaet sees the secrets typed in this request; a refusal stores none', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    const sete: (Record<string, string> | null)[] = [];
    r.registrer(testKilde({
      id: 'post', slags: 'mail', auth: 'apikey', read: async () => ({ slags: 'mail', hentet: NU.toISOString(), uklar: true, data: [] }),
      opsaet: async (ctx) => {
        const h = await ctx.hemmelighed();
        sete.push(h);
        if (h?.['adgangskode'] !== 'rigtig') throw new KildeFejl(400, 'Forkert adgangskode.');
        return { tekst: 'Logget ind.', valg: { ...ctx.valg } };
      },
    }));
    await assert.rejects(r.forbind('post', { felter: { konto: 'a@b.example', adgangskode: 'forkert' } }, EJER), fejlStatus(400));
    assert.equal(await laesKildeHemmelighed(dir, 'post'), null);
    await r.forbind('post', { felter: { konto: 'a@b.example', adgangskode: 'rigtig' } }, EJER);
    assert.deepEqual(sete, [{ adgangskode: 'forkert' }, { adgangskode: 'rigtig' }]);
    assert.deepEqual(await laesKildeHemmelighed(dir, 'post'), { adgangskode: 'rigtig' });
  });
});

test('laesKonfigSync reads kilder.json like laesKonfig: missing = empty, corrupt = KonfigFejl', async () => {
  await medData(async (dir) => {
    assert.deepEqual(laesKonfigSync(dir), { kilder: [] });
    const k = { kilder: [{ id: 'noter', status: 'forbundet' as const, zone: 'privat' as const, valg: { mappe: '/v' }, tid: NU.toISOString(), af: 'henrik' }] };
    await skrivKonfig(dir, k);
    assert.deepEqual(laesKonfigSync(dir), k);
    await writeFile(path.join(dir, 'kilder.json'), '{ ikke json', 'utf8');
    assert.throws(() => laesKonfigSync(dir), KonfigFejl);
  });
});

test('KC-0148 hvor: the zone a source reads into and who connected it (null for a host source); unknown → 404', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    r.registrer(testKilde());
    r.registrer(testKilde({ id: 'vaert-kalender', standard: 'forbundet', zone: 'husstand' }));
    assert.deepEqual(await r.hvor('vaert-kalender'), { zone: 'husstand', af: null });
    await r.forbind('test-kalender', { felter: { konto: 'ella', adgangskode: 'pw-123' }, zone: 'husstand' }, EJER);
    assert.deepEqual(await r.hvor('test-kalender'), { zone: 'husstand', af: 'henrik' });
    await assert.rejects(r.hvor('ukendt'), fejlStatus(404));
  });
});

// ---------- KC-0133: the hooks an OAuth provider needs ----------

test('forbind: a field with `miljoe` goes to the env file (key + length only), never to kilder.json or the secret file', async () => {
  await medData(async (dir, store) => {
    const envFil = path.join(dir, 'app.env');
    const env: Record<string, string | undefined> = {};
    const r = lavRegister({ dataDir: dir, store, nu: () => NU, adresse: 'https://kc.example', miljoe: { fil: envFil, env } });
    let saaKlient = '';
    r.registrer(testKilde({
      auth: 'oauth',
      kort: async () => ({ titel: 'G', tekst: 'Google.', handling: 'Log ind', felter: [
        { navn: 'klient_id', etiket: 'Klient-id', type: 'tekst', paakraevet: true, miljoe: 'KC_GOOGLE_CLIENT_ID' },
        { navn: 'klient_hemmelighed', etiket: 'Klienthemmelighed', type: 'hemmelig', paakraevet: true, miljoe: 'KC_GOOGLE_CLIENT_SECRET' },
      ] }),
      oauth: { start: async (state) => { saaKlient = env['KC_GOOGLE_CLIENT_ID'] ?? ''; return { url: `https://udbyder.example/?state=${state}` }; }, tilbage: async () => ({ refresh_token: 'r' }) },
    }));
    const svar = await r.forbind('test-kalender', { felter: { klient_id: 'id-123.apps', klient_hemmelighed: 'GOCSPX-hemmelig' } }, EJER);
    assert.ok('omdiriger' in svar);
    assert.equal(saaKlient, 'id-123.apps', 'the env is set before the provider URL is made');
    assert.equal(env['KC_GOOGLE_CLIENT_SECRET'], 'GOCSPX-hemmelig');
    assert.equal(await readFile(envFil, 'utf8'), 'KC_GOOGLE_CLIENT_ID=id-123.apps\nKC_GOOGLE_CLIENT_SECRET=GOCSPX-hemmelig\n');
    const state = new URL((svar as { omdiriger: string }).omdiriger).searchParams.get('state')!;
    await r.tilbage('test-kalender', state, 'kode', EJER);
    assert.deepEqual(await laesKildeHemmelighed(dir, 'test-kalender'), { refresh_token: 'r' });
    const konfig = JSON.stringify(await laesKonfig(dir));
    assert.ok(!konfig.includes('hemmelig') && !konfig.includes('id-123'), 'no env value in kilder.json');
  });
});

test('forbind: a `miljoe` key outside the allowlist is refused (400) and nothing is written', async () => {
  await medData(async (dir, store) => {
    const envFil = path.join(dir, 'app.env');
    const r = lavRegister({ dataDir: dir, store, miljoe: { fil: envFil, env: {} } });
    r.registrer(testKilde({ kort: async () => ({ titel: 'X', tekst: 'X.', handling: 'Forbind', felter: [{ navn: 'sti', etiket: 'Sti', type: 'tekst', paakraevet: true, miljoe: 'PATH' }] }) }));
    await assert.rejects(r.forbind('test-kalender', { felter: { sti: '/tmp' } }, EJER), fejlStatus(400));
    await assert.rejects(readFile(envFil, 'utf8'), { code: 'ENOENT' });
    assert.deepEqual((await laesKonfig(dir)).kilder, []);
  });
});

test('tilbage: the provider gets the state it issued its URL for (PKCE verifier lookup)', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, adresse: 'https://kc.example' });
    const set: string[] = [];
    r.registrer(testKilde({ auth: 'oauth', kort: async () => ({ titel: 'G', tekst: 'G.', handling: 'Log ind', felter: [] }),
      oauth: { start: async (state) => ({ url: `https://u.example/?state=${state}` }), tilbage: async (_k, _c, state) => { set.push(state); return { refresh_token: 'r' }; } } }));
    const { omdiriger } = await r.forbind('test-kalender', {}, EJER) as { omdiriger: string };
    const state = new URL(omdiriger).searchParams.get('state')!;
    await r.tilbage('test-kalender', state, 'kode', EJER);
    assert.deepEqual(set, [state]);
  });
});

test('frakobl: the connector\'s own frakobl (revoke at the provider) runs with its secret first; a failing one still disconnects', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    const saa: (Record<string, string> | null)[] = [];
    r.registrer(testKilde({ frakobl: async (ctx) => { saa.push(await ctx.hemmelighed()); } }));
    r.registrer(testKilde({ id: 'test-to', frakobl: async () => { throw new Error('udbyderen svarer ikke'); } }));
    await r.forbind('test-kalender', { felter: { konto: 'ella', adgangskode: 'pw-1' } }, EJER);
    await r.forbind('test-to', { felter: { konto: 'ella', adgangskode: 'pw-2' } }, EJER);
    await r.frakobl('test-kalender', EJER);
    assert.deepEqual(saa, [{ adgangskode: 'pw-1' }]);
    await r.frakobl('test-to', EJER);
    assert.equal(await laesKildeHemmelighed(dir, 'test-to'), null);
    assert.equal((await laesKonfig(dir)).kilder.find((k) => k.id === 'test-to')?.status, 'frakoblet');
  });
});

test('KC-0139: reconnecting a source that is already connected (Log ind igen) is no first look: the KC-0128 preview is not shown again', async () => {
  await medData(async (dir, store) => {
    const vist: string[] = [];
    const r = lavRegister({ dataDir: dir, store, nu: () => NU, foersteLaesning: async ({ kilde }) => { vist.push(kilde.id); } });
    r.registrer(testKilde());
    const felter = { konto: 'ella', adgangskode: 'pw' };
    await r.forbind('test-kalender', { felter }, EJER);
    assert.deepEqual(vist, ['test-kalender']);
    const igen = await r.forbind('test-kalender', { felter }, EJER);
    assert.deepEqual(vist, ['test-kalender'], 'a reconnect shows no new first look');
    assert.ok('foersteLaesning' in igen && igen.foersteLaesning, 'the read itself still happens and is reported');
  });
});

// KC-0137: a card field may be a file (its text is sent), take several lines, or be hidden — a stored option the card
// never shows (a feed list): opsaet() may set it up to its own `maks`, a connect body may never carry it.
const FELTER_137 = [
  { navn: 'adresser', etiket: 'Adresser', type: 'tekst' as const, flere: true, paakraevet: false, maks: 200 },
  { navn: 'opml', etiket: 'OPML', type: 'fil' as const, paakraevet: false, maks: 1000 },
  { navn: 'feeds', etiket: 'Feeds', type: 'tekst' as const, skjult: true, paakraevet: false, maks: 5000 },
];

test('forbind: a file and a several-lines field may carry line breaks; an ordinary field may not', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    const set: Record<string, string>[] = [];
    r.registrer(testKilde({
      id: 'n', slags: 'nyheder', auth: 'local',
      read: async () => ({ slags: 'nyheder', hentet: NU.toISOString(), uklar: true, data: { nyheder: [], status: { antal: 0, medNyheder: 0, nyheder: 0, fejlede: [] } } }),
      kort: async () => ({ titel: 'N', tekst: 'x', handling: 'V', felter: [...FELTER_137, { navn: 'navn', etiket: 'Navn', type: 'tekst', paakraevet: false }] }),
      opsaet: async (ctx) => { set.push({ ...ctx.valg }); return { tekst: 'ok', valg: { feeds: 'x'.repeat(4000) } }; },
    }));
    await r.forbind('n', { felter: { adresser: 'a\nb', opml: '<opml>\n</opml>' } }, EJER);
    assert.deepEqual(set, [{ adresser: 'a\nb', opml: '<opml>\n</opml>' }]);
    await assert.rejects(r.forbind('n', { felter: { navn: 'a\nb' } }, EJER), fejlStatus(400));
    await assert.rejects(r.forbind('n', { felter: { opml: 'x'.repeat(1001) } }, EJER), fejlStatus(400));
  });
});

test('forbind: opsaet may store a hidden option up to its maks; a hidden field in the body is refused (400)', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    let svar = 'x'.repeat(4000);
    r.registrer(testKilde({
      id: 'n', slags: 'nyheder', auth: 'local',
      read: async () => ({ slags: 'nyheder', hentet: NU.toISOString(), uklar: true, data: { nyheder: [], status: { antal: 0, medNyheder: 0, nyheder: 0, fejlede: [] } } }),
      kort: async () => ({ titel: 'N', tekst: 'x', handling: 'V', felter: FELTER_137 }),
      opsaet: async () => ({ tekst: 'ok', valg: { feeds: svar } }),
    }));
    await assert.rejects(r.forbind('n', { felter: { feeds: '[]' } }, EJER), fejlStatus(400));
    assert.deepEqual(await laesKonfig(dir), { kilder: [] });
    await r.forbind('n', { felter: { adresser: 'a' } }, EJER);
    assert.equal((await laesKonfig(dir)).kilder[0]?.valg['feeds']?.length, 4000);
    svar = 'x'.repeat(5001);
    await assert.rejects(r.forbind('n', { felter: { adresser: 'a' } }, EJER), fejlStatus(502));
  });
});
