// KC-0201: "Få hjælp" in the Clawco app's settings (the Kø panel), only when the app runs under Clawco Sky (KC_SKY=ja).
// The link leads to the account app's help page, which builds the mail from the allowlist (sky/src/konto/hjaelp.ts);
// the tenant carries no plan, no account number and builds no mail text of its own (the two packages share no code).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hjaelpFraMiljoe } from '../../src/shell/hjaelp.ts';
import { shell } from '../../src/shell/layout.ts';
import { html } from '../../src/shell/html.ts';
import { createApp } from '../../src/server.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';

test('no link unless KC_SKY is exactly "ja" and KC_SKY_URL is a usable address', () => {
  assert.equal(hjaelpFraMiljoe({}), null);
  assert.equal(hjaelpFraMiljoe({ KC_SKY_URL: 'https://konto.example.test' }), null, 'a URL alone does not turn it on');
  for (const v of ['nej', 'true', '1', 'JA ja', '']) assert.equal(hjaelpFraMiljoe({ KC_SKY: v, KC_SKY_URL: 'https://konto.example.test' }), null, v);
  assert.equal(hjaelpFraMiljoe({ KC_SKY: 'ja' }), null, 'no address to point at: no link, never a guess');
  assert.deepEqual(hjaelpFraMiljoe({ KC_SKY: 'ja', KC_SKY_URL: 'https://konto.example.test' }), { href: 'https://konto.example.test/konto/hjaelp' });
  assert.deepEqual(hjaelpFraMiljoe({ KC_SKY: ' ja ', KC_SKY_URL: ' https://konto.example.test/ ' }), { href: 'https://konto.example.test/konto/hjaelp' });
});

test('the address is reduced to its origin and must be https (http only for loopback in development)', () => {
  assert.deepEqual(hjaelpFraMiljoe({ KC_SKY: 'ja', KC_SKY_URL: 'https://konto.example.test/log-ind?x=1#y' }), { href: 'https://konto.example.test/konto/hjaelp' });
  assert.deepEqual(hjaelpFraMiljoe({ KC_SKY: 'ja', KC_SKY_URL: 'http://localhost:8760' }), { href: 'http://localhost:8760/konto/hjaelp' });
  for (const ond of ['http://konto.example.test', 'javascript:alert(1)', 'data:text/html,x', '//konto.example.test', 'konto.example.test', 'https://bruger:kode@konto.example.test', 'https://', 'ftp://konto.example.test']) {
    assert.equal(hjaelpFraMiljoe({ KC_SKY: 'ja', KC_SKY_URL: ond }), null, ond);
  }
});

const med = (o: Partial<Parameters<typeof shell>[0]>) => String(shell({ roomId: 'dagen', hermesStatus: 'Klar', venter: {}, main: html`<p>x</p>`, chat: [], ...o }));
const panel = (s: string) => /<div class="koe-panel"[\s\S]*?<div class="room"/.exec(s)![0];

test('the settings panel shows "Få hjælp" as a plain link when told to, and nothing when not', () => {
  const med1 = panel(med({ hjaelp: { href: 'https://konto.example.test/konto/hjaelp' } }));
  assert.match(med1, /<a class="btn btn-ghost" href="https:\/\/konto\.example\.test\/konto\/hjaelp" data-hjaelp>Få hjælp<\/a>/);
  assert.doesNotMatch(panel(med({})), /Få hjælp|data-hjaelp/);
});

test('the link text and address are escaped', () => {
  const p = panel(med({ hjaelp: { href: 'https://konto.example.test/konto/hjaelp"><script>x</script>' } }));
  assert.doesNotMatch(p, /<script>x/);
});

const rod = await mkdtemp(path.join(tmpdir(), 'kc-hjaelp-'));
after(() => rm(rod, { recursive: true, force: true }));
const publicDir = path.relative(process.cwd(), fileURLToPath(new URL('../../public', import.meta.url)));
const noMail = { mailRunner: async () => ({ code: 1, stdout: '', stderr: 'ingen' }), mailStateDir: '/nonexistent' };
const lav = (navn: string, extra: Record<string, unknown> = {}) => {
  const dataDir = path.join(rod, navn);
  return createApp({ store: createFileStore(dataDir), hermes: createFakeAgent({ answer: () => 'ok' }), sourceGlob: '/nonexistent/{date}.json', dataDir, sha: 'abc', publicDir, ...noMail, ...extra }).app;
};

test('end to end: every page of an app told it runs under Sky carries the link; a self-hosted app never shows it', async () => {
  const sky = lav('sky', { hjaelp: { href: 'https://konto.example.test/konto/hjaelp' } });
  for (const sti of ['/rum/hjem', '/rum/dagen']) {
    const h = await (await sky.request(sti)).text();
    assert.match(h, /href="https:\/\/konto\.example\.test\/konto\/hjaelp"/, sti);
  }
  const selv = lav('selv');
  const h = await (await selv.request('/rum/hjem')).text();
  assert.doesNotMatch(h, /Få hjælp|konto\/hjaelp/, 'self-hosters never see Sky links');
});
