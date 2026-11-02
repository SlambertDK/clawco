// KC-0138: the Beskeder connector behind the registry — choose a conversation on the card, and the next Kuratoren
// run carries its messages with the sender from the people register; never a number, never an un-chosen conversation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { beskederKilde } from '../src/kilder/beskeder/kilde.ts';
import { LOG_FIL } from '../src/kilder/beskeder/jsonl.ts';
import { samtaleNoegle } from '../src/kilder/beskeder/valg.ts';
import { skrivPerson } from '../src/kilder/noter/personer.ts';
import type { Person } from '../src/identitet/husstand.ts';

const NOW = new Date('2026-11-01T10:00:00Z');
const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const linje = (o: Record<string, unknown>): string => `${JSON.stringify({ kanal: 'whatsapp', samtale: '4512345678@s.whatsapp.net', gruppe: false, afsender: '4512345678@s.whatsapp.net', afsenderNavn: 'Maja', tid: '2026-11-01T09:30:00.000Z', tekst: 'Kan du hente Ella kl. 15?', ...o })}\n`;

test('choosing a conversation on the card feeds Kuratoren its messages, sender by name, nothing from other conversations', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-server-beskeder-'));
  const personer = path.join(dir, 'vault', 'People');
  try {
    await mkdir(personer, { recursive: true });
    await skrivPerson(personer, { navn: 'Maja', relation: 'familie', zone: 'privat' }, { mappe: 'familie', zone: 'privat' });
    await mkdir(path.join(dir, 'beskeder'), { recursive: true });
    await writeFile(path.join(dir, 'beskeder', LOG_FIL), linje({}) + linje({ kanal: 'telegram', samtale: '-100', gruppe: true, afsender: '7', afsenderNavn: 'Ole', tekst: 'Hemmelig gruppe' }));
    const hermes = createFakeAgent({ answer: () => '```json\n{"kort":[],"vurderinger":[],"intet":[]}\n```' });
    const app = createApp({
      store: createFileStore(dir), hermes, sourceGlob: path.join(dir, 'ingen-{date}.json'), dataDir: dir, now: () => NOW, identitet: { fast: EJER },
      mailRunner: async () => ({ code: 0, stdout: '[]', stderr: '' }), mailStateDir: '/nonexistent', personer,
      beskeder: (o) => beskederKilde({ dataDir: dir, ...o }),
    });
    try {
      const kort = await (await app.app.request('/api/kilder')).json() as { kilder: { id: string; kort: { felter: { navn: string }[] } }[] };
      const b = kort.kilder.find((k) => k.id === 'beskeder');
      assert.ok(b, 'the connector is registered');
      assert.equal(b.kort.felter.length, 2);
      const r = await app.app.request('/api/kilder/beskeder/forbind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ felter: { [samtaleNoegle('whatsapp', '4512345678@s.whatsapp.net')]: 'privat' } }) });
      assert.equal(r.status, 200, await r.clone().text());
      await new Promise((res) => setTimeout(res, 100));
      await Promise.all(app.runs.list().map((x) => x.finished.catch(() => null)));
      const kald = hermes.calls.filter((c) => c.instructions.includes('Du er Kuratoren'));
      assert.ok(kald.length >= 1, 'Kuratoren ran');
      const input = kald.at(-1)?.input ?? '';
      assert.match(input, /Maja \(familie\)/);
      assert.ok(!input.includes('4512345678'));
      assert.ok(!input.includes('Hemmelig gruppe'));
    } finally {
      await Promise.all(app.runs.list().map((r) => r.finished.catch(() => null)));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
