// KC-0187: the tenant's error reports. Off unless KC_FEJLRAPPORT_DSN is set: Sky sets it only when the owner switched
// "Send fejlrapporter" on (default off, the opt-in G2/KC-0167 promises); a home install sets it itself or never.
// The scrubber and the envelope are fejlrapport-kerne.ts (byte-identical to Sky's copy).
import { laesDsn, lavFejlrapport, ingenFejlrapport, sentryTransport, type Fejlrapport, type Transport } from './fejlrapport-kerne.ts';

export type { Fejlrapport };

export function tenantFejlrapport(env: Record<string, string | undefined>, o: { release: string; lavTransport?: (dsn: string) => Transport; log?: (linje: string) => void }): Fejlrapport {
  const dsn = (env['KC_FEJLRAPPORT_DSN'] ?? '').trim();
  if (!dsn) return ingenFejlrapport();
  const log = o.log ?? ((l: string) => { console.error(l); });
  if (!laesDsn(dsn)) {
    log('fejlrapporter er slået fra: KC_FEJLRAPPORT_DSN er ugyldig (en https-DSN med offentlig nøgle og projektnummer)');
    return ingenFejlrapport();
  }
  const tenant = (env['KC_KONTO_TENANT'] ?? '').trim();
  return lavFejlrapport({
    transport: (o.lavTransport ?? ((d: string) => sentryTransport(d)))(dsn),
    release: o.release,
    miljoe: env['KC_KONTO_TENANT'] ? 'tenant' : 'hjemme',
    ...(tenant ? { tenant } : {}),
    log,
  });
}
