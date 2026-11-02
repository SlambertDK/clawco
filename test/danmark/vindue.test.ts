// KC-0233: the Digital Post window — what Nu and Start are told. Over a fake mail seam and a temp folder: connected or not,
// read failing (never "no new post"), a confirmed sender, "Set den", the snooze, the hint domains, the cache.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DanmarkAfvist, lavDanmark, type MailSyn } from '../../src/danmark/vindue.ts';
import { lavDanmarkLager } from '../../src/danmark/tilstand.ts';
import type { Kuvert } from '../../src/kilder/types.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-danmark-v-'));
after(() => rm(rod, { recursive: true, force: true }));
const NU = new Date('2026-11-02T10:00:00Z');
const A = 'post@notifikation.digitalpost.example';
const iso = (dage: number): string => new Date(NU.getTime() - dage * 86_400_000).toISOString();
const kv = (id: string, o: Partial<Kuvert> = {}): Kuvert => ({ id, emne: 'Du har ny Digital Post', fra: 'Digital Post', fraEmail: A, modtaget: iso(1), laest: false, flag: false, vedhaeftning: false, messageId: `<${id}@x.example>`, ...o });

let nr = 0;
function opsaet(mail: () => MailSyn | Promise<MailSyn>, o: { ur?: { nu: Date }; cacheMs?: number } = {}) {
  const lager = lavDanmarkLager({ dir: path.join(rod, `t${++nr}`) });
  const ur = o.ur ?? { nu: NU };
  let laes = 0;
  const v = lavDanmark({ lager, laesMail: async () => { laes++; return mail(); }, nu: () => ur.nu, domaener: ['digitalpost.example'], cacheMs: o.cacheMs ?? 60_000 });
  return { v, lager, ur, laest: () => laes };
}
const forbundet = (...k: Kuvert[]): MailSyn => ({ forbundet: true, kuverter: k });

test('nothing connected: no card, no Start step; a sender cannot be confirmed', async () => {
  const t = opsaet(() => ({ forbundet: false, kuverter: [] }));
  assert.equal(await t.v.nu(), null);
  assert.equal(await t.v.start(), null);
  await assert.rejects(() => t.v.gem(A, 'mit.dk'), DanmarkAfvist);
});

test('Start: mail connected, no sender yet — the candidates from the inbox (addresses only), the viewer choice and the default', async () => {
  const t = opsaet(() => forbundet(kv('1'), kv('2', { fraEmail: 'info@butik.example' })));
  const s = await t.v.start();
  assert.deepEqual(s?.kandidater, [A]);
  assert.equal(s?.laeser, 'ok');
  assert.equal(s?.viser, 'mit.dk');
  assert.deepEqual(s?.visere.map((x) => x.id), ['mit.dk', 'e-boks', 'borger.dk']);
  assert.ok(s?.domaener.includes('digitalpost.example'), 'the hint domains are named so the refusal sentence can say them');
  assert.equal(await t.v.nu(), null, 'no sender confirmed: no card');
});

test('Start: an unreadable inbox still shows the step (the free field works), with "kan ikke se" and no candidates', async () => {
  const t = opsaet(() => ({ forbundet: true, kuverter: null }));
  const s = await t.v.start();
  assert.equal(s?.laeser, 'kan-ikke-se');
  assert.deepEqual(s?.kandidater, []);
});

test('gem: only an address on a hint domain is confirmed (lower-cased, trimmed); anything else is refused with a plain sentence and nothing is written', async () => {
  const t = opsaet(() => forbundet(kv('1')));
  for (const daarlig of ['', 'post@gmail.example', 'ikke en adresse', 'a@b@digitalpost.example', 'post@digitalpost.example.evil.example']) {
    await assert.rejects(() => t.v.gem(daarlig, 'mit.dk'), (e: unknown) => e instanceof DanmarkAfvist && e.status === 400 && /Digital Post/.test(e.message), daarlig);
  }
  await assert.rejects(() => t.v.gem(A, 'google.com'), DanmarkAfvist);
  assert.deepEqual((await t.lager.laes()).afsendere, []);
  await t.v.gem(`  ${A.toUpperCase()} `, 'e-boks');
  const s = await t.lager.laes();
  assert.deepEqual(s.afsendere, [A]);
  assert.equal(s.viser, 'e-boks');
  assert.equal(await t.v.start(), null, 'the step leaves Start once a sender is confirmed');
});

