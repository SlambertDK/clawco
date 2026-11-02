// Shared HTTP setup for the billing routes (KC-0191, KC-0209): the Hono app over the fake Stripe client, the fake mail
// and a database. Login and household role are seams (konto/ is not imported by abonnement/); here a cookie names the
// account and the CSRF token is "csrf-<id>".
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { EMAIL, HEMMELIGHED, PUBLIC, type Stativ } from './stativ.ts';
import { falskPost, type FalskPost } from '../../src/delt/post.ts';
import { abonnementRuter, type AbonnementDeps, type Indlogget } from '../../src/abonnement/ruter.ts';

export const VILKAAR_VERSION = '0.1-udkast';
export const VILKAAR_URL = 'https://clawco.example.test/vilkaar';
export const SAELGER = 'Sælger Eksempel (personligt drevet), Eksempelvej 1, 1000 By, Danmark.';
export type Rolle = { rolle: 'ejer' | 'medlem'; antal: number } | null;

/** The consumer-rights seams of AbonnementDeps, faked. */
export function forbrugerDeps(post: FalskPost = falskPost(), sprog: 'da' | 'en' = 'da'): Pick<AbonnementDeps, 'post' | 'saelger' | 'vilkaar' | 'kontakt'> {
  return {
    post,
    saelger: () => SAELGER,
    vilkaar: { version: VILKAAR_VERSION, url: (s) => (s === 'en' ? 'https://clawco.example.test/en/vilkaar' : VILKAAR_URL) },
    kontakt: async () => ({ email: EMAIL, sprog }),
  };
}

/** Both boxes ticked, as the statement page sends them. */
export const SAMTYKKE = { vilkaar: VILKAAR_VERSION, straks: 'ja' };

export function app(s: Stativ, over: Partial<AbonnementDeps> & { rolle?: Rolle; sprog?: 'da' | 'en'; post?: FalskPost } = {}) {
  const post = over.post ?? falskPost();
  const sprog = over.sprog ?? 'da';
  const hvem = async (c: Context): Promise<Indlogget | null> => {
    const id = Number(getCookie(c, 'konto') ?? '');
    return id === s.kontoId ? { kontoId: id, email: EMAIL, sprog, csrf: `csrf-${id}` } : null;
  };
  const { rolle: _r, sprog: _s, post: _p, ...resten } = over;
  const d: AbonnementDeps = {
    db: s.db, klient: s.klient, priser: s.priser, publicUrl: PUBLIC, juridisk: { vilkaarUrl: null, privatlivUrl: null, fortrydelsesTekst: null },
    webhookHemmelighed: HEMMELIGHED, nu: s.u.nu, taeller: { afvist: 0 },
    adgang: {
      login: hvem,
      beskyttet: async (c, csrf) => {
        if (c.req.header('origin') !== PUBLIC) return null;
        const l = await hvem(c);
        return l && csrf === l.csrf ? l : null;
      },
    },
    husstand: async () => (over.rolle === undefined ? null : over.rolle),
    tilPlan: async () => true,
    ...forbrugerDeps(post, sprog),
    ...resten,
  };
  const a = abonnementRuter(d);
  const hent = (sti: string, init: RequestInit = {}) => a.request(`${PUBLIC}${sti}`, init);
  const kake = { cookie: `konto=${s.kontoId}` };
  const post_ = (sti: string, felter: Record<string, string>, opts: { origin?: string; csrf?: string } = {}) => hent(sti, {
    method: 'POST',
    headers: { ...kake, origin: opts.origin ?? PUBLIC, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf: opts.csrf ?? `csrf-${s.kontoId}`, ...felter }),
  });
  return {
    d,
    side: (sti: string, logget = true) => hent(sti, { headers: logget ? kake : {} }),
    /** The statement page's POST. Both boxes are ticked unless `samtykke` says otherwise. */
    vaelg: (felter: Record<string, string>, opts: { origin?: string; csrf?: string; samtykke?: Record<string, string> | null } = {}) =>
      post_('/api/abonnement/checkout', { ...(opts.samtykke === null ? {} : (opts.samtykke ?? SAMTYKKE)), ...felter }, opts),
    /** Any state-changing POST of the billing app, with Origin and the CSRF token. */
    send: post_,
    udbakke: post,
    webhook: (raw: Uint8Array, signatur: string) => hent('/api/abonnement/webhook', { method: 'POST', headers: { 'stripe-signature': signatur, 'content-type': 'application/json' }, body: raw }),
  };
}
