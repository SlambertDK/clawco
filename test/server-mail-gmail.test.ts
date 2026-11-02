// KC-0135: "Log ind med Google" for Gmail end to end through the HTTP routes,
// against the in-process fake Google and fake mail reader: forbind answers
// Google's consent URL (mail + address scopes, S256, this connector's return
// address on this app); tilbage with a bad state → 400; the right one connects
// (302), announces the first read, and /api/kilder says ok. Also the
// composition rule in main(): Gmail is offered after the other sources.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, medMailGmail } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { mailGmail, MAIL_GMAIL_ID } from '../src/kilder/mail-gmail/kilde.ts';
import { googleKalender, GOOGLE_KALENDER_ID } from '../src/kilder/google-kalender/kilde.ts';
import { falskGoogle } from '../src/kilder/google/falsk-google.ts';
import { FOERSTE_LAESNING } from '../src/kilder/register.ts';
import { rejsenFaerdig } from './fixtures/start.ts';

const NOW = new Date('2026-10-31T07:00:00Z');
const ADR = 'https://kontrol.example.ts.net';
const KLIENT = { id: 'klient-1.apps.googleusercontent.com', hemmelighed: 'GOCSPX-k' };
const ENV = { KC_GOOGLE_CLIENT_ID: KLIENT.id, KC_GOOGLE_CLIENT_SECRET: KLIENT.hemmelighed };
const MAIL = [{ id: '1', emne: 'Hej fra Clara', fra: 'Clara', modtaget: '2026-10-31T06:00:00Z', laest: false, flag: false, vedhaeftning: false }];

type App = ReturnType<typeof createApp>;
async function medApp(fn: (o: { sut: App; g: ReturnType<typeof falskGoogle> }) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-gmail-'));
  try {
    const store = createFileStore(path.join(dir, 'data'));
    await rejsenFaerdig(store);
    const g = falskGoogle({ klient: KLIENT, kalendere: () => [], konto: 'ella@gmail.example' });
    const sut = createApp({
      store, hermes: createFakeAgent({ answer: () => 'Ingen JSON.' }), sourceGlob: path.join(dir, 'avis_{date}.json'), dataDir: dir, now: () => NOW, adresse: ADR,
      mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent',
      kilder: [
        googleKalender({ env: { ...ENV }, adresse: ADR, hent: g.hent }),
        mailGmail({ env: { ...ENV }, adresse: ADR, hent: g.hent, laes: async () => ({ kuverter: MAIL, tal: { indbakke: 1, ulaeste: 1, mapper: {} } }) }),
      ],
    });
    await fn({ sut, g });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const post = (sut: App, url: string) => sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
const lokal = (url: string): string => { const u = new URL(url); return `${u.pathname}${u.search}`; };
type Oversigt = { id: string; forbundet: boolean; helbred: { status: string } | null; kort: { handling: string; tekst: string } };
const kilder = async (sut: App): Promise<Oversigt[]> => ((await (await sut.app.request('/api/kilder')).json()) as { kilder: Oversigt[] }).kilder;

test('forbind answers Google\'s consent URL: mail and address, S256, Gmail\'s own return address on this app', async () => {
  await medApp(async ({ sut }) => {
    const r = await post(sut, `/api/kilder/${MAIL_GMAIL_ID}/forbind`);
    assert.equal(r.status, 200);
    const u = new URL(((await r.json()) as { omdiriger: string }).omdiriger);
    assert.equal(`${u.origin}${u.pathname}`, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(u.searchParams.get('scope'), 'https://mail.google.com/ openid email');
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(u.searchParams.get('redirect_uri'), `${ADR}/api/kilder/mail-gmail/tilbage`);
  });
});

test('tilbage: a bad state is 400; the right one connects, redirects, announces the first read and reads ok; the card then names the account', async () => {
  await medApp(async ({ sut, g }) => {
    const signaler: unknown[] = [];
    sut.live.subscribe(FOERSTE_LAESNING, (v) => signaler.push(v));
    assert.equal((await sut.app.request(`/api/kilder/${MAIL_GMAIL_ID}/tilbage?state=forkert&code=x`)).status, 400);
    const { omdiriger } = (await (await post(sut, `/api/kilder/${MAIL_GMAIL_ID}/forbind`)).json()) as { omdiriger: string };
    const ok = await sut.app.request(lokal(g.samtykke(omdiriger)));
    assert.equal(ok.status, 302);
    assert.equal(signaler.length, 1);
    const gm = (await kilder(sut)).find((x) => x.id === MAIL_GMAIL_ID)!;
    assert.deepEqual([gm.forbundet, gm.helbred?.status], [true, 'ok']);
    assert.match(gm.kort.tekst, /Forbundet som ella@gmail\.example/);
  });
});

test('with the calendar connected, Gmail\'s card says only mail is missing, and the login carries the calendar grant', async () => {
  await medApp(async ({ sut, g }) => {
    const foer = (await kilder(sut)).find((x) => x.id === MAIL_GMAIL_ID)!;
    assert.equal(foer.kort.handling, 'Log ind med Google');
    const k = (await (await post(sut, `/api/kilder/${GOOGLE_KALENDER_ID}/forbind`)).json()) as { omdiriger: string };
    assert.equal((await sut.app.request(lokal(g.samtykke(k.omdiriger)))).status, 302);
    const efter = (await kilder(sut)).find((x) => x.id === MAIL_GMAIL_ID)!;
    assert.match(efter.kort.tekst, /^Google er allerede koblet: kun mail mangler\./);
    const m = (await (await post(sut, `/api/kilder/${MAIL_GMAIL_ID}/forbind`)).json()) as { omdiriger: string };
    assert.equal(new URL(m.omdiriger).searchParams.get('include_granted_scopes'), 'true');
  });
});

test('medMailGmail: offered after the other sources, one of its kind', () => {
  const g = () => mailGmail({ env: {} });
  const foer = [googleKalender({ env: {} })];
  assert.deepEqual(medMailGmail(foer, g).map((k) => k.id), [GOOGLE_KALENDER_ID, MAIL_GMAIL_ID]);
  assert.deepEqual(medMailGmail([], g).map((k) => k.id), [MAIL_GMAIL_ID]);
});