test('the card: one notice per unseen mail from the confirmed sender, with the chosen viewer\'s fixed link', async () => {
  const t = opsaet(() => forbundet(kv('1', { emne: 'Ny besked fra Fiktiv Kommune' }), kv('2', { modtaget: iso(3) }), kv('3', { fraEmail: 'spoof@andet.example' }), kv('4', { laest: true })));
  await t.v.gem(A, 'borger.dk');
  const n = await t.v.nu();
  assert.equal(n?.slags, 'notitser');
  if (n?.slags !== 'notitser') return;
  assert.deepEqual(n.notitser.map((x) => x.id), ['<1@x.example>', '<2@x.example>']);
  assert.deepEqual(n.viser, { navn: 'borger.dk', url: 'https://www.borger.dk/' });
});

test('the mail source failing gives "kan ikke se", never an empty list — and only once a sender is confirmed', async () => {
  let virker = true;
  const t = opsaet(() => (virker ? forbundet(kv('1')) : { forbundet: true, kuverter: null }), { cacheMs: 0 });
  assert.equal(await t.v.nu(), null);
  await t.v.gem(A, 'mit.dk');
  assert.equal((await t.v.nu())?.slags, 'notitser');
  virker = false;
  assert.deepEqual(await t.v.nu(), { slags: 'kan-ikke-se', viser: { navn: 'mit.dk', url: 'https://mit.dk/' } });
});

test('a quiet inbox: no card at all (no "ingen ny post" claim)', async () => {
  const t = opsaet(() => forbundet(kv('1', { laest: true })));
  await t.v.gem(A, 'mit.dk');
  assert.equal(await t.v.nu(), null);
});

test('set: marks the notice seen — it is gone, and stays gone after the window is built again (a restart)', async () => {
  const t = opsaet(() => forbundet(kv('1'), kv('2')));
  await t.v.gem(A, 'mit.dk');
  await t.v.set('<1@x.example>');
  const n = await t.v.nu();
  assert.deepEqual(n?.slags === 'notitser' ? n.notitser.map((x) => x.id) : null, ['<2@x.example>']);
  const igen = lavDanmark({ lager: t.lager, laesMail: async () => forbundet(kv('1'), kv('2')), nu: () => NU, domaener: ['digitalpost.example'] });
  const n2 = await igen.nu();
  assert.deepEqual(n2?.slags === 'notitser' ? n2.notitser.map((x) => x.id) : null, ['<2@x.example>']);
  await t.v.set('<2@x.example>');
  assert.equal(await t.v.nu(), null, 'the last notice marked: the card is gone');
});

test('set: an id that is not a notice now is refused (400) and nothing is written; an unreadable inbox is 503', async () => {
  const t = opsaet(() => forbundet(kv('1')), { cacheMs: 0 });
  await t.v.gem(A, 'mit.dk');
  await assert.rejects(() => t.v.set('<findes-ikke@x.example>'), (e: unknown) => e instanceof DanmarkAfvist && e.status === 400);
  await assert.rejects(() => t.v.set(''), DanmarkAfvist);
  assert.deepEqual((await t.lager.laes()).set, []);
  const u = opsaet(() => ({ forbundet: true, kuverter: null }), { cacheMs: 0 });
  await u.lager.aendre((s) => ({ ...s, afsendere: [A] }));
  await assert.rejects(() => u.v.set('<1@x.example>'), (e: unknown) => e instanceof DanmarkAfvist && e.status === 503);
});

test('setAlle: every unseen notice is marked at once; with none it is refused', async () => {
  const t = opsaet(() => forbundet(kv('1'), kv('2'), kv('3')));
  await t.v.gem(A, 'mit.dk');
  await t.v.setAlle();
  assert.equal(await t.v.nu(), null);
  assert.equal((await t.lager.laes()).set.length, 3);
  await assert.rejects(() => t.v.setAlle(), (e: unknown) => e instanceof DanmarkAfvist && e.status === 400);
});

