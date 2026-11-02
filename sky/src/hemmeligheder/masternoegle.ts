// Sky's master key (KEK, KC-0181, zero-cost rule D18: no paid KMS). 32 random bytes, base64, in the
// control plane's .env as SKY_MASTERNOEGLE (made on the host by sky/scripts/ny-masternoegle.sh, never
// seen by an agent). It only wraps the tenants' data keys; it never leaves this process.
// Rotation: SKY_MASTERNOEGLE_VERSION names the current key's version; while the re-wrap job runs,
// SKY_MASTERNOEGLE_FORRIGE holds the previous key (version − 1), accepted for unwrapping only.
// Fail-closed (AGENTS §0 r7): missing or invalid → Sky does not start; errors name keys, never values.
import { skjul, type Hemmelig } from './skjul.ts';

export type Noeglering = {
  aktuel: { version: number; noegle: Hemmelig };
  forrige?: { version: number; noegle: Hemmelig };
};

export const MASTERNOEGLE_NAVNE = ['SKY_MASTERNOEGLE', 'SKY_MASTERNOEGLE_VERSION', 'SKY_MASTERNOEGLE_FORRIGE'] as const;

/** Standard base64 of exactly 32 bytes (44 characters, one '='). */
const B64_32 = /^[A-Za-z0-9+/]{43}=$/;

function noegle(env: Record<string, string | undefined>, navn: string, kraevet: boolean): Hemmelig | undefined {
  const v = (env[navn] ?? '').trim();
  if (!v) {
    if (kraevet) throw new Error(`${navn} mangler — Sky starter ikke uden den (sky/scripts/ny-masternoegle.sh, se sky/deploy/NOEGLE.md)`);
    return undefined;
  }
  if (!B64_32.test(v)) throw new Error(`${navn} er ugyldig: skal være 32 bytes i base64 — Sky starter ikke`);
  return skjul(Buffer.from(v, 'base64'));
}

/**
 * Reads the master key ring from `env` and then deletes the three names from that object, so a child
 * process (the Docker CLI, scripts) started with the default environment never inherits them.
 */
export function laesMasternoegle(env: Record<string, string | undefined>): Noeglering {
  const aktuel = noegle(env, 'SKY_MASTERNOEGLE', true)!;
  const vTekst = (env['SKY_MASTERNOEGLE_VERSION'] ?? '').trim();
  const version = vTekst ? Number(vTekst) : 1;
  if (!/^\d+$/.test(vTekst || '1') || !Number.isSafeInteger(version) || version < 1) throw new Error('SKY_MASTERNOEGLE_VERSION er ugyldig: skal være et heltal fra 1 — Sky starter ikke');
  const forrige = noegle(env, 'SKY_MASTERNOEGLE_FORRIGE', false);
  if (forrige && version < 2) throw new Error('SKY_MASTERNOEGLE_FORRIGE kræver SKY_MASTERNOEGLE_VERSION på mindst 2 — Sky starter ikke');
  if (forrige && forrige.aaben().equals(aktuel.aaben())) throw new Error('SKY_MASTERNOEGLE_FORRIGE er den samme som SKY_MASTERNOEGLE — Sky starter ikke');
  for (const n of MASTERNOEGLE_NAVNE) delete env[n];
  return { aktuel: { version, noegle: aktuel }, ...(forrige ? { forrige: { version: version - 1, noegle: forrige } } : {}) };
}

/** The KEK for an envelope's version, or undefined when this ring does not hold it. */
export function kekForVersion(r: Noeglering, version: number): Hemmelig | undefined {
  if (version === r.aktuel.version) return r.aktuel.noegle;
  if (r.forrige && version === r.forrige.version) return r.forrige.noegle;
  return undefined;
}
