// Sky's control call to a tenant (KC-0184): POST /intern/husstand/medlem on the tenant's private address, signed with
// the gateway key under the control prefix (signer.ts signerKontrol: `k1.`, audience clawco-tenant-kontrol, bound to
// tenant, method, path and the exact body, with a nonce the tenant accepts once). It carries no person: no
// Clawco-Konto header, so the tenant's identity path can never mistake it for one, and a person's header can never be
// replayed as one. It leaves from Sky's own process, i.e. from the gateway's address on the tenant network; the
// gateway itself never forwards /intern/ from outside (forbud.ts). Without the key nothing is sent.
//
// The household changes (`medlem`) are called only by konto/medlemskab.ts, after an owner's own click (accept, remove,
// role change) or a member's own "Forlad": never Hermes, chat, voice, the fleet or a script (sky/test/konto/medlemskab.test.ts
// holds that). `hent` (KC-0203) is the read-only twin: GET with no body, for the daily beta measures (server.ts hands it
// to beta/hent.ts); it can change nothing in a tenant. Both read the tenant's answer bounded (KC-0273, delt/begraenset.ts).
import { randomBytes } from 'node:crypto';
import { LEJERSVAR_MAKS, laesBegraenset } from '../delt/begraenset.ts';
import { KONTROL_HEADER, kropHash, signerKontrol } from './signer.ts';
import type { GatewayNoegle } from './noegle.ts';

export const INTERN_STI = '/intern/husstand/medlem';

export type MedlemOp =
  | { op: 'tilfoej'; email: string; navn: string; rolle: string }
  | { op: 'fjern'; email: string }
  | { op: 'rolle'; email: string; rolle: string };

export type HusstandKald = { medlem(t: { slug: string; adresse: string }, op: MedlemOp): Promise<{ aendret: boolean }> };
/** KC-0203: a signed GET of a tenant's own read-only route (the beta measures); the JSON of a 200 answer. */
export type KontrolHent = { hent(t: { slug: string; adresse: string }, sti: string): Promise<unknown> };

export function kontrolKald(o: { noegle: GatewayNoegle | null; fetch?: typeof fetch; nu?: () => Date; nonce?: () => string; timeoutMs?: number }): HusstandKald & KontrolHent {
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
      const tekst = await laesBegraenset(r, LEJERSVAR_MAKS);
      let svar: unknown = null;
      try { svar = JSON.parse(tekst); } catch { /* judged below */ }
      const s = svar as { ok?: unknown; aendret?: unknown } | null;
      if (r.status !== 200 || s?.ok !== true) throw new Error(`kundens Clawco svarede ${r.status} på husstandsændringen`);
      return { aendret: s.aendret === true };
    },
    async hent(t, sti) {
      if (!o.noegle) throw new Error('ingen gateway-nøgle: Sky kan ikke tale med kundens Clawco');
      // No body: the signature binds the SHA-256 of nothing, which is what the tenant hashes for a GET.
      const header = signerKontrol(o.noegle.privat, { t: t.slug, m: 'GET', p: sti, h: kropHash(''), iat: Math.floor(nu().getTime() / 1000), n: nonce() });
      const r = await f(new URL(sti, t.adresse), { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeout), headers: { accept: 'application/json', [KONTROL_HEADER.toLowerCase()]: header } });
      if (r.status !== 200) throw new Error(`kundens Clawco svarede ${r.status} på ${sti}`);
      const tekst = await laesBegraenset(r, LEJERSVAR_MAKS);
      try { return JSON.parse(tekst); } catch { throw new Error(`kundens Clawco svarede ikke med JSON på ${sti}`); }
    },
  };
}
