import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { medTesttilstand } from '../src/testtilstand/kontakt.ts';

// KC-0089: an unknown HTML address answers a calm Danish page in the normal skeleton; /api stays JSON.
const { app } = createApp({ store: createFileStore('/nonexistent'), hermes: createFakeAgent({ answer: () => '' }), sourceGlob: '/nonexistent/{date}.json', publicDir: 'public' });

async function side(url: string, headers?: Record<string, string>) {
  const res = await app.request(url, headers ? { headers } : undefined);
  return { res, text: await res.text() };
}

test('an unknown room is a Danish 404 page inside the skeleton, with a way back to Hjem', async () => {
  const { res, text } = await side('/rum/findesikke');
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  assert.match(text, /<h1>Det rum findes ikke<\/h1>/);
  assert.match(text, /href="\/rum\/hjem"[^>]*>Til Nu</);
  assert.match(text, /<nav aria-label="Rum"/);
  assert.match(text, /<aside aria-label="Spørg Hermes"/);
});

test('any other unmatched non-api path is the same kind of page', async () => {
  for (const p of ['/noget-andet', '/foo/bar', '/rum/hjem/ukendt']) {
    const { res, text } = await side(p);
    assert.equal(res.status, 404, p);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/, p);
    assert.match(text, /<h1>Siden findes ikke<\/h1>/, p);
    assert.match(text, /href="\/rum\/hjem"/, p);
  }
});

test('an unknown document or presentation opened as a page is the Danish page; inside an iframe it stays plain', async () => {
  for (const p of ['/rum/skrive/dok/nope.md', '/rum/univers/vis/nope.html', '/rum/findesikke/dok/x']) {
    const { res, text } = await side(p);
    assert.equal(res.status, 404, p);
    assert.match(text, /<h1>Dokumentet findes ikke<\/h1>/, p);
    assert.match(text, /href="\/rum\/hjem"/, p);
    const ramme = await side(p, { 'sec-fetch-dest': 'iframe' });
    assert.equal(ramme.res.status, 404, p);
    assert.doesNotMatch(ramme.text, /<html/i, p);
  }
});

test('an unknown meeting is still a Danish 404 page', async () => {
  const { res, text } = await side('/moede/findesikke/x');
  assert.equal(res.status, 404);
  assert.match(text, /Mødet findes ikke/);
});

test('/api paths keep answering JSON errors, never HTML', async () => {
  for (const p of ['/api/findesikke', '/api/rum/findesikke/fragment']) {
    const { res, text } = await side(p);
    assert.equal(res.status, 404, p);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/, p);
    assert.equal(typeof (JSON.parse(text) as { error: unknown }).error, 'string', p);
  }
  const post = await app.request('/api/findesikke', { method: 'POST' });
  assert.equal(post.status, 404);
  assert.match(post.headers.get('content-type') ?? '', /application\/json/);
});

test('static files keep working and unknown files under public are the page, not a crash', async () => {
  assert.equal((await side('/app.css')).res.status, 200);
  assert.equal((await side('/findes-ikke.css')).res.status, 404);
});

test('the testtilstand wrapper passes an unknown address through to the same page', async () => {
  const wrapped = medTesttilstand(app, async () => { throw new Error('not needed without the cookie'); });
  const res = await wrapped.request('/rum/findesikke');
  assert.equal(res.status, 404);
  assert.match(await res.text(), /<h1>Det rum findes ikke<\/h1>/);
});
