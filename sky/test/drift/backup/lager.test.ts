// KC-0185: the copy store. R2 over the S3 API with a bucket-scoped token: object PUT/GET/DELETE and
// ListObjectsV2 inside the bucket only — never a bucket-level call. EU jurisdiction endpoint by default.
// An injected fetch records every request; nothing here touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { falskKopiLager, lokalKopiLager, r2KopiLager, r2Vaert } from '../../../src/drift/backup/lager.ts';

type Kald = { metode: string; url: string; headers: Record<string, string>; krop: Buffer | null };

function optager(svar: (k: Kald) => Response): { kald: Kald[]; fetch: typeof fetch } {
  const kald: Kald[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const k: Kald = { metode: init?.method ?? 'GET', url: String(input), headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)), krop: init?.body ? Buffer.from(init.body as Uint8Array) : null };
    kald.push(k);
    return svar(k);
  }) as typeof fetch;
  return { kald, fetch: f };
}

const opsaet = { kontoId: '0123456789abcdef0123456789abcdef', bucket: 'clawco-sky-backup', noegleId: 'nid', hemmelighed: 'HEMMELIG-r2-vaerdi', nu: () => new Date('2026-11-01T02:00:00Z') };

test('the endpoint is the EU jurisdiction host by default, and the plain one when jurisdiction is empty', () => {
  assert.equal(r2Vaert(opsaet.kontoId, 'eu'), '0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com');
  assert.equal(r2Vaert(opsaet.kontoId, ''), '0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com');
  assert.throws(() => r2Vaert('../x', 'eu'), /SKY_R2_ACCOUNT_ID/);
  assert.throws(() => r2Vaert(opsaet.kontoId, 'e.u'), /SKY_R2_JURISDICTION/);
});

test('put signs a path-style object PUT with the body hash; the secret is never sent', async () => {
  const o = optager(() => new Response(null, { status: 200 }));
  const l = r2KopiLager({ ...opsaet, jurisdiktion: 'eu', fetch: o.fetch });
  const data = Buffer.from('krypteret');
  await l.put('tenant/hus-aaaaaaaa/20261101T020000Z-0a1b2c3d.ckb', data);
  const [k] = o.kald;
  assert.equal(k!.metode, 'PUT');
  assert.equal(k!.url, 'https://0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com/clawco-sky-backup/tenant/hus-aaaaaaaa/20261101T020000Z-0a1b2c3d.ckb');
  assert.equal(k!.headers['x-amz-content-sha256'], createHash('sha256').update(data).digest('hex'));
  assert.match(k!.headers['authorization']!, /^AWS4-HMAC-SHA256 Credential=nid\/20261101\/auto\/s3\/aws4_request,/);
  assert.deepEqual(k!.krop, data);
  assert.ok(!JSON.stringify(o.kald).includes(opsaet.hemmelighed));
});

test('get returns the bytes, or null on 404; delete accepts 204 and 404', async () => {
  const o = optager((k) => (k.url.endsWith('findes.ckb') ? new Response(Buffer.from('abc'), { status: 200 }) : k.metode === 'DELETE' ? new Response(null, { status: 204 }) : new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 })));
  const l = r2KopiLager({ ...opsaet, jurisdiktion: 'eu', fetch: o.fetch });
  assert.deepEqual(await l.hent('db/findes.ckb'), Buffer.from('abc'));
  assert.equal(await l.hent('db/mangler.ckb'), null);
  await l.slet('db/findes.ckb');
  assert.equal(o.kald.at(-1)!.metode, 'DELETE');
});

test('liste walks ListObjectsV2 pages inside the bucket (list-type=2, prefix, continuation token)', async () => {
  const sider = [
    '<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>db/a.ckb</Key><Size>10</Size></Contents><NextContinuationToken>tok/1+=</NextContinuationToken></ListBucketResult>',
    '<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>db/b&amp;c.ckb</Key><Size>20</Size></Contents></ListBucketResult>',
  ];
  const o = optager(() => new Response(sider.shift()!, { status: 200 }));
  const l = r2KopiLager({ ...opsaet, jurisdiktion: 'eu', fetch: o.fetch });
  assert.deepEqual(await l.liste('db/'), [{ noegle: 'db/a.ckb', bytes: 10 }, { noegle: 'db/b&c.ckb', bytes: 20 }]);
  assert.equal(o.kald[0]!.url, 'https://0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com/clawco-sky-backup?list-type=2&prefix=db%2F');
  assert.match(o.kald[1]!.url, /continuation-token=tok%2F1%2B%3D/);
  for (const k of o.kald) assert.ok(!/[?&](location|lifecycle|policy|acl)/.test(k.url) && new URL(k.url).pathname.startsWith('/clawco-sky-backup'), 'object and list calls only');
});

