// KC-0187 (spec D16): Sky's error reports — always on when SKY_FEJLRAPPORT_DSN is set (an EU Sentry project, or a
// self-hosted GlitchTip: only the DSN differs). No DSN = a no-op, never a crash. The scrubber and the envelope are
// fejlrapport-kerne.ts (byte-identical to the tenant's copy; Sky and the tenant share no import, KC-0176).
import { laesDsn, lavFejlrapport, ingenFejlrapport, sentryTransport, type Fejlrapport, type Transport } from './fejlrapport-kerne.ts';

export type { Fejlrapport };

/** Reads (and removes from `env`, so docker and pg_dump never inherit it) the DSN. `grund` is the start log's line:
 *  where reports go (the host, which names the region) or why they are off; never the DSN's key part. */
export function skyFejlrapport(env: Record<string, string | undefined>, o: { release: string; lavTransport?: (dsn: string) => Transport; log?: (linje: string) => void }): { rapport: Fejlrapport; grund: string } {
  const dsn = (env['SKY_FEJLRAPPORT_DSN'] ?? '').trim();
  delete env['SKY_FEJLRAPPORT_DSN'];
  if (!dsn) return { rapport: ingenFejlrapport(), grund: 'fejlrapporter: ingen (SKY_FEJLRAPPORT_DSN ikke sat)' };
  const d = laesDsn(dsn);
  if (!d) return { rapport: ingenFejlrapport(), grund: 'fejlrapporter er slået fra: SKY_FEJLRAPPORT_DSN er ugyldig (en https-DSN med offentlig nøgle og projektnummer)' };
  const rapport = lavFejlrapport({ transport: (o.lavTransport ?? ((x: string) => sentryTransport(x)))(dsn), release: o.release, miljoe: 'sky', ...(o.log ? { log: o.log } : {}) });
  return { rapport, grund: `fejlrapporter til ${new URL(d.endepunkt).host} (renset, uden indhold)` };
}
