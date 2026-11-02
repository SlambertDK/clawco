// KC-0146 "Hent alt": GET /api/tillid/eksport is a zip of the data dir and <vault>/Clawco (plus the people the
// page shows), never a secret and never the user's other notes; it holds everything the page lists. Owner only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MAJA, videnApp } from './helpers/viden.ts';

async function hent(t: Awaited<ReturnType<typeof videnApp>>): Promise<{ navne: string[]; res: Response }> {
  const res = await t.sut.app.request('/api/tillid/eksport');
  assert.equal(res.status, 200);
  const zip = path.join(t.dir, 'alt.zip');
  await writeFile(zip, Buffer.from(await res.arrayBuffer()));
  assert.match(execFileSync('unzip', ['-t', zip], { encoding: 'utf8' }), /No errors detected/);
  return { navne: execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n'), res };
}

test('the zip lists the rooms, the rules, Clawco\'s folder and the people; no secrets, no other notes', async () => {
  const t = await videnApp();
  try {
    const { navne, res } = await hent(t);
    assert.equal(res.headers.get('content-type'), 'application/zip');
    assert.match(res.headers.get('content-disposition') ?? '', /^attachment; filename="clawco-2026-11-01\.zip"$/);
    for (const n of ['data/rum/mail/log.jsonl', 'data/rum/mail/chat.jsonl', 'data/tillid/regler.sha', 'vault/Clawco/regler.md', 'personer/familie/Maja.md'])
      assert.ok(navne.includes(n), `${n} is in the zip`);
    for (const n of navne) {
      assert.doesNotMatch(n, /\.env|token|hemmelig|secret|key/i, `${n} is not a secret`);
      assert.doesNotMatch(n, /00-Indbakke|egen note/, `${n} is not one of the user's own notes`);
    }
  } finally { await t.ryd(); }
});

test('the export is a superset of what the page lists', async () => {
  const t = await videnApp();
  try {
    const side = await (await t.sut.app.request('/viden')).text();
    const { navne } = await hent(t);
    const rum = [...side.matchAll(/data-viden-rum="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(rum, ['mail']);
    for (const id of rum) assert.ok(navne.some((n) => n.startsWith(`data/rum/${id}/`)), `room ${id}`);
    const fil = /data-regler-fil>([^<]+)</.exec(side)?.[1];
    assert.ok(fil?.endsWith(path.join('Clawco', 'regler.md')));
    assert.ok(navne.includes('vault/Clawco/regler.md'));
    const personer = [...side.matchAll(/data-viden-person>[\s\S]*?<span class="mono">([^<]+)<\/span>/g)].map((m) => m[1]);
    assert.deepEqual(personer, ['familie/Maja.md']);
    for (const p of personer) assert.ok(navne.includes(`personer/${p}`), p);
  } finally { await t.ryd(); }
});

test('only the owner may see the page or take the export', async () => {
  const t = await videnApp({ person: MAJA });
  try {
    assert.equal((await t.sut.app.request('/api/tillid/eksport')).status, 403);
    assert.equal((await t.sut.app.request('/viden')).status, 403);
    assert.equal((await t.sut.app.request('/viden/slet-alt')).status, 403);
  } finally { await t.ryd(); }
});

test('the page is reachable from the Kø panel and the chat', async () => {
  const t = await videnApp();
  try {
    const nu = await (await t.sut.app.request('/rum/hjem')).text();
    assert.match(nu, /<a [^>]*href="\/viden"[^>]*>Hvad Clawco ved om dig</);
    const res = await t.post('/api/rum/hjem/chat', { besked: 'Hvad ved du om mig?', aabn: true });
    assert.deepEqual(await res.json(), { aabn: '/viden' });
    assert.equal(t.hermes.calls.length, 0, 'Hermes is not asked');
  } finally { await t.ryd(); }
});

test('/viden renders every section for the owner', async () => {
  const t = await videnApp();
  try {
    const res = await t.sut.app.request('/viden');
    assert.equal(res.status, 200);
    const side = await res.text();
    assert.match(side, /data-viden/);
    assert.match(side, /<meta name="color-scheme" content="dark">/);
    for (const del of ['kilder', 'regler', 'personer', 'gemt']) assert.match(side, new RegExp(`data-viden-del="${del}"`));
    assert.match(side, /R-0001/);
  } finally { await t.ryd(); }
});