test('an error names the HTTP status and the S3 error code only, never the body or the secret', async () => {
  const o = optager(() => new Response(`<Error><Code>AccessDenied</Code><Message>${opsaet.hemmelighed}</Message></Error>`, { status: 403 }));
  const l = r2KopiLager({ ...opsaet, jurisdiktion: 'eu', fetch: o.fetch });
  await assert.rejects(l.put('db/x.ckb', Buffer.from('x')), (e: Error) => /403 AccessDenied/.test(e.message) && !e.message.includes(opsaet.hemmelighed));
});

test('keys are checked before any call', async () => {
  const o = optager(() => new Response(null, { status: 200 }));
  const l = r2KopiLager({ ...opsaet, jurisdiktion: 'eu', fetch: o.fetch });
  await assert.rejects(l.put('../ud', Buffer.from('x')), /ugyldig nøgle/);
  await assert.rejects(l.hent('/abs'), /ugyldig nøgle/);
  assert.equal(o.kald.length, 0);
});

test('the fake store keeps bytes in memory and lists by prefix', async () => {
  const l = falskKopiLager();
  await l.put('tenant/hus-aaaaaaaa/1.ckb', Buffer.from('a'));
  await l.put('tenant/hus-bbbbbbbb/1.ckb', Buffer.from('bb'));
  assert.deepEqual(await l.liste('tenant/hus-bbbbbbbb/'), [{ noegle: 'tenant/hus-bbbbbbbb/1.ckb', bytes: 2 }]);
  await l.slet('tenant/hus-aaaaaaaa/1.ckb');
  assert.equal(await l.hent('tenant/hus-aaaaaaaa/1.ckb'), null);
});

// KC-0186: the local store, for an upgrade's restore point while R2 is not set up. The same interface and the
// same sealed bytes; a directory only Sky's user can read (0700), files 0600, written atomically.
test('the local store keeps objects as files under its directory: 0700 directories, 0600 files', async () => {
  const rod = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-lokal-'));
  try {
    const mappe = path.join(rod, 'kopier');
    const l = lokalKopiLager(mappe);
    await l.put('genopret/hus-abcdefgh/20261101T030000Z-00000000.ckb', Buffer.from('a'));
    await l.put('genopret/hus-abcdefgh/20261101T040000Z-00000001.ckb', Buffer.from('bb'));
    await l.put('genopret/hus-zzzzzzzz/20261101T030000Z-00000002.ckb', Buffer.from('c'));
    assert.equal(fs.statSync(mappe).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(mappe, 'genopret', 'hus-abcdefgh')).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(mappe, 'genopret/hus-abcdefgh/20261101T030000Z-00000000.ckb')).mode & 0o777, 0o600);
    assert.deepEqual((await l.hent('genopret/hus-abcdefgh/20261101T040000Z-00000001.ckb'))?.toString(), 'bb');
    assert.equal(await l.hent('genopret/hus-abcdefgh/ingen.ckb'), null);
    assert.deepEqual(await l.liste('genopret/hus-abcdefgh/'), [
      { noegle: 'genopret/hus-abcdefgh/20261101T030000Z-00000000.ckb', bytes: 1 },
      { noegle: 'genopret/hus-abcdefgh/20261101T040000Z-00000001.ckb', bytes: 2 },
    ]);
    await l.slet('genopret/hus-abcdefgh/20261101T030000Z-00000000.ckb');
    await l.slet('genopret/hus-abcdefgh/20261101T030000Z-00000000.ckb');
    assert.equal((await l.liste('genopret/')).length, 2);
    assert.deepEqual(fs.readdirSync(path.join(mappe, 'genopret', 'hus-abcdefgh')), ['20261101T040000Z-00000001.ckb']);
  } finally { fs.rmSync(rod, { recursive: true, force: true }); }
});

test('the local store refuses a key that climbs out, and a directory others can read', async () => {
  const rod = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-lokal-'));
  try {
    const l = lokalKopiLager(path.join(rod, 'kopier'));
    await assert.rejects(l.put('genopret/../../x', Buffer.from('a')), /ugyldig nøgle/);
    const aaben = path.join(rod, 'aaben');
    fs.mkdirSync(aaben, { mode: 0o755 });
    fs.chmodSync(aaben, 0o755);
    await assert.rejects(lokalKopiLager(aaben).put('genopret/a.ckb', Buffer.from('a')), /andre end Sky/);
    await assert.rejects(lokalKopiLager('relativ/sti').hent('a'), /absolut/);
  } finally { fs.rmSync(rod, { recursive: true, force: true }); }
});
