// The sign-up step to show (KC-0198): a pure function of server state — the account, its entitlement (KC-0192)
// and its tenant (KC-0182). The page never stores the step, so closing the tab, coming back on another device
// or paying while the webhook is late all land on the right screen. Invariant: "Åbn Clawco" only when the
// tenant is klar AND the entitlement is a trial or active (a gift from the beta is active).
// The entitlement and tenant states are written out here because tilmelding/ never imports abonnement/ or
// fleet/ (sky/test/aftryk.test.ts); a typecheck in sky/test/tilmelding/trin.test.ts fails if they drift.
export type RettighedsStatus = 'proeve' | 'aktiv' | 'forfalden' | 'pause' | 'opsagt' | 'ingen';
export type Tilstand = 'bestilt' | 'startet' | 'sund' | 'i-gateway' | 'klar' | 'afvikles' | 'slettet';

/** Not provisioning for longer than this (from bestilt) is slow: the person is told and Henrik is alerted. */
export const LANGSOM_MS = 120_000;

/** null = nobody logged in. profilKlar = country, language and the current consent versions are recorded.
 *  genaccept (KC-0204) = the profile was done once but a text has a newer version since: one blocking screen. */
export type KontoTilstand = { profilKlar: boolean; genaccept?: boolean };
/** betalt = the person is back from a Checkout Stripe calls complete (the webhook may not have arrived). */
export type RettighedTilstand = { status: RettighedsStatus; kilde: 'stripe' | 'gave'; betalt: boolean };
export type TenantTilstand = { tilstand: Tilstand; fejl: boolean; bestilt: Date } | null;

/** The provisioning phases shown, in order: `bestilles` before the reconciler has made the row. */
export const FASER = ['bestilles', 'bestilt', 'startet', 'sund', 'i-gateway'] as const;
export type Fase = (typeof FASER)[number];

export type Visning =
  | { trin: 'konto' }
  | { trin: 'profil' }
  | { trin: 'samtykke' }
  | { trin: 'invitation' }
  | { trin: 'plan' }
  | { trin: 'betaling' }
  | { trin: 'abonnement' }
  | { trin: 'klargoering'; fase: Fase; status: 'i-gang' | 'langsom' | 'fejlet' }
  | { trin: 'aabn' }
  | { trin: 'slettes' };

export function tilmeldingsTrin(
  konto: KontoTilstand | null,
  rettighed: RettighedTilstand,
  tenant: TenantTilstand,
  o: { tilstand: 'invitation' | 'open'; nu: Date },
): Visning {
  if (!konto) return { trin: 'konto' };
  if (!konto.profilKlar) return konto.genaccept ? { trin: 'samtykke' } : { trin: 'profil' };
  const s = rettighed.status;
  if (s === 'pause' || s === 'forfalden') return { trin: 'abonnement' };
  if (s !== 'proeve' && s !== 'aktiv') {
    if (rettighed.betalt) return { trin: 'betaling' };
    return o.tilstand === 'invitation' ? { trin: 'invitation' } : { trin: 'plan' };
  }
  if (!tenant) return { trin: 'klargoering', fase: 'bestilles', status: 'i-gang' };
  if (tenant.tilstand === 'afvikles' || tenant.tilstand === 'slettet') return { trin: 'slettes' };
  if (tenant.tilstand === 'klar') return { trin: 'aabn' };
  const status = tenant.fejl ? 'fejlet' : o.nu.getTime() - tenant.bestilt.getTime() > LANGSOM_MS ? 'langsom' : 'i-gang';
  return { trin: 'klargoering', fase: tenant.tilstand, status };
}

/** One string per distinct screen; the page polls the status endpoint and reloads when it changes. */
export function visningsNoegle(v: Visning): string {
  return v.trin === 'klargoering' ? `${v.trin}:${v.fase}:${v.status}` : v.trin;
}
