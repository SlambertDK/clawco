// KC-0138 (Path B): the inbound log Hermes' gateway hook appends to — one JSON object per line. A line Hermes is
// still writing, a malformed line and a rotated file must never break a read or yield a half message.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { laesLog, laesStatus, LOG_FIL, parseLinjer, STATUS_FIL } from '../../../src/kilder/beskeder/jsonl.ts';

const linje = (o: Record<string, unknown>): string => JSON.stringify({ kanal: 'telegram', samtale: '111', gruppe: false, afsender: '111', tid: '2026-11-01T08:00:00.000Z', tekst: 'Hej', ...o });

test('a malformed line is skipped and counted; the good ones are read', () => {
  const r = parseLinjer(`${linje({ tekst: 'en' })}\n{ikke json\n${linje({ tekst: 'to' })}\n`);
  assert.deepEqual(r.poster.map((p) => p.tekst), ['en', 'to']);
  assert.equal(r.sprunget, 1);
});

test('a line with an unknown channel, a missing field or a bad time is skipped', () => {
  const r = parseLinjer([linje({ kanal: 'irc' }), linje({ samtale: 5 }), linje({ tid: 'i går' }), linje({ afsender: '' }), linje({})].join('\n') + '\n');
  assert.equal(r.poster.length, 1);
  assert.equal(r.sprunget, 4);
});

test('a partial last line (no newline yet: Hermes is mid-append) is not read', () => {
  const hel = linje({ tekst: 'hel' });
  const r = parseLinjer(`${hel}\n${hel.slice(0, 30)}`);
  assert.deepEqual(r.poster.map((p) => p.tekst), ['hel']);
  assert.equal(r.sprunget, 0);
});

test('optional names, attachments and chat kind are kept; anything else is dropped', () => {
  const [p] = parseLinjer(`${linje({ samtaleNavn: 'Familien', afsenderNavn: 'Ella', gruppe: true, vedhaeftning: [{ navn: 'billede.jpg', type: 'image/jpeg', data: 'AAAA' }], hemmelig: 'x' })}\n`).poster;
  assert.ok(p);
  assert.equal(p.samtaleNavn, 'Familien');
  assert.equal(p.afsenderNavn, 'Ella');
  assert.equal(p.gruppe, true);
  assert.deepEqual(p.vedhaeftning, [{ navn: 'billede.jpg', type: 'image/jpeg' }]);
  assert.equal(Object.hasOwn(p, 'hemmelig'), false);
});

test('laesLog reads the rotated file before the current one, and null when there is no log at all', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-beskeder-'));
  try {
    assert.equal(await laesLog(dir), null);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${LOG_FIL}.1`), `${linje({ tekst: 'gammel' })}\n`);
    await writeFile(path.join(dir, LOG_FIL), `${linje({ tekst: 'ny' })}\n`);
    assert.deepEqual((await laesLog(dir))?.map((p) => p.tekst), ['gammel', 'ny']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('laesStatus reads the channels the gateway came up with; a broken file is null', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-beskeder-'));
  try {
    assert.equal(await laesStatus(dir), null);
    await writeFile(path.join(dir, STATUS_FIL), JSON.stringify({ platforms: ['telegram', 'api_server', 'signal'], tid: '2026-11-01T06:00:00.000Z' }));
    assert.deepEqual(await laesStatus(dir), { kanaler: ['telegram', 'signal'], tid: '2026-11-01T06:00:00.000Z' });
    await writeFile(path.join(dir, STATUS_FIL), '{');
    assert.equal(await laesStatus(dir), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
