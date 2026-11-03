// KC-0124: the audit log. Append-only JSONL per month under the data dir, each
// line chained to the one before by sha256, metadata only. It is the persistent
// sink for the policy layer's reports (port.ts), next to the room-log line.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lavRevisionslog, revisionNoegleFindes, RevisionFejl, NUL_HASH, type Revision } from '../../src/graenser/revisionslog.ts';
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
    assert.deepEqual((await readdir(dir)).sort(), ['revision-2026-10.jsonl', 'revision.anker']);
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
    assert.deepEqual((await readdir(dir)).sort(), ['revision-2026-10.jsonl', 'revision-2026-11.jsonl', 'revision.anker']);
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

// KC-0275 (B6): an HMAC chain with a key outside the data folder, and an anchor next to the log.
const MAAL = 'revision-2026-10.jsonl';
const nu = (): Date => new Date('2026-10-15T10:00:00Z');
async function medNoegle(fn: (dir: string, noeglefil: string, noegle: Buffer) => Promise<void>): Promise<void> {
  await medMappe(async (dir) => {
    const ude = await mkdtemp(path.join(tmpdir(), 'kc-revision-noegle-'));
    try {
      const raa32 = randomBytes(32);
      const noeglefil = path.join(ude, 'hemmeligheder.key');
      await writeFile(noeglefil, `${raa32.toString('base64')}\n`, { mode: 0o600 });
      await fn(dir, noeglefil, Buffer.from(hkdfSync('sha256', raa32, Buffer.alloc(0), 'revision', 32)));
    } finally { await rm(ude, { recursive: true, force: true }); }
  });
}
const mac = (noegle: Buffer, s: string): string => createHmac('sha256', noegle).update(s).digest('hex');

test('with a key file the chain is an HMAC-SHA256 under an HKDF sub-key labelled "revision"; the anchor holds the last line\'s HMAC', async () => {
  await medNoegle(async (dir, noeglefil, noegle) => {
    const log = lavRevisionslog(dir, { nu, noeglefil });
    await log.skriv(linje({ handlingId: 'h0' }));
    const b = await log.skriv(linje({ handlingId: 'h1' }));
    const [l1, l2] = await raa(dir, MAAL);
    assert.equal(b.forrige, mac(noegle, l1!));
    assert.notEqual(b.forrige, sha(l1!));
    assert.equal((await readFile(path.join(dir, 'revision.anker'), 'utf8')).trim(), mac(noegle, l2!));
    assert.deepEqual(await log.tjekKaede(), { ok: true });
  });
});

test('with the key, a rewritten log is detected even when the attacker re-chains it with plain sha256', async () => {
  await medNoegle(async (dir, noeglefil) => {
    const log = lavRevisionslog(dir, { nu, noeglefil });
    for (let i = 0; i < 4; i++) await log.skriv(linje({ handlingId: `h${i}` }));
    const orig = await raa(dir, MAAL);
    // line 2 changed, every later link recomputed with sha256 (all an attacker without the key can do)
    const ny = [orig[0]!];
    for (let i = 1; i < orig.length; i++) {
      const o = JSON.parse(orig[i]!) as Record<string, unknown>;
      o['forrige'] = sha(ny[i - 1]!);
      if (i === 1) o['verb'] = 'andet';
      ny.push(JSON.stringify(o));
    }
    await writeFile(path.join(dir, MAAL), `${ny.join('\n')}\n`);
    // the rewritten tail now reads as a plain sha256 chain; the HMAC anchor no longer matches it
    assert.deepEqual(await log.tjekKaede(), { ok: false, fil: MAAL, linje: 4, aarsag: 'anker' });
    // and an attacker who also rewrites the anchor with sha256 is caught because a key demands an HMAC anchor
    await writeFile(path.join(dir, 'revision.anker'), `${sha(ny.at(-1)!)}\n`);
    assert.equal((await log.tjekKaede()).ok, false);
  });
});

