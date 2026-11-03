// KC-0265: Clawco's AI included in a Sky plan, the tenant's side. The proxy address (KC_MODEL_PROXY_URL) must be https
// (http only on loopback, for the local check), the bearer token (KC_MODEL_TOKEN_FIL, a file that may appear after boot) is
// read at call time and fails closed while missing, the meter (/v1/forbrug) is read with that token and cached briefly, and
// what the proxy answered on a run (402 used up, 503 unavailable) is remembered until it no longer holds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { INKLUDERET_ID, createInkluderet, inkluderetFraMiljoe, medInkluderetToken, proxyAdresse } from '../../src/agent/inkluderet.ts';
import { envNoegleLager } from '../../src/agent/noeglelager.ts';

const TOKEN = 'kc-model-HEMMELIG-0265-abcdef';
const BASE = 'https://konto.example.test/model';

async function mappe(): Promise<{ dir: string; fil: string; ryd: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-inkl-'));
  return { dir, fil: path.join(dir, 'model-token'), ryd: () => rm(dir, { recursive: true, force: true }) };
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('proxyAdresse: https is taken (trailing slashes cut); http only on loopback; credentials, query and other schemes refused', () => {
  assert.equal(proxyAdresse('https://konto.clawco.work/model'), 'https://konto.clawco.work/model');
  assert.equal(proxyAdresse('https://konto.clawco.work/model///'), 'https://konto.clawco.work/model');
  assert.equal(proxyAdresse('http://127.0.0.1:8803'), 'http://127.0.0.1:8803');
  assert.equal(proxyAdresse('http://localhost:8803/model'), 'http://localhost:8803/model');
  for (const daarlig of ['http://konto.clawco.work/model', 'ftp://x.test/model', 'https://u:p@x.test/model', 'https://x.test/model?a=1', 'https://x.test/model#h', 'ikke en adresse', '']) {
    assert.equal(proxyAdresse(daarlig), null, daarlig);
  }
});

test('inkluderetFraMiljoe: offered only when both values are set; a bad address refuses to start naming the key, never the value', () => {
  assert.equal(inkluderetFraMiljoe({}), undefined);
  assert.equal(inkluderetFraMiljoe({ KC_MODEL_PROXY_URL: BASE }), undefined, 'the address alone is not enough');
  assert.equal(inkluderetFraMiljoe({ KC_MODEL_TOKEN_FIL: '/x/model-token' }), undefined, 'nor the token file alone');
  assert.equal(inkluderetFraMiljoe({ KC_MODEL_PROXY_URL: '  ', KC_MODEL_TOKEN_FIL: '/x/t' }), undefined);
  const ink = inkluderetFraMiljoe({ KC_MODEL_PROXY_URL: BASE, KC_MODEL_TOKEN_FIL: '/x/model-token' });
  assert.equal(ink?.baseUrl, BASE);
  assert.equal(ink?.udbyder, INKLUDERET_ID);
  assert.throws(() => inkluderetFraMiljoe({ KC_MODEL_PROXY_URL: 'http://hemmelig.example.test/model', KC_MODEL_TOKEN_FIL: '/x/t' }), (e: Error) => /KC_MODEL_PROXY_URL/.test(e.message) && !e.message.includes('hemmelig.example'));
});

test('token: read at call time (it may appear after boot), trimmed, fail closed on missing, empty or odd content; handed to the redactor', async () => {
  const m = await mappe();
  try {
    const set: string[] = [];
    const ink = createInkluderet({ proxyUrl: BASE, tokenFil: m.fil, registrer: (v) => { set.push(v); } });
    assert.equal(await ink.token(), undefined, 'no file yet: closed');
    await writeFile(m.fil, '   \n');
    assert.equal(await ink.token(), undefined, 'empty: closed');
    await writeFile(m.fil, `${TOKEN}\n`);
    assert.equal(await ink.token(), TOKEN, 'the file appeared: read now, no restart');
    assert.deepEqual(set, [TOKEN]);
    await writeFile(m.fil, `${TOKEN}\nextra: header`);
    assert.equal(await ink.token(), undefined, 'a token with a line break would be a header injection: closed');
    await writeFile(m.fil, 'x'.repeat(5000));
    assert.equal(await ink.token(), undefined, 'implausibly long: closed');
    await writeFile(m.fil, 'ny-token-1234567890');
    assert.equal(await ink.token(), 'ny-token-1234567890', 'a rotated token is read at once');
  } finally { await m.ryd(); }
});

test('medInkluderetToken: the NoegleLager seam answers the included provider from the file; it can neither be saved nor removed; others pass through', async () => {
  const m = await mappe();
  try {
    const ink = createInkluderet({ proxyUrl: BASE, tokenFil: m.fil });
    const under = envNoegleLager({ udbydere: ['anthropic'], env: { KC_MODEL_NOEGLE_ANTHROPIC: 'sk-ant-x' } });
    const lager = medInkluderetToken(under, ink);
    assert.equal(await lager.findes(INKLUDERET_ID), false);
    assert.equal(await lager.hent(INKLUDERET_ID), undefined);
    await writeFile(m.fil, TOKEN);
    assert.equal(await lager.findes(INKLUDERET_ID), true);
    assert.equal(await lager.hent(INKLUDERET_ID), TOKEN);
    await assert.rejects(lager.saet(INKLUDERET_ID, 'andet-token'), (e: Error) => !e.message.includes('andet-token'));
    await lager.fjern(INKLUDERET_ID);
    assert.equal(await lager.hent(INKLUDERET_ID), TOKEN, 'removing is a no-op: the file is Sky\'s');
    assert.equal(await lager.hent('anthropic'), 'sk-ant-x');
    await lager.saet('anthropic', 'sk-ant-y');
    assert.equal(await lager.hent('anthropic'), 'sk-ant-y');
  } finally { await m.ryd(); }
});

test('forbrug: GET /v1/forbrug with the bearer token; the shape is validated, the models are not kept; cached briefly; closed without a token', async () => {
  const m = await mappe();
  try {
    const kald: { url: string; auth: string | null }[] = [];
    let procent = 12;
    let tid = 1_000_000;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      kald.push({ url: String(input), auth: new Headers(init?.headers).get('authorization') });
      assert.equal(init?.redirect, 'error', 'the token is not sent along a redirect');
      return json(200, { brugtMikroUsd: 480000, loftMikroUsd: 4000000, procent, nulstilles: '2026-12-01', modeller: ['claude-haiku-5-5'] });
    }) as typeof fetch;
    const ink = createInkluderet({ proxyUrl: BASE, tokenFil: m.fil, fetchImpl, nu: () => new Date(tid), cacheMs: 30_000 });
    assert.equal(await ink.forbrug(), undefined, 'no token: nothing is asked');
    assert.equal(kald.length, 0);
    await writeFile(m.fil, TOKEN);
    const f = await ink.forbrug();
    assert.deepEqual(f, { procent: 12, nulstilles: '2026-12-01' }, 'no model names, no amounts');
    assert.equal(kald[0]?.url, `${BASE}/v1/forbrug`);
    assert.equal(kald[0]?.auth, `Bearer ${TOKEN}`);
    procent = 50;
    tid += 10_000;
    assert.equal((await ink.forbrug())?.procent, 12, 'cached');
    assert.equal(kald.length, 1);
    tid += 25_000;
    assert.equal((await ink.forbrug())?.procent, 50, 'asked again after the cache');
    assert.equal(kald.length, 2);
  } finally { await m.ryd(); }
});

