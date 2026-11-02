// KC-0132: the fake connectors — one per slags, deterministic from injected
// data, each with the modes ok | log-ind-igen | nede | langsom; registered only
// when KC_KILDER_MODE=fake (dev) or by the test world, never otherwise.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { falskeKilder, FALSKE_TILSTANDE, kilderFraMiljoe, parseFalskTilstand, type FalskData, type FalskTilstand } from '../../src/kilder/falsk/falsk.ts';
import { lavRegister } from '../../src/kilder/register.ts';
import { SLAGS, type KildeKontekst, type Slags } from '../../src/kilder/types.ts';
import { medData, NU } from './hjaelp.ts';

const DATA: FalskData = {
  kalender: () => ({ generated: NU.toISOString(), days: [{ date: '2026-10-31', events: [{ title: 'Stand-up' }] }], errors: [] }),
  mail: () => [{ id: '1', emne: 'Hej', fra: 'Clara', modtaget: NU.toISOString(), laest: false, flag: false, vedhaeftning: false }],
  nyheder: () => ({ nyheder: [{ titel: 'Nyt kabelskib', kilde: 'Vindkraft Dagligt' }], status: { antal: 1, medNyheder: 1, nyheder: 1, fejlede: [] } }),
  noter: () => ({ personer: [{ navn: 'Clara Holm', relation: 'kollega', mappe: '40-Mennesker' }], noter: [{ titel: 'Møde', sti: '00-Indbakke/Møde.md', aendret: NU.toISOString() }] }),
  beskeder: () => [{ kanal: 'signal', samtaleId: 's1', samtaleNavn: 'Familien', afsender: { navn: 'Maja' }, tid: NU.toISOString(), tekst: 'Husk mælk', laest: false }],
};
const ctx: KildeKontekst = { nu: NU, zone: 'privat', valg: {}, hemmelighed: async () => null };

test('one fake per slags, ids falsk-<slags>, every one registers cleanly', async () => {
  await medData(async (dir, store) => {
    const kilder = falskeKilder({ data: DATA });
    assert.deepEqual(kilder.map((k) => [k.id, k.slags]), SLAGS.map((s) => [`falsk-${s}`, s]));
    assert.deepEqual(kilder.map((k) => k.auth), ['oauth', 'bridge', 'local', 'local', 'apikey']);
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    for (const k of kilder) r.registrer(k);
    for (const k of kilder) assert.ok((await k.kort(ctx)).titel.length > 0);
  });
});

test('mode ok: read returns the injected data, untrusted, and health is ok', async () => {
  for (const k of falskeKilder({ data: DATA })) {
    const l = await k.read(ctx);
    assert.equal(l.slags, k.slags);
    assert.equal(l.uklar, true);
    assert.deepEqual(l.data, DATA[k.slags](NU));
    assert.deepEqual(await k.helbred(ctx), { status: 'ok' });
  }
});

test('modes log-ind-igen and nede: read fails and health says so', async () => {
  for (const tilstand of ['log-ind-igen', 'nede'] as const) {
    for (const k of falskeKilder({ data: DATA, tilstand: () => tilstand })) {
      await assert.rejects(k.read(ctx));
      assert.equal((await k.helbred(ctx)).status, tilstand);
    }
  }
});

test('mode langsom: read waits, then answers; health is langsomt', async () => {
  const [k] = falskeKilder({ data: DATA, tilstand: (s: Slags): FalskTilstand => (s === 'kalender' ? 'langsom' : 'ok'), forsinkelseMs: 60 });
  const t0 = Date.now();
  await k!.read(ctx);
  assert.ok(Date.now() - t0 >= 50);
  assert.equal((await k!.helbred(ctx)).status, 'langsomt');
  assert.deepEqual(FALSKE_TILSTANDE, ['ok', 'log-ind-igen', 'nede', 'langsom', 'snart-udloebet']);
});

test('mode snart-udloebet (KC-0139): it works, and its health names an expiry 36 hours ahead', async () => {
  for (const k of falskeKilder({ data: DATA, tilstand: () => 'snart-udloebet' })) {
    assert.deepEqual((await k.read(ctx)).data, DATA[k.slags](NU));
    const h = await k.helbred(ctx);
    assert.equal(h.status, 'ok');
    assert.equal(h.udloeber, new Date(NU.getTime() + 36 * 3600_000).toISOString());
  }
});

