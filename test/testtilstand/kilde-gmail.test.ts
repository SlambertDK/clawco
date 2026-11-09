// KC-0135 in the test world (AGENTS §4 r11): Gmail's card in each state over the
// world's fake Google — the setup steps in the cold start, "Google er allerede
// koblet: kun mail mangler" with the calendar connected, connected and reading
// the story's mail, logged out — and the fake Google consent really clickable:
// the connect card's round trip runs in the world and ends connected.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lavTestverden } from '../../src/testtilstand/verden.ts';
import { DAEKNING } from '../../src/testtilstand/daekning.ts';
import { FORBUDT } from '../../src/testtilstand/indhold.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-gmail-verden-'));
after(() => rm(rod, { recursive: true, force: true }));
const verden = await lavTestverden({ dataDir: path.join(rod, 'data-test'), delayMs: 0 });
const side = async (sti: string): Promise<string> => (await verden.app.request(sti)).text();
type O = { id: string; forbundet: boolean; helbred: { status: string; tekst?: string } | null; kort: { handling: string; tekst: string; trin?: { tekst: string; kopier?: string }[] } };
const gmail = async (): Promise<O> => ((await (await verden.app.request('/api/kilder')).json()) as { kilder: O[] }).kilder.find((k) => k.id === 'mail-gmail')!;

test('the cold start: no Google app yet, so the card walks through making one — with Gmail\'s own return address and the mail scope to copy', async () => {
  await verden.hop('kold');
  const g = await gmail();
  assert.equal(g.forbundet, false);
  assert.ok(g.kort.trin!.some((t) => t.kopier === 'https://testverden.example/api/kilder/mail-gmail/tilbage'));
  assert.ok(g.kort.trin!.some((t) => t.kopier === 'https://mail.google.com/'));
  await verden.hop('kold-model'); // KC-0247: step 3 is the open step once steps 1–2 are done
  assert.match(await side('/rum/start'), /data-kilde-trin="mail-gmail"/);
});

test('the morning: the Google app is set up, nothing connected — "Log ind med Google" and the full-access words', async () => {
  await verden.hop('morgen');
  const g = await gmail();
  assert.deepEqual([g.forbundet, g.kort.handling], [false, 'Log ind med Google']);
  assert.match(g.kort.tekst, /fuld adgang/);
});

test('with the calendar connected (before the meeting): "Google er allerede koblet: kun mail mangler"', async () => {
  await verden.hop('foer-moede');
  const g = await gmail();
  assert.equal(g.forbundet, false);
  assert.match(g.kort.tekst, /^Google er allerede koblet: kun mail mangler\./);
});

test('the cold moment with the calendar connected: Start\'s step 3 shows that card on screen', async () => {
  await verden.hop('kold-google');
  const h = await side('/rum/start');
  assert.match(h, /data-kilde-kort="mail-gmail"/);
  assert.match(h, /Google er allerede koblet: kun mail mangler/);
  assert.match(h, /data-kilde-trin="mail-gmail"/);
});

test('gmail-koblet: connected, reading the story\'s mail over a token the fake Google issued, in Kilder with its state', async () => {
  await verden.hop('gmail-koblet');
  const g = await gmail();
  assert.deepEqual([g.forbundet, g.helbred?.status], [true, 'ok']);
  assert.match(g.kort.tekst, /Forbundet som /);
  const koe = (await (await verden.app.request('/api/koe?kilder=1')).json()) as { kilder?: string };
  assert.match(koe.kilder ?? '', /data-kilde="mail-gmail" data-kilde-tilstand="forbundet"/);
});

test('gmail-log-ind-igen: Google refused the grant — the card in Nu asks to log in again, in the fixed words', async () => {
  await verden.hop('gmail-log-ind-igen');
  assert.equal((await gmail()).helbred?.status, 'log-ind-igen');
  const h = await side('/rum/hjem');
  assert.match(h, /data-kilde-helbred="log-ind-igen" data-kilde-helbred-id="mail-gmail"/);
  assert.match(h, /Din mail er logget ud/);
  assert.match(h, />Log ind igen</);
});

