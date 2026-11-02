// KC-0161: the Tailscale state as the card in Start needs it. The state is a
// pure function of what the local CLI printed; the runner is injected, so no
// test ever calls a real binary. Invariants: the app never throws into a page
// when the CLI misbehaves ("ukendt"), runs only the three allow-listed
// commands, and can never reach Funnel (public exposure is forbidden).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TS_TILSTANDE, delArgv, delPaaTailnet, laesTailscale, lavTsKoerer, sikkerKoerer, tilstandAf,
  type TsExecFile, type TsKoerer, type TsSvar,
} from '../src/shell/tailscale.ts';

const PORT = 8750;
const KLAR = { BackendState: 'Running', Self: { DNSName: 'laptop.example.ts.net.' } };
const SERVE_DELT = {
  TCP: { '443': { HTTPS: true } },
  Web: { 'laptop.example.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:8750' } } } },
};
const raa = (status: unknown, serve: unknown = {}) => ({ fundet: true as const, status, serve });
const o = { port: PORT, laptop: false };

test('the states are the ones the card knows, laptop included', () => {
  assert.deepEqual([...TS_TILSTANDE], ['mangler', 'ikke-logget-ind', 'slukket', 'klar', 'delt', 'laptop', 'ukendt']);
});

test('mangler: no binary found', () => {
  assert.equal(tilstandAf({ fundet: false }, o).tilstand, 'mangler');
});

test('ikke-logget-ind: NeedsLogin and NoState; slukket: Stopped', () => {
  assert.equal(tilstandAf(raa({ BackendState: 'NeedsLogin' }), o).tilstand, 'ikke-logget-ind');
  assert.equal(tilstandAf(raa({ BackendState: 'NoState' }), o).tilstand, 'ikke-logget-ind');
  assert.equal(tilstandAf(raa({ BackendState: 'Stopped' }), o).tilstand, 'slukket');
});

test('klar: running and nothing serves the app port', () => {
  assert.equal(tilstandAf(raa(KLAR, {}), o).tilstand, 'klar');
  // another app on another port is not Clawco
  const andet = { TCP: { '443': { HTTPS: true } }, Web: { 'laptop.example.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } } } } };
  assert.equal(tilstandAf(raa(KLAR, andet), o).tilstand, 'klar');
  // a proxy to some other machine on the same port is not Clawco either
  const fremmed = { TCP: { '443': { HTTPS: true } }, Web: { 'laptop.example.ts.net:443': { Handlers: { '/': { Proxy: 'http://192.0.2.5:8750' } } } } };
  assert.equal(tilstandAf(raa(KLAR, fremmed), o).tilstand, 'klar');
});

test('delt: serving the app port, with the https address (no :443)', () => {
  const s = tilstandAf(raa(KLAR, SERVE_DELT), o);
  assert.equal(s.tilstand, 'delt');
  assert.equal(s.adresse, 'https://laptop.example.ts.net');
  assert.notEqual(s.offentlig, true);
  const lokal = { ...SERVE_DELT, Web: { 'laptop.example.ts.net:443': { Handlers: { '/': { Proxy: 'http://localhost:8750/' } } } } };
  assert.equal(tilstandAf(raa(KLAR, lokal), o).tilstand, 'delt');
});

test('delt on another https port keeps the port in the address', () => {
  const s = tilstandAf(raa(KLAR, { TCP: { '8443': { HTTPS: true } }, Web: { 'laptop.example.ts.net:8443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:8750' } } } } }), o);
  assert.equal(s.adresse, 'https://laptop.example.ts.net:8443');
});

test('an address that is not a ts.net name is never shown', () => {
  const s = tilstandAf(raa(KLAR, { TCP: { '443': { HTTPS: true } }, Web: { 'evil.example.org/x"><script>:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:8750' } } } } }), o);
  assert.equal(s.tilstand, 'delt');
  assert.equal(s.adresse, undefined);
});

test('a public (Funnel) exposure is flagged, never hidden', () => {
  const s = tilstandAf(raa(KLAR, { ...SERVE_DELT, AllowFunnel: { 'laptop.example.ts.net:443': true } }), o);
  assert.equal(s.tilstand, 'delt');
  assert.equal(s.offentlig, true);
});

test('ukendt: malformed or unexpected output is never guessed at', () => {
  assert.equal(tilstandAf(raa('ikke json'), o).tilstand, 'ukendt');
  assert.equal(tilstandAf(raa(null), o).tilstand, 'ukendt');
  assert.equal(tilstandAf(raa({}), o).tilstand, 'ukendt');
  assert.equal(tilstandAf(raa({ BackendState: 'Starting' }), o).tilstand, 'ukendt');
  assert.equal(tilstandAf(raa({ BackendState: 'NeedsMachineAuth' }), o).tilstand, 'ukendt');
  assert.equal(tilstandAf(raa(KLAR, 'rod'), o).tilstand, 'ukendt'); // running, but the serve answer cannot be read
  assert.equal(tilstandAf(raa(KLAR, { Web: 7 }), o).tilstand, 'ukendt');
  assert.equal(tilstandAf({ fundet: true, status: KLAR }, o).tilstand, 'ukendt'); // the serve read failed
});

