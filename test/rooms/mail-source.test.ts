import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { parseAll, parseEnvelopes, parsePlanFile, readMailSource, defaultRunner } from '../../src/rooms/mail/source.ts';
import type { Runner } from '../../src/rooms/mail/source.ts';

const handlingFixture = JSON.parse(readFileSync(new URL('../fixtures/himalaya_handling_sample.json', import.meta.url), 'utf8'));
const planFixture = JSON.parse(readFileSync(new URL('../fixtures/mail-plan-auto-sample.json', import.meta.url), 'utf8'));

test('parseEnvelopes maps id, subject, sender, date, seen and flagged', () => {
  const env = parseEnvelopes(handlingFixture);
  const faktura = env.find((e) => e.id === '242');
  assert.deepEqual(faktura, {
    id: '242', emne: 'Din faktura fra Nordlys El er klar', fra: 'Nordlys El', fraEmail: 'kunde@nordlys-el.example',
    modtaget: '2026-10-26T18:57:39Z', laest: true, flag: false, vedhaeftning: true,
  });
  const tand = env.find((e) => e.id === '247');
  assert.equal(tand?.laest, true);
  assert.equal(tand?.flag, true);
});

test('parseAll keeps the Message-ID (message-id or message_id) for Kuratoren; parseEnvelopes (the Mail room) leaves it out', () => {
  assert.equal(parseAll(handlingFixture).find((e) => e.id === '242')?.messageId, '<a1@nordlys-el.example>');
  assert.equal(parseAll([{ id: 9, date: '2026-10-27T00:00:00Z', message_id: '<x@y.example>' }])[0]?.messageId, '<x@y.example>');
  assert.equal(parseAll([{ id: 9, date: '2026-10-27T00:00:00Z' }])[0]?.messageId, undefined);
  assert.ok(parseEnvelopes(handlingFixture).every((e) => !('messageId' in e)));
});

test('parseEnvelopes falls back for missing name, sender and subject', () => {
  const env = parseEnvelopes(handlingFixture);
  const udenNavn = env.find((e) => e.id === '236');
  assert.equal(udenNavn?.fra, 'ukendt@example.invalid');
  assert.equal(udenNavn?.emne, '(uden emne)');
  const udenAfsender = env.find((e) => e.id === '230');
  assert.equal(udenAfsender?.fra, '(ukendt afsender)');
  assert.equal(udenAfsender?.fraEmail, undefined);
});

test('parseEnvelopes accepts a bare array and ignores junk entries', () => {
  const env = parseEnvelopes([{ id: '1', subject: 'a', date: '2026-10-27T00:00:00Z' }, 'junk', null, { subject: 'no id' }]);
  assert.equal(env.length, 1);
  assert.equal(env[0]?.id, '1');
  assert.deepEqual(parseEnvelopes('nonsense'), []);
});

test('parseEnvelopes sorts newest first and caps at 20', () => {
  const sorted = parseEnvelopes(handlingFixture).map((e) => e.id);
  assert.deepEqual(sorted, ['251', '247', '242', '236', '230']);
  const many = Array.from({ length: 30 }, (_, i) => ({ id: String(i), subject: `m${i}`, date: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() }));
  const capped = parseEnvelopes(many);
  assert.equal(capped.length, 20);
  assert.equal(capped[0]?.id, '29');
});

test('parsePlanFile derives tid from the file name and maps move and archive actions', () => {
  const posts = parsePlanFile('mail-plan-auto-2026-10-27-083001.json', planFixture);
  assert.equal(posts.length, 4);
  assert.deepEqual(posts[0], { mailId: '301', til: 'Folders/Regninger', hvorfor: 'faktura fra elselskab', tid: '2026-10-27T08:30:01' });
  assert.equal(posts[1]?.til, 'Archive');
  assert.equal(posts[3]?.til, 'Archive');
});

test('parsePlanFile skips keep and delete and tolerates junk', () => {
  const json = { actions: [
    { id: '1', op: 'keep', why: 'x' },
    { id: '2', op: 'delete', why: 'x' },
    { id: '3', op: 'move', to: 'Folders/køb', why: 'ordre' },
    { op: 'move', to: 'Folders/køb' },
    'junk',
  ] };
  const posts = parsePlanFile('mail-plan-auto-2026-10-27-120000.json', json);
  assert.deepEqual(posts.map((p) => p.mailId), ['3']);
  assert.deepEqual(parsePlanFile('mail-plan-auto-2026-10-27-120000.json', 42), []);
  assert.deepEqual(parsePlanFile('mail-plan-auto-2026-10-27-120000.json', { actions: 'x' }), []);
});

type Call = { cmd: string; args: string[] };
const NOW = new Date('2026-10-27T10:00:00Z'); // 11:00 in Copenhagen (CET), still the 27th

