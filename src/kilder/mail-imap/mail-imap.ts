// KC-0134: mail from any IMAP account (spec §3 step 3, §5). On the card
// "Mail" the user picks a service (Proton via Bridge, Fastmail, iCloud, Gmail
// with an app password, or another server), types the address and an app
// password, and taps Forbind: opsaet() logs in once (pinning Bridge's
// self-signed certificate on first use) before anything is stored, and the
// registry then reads at once. read() returns the newest INBOX envelopes —
// never a body — and is untrusted. EXAMINE and a wire-level command
// allowlist (imap.ts). KC-0214: two verbs, each on its own guarded client —
// `flyt` (sorter: move one mail within the account, never to Trash or Junk)
// and `kladde` (forbered: a reply APPENDed to Drafts). Never send, never delete.
// Health comes from the last attempt; a refused login is not retried on its
// own (providers lock accounts after repeated failures).

import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { AdresseFejl, tjekIp } from '../nyheder-rss/adresse.ts';
import { KildeFejl, type Felt, type Helbred, type Kilde, type KildeKontekst, type KildeKort, type Resultat, type VerbSpec } from '../types.ts';
import { FEJLTEKST, klassificer, type Klassifikation } from './fejl.ts';
import { imapTekst } from './tekster.ts';
import { flytMail, gemKladde, hentCertifikat, laesKonto, type Konto, type Tal } from './imap.ts';
import { erLoopback, forbindelse as forbindelseAf, normalFingeraftryk, PRESETS, TJENESTER, type Forbindelse } from './presets.ts';

export const MAIL_IMAP_ID = 'mail-imap';
/** How long a successful read vouches for the account's health before helbred() logs in again. */
const STANDARD_LEVETID_MS = 5 * 60_000;

/** The card's fields; their labels are read in the language of the request each time the card is made (KC-0170). */
function felter(): Felt[] {
  const t = imapTekst().felt;
  return [
    { navn: 'tjeneste', etiket: t.tjeneste, type: 'tekst', paakraevet: true, muligheder: TJENESTER.map((s) => ({ vaerdi: s, etiket: PRESETS[s].navn })) },
    { navn: 'adresse', etiket: t.adresse, type: 'tekst', paakraevet: true, maks: 200 },
    { navn: 'adgangskode', etiket: t.adgangskode, type: 'hemmelig', paakraevet: true },
    { navn: 'server', etiket: t.server, type: 'tekst', paakraevet: false, maks: 253 },
    { navn: 'sikkerhed', etiket: t.sikkerhed, type: 'tekst', paakraevet: false, muligheder: [{ vaerdi: 'tls', etiket: t.tls }, { vaerdi: 'starttls', etiket: t.starttls }] },
    { navn: 'port', etiket: t.port, type: 'tekst', paakraevet: false, maks: 5 },
    { navn: 'fingeraftryk', etiket: t.fingeraftryk, type: 'tekst', paakraevet: false, maks: 100 },
  ];
}

/** KC-0214: the two verbs (KC-0122 ladder: sort and prepare). Never send, never delete. */
const VERBER: Readonly<Record<'flyt' | 'kladde', VerbSpec>> = {
  flyt: { verb: 'sorter', get tekst() { return imapTekst().verber.flyt; } },
  kladde: { verb: 'forbered', get tekst() { return imapTekst().verber.kladde; } },
};
/** The longest draft text accepted. */
export const MAKS_KLADDE = 20_000;
const UID = /^[1-9][0-9]{0,9}$/;
// eslint-disable-next-line no-control-regex
const KONTROLTEGN = /[\u0000-\u001f\u007f]/;