test('KC-0139: connecting again repairs a failing fake — the calendar through the OAuth round, the others through the connect itself', async () => {
  const repareret = new Set<Slags>();
  const kilder = falskeKilder({ data: DATA, tilstand: () => 'log-ind-igen', reparation: repareret });
  const [kal, mail] = [kilder[0]!, kilder[1]!];
  assert.equal((await mail.helbred(ctx)).status, 'log-ind-igen');
  await mail.opsaet!({ ...ctx, valg: { brugernavn: 'henrik' } });
  assert.equal((await mail.helbred(ctx)).status, 'ok');
  assert.deepEqual((await mail.read(ctx)).data, DATA.mail(NU));
  assert.equal((await kal.helbred(ctx)).status, 'log-ind-igen');
  await kal.oauth!.tilbage('falsk-kode', ctx, 'abc');
  assert.equal((await kal.helbred(ctx)).status, 'ok');
  repareret.clear();
  assert.equal((await kal.helbred(ctx)).status, 'log-ind-igen', 'the world forgets the repair at the next moment');
});

test('the fake calendar walks the OAuth round: start gives the callback with state and code, a wrong code is refused', async () => {
  const k = falskeKilder({ data: DATA })[0]!;
  const { url } = await k.oauth!.start('abc', '/api/kilder/falsk-kalender/tilbage', ctx);
  assert.equal(url, '/api/kilder/falsk-kalender/tilbage?state=abc&code=falsk-kode');
  assert.deepEqual(await k.oauth!.tilbage('falsk-kode', ctx, 'abc'), { adgang: 'falsk-adgang' });
  await assert.rejects(k.oauth!.tilbage('forkert', ctx, 'abc'));
});

test('the fake mail declares one sorting verb and acts on it', async () => {
  const k = falskeKilder({ data: DATA })[1]!;
  assert.deepEqual(k.verber, { flyt: { verb: 'sorter', tekst: 'Flyt mailen til en mappe' } });
  assert.equal((await k.act!('flyt', { id: '1', til: 'Arkiv' }, ctx)).ok, true);
});

test('the fakes exist only under KC_KILDER_MODE=fake; otherwise the host\'s own connectors; an unknown mode fails', () => {
  const falsk = () => falskeKilder({ data: DATA });
  const legacy = () => [];
  assert.equal(kilderFraMiljoe({ KC_KILDER_MODE: 'fake' }, { falsk, legacy }).length, 5);
  assert.deepEqual(kilderFraMiljoe({}, { falsk, legacy }), []);
  assert.deepEqual(kilderFraMiljoe({ KC_KILDER_MODE: '' }, { falsk, legacy }), []);
  assert.throws(() => kilderFraMiljoe({ KC_KILDER_MODE: 'rigtig' }, { falsk, legacy }), /KC_KILDER_MODE/);
});

test('KC-0128: the fakes are refused next to the real agent, so a first value never comes from invented data', () => {
  const falsk = () => falskeKilder({ data: DATA });
  const legacy = () => [];
  assert.throws(() => kilderFraMiljoe({ KC_KILDER_MODE: 'fake' }, { falsk, legacy, agent: 'hermes-http' }), /KC_KILDER_MODE=fake.*KC_AGENT=fake/);
  assert.throws(() => kilderFraMiljoe({ KC_KILDER_MODE: 'fake' }, { falsk, legacy, agent: 'direkte' }), /KC_KILDER_MODE=fake.*KC_AGENT=fake/, 'a direct model never reads fake sources either (KC-0180)');
  assert.equal(kilderFraMiljoe({ KC_KILDER_MODE: 'fake' }, { falsk, legacy, agent: 'fake' }).length, 5);
  assert.deepEqual(kilderFraMiljoe({}, { falsk, legacy, agent: 'hermes-http' }), []);
});

test('parseFalskTilstand reads "slags:tilstand" pairs and refuses anything else', () => {
  assert.deepEqual(parseFalskTilstand(''), {});
  assert.deepEqual(parseFalskTilstand('kalender:nede, mail:langsom'), { kalender: 'nede', mail: 'langsom' });
  assert.throws(() => parseFalskTilstand('fax:nede'));
  assert.throws(() => parseFalskTilstand('kalender:i-stykker'));
});
