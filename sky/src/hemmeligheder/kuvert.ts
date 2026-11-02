// The key envelope (KC-0181): each tenant's data key (DEK, 32 random bytes) is stored only wrapped
// under the master key with AES-256-GCM. Envelope bytes = nonce (12, fresh per wrap) ‖ ciphertext (32)
// ‖ tag (16). The tenant id and the KEK version are the associated data, so an envelope moved to
// another tenant's row or relabelled to another version does not open. Every failure is the same
// KuvertFejl with one fixed message (fail closed; nothing about the key or why).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { kekForVersion, type Noeglering } from './masternoegle.ts';
import { skjul, type Hemmelig } from './skjul.ts';

export type Kuvert = { kuvert: Buffer; version: number };

export class KuvertFejl extends Error {
  constructor() { super('kuverten kunne ikke åbnes'); this.name = 'KuvertFejl'; }
}

const NONCE = 12;
const TAG = 16;
const DEK = 32;
export const KUVERT_LAENGDE = NONCE + DEK + TAG;

const aad = (tenant: string, version: number): Buffer => Buffer.from(`clawco-sky/dek/v1\0${tenant}\0${version}`, 'utf8');

export function nyDataNoegle(): Hemmelig { return skjul(randomBytes(DEK)); }

/** Wraps a DEK under the ring's current KEK. */
export function pakInd(r: Noeglering, tenant: string, dek: Hemmelig): Kuvert {
  if (dek.laengde !== DEK) throw new Error('en datanøgle er 32 bytes');
  const { version, noegle } = r.aktuel;
  const nonce = randomBytes(NONCE);
  const c = createCipheriv('aes-256-gcm', noegle.aaben(), nonce);
  c.setAAD(aad(tenant, version));
  const ct = Buffer.concat([c.update(dek.aaben()), c.final()]);
  return { kuvert: Buffer.concat([nonce, ct, c.getAuthTag()]), version };
}

/** Opens an envelope with the KEK of its version (current or, during a rotation, previous). */
export function pakUd(r: Noeglering, tenant: string, k: Kuvert): Hemmelig {
  const kek = kekForVersion(r, k.version);
  if (!kek || k.kuvert.length !== KUVERT_LAENGDE) throw new KuvertFejl();
  try {
    const d = createDecipheriv('aes-256-gcm', kek.aaben(), k.kuvert.subarray(0, NONCE));
    d.setAAD(aad(tenant, k.version));
    d.setAuthTag(k.kuvert.subarray(NONCE + DEK));
    return skjul(Buffer.concat([d.update(k.kuvert.subarray(NONCE, NONCE + DEK)), d.final()]));
  } catch {
    throw new KuvertFejl();
  }
}
