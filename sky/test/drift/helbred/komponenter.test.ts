// KC-0189: each component's judgement from its own signal. Unknown (null, nothing to judge) is nedsat, never ok.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { adgangsProbe, adgangStatus, kopiStatus, loginStatus, mailStatus, maaltPost, oprettelseStatus } from '../../../src/drift/helbred/komponenter.ts';
import { falskPost, PostFejl, type Post } from '../../../src/delt/post.ts';

const NU = new Date('2026-11-02T10:00:00.000Z');
const min = (n: number) => new Date(NU.getTime() - n * 60_000);
const timer = (n: number) => new Date(NU.getTime() - n * 3_600_000);

test('login: Sky answers and an account lookup works; either failing is nede; unknown is nedsat', () => {
  assert.equal(loginStatus({ sky: true, konto: true }), 'ok');
  assert.equal(loginStatus({ sky: false, konto: true }), 'nede');
  assert.equal(loginStatus({ sky: true, konto: false }), 'nede');
  assert.equal(loginStatus({ sky: null, konto: true }), 'nedsat');
});

test('adgang: the canary route sends an anonymous visitor to the account host to log in', () => {
  const o = 'https://konto.example.test';
  assert.equal(adgangStatus({ status: 302, location: `${o}/aabn?t=1` }, o), 'ok');
  assert.equal(adgangStatus({ status: 302, location: 'https://andet.example.test/aabn' }, o), 'nede');
  assert.equal(adgangStatus({ status: 503, location: null }, o), 'nede');
  assert.equal(adgangStatus({ status: 404, location: null }, o), 'nede');
  assert.equal(adgangStatus(null, o), 'nedsat');
});

test('oprettelse: success rate and median time of the last 24 hours; none tried = the fleet is ready or not', () => {
  const klar = (startMin: number, sek: number) => ({ bestilt: min(startMin), klar: new Date(min(startMin).getTime() + sek * 1000), tilstand: 'klar' });
  assert.equal(oprettelseStatus({ forsoeg: [klar(60, 40), klar(30, 50)], flaadeKlar: true }, NU), 'ok');
  // Median over two minutes: slow, not down.
  assert.equal(oprettelseStatus({ forsoeg: [klar(60, 200), klar(30, 190)], flaadeKlar: true }, NU), 'nedsat');
  // One of four stuck past the two-minute budget: nedsat; most failing: nede.
  const fast = { bestilt: min(10), klar: null, tilstand: 'startet' };
  assert.equal(oprettelseStatus({ forsoeg: [klar(60, 40), klar(50, 40), klar(40, 40), fast], flaadeKlar: true }, NU), 'nedsat');
  assert.equal(oprettelseStatus({ forsoeg: [klar(60, 40), fast, fast], flaadeKlar: true }, NU), 'nede');
  // Still within its budget: not judged yet.
  assert.equal(oprettelseStatus({ forsoeg: [klar(60, 40), { bestilt: min(1), klar: null, tilstand: 'startet' }], flaadeKlar: true }, NU), 'ok');
  // Cancelled before it was ready (deleted): not a provisioning failure.
  assert.equal(oprettelseStatus({ forsoeg: [klar(60, 40), { bestilt: min(30), klar: null, tilstand: 'slettet' }], flaadeKlar: true }, NU), 'ok');
  assert.equal(oprettelseStatus({ forsoeg: [], flaadeKlar: true }, NU), 'ok');
  assert.equal(oprettelseStatus({ forsoeg: [], flaadeKlar: false }, NU), 'nede');
  assert.equal(oprettelseStatus(null, NU), 'nedsat');
});

