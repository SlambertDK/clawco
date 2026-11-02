// Sky's control call to a tenant (KC-0184): POST /intern/husstand/medlem on the tenant's private address, signed with
// the gateway key under the control prefix (signer.ts signerKontrol: `k1.`, audience clawco-tenant-kontrol, bound to
// tenant, method, path and the exact body, with a nonce the tenant accepts once). It carries no person: no
// Clawco-Konto header, so the tenant's identity path can never mistake it for one, and a person's header can never be
// replayed as one. It leaves from Sky's own process, i.e. from the gateway's address on the tenant network; the
// gateway itself never forwards /intern/ from outside (forbud.ts). Without the key nothing is sent.
//
// Only konto/medlemskab.ts calls it, after an owner's own click (accept, remove, role change) or a member's own
// "Forlad": never Hermes, chat, voice, the fleet or a script (sky/test/konto/medlemskab.test.ts holds that).
import { randomBytes } from 'node:crypto';
import { KONTROL_HEADER, kropHash, signerKontrol } from './signer.ts';
import type { GatewayNoegle } from './noegle.ts';

export const INTERN_STI = '/intern/husstand/medlem';

export type MedlemOp =
  | { op: 'tilfoej'; email: string; navn: string; rolle: string }
  | { op: 'fjern'; email: string }
  | { op: 'rolle'; email: string; rolle: string };

export type HusstandKald = { medlem(t: { slug: string; adresse: string }, op: MedlemOp): Promise<{ aendret: boolean }> };

export function kontrolKald(o: { noegle: GatewayNoegle | null; fetch?: typeof fetch; nu?: () => Date; nonce?: () => string; timeoutMs?: number }): HusstandKald {
  const f = o.fetch ?? fetch;
  const nu = o.nu ?? (() => new Date());
  const nonce = o.nonce ?? (() => randomBytes(8).toString('hex'));
  const timeout = o.timeoutMs ?? 15_000;
  return {
    async medlem(t, op) {
      if (!o.noegle) throw new Error('ingen gateway-nøgle: Sky kan ikke tale med kundens Clawco');
      const krop = JSON.stringify(op);
      const header = signerKontrol(o.noegle.privat, { t: t.slug, m: 'POST', p: INTERN_STI, h: kropHash(krop), iat: Math.floor(nu().getTime() / 1000), n: nonce() });
      const r = await f(new URL(INTERN_STI, t.adresse), {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(timeout),
        headers: { 'content-type': 'application/json', [KONTROL_HEADER.toLowerCase()]: header }, body: krop,
      });
      const svar: unknown = await r.json().catch(() => null);
      const s = svar as { ok?: unknown; aendret?: unknown } | null;
      if (r.status !== 200 || s?.ok !== true) throw new Error(`kundens Clawco svarede ${r.status} på husstandsændringen`);
      return { aendret: s.aendret === true };
    },
  };
}