test('a truncated tail is detected by the anchor (with and without a key)', async () => {
  for (const medKey of [true, false]) {
    await medNoegle(async (dir, noeglefil) => {
      const log = lavRevisionslog(dir, { nu, ...(medKey ? { noeglefil } : { noeglefil: path.join(dir, 'findes-ikke') }) });
      for (let i = 0; i < 4; i++) await log.skriv(linje({ handlingId: `h${i}` }));
      assert.deepEqual(await log.tjekKaede(), { ok: true });
      const orig = await raa(dir, MAAL);
      await writeFile(path.join(dir, MAAL), `${orig.slice(0, 3).join('\n')}\n`);
      assert.deepEqual(await log.tjekKaede(), { ok: false, fil: MAAL, linje: 3, aarsag: 'anker' }, medKey ? 'key' : 'no key');
      await log.skriv(linje({ handlingId: 'efter' })); // the next line re-anchors: the chain itself is intact
      assert.deepEqual(await log.tjekKaede(), { ok: true });
    });
  }
});

test('with a key, a deleted anchor or an anchor rewritten to plain sha256 is reported', async () => {
  await medNoegle(async (dir, noeglefil) => {
    const log = lavRevisionslog(dir, { nu, noeglefil });
    for (let i = 0; i < 3; i++) await log.skriv(linje({ handlingId: `h${i}` }));
    const sidste = (await raa(dir, MAAL)).at(-1)!;
    await writeFile(path.join(dir, 'revision.anker'), `${sha(sidste)}\n`);
    assert.equal((await log.tjekKaede()).ok, false);
    await rm(path.join(dir, 'revision.anker'));
    assert.equal((await log.tjekKaede()).ok, false);
  });
});

test('without a key file the chain stays sha256 as before, logging works, and the anchor is still kept', async () => {
  await medMappe(async (dir) => {
    const log = lavRevisionslog(dir, { nu, noeglefil: path.join(dir, 'findes-ikke') });
    assert.equal(revisionNoegleFindes(path.join(dir, 'findes-ikke')), false);
    const a = await log.skriv(linje());
    const b = await log.skriv(linje());
    const [l1, l2] = await raa(dir, MAAL);
    assert.equal(a.forrige, NUL_HASH);
    assert.equal(b.forrige, sha(l1!));
    assert.equal((await readFile(path.join(dir, 'revision.anker'), 'utf8')).trim(), sha(l2!));
    assert.deepEqual(await log.tjekKaede(), { ok: true });
  });
});

test('a log from before the anchor existed (no anchor file yet) still checks out, and the next line anchors it', async () => {
  await medMappe(async (dir) => {
    const log = lavRevisionslog(dir, { nu, noeglefil: path.join(dir, 'findes-ikke') });
    await log.skriv(linje());
    await rm(path.join(dir, 'revision.anker'));
    assert.deepEqual(await log.tjekKaede(), { ok: true });
    await log.skriv(linje());
    assert.equal((await readFile(path.join(dir, 'revision.anker'), 'utf8')).trim().length, 64);
  });
});

test('a key that arrives later continues an existing sha256 chain; a sha256 line after the HMAC era is a break', async () => {
  await medNoegle(async (dir, noeglefil) => {
    const uden = lavRevisionslog(dir, { nu, noeglefil: path.join(dir, 'findes-ikke') });
    await uden.skriv(linje({ handlingId: 'foer' }));
    const med = lavRevisionslog(dir, { nu, noeglefil });
    await med.skriv(linje({ handlingId: 'efter' }));
    assert.deepEqual(await med.tjekKaede(), { ok: true });
    await uden.skriv(linje({ handlingId: 'nøglen mistet' })); // fail-visible: it keeps logging, the check says it can no longer vouch for the chain
    assert.equal((await med.tjekKaede()).ok, false);
  });
});

test('a key file that is not 32 bytes of base64 counts as no key', async () => {
  await medMappe(async (dir) => {
    const dud = path.join(dir, 'dud.key');
    await writeFile(dud, 'for kort\n');
    assert.equal(revisionNoegleFindes(dud), false);
    const log = lavRevisionslog(dir, { nu, noeglefil: dud });
    await log.skriv(linje());
    assert.deepEqual(await log.tjekKaede(), { ok: true });
  });
});
