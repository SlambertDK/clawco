// AWS Signature Version 4 for the S3 API (KC-0185; Cloudflare R2 speaks it with region `auto`). Hand-rolled
// over node:crypto so Sky needs no SDK: the canonical request, the string to sign and the derived signing
// key exactly as AWS documents them, pinned by AWS's own published examples (sigv4.test.ts). Returns the
// headers to send; the secret only ever enters an HMAC.
import { createHash, createHmac } from 'node:crypto';

export const TOM_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export type SignerInput = {
  metode: string;
  vaert: string;
  /** The path, not yet encoded ("/bucket/tenant/x.ckb"). */
  sti: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  indholdSha: string;
  region: string;
  noegleId: string;
  hemmelighed: string;
  nu: Date;
};

/** RFC 3986 encoding as SigV4 wants it: every byte but A–Z a–z 0–9 - . _ ~ is %XX. */
export function koder(s: string, behold = ''): string {
  let ud = '';
  for (const b of Buffer.from(s, 'utf8')) {
    const c = String.fromCharCode(b);
    ud += /[A-Za-z0-9\-._~]/.test(c) || behold.includes(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return ud;
}

export function kanoniskQuery(q: Record<string, string>): string {
  return Object.entries(q).map(([k, v]) => [koder(k), koder(v)] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&');
}

const hmac = (k: Buffer | string, s: string) => createHmac('sha256', k).update(s, 'utf8').digest();
const hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export function signer(i: SignerInput): Record<string, string> {
  const amzDato = i.nu.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dag = amzDato.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(i.headers)) headers[k.toLowerCase()] = v.trim().replace(/\s+/g, ' ');
  headers['host'] = i.vaert;
  headers['x-amz-content-sha256'] = i.indholdSha;
  headers['x-amz-date'] = amzDato;
  const navne = Object.keys(headers).sort();
  const signerede = navne.join(';');
  const kanonisk = [
    i.metode,
    koder(i.sti, '/'),
    kanoniskQuery(i.query),
    navne.map((n) => `${n}:${headers[n]}\n`).join(''),
    signerede,
    i.indholdSha,
  ].join('\n');
  const omfang = `${dag}/${i.region}/s3/aws4_request`;
  const tilSignering = ['AWS4-HMAC-SHA256', amzDato, omfang, hex(kanonisk)].join('\n');
  const noegle = hmac(hmac(hmac(hmac(`AWS4${i.hemmelighed}`, dag), i.region), 's3'), 'aws4_request');
  const signatur = createHmac('sha256', noegle).update(tilSignering, 'utf8').digest('hex');
  const ud: Record<string, string> = { ...headers };
  delete ud['host']; // fetch sets Host from the URL
  ud['authorization'] = `AWS4-HMAC-SHA256 Credential=${i.noegleId}/${omfang},SignedHeaders=${signerede},Signature=${signatur}`;
  return ud;
}
