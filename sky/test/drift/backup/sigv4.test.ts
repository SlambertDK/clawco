// KC-0185: AWS Signature Version 4 for the S3 API (R2 speaks it), checked against the examples AWS publishes in
// "Signature Calculations for the Authorization Header: Transferring Payload in a Single Chunk" (S3 API
// reference): the documented example keys, date 20130524T000000Z, region us-east-1, bucket examplebucket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOM_SHA256, signer } from '../../../src/drift/backup/sigv4.ts';

const noegler = { noegleId: 'AKIAIOSFODNN7EXAMPLE', hemmelighed: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
const fast = { vaert: 'examplebucket.s3.amazonaws.com', region: 'us-east-1', nu: new Date('2013-05-24T00:00:00Z'), ...noegler };
const signatur = (h: Record<string, string>) => /Signature=([0-9a-f]{64})$/.exec(h['authorization'] ?? '')?.[1];

test('GET object with a Range header', () => {
  const h = signer({ ...fast, metode: 'GET', sti: '/test.txt', query: {}, headers: { range: 'bytes=0-9' }, indholdSha: TOM_SHA256 });
  assert.equal(h['authorization'], 'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  assert.equal(h['x-amz-date'], '20130524T000000Z');
  assert.equal(h['x-amz-content-sha256'], TOM_SHA256);
});

test('PUT object: a $ in the key is percent-encoded and the payload hash is signed', () => {
  const h = signer({
    ...fast, metode: 'PUT', sti: '/test$file.text', query: {},
    headers: { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
    indholdSha: '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
  });
  assert.equal(signatur(h), '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
});

test('GET bucket lifecycle: a query key without a value', () => {
  const h = signer({ ...fast, metode: 'GET', sti: '/', query: { lifecycle: '' }, headers: {}, indholdSha: TOM_SHA256 });
  assert.equal(signatur(h), 'fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543');
});

test('GET bucket (list objects): query parameters sorted by name', () => {
  const h = signer({ ...fast, metode: 'GET', sti: '/', query: { prefix: 'J', 'max-keys': '2' }, headers: {}, indholdSha: TOM_SHA256 });
  assert.equal(signatur(h), '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
});

test('the secret never appears in the headers it returns', () => {
  const h = signer({ ...fast, metode: 'GET', sti: '/x', query: {}, headers: {}, indholdSha: TOM_SHA256 });
  assert.ok(!JSON.stringify(h).includes(noegler.hemmelighed));
});
