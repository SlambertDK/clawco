// The Gmail connector (KC-0135, spec §3 step 3, §5): "Log ind med Google" on
// the card, then the newest INBOX envelopes in Nu — no app password. Gmail is
// the generic IMAP reader (KC-0134, imap.ts) logged in with XOAUTH2, not a
// second mail reader and not the Gmail REST API; the Google OAuth is the same
// code as the calendar's (src/kilder/google/oauth.ts) on the same own Google
// app (KC_GOOGLE_CLIENT_ID/SECRET), so a person who connected the calendar is
// asked only for the mail scope on top (incremental consent).
//
// Scope: IMAP over OAuth needs https://mail.google.com/ — Google words it as
// full access and has nothing narrower for IMAP (XOAUTH2 protocol page and the
// Gmail scopes page, read 2026-11-01). Clawco only reads envelopes, and that is
// enforced by our own code: imap.ts opens the mailbox with EXAMINE behind a
// wire-level command allowlist, and this connector declares no verbs and no
// act(). The card says so in plain words.
//
// The refresh token and the account's address (from the ID token: openid + email
// are asked for, so nobody types it) live in hemmeligheder/mail-gmail.json
// (KC-0132); the access token only in memory, refreshed 60 s before expiry, and
// once more if the mail server refuses it (Google may drop it early). Google
// refusing the grant (invalid_grant: revoked, or a 7-day token from an app in
// Testing) and the mail server refusing a fresh token both read as
// log-ind-igen (KC-0139) and are not tried again until a new login.
//
// Invariant (§0 r2/r7): envelope-only, read-only, no token or client secret in
// any message, card or log.

import { KildeFejl, type Helbred, type Kilde, type KildeKontekst, type KildeKort } from '../types.ts';
import { googleOpsaetTrin, googleTilfoejTrin } from '../google/opsaet.ts';
import { byttKode, forny, GoogleFejl, lavVerifier, MAIL_KRAV, samtykkeUrl, SCOPE_ADRESSE, SCOPE_MAIL, tilbagekald, udfordring, type Hent, type Klient } from '../google/oauth.ts';
import { GOOGLE_KALENDER_ID } from '../google-kalender/kilde.ts';
import { laesKonto, type Adgang, type Konto } from '../mail-imap/imap.ts';
import { forbindelse, type Forbindelse } from '../mail-imap/presets.ts';
import { erLoginAfvist, GMAIL_FEJLTEKST, klassificerGmail, type GmailKlassifikation } from './fejl.ts';

export const MAIL_GMAIL_ID = 'mail-gmail';
const NAVN = 'Gmail';
const SKEW_MS = 60_000;
const STATE_LEVETID_MS = 10 * 60_000;
/** How long a successful read vouches for the account's health before helbred() asks again. */
const STANDARD_LEVETID_MS = 5 * 60_000;
const SCOPES = [SCOPE_MAIL, ...SCOPE_ADRESSE];

/** The redirect address Google must be told: the app's own address + the registry's return route (KC-0132). */
export const tilbageAdresse = (adresse: string): string => `${adresse.replace(/\/+$/, '')}/api/kilder/${MAIL_GMAIL_ID}/tilbage`;
const absolut = (u: string): boolean => /^https?:\/\/[^/]/.test(u);

const FULD_ADGANG = 'Google kalder tilladelsen "fuld adgang til din Gmail", fordi Google ikke har en smallere tilladelse til mail over IMAP. '
  + 'Clawco bruger den kun til at læse afsender, emne og tid, aldrig selve mailen, og kan hverken sende, flytte eller slette; det sørger Clawcos egen kode for.';
const ALTERNATIV = 'Vil du ikke give den tilladelse, kan du i stedet vælge Mail og Gmail (app-adgangskode); det kræver bekræftelse i to trin hos Google.';

/** The card is text: anything from outside is shown without < or >. */
const vis = (v: string): string => v.replace(/[<>]/g, '');

type Cache = { refresh: string; adgang: string; udloeber: number };
type Tilstand = { ok?: { tid: number }; fejl?: { tid: number; k: GmailKlassifikation } };