test('the fake Google consent is clickable: connect → the stand-in page → back to Clawco → connected and reading', async () => {
  await verden.hop('foer-moede');
  const res = await verden.app.request('/api/kilder/mail-gmail/forbind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 200);
  const { omdiriger } = (await res.json()) as { omdiriger: string };
  assert.match(omdiriger, /^\/test-google\/samtykke\?url=/, 'the world sends the browser to its own stand-in, never to the real Google');
  const samtykke = await verden.app.request(omdiriger);
  assert.equal(samtykke.status, 302);
  const tilbage = samtykke.headers.get('location') ?? '';
  assert.match(tilbage, /^\/api\/kilder\/mail-gmail\/tilbage\?/);
  assert.equal((await verden.app.request(tilbage)).status, 302);
  const g = await gmail();
  assert.deepEqual([g.forbundet, g.helbred?.status], [true, 'ok']);
  await new Promise((r) => setTimeout(r, 300)); // the connect's first-value hook writes Start's state; let it land before the world re-seeds
  await verden.hop('foer-moede');
  assert.equal((await gmail()).forbundet, false, 'the next jump forgets the connection');
});

test('the stand-in refuses anything that is not a consent URL for this world\'s own Google app', async () => {
  assert.equal((await verden.app.request('/test-google/samtykke?url=https%3A%2F%2Fevil.example%2F')).status, 400);
  assert.equal((await verden.app.request('/test-google/samtykke')).status, 400);
});

test('coverage: Gmail\'s card, its setup steps and its "only mail is missing" text are on the list, and no invented mail carries a real name', () => {
  const ider = new Set(DAEKNING.map((d) => d.id));
  for (const id of ['kilde-gmail-kort', 'kilde-gmail-trin', 'kilde-gmail-kun-mail']) assert.ok(ider.has(id), id);
  for (const ord of FORBUDT) assert.ok(!'ella@gmail.example'.toLowerCase().includes(ord.toLowerCase()), ord);
});

// KC-0223: with Gmail connected (it can only read), Mail and Nu show what waits in it, and nothing that moves or writes.
test('gmail-koblet: Mail shows the two unread mails of the Gmail inbox as a read-only view, and Nu lists them as waiting', async () => {
  await verden.hop('gmail-koblet');
  const mail = await side('/rum/mail');
  assert.match(mail, /data-mail-kilde="laes-kun"/);
  assert.match(mail, /Invitation: sommerfest/);
  assert.match(mail, /Tre nye fejl i nat/);
  assert.doesNotMatch(mail, /Husk tandlægetid/, 'a read mail is not waiting');
  for (const forbudt of [/data-aktion=/, /data-handling=/, /name="tekst"/]) assert.doesNotMatch(mail, forbudt);
  const nu = await side('/rum/hjem');
  assert.match(nu, /Mail: Invitation: sommerfest/);
});

test('gmail-koblet: Opdatér on the read-only Mail asks the scripted Hermes and keeps the same two waiting mails, still read-only', async () => {
  await verden.hop('gmail-koblet');
  const res = await verden.app.request('/api/rum/mail/opdater', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'opdater' }) });
  assert.equal(res.status, 202);
  for (let i = 0; i < 400; i++) {
    const { runs } = (await (await verden.app.request('/api/koe')).json()) as { runs: { status: string }[] };
    if (!runs.some((r) => r.status === 'queued' || r.status === 'running')) break;
    await new Promise((r) => setTimeout(r, 5));
  }
  const mail = await side('/rum/mail');
  assert.match(mail, /data-mail-kilde="laes-kun"/);
  assert.match(mail, /Invitation: sommerfest/);
  assert.match(mail, /Tre nye fejl i nat/);
  assert.doesNotMatch(mail, /data-aktion=/);
});