test('sikkerhedskopi: share of scopes with a good copy within 36 hours; switched off or never run is never ok', () => {
  const s = (sidsteSucces: Date | null, siden = timer(100)) => ({ siden, sidsteSucces });
  assert.equal(kopiStatus({ slaaetTil: true, omfang: [s(timer(2)), s(timer(30))] }, NU), 'ok');
  // A scope newer than 36 hours has had no night yet: not overdue.
  assert.equal(kopiStatus({ slaaetTil: true, omfang: [s(timer(2)), s(null, timer(3))] }, NU), 'ok');
  const mange = Array.from({ length: 19 }, () => s(timer(2)));
  assert.equal(kopiStatus({ slaaetTil: true, omfang: [...mange, s(timer(40))] }, NU), 'nedsat');
  assert.equal(kopiStatus({ slaaetTil: true, omfang: [s(timer(40)), s(timer(2))] }, NU), 'nede');
  assert.equal(kopiStatus({ slaaetTil: false, omfang: [s(timer(2))] }, NU), 'nede');
  assert.equal(kopiStatus({ slaaetTil: true, omfang: [] }, NU), 'nedsat');
  assert.equal(kopiStatus(null, NU), 'nedsat');
});

test('mail: judged on the sends of the last 24 hours; a refused message is not an outage; no send at all is unknown', () => {
  const ok = (m: number) => ({ tid: min(m), ok: true, kode: null });
  const fejl = (m: number, kode: string) => ({ tid: min(m), ok: false, kode });
  assert.equal(mailStatus([ok(5), ok(50)], NU), 'ok');
  assert.equal(mailStatus([ok(5), fejl(10, 'afvist'), fejl(11, 'ugyldig')], NU), 'ok');
  assert.equal(mailStatus([ok(5), fejl(10, 'netvaerk')], NU), 'nedsat');
  assert.equal(mailStatus([fejl(1, 'udbyder'), ok(5)], NU), 'nedsat');
  assert.equal(mailStatus([fejl(1, 'noegle'), fejl(2, 'noegle'), fejl(3, 'ingen-udbyder'), ok(9)], NU), 'nede');
  // Older than a day: only the last result counts, and only an ok one keeps it ok.
  assert.equal(mailStatus([ok(60 * 30)], NU), 'ok');
  assert.equal(mailStatus([fejl(60 * 30, 'netvaerk')], NU), 'nedsat');
  assert.equal(mailStatus([], NU), 'nedsat');
  assert.equal(mailStatus(null, NU), 'nedsat');
});

test('the measured Post records each send\'s outcome (a code, never a recipient) and never changes the send itself', async () => {
  const noteret: { ok: boolean; kode: string | null }[] = [];
  const inde = falskPost();
  const p: Post = maaltPost(inde, async (r) => { noteret.push({ ok: r.ok, kode: r.kode }); }, () => NU);
  await p.send({ til: 'a@example.test', skabelon: 'alarm', data: { titel: 't', tekst: 'x' } });
  inde.fejl = true;
  await assert.rejects(p.send({ til: 'a@example.test', skabelon: 'alarm', data: { titel: 't', tekst: 'x' } }), PostFejl);
  // A recorder that fails never fails the send.
  inde.fejl = false;
  const q = maaltPost(inde, async () => { throw new Error('db nede'); }, () => NU);
  await q.send({ til: 'a@example.test', skabelon: 'alarm', data: { titel: 't', tekst: 'x' } });
  assert.deepEqual(noteret, [{ ok: true, kode: null }, { ok: false, kode: 'afvist' }]);
});

test('the canary probe asks Sky\'s own listener with the tenant\'s Host and never follows the redirect; no canary is null', async () => {
  const vaerter: string[] = [];
  const server = http.createServer((req, res) => {
    vaerter.push(req.headers.host ?? '');
    res.writeHead(302, { location: 'https://konto.example.test/aabn?t=x' });
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const port = (server.address() as { port: number }).port;
    const s = await adgangsProbe({ port, vaert: async () => 'hus-aaaaaaaa.example.test' })();
    assert.deepEqual(s, { status: 302, location: 'https://konto.example.test/aabn?t=x' });
    assert.deepEqual(vaerter, ['hus-aaaaaaaa.example.test']);
    assert.equal(await adgangsProbe({ port, vaert: async () => null })(), null);
  } finally { server.close(); }
  // Nothing listening: an answer Sky's gateway did not give, so nede (not unknown).
  const nede = await adgangsProbe({ port: 1, vaert: async () => 'hus-aaaaaaaa.example.test', timeoutMs: 500 })();
  assert.equal(adgangStatus(nede, 'https://konto.example.test'), 'nede');
});
