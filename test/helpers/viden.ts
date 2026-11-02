// KC-0146: one app over a temp data dir and a vault next to it, seeded with a room, rules, a person,
// a note of the user's own and secrets — for the export and Slet alt tests. Temp dirs only.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/server.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { createFakeStemme } from '../../src/stemme/fake.ts';
import { lavReglerLager } from '../../src/tillid/lager.ts';
import { skrivPerson } from '../../src/kilder/noter/personer.ts';
import type { Person } from '../../src/identitet/husstand.ts';

export const REGLER = `naeste-id: R-0002\n\n## R-0001 · Regnskabslinjer\n- trin: 2\n- gaelder: mail / regning\n- oprindelse: import 2026-10-31\n- status: aktiv\n`;

export async function videnApp(o: { person?: Person } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-viden-'));
  const dataDir = path.join(dir, 'data');
  const vault = path.join(dir, 'vault');
  const personer = path.join(vault, '40-Mennesker', 'People');
  const store = createFileStore(dataDir);
  const hermes = createFakeAgent({ answer: () => 'ok' });
  const sut = createApp({
    store, hermes, sourceGlob: path.join(dir, 'avis_{date}.json'), dataDir, now: () => new Date('2026-11-01T09:00:00Z'),
    mailRunner: async () => ({ code: 0, stdout: '[]', stderr: '' }), mailStateDir: path.join(dir, 'state'),
    vaultInbox: path.join(vault, '00-Indbakke'), personer, stemme: createFakeStemme(),
    ...(o.person ? { identitet: { fast: o.person } } : {}),
  });
  await store.appendLog('mail', { kilde: 'hermes', tekst: 'Flyttede en mail' });
  await store.appendLog('mail', { kilde: 'henrik', tekst: 'Færdig' });
  await store.appendChat('mail', { fra: 'henrik', tekst: 'Hej' });
  await lavReglerLager({ vaultDir: vault, dataDir }).skrivTekst(REGLER);
  await mkdir(personer, { recursive: true });
  await skrivPerson(personer, { navn: 'Maja', relation: 'familie', zone: 'privat' }, { mappe: 'familie', zone: 'privat' });
  await mkdir(path.join(vault, '00-Indbakke'), { recursive: true });
  await writeFile(path.join(vault, '00-Indbakke', 'egen note.md'), 'min egen note', 'utf8');
  await writeFile(path.join(dataDir, '.env'), 'KC_HERMES_API_KEY=hemmelig', 'utf8');
  await writeFile(path.join(dataDir, 'hemmeligheder.enc'), 'ciffer', 'utf8');
  await writeFile(path.join(dataDir, 'google-token.json'), '{}', 'utf8');
  await mkdir(path.join(dataDir, 'hemmeligheder'), { recursive: true });
  await writeFile(path.join(dataDir, 'hemmeligheder', 'mail-imap.json'), '{"adgangskode":"x"}', 'utf8');
  const post = (url: string, body: unknown) => sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const form = (url: string, felter: Record<string, string>) => sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(felter).toString() });
  return {
    dir, dataDir, vault, personer, sut, hermes, store, post, form,
    ryd: async () => { await Promise.allSettled(sut.runs.list().map((r) => r.finished)); await rm(dir, { recursive: true, force: true }); },
  };
}

export const MAJA: Person = { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' };
