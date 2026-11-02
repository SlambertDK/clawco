// KC-0187 (spec D16): Sky always reports its errors when a DSN is configured, and nothing a customer typed or received
// leaves with them. No DSN = a no-op, never a crash. The scrubber is byte-identical to the tenant's (test/fejlrapport.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rens, lavFejlrapport, type Haendelse, type RaaHaendelse } from '../../src/delt/fejlrapport-kerne.ts';
import { skyFejlrapport } from '../../src/delt/fejlrapport.ts';
import { createSkyApp } from '../../src/server.ts';
import { pgliteDatabase } from '../pglite.ts';

const M = {
  prompt: 'MARKOER-PROMPT skriv et digt til Maja om ferien',
  mail: 'MARKOER-MAILKROP Kære Maja, her er kontrakten',
  email: 'markoer.maja@example.com',
  noegle: 'sk-ant-api03-MARKOERfalskNoegle0123456789abcdefABCDEF', // gitleaks:allow
  cookie: '__Host-sky_session=MARKOERcookie0123456789',
};
const INGEN_MARKOER = /markoer/i;
const DSN = 'https://0123456789abcdef0123456789abcdef@o1.ingest.de.sentry.example/4500000000000001';

function fyldtHaendelse(): RaaHaendelse {
  const fejl = Object.assign(new Error(`Stripe afviste ${M.email}: ${M.noegle}`), { body: M.mail, raw: { headers: { cookie: M.cookie } }, code: 'markoer' });
  return {
    fejl,
    tenant: 'maja',
    rute: '/konto/:id',
    extra: { prompt: M.prompt, noegle: M.noegle },
    request: { url: `https://konto.example.com/?e=${M.email}`, headers: { cookie: M.cookie }, data: M.mail },
    breadcrumbs: [{ category: 'console', message: M.prompt }],
    user: { email: M.email },
    exception: { values: [{ stacktrace: { frames: [{ vars: { input: M.prompt, mail: M.mail } }] } }] },
  };
}

test('a fully loaded Sky event leaves with no marker anywhere', () => {
  const json = JSON.stringify(rens(fyldtHaendelse()));
  assert.doesNotMatch(json, INGEN_MARKOER, json);
});

test('Sky: always on when SKY_FEJLRAPPORT_DSN is set, and the DSN is taken out of the environment (no child process inherits it)', async () => {
  const env: Record<string, string | undefined> = { SKY_FEJLRAPPORT_DSN: DSN };
  const sendt: Haendelse[] = [];
  const { rapport, grund } = skyFejlrapport(env, { release: 'abc1234', lavTransport: () => async (_k, h) => { sendt.push(h); } });
  assert.equal(rapport.aktiv, true);
  assert.equal(env['SKY_FEJLRAPPORT_DSN'], undefined);
  assert.match(grund, /o1\.ingest\.de\.sentry\.example/, 'the log line says where reports go (the region is in the host)');
  assert.doesNotMatch(grund, /0123456789abcdef0123456789abcdef/, 'never the key part');
  rapport.rapporter(fyldtHaendelse().fejl, { rute: '/x' });
  await rapport.vent();
  assert.equal(sendt.length, 1);
  assert.equal(sendt[0]!.release, 'abc1234');
  assert.equal(sendt[0]!.environment, 'sky');
  assert.doesNotMatch(JSON.stringify(sendt[0]), INGEN_MARKOER);
});

test('Sky: no DSN is a no-op that never builds a transport and never throws', async () => {
  let bygget = 0;
  const { rapport, grund } = skyFejlrapport({}, { release: 'x', lavTransport: () => { bygget += 1; return async () => {}; } });
  assert.equal(rapport.aktiv, false);
  assert.doesNotThrow(() => rapport.rapporter(new Error('x')));
  await rapport.vent();
  assert.equal(bygget, 0);
  assert.match(grund, /SKY_FEJLRAPPORT_DSN/);
});

test('Sky: an invalid DSN is off with a reason naming the key, never its value', () => {
  const env = { SKY_FEJLRAPPORT_DSN: `https://${M.noegle}:hemmelig@example.com/1` };
  const { rapport, grund } = skyFejlrapport(env, { release: 'x' });
  assert.equal(rapport.aktiv, false);
  assert.match(grund, /SKY_FEJLRAPPORT_DSN er ugyldig/);
  assert.doesNotMatch(grund, INGEN_MARKOER);
});

test('Sky app: an unexpected error is reported with the route template and answers a plain 500', async () => {
  const sendt: Haendelse[] = [];
  const fejlrapport = lavFejlrapport({ transport: async (_k, h) => { sendt.push(h); }, release: 'abc1234' });
  const db = await pgliteDatabase();
  try {
    const app = createSkyApp({ db, sha: 'abc1234', startet: Date.now(), fejlrapport });
    app.post('/test/kast/:id', () => { throw new Error(M.prompt); });
    const res = await app.request(`/test/kast/7?e=${encodeURIComponent(M.email)}`, { method: 'POST', body: M.mail, headers: { cookie: M.cookie } });
    assert.equal(res.status, 500);
    assert.doesNotMatch(await res.text(), INGEN_MARKOER);
    await fejlrapport.vent();
    assert.equal(sendt.length, 1);
    assert.deepEqual(sendt[0]!.tags, { rute: '/test/kast/:id', status: '500' });
    assert.doesNotMatch(JSON.stringify(sendt[0]), INGEN_MARKOER);
  } finally {
    await db.close();
  }
});