/** A plain object with every `kraevet` key and no key outside `kraevet` and `valgfri`; else a 400 (before any login). */
function tjekArgs(args: unknown, kraevet: string[], valgfri: string[]): Record<string, unknown> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new KildeFejl(400, imapTekst().handlingenMangler);
  const a = args as Record<string, unknown>;
  for (const n of Object.keys(a)) if (!kraevet.includes(n) && !valgfri.includes(n)) throw new KildeFejl(400, imapTekst().ukendtOplysning(n.slice(0, 40)));
  for (const n of kraevet) if (a[n] === undefined) throw new KildeFejl(400, imapTekst().oplysningenMangler(n));
  return a;
}
const uid = (v: unknown): number => {
  if (typeof v !== 'string' || !UID.test(v)) throw new KildeFejl(400, imapTekst().mailIdUgyldigt);
  return Number(v);
};
const mappe = (v: unknown): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > 200 || KONTROLTEGN.test(v)) throw new KildeFejl(400, imapTekst().mappenavnUgyldigt);
  return v;
};
const tekst = (v: unknown): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > MAKS_KLADDE) throw new KildeFejl(400, imapTekst().kladdeTekstKrav(MAKS_KLADDE));
  return v;
};

type Tilstand = { ok?: { tid: number; tal: Tal; flag: number }; fejl?: { tid: number; k: Klassifikation } };

/** The card is text: anything typed by the user is shown without < or >. */
const vis = (v: string): string => v.replace(/[<>]/g, '');
const noegle = (f: Forbindelse): string => `${f.tjeneste}|${f.vaert}|${f.port}|${f.bruger}`;
const ulaeste = (n: number): string => imapTekst().ulaeste(n);

function alder(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return imapTekst().sidstLaestUnderMinut;
  return imapTekst().sidstLaest(min);
}

/**
 * `tidsgraenseMs`: per connection step (default 15 s); `levetidMs`: how long a good read keeps health ok. `hostet` (KC-0274, C2):
 * the install runs on Clawco Sky's server, so "another server" may only be a server on the public internet (a literal in
 * `forbindelse`, a NAME resolved and judged here before any connection); `opslag` is the resolver (tests).
 */