export function mailGmail(o: {
  env?: Record<string, string | undefined>; adresse?: string; hent?: Hent; nu?: () => Date; levetidMs?: number;
  /** Reads the account with the given login (default: the IMAP reader with the Gmail folder profile). Tests and the test world replace it. */
  laes?: (f: Forbindelse, adgang: Adgang) => Promise<Konto>;
} = {}): Kilde {
  const env = o.env ?? process.env;
  const hent: Hent = o.hent ?? fetch;
  const ur = o.nu ?? (() => new Date());
  const levetid = o.levetidMs ?? STANDARD_LEVETID_MS;
  const laesImap = o.laes ?? ((f, a) => laesKonto(f, a, { profil: 'gmail' }));
  const venter = new Map<string, { verifier: string; tilbage: string; udloeber: number }>();
  let cache: Cache | null = null;
  /** The refresh token that no longer works (Google refused it, or the mail server refused a fresh token): not tried again until a new login replaces it. */
  let afvist: string | null = null;
  let tilstand: Tilstand = {};

  const klient = (): Klient | null => {
    const id = (env['KC_GOOGLE_CLIENT_ID'] ?? '').trim();
    const hemmelighed = (env['KC_GOOGLE_CLIENT_SECRET'] ?? '').trim();
    return id && hemmelighed ? { id, hemmelighed } : null;
  };
  const kraevKlient = (): Klient => {
    const k = klient();
    if (!k) throw new KildeFejl(409, 'Google-appen er ikke sat op endnu: klient-id og klienthemmelighed mangler. Følg trinene på kortet.');
    return k;
  };

  /** A valid access token for the stored login: the cached one unless it expires within 60 s or `ny` asks for a fresh one. */
  async function adgang(ctx: KildeKontekst, ny: boolean): Promise<{ token: string; refresh: string; adresse: string }> {
    const k = kraevKlient();
    const hem = await ctx.hemmelighed();
    const refresh = hem?.['refresh_token'] ?? '';
    const adresse = hem?.['adresse'] ?? '';
    if (!refresh || !adresse) throw new GoogleFejl('afvist', GMAIL_FEJLTEKST.tom);
    if (refresh === afvist) throw new GoogleFejl('afvist', GMAIL_FEJLTEKST.adgang);
    const nu = ctx.nu.getTime();
    if (!ny && cache?.refresh === refresh && cache.udloeber - SKEW_MS > nu) return { token: cache.adgang, refresh, adresse };
    try {
      const t = await forny({ hent, klient: k, refresh });
      cache = { refresh, adgang: t.adgang, udloeber: nu + t.udloeberMs };
      return { token: t.adgang, refresh, adresse };
    } catch (err) {
      if (err instanceof GoogleFejl && err.art === 'afvist') { afvist = refresh; cache = null; }
      throw err;
    }
  }

  /** Reads the account over XOAUTH2, remembering the outcome; a failure becomes a KildeFejl with the Danish text. */
  async function laes(ctx: KildeKontekst): Promise<Konto> {
    try {
      let a = await adgang(ctx, false);
      const f = forbindelse({ tjeneste: 'gmail', adresse: a.adresse });
      let konto: Konto;
      try { konto = await laesImap(f, { accessToken: a.token }); } catch (err) {
        if (!erLoginAfvist(err)) throw err;
        // Google may have dropped the token early: one fresh token and one retry; a second refusal is a login that is gone.
        a = await adgang(ctx, true);
        try { konto = await laesImap(f, { accessToken: a.token }); } catch (err2) {
          if (erLoginAfvist(err2)) { afvist = a.refresh; cache = null; }
          throw err2;
        }
      }
      tilstand = { ok: { tid: ctx.nu.getTime() } };
      return konto;
    } catch (err) {
      // A missing client key is the card's business (Google-appen er ikke sat op), not a failed connection.
      if (err instanceof KildeFejl && !(err instanceof GoogleFejl)) throw err;
      const k = klassificerGmail(err);
      tilstand = { ...tilstand, fejl: { tid: ctx.nu.getTime(), k } };
      throw new KildeFejl(k.http === 400 ? 502 : k.http, k.tekst);
    }
  }

  const sidsteFejl = (): GmailKlassifikation | undefined =>
    (tilstand.fejl && (!tilstand.ok || tilstand.fejl.tid >= tilstand.ok.tid) ? tilstand.fejl.k : undefined);

  return {
    id: MAIL_GMAIL_ID, navn: NAVN, slags: 'mail', zone: 'privat', auth: 'oauth', tillid: 'uklar',

    async read(ctx) {
      const konto = await laes(ctx);
      return { slags: 'mail', hentet: ctx.nu.toISOString(), uklar: true, data: konto.kuverter };
    },

    async kort(ctx): Promise<KildeKort> {
      const tilbage = o.adresse && absolut(o.adresse) ? tilbageAdresse(o.adresse) : null;
      if (!klient()) {
        return {
          titel: NAVN, handling: 'Gem og log ind med Google', trin: googleOpsaetTrin({ tilbage, scope: SCOPE_MAIL }),
          tekst: `Første gang laver du din egen lille Google-app, så din mail går direkte fra Google til Clawco, uden en app-adgangskode. Det tager fem minutter, ét trin ad gangen. ${FULD_ADGANG} ${ALTERNATIV}`,
          felter: [
            { navn: 'klient_id', etiket: 'Klient-id', type: 'tekst', paakraevet: true, maks: 300, miljoe: 'KC_GOOGLE_CLIENT_ID' },
            { navn: 'klient_hemmelighed', etiket: 'Klienthemmelighed', type: 'hemmelig', paakraevet: true, maks: 300, miljoe: 'KC_GOOGLE_CLIENT_SECRET' },
          ],
        };
      }
      const hem = await ctx.hemmelighed();
      if (hem?.['refresh_token']) {
        const fejl = sidsteFejl();
        if (fejl?.status === 'log-ind-igen') {
          return { titel: NAVN, tekst: `${fejl.tekst} ${FULD_ADGANG}`, felter: [], handling: 'Log ind med Google igen' };
        }
        const hvem = hem['adresse'] ? `Forbundet som ${vis(hem['adresse'])}. ` : 'Forbundet. ';
        return { titel: NAVN, tekst: `${hvem}${FULD_ADGANG}`, felter: [], handling: 'Skift Google-konto' };
      }
      if (await ctx.erForbundet?.(GOOGLE_KALENDER_ID)) {
        return {
          titel: NAVN, felter: [], handling: 'Giv adgang til mail', trin: googleTilfoejTrin({ tilbage, scope: SCOPE_MAIL }),
          tekst: `Google er allerede koblet: kun mail mangler. Clawco bruger den samme Google-app og beder kun om tilladelse til mail; kalenderen røres ikke. ${FULD_ADGANG} ${ALTERNATIV}`,
        };
      }
      return {
        titel: NAVN, felter: [], handling: 'Log ind med Google',
        tekst: `Log ind med din Google-konto, så står dine ulæste og ventende mails i Nu. Du skal ikke lave en app-adgangskode. ${FULD_ADGANG} ${ALTERNATIV}`,
      };
    },

    async helbred(ctx): Promise<Helbred> {
      if (!klient()) return { status: 'nede', tekst: 'Google-appen mangler klient-id eller klienthemmelighed.' };
      const hem = await ctx.hemmelighed();
      if (!hem?.['refresh_token']) return { status: 'log-ind-igen', tekst: GMAIL_FEJLTEKST.tom };
      const fejl = sidsteFejl();
      if (fejl?.status === 'log-ind-igen') return { status: 'log-ind-igen', tekst: fejl.tekst };
      if (!fejl && tilstand.ok && ctx.nu.getTime() - tilstand.ok.tid < levetid) return { status: 'ok' };
      try {
        await laes(ctx);
        return { status: 'ok' };
      } catch (err) {
        const k = sidsteFejl();
        return { status: k?.status ?? 'nede', tekst: k?.tekst ?? (err instanceof KildeFejl ? err.message : 'Gmail svarer ikke.') };
      }
    },

    oauth: {
      async start(state, tilbage, ctx) {
        const k = kraevKlient();
        if (!absolut(tilbage)) throw new KildeFejl(409, 'Clawco kender ikke sin egen adresse (KC_ADRESSE), så Google ikke kan sende dig tilbage. Ejeren skal sætte den først.');
        const nu = ur().getTime();
        for (const [s, v] of venter) if (v.udloeber < nu) venter.delete(s);
        const verifier = lavVerifier();
        venter.set(state, { verifier, tilbage, udloeber: nu + STATE_LEVETID_MS });
        // Incremental consent: the calendar's grant on the same Google app is carried along, so only mail is new.
        const udvid = (await ctx.erForbundet?.(GOOGLE_KALENDER_ID)) === true;
        return { url: samtykkeUrl({ klientId: k.id, tilbage, state, udfordring: udfordring(verifier), scopes: SCOPES, udvid }) };
      },
      async tilbage(kode, ctx, state) {
        const v = venter.get(state);
        venter.delete(state);
        if (!v || v.udloeber < ur().getTime()) throw new KildeFejl(400, 'Login med Google kunne ikke bekræftes. Prøv igen.');
        const t = await byttKode({ hent, klient: kraevKlient(), kode, verifier: v.verifier, tilbage: v.tilbage, krav: MAIL_KRAV });
        if (!t.adresse) throw new KildeFejl(502, 'Google sagde ikke, hvilken Gmail-adresse der loggede ind. Prøv at logge ind igen.');
        cache = { refresh: t.refresh, adgang: t.adgang, udloeber: ctx.nu.getTime() + t.udloeberMs };
        afvist = null;
        tilstand = {};
        return { refresh_token: t.refresh, adresse: t.adresse };
      },
    },

    async frakobl(ctx) {
      const refresh = (await ctx.hemmelighed())?.['refresh_token'];
      cache = null;
      tilstand = {};
      if (refresh) await tilbagekald({ hent, token: refresh });
    },
  };
}
