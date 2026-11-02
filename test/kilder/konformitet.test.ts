// KC-0120: every connector this app ships passes the conformance suite
// (test/kilder/konformitet.ts) — the five fakes and Henrik's three legacy
// adapters, each also with its source down — and the suite can fail: a
// connector that breaks any rule is refused.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kildeKonformitet } from './konformitet.ts';
import { falskeKilder, type FalskData } from '../../src/kilder/falsk/falsk.ts';
import { kiraKalender, kiraMail, kiraMorgenavis, type Runner } from '../../src/kilder/legacy/legacy.ts';
import { lavRegister } from '../../src/kilder/register.ts';
import { googleKalender } from '../../src/kilder/google-kalender/kilde.ts';
import { falskGoogle } from '../../src/kilder/google/falsk-google.ts';
import { mailGmail } from '../../src/kilder/mail-gmail/kilde.ts';
import { KildeFejl, type Kilde, type Laesning } from '../../src/kilder/types.ts';
import { readNyhederSource } from '../../src/rooms/nyheder/source.ts';
import { parseAll } from '../../src/rooms/mail/source.ts';
import type { RumLager } from '../../src/store/types.ts';
import { NU, testKilde } from './hjaelp.ts';

const ROD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = path.join(ROD, 'test', 'fixtures');
const uge = await readFile(path.join(FIX, 'kalender_uge_sample.json'), 'utf8');
const handling = await readFile(path.join(FIX, 'himalaya_handling_sample.json'), 'utf8');
const svar = (stdout: string, code = 0): Runner => async () => ({ code, stdout, stderr: '' });

const DATA: FalskData = {
  kalender: () => ({ generated: NU.toISOString(), days: [{ date: '2026-10-31', events: [{ title: 'Stand-up' }] }], errors: [] }),
  mail: () => [{ id: '1', emne: 'Hej', fra: 'Clara', modtaget: NU.toISOString(), laest: false, flag: false, vedhaeftning: false }],
  nyheder: () => ({ nyheder: [{ titel: 'Nyt kabelskib', kilde: 'Vindkraft Dagligt' }], status: { antal: 1, medNyheder: 1, nyheder: 1, fejlede: [] } }),
  noter: () => ({ personer: [], noter: [] }),
  beskeder: () => [],
};

const ok = falskeKilder({ data: DATA });
const nede = falskeKilder({ data: DATA, tilstand: () => 'nede' });
for (const [i, k] of ok.entries()) {
  test(`conformance: the fake ${k.id}`, async () => { await kildeKonformitet(k, { nede: nede[i]! }); });
}

test('conformance: kira-kalender', async () => {
  await kildeKonformitet(kiraKalender({ script: path.join(ROD, 'scripts', 'kalender_uge.py'), run: svar(uge) }), { nede: kiraKalender({ script: '/nonexistent/kalender_uge.py', run: svar('', 1) }) });
});
test('conformance: google-kalender (over the fake Google), with and without its app set up', async () => {
  const klient = { id: 'klient-1.apps.googleusercontent.com', hemmelighed: 'GOCSPX-k' };
  const env = { KC_GOOGLE_CLIENT_ID: klient.id, KC_GOOGLE_CLIENT_SECRET: klient.hemmelighed };
  const g = falskGoogle({ klient, kendteRefresh: ['1//kendt'], kalendere: () => [{ id: 'p@example.test', summary: 'p@example.test', events: [{ id: 'a', summary: 'Stand-up', start: { dateTime: '2026-10-31T09:00:00+01:00' }, end: { dateTime: '2026-10-31T09:15:00+01:00' } }] }] });
  const nede = googleKalender({ env, adresse: 'https://kc.example', hent: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch });
  await kildeKonformitet(googleKalender({ env, adresse: 'https://kc.example', hent: g.hent }), { nede, hemmelighed: { refresh_token: '1//kendt' } });
  // Not yet set up: the card with its steps and fields is still valid data, and the source is down, not a success.
  const ikkeSat = googleKalender({ env: {}, adresse: 'https://kc.example', hent: g.hent });
  await assert.rejects(kildeKonformitet(ikkeSat, { hemmelighed: { refresh_token: '1//kendt' } }), KildeFejl);
});
test('conformance: kira-morgenavis', async () => {
  await kildeKonformitet(kiraMorgenavis({ glob: path.join(FIX, 'avis_data_sample.json'), laes: readNyhederSource }), { nede: kiraMorgenavis({ glob: '/nonexistent/avis_{date}.json', laes: readNyhederSource }) });
});
test('conformance: kira-mail', async () => {
  await kildeKonformitet(kiraMail({ himalaya: 'himalaya', run: svar(handling), parse: parseAll }), { nede: kiraMail({ himalaya: 'himalaya', run: svar('', 1), parse: parseAll }) });
});