export function mailImapKilde(o: { tidsgraenseMs?: number; levetidMs?: number; hostet?: boolean; opslag?: (vaert: string) => Promise<{ address: string }[]> } = {}): Kilde {
  const hostet = o.hostet === true;
  const forbindelse = (valg: Readonly<Record<string, string>>): Forbindelse => forbindelseAf(valg, { hostet });
  const opslag = o.opslag ?? ((vaert: string) => dns.lookup(vaert, { all: true, verbatim: true }));
  /** A hosted "anden" server name that resolves to any local, private or refused address (or to nothing) is refused: no connection is made. */
  async function tjekHostet(f: Forbindelse): Promise<void> {
    if (!hostet || f.tjeneste !== 'anden' || isIP(f.vaert)) return;
    let svar: { address: string }[];
    try { svar = await opslag(f.vaert); } catch { return; /* the connection attempt fails the same way and says so */ }
    try {
      if (!svar.length) throw new AdresseFejl('tom');
      for (const a of svar) tjekIp(a.address, { oprindelse: 'hostet' });
    } catch (err) {
      if (err instanceof AdresseFejl) throw new KildeFejl(400, imapTekst().serverIkkeHostet);
      throw err;
    }
  }
  const tilstand = new Map<string, Tilstand>();
  const levetid = o.levetidMs ?? STANDARD_LEVETID_MS;
  const tid = o.tidsgraenseMs ? { tidsgraenseMs: o.tidsgraenseMs } : {};

  const huskOk = (f: Forbindelse, nu: Date, konto: Konto): void => {
    tilstand.set(noegle(f), { ok: { tid: nu.getTime(), tal: konto.tal, flag: konto.kuverter.filter((k) => k.flag).length } });
  };
  const huskFejl = (f: Forbindelse, nu: Date, err: unknown): Klassifikation => {
    const k = klassificer(err, { loopback: erLoopback(f.vaert) });
    tilstand.set(noegle(f), { ...tilstand.get(noegle(f)), fejl: { tid: nu.getTime(), k } });
    return k;
  };
  const kode = async (ctx: KildeKontekst): Promise<string> => {
    const k = (await ctx.hemmelighed())?.['adgangskode'];
    if (!k) throw new KildeFejl(409, imapTekst().adgangskodenMangler);
    return k;
  };

  /** Reads the account, remembering the outcome; a failure becomes a KildeFejl with the Danish text. */
  async function laes(f: Forbindelse, ctx: KildeKontekst, adgangskode: string, pin?: string): Promise<Konto> {
    await tjekHostet(f);
    try {
      const konto = await laesKonto(f, adgangskode, { ...(pin ? { pin } : {}), ...tid });
      huskOk(f, ctx.nu, konto);
      return konto;
    } catch (err) {
      const k = huskFejl(f, ctx.nu, err);
      throw new KildeFejl(k.http, k.tekst);
    }
  }

  /** Runs a verb's IMAP call: a refusal (KildeFejl) as it is, a connection or login failure classified like a read. */
  async function udfoer<T>(f: Forbindelse, ctx: KildeKontekst, kald: () => Promise<T>): Promise<T> {
    await tjekHostet(f);
    try { return await kald(); } catch (err) {
      if (err instanceof KildeFejl) throw err;
      const k = huskFejl(f, ctx.nu, err);
      throw new KildeFejl(k.http, k.tekst);
    }
  }

  const sidsteFejl = (t: Tilstand | undefined): Klassifikation | undefined =>
    (t?.fejl && (!t.ok || t.fejl.tid >= t.ok.tid) ? t.fejl.k : undefined);

  return {
    id: MAIL_IMAP_ID, get navn() { return imapTekst().navn; }, slags: 'mail', zone: 'privat', auth: 'apikey', tillid: 'uklar',

    async read(ctx) {
      const f = forbindelse(ctx.valg);
      const konto = await laes(f, ctx, await kode(ctx), ctx.valg['fingeraftryk']);
      return { slags: 'mail', hentet: ctx.nu.toISOString(), uklar: true, data: konto.kuverter };
    },

    verber: VERBER,

    async act(navn, args, ctx): Promise<Resultat> {
      if (navn === 'flyt') {
        const a = tjekArgs(args, ['id', 'til'], ['fra']);
        const o = { uid: uid(a['id']), til: mappe(a['til']), fra: a['fra'] === undefined ? 'INBOX' : mappe(a['fra']) };
        const f = forbindelse(ctx.valg);
        const adgangskode = await kode(ctx);
        const pin = ctx.valg['fingeraftryk'];
        const r = await udfoer(f, ctx, () => flytMail(f, adgangskode, { ...o, ...(pin ? { pin } : {}), ...tid }));
        return {
          ok: true, tekst: imapTekst().mailenFlyttet(vis(r.til)),
          ...(r.nyUid ? { fortryd: { navn: 'flyt', args: { id: String(r.nyUid), fra: r.til, til: r.fra } } } : {}),
        };
      }
      if (navn === 'kladde') {
        const a = tjekArgs(args, ['id', 'tekst'], []);
        const o = { uid: uid(a['id']), tekst: tekst(a['tekst']) };
        const f = forbindelse(ctx.valg);
        const adgangskode = await kode(ctx);
        const pin = ctx.valg['fingeraftryk'];
        const r = await udfoer(f, ctx, () => gemKladde(f, adgangskode, { ...o, nu: ctx.nu, ...(pin ? { pin } : {}), ...tid }));
        return { ok: true, tekst: imapTekst().kladdenLigger(vis(r.mappe)) };
      }
      throw new KildeFejl(400, imapTekst().mailKanIkke(String(navn).slice(0, 40)));
    },

    async helbred(ctx): Promise<Helbred> {
      let f: Forbindelse;
      try { f = forbindelse(ctx.valg); } catch { return { status: 'nede', tekst: imapTekst().ikkeSatOp }; }
      const t = tilstand.get(noegle(f));
      const fejl = sidsteFejl(t);
      if (fejl?.status === 'log-ind-igen') return { status: 'log-ind-igen', tekst: fejl.tekst };
      if (!fejl && t?.ok && ctx.nu.getTime() - t.ok.tid < levetid) return { status: 'ok', tekst: alder(ctx.nu.getTime() - t.ok.tid) };
      let adgangskode: string;
      try { adgangskode = await kode(ctx); } catch (err) { return { status: 'log-ind-igen', tekst: (err as Error).message }; }
      try {
        await laes(f, ctx, adgangskode, ctx.valg['fingeraftryk']);
        return { status: 'ok', tekst: alder(0) };
      } catch (err) {
        const k = sidsteFejl(tilstand.get(noegle(f)));
        return { status: k?.status ?? 'nede', tekst: k?.tekst ?? (err as Error).message };
      }
    },

    async kort(ctx): Promise<KildeKort> {
      let f: Forbindelse;
      const m = imapTekst();
      try { f = forbindelse(ctx.valg); } catch { return { titel: m.navn, tekst: m.intro, felter: felter(), handling: m.handling.forbind }; }
      const t = tilstand.get(noegle(f));
      const fejl = sidsteFejl(t);
      if (fejl?.status === 'log-ind-igen') {
        return { titel: m.navn, tekst: m.loginIgen(fejl.tekst), felter: felter(), handling: m.handling.forbindIgen };
      }
      const dele = [m.kontoen(vis(f.bruger), PRESETS[f.tjeneste].navn)];
      if (t?.ok) dele.push(m.talIndbakke(ulaeste(t.ok.tal.ulaeste), t.ok.flag));
      const fp = normalFingeraftryk(ctx.valg['fingeraftryk'] ?? '');
      if (fp && erLoopback(f.vaert)) dele.push(m.fingeraftrykTekst(fp));
      dele.push(m.kunLaes);
      return { titel: m.navn, tekst: dele.join(' '), felter: felter(), handling: m.handling.skiftKonto };
    },

    async opsaet(ctx) {
      const f = forbindelse(ctx.valg);
      const adgangskode = (await ctx.hemmelighed())?.['adgangskode'];
      if (!adgangskode) throw new KildeFejl(400, imapTekst().skrivAdgangskode);
      const valg: Record<string, string> = { tjeneste: f.tjeneste, adresse: f.bruger };
      if (f.tjeneste === 'anden') Object.assign(valg, { server: f.vaert, sikkerhed: f.sikkerhed });
      if (ctx.valg['port']) valg['port'] = String(f.port);
      let pin: string | undefined;
      if (erLoopback(f.vaert)) {
        const skrevet = ctx.valg['fingeraftryk'] ?? '';
        if (skrevet && !normalFingeraftryk(skrevet)) throw new KildeFejl(400, imapTekst().fingeraftrykUgyldigt);
        let fundet: string;
        try { fundet = (await hentCertifikat(f, tid)).fingeraftryk; } catch (err) {
          const k = huskFejl(f, ctx.nu, err);
          throw new KildeFejl(k.http, k.tekst);
        }
        // Trust on first use, unless the user typed the fingerprint themselves — then it must match.
        pin = normalFingeraftryk(skrevet) || fundet;
        if (pin !== fundet) throw new KildeFejl(400, FEJLTEKST.pin);
        valg['fingeraftryk'] = pin;
      }
      const konto = await laes(f, ctx, adgangskode, pin);
      const tekst = imapTekst().forbundetTil(PRESETS[f.tjeneste].navn, vis(f.bruger), ulaeste(konto.tal.ulaeste))
        + (pin ? imapTekst().pinGemt(pin) : '');
      return { tekst, valg };
    },
  };
}