test('forbrug: a refusal, a broken answer or a network error reads as unknown (undefined), never throws, and is remembered only briefly', async () => {
  const m = await mappe();
  try {
    await writeFile(m.fil, TOKEN);
    let tid = 5_000_000;
    let svar: () => Response | Promise<Response> = () => json(401, { error: { type: 'ugyldig_noegle' } });
    let antal = 0;
    const fetchImpl = (async () => { antal += 1; return svar(); }) as typeof fetch;
    const ink = createInkluderet({ proxyUrl: BASE, tokenFil: m.fil, fetchImpl, nu: () => new Date(tid), cacheMs: 30_000 });
    assert.equal(await ink.forbrug(), undefined);
    for (const daarligt of [() => json(200, { procent: 'meget' }), () => json(200, { procent: 5, nulstilles: 'i morgen' }), () => json(200, 'ikke et objekt'), () => { throw new Error(`ECONNREFUSED ${TOKEN}`); }]) {
      tid += 11_000;
      svar = daarligt as never;
      assert.equal(await ink.forbrug(), undefined);
    }
    tid += 11_000;
    svar = () => json(200, { procent: 7, nulstilles: '2026-12-01' });
    assert.deepEqual(await ink.forbrug(), { procent: 7, nulstilles: '2026-12-01' }, 'a failure is not held for the full cache');
    assert.ok(antal >= 5);
  } finally { await m.ryd(); }
});

