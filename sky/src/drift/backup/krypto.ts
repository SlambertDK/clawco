// Client-side encryption of a copy (KC-0185) before it leaves Sky: AES-256-GCM under the scope's own key —
// a tenant's `backup` key derived from its DEK (KC-0181), or for `db` the dump key derived from the master
// key. Bytes = magic "CKB1" ‖ master-key version u32 (0 for a tenant) ‖ nonce 12 ‖ ciphertext ‖ tag 16. The
// header, the scope and the snapshot id are associated data, so a copy opens only with its own key, under
// its own name, with its own version. Every failure is one KopiFejl with one fixed message.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Structural (Sky's modules never import each other): hemmeligheder/skjul.ts' Hemmelig fits. */
export type Noegle = { aaben(): Buffer };
export type Navn = { omfang: string; id: string };

export class KopiFejl extends Error {
  constructor() { super('kopien kunne ikke åbnes'); this.name = 'KopiFejl'; }
}

const MAGI = Buffer.from('CKB1', 'ascii');
const HOVED = 8;
const NONCE = 12;
const TAG = 16;

const aad = (hoved: Buffer, n: Navn) => Buffer.concat([hoved, Buffer.from(`\0clawco-sky/kopi/v1\0${n.omfang}\0${n.id}`, 'utf8')]);

export function forsegl(noegle: Noegle, navn: Navn, data: Buffer, version = 0): Buffer {
  const hoved = Buffer.alloc(HOVED);
  MAGI.copy(hoved);
  hoved.writeUInt32BE(version, 4);
  const nonce = randomBytes(NONCE);
  const c = createCipheriv('aes-256-gcm', noegle.aaben(), nonce);
  c.setAAD(aad(hoved, navn));
  const ct = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([hoved, nonce, ct, c.getAuthTag()]);
}

/** The master-key version a copy says it was sealed under (to pick the key); verified by aabn. */
export function kekVersion(blob: Buffer): number {
  if (blob.length < HOVED + NONCE + TAG || !blob.subarray(0, 4).equals(MAGI)) throw new KopiFejl();
  return blob.readUInt32BE(4);
}

export function aabn(noegle: Noegle, navn: Navn, blob: Buffer): Buffer {
  kekVersion(blob);
  try {
    const d = createDecipheriv('aes-256-gcm', noegle.aaben(), blob.subarray(HOVED, HOVED + NONCE));
    d.setAAD(aad(blob.subarray(0, HOVED), navn));
    d.setAuthTag(blob.subarray(blob.length - TAG));
    return Buffer.concat([d.update(blob.subarray(HOVED + NONCE, blob.length - TAG)), d.final()]);
  } catch {
    throw new KopiFejl();
  }
}