test('expiry: a notice drops off the card after 14 days without anyone tapping', async () => {
  const t = opsaet(() => forbundet(kv('1', { modtaget: iso(13) })), { cacheMs: 0 });
  await t.v.gem(A, 'mit.dk');
  assert.equal((await t.v.nu())?.slags, 'notitser');
  t.ur.nu = new Date(NU.getTime() + 2 * 86_400_000);
  assert.equal(await t.v.nu(), null);
});

test('ikkeNu: Start\'s step is put away for 30 days, then it is back; confirming a sender clears the snooze', async () => {
  const t = opsaet(() => forbundet(kv('1')));
  assert.ok(await t.v.start());
  await t.v.ikkeNu();
  assert.equal(await t.v.start(), null);
  t.ur.nu = new Date(NU.getTime() + 29 * 86_400_000);
  assert.equal(await t.v.start(), null);
  t.ur.nu = new Date(NU.getTime() + 31 * 86_400_000);
  assert.ok(await t.v.start());
});

test('promover: Start is worth showing in the nav only when the inbox holds a candidate and the step is open', async () => {
  const a = opsaet(() => forbundet(kv('1')));
  assert.equal(await a.v.promover(), true);
  const b = opsaet(() => forbundet(kv('1', { fraEmail: 'info@butik.example' })));
  assert.equal(await b.v.promover(), false);
  const c = opsaet(() => ({ forbundet: false, kuverter: [] }));
  assert.equal(await c.v.promover(), false);
  await a.v.ikkeNu();
  assert.equal(await a.v.promover(), false);
});

test('the mail is read at most once per cache window, concurrent callers share one read, and a tap or a confirmation drops the cache', async () => {
  const t = opsaet(() => forbundet(kv('1')), { cacheMs: 60_000 });
  await Promise.all([t.v.start(), t.v.start(), t.v.promover()]);
  await t.v.start();
  assert.equal(t.laest(), 1);
  t.ur.nu = new Date(NU.getTime() + 61_000);
  await t.v.start();
  assert.equal(t.laest(), 2);
  await t.v.gem(A, 'mit.dk');
  await t.v.nu();
  assert.equal(t.laest(), 3, 'confirming re-reads, so the first card is built from the mail as it is now');
});

test("the state file is read on every call: a change on disk shows without a restart", async () => {
  const t = opsaet(() => forbundet(kv('1')));
  await t.lager.aendre((s) => ({ ...s, afsendere: [A] }));
  assert.equal((await t.v.nu())?.slags, 'notitser');
});

// ---------- KC-0236: the Aula card's "Ikke nu" ----------

test('KC-0236 Aula: not put away at first; "Ikke nu" puts it away for 30 days, then it is back; Digital Post\'s step is untouched', async () => {
  const t = opsaet(() => forbundet(kv('1')));
  assert.equal(await t.v.aulaUdsat(), false);
  await t.v.aulaIkkeNu();
  assert.equal(await t.v.aulaUdsat(), true);
  t.ur.nu = new Date(NU.getTime() + 29 * 86_400_000);
  assert.equal(await t.v.aulaUdsat(), true, 'day 29');
  t.ur.nu = new Date(NU.getTime() + 31 * 86_400_000);
  assert.equal(await t.v.aulaUdsat(), false, 'day 31: back');
  assert.notEqual(await t.v.start(), null, 'Digital Post\'s step was never put away by this');
});

test('KC-0236 Aula and Digital Post are put away separately, and confirming the sender keeps Aula\'s setting', async () => {
  const t = opsaet(() => forbundet(kv('1')));
  await t.v.aulaIkkeNu();
  await t.v.gem(A, 'mit.dk');
  assert.equal(await t.v.aulaUdsat(), true);
  await t.v.ikkeNu();
  const s = await t.lager.laes();
  assert.ok(s.afvist && s.aulaAfvist);
});

test('KC-0236 Aula: needs no mail — it is put away and read back with nothing connected', async () => {
  const t = opsaet(() => ({ forbundet: false, kuverter: [] }));
  await t.v.aulaIkkeNu();
  assert.equal(await t.v.aulaUdsat(), true);
});
