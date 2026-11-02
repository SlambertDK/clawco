// KC-0124: the audit log. Append-only JSONL per month under the data dir, each
// line chained to the one before by sha256, metadata only. It is the persistent
// sink for the policy layer's reports (port.ts), next to the room-log line.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lavRevisionslog, RevisionFejl, NUL_HASH, type Revision } from '../../src/graenser/revisionslog.ts';
import { gennem, GraenseAfvist } from '../../src/graenser/port.ts';
import { lavTegn } from '../../src/graenser/tegn.ts';
import { ENEBRUGER } from '../../src/identitet/identitet.ts';
import type { RoomDeps } from '../../src/rooms/module.ts';

async function medMappe(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-revision-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

const linje = (o: Partial<Revision> = {}): Omit<Revision, 'tid'> & { tid?: string } => ({
  person: 'ejer', kanal: 'knap', rum: 'mail', verb: 'sorter', udfald: 'tillad', hvorfor: 'Inden for grænserne.', zoner: ['privat'], kilde: 'graense', ...o,
});
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const raa = async (dir: string, fil: string): Promise<string[]> => (await readFile(path.join(dir, fil), 'utf8')).split('\n').filter(Boolean);

test('append: one JSON line per entry in this month\'s file, the first chained to 64 zeros', async () => {
  await medMappe(async (dir) => {
    const log = lavRevisionslog(dir, { nu: () => new Date('2026-10-31T12:00:00Z') });
    const a = await log.skriv(linje({ handlingId: 'h1', runId: 'kc_1' }));
    const b = await log.skriv(linje({ udfald: 'afvist', verb: 'betal', hvorfor: 'Clawco betaler aldrig noget. Det gør du selv.' }));
    assert.deepEqual(await readdir(dir), ['revision-2026-10.jsonl']);
    const [l1, l2] = await raa(dir, 'revision-2026-10.jsonl');
    assert.equal(a.forrige, NUL_HASH);
    assert.equal(NUL_HASH, '0'.repeat(64));
    assert.equal(b.forrige, sha(l1!));
    assert.equal(JSON.parse(l2!).forrige, sha(l1!));
    assert.equal(a.tid, '2026-10-31T12:00:00.000Z');
    assert.deepEqual(Object.keys(JSON.parse(l1!)).sort(), ['forrige', 'handlingId', 'hvorfor', 'kanal', 'kilde', 'person', 'rum', 'runId', 'tid', 'udfald', 'verb', 'zoner']);
  });
});

test('seneste: newest first, across months, at most the number asked for', async () => {
  await medMappe(async (dir) => {
    let t = Date.parse('2026-10-31T22:58:00Z');
    const log = lavRevisionslog(dir, { nu: () => new Date((t += 60_000)) });
    for (let i = 0; i < 5; i++) await log.skriv(linje({ handlingId: `h${i}` }));
    const s = await log.seneste(3);
    assert.deepEqual(s.map((e) => e.handlingId), ['h4', 'h3', 'h2']);
    assert.deepEqual((await log.seneste()).length, 5);
  });
});

test('monthly rotation (Copenhagen month): a new month starts a new file that continues the chain', async () => {
  await medMappe(async (dir) => {
    const log = lavRevisionslog(dir);
    await log.skriv(linje({ tid: '2026-10-31T21:00:00.000Z' })); // 22.00 in Copenhagen: still October
    await log.skriv(linje({ tid: '2026-10-31T23:30:00.000Z' })); // 00.30 on 1 November in Copenhagen
    assert.deepEqual((await readdir(dir)).sort(), ['revision-2026-10.jsonl', 'revision-2026-11.jsonl']);
    const okt = await raa(dir, 'revision-2026-10.jsonl');
    const nov = await raa(dir, 'revision-2026-11.jsonl');
    assert.equal(JSON.parse(nov[0]!).forrige, sha(okt.at(-1)!));
    assert.deepEqual(await log.tjekKaede(), { ok: true });
  });
});

test('chain verification: an intact log is ok; an empty log is ok', async () => {
  await medMappe(async (dir) => {
    const log = lavRevisionslog(dir);
    assert.deepEqual(await log.tjekKaede(), { ok: true });
    for (let i = 0; i < 4; i++) await log.skriv(linje({ handlingId: `h${i}` }));
    assert.deepEqual(await log.tjekKaede(), { ok: true });
  });
});

test('tamper detection: a changed, removed or garbled line is reported at the first line whose link breaks', async () => {
  await medMappe(async (dir) => {
    const log = lavRevisionslog(dir, { nu: () => new Date('2026-10-15T10:00:00Z') });
    for (let i = 0; i < 4; i++) await log.skriv(linje({ handlingId: `h${i}` }));
    const fil = path.join(dir, 'revision-2026-10.jsonl');
    const orig = await raa(dir, 'revision-2026-10.jsonl');

    const aendret = [...orig]; aendret[1] = aendret[1]!.replace('"tillad"', '"afvist"');
    await writeFile(fil, `${aendret.join('\n')}\n`);
    assert.deepEqual(await log.tjekKaede(), { ok: false, fil: 'revision-2026-10.jsonl', linje: 3 });

    await writeFile(fil, `${[orig[0], orig[2], orig[3]].join('\n')}\n`);
    assert.deepEqual(await log.tjekKaede(), { ok: false, fil: 'revision-2026-10.jsonl', linje: 2 });

    await writeFile(fil, `${[orig[0], 'ikke json', orig[2], orig[3]].join('\n')}\n`);
    assert.deepEqual(await log.tjekKaede(), { ok: false, fil: 'revision-2026-10.jsonl', linje: 2 });
  });
});

test('no content fields: an unknown field, a wrong type or an unknown kanal/udfald is refused and nothing is written', async () => {
  await medMappe(async (dir) => {
    const log = lavRevisionslog(dir);
    const forkerte: unknown[] = [
      { ...linje(), tekst: 'Hej Clara, her er mailen …' },
      { ...linje(), emne: 'Fakturaen' },
      { ...linje(), kanal: 'mail' },
      { ...linje(), udfald: 'maaske' },
      { ...linje(), zoner: ['hemmelig'] },
      { ...linje(), person: 42 },
      { ...linje(), hvorfor: 'x'.repeat(1000) },
    ];
    for (const f of forkerte) await assert.rejects(log.skriv(f as Revision), RevisionFejl, JSON.stringify(f).slice(0, 60));
    assert.deepEqual(await readdir(dir), []);
  });
});

test('concurrent appends keep the chain intact', async () => {
  await medMappe(async (dir) => {
    const a = lavRevisionslog(dir);
    const b = lavRevisionslog(dir); // a second instance on the same data dir (a new registry, the test world) shares the queue
    await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).skriv(linje({ handlingId: `h${i}` }))));
    assert.equal((await a.seneste(100)).length, 20);
    assert.deepEqual(await a.tjekKaede(), { ok: true });
  });
});

