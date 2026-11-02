// The Stripe customer portal as code (KC-0195). Its configuration is a pure function of config/priser.json and the
// public URL: plan change between the four prices (Solo/Husstand × month/year) — an upgrade prorated at once, a downgrade
// or a shorter interval at the period end (so no credit ever arises) — and a trial that stays a trial, cancel at period end with Stripe's own reason list, invoice history, card update, and the customer's email,
// name, address and tax id. stripe:opsaet creates or updates it (opsaet.ts), so test and live match; a fingerprint of the
// content in metadata.clawco_konfig makes a second run write nothing. Sessions are opened only on this configuration,
// never on the shared account's default (ShelfAtlas', G6). Depends on the BetalingsKlient interface only.
import { createHash } from 'node:crypto';
import type Stripe from 'stripe';
import type { Priser } from './priser.ts';
import { CLAWCO_MAERKE } from './stripe-klient.ts';
import type { BetalingsKlient } from './stripe-klient.ts';
import { lookupKey, produktId } from './opsaet.ts';

export type PortalParams = Stripe.BillingPortal.ConfigurationCreateParams;

export type PortalSkridt =
  | { type: 'opret-portal'; params: PortalParams; idempotensNoegle: string }
  | { type: 'opdater-portal'; id: string; params: PortalParams }
  | { type: 'deaktiver-portal'; id: string };

/** `venter`: a price is not in Stripe yet (a dry run before the first --anvend). */
export type PortalPlan = { status: 'venter'; mangler: string[] } | { status: 'klar'; skridt: PortalSkridt[] };

/** Stripe's own cancellation reasons (no free text of ours). */
const GRUNDE = ['too_expensive', 'missing_features', 'switched_service', 'unused', 'customer_service', 'too_complex', 'low_quality', 'other'] as const;
const INTERVALLER = ['maaned', 'aar'] as const;

const sha = (t: string): string => createHash('sha256').update(t).digest('hex').slice(0, 40);

/** Where Stripe sends the person back: the Abonnement page, which reads the entitlement the webhook wrote. */
export const portalReturUrl = (publicUrl: string): string => new URL('/konto/abonnement', publicUrl).href;

/** The expected configuration. `prisIder`: lookup key → the active price id holding it. */
export function byggPortalKonfiguration(p: Priser, prisIder: Record<string, string>, returUrl: string): PortalParams {
  const produkter = Object.keys(p.planer).map((plan) => ({
    product: produktId(plan),
    prices: INTERVALLER.map((i) => {
      const id = prisIder[lookupKey(plan, i)];
      if (!id) throw new Error(`ingen pris for ${lookupKey(plan, i)} i Stripe`);
      return id;
    }),
  }));
  const indhold: PortalParams = {
    name: 'Clawco',
    default_return_url: returUrl,
    features: {
      invoice_history: { enabled: true },
      // Also how a trial without a card adds one.
      payment_method_update: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ['email', 'name', 'address', 'tax_id'] },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price'],
        // A plan change never moves money back (KC-0209's invariant): a smaller plan or a shorter interval waits for the
        // period end, so a proration is only ever the difference an upgrade costs.
        proration_behavior: 'create_prorations',
        schedule_at_period_end: { conditions: [{ type: 'decreasing_item_amount' }, { type: 'shortening_interval' }] },
        trial_update_behavior: 'continue_trial',
        products: produkter,
      },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end',
        cancellation_reason: { enabled: true, options: [...GRUNDE] },
      },
    },
  };
  return { ...indhold, metadata: { [CLAWCO_MAERKE.noegle]: CLAWCO_MAERKE.vaerdi, clawco_konfig: sha(JSON.stringify(indhold)) } };
}

export async function planlaegPortal(p: Priser, klient: BetalingsKlient, returUrl: string): Promise<PortalPlan> {
  const ider: Record<string, string> = {};
  const mangler: string[] = [];
  for (const plan of Object.keys(p.planer)) {
    for (const i of INTERVALLER) {
      const pris = await klient.prisForLookupKey(lookupKey(plan, i));
      if (pris) ider[lookupKey(plan, i)] = pris.id; else mangler.push(lookupKey(plan, i));
    }
  }
  if (mangler.length) return { status: 'venter', mangler };
  const params = byggPortalKonfiguration(p, ider, returUrl);
  const alle = await klient.listPortalKonfigurationer();
  const aktive = alle.filter((k) => k.aktiv);
  const samme = aktive.find((k) => k.metadata['clawco_konfig'] === params.metadata?.['clawco_konfig']);
  const behold = samme ?? aktive[0];
  const skridt: PortalSkridt[] = [];
  if (!behold) {
    // The key hashes the content and every configuration so far, so a re-created one never replays a deactivated one.
    const idem = `clawco-portal-${sha(JSON.stringify([params.metadata?.['clawco_konfig'], alle.map((k) => [k.id, k.aktiv])]))}`;
    skridt.push({ type: 'opret-portal', params, idempotensNoegle: idem });
  } else if (!samme) {
    skridt.push({ type: 'opdater-portal', id: behold.id, params });
  }
  for (const k of aktive) if (k.id !== behold?.id) skridt.push({ type: 'deaktiver-portal', id: k.id });
  return { status: 'klar', skridt };
}

export async function anvendPortal(skridt: PortalSkridt[], klient: BetalingsKlient): Promise<void> {
  for (const s of skridt) {
    switch (s.type) {
      case 'opret-portal': await klient.opretPortalKonfiguration(s.params, s.idempotensNoegle); break;
      case 'opdater-portal': await klient.opdaterPortalKonfiguration(s.id, s.params); break;
      case 'deaktiver-portal': await klient.opdaterPortalKonfiguration(s.id, { active: false }); break;
    }
  }
}

/** Plan and apply in one (development's fake Stripe, tests). Throws while a price is missing. */
export async function opsaetPortal(p: Priser, klient: BetalingsKlient, returUrl: string): Promise<PortalSkridt[]> {
  const plan = await planlaegPortal(p, klient, returUrl);
  if (plan.status === 'venter') throw new Error(`kundeportalen venter på priserne: ${plan.mangler.join(', ')}`);
  await anvendPortal(plan.skridt, klient);
  return plan.skridt;
}

/** One Danish line per step (ids only). */
export function beskrivPortal(skridt: PortalSkridt[]): string[] {
  return skridt.map((s) => {
    switch (s.type) {
      case 'opret-portal': return 'opret konfiguration (Clawco: planskift mellem de fire priser, opsigelse ved periodens slutning, fakturaer, kort)';
      case 'opdater-portal': return `opdatér konfiguration ${s.id} (indholdet er ændret)`;
      case 'deaktiver-portal': return `deaktivér ekstra konfiguration ${s.id}`;
    }
  });
}

/** The configuration sessions are opened on: Clawco's active one, or null (setup not run — the caller refuses). */
export async function portalKonfiguration(klient: BetalingsKlient): Promise<string | null> {
  return (await klient.listPortalKonfigurationer()).find((k) => k.aktiv)?.id ?? null;
}
