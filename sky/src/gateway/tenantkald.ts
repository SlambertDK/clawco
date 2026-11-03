// Sky calling a tenant's own routes as its owner (KC-0206): the KC-0146 "Hent alt" (GET /api/tillid/eksport) and
// "Slet alt" (POST /api/tillid/slet-alt) inside the tenant container, never re-implemented here. The request carries
// the same Clawco-Konto signature the gateway puts on every forwarded request (KC-0179, signer.ts) and leaves from
// Sky's own process, i.e. from the gateway's address on the tenant network, so the tenant's existing check (only the
// gateway key, only from the gateway's address, only for this tenant, only the household's owner for these routes)
// is the whole authorisation — no new tenant route, nothing a client can reach. Without the key nothing is sent.
// Never reachable from Hermes, chat or voice: only the account app's Hent alt and the fleet's deprovisioning call it.
// KC-0273 (D5): every answer is read bounded (delt/begraenset.ts): the JSON ones at 64 KiB, the export at EKSPORT_MAKS.
import { LEJERSVAR_MAKS, laesBegraenset, laesBegraensetBytes } from '../delt/begraenset.ts';
import { signerKonto } from './signer.ts';
import type { GatewayNoegle } from './noegle.ts';

export type Ejer = { slug: string; adresse: string; kontoId: number; email: string };

/** KC-0188: support on and off. `stoetteStart` hands the tenant Sky's signed bevis (signer.ts) for a grant its owner
 *  just made; `stoetteSlut` tells it the owner turned support off. Both as the owner, both only from Sky. */
export type TenantKald = { eksport(e: Ejer): Promise<Buffer>; sletAlt(e: Ejer): Promise<void>; stoetteStart(e: Ejer, bevis: string): Promise<void>; stoetteSlut(e: Ejer): Promise<void> };

/** The largest "Hent alt" zip Sky holds for an owner (in memory, on its way to the browser). */
export const EKSPORT_MAKS = 256 * 1024 * 1024;

/** A JSON answer read bounded; null when it is not JSON (the caller judges the status and the field). */
async function jsonSvar(r: Response): Promise<unknown> {
  const tekst = await laesBegraenset(r, LEJERSVAR_MAKS);
  try { return JSON.parse(tekst); } catch { return null; }
}

export function tenantKald(o: { noegle: GatewayNoegle | null; fetch?: typeof fetch; nu?: () => Date; timeoutMs?: number; eksportMaks?: number }): TenantKald {
  const f = o.fetch ?? fetch;
  const nu = o.nu ?? (() => new Date());
  const timeout = o.timeoutMs ?? 120_000;
  function kald(e: Ejer, sti: string, init: RequestInit): Promise<Response> {
    if (!o.noegle) throw new Error('ingen gateway-nøgle: Sky kan ikke tale med kundens Clawco');
    const konto = signerKonto(o.noegle.privat, { t: e.slug, k: String(e.kontoId), e: e.email, iat: Math.floor(nu().getTime() / 1000), m: init.method ?? 'GET', p: new URL(sti, e.adresse).pathname });
    return f(new URL(sti, e.adresse), { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeout), headers: { ...(init.headers as Record<string, string> | undefined), 'clawco-konto': konto } });
  }
  return {
    async eksport(e) {
      const r = await kald(e, '/api/tillid/eksport', { method: 'GET' });
      const zip = await laesBegraensetBytes(r, o.eksportMaks ?? EKSPORT_MAKS);
      if (r.status !== 200 || r.headers.get('content-type') !== 'application/zip' || zip.length < 22) throw new Error(`kundens Clawco svarede ${r.status} på Hent alt`);
      return zip;
    },
    async sletAlt(e) {
      const r = await kald(e, '/api/tillid/slet-alt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bekraeft: 'SLET' }) });
      const svar = await jsonSvar(r);
      if (r.status !== 200 || (svar as { slettet?: unknown } | null)?.slettet !== true) throw new Error(`kundens Clawco svarede ${r.status} på Slet alt`);
    },
    async stoetteStart(e, bevis) {
      const r = await kald(e, '/api/stoette/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bevis }) });
      const svar = await jsonSvar(r);
      if (r.status !== 200 || (svar as { aktiv?: unknown } | null)?.aktiv !== true) throw new Error(`kundens Clawco svarede ${r.status} på støtteadgang`);
    },
    async stoetteSlut(e) {
      const r = await kald(e, '/api/stoette/slaa-fra', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const svar = await jsonSvar(r);
      if (r.status !== 200 || (svar as { aktiv?: unknown } | null)?.aktiv !== false) throw new Error(`kundens Clawco svarede ${r.status} på slå support fra`);
    },
  };
}
