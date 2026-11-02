// KC-0161: the Tailscale card in Start through the app. The state comes from the (injected) CLI runner, the one button
// shares the app port on a human tap only — a press without the one-time yes is refused, a tap for another port is
// refused, a member never shares — and no argv that reaches the runner ever contains funnel.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import type { Person } from '../src/identitet/husstand.ts';
import type { TsKoerer, TsSvar } from '../src/shell/tailscale.ts';

const NOW = new Date('2026-10-31T10:00:00Z');
const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const MEDLEM: Person = { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' };
const PORT = 8750;

const ok = (x: unknown): TsSvar => ({ fundet: true, kode: 0, stdout: typeof x === 'string' ? x : JSON.stringify(x), stderr: '' });
const KLAR = { BackendState: 'Running', Self: { DNSName: 'laptop.example.ts.net.' } };
const DELT = { TCP: { '443': { HTTPS: true } }, Web: { 'laptop.example.ts.net:443': { Handlers: { '/': { Proxy: `http://127.0.0.1:${PORT}` } } } } };

/** A fake CLI that remembers what it was asked and flips to "delt" once `serve --bg <port>` ran. */
function falskCli(start: 'mangler' | 'ikke-logget-ind' | 'klar' | 'delt' | 'uleselig' | 'kaster', o: { delSvar?: TsSvar } = {}) {
  const kald: string[][] = [];
  let delt = start === 'delt';
  const koerer: TsKoerer = async (argv) => {
    kald.push([...argv]);
    if (start === 'mangler') return { fundet: false };
    if (start === 'kaster') throw new Error('boom');
    if (argv[0] === 'serve' && argv[1] === '--bg') { if (o.delSvar) return o.delSvar; delt = true; return ok(''); }
    if (argv[0] === 'status') return ok(start === 'ikke-logget-ind' ? { BackendState: 'NeedsLogin' } : start === 'uleselig' ? '<html>' : KLAR);
    return ok(delt ? DELT : {});
  };
  return { koerer, kald, delKald: () => kald.filter((a) => a[0] === 'serve' && a[1] === '--bg') };
}

type Sut = ReturnType<typeof createApp> & { dir: string; store: ReturnType<typeof createFileStore> };
async function medApp(o: { cli?: TsKoerer; person?: Person; port?: number; laptop?: boolean }, fn: (s: Sut) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-start-tailscale-'));
  try {
    const store = createFileStore(dir);
    const app = createApp({
      store, hermes: createFakeAgent({ answer: () => 'Hej.' }), sourceGlob: '/nonexistent/{date}.json', dataDir: dir, now: () => NOW,
      mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent', identitet: { fast: o.person ?? EJER },
      ...(o.cli ? { tailscale: { koerer: o.cli, port: o.port ?? PORT, ...(o.laptop ? { laptop: () => true } : {}) } } : {}),
    });
    await fn({ ...app, dir, store });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const post = (s: Sut, url: string, body: unknown = {}) => s.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const side = async (s: Sut): Promise<string> => (await s.app.request('/rum/start')).text();
const kortAf = (h: string): string => /<article[^>]*data-tailscale="[^"]+"[\s\S]*?<\/article>/.exec(h)?.[0] ?? '';
const tilstandAf = (h: string): string | undefined => /data-tailscale="([^"]+)"/.exec(h)?.[1];
const DEL = (port: number = PORT) => ({ port });
async function ja(s: Sut, body: unknown = DEL()): Promise<string> {
  const r = await post(s, '/api/graense/ja', { rum: 'start', slags: 'aktion', id: 'tailscale-del', body });
  assert.equal(r.status, 200);
  return ((await r.json()) as { ja: string }).ja;
}
const aktion = (s: Sut, body: unknown, tegn?: string) => post(s, '/api/rum/start/aktion/tailscale-del', tegn ? { ...(body as object), ja: tegn } : body);

test('the card shows the state the CLI reports, in the room', async () => {
  const forventet: Record<string, string> = { mangler: 'mangler', 'ikke-logget-ind': 'ikke-logget-ind', klar: 'klar', delt: 'delt', uleselig: 'ukendt', kaster: 'ukendt' };
  for (const [start, tilstand] of Object.entries(forventet)) {
    const cli = falskCli(start as Parameters<typeof falskCli>[0]);
    await medApp({ cli: cli.koerer }, async (s) => {
      const h = await side(s);
      assert.equal(tilstandAf(h), tilstand, start);
      assert.equal(cli.delKald().length, 0, 'reading the page never shares anything');
    });
  }
});

test('the delt card shows the address, never anything but what the CLI printed', async () => {
  await medApp({ cli: falskCli('delt').koerer }, async (s) => {
    const k = kortAf(await side(s));
    assert.match(k, /https:\/\/laptop\.example\.ts\.net/);
    assert.match(k, /seks/);
  });
});

test('no CLI wired (Sky, an install without the seam): no card, and the action does not exist', async () => {
  await medApp({}, async (s) => {
    assert.equal(tilstandAf(await side(s)), undefined);
    assert.equal((await aktion(s, DEL())).status, 403, 'no tap, no run');
    assert.equal((await aktion(s, DEL(), await ja(s))).status, 400, 'a tap with nothing wired says so');
  });
});

