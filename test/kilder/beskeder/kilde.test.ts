// KC-0138: the Beskeder connector over Hermes' inbound log (Path B) — read only what was chosen, keep it a bounded
// time, forget a conversation the moment it is un-chosen, say honestly what Hermes can see, and never act.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beskederKilde, BESKEDER_ID, cacheFil } from '../../../src/kilder/beskeder/kilde.ts';
import { LOG_FIL, STATUS_FIL } from '../../../src/kilder/beskeder/jsonl.ts';
import { IKKE, samtaleNoegle } from '../../../src/kilder/beskeder/valg.ts';
import { lavRegister } from '../../../src/kilder/register.ts';
import { GENFORBIND_KANAL } from '../../../src/kilder/helbred-tekst.ts';
import { KildeFejl, type Besked, type Kilde, type KildeKontekst } from '../../../src/kilder/types.ts';

const NU = new Date('2026-11-01T10:00:00.000Z');
const MAJA = samtaleNoegle('signal', '+4512345678');
const FAMILIE = samtaleNoegle('telegram', '-100200');
const ctx = (valg: Record<string, string> = {}, nu = NU): KildeKontekst => ({ nu, zone: 'privat', valg, hemmelighed: async () => null });
const linje = (o: Record<string, unknown>): string => `${JSON.stringify({ kanal: 'signal', samtale: '+4512345678', gruppe: false, afsender: '+4512345678', tid: '2026-11-01T08:00:00.000Z', tekst: 'Hej', ...o })}\n`;

async function verden(linjer: string[], status?: string[]): Promise<{ dir: string; k: Kilde; ryd: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-beskeder-'));
  await mkdir(path.join(dir, 'beskeder'), { recursive: true });
  await writeFile(path.join(dir, 'beskeder', LOG_FIL), linjer.join(''));
  if (status) await writeFile(path.join(dir, 'beskeder', STATUS_FIL), JSON.stringify({ platforms: status, tid: '2026-11-01T06:00:00.000Z' }));
  const k = beskederKilde({ dataDir: dir, kontakter: async () => [{ id: 'maja', navn: 'Maja', relation: 'din kone', numre: ['+4512345678'] }] });
  return { dir, k, ryd: () => rm(dir, { recursive: true, force: true }) };
}
const data = async (k: Kilde, valg: Record<string, string>, nu = NU): Promise<Besked[]> => {
  const l = await k.read(ctx(valg, nu));
  assert.equal(l.slags, 'beskeder');
  assert.equal(l.uklar, true);
  return l.data as Besked[];
};

const LINJER = [
  linje({ tekst: 'Kan du hente Ella kl. 15 eller 16?', tid: '2026-11-01T08:00:00.000Z' }),
  linje({ kanal: 'telegram', samtale: '-100200', gruppe: true, afsender: '77', samtaleNavn: 'Familien', tekst: 'Gruppebesked', tid: '2026-11-01T08:30:00.000Z' }),
];

test('a read-only connector: no verbs, no act, auth bridge, slags beskeder, registers cleanly', async () => {
  const { dir, k, ryd } = await verden(LINJER);
  try {
    assert.equal(k.id, BESKEDER_ID);
    assert.equal(k.slags, 'beskeder');
    assert.equal(k.auth, 'bridge');
    assert.equal(k.act, undefined);
    assert.equal(k.verber, undefined);
    const store = { appendLog: async () => undefined } as never;
    lavRegister({ dataDir: dir, store }).registrer(k);
  } finally { await ryd(); }
});

test('nothing is read before a conversation is chosen; only chosen conversations, in their zone', async () => {
  const { k, ryd } = await verden(LINJER);
  try {
    assert.deepEqual(await data(k, {}), []);
    assert.deepEqual(await data(k, { [MAJA]: IKKE, [FAMILIE]: IKKE }), []);
    const b = await data(k, { [MAJA]: 'husstand' });
    assert.equal(b.length, 1);
    assert.equal(b[0]?.afsender.navn, 'Maja (din kone)');
    assert.equal(b[0]?.zone, 'husstand');
    assert.ok(!JSON.stringify(b).includes('Gruppebesked'));
  } finally { await ryd(); }
});

test('chosen messages are cached, and un-choosing a conversation deletes its cached messages', async () => {
  const { dir, k, ryd } = await verden(LINJER);
  try {
    await data(k, { [MAJA]: 'privat', [FAMILIE]: 'husstand' });
    const foer = await readFile(cacheFil(dir), 'utf8');
    assert.ok(foer.includes('Gruppebesked') && foer.includes('hente Ella'));
    assert.ok(k.opsaet);
    const r = await k.opsaet(ctx({ [MAJA]: 'privat', [FAMILIE]: IKKE }));
    assert.deepEqual(r.valg, { [MAJA]: 'privat' });
    const efter = await readFile(cacheFil(dir), 'utf8');
    assert.ok(!efter.includes('Gruppebesked'));
    assert.ok(efter.includes('hente Ella'));
    await k.frakobl?.(ctx());
    await assert.rejects(readFile(cacheFil(dir), 'utf8'));
    await readFile(path.join(dir, 'beskeder', LOG_FIL), 'utf8'); // Hermes' own log is the user's: never touched
  } finally { await ryd(); }
});