test('laptop: no Tailscale on a laptop install; with one, the real state wins and carries the laptop flag', () => {
  const l = { port: PORT, laptop: true };
  assert.equal(tilstandAf({ fundet: false }, l).tilstand, 'laptop');
  assert.equal(tilstandAf(raa({ BackendState: 'NeedsLogin' }), l).tilstand, 'ikke-logget-ind');
  const delt = tilstandAf(raa(KLAR, SERVE_DELT), l);
  assert.equal(delt.tilstand, 'delt');
  assert.equal(delt.laptop, true);
  assert.equal(tilstandAf(raa(KLAR, {}), o).laptop, false);
});

// ---- the runner ----

const ok = (stdout: unknown): TsSvar => ({ fundet: true, kode: 0, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr: '' });

function stub(svar: (argv: readonly string[]) => TsSvar | Promise<TsSvar>): { koerer: TsKoerer; kald: string[][] } {
  const kald: string[][] = [];
  return { kald, koerer: async (argv) => { kald.push([...argv]); return svar(argv); } };
}

test('laesTailscale asks only for status --json and, when running, serve status --json', async () => {
  const s = stub((a) => (a[0] === 'status' ? ok(KLAR) : ok(SERVE_DELT)));
  const syn = await laesTailscale(s.koerer, o);
  assert.equal(syn.tilstand, 'delt');
  assert.deepEqual(s.kald, [['status', '--json'], ['serve', 'status', '--json']]);
  const ude = stub(() => ok({ BackendState: 'NeedsLogin' }));
  assert.equal((await laesTailscale(ude.koerer, o)).tilstand, 'ikke-logget-ind');
  assert.deepEqual(ude.kald, [['status', '--json']], 'serve is not asked while logged out');
});

test('laesTailscale: a missing binary is mangler, a throwing runner or garbage is ukendt; it never throws', async () => {
  assert.equal((await laesTailscale(async () => ({ fundet: false }), o)).tilstand, 'mangler');
  assert.equal((await laesTailscale(async () => { throw new Error('boom'); }, o)).tilstand, 'ukendt');
  assert.equal((await laesTailscale(async () => ok('<html>'), o)).tilstand, 'ukendt');
  assert.equal((await laesTailscale(async () => ({ fundet: true, kode: 1, stdout: '', stderr: 'fejl' }), o)).tilstand, 'ukendt');
  // JSON on a non-zero exit still counts (a logged-out CLI answers like that on some versions)
  assert.equal((await laesTailscale(async () => ({ fundet: true, kode: 1, stdout: JSON.stringify({ BackendState: 'NeedsLogin' }), stderr: '' }), o)).tilstand, 'ikke-logget-ind');
});

test('laesTailscale: serve failing after a running status is ukendt', async () => {
  const s = stub((a) => (a[0] === 'status' ? ok(KLAR) : { fundet: true, kode: 1, stdout: '', stderr: 'nej' }));
  assert.equal((await laesTailscale(s.koerer, o)).tilstand, 'ukendt');
});

// ---- the one write ----

test('delArgv is exactly serve --bg <port>, and refuses a port that is not a port', () => {
  assert.deepEqual(delArgv(8750), ['serve', '--bg', '8750']);
  for (const x of [0, 70000, 1.5, Number.NaN, -1]) assert.throws(() => delArgv(x), /port/i);
});

test('no argv the app can build or send contains funnel; the safe runner refuses everything off the list', async () => {
  const s = stub(() => ok(''));
  const sikker = sikkerKoerer(s.koerer);
  await sikker(['status', '--json']);
  await sikker(['serve', 'status', '--json']);
  await sikker(['serve', '--bg', '8750']);
  assert.equal(s.kald.length, 3);
  for (const a of s.kald) assert.ok(!a.some((x) => /funnel/i.test(x)));
  for (const forbudt of [['funnel', '8750'], ['serve', '--funnel', '8750'], ['funnel', '--bg', '8750'], ['serve', '--bg', '--set-path', '/', '8750'], ['up'], ['login'], ['serve', 'reset'], ['serve', '--bg', '8750', 'funnel'], ['serve', '--bg', 'abc'], ['status']]) {
    await assert.rejects(() => sikker(forbudt), /ikke tilladt/i, forbudt.join(' '));
  }
  assert.equal(s.kald.length, 3, 'nothing forbidden reached the runner');
});

