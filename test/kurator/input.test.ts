import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KURATOR_MAPPER, nyeMails } from '../../src/kurator/input.ts';
import type { Runner } from '../../src/rooms/mail/source.ts';

const NOW = new Date('2026-10-27T12:00:00Z');

type Raw = { id: number; subject?: string; date: string; name?: string; email?: string; mid?: string };

function raw(r: Raw) {
  return {
    id: r.id,
    subject: r.subject ?? `Emne ${r.id}`,
    date: r.date,
    from: [{ name: r.name ?? 'Afsender', addr: undefined, email: r.email ?? 'a@example.com' }],
    flags: [],
    ...(r.mid ? { 'message-id': r.mid } : {}),
  };
}

/** A runner that answers `envelope list -m <mappe>` from a per-folder table. */
function runnerFor(table: Record<string, Raw[] | 'fail'>, calls: string[][] = []): Runner {
  return async (_cmd, args) => {
    calls.push(args);
    const mappe = args[args.indexOf('-m') + 1] ?? '';
    const v = table[mappe];
    if (v === 'fail') return { code: 1, stdout: '', stderr: 'boom' };
    return { code: 0, stdout: JSON.stringify((v ?? []).map(raw)), stderr: '' };
  };
}

const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

test('first run takes the last 7 days only', async () => {
  const run = runnerFor({
    Inbox: [
      { id: 1, date: iso(daysAgo(1)) },
      { id: 2, date: iso(daysAgo(6)) },
      { id: 3, date: iso(daysAgo(8)) },
    ],
  });
  const r = await nyeMails({ run, himalaya: 'himalaya', mapper: ['Inbox'], sete: [], now: NOW });
  assert.deepEqual(r.mails.map((m) => m.id).sort(), ['1', '2']);
  assert.equal(r.mails[0]?.mappe, 'Inbox');
});

test('uses the same himalaya args as the Mail room', async () => {
  const calls: string[][] = [];
  await nyeMails({ run: runnerFor({}, calls), himalaya: 'himalaya', mapper: ['Inbox'], sete: [], now: NOW });
  assert.deepEqual(calls[0], ['envelope', 'list', '-m', 'Inbox', '-s', '120', '-p', '1', '--json']);
});

test('a mail already in sete is not new again', async () => {
  const run = runnerFor({ Inbox: [{ id: 1, date: iso(daysAgo(1)) }, { id: 2, date: iso(daysAgo(1)) }] });
  const r = await nyeMails({ run, himalaya: 'himalaya', mapper: ['Inbox'], sete: ['Inbox:1'], now: NOW });
  assert.deepEqual(r.mails.map((m) => m.id), ['2']);
  assert.ok(r.sete.includes('Inbox:1'));
  assert.ok(r.sete.includes('Inbox:2'));
});

test('mails older than the cursor minus 24 h are not new', async () => {
  const cursor = iso(daysAgo(1));
  const run = runnerFor({ Inbox: [{ id: 1, date: iso(daysAgo(2.5)) }, { id: 2, date: iso(daysAgo(0.5)) }] });
  const r = await nyeMails({ run, himalaya: 'himalaya', mapper: ['Inbox'], sete: [], cursor, now: NOW });
  assert.deepEqual(r.mails.map((m) => m.id), ['2']);
});

test('a mail dated before the cursor but never seen (delivered late) is picked up', async () => {
  const cursor = iso(daysAgo(1));
  const run = runnerFor({ Inbox: [{ id: 5, date: iso(daysAgo(1.5)), mid: '<sen@example.org>' }] });
  const r = await nyeMails({ run, himalaya: 'himalaya', mapper: ['Inbox'], sete: [], cursor, now: NOW });
  assert.deepEqual(r.mails.map((m) => m.id), ['5']);
  assert.equal(r.cursor, cursor, 'the cursor never moves backwards');
  assert.ok(r.sete.includes('<sen@example.org>'), 'keyed by Message-ID');
});

test('the same Message-ID in another folder (moved since) is not new; without a Message-ID the key is <mappe>:<id>', async () => {
  const run = runnerFor({
    Archive: [{ id: 90, date: iso(daysAgo(0.5)), mid: '<flyttet@example.org>' }],
    Inbox: [{ id: 3, date: iso(daysAgo(0.5)) }],
  });
  const r = await nyeMails({ run, himalaya: 'himalaya', mapper: ['Inbox', 'Archive'], sete: ['<flyttet@example.org>'], cursor: iso(daysAgo(1)), now: NOW });
  assert.deepEqual(r.mails.map((m) => `${m.mappe}:${m.id}`), ['Inbox:3']);
  assert.ok(r.sete.includes('Inbox:3'));
});

test('one Message-ID listed in two folders in the same run is new once', async () => {
  const run = runnerFor({
    Inbox: [{ id: 4, date: iso(daysAgo(0.5)), mid: '<to@example.org>' }],
    'Folders/Handling': [{ id: 77, date: iso(daysAgo(0.5)), mid: '<to@example.org>' }],
  });
  const r = await nyeMails({ run, himalaya: 'himalaya', mapper: ['Inbox', 'Folders/Handling'], sete: [], now: NOW });
  assert.equal(r.mails.length, 1);
  assert.equal(r.sete.filter((x) => x === '<to@example.org>').length, 1);
});