test('a cached message survives the log rotating away, then is purged after the retention window (14 days)', async () => {
  const { dir, k, ryd } = await verden(LINJER);
  try {
    await data(k, { [MAJA]: 'privat' });
    await writeFile(path.join(dir, 'beskeder', LOG_FIL), '');
    assert.equal((await data(k, { [MAJA]: 'privat' }, new Date('2026-11-10T08:00:00.000Z'))).length, 1);
    assert.equal((await data(k, { [MAJA]: 'privat' }, new Date('2026-11-15T09:00:00.000Z'))).length, 0);
  } finally { await ryd(); }
});

test('a line older than the window is never cached; the same line read twice is one message', async () => {
  const { k, ryd } = await verden([...LINJER, linje({ tekst: 'gammel', tid: '2026-10-01T08:00:00.000Z' }), LINJER[0] ?? '']);
  try {
    const b = await data(k, { [MAJA]: 'privat' });
    assert.deepEqual(b.map((x) => x.tekst), ['Kan du hente Ella kl. 15 eller 16?']);
  } finally { await ryd(); }
});

test('the card: no log → explains what is needed; log → one choice per conversation, what Hermes can see, read-only', async () => {
  const tom = await mkdtemp(path.join(tmpdir(), 'kc-beskeder-'));
  try {
    const intet = await beskederKilde({ dataDir: tom }).kort(ctx());
    assert.equal(intet.felter.length, 0);
    assert.match(intet.tekst, /Hermes skriver ingen beskeder til Clawco endnu/);
    await assert.rejects(beskederKilde({ dataDir: tom }).opsaet?.(ctx()) ?? Promise.reject(new Error('mangler')), (e) => e instanceof KildeFejl && e.status === 400);
  } finally { await rm(tom, { recursive: true, force: true }); }
  const { k, ryd } = await verden(LINJER);
  try {
    const kort = await k.kort(ctx());
    assert.equal(kort.felter.length, 2);
    assert.match(kort.tekst, /Hermes kan se 2 samtaler/);
    assert.match(kort.tekst, /svarer aldrig/);
    assert.match(kort.tekst, /Andre samtaler ser hverken Hermes eller Clawco/);
    assert.ok(!kort.tekst.includes('4512345678'));
    const valgt = await k.kort(ctx({ [MAJA]: 'privat' }));
    assert.match(valgt.tekst, /Clawco læser 1 af 2 samtaler/);
  } finally { await ryd(); }
});

test('health: no log is nede; a chosen channel missing at the last gateway start is log-ind-igen with its own re-link step', async () => {
  const tom = await mkdtemp(path.join(tmpdir(), 'kc-beskeder-'));
  try { assert.equal((await beskederKilde({ dataDir: tom }).helbred(ctx())).status, 'nede'); } finally { await rm(tom, { recursive: true, force: true }); }
  const { k, ryd } = await verden(LINJER, ['telegram']);
  try {
    const h = await k.helbred(ctx({ [MAJA]: 'privat' }));
    assert.equal(h.status, 'log-ind-igen');
    assert.equal(h.tekst, GENFORBIND_KANAL.signal);
    const ok = await k.helbred(ctx({ [FAMILIE]: 'privat' }));
    assert.equal(ok.status, 'ok');
    assert.match(ok.tekst ?? '', /Seneste besked/);
  } finally { await ryd(); }
});

test('the fixed card words for a broken message channel speak of Hermes, not of a password', async () => {
  const { kortTekst } = await import('../../../src/kilder/helbred-tekst.ts');
  const t = kortTekst('log-ind-igen', 'bridge', 'beskeder');
  assert.match(t.titel, /Hermes/);
  // The card cannot say which channel (fixed words only), so it carries each channel's own re-link step.
  for (const trin of ['hermes whatsapp', 'signal-cli link', 'hermes gateway setup']) assert.ok(t.tekst.includes(trin), trin);
  assert.ok(!/adgangskode/i.test(`${t.titel} ${t.tekst} ${t.knap}`));
  assert.ok(!/adgangskode/i.test(kortTekst('nede', 'bridge', 'beskeder').knap));
  for (const s of Object.values(GENFORBIND_KANAL)) assert.ok(s.length > 10);
});

test('conformance: the Beskeder connector (down = no log at all)', async () => {
  const { kildeKonformitet } = await import('../konformitet.ts');
  const { k, ryd } = await verden(LINJER);
  const tom = await mkdtemp(path.join(tmpdir(), 'kc-beskeder-'));
  try { await kildeKonformitet(k, { nede: beskederKilde({ dataDir: tom }) }); } finally { await ryd(); await rm(tom, { recursive: true, force: true }); }
});

test('a read fails while a chosen conversation’s channel is gone from Hermes, so a reconnect cannot pass for a repair', async () => {
  const { k, ryd } = await verden(LINJER, ['telegram']);
  try {
    await assert.rejects(k.read(ctx({ [MAJA]: 'privat' })), (e) => e instanceof KildeFejl && e.status === 502 && e.message === GENFORBIND_KANAL.signal);
    assert.equal((await data(k, { [FAMILIE]: 'privat' })).length, 1);
  } finally { await ryd(); }
});
