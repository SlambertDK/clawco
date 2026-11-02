// KC-0134: a failed mail connection as one Danish sentence and a health
// status. The texts are fixed: never the server's own words (untrusted, and
// a server may echo what it was sent) and never the password.

import type { HelbredStatus } from '../types.ts';
import { PinFejl } from './presets.ts';

export const FEJLTEKST = {
  adgangskode: 'Forkert adgangskode. Brug en app-adgangskode fra din mailudbyder; med Proton er det adgangskoden, Bridge viser.',
  bridge: 'Bridge kører ikke. Start Proton Mail Bridge på denne maskine, og prøv igen.',
  svarer: 'Mailserveren svarer ikke. Tjek serveradressen og din internetforbindelse.',
  certifikat: 'Mailserverens certifikat kunne ikke bekræftes, så Clawco forbinder ikke.',
  pin: 'Bridge-certifikatet er et andet end sidst. Har du selv geninstalleret Bridge, så forbind igen.',
  kryptering: 'Mailserveren tilbyder ikke kryptering, så Clawco forbinder ikke.',
  ukendt: 'Mailen kunne ikke hentes.',
} as const;

export type Klassifikation = { status: Extract<HelbredStatus, 'log-ind-igen' | 'nede'>; tekst: string; http: 400 | 502 };

const SVARER = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ETIMEOUT', 'CONNECT_TIMEOUT', 'GREETING_TIMEOUT', 'UPGRADE_TIMEOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'EPIPE', 'EConnectionClosed', 'NoConnection']);
const CERTIFIKAT = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/;

/** The error and its causes, outermost first (imapflow and Node wrap errors). */
function kaede(err: unknown): Record<string, unknown>[] {
  const ud: Record<string, unknown>[] = [];
  let e = err;
  while (typeof e === 'object' && e !== null && ud.length < 5) { ud.push(e as Record<string, unknown>); e = (e as { cause?: unknown }).cause; }
  return ud;
}

export function klassificer(err: unknown, o: { loopback: boolean }): Klassifikation {
  const led = kaede(err);
  const nede = (tekst: string): Klassifikation => ({ status: 'nede', tekst, http: 502 });
  if (led.some((e) => e instanceof PinFejl)) return { status: 'log-ind-igen', tekst: FEJLTEKST.pin, http: 400 };
  if (led.some((e) => e['authenticationFailed'] === true)) return { status: 'log-ind-igen', tekst: FEJLTEKST.adgangskode, http: 400 };
  const koder = led.map((e) => (typeof e['code'] === 'string' ? e['code'] : ''));
  if (koder.some((c) => CERTIFIKAT.test(c))) return nede(FEJLTEKST.certifikat);
  if (o.loopback && koder.includes('ECONNREFUSED')) return nede(FEJLTEKST.bridge);
  if (koder.some((c) => SVARER.has(c))) return nede(FEJLTEKST.svarer);
  if (led.some((e) => typeof e['message'] === 'string' && /does not support STARTTLS/.test(e['message']))) return nede(FEJLTEKST.kryptering);
  return nede(FEJLTEKST.ukendt);
}
