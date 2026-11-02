// KC-0139: the test world's three failing connections — one moment per visible state, each with its one card in Nu;
// connecting again in the world really mends the fake (the card is gone), and the next jump forgets the repair.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lavTestverden } from '../../src/testtilstand/verden.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-helbred-verden-'));
after(() => rm(rod, { recursive: true, force: true }));
const verden = await lavTestverden({ dataDir: path.join(rod, 'data-test'), delayMs: 0 });
const side = async (sti: string): Promise<string> => (await verden.app.request(sti)).text();
const kort = (h: string): string[] => [...h.matchAll(/data-kilde-helbred="([a-z-]+)" data-kilde-helbred-id="([a-z-]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
const post = (url: string, body: unknown) => verden.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('the ordinary day has no connection card', async () => {
  for (const id of ['morgen', 'aften', 'sent-aften', 'naeste-morgen', 'pause']) {
    await verden.hop(id);
    assert.deepEqual(kort(await side('/rum/hjem')), [], id);
  }
});

test('kilde-log-ind-igen: the calendar logged out — one card in Nu, Dagen says the week is old', async () => {
  await verden.hop('kilde-log-ind-igen');
  const h = await side('/rum/hjem');
  assert.deepEqual(kort(h), ['log-ind-igen falsk-kalender']);
  assert.match(h, /Din kalender er logget ud/);
  assert.match(h, />Log ind igen</);
  assert.match(await side('/rum/dagen'), /data-ikke-opdateret[^>]*>ikke opdateret siden i går 07\.05</);
});

test('Log ind igen in the world: the round trip runs, the fake calendar reads ok, the card is gone; the next jump brings it back', async () => {
  await verden.hop('kilde-log-ind-igen');
  const res = await post('/api/kilder/falsk-kalender/forbind', { felter: {} });
  const { omdiriger } = (await res.json()) as { omdiriger: string };
  assert.equal((await verden.app.request(omdiriger)).status, 302);
  const efter = await side('/rum/hjem');
  assert.deepEqual(kort(efter), []);
  await verden.hop('kilde-log-ind-igen');
  assert.deepEqual(kort(await side('/rum/hjem')), ['log-ind-igen falsk-kalender'], 'the repair belongs to the moment it was made in');
});

test('kilde-nede: the mail not answering — a card that asks for the password again, and Mail says the list is old', async () => {
  await verden.hop('kilde-nede');
  const h = await side('/rum/hjem');
  assert.deepEqual(kort(h), ['nede falsk-mail']);
  assert.match(h, /Din mail svarer ikke/);
  assert.match(h, /<input name="adgangskode" type="password"/);
  assert.match(h, /<input type="hidden" name="brugernavn" value="henrik">/);
  assert.match(await side('/rum/mail'), /ikke opdateret siden i går 20\.40/);
  const res = await post('/api/kilder/falsk-mail/forbind', { felter: { brugernavn: 'henrik', adgangskode: 'x' } });
  assert.equal(res.status, 200);
  assert.deepEqual(kort(await side('/rum/hjem')), []);
});

test('kilde-snart-udloebet: an access that runs out soon — a card that says when, the data still counts as fresh', async () => {
  await verden.hop('kilde-snart-udloebet');
  const h = await side('/rum/hjem');
  assert.deepEqual(kort(h), ['snart-udloebet falsk-kalender']);
  assert.match(h, /udløber snart/);
  assert.match(h, /Udløber i morgen 20\.40/);
  assert.match(h, /Sidst hentet 08\.30/, 'it still works, so its last read counts as fresh');
  assert.doesNotMatch(await side('/rum/dagen'), /data-ikke-opdateret/);
});