test('used up: a 402 on a run is remembered until the reset date; a good run or the date clears it; the meter at 100 % says it too', async () => {
  const m = await mappe();
  try {
    await writeFile(m.fil, TOKEN);
    let tid = Date.parse('2026-11-20T10:00:00Z');
    let procent = 40;
    const fetchImpl = (async () => json(200, { procent, nulstilles: '2026-12-01' })) as typeof fetch;
    const ink = createInkluderet({ proxyUrl: BASE, tokenFil: m.fil, fetchImpl, nu: () => new Date(tid), cacheMs: 30_000 });
    let aendringer = 0;
    ink.lyt(() => { aendringer += 1; });
    assert.equal(await ink.brugt(), undefined);
    await ink.forbrug();
    ink.noter({ art: 'kvote', nulstilles: '2026-12-01' });
    assert.equal(aendringer, 1);
    assert.deepEqual(await ink.brugt(), { nulstilles: '2026-12-01' }, 'the 402 wins at once, though the cached meter said 40 %');
    tid = Date.parse('2026-12-01T00:00:01Z');
    assert.equal(await ink.brugt(), undefined, 'the reset date has come: the card is gone');
    ink.noter({ art: 'kvote', nulstilles: '2026-12-31' });
    ink.noter({ art: 'ok' });
    assert.equal(await ink.brugt(), undefined, 'a run that went through clears it');
    ink.noter({ art: 'kvote' });
    assert.deepEqual(await ink.brugt(), {}, 'no date given: used up, the date unknown');
    ink.noter({ art: 'ok' });
    procent = 100;
    tid += 40_000;
    assert.deepEqual(await ink.brugt(), { nulstilles: '2026-12-01' }, 'the meter at 100 % is used up too');
    ink.noter({ art: 'kvote', nulstilles: 'ikke-en-dato' });
    ink.noter({ art: 'ok' });
    assert.ok(aendringer >= 4);
  } finally { await m.ryd(); }
});

test('unavailable: a 503 is remembered for a minute and cleared by a good run', () => {
  let tid = 1_000_000;
  const ink = createInkluderet({ proxyUrl: BASE, tokenFil: '/findes/ikke', nu: () => new Date(tid) });
  assert.equal(ink.utilgaengelig(), false);
  ink.noter({ art: 'utilgaengelig' });
  assert.equal(ink.utilgaengelig(), true);
  tid += 59_000;
  assert.equal(ink.utilgaengelig(), true);
  tid += 2_000;
  assert.equal(ink.utilgaengelig(), false, 'a minute later it is not held against the next try');
  ink.noter({ art: 'utilgaengelig' });
  ink.noter({ art: 'ok' });
  assert.equal(ink.utilgaengelig(), false);
});
