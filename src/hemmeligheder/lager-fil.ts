// KC-0181: the tenant's encrypted model-key store, a NoegleLager (KC-0180) over $KC_DATA_DIR/hemmeligheder.enc.
// AES-256-GCM, one fresh nonce per write, the `lager` key from the file KC_HEMMELIGHEDER_FIL names. Sky derives
// that key from the tenant's data key and pipes it onto a tmpfs after every container start (sky/src/
// hemmeligheder/levering.ts), so it is never in an env var, an image or on the volume: a stolen disk or backup
// holds only this ciphertext. The key file is read on every call (a key delivered after start works at once;
// a missing or junk one fails closed). Messages never contain a key, a provider's value or the file's bytes.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NoegleLager } from '../agent/noeglelager.ts';

export const LAGERFIL = 'hemmeligheder.enc';
const TMP = `.${LAGERFIL}.tmp`;
/**
 * Names in the data dir that must stay out of the export (KC-0146) and out of any user-visible file list:
 * the key file and its temp name. A backup still copies the volume, where it is encrypted a second time.
 */
export const SKJULTE_DATAFILER: readonly string[] = [LAGERFIL, TMP];

const MAGIC = Buffer.from('CLL1', 'utf8');
const NONCE = 12;
const TAG = 16;
const AAD = Buffer.from('clawco/lager-fil/v1', 'utf8');
const B64_32 = /^[A-Za-z0-9+/]{43}=$/;

const ikkeAaben = (): Error => new Error('nøglefilen kunne ikke åbnes');

async function laesNoegle(noeglefil: string): Promise<Buffer> {
  let tekst: string;
  try {
    tekst = (await readFile(noeglefil, 'utf8')).trim();
  } catch {
    throw new Error('nøglen er ikke leveret endnu — nøglefilen mangler');
  }
  if (!B64_32.test(tekst)) throw new Error('nøglen er ugyldig: skal være 32 bytes i base64');
  return Buffer.from(tekst, 'base64');
}

function forsegl(noegle: Buffer, indhold: Record<string, string>): Buffer {
  const nonce = randomBytes(NONCE);
  const c = createCipheriv('aes-256-gcm', noegle, nonce);
  c.setAAD(AAD);
  const ct = Buffer.concat([c.update(JSON.stringify({ v: 1, noegler: indhold }), 'utf8'), c.final()]);
  return Buffer.concat([MAGIC, nonce, ct, c.getAuthTag()]);
}

function aabn(noegle: Buffer, raa: Buffer): Record<string, string> {
  if (raa.length < MAGIC.length + NONCE + TAG || !raa.subarray(0, MAGIC.length).equals(MAGIC)) throw ikkeAaben();
  try {
    const d = createDecipheriv('aes-256-gcm', noegle, raa.subarray(MAGIC.length, MAGIC.length + NONCE));
    d.setAAD(AAD);
    d.setAuthTag(raa.subarray(raa.length - TAG));
    const tekst = Buffer.concat([d.update(raa.subarray(MAGIC.length + NONCE, raa.length - TAG)), d.final()]).toString('utf8');
    const j = JSON.parse(tekst) as { v?: number; noegler?: Record<string, unknown> };
    if (j.v !== 1 || !j.noegler || typeof j.noegler !== 'object') throw ikkeAaben();
    const ud: Record<string, string> = {};
    for (const [k, v] of Object.entries(j.noegler)) if (typeof v === 'string') ud[k] = v;
    return ud;
  } catch {
    throw ikkeAaben();
  }
}

export function filNoegleLager(o: { udbydere: readonly string[]; dataDir: string; noeglefil: string }): NoegleLager {
  const fil = path.join(o.dataDir, LAGERFIL);
  const kendt = (udbyder: string): void => {
    if (!o.udbydere.includes(udbyder)) throw new Error(`ukendt udbyder: ${udbyder.slice(0, 40)}`);
  };
  const laes = async (noegle: Buffer): Promise<Record<string, string>> => {
    let raa: Buffer;
    try { raa = await readFile(fil); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw new Error('nøglefilen kunne ikke læses');
    }
    return aabn(noegle, raa);
  };
  // Saves in this process run one after the other, so two quick saves never lose one another's key.
  let koe: Promise<unknown> = Promise.resolve();
  return {
    async hent(udbyder) {
      kendt(udbyder);
      const v = ((await laes(await laesNoegle(o.noeglefil)))[udbyder] ?? '').trim();
      return v || undefined;
    },
    async findes(udbyder) {
      return (await this.hent(udbyder)) !== undefined;
    },
    async saet(udbyder, noegle) {
      kendt(udbyder);
      const v = noegle.trim();
      if (!v) throw new Error('nøglen er tom');
      await opdater((nu) => { nu[udbyder] = v; return true; });
      return { laengde: v.length };
    },
    async fjern(udbyder) {
      kendt(udbyder);
      await opdater((nu) => { if (!Object.hasOwn(nu, udbyder)) return false; delete nu[udbyder]; return true; });
    },
  };

  /** Read, change, re-encrypt and rename, one after the other; `aendr` answers false when there is nothing to write. */
  function opdater(aendr: (nu: Record<string, string>) => boolean): Promise<void> {
    const arbejde = async (): Promise<void> => {
      const k = await laesNoegle(o.noeglefil);
      try {
        const nu = await laes(k);
        if (!aendr(nu)) return;
        await mkdir(o.dataDir, { recursive: true, mode: 0o700 });
        const tmp = path.join(o.dataDir, TMP);
        await writeFile(tmp, forsegl(k, nu), { mode: 0o600 });
        await chmod(tmp, 0o600);
        await rename(tmp, fil);
      } catch (e) {
        await rm(path.join(o.dataDir, TMP), { force: true });
        throw e;
      } finally {
        k.fill(0);
      }
    };
    const p = koe.then(arbejde, arbejde);
    koe = p.catch(() => undefined);
    return p;
  }
}
