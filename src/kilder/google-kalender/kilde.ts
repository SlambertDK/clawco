// The Google Calendar connector (KC-0133, spec §3 step 3, §5): "Log ind med
// Google" on the card, then every calendar of the account for the next seven
// days in Dagen (and through it Nu) — without Kira or scripts.
//
// Each install is its own Google app: the user's own OAuth client (client id +
// secret in the host's env file via the card's `miljoe` fields; no data passes
// us). Until it is set, the card walks through making it, one step at a time.
// The refresh token lives in hemmeligheder/google-kalender.json (KC-0132); the
// access token only in memory, refreshed 60 s before expiry and on a 401.
//
// Invariant (§0 r2/r7): the connector can never write to the calendar — scope
// calendar.readonly, no verbs, no act(). Missing client keys, an unknown
// return address or a failed exchange fail closed with an explanation in the language of the request (tekster.ts).

import { registrerHemmelighed } from '../../graenser/redaktion.ts';
import { KildeFejl, type Helbred, type Kilde, type KildeKontekst, type KildeKort } from '../types.ts';
import { googleOpsaetTrin } from '../google/opsaet.ts';
import { googleTekst } from '../google/tekster.ts';
import { kalenderTekst } from './tekster.ts';
import { laesUge } from './laes.ts';
import { byttKode, forny, GoogleFejl, KALENDER_KRAV, lavVerifier, samtykkeUrl, tilbagekald, udfordring, type Hent, type Klient } from '../google/oauth.ts';

export const GOOGLE_KALENDER_ID = 'google-kalender';
const SKEW_MS = 60_000;
const STATE_LEVETID_MS = 10 * 60_000;

/** The redirect address Google must be told: the app's own address + the registry's return route (KC-0132). */
export const tilbageAdresse = (adresse: string): string => `${adresse.replace(/\/+$/, '')}/api/kilder/${GOOGLE_KALENDER_ID}/tilbage`;
const absolut = (u: string): boolean => /^https?:\/\/[^/]/.test(u);

type Cache = { refresh: string; adgang: string; udloeber: number };

export function googleKalender(o: { env?: Record<string, string | undefined>; adresse?: string; hent?: Hent; nu?: () => Date } = {}): Kilde {
  const env = o.env ?? process.env;
  const hent: Hent = o.hent ?? fetch;
  const ur = o.nu ?? (() => new Date());
  const venter = new Map<string, { verifier: string; tilbage: string; udloeber: number }>();
  let cache: Cache | null = null;
  /** The refresh token Google refused (invalid_grant): not tried again until a new login replaces it. */
  let afvist: string | null = null;

  const klient = (): Klient | null => {
    const id = (env['KC_GOOGLE_CLIENT_ID'] ?? '').trim();
    const hemmelighed = (env['KC_GOOGLE_CLIENT_SECRET'] ?? '').trim();
    return id && hemmelighed ? { id, hemmelighed } : null;
  };
  const kraevKlient = (): Klient => {
    const k = klient();
    if (!k) throw new KildeFejl(409, googleTekst().appIkkeSat);
    return k;
  };

  /** A valid access token for the stored refresh token: the cached one unless it expires within 60 s or `ny` asks for a fresh one. */
  async function adgang(ctx: KildeKontekst, ny: boolean): Promise<string> {
    const k = kraevKlient();
    const refresh = (await ctx.hemmelighed())?.['refresh_token'] ?? '';
    if (!refresh) throw new GoogleFejl('afvist', kalenderTekst().ingenAdgang);
    if (refresh === afvist) throw new GoogleFejl('afvist', googleTekst().adgangenTrukketTilbage);
    const nu = ctx.nu.getTime();
    if (!ny && cache?.refresh === refresh && cache.udloeber - SKEW_MS > nu) return cache.adgang;
    try {
      const t = await forny({ hent, klient: k, refresh });
      cache = { refresh, adgang: t.adgang, udloeber: nu + t.udloeberMs };
      registrerHemmelighed(t.adgang); // KC-0274: the access token is a bearer secret too (the refresh token is registered by the secret store)
      return t.adgang;
    } catch (err) {
      if (err instanceof GoogleFejl && err.art === 'afvist') { afvist = refresh; cache = null; }
      throw err;
    }
  }

  return {
    id: GOOGLE_KALENDER_ID, get navn() { return kalenderTekst().navn; }, slags: 'kalender', zone: 'privat', auth: 'oauth', tillid: 'uklar',

    async read(ctx) {
      const data = await laesUge({ hent, adgang: (ny) => adgang(ctx, Boolean(ny)), nu: ctx.nu });
      return { slags: 'kalender', hentet: ctx.nu.toISOString(), uklar: true, data };
    },

    async kort(): Promise<KildeKort> {
      const t = kalenderTekst();
      if (klient()) return { titel: t.navn, felter: [], handling: t.handlingLogInd, tekst: t.kortTekst };
      const tilbage = o.adresse && absolut(o.adresse) ? tilbageAdresse(o.adresse) : null;
      const g = googleTekst();
      return {
        titel: t.navn, handling: t.handlingGemOgLogInd, trin: googleOpsaetTrin({ tilbage, api: 'Google Calendar API' }),
        tekst: t.kortTekstOpsaet,
        felter: [
          { navn: 'klient_id', etiket: g.klientIdEtiket, type: 'tekst', paakraevet: true, maks: 300, miljoe: 'KC_GOOGLE_CLIENT_ID' },
          { navn: 'klient_hemmelighed', etiket: g.klientHemmelighedEtiket, type: 'hemmelig', paakraevet: true, maks: 300, miljoe: 'KC_GOOGLE_CLIENT_SECRET' },
        ],
      };
    },

    async helbred(ctx): Promise<Helbred> {
      if (!klient()) return { status: 'nede', tekst: googleTekst().appMangler };
      try {
        await adgang(ctx, false);
        return { status: 'ok' };
      } catch (err) {
        if (err instanceof GoogleFejl && err.art === 'afvist') return { status: 'log-ind-igen', tekst: err.message };
        return { status: 'nede', tekst: err instanceof KildeFejl ? err.message : kalenderTekst().googleSvarerIkke };
      }
    },

    oauth: {
      async start(state, tilbage) {
        const k = kraevKlient();
        if (!absolut(tilbage)) throw new KildeFejl(409, googleTekst().ingenAdresse);
        const nu = ur().getTime();
        for (const [s, v] of venter) if (v.udloeber < nu) venter.delete(s);
        const verifier = lavVerifier();
        venter.set(state, { verifier, tilbage, udloeber: nu + STATE_LEVETID_MS });
        return { url: samtykkeUrl({ klientId: k.id, tilbage, state, udfordring: udfordring(verifier) }) };
      },
      async tilbage(kode, ctx, state) {
        const v = venter.get(state);
        venter.delete(state);
        if (!v || v.udloeber < ur().getTime()) throw new KildeFejl(400, googleTekst().loginIkkeBekraeftet);
        const t = await byttKode({ hent, klient: kraevKlient(), kode, verifier: v.verifier, tilbage: v.tilbage, krav: KALENDER_KRAV });
        cache = { refresh: t.refresh, adgang: t.adgang, udloeber: ctx.nu.getTime() + t.udloeberMs };
        afvist = null;
        return { refresh_token: t.refresh };
      },
    },

    async frakobl(ctx) {
      const refresh = (await ctx.hemmelighed())?.['refresh_token'];
      cache = null;
      if (refresh) await tilbagekald({ hent, token: refresh });
    },
  };
}