function envs(n: number, prefix = 'x') {
  return { envelopes: Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, subject: `s${i}`, date: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() })) };
}

function fakeRunner(byMailbox: Record<string, { code?: number; stdout?: string; stderr?: string }>): { run: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const run: Runner = async (cmd, args) => {
    calls.push({ cmd, args });
    const mailbox = args[args.indexOf('-m') + 1] ?? '';
    const r = byMailbox[mailbox] ?? { code: 1, stderr: `no canned answer for ${mailbox}` };
    return { code: r.code ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  return { run, calls };
}

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-mail-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('readMailSource lists the four mailboxes with the himalaya args, keeps Handling and fills tal', async () => {
  await withDir(async (dir) => {
    const { run, calls } = fakeRunner({
      'Folders/Handling': { stdout: JSON.stringify(handlingFixture) },
      'Folders/Afventer': { stdout: JSON.stringify(envs(30, 'a')) }, // more than the Handling cap: tal counts all
      'Folders/Regninger': { stdout: JSON.stringify(envs(2, 'r')) },
      'Inbox': { stdout: JSON.stringify([]) },
    });
    const r = await readMailSource({ run, stateDir: dir, now: NOW, himalaya: '/opt/bin/himalaya' });
    assert.equal(calls.length, 4);
    assert.ok(calls.every((c) => c.cmd === '/opt/bin/himalaya'));
    const argsFor = (mb: string) => calls.find((c) => c.args.includes(mb))?.args;
    for (const mb of ['Folders/Handling', 'Folders/Afventer', 'Folders/Regninger', 'Inbox']) {
      assert.deepEqual(argsFor(mb), ['envelope', 'list', '-m', mb, '-s', '120', '-p', '1', '--json']);
    }
    assert.equal(r.dato, '2026-10-27');
    assert.equal(r.hentet, NOW.toISOString());
    assert.equal(r.handling.length, 5);
    assert.equal(r.handling[0]?.id, '251');
    assert.deepEqual(r.tal, { handling: 5, afventer: 30, regninger: 2, indbakke: 0, sorteretIDag: 0 });
    assert.deepEqual(r.ordnet, []);
    assert.equal(r.fejl, undefined);
  });
});

test('readMailSource defaults the command to himalaya', async () => {
  await withDir(async (dir) => {
    const { run, calls } = fakeRunner({});
    await readMailSource({ run, stateDir: dir, now: NOW });
    assert.ok(calls.every((c) => c.cmd === 'himalaya'));
  });
});

test('readMailSource collects a failing mailbox in fejl without throwing', async () => {
  await withDir(async (dir) => {
    const long = 'x'.repeat(300);
    const { run } = fakeRunner({
      'Folders/Handling': { code: 1, stderr: long },
      'Folders/Afventer': { stdout: JSON.stringify(envs(3, 'a')) },
      'Folders/Regninger': { stdout: 'this is not json' },
      'Inbox': { code: 0, stdout: JSON.stringify(envs(1, 'i')) },
    });
    const r = await readMailSource({ run, stateDir: dir, now: NOW });
    assert.deepEqual(r.handling, []);
    assert.deepEqual(r.tal, { handling: 0, afventer: 3, regninger: 0, indbakke: 1, sorteretIDag: 0 });
    assert.ok(r.fejl);
    assert.equal(r.fejl.length, 2);
    assert.equal(r.fejl[0], `Folders/Handling: ${'x'.repeat(120)}`);
    assert.ok(r.fejl[1]?.startsWith('Folders/Regninger: '));
  });
});

test('readMailSource turns a throwing runner into fejl, not an exception', async () => {
  await withDir(async (dir) => {
    const run: Runner = async () => { throw new Error('boom'); };
    const r = await readMailSource({ run, stateDir: dir, now: NOW });
    assert.equal(r.fejl?.length, 4);
    assert.equal(r.tal.handling, 0);
  });
});

const okRunner = () => fakeRunner({
  'Folders/Handling': { stdout: JSON.stringify([]) },
  'Folders/Afventer': { stdout: JSON.stringify([]) },
  'Folders/Regninger': { stdout: JSON.stringify([]) },
  'Inbox': { stdout: JSON.stringify([]) },
}).run;

test('readMailSource builds ordnet from todays plan files, newest first, and sets sorteretIDag', async () => {
  await withDir(async (dir) => {
    await writeFile(path.join(dir, 'mail-plan-auto-2026-10-27-083001.json'), JSON.stringify(planFixture));
    await writeFile(path.join(dir, 'mail-plan-auto-2026-10-27-094501.json'), JSON.stringify({ actions: [{ id: '401', op: 'move', to: 'Folders/køb', why: 'ordrebekræftelse' }] }));
    await writeFile(path.join(dir, 'mail-plan-auto-2026-10-27-100000.json'), JSON.stringify({ actions: [{ id: '402', op: 'keep', why: 'ligger' }] }));
    const r = await readMailSource({ run: okRunner(), stateDir: dir, now: NOW });
    assert.deepEqual(r.ordnet.map((o) => o.mailId), ['401', '301', '302', '303', '304']);
    assert.equal(r.ordnet[0]?.tid, '2026-10-27T09:45:01');
    assert.equal(r.tal.sorteretIDag, 5);
  });
});

test('readMailSource ignores plan files from other days, other names and bad JSON', async () => {
  await withDir(async (dir) => {
    await writeFile(path.join(dir, 'mail-plan-auto-2026-10-26-235900.json'), JSON.stringify(planFixture));
    await writeFile(path.join(dir, 'mail-plan-2026-10-27-083001.json'), JSON.stringify(planFixture));
    await writeFile(path.join(dir, 'mail-plan-auto-2026-10-27-083001.json.bak'), JSON.stringify(planFixture));
    await writeFile(path.join(dir, 'mail-plan-auto-2026-10-27-090000.json'), '{not json');
    const r = await readMailSource({ run: okRunner(), stateDir: dir, now: NOW });
    assert.deepEqual(r.ordnet, []);
    assert.equal(r.tal.sorteretIDag, 0);
  });
});

test('readMailSource uses the Copenhagen date to pick plan files', async () => {
  await withDir(async (dir) => {
    await writeFile(path.join(dir, 'mail-plan-auto-2026-10-28-000500.json'), JSON.stringify(planFixture));
    // 23:30 UTC on the 27th is already the 28th in Copenhagen (CET)
    const r = await readMailSource({ run: okRunner(), stateDir: dir, now: new Date('2026-10-27T23:30:00Z') });
    assert.equal(r.dato, '2026-10-28');
    assert.equal(r.ordnet.length, 4);
  });
});

test('readMailSource gives ordnet [] when stateDir is missing', async () => {
  await withDir(async (dir) => {
    const r = await readMailSource({ run: okRunner(), stateDir: path.join(dir, 'does-not-exist'), now: NOW });
    assert.deepEqual(r.ordnet, []);
    assert.equal(r.fejl, undefined);
  });
});

test('readMailSource caps ordnet at 60', async () => {
  await withDir(async (dir) => {
    const actions = Array.from({ length: 70 }, (_, i) => ({ id: String(500 + i), op: 'archive', why: 'støj' }));
    await writeFile(path.join(dir, 'mail-plan-auto-2026-10-27-080000.json'), JSON.stringify({ actions }));
    const r = await readMailSource({ run: okRunner(), stateDir: dir, now: NOW });
    assert.equal(r.ordnet.length, 60);
    assert.equal(r.tal.sorteretIDag, 60);
  });
});

test('defaultRunner resolves with code -1 for a nonexistent command instead of rejecting', async () => {
  const r = await defaultRunner()('definitely-not-a-real-command-kc', ['--version']);
  assert.equal(r.code, -1);
  assert.ok(r.stderr.length > 0);
});

test('defaultRunner returns stdout and exit code 0 for a working command', async () => {
  const r = await defaultRunner()(process.execPath, ['-e', 'process.stdout.write("hej")']);
  assert.deepEqual(r, { code: 0, stdout: 'hej', stderr: '' });
});

test('defaultRunner reports a non-zero exit code with stderr', async () => {
  const r = await defaultRunner()(process.execPath, ['-e', 'process.stderr.write("nej"); process.exit(3)']);
  assert.equal(r.code, 3);
  assert.equal(r.stderr, 'nej');
});

// KC-0223: a read-only connection shows what waits — unread, or flagged — and counts that, not the whole inbox.
test('fraForbindelse in read-only mode keeps unread and flagged envelopes, drops read unflagged ones, and counts what waits', async () => {
  const { fraForbindelse } = await import('../../src/rooms/mail/source.ts');
  const k = (id: string, laest: boolean, flag: boolean) => ({ id, emne: `Emne ${id}`, fra: 'X', modtaget: '2026-10-31T06:00:00Z', laest, flag, vedhaeftning: false, messageId: `<${id}@x>` });
  const alle = [k('1', false, false), k('2', true, false), k('3', true, true), k('4', false, true)];
  const d = fraForbindelse(alle, new Date('2026-10-31T08:00:00Z'), { laeseKun: true });
  assert.deepEqual(d.handling.map((e) => e.id), ['1', '3', '4']);
  assert.deepEqual([d.tal.handling, d.tal.indbakke], [3, 4]);
  assert.ok(d.handling.every((e) => !('messageId' in e)), 'the Message-ID never leaves the source');
  const hel = fraForbindelse(alle, new Date('2026-10-31T08:00:00Z'));
  assert.equal(hel.handling.length, 4, 'an acting connection keeps the whole inbox as before');
});
