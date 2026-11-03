import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PostFejl, falskPost, ingenPost, type Besked, type FalskPost } from '../../src/delt/post.ts';
import { postFraEnv, standardAfsender } from '../../src/delt/post-udbyder.ts';

const BESKED: Besked = { til: 'a@example.test', skabelon: 'maillink', data: { link: 'https://konto.example.test/log-ind/link?t=x', kode: '4F7K-9Q2M', minutter: '15' } };
const NOEGLE = 're_abc123_def';
const PROD = { dev: false, basedomain: 'post.example.test' };
const DEV = { dev: true, basedomain: 'post.example.test' };

test('production without SKY_RESEND_API_KEY: every send refuses with PostFejl (fail closed), never the fake', async () => {
  for (const env of [{}, { SKY_RESEND_API_KEY: '' }, { SKY_RESEND_API_KEY: '   ' }]) {
    const p = postFraEnv(env, PROD);
    assert.ok(!('udbakke' in p), 'ingen udbakke i produktion');
    await assert.rejects(p.send(BESKED), (err: unknown) => err instanceof PostFejl && err.kode === 'ingen-udbyder' && /mailudbyder/.test(err.message));
  }
});

test('SKY_DEV=1 selects the fake (even with a key: development never sends real mail)', async () => {
  for (const env of [{}, { SKY_RESEND_API_KEY: NOEGLE }]) {
    const p = postFraEnv(env, DEV) as FalskPost;
    await p.send(BESKED);
    assert.equal(p.udbakke.length, 1);
  }
});

test('with a key in production, Resend is used (it reads the sending domain first)', async () => {
  const stier: string[] = [];
  const server = http.createServer((req, res) => { stier.push(`${req.method} ${req.url}`); res.writeHead(500); res.end('{}'); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const p = postFraEnv({ SKY_RESEND_API_KEY: NOEGLE }, PROD, { api, log: () => {} });
  await assert.rejects(p.send(BESKED), PostFejl);
  assert.deepEqual(stier, ['GET /domains']);
  await new Promise<void>((r) => server.close(() => r()));
});

test('the sender defaults to Clawco on the tenant domain, and a bad sender or key stops Sky naming only the key', () => {
  assert.equal(standardAfsender('post.example.test'), 'Clawco <hej@post.example.test>');
  postFraEnv({ SKY_RESEND_API_KEY: NOEGLE }, PROD);
  postFraEnv({ SKY_RESEND_API_KEY: NOEGLE, SKY_POST_AFSENDER: 'hej@post.example.test' }, PROD);
  postFraEnv({ SKY_RESEND_API_KEY: NOEGLE, SKY_POST_AFSENDER: 'Clawco Sky <hej@post.example.test>' }, PROD);
  for (const daarlig of ['ingen-snabel-a', 'Clawco <hej@post.example.test', 'Cl"aw <hej@post.example.test>', 'Clawco <hej@post.example.test>\r\nBcc: x@y.test', 'a <b@localhost>']) {
    assert.throws(() => postFraEnv({ SKY_RESEND_API_KEY: NOEGLE, SKY_POST_AFSENDER: daarlig }, PROD), (err: Error) => /SKY_POST_AFSENDER/.test(err.message) && !err.message.includes(daarlig));
  }
  for (const daarlig of ['sk_live_abc', 're_ med mellemrum', 'abc']) {
    assert.throws(() => postFraEnv({ SKY_RESEND_API_KEY: daarlig }, PROD), (err: Error) => /SKY_RESEND_API_KEY/.test(err.message) && !err.message.includes(daarlig));
  }
});

test('the fake renders every message too, so development fails on bad data like production does', async () => {
  const p = falskPost();
  await assert.rejects(p.send({ ...BESKED, data: {} }), (err: unknown) => err instanceof PostFejl && err.kode === 'ugyldig');
  assert.equal(p.udbakke.length, 0);
  p.fejl = true;
  await assert.rejects(p.send(BESKED), PostFejl);
  await assert.rejects(ingenPost().send(BESKED), PostFejl);
});

test('KC-0200: the fake checks reply-to and the unsubscribe link like production does', async () => {
  const p = falskPost();
  await assert.rejects(p.send({ ...BESKED, svarTil: 'a@example.test\nBcc: b@example.test' }), (err: unknown) => err instanceof PostFejl && err.kode === 'ugyldig');
  await assert.rejects(p.send({ ...BESKED, afmeld: 'javascript:alert(1)' }), (err: unknown) => err instanceof PostFejl && err.kode === 'ugyldig');
  await p.send({ ...BESKED, svarTil: 'kontakt@example.test', afmeld: 'https://konto.example.test/post/afmeld?t=x' });
  assert.equal(p.udbakke.length, 1);
});
