import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { manifest } from '../src/shell/manifest.ts';
import { PRODUKT } from '../src/shell/navn.ts';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';

// KC-0016: the web app manifest opens Hjem standalone, dark from the first paint.
// KC-0121: it is rendered from code so its name is PRODUKT, not a static file that mirrors it.
const pub = new URL('../public/', import.meta.url);
const css = readFileSync(new URL('app.css', pub), 'utf8');
const token = (name: string) => css.match(new RegExp(`--${name}: (#[0-9A-Fa-f]{6})`))?.[1];

test('manifest: name, start in Hjem, standalone, colours from the design tokens, icons that exist', () => {
  const m = manifest() as { name: string; short_name: string; lang: string; start_url: string; id: string; display: string; background_color: string; theme_color: string; icons: { src: string; sizes: string; purpose?: string }[] };
  assert.equal(m.name, PRODUKT);
  assert.equal(m.short_name, PRODUKT, 'the label under the home-screen icon');
  assert.equal(m.lang, 'da');
  assert.equal(m.start_url, '/rum/hjem');
  assert.equal(m.id, '/', 'KC-0065: a stable app identity, as ShelfAtlas and maxbuddy have');
  assert.equal(m.display, 'standalone');
  assert.equal(m.background_color, token('ground'));
  assert.equal(m.theme_color, token('nav'));
  const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable'));
  for (const i of m.icons) assert.ok(existsSync(new URL(i.src.slice(1), pub)), i.src);
  assert.ok(existsSync(new URL('icon-180.png', pub)));
});

test('the shell theme-color is the nav token too', () => {
  const layout = readFileSync(new URL('../src/shell/layout.ts', import.meta.url), 'utf8');
  assert.match(layout, new RegExp(`name="theme-color" content="${token('nav')}"`));
});

test('/manifest.webmanifest is served from code: manifest JSON, always revalidated, no static mirror', async () => {
  const { app } = createApp({ store: createFileStore('/nonexistent'), hermes: createFakeAgent({ answer: () => '' }), sourceGlob: '/nonexistent/{date}.json', publicDir: 'public' });
  const res = await app.request('/manifest.webmanifest');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^application\/manifest\+json/);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  assert.deepEqual(await res.json(), manifest());
  assert.ok(!existsSync(new URL('manifest.webmanifest', pub)), 'public/manifest.webmanifest would shadow the route');
});