test('the port reports every decision as exactly one audit line, and a refusal still gets its room-log line', async () => {
  await medMappe(async (dir) => {
    const revision = lavRevisionslog(dir);
    const roomLog: string[] = [];
    const d = { person: ENEBRUGER, revision, store: { appendLog: async (_rum: string, e: { tekst: string }) => { roomLog.push(e.tekst); return {}; } } } as unknown as RoomDeps;
    const tegn = lavTegn();

    await assert.rejects(gennem(d, { rum: 'mail', id: 'h-betal', verb: 'betal', zoner: ['privat'] }, 'handling', { kanal: 'stemme' }, async () => null, { tegn }), GraenseAfvist);
    await assert.rejects(gennem(d, { rum: 'mail', id: 'h-send', verb: 'send-til-andre', zoner: ['privat'] }, 'handling', { kanal: 'knap' }, async () => null, { tegn }), GraenseAfvist);
    const run = await gennem(d, { rum: 'dagen', id: 'opdater', verb: 'laes', zoner: ['privat'] }, 'opdater', { kanal: 'baggrund' }, async () => ({ id: 'kc_abc', status: 'queued' }), { tegn });
    assert.equal(run.id, 'kc_abc');

    const s = await revision.seneste();
    assert.deepEqual(s.map((e) => [e.rum, e.verb, e.udfald, e.kanal, e.kilde]), [
      ['dagen', 'laes', 'tillad', 'planlagt', 'graense'],
      ['mail', 'send-til-andre', 'kraever-ja', 'knap', 'graense'],
      ['mail', 'betal', 'afvist', 'stemme', 'graense'],
    ]);
    assert.equal(s[0]?.runId, 'kc_abc', 'an allowed handling carries the run it started');
    assert.equal(s[2]?.handlingId, 'h-betal');
    assert.equal(roomLog.length, 2, 'refusals keep their line in the room log (AGENTS §4 r10)');
  });
});

test('an action id keeps its name and ids, never the text in its body', async () => {
  await medMappe(async (dir) => {
    const revision = lavRevisionslog(dir);
    const d = { person: ENEBRUGER, revision, store: { appendLog: async () => ({}) } } as unknown as RoomDeps;
    await gennem(d, { rum: 'skrive', id: `nyt|${JSON.stringify({ titel: 'Brev til Clara', brief: 'Skriv om kablet', dokId: 'd1' })}`, verb: 'forbered', zoner: ['privat'] }, 'aktion', { kanal: 'knap' }, async () => null, { tegn: lavTegn() });
    const [e] = await revision.seneste();
    assert.equal(e?.handlingId, 'nyt|dokId=d1');
    assert.doesNotMatch(JSON.stringify(e), /Clara|kablet/);
  });
});

test('KC-0125: a secret value in any field never reaches the audit file (the chain still holds)', async () => {
  const { registrerHemmelighed, nulstilRegistrerede, MASKE } = await import('../../src/graenser/redaktion.ts');
  const HEMMELIG = 'dummy-revision-hemmelighed-77';
  await medMappe(async (dir) => {
    nulstilRegistrerede();
    registrerHemmelighed(HEMMELIG);
    try {
      const log = lavRevisionslog(dir, { nu: () => new Date('2026-10-31T12:00:00Z') });
      await log.skriv(linje({ hvorfor: `Afvist: ${HEMMELIG}`, handlingId: HEMMELIG }));
      await log.skriv(linje());
      const fil = (await readdir(dir)).find((f) => f.startsWith('revision-'))!;
      const tekst = await readFile(path.join(dir, fil), 'utf8');
      assert.ok(!tekst.includes(HEMMELIG));
      assert.ok(tekst.includes(`Afvist: ${MASKE}`));
      assert.deepEqual(await log.tjekKaede(), { ok: true });
    } finally { nulstilRegistrerede(); }
  });
});
