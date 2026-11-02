import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { resendPost, maskerModtager, DOMAENE_CACHE_MS } from '../../src/delt/post-udbyder.ts';
import { PostFejl, type Besked } from '../../src/delt/post.ts';

const NOEGLE = 're_test_hemmelig_noegle_123';
const AFSENDER = 'Clawco <hej@post.example.test>';
const LINK = 'https://konto.example.test/log-ind/link?t=hemmeligt_token';
const BESKED: Besked = { til: 'henrik@modtager.example.test', skabelon: 'maillink', data: { link: LINK, minutter: '15' } };

type Kald = { metode: string; sti: string; headers: http.IncomingHttpHeaders; krop: string };
type Svar = { status: number; krop: unknown };
type Domaene = { id: string; name: string; status: string; region: string; open_tracking?: boolean; click_tracking?: boolean };

const GOD: Domaene = { id: 'd-1', name: 'post.example.test', status: 'verified', region: 'eu-west-1', open_tracking: false, click_tracking: false };

// Every stand-in closes at the end even when a test fails half-way (an open server would hang the run).
const aabne = new Set<http.Server>();
after(() => { for (const s of aabne) { s.closeAllConnections(); s.close(); } });

/** A stand-in for Resend's API on 127.0.0.1: answers from a table the test controls, records every call. */
async function falskResend(o: { domaene?: Domaene | null; domaener?: Svar; send?: Svar } = {}) {
  const kald: Kald[] = [];
  const tilstand = { domaene: o.domaene === undefined ? GOD : o.domaene, domaener: o.domaener, send: o.send ?? { status: 200, krop: { id: 'e-1' } } };
  const server = http.createServer((req, res) => {
    let krop = '';
    req.on('data', (c) => { krop += c; });
    req.on('end', () => {
      kald.push({ metode: req.method ?? '', sti: req.url ?? '', headers: req.headers, krop });
      const svar = (s: Svar) => { res.writeHead(s.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(s.krop)); };
      const d = tilstand.domaene;
      if (req.method === 'GET' && req.url === '/domains') {
        return svar(tilstand.domaener ?? { status: 200, krop: { object: 'list', data: d ? [{ id: d.id, name: d.name, status: d.status, region: d.region }] : [] } });
      }
      if (req.method === 'GET' && d && req.url === `/domains/${d.id}`) return svar({ status: 200, krop: { object: 'domain', ...d } });
      if (req.method === 'POST' && req.url === '/emails') return svar(tilstand.send);
      svar({ status: 404, krop: { name: 'not_found', message: 'nope' } });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  aabne.add(server);
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { api, kald, tilstand, luk: () => new Promise<void>((r) => { aabne.delete(server); server.closeAllConnections(); server.close(() => r()); }) };
}

function opsaet(api: string, ekstra: { nu?: () => number } = {}) {
  const log: string[] = [];
  const post = resendPost({ noegle: NOEGLE, afsender: AFSENDER, api, log: (l) => log.push(l), ...ekstra });
  return { post, log };
}

async function fejlKode(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (err) {
    assert.ok(err instanceof PostFejl, `forventede PostFejl, fik ${String(err)}`);
    assert.ok(!err.message.includes(LINK) && !err.message.includes('hemmeligt_token'), 'fejlen indeholder linket');
    assert.ok(!err.message.includes(BESKED.til), 'fejlen indeholder modtageren');
    assert.ok(!err.message.includes(NOEGLE), 'fejlen indeholder nøglen');
    return err.kode;
  }
  assert.fail('send skulle have fejlet');
}

test('a send checks the domain, then posts one message with the key in the header only', async () => {
  const r = await falskResend();
  const { post } = opsaet(r.api);
  await post.send(BESKED);
  assert.deepEqual(r.kald.map((k) => `${k.metode} ${k.sti}`), ['GET /domains', 'GET /domains/d-1', 'POST /emails']);
  for (const k of r.kald) {
    assert.equal(k.headers.authorization, `Bearer ${NOEGLE}`);
    assert.ok(!k.sti.includes(NOEGLE) && !k.krop.includes(NOEGLE), 'nøglen står kun i headeren');
  }
  const send = r.kald[2]!;
  assert.match(String(send.headers['content-type']), /application\/json/);
  assert.match(String(send.headers['idempotency-key']), /^[0-9a-f-]{36}$/);
  const krop = JSON.parse(send.krop) as Record<string, unknown>;
  assert.deepEqual(Object.keys(krop).sort(), ['from', 'html', 'subject', 'text', 'to']);
  assert.equal(krop['from'], AFSENDER);
  assert.deepEqual(krop['to'], [BESKED.til]);
  assert.match(String(krop['subject']), /Clawco/);
  assert.ok(String(krop['text']).includes(LINK));
  assert.doesNotMatch(String(krop['html']), /<img/i);
  await r.luk();
});

test('the domain check is cached for a while, then read again', async () => {
  const r = await falskResend();
  let t = 1_000_000;
  const { post } = opsaet(r.api, { nu: () => t });
  await post.send(BESKED);
  await post.send(BESKED);
  assert.equal(r.kald.filter((k) => k.sti.startsWith('/domains')).length, 2);
  t += DOMAENE_CACHE_MS + 1;
  r.tilstand.domaene = { ...GOD, click_tracking: true };
  assert.equal(await fejlKode(post.send(BESKED)), 'sporing');
  await r.luk();
});

test('tracking on the domain (open or click) refuses the send: nothing is posted', async () => {
  for (const d of [{ ...GOD, open_tracking: true }, { ...GOD, click_tracking: true }]) {
    const r = await falskResend({ domaene: d });
    assert.equal(await fejlKode(opsaet(r.api).post.send(BESKED)), 'sporing');
    assert.ok(!r.kald.some((k) => k.metode === 'POST'));
    await r.luk();
  }
});

test('a domain outside the EU region, unverified or missing refuses the send', async () => {
  const tilfaelde: [Domaene | null, string][] = [
    [{ ...GOD, region: 'us-east-1' }, 'region'],
    [{ ...GOD, status: 'pending' }, 'domaene'],
    [null, 'domaene'],
  ];
  for (const [d, kode] of tilfaelde) {
    const r = await falskResend({ domaene: d });
    assert.equal(await fejlKode(opsaet(r.api).post.send(BESKED)), kode);
    assert.ok(!r.kald.some((k) => k.metode === 'POST'));
    await r.luk();
  }
});

test('a sending-only key cannot prove tracking is off, so it refuses; a failed check is not cached', async () => {
  const r = await falskResend({ domaener: { status: 401, krop: { statusCode: 401, name: 'restricted_api_key', message: 'This API key is restricted to only send emails' } } });
  const { post } = opsaet(r.api);
  assert.equal(await fejlKode(post.send(BESKED)), 'noegle');
  r.tilstand.domaener = undefined;
  await post.send(BESKED);
  assert.ok(r.kald.some((k) => k.metode === 'POST'));
  await r.luk();
});

test('an invalid key on the domain lookup (Resend answers 400 validation_error there) is a key failure', async () => {
  const r = await falskResend({ domaener: { status: 400, krop: { statusCode: 400, name: 'validation_error', message: 'API key is invalid' } } });
  assert.equal(await fejlKode(opsaet(r.api).post.send(BESKED)), 'noegle');
  await r.luk();
});

test('provider errors map to typed failures, never echoing the provider\'s text', async () => {
  const ekko = `Invalid \`to\` field near ${LINK} for ${BESKED.til}`;
  const tilfaelde: [number, string, string][] = [
    [401, 'validation_error', 'noegle'],
    [403, 'validation_error', 'afvist'],
    [422, 'missing_required_field', 'afvist'],
    [429, 'rate_limit_exceeded', 'kvote'],
    [500, 'application_error', 'udbyder'],
    [503, 'service_unavailable', 'udbyder'],
  ];
  for (const [status, name, kode] of tilfaelde) {
    const r = await falskResend({ send: { status, krop: { statusCode: status, name, message: ekko } } });
    assert.equal(await fejlKode(opsaet(r.api).post.send(BESKED)), kode, `${status} ${name}`);
    await r.luk();
  }
  // A 200 without an id is not an accepted message.
  const r = await falskResend({ send: { status: 200, krop: {} } });
  assert.equal(await fejlKode(opsaet(r.api).post.send(BESKED)), 'udbyder');
  await r.luk();
});

test('an unreachable provider is a network failure', async () => {
  const r = await falskResend();
  await r.luk();
  assert.equal(await fejlKode(opsaet(r.api).post.send(BESKED)), 'netvaerk');
});

test('bad template data never reaches the provider', async () => {
  const r = await falskResend();
  assert.equal(await fejlKode(opsaet(r.api).post.send({ ...BESKED, data: { link: 'javascript:x', minutter: '15' } })), 'ugyldig');
  assert.equal(r.kald.length, 0);
  await r.luk();
});

test('logs name the template and a masked recipient, never the address or the link', async () => {
  const r = await falskResend();
  const { post, log } = opsaet(r.api);
  await post.send(BESKED);
  r.tilstand.send = { status: 500, krop: { name: 'application_error', message: LINK } };
  await assert.rejects(post.send(BESKED));
  await r.luk();
  assert.equal(log.length, 2);
  for (const l of log) {
    assert.match(l, /maillink/);
    assert.ok(l.includes('h…@modtager.example.test'), l);
    assert.ok(!l.includes(BESKED.til) && !l.includes('hemmeligt_token') && !l.includes(NOEGLE), l);
  }
});

test('masking keeps the first character and the domain only', () => {
  assert.equal(maskerModtager('henrik@example.test'), 'h…@example.test');
  assert.equal(maskerModtager('ikke-en-adresse'), '…');
});

// KC-0200: a reply-to that reaches support on the welcome mails, and RFC 8058 one-click unsubscribe on the tips mail only.
test('reply-to and List-Unsubscribe reach Resend only when the message carries them', async () => {
  const r = await falskResend();
  const { post } = opsaet(r.api);
  const AFMELD = 'https://konto.example.test/post/afmeld?t=hemmeligt_afmeld';
  await post.send(BESKED);
  await post.send({ ...BESKED, svarTil: 'kontakt@hjaelp.example.test' });
  await post.send({ ...BESKED, svarTil: 'kontakt@hjaelp.example.test', afmeld: AFMELD });
  const kroppe = r.kald.filter((k) => k.metode === 'POST').map((k) => JSON.parse(k.krop) as Record<string, unknown>);
  assert.equal(kroppe.length, 3);
  assert.ok(!('reply_to' in kroppe[0]!) && !('headers' in kroppe[0]!), 'an ordinary mail has neither');
  assert.equal(kroppe[1]!['reply_to'], 'kontakt@hjaelp.example.test');
  assert.ok(!('headers' in kroppe[1]!), 'no unsubscribe header without an unsubscribe link');
  assert.deepEqual(kroppe[2]!['headers'], { 'List-Unsubscribe': `<${AFMELD}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
  await r.luk();
});

test('a reply-to that is not one address, or an unsubscribe link that is not https, is refused before Resend is asked', async () => {
  const r = await falskResend();
  const { post } = opsaet(r.api);
  for (const b of [
    { ...BESKED, svarTil: 'kontakt@hjaelp.example.test\r\nBcc: x@example.test' },
    { ...BESKED, svarTil: 'ikke en adresse' },
    { ...BESKED, afmeld: 'http://evil.example.test/afmeld' },
    { ...BESKED, afmeld: 'https://konto.example.test/a>b' },
  ]) assert.equal(await fejlKode(post.send(b)), 'ugyldig');
  assert.ok(!r.kald.some((k) => k.metode === 'POST'));
  await r.luk();
});
