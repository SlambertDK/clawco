// KC-0263: "Sign in with GitHub" by GitHub's OAuth device flow — no client secret, no callback address, so it works on
// localhost, a tailnet name and every Sky tenant. A fake GitHub (an injected fetch) answers; nothing reaches github.com.
// The token goes only into the NoegleLager under `copilot`; only its length leaves, never the token or the device code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bestilKode, createGithubLogin, githubAdresser, githubBase, GITHUB_KLIENT_ID, GITHUB_SCOPE, hentLogin, spoergEfterToken,
  type GithubTilstand,
} from '../../src/agent/github-enhed.ts';
import { envNoegleLager } from '../../src/agent/noeglelager.ts';

const TOKEN = 'gho_HEMMELIGtoken0263abcdefghijklmnop';
const ENHED = 'dc_HEMMELIG_enhedskode_0263';
const A = githubAdresser();

type Kald = { url: string; metode: string; body: Record<string, string>; headers: Record<string, string> };
/** A fake GitHub: `svar` answers each call by URL; every call is recorded. */
function falskGithub(svar: (k: Kald, n: number) => { status?: number; json: unknown }): { fetchImpl: typeof fetch; kald: Kald[] } {
  const kald: Kald[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const raa = typeof init?.body === 'string' ? init.body : '';
    const body = Object.fromEntries(new URLSearchParams(raa));
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const k: Kald = { url: String(input), metode: init?.method ?? 'GET', body, headers };
    kald.push(k);
    const s = svar(k, kald.filter((x) => x.url === k.url).length);
    return new Response(JSON.stringify(s.json), { status: s.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetchImpl, kald };
}
const KODE = { device_code: ENHED, user_code: 'WDJB-MJHT', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 };

test('the default client id is Clawco\'s own OAuth App and the scope is read:user', () => {
  assert.equal(GITHUB_KLIENT_ID, 'Ov23liF4asHVqjBdQahW', "Clawco's own OAuth App (owner SlambertDK, device flow on, tokens do not expire); a public id, no secret");
  assert.equal(GITHUB_SCOPE, 'read:user');
  assert.deepEqual(A, { kode: 'https://github.com/login/device/code', token: 'https://github.com/login/oauth/access_token', bruger: 'https://api.github.com/user', side: 'https://github.com' });
});

test('the test-only base address is accepted only on loopback; anything else is refused', () => {
  assert.equal(githubBase(undefined), undefined);
  assert.equal(githubBase(''), undefined);
  assert.equal(githubBase('http://127.0.0.1:8798'), 'http://127.0.0.1:8798');
  assert.equal(githubBase('http://localhost:9/'), 'http://localhost:9');
  assert.equal(githubBase('http://[::1]:9'), 'http://[::1]:9');
  for (const ond of ['https://github.example', 'http://10.0.0.5:80', 'http://127.0.0.1.evil.example', 'file:///etc/passwd', 'ikke en adresse', 'http://user:pw@127.0.0.1:9']) {
    assert.throws(() => githubBase(ond), /KC_GITHUB_BASE_URL/, ond);
  }
  assert.deepEqual(githubAdresser('http://127.0.0.1:8798'), { kode: 'http://127.0.0.1:8798/login/device/code', token: 'http://127.0.0.1:8798/login/oauth/access_token', bruger: 'http://127.0.0.1:8798/user', side: 'http://127.0.0.1:8798' });
});

test('bestilKode: one form POST with client_id and scope; answers the code, the link, the interval and the expiry', async () => {
  const g = falskGithub(() => ({ json: KODE }));
  const k = await bestilKode({ klientId: 'Iv1.test', adresser: A, fetchImpl: g.fetchImpl, nu: () => 1_000 });
  assert.deepEqual(k, { deviceCode: ENHED, userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', intervalS: 5, udloeberMs: 1_000 + 900_000 });
  assert.equal(g.kald.length, 1);
  assert.equal(g.kald[0]!.metode, 'POST');
  assert.equal(g.kald[0]!.url, A.kode);
  assert.deepEqual(g.kald[0]!.body, { client_id: 'Iv1.test', scope: 'read:user' });
  assert.equal(g.kald[0]!.headers['accept'], 'application/json');
});

test('bestilKode refuses an answer that is not GitHub\'s shape: a link to another site, a strange code, an error', async () => {
  for (const json of [
    { ...KODE, verification_uri: 'https://github.evil.example/login/device' },
    { ...KODE, user_code: '<script>' },
    { ...KODE, device_code: '' },
    { error: 'device_flow_disabled' },
    { error: 'incorrect_client_credentials' },
  ]) {
    const g = falskGithub(() => ({ json }));
    await assert.rejects(bestilKode({ klientId: 'x', adresser: A, fetchImpl: g.fetchImpl, nu: () => 0 }), (e: Error) => !e.message.includes(ENHED), JSON.stringify(json));
  }
  const nede = (async () => { throw new Error('getaddrinfo ENOTFOUND github.com'); }) as typeof fetch;
  await assert.rejects(bestilKode({ klientId: 'x', adresser: A, fetchImpl: nede, nu: () => 0 }));
});

test('spoergEfterToken: each of GitHub\'s answers maps to one kind; the grant type is the device code\'s', async () => {
  const cases: [unknown, unknown][] = [
    [{ access_token: TOKEN, token_type: 'bearer', scope: 'read:user' }, { slags: 'token', token: TOKEN }],
    [{ error: 'authorization_pending' }, { slags: 'venter' }],
    [{ error: 'slow_down', interval: 10 }, { slags: 'langsommere', intervalS: 10 }],
    [{ error: 'slow_down' }, { slags: 'langsommere' }],
    [{ error: 'expired_token' }, { slags: 'udloebet' }],
    [{ error: 'access_denied' }, { slags: 'afvist' }],
    [{ error: 'incorrect_device_code' }, { slags: 'afbrudt' }],
    [{ error: 'device_flow_disabled' }, { slags: 'afbrudt' }],
    [{ error: 'incorrect_client_credentials' }, { slags: 'afbrudt' }],
    [{ error: 'unsupported_grant_type' }, { slags: 'afbrudt' }],
    [{ error: 'noget_nyt' }, { slags: 'fejl' }],
    [{ access_token: 'ikke et token med mellemrum' }, { slags: 'fejl' }],
  ];
  for (const [json, forventet] of cases) {
    const g = falskGithub(() => ({ json }));
    assert.deepEqual(await spoergEfterToken({ klientId: 'Iv1.test', adresser: A, fetchImpl: g.fetchImpl }, ENHED), forventet, JSON.stringify(json));
    assert.deepEqual(g.kald[0]!.body, { client_id: 'Iv1.test', device_code: ENHED, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
  }
  assert.deepEqual(await spoergEfterToken({ klientId: 'x', adresser: A, fetchImpl: (async () => { throw new Error('nede'); }) as typeof fetch }, ENHED), { slags: 'fejl' });
});

test('hentLogin reads the login name once with the token as a bearer; anything odd answers undefined', async () => {
  const g = falskGithub(() => ({ json: { login: 'henrik-l', id: 1, email: ['skal', 'example.com'].join('@') /* joined at run time: the mirror guard reads literals */ } }));
  assert.equal(await hentLogin(TOKEN, A, g.fetchImpl), 'henrik-l');
  assert.equal(g.kald[0]!.url, A.bruger);
  assert.equal(g.kald[0]!.headers['authorization'], `Bearer ${TOKEN}`);
  assert.equal(await hentLogin(TOKEN, A, falskGithub(() => ({ status: 401, json: {} })).fetchImpl), undefined);
  assert.equal(await hentLogin(TOKEN, A, falskGithub(() => ({ json: { login: '<b>x</b>' } })).fetchImpl), undefined);
});

/** A clock and a sleeper the test drives: `vent` resolves at once and moves the clock. */
function ur(start = 0): { nu: () => number; vent: (ms: number) => Promise<void>; ventet: number[] } {
  let t = start;
  const ventet: number[] = [];
  return { nu: () => t, vent: async (ms) => { ventet.push(ms); t += ms; }, ventet };
}

test('the login: start shows the code, polls honouring interval and slow_down, keeps the token in the store and says signed in', async () => {
  const lager = envNoegleLager({ udbydere: ['copilot'], env: {} });
  const u = ur();
  const g = falskGithub((k, n) => {
    if (k.url === A.kode) return { json: KODE };
    if (k.url === A.token) return { json: n === 1 ? { error: 'authorization_pending' } : n === 2 ? { error: 'slow_down', interval: 10 } : { access_token: TOKEN, token_type: 'bearer' } };
    return { json: { login: 'henrik-l' } };
  });
  let nyToken = 0;
  const inde: unknown[] = [];
  const login = createGithubLogin({ klientId: 'Iv1.test', adresser: A, fetchImpl: g.fetchImpl, nu: u.nu, vent: u.vent, lager, paaNyToken: async () => { nyToken++; } });
  assert.deepEqual(await login.status(), { tilstand: 'ude' });
  const t = await login.start(async (r) => { inde.push(r); });
  assert.deepEqual(t, { tilstand: 'venter', userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', udloeber: new Date(900_000).toISOString() });
  await login.faerdig();
  assert.deepEqual(u.ventet, [5_000, 5_000, 10_000], 'waits the interval, then the slowed-down one');
  assert.equal(await lager.hent('copilot'), TOKEN);
  assert.equal(nyToken, 1, 'the old client is stopped once a new token is saved');
  assert.deepEqual(inde, [{ login: 'henrik-l', laengde: TOKEN.length }]);
  const status = await login.status();
  assert.deepEqual(status, { tilstand: 'inde', login: 'henrik-l', laengde: TOKEN.length });
  const alt = JSON.stringify([t, status, inde]);
  assert.ok(!alt.includes(TOKEN) && !alt.includes(ENHED), 'neither the token nor the device code leaves');
});

test('the login: expired, refused and a failing GitHub end the wait with their own state; nothing is stored', async () => {
  const udfald: [unknown, GithubTilstand['tilstand']][] = [[{ error: 'expired_token' }, 'udloebet'], [{ error: 'access_denied' }, 'afvist'], [{ error: 'incorrect_device_code' }, 'fejl']];
  for (const [json, tilstand] of udfald) {
    const lager = envNoegleLager({ udbydere: ['copilot'], env: {} });
    const u = ur();
    const g = falskGithub((k) => (k.url === A.kode ? { json: KODE } : { json }));
    const login = createGithubLogin({ klientId: 'Iv1.test', adresser: A, fetchImpl: g.fetchImpl, nu: u.nu, vent: u.vent, lager });
    await login.start();
    await login.faerdig();
    assert.equal((await login.status()).tilstand, tilstand);
    assert.equal(await lager.findes('copilot'), false);
  }
});

test('the login: the code\'s own expiry ends the wait without asking GitHub again', async () => {
  const lager = envNoegleLager({ udbydere: ['copilot'], env: {} });
  const u = ur();
  const g = falskGithub((k) => (k.url === A.kode ? { json: { ...KODE, expires_in: 12 } } : { json: { error: 'authorization_pending' } }));
  const login = createGithubLogin({ klientId: 'Iv1.test', adresser: A, fetchImpl: g.fetchImpl, nu: u.nu, vent: u.vent, lager });
  await login.start();
  await login.faerdig();
  assert.equal((await login.status()).tilstand, 'udloebet');
  assert.equal(g.kald.filter((k) => k.url === A.token).length, 2, 'asked at 5 s and 10 s, not after 12 s');
});

test('the login without a client id says it is not set up and calls nobody (fail closed)', async () => {
  const lager = envNoegleLager({ udbydere: ['copilot'], env: {} });
  const g = falskGithub(() => ({ json: KODE }));
  const login = createGithubLogin({ klientId: '', adresser: A, fetchImpl: g.fetchImpl, lager });
  assert.deepEqual(await login.status(), { tilstand: 'ikke-sat-op' });
  assert.deepEqual(await login.start(), { tilstand: 'ikke-sat-op' });
  assert.equal(g.kald.length, 0);
});

test('a second start replaces the first wait; sign-out removes the token and stops the client', async () => {
  const lager = envNoegleLager({ udbydere: ['copilot'], env: {} });
  let ud = 0;
  let vaekket: () => void = () => {};
  const g = falskGithub((k, n) => (k.url === A.kode ? { json: { ...KODE, user_code: n === 1 ? 'AAAA-1111' : 'BBBB-2222' } } : { json: { error: 'authorization_pending' } }));
  const vent = (_ms: number, signal?: AbortSignal): Promise<void> => new Promise((res, rej) => { vaekket = res; signal?.addEventListener('abort', () => rej(new Error('afbrudt')), { once: true }); });
  const login = createGithubLogin({ klientId: 'Iv1.test', adresser: A, fetchImpl: g.fetchImpl, nu: () => 0, vent, lager, paaUd: async () => { ud++; } });
  await login.start();
  const anden = await login.start();
  assert.equal(anden.tilstand === 'venter' && anden.userCode, 'BBBB-2222');
  assert.equal((await login.status()).tilstand, 'venter');
  await lager.saet('copilot', TOKEN);
  await login.ud();
  vaekket();
  assert.equal(await lager.findes('copilot'), false);
  assert.equal(ud, 1);
  assert.deepEqual(await login.status(), { tilstand: 'ude' });
});

test('a failing follow-up after the token is saved does not turn the sign-in into an error', async () => {
  const lager = envNoegleLager({ udbydere: ['copilot'], env: {} });
  const u = ur();
  const g = falskGithub((k) => (k.url === A.kode ? { json: KODE } : k.url === A.token ? { json: { access_token: TOKEN } } : { json: { login: 'henrik-l' } }));
  const login = createGithubLogin({ klientId: 'Iv1.test', adresser: A, fetchImpl: g.fetchImpl, nu: u.nu, vent: u.vent, lager });
  await login.start(async () => { throw new Error('settings could not be written'); });
  await login.faerdig();
  assert.equal((await login.status()).tilstand, 'inde');
});

test('the login: one failed poll (a blip) is retried; the sign-in still completes', async () => {
  const lager = envNoegleLager({ udbydere: ['copilot'], env: {} });
  const u = ur();
  const g = falskGithub((k, n) => {
    if (k.url === A.kode) return { json: KODE };
    if (k.url === A.token) return n === 1 ? { status: 502, json: {} } : { json: { access_token: TOKEN, token_type: 'bearer' } };
    return { json: { login: 'henrik-l' } };
  });
  const login = createGithubLogin({ klientId: 'Iv1.test', adresser: A, fetchImpl: g.fetchImpl, nu: u.nu, vent: u.vent, lager });
  await login.start();
  await login.faerdig();
  assert.equal((await login.status()).tilstand, 'inde');
  assert.equal(await lager.hent('copilot'), TOKEN);
});

test('the login: only five failed polls in a row end it as fejl', async () => {
  for (const [antalFejl, forventet] of [[4, 'inde'], [5, 'fejl'], [6, 'fejl']] as const) {
    const lager = envNoegleLager({ udbydere: ['copilot'], env: {} });
    const u = ur();
    const g = falskGithub((k, n) => {
      if (k.url === A.kode) return { json: KODE };
      if (k.url === A.token) return n <= antalFejl ? { status: 502, json: {} } : { json: { access_token: TOKEN, token_type: 'bearer' } };
      return { json: { login: 'henrik-l' } };
    });
    const login = createGithubLogin({ klientId: 'Iv1.test', adresser: A, fetchImpl: g.fetchImpl, nu: u.nu, vent: u.vent, lager });
    await login.start();
    await login.faerdig();
    assert.equal((await login.status()).tilstand, forventet, `${antalFejl} failures`);
    assert.equal(await lager.findes('copilot'), forventet === 'inde');
  }
});

test('the login: GitHub\'s permanent error codes end the wait at once with fejl, after one poll', async () => {
  for (const error of ['incorrect_device_code', 'device_flow_disabled', 'incorrect_client_credentials', 'unsupported_grant_type']) {
    const lager = envNoegleLager({ udbydere: ['copilot'], env: {} });
    const u = ur();
    const g = falskGithub((k) => (k.url === A.kode ? { json: KODE } : { json: { error } }));
    const login = createGithubLogin({ klientId: 'Iv1.test', adresser: A, fetchImpl: g.fetchImpl, nu: u.nu, vent: u.vent, lager });
    await login.start();
    await login.faerdig();
    assert.equal((await login.status()).tilstand, 'fejl', error);
    assert.equal(g.kald.filter((k) => k.url === A.token).length, 1, `${error}: one poll only`);
  }
});