test('a press without the one-time yes is refused and shares nothing; the refusal is logged', async () => {
  const cli = falskCli('klar');
  await medApp({ cli: cli.koerer }, async (s) => {
    const r = await aktion(s, DEL());
    assert.equal(r.status, 403);
    assert.equal(((await r.json()) as { graense?: string }).graense, 'kraever-ja');
    assert.equal(cli.delKald().length, 0);
    const log = await s.store.readLog('start', 20);
    assert.ok(log.some((e) => e.graense === 'kraever-ja' && /Clawco gør kun det her, når du selv har trykket ja/.test(e.tekst)));
  });
});

test('a tap shares the app port once, logs it, and the card turns delt; the token is spent', async () => {
  const cli = falskCli('klar');
  await medApp({ cli: cli.koerer }, async (s) => {
    const tegn = await ja(s);
    const r = await aktion(s, DEL(), tegn);
    assert.equal(r.status, 202, await r.clone().text());
    const run = await s.runs.get(((await r.json()) as { runId: string }).runId)!.finished;
    assert.equal(run.status, 'done', run.error);
    assert.deepEqual(cli.delKald(), [['serve', '--bg', String(PORT)]]);
    const h = await side(s);
    assert.equal(tilstandAf(h), 'delt');
    const log = await s.store.readLog('start', 20);
    assert.ok(log.some((e) => e.kilde === 'henrik' && /Delte Clawco på tailnettet/.test(e.tekst) && e.handlingId === 'tailscale-del'), 'a line in the room log');
    const igen = await aktion(s, DEL(), tegn);
    assert.equal(igen.status, 403, 'the same token twice');
    assert.equal(cli.delKald().length, 1);
  });
});

test('a tap for a port that is not the configured one is refused (the button and the command always agree)', async () => {
  const cli = falskCli('klar');
  await medApp({ cli: cli.koerer }, async (s) => {
    for (const body of [DEL(9999), DEL(80), { port: String(PORT) }, {}, { port: PORT, ekstra: 1 }]) {
      const r = await aktion(s, body, await ja(s, body));
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.equal(cli.delKald().length, 0);
  });
});

test('sharing is only offered while the state is klar: not when already shared, not when Tailscale is missing', async () => {
  for (const start of ['delt', 'mangler', 'ikke-logget-ind', 'uleselig'] as const) {
    const cli = falskCli(start);
    await medApp({ cli: cli.koerer }, async (s) => {
      const r = await aktion(s, DEL(), await ja(s));
      assert.equal(r.status, 400, start);
      assert.equal(cli.delKald().length, 0, start);
    });
  }
});

test('a member never shares, and sees no button', async () => {
  const cli = falskCli('klar');
  await medApp({ cli: cli.koerer, person: MEDLEM }, async (s) => {
    const r = await aktion(s, DEL(), await ja(s));
    assert.ok(r.status === 400 || r.status === 403, String(r.status));
    assert.equal(cli.delKald().length, 0);
    assert.doesNotMatch(kortAf(await side(s)), /data-aktion/);
  });
});

test('when Tailscale refuses, the run fails with one plain sentence and the room log says what was not done', async () => {
  const cli = falskCli('klar', { delSvar: { fundet: true, kode: 1, stdout: '', stderr: 'Serve is not enabled on your tailnet.\nTo enable, visit:\n\thttps://login.tailscale.com/f/serve?node=n1\n' } });
  await medApp({ cli: cli.koerer }, async (s) => {
    const r = await aktion(s, DEL(), await ja(s));
    assert.equal(r.status, 202);
    const run = await s.runs.get(((await r.json()) as { runId: string }).runId)!.finished;
    assert.equal(run.status, 'failed');
    assert.match(run.error ?? '', /https:\/\/login\.tailscale\.com\/f\/serve\?node=n1/);
    assert.doesNotMatch(run.error ?? '', /Serve is not enabled/);
    assert.ok((await s.store.readLog('start', 20)).some((e) => /^Ikke gjort: Tailscale vil først have/.test(e.tekst)));
    assert.equal(tilstandAf(await side(s)), 'klar');
  });
});

test('whatever the page and the button do, no argv that reaches the CLI contains funnel, and only the three commands are run', async () => {
  const cli = falskCli('klar');
  await medApp({ cli: cli.koerer }, async (s) => {
    await side(s);
    await aktion(s, DEL(), await ja(s));
    await side(s);
    const unikke = new Set(cli.kald.map((a) => a.join(' ')));
    for (const a of unikke) assert.match(a, /^(status --json|serve status --json|serve --bg 8750)$/);
    assert.ok(!cli.kald.flat().some((x) => /funnel/i.test(x)));
  });
});

test('laptop mode with no Tailscale: the card says the honest phone limit and offers no sharing', async () => {
  await medApp({ cli: falskCli('mangler').koerer, laptop: true }, async (s) => {
    const k = kortAf(await side(s));
    assert.equal(tilstandAf(k), 'laptop');
    assert.match(k, /Uden Tailscale kan telefonen ikke nå Clawco; med Tailscale kan den, men kun når den bærbare er vågen/);
    assert.doesNotMatch(k, /data-aktion/);
  });
});
