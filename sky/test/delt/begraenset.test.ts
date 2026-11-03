// KC-0273 (D5): Sky reads a tenant's HTTP answer through one bounded reader, so a tenant cannot stream gigabytes into the
// one process that is also every tenant's gateway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEJERSVAR_MAKS, laesBegraenset } from '../../src/delt/begraenset.ts';

const MiB = 1024 * 1024;

test('a normal answer is read whole; an empty one is the empty text', async () => {
  assert.equal(LEJERSVAR_MAKS, 64 * 1024);
  assert.equal(await laesBegraenset(new Response('{"ok":true}'), LEJERSVAR_MAKS), '{"ok":true}');
  assert.equal(await laesBegraenset(new Response(null), LEJERSVAR_MAKS), '');
  assert.equal(await laesBegraenset(new Response('æøå'.repeat(10)), 60), 'æøå'.repeat(10), 'exactly the bound in bytes is fine');
});

test('a 1 MiB answer is refused, also when it arrives in small pieces with no length header', async () => {
  await assert.rejects(laesBegraenset(new Response('x'.repeat(MiB)), LEJERSVAR_MAKS), /for stort/);
  let sendt = 0;
  let afbrudt = false;
  const uendelig = new ReadableStream<Uint8Array>({
    pull(c) { sendt += 1024; c.enqueue(new Uint8Array(1024)); },
    cancel() { afbrudt = true; },
  });
  await assert.rejects(laesBegraenset(new Response(uendelig), LEJERSVAR_MAKS), /for stort/);
  assert.ok(afbrudt, 'the stream is cancelled');
  assert.ok(sendt <= LEJERSVAR_MAKS + 4 * 1024, `stopped reading at the bound (read ${sendt})`);
});

test('a Content-Length over the bound is refused before the body is read', async () => {
  let laest = false;
  const krop = new ReadableStream<Uint8Array>({ pull(c) { laest = true; c.enqueue(new Uint8Array(1)); c.close(); } });
  await assert.rejects(laesBegraenset(new Response(krop, { headers: { 'content-length': String(MiB) } }), LEJERSVAR_MAKS), /for stort/);
  assert.equal(laest, false);
});

test('laesBegraensetBytes: the same bound for a binary body (an export), the bytes as they came', async () => {
  const { laesBegraensetBytes } = await import('../../src/delt/begraenset.ts');
  const b = Buffer.from([0, 1, 2, 255]);
  assert.deepEqual(await laesBegraensetBytes(new Response(b), 4), b);
  await assert.rejects(laesBegraensetBytes(new Response(b), 3), /for stort/);
});