test('a mail seen before under its old <mappe>:<id> key is not new after it gains a Message-ID key', async () => {
  const run = runnerFor({ Inbox: [{ id: 1, date: iso(daysAgo(0.5)), mid: '<gammel@example.org>' }] });
  const r = await nyeMails({ run, himalaya: 'himalaya', mapper: ['Inbox'], sete: ['Inbox:1'], cursor: iso(daysAgo(1)), now: NOW });
  assert.deepEqual(r.mails, []);
});

test('300 new envelopes give the 40 newest, cursor = newest modtaget', async () => {
  const many: Raw[] = [];
  for (let i = 1; i <= 300; i++) many.push({ id: i, date: iso(new Date(NOW.getTime() - i * 60_000)) });
  const run = runnerFor({ Inbox: many });
  const r = await nyeMails({ run, himalaya: 'himalaya', mapper: ['Inbox'], sete: [], now: NOW });
  assert.equal(r.mails.length, 40);
  assert.equal(r.mails[0]?.id, '1');
  assert.equal(r.mails[39]?.id, '40');
  assert.equal(r.cursor, iso(new Date(NOW.getTime() - 60_000)));
});

test('sete keeps only the last 500 keys', async () => {
  const sete = Array.from({ length: 600 }, (_, i) => `Inbox:old${i}`);
  const run = runnerFor({ Inbox: [{ id: 1, date: iso(daysAgo(1)) }] });
  const r = await nyeMails({ run, himalaya: 'himalaya', mapper: ['Inbox'], sete, now: NOW });
  assert.equal(r.sete.length, 500);
  assert.ok(r.sete.includes('Inbox:1'));
  assert.ok(!r.sete.includes('Inbox:old0'));
});

test('a folder whose runner exits 1 is skipped, others returned', async () => {
  const run = runnerFor({ 'Folders/Regninger': 'fail', Inbox: [{ id: 1, date: iso(daysAgo(1)) }] });
  const r = await nyeMails({ run, himalaya: 'himalaya', mapper: ['Folders/Regninger', 'Inbox'], sete: [], now: NOW });
  assert.deepEqual(r.mails.map((m) => `${m.mappe}:${m.id}`), ['Inbox:1']);
});

test('a throwing runner is skipped too', async () => {
  const run: Runner = async (_c, args) => {
    if (args.includes('Archive')) throw new Error('spawn failed');
    return { code: 0, stdout: JSON.stringify([raw({ id: 1, date: iso(daysAgo(1)) })]), stderr: '' };
  };
  const r = await nyeMails({ run, himalaya: 'himalaya', mapper: ['Archive', 'Inbox'], sete: [], now: NOW });
  assert.equal(r.mails.length, 1);
});

test('fra never contains "@"', async () => {
  const run = runnerFor({
    Inbox: [
      { id: 1, date: iso(daysAgo(1)), name: 'Vercel Billing', email: 'billing@vercel.example' },
      { id: 2, date: iso(daysAgo(1)), name: 'noreply@shop.example', email: 'noreply@shop.example' },
      { id: 3, date: iso(daysAgo(1)), name: '', email: 'ingen@navn.example' },
    ],
  });
  const r = await nyeMails({ run, himalaya: 'himalaya', mapper: ['Inbox'], sete: [], now: NOW });
  assert.equal(r.mails.length, 3);
  for (const m of r.mails) assert.ok(!m.fra.includes('@'), m.fra);
  assert.equal(r.mails.find((m) => m.id === '1')?.fra, 'Vercel Billing');
});

test('KURATOR_MAPPER lists the Proton folders', () => {
  assert.deepEqual(KURATOR_MAPPER, ['Inbox', 'Folders/Handling', 'Folders/Regninger', 'Folders/køb', 'Archive']);
});

// ---------- KC-0214: new mail from the mail connector (a Sky tenant) ----------

test('with the mail connector: its envelopes are INBOX mail, no himalaya call; a failing read counts as no mail', async () => {
  const calls: string[][] = [];
  const kuvert = (id: string, dage: number, fra: string, messageId?: string) => ({ id, emne: `Emne ${id}`, fra, modtaget: iso(daysAgo(dage)), laest: false, flag: false, vedhaeftning: false, ...(messageId ? { messageId } : {}) });
  const r = await nyeMails({ forbindelse: async () => [kuvert('7', 1, 'Søster', '<a@x>'), kuvert('8', 9, 'Gammel'), kuvert('9', 2, 'nej@ond.example')], sete: [], now: NOW });
  assert.deepEqual(r.mails.map((m) => [m.mappe, m.id, m.fra]), [['INBOX', '7', 'Søster'], ['INBOX', '9', 'nej']]);
  assert.deepEqual(r.sete, ['INBOX:9', '<a@x>']);
  assert.equal(calls.length, 0);
  const fejl = await nyeMails({ forbindelse: async () => { throw new Error('nede'); }, sete: ['x'], now: NOW });
  assert.deepEqual([fejl.mails, fejl.sete], [[], ['x']]);
});