test('the suite fails a connector that breaks a rule', async () => {
  const mail: Laesning = { slags: 'mail', hentet: NU.toISOString(), uklar: true, data: [{ id: '1', emne: 'Hej', fra: 'A', modtaget: '', laest: false, flag: false, vedhaeftning: false }] };
  const brud: [string, Partial<Kilde>][] = [
    ['a forbidden verb', { verber: { betal: { verb: 'betal', tekst: 'Betal' } }, act: async () => ({ ok: true, tekst: '' }) }],
    ['an unknown verb', { verber: { hop: { verb: 'hop' as never, tekst: 'Hop' } }, act: async () => ({ ok: true, tekst: '' }) }],
    ['verbs without act()', { verber: { flyt: { verb: 'sorter', tekst: 'Flyt' } } }],
    ['two zones', { zone: ['privat', 'arbejde'] as never }],
    ['an unknown zone', { zone: 'offentlig' as never }],
    ['a tillid other than uklar', { tillid: 'troet' as never }],
    ['a read without uklar', { read: async () => ({ ...(await testKilde().read({} as never)), uklar: false as never }) }],
    ['a read of another slags', { read: async () => mail }],
    ['a mail read with a body', { slags: 'mail', read: async () => ({ ...mail, data: [{ ...mail.data[0]!, body: 'Hemmeligt indhold' } as never] }) }],
    ['a health check that throws', { helbred: async () => { throw new Error('ned'); } }],
    ['a health status off the list', { helbred: async () => ({ status: 'fin' as never }) }],
    ['markup on the card', { kort: async () => ({ titel: '<b>Kalender</b>', tekst: 'x', felter: [], handling: 'Forbind' }) }],
    ['a card without text', { kort: async () => ({ titel: 'Kalender', tekst: ' ', felter: [], handling: 'Forbind' }) }],
  ];
  for (const [hvad, over] of brud) await assert.rejects(kildeKonformitet(testKilde(over)), `the suite accepted ${hvad}`);
  // A source that is down must still answer its health check, and fail its read with KildeFejl, not a raw error.
  await assert.rejects(kildeKonformitet(testKilde(), { nede: testKilde({ helbred: async () => { throw new Error('ned'); } }) }));
  await assert.rejects(kildeKonformitet(testKilde(), { nede: testKilde({ read: async () => { throw new Error('rå fejl'); } }) }));
  await kildeKonformitet(testKilde(), { nede: testKilde({ helbred: async () => ({ status: 'nede' }), read: async () => { throw new KildeFejl(502, 'nede'); } }) });
});

test('the registry refuses a connector with two zones, or an act() without verbs', () => {
  const r = lavRegister({ dataDir: '/nonexistent', store: {} as RumLager });
  assert.throws(() => r.registrer(testKilde({ zone: ['privat', 'arbejde'] as never })), /zone/);
  assert.throws(() => r.registrer(testKilde({ act: async () => ({ ok: true, tekst: '' }) })), /act\(\) kræver/);
  assert.deepEqual(r.liste(), []);
});

test('conformance: mail-gmail (over the fake Google and a fake mail reader), with and without its app set up', async () => {
  const klient = { id: 'klient-1.apps.googleusercontent.com', hemmelighed: 'GOCSPX-k' };
  const env = { KC_GOOGLE_CLIENT_ID: klient.id, KC_GOOGLE_CLIENT_SECRET: klient.hemmelighed };
  const g = falskGoogle({ klient, kalendere: () => [], kendteMailRefresh: ['1//kendt'] });
  const konto = { kuverter: DATA.mail(NU), tal: { indbakke: 1, ulaeste: 1, mapper: {} } };
  const laes = async () => konto;
  const nede = mailGmail({ env, adresse: 'https://kc.example', hent: g.hent, laes: async () => { throw Object.assign(new Error('x'), { code: 'ECONNREFUSED' }); } });
  const hemmelighed = { refresh_token: '1//kendt', adresse: 'ella@gmail.example' };
  await kildeKonformitet(mailGmail({ env, adresse: 'https://kc.example', hent: g.hent, laes }), { nede, hemmelighed });
  await assert.rejects(kildeKonformitet(mailGmail({ env: {}, adresse: 'https://kc.example', hent: g.hent, laes }), { hemmelighed }), KildeFejl);
});