test('delPaaTailnet runs the one command for the configured port and reads the new state', async () => {
  let delt = false;
  const s = stub((a) => {
    if (a[0] === 'serve' && a[1] === '--bg') { delt = true; return ok(''); }
    return a[0] === 'status' ? ok(KLAR) : ok(delt ? SERVE_DELT : {});
  });
  const r = await delPaaTailnet(s.koerer, o);
  assert.equal(r.tilstand, 'delt');
  assert.deepEqual(s.kald.filter((a) => a[0] === 'serve' && a[1] === '--bg'), [['serve', '--bg', '8750']]);
});

test('delPaaTailnet: a refusal from Tailscale becomes one plain sentence; a login link is kept, other text is not', async () => {
  const hemmelig = 'Serve is not enabled on your tailnet.\nTo enable, visit:\n\n\thttps://login.tailscale.com/f/serve?node=n123abc\n';
  const s = stub((a) => (a[0] === 'serve' && a[1] === '--bg' ? { fundet: true, kode: 1, stdout: '', stderr: hemmelig } : a[0] === 'status' ? ok(KLAR) : ok({})));
  await assert.rejects(() => delPaaTailnet(s.koerer, o), (e: Error) => {
    assert.match(e.message, /https:\/\/login\.tailscale\.com\/f\/serve\?node=n123abc/);
    assert.doesNotMatch(e.message, /Serve is not enabled/);
    return true;
  });
  const andet = stub((a) => (a[0] === 'serve' && a[1] === '--bg' ? { fundet: true, kode: 1, stdout: '', stderr: 'hemmelig linje /Users/x/key' } : ok(KLAR)));
  await assert.rejects(() => delPaaTailnet(andet.koerer, o), (e: Error) => !/hemmelig linje|Users/.test(e.message));
  await assert.rejects(() => delPaaTailnet(async () => ({ fundet: false }), o), /ikke installeret/i);
  await assert.rejects(() => delPaaTailnet(async () => { throw new Error('boom'); }, o), /Tailscale/);
});

// ---- the real runner (execFile injected: nothing is spawned) ----

type ExecKald = { fil: string; argv: readonly string[]; timeout: number | undefined };
function fakeExec(svar: (fil: string) => { kode?: number | string; stdout?: string; stderr?: string }): { udfoer: TsExecFile; kald: ExecKald[] } {
  const kald: ExecKald[] = [];
  return {
    kald,
    udfoer: ((fil: string, argv: readonly string[], opts: { timeout?: number }, cb: (err: (Error & { code?: number | string }) | null, stdout: string, stderr: string) => void) => {
      kald.push({ fil, argv, timeout: opts.timeout });
      const s = svar(fil);
      if (s.kode === undefined || s.kode === 0) cb(null, s.stdout ?? '', s.stderr ?? '');
      else cb(Object.assign(new Error('x'), { code: s.kode }), s.stdout ?? '', s.stderr ?? '');
    }) as never,
  };
}

test('the real runner tries PATH first, then the Mac app and the usual places, and stops at the first that exists', async () => {
  const e = fakeExec((fil) => (fil === '/Applications/Tailscale.app/Contents/MacOS/Tailscale' ? { stdout: '{"BackendState":"Running"}' } : { kode: 'ENOENT' }));
  const k = lavTsKoerer({ execFile: e.udfoer, timeoutMs: 1234 });
  const svar = await k(['status', '--json']);
  assert.deepEqual(svar, { fundet: true, kode: 0, stdout: '{"BackendState":"Running"}', stderr: '' });
  assert.equal(e.kald[0]?.fil, 'tailscale');
  assert.equal(e.kald.at(-1)?.fil, '/Applications/Tailscale.app/Contents/MacOS/Tailscale');
  assert.ok(e.kald.every((x) => x.timeout === 1234), 'every call has a timeout');
});

test('the real runner: nothing found is fundet:false; a non-zero exit is an answer, not a missing binary', async () => {
  const ingen = fakeExec(() => ({ kode: 'ENOENT' }));
  assert.deepEqual(await lavTsKoerer({ execFile: ingen.udfoer })(['status', '--json']), { fundet: false });
  const fejler = fakeExec(() => ({ kode: 1, stderr: 'nej' }));
  assert.deepEqual(await lavTsKoerer({ execFile: fejler.udfoer })(['status', '--json']), { fundet: true, kode: 1, stdout: '', stderr: 'nej' });
  assert.equal(fejler.kald.length, 1);
});

test('the real runner rejects on a timeout (the caller turns it into ukendt)', async () => {
  const t = fakeExec(() => ({ kode: 'ETIMEDOUT' }));
  await assert.rejects(() => lavTsKoerer({ execFile: t.udfoer })(['status', '--json']), /svarede ikke/i);
});
