// KC-0094: what the service worker answers when Kontrolcenter cannot be reached. Only a page
// navigation gets the calm offline page; everything else is left to the browser, so no room
// content and no app.js is ever served from a cache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../public/sw-logik.js';

type Req = { mode: string; method: string };
type Svar = { status: number };
type SW = {
  OFFLINE_SIDE: string;
  erSideskift(r: Req): boolean;
  svar(r: Req, hent: (r: Req) => Promise<Svar>, offline: () => Promise<Svar | undefined>): Promise<Svar | undefined> | null;
};
const KC = (globalThis as unknown as { KCSw: SW }).KCSw;

const side: Req = { mode: 'navigate', method: 'GET' };
const OK = { status: 200 };
const OFFLINE = { status: 200, offline: true };

test('the offline page lives at /uden-forbindelse', () => {
  assert.equal(KC.OFFLINE_SIDE, '/uden-forbindelse');
});

test('only a GET page navigation is ours to answer', () => {
  assert.equal(KC.erSideskift(side), true);
  assert.equal(KC.erSideskift({ mode: 'navigate', method: 'POST' }), false);
  for (const mode of ['cors', 'no-cors', 'same-origin']) assert.equal(KC.erSideskift({ mode, method: 'GET' }), false, mode);
});

test('a failed navigation gets the offline page', async () => {
  const r = await KC.svar(side, () => Promise.reject(new TypeError('Failed to fetch')), () => Promise.resolve(OFFLINE));
  assert.deepEqual(r, OFFLINE);
});

test('a reachable server wins: the network answer is returned and the cache is never asked', async () => {
  let spurgt = 0;
  const r = await KC.svar(side, () => Promise.resolve(OK), () => { spurgt++; return Promise.resolve(OFFLINE); });
  assert.equal(r, OK);
  assert.equal(spurgt, 0);
});

test('a gateway error while the service restarts (502-504) also gets the offline page', async () => {
  for (const status of [502, 503, 504]) {
    const r = await KC.svar(side, () => Promise.resolve({ status }), () => Promise.resolve(OFFLINE));
    assert.deepEqual(r, OFFLINE, String(status));
  }
});

test('any other status (a real 404 or 500 from the app) is shown as it is', async () => {
  for (const status of [404, 500]) {
    const r = await KC.svar(side, () => Promise.resolve({ status }), () => Promise.resolve(OFFLINE));
    assert.deepEqual(r, { status }, String(status));
  }
});

test('with no cached offline page the original failure stays a failure', async () => {
  await assert.rejects(KC.svar(side, () => Promise.reject(new TypeError('x')), () => Promise.resolve(undefined)) as Promise<unknown>);
});

test('non-navigation requests are left alone: no answer, the network is not touched', () => {
  let rort = 0;
  const hent = () => { rort++; return Promise.resolve(OK); };
  for (const r of [{ mode: 'cors', method: 'GET' }, { mode: 'same-origin', method: 'GET' }, { mode: 'navigate', method: 'POST' }]) {
    assert.equal(KC.svar(r, hent, () => Promise.resolve(OFFLINE)), null);
  }
  assert.equal(rort, 0);
});
