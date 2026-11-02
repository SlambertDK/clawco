// The request (KC-0149, forespørgsel): one household member asks another for
// something, and the request has a state both of them see. A pure state
// machine — data in, data out, no I/O, the clock passed in.
//
//   spurgt     → accepteret | afvist | alternativ   (the recipient's tap)
//   spurgt     → udloebet                            (the asker withdraws, or the clock)
//   alternativ → accepteret | afvist                 (the asker's tap on the recipient's alternative)
//   alternativ → udloebet                            (the asker withdraws, or the clock)
//   accepteret, afvist, udloebet are final.
//
// Invariant: only a party's tap moves a request, and only on that party's turn;
// the clock only expires it. Hermes never calls this (its suggestions are stored
// beside the state, prompt.ts), so nothing it writes can transition a request.

import { koebenhavnTilIso } from '../shell/tid.ts';

export const TILSTANDE = ['spurgt', 'accepteret', 'afvist', 'alternativ', 'udloebet'] as const;
export type Tilstand = (typeof TILSTANDE)[number];
export type PersonId = string;
export type Tidsrum = { start: string; slut: string };
export type Alternativ = Tidsrum & { tekst: string };
/** `af`: the person who tapped, or 'ur' for the clock's expiry. */
export type Historik = { tid: string; tilstand: Tilstand; af: string };
/** Hermes' suggestions for the decider (prompt.ts): advice beside the state, never a state. */
export type ForespForslag = { anbefaling?: string; alternativer: { kl: string; tekst: string }[] };

export type Forespoergsel = {
  id: string; fra: PersonId; til: PersonId; titel: string; tid?: Tidsrum; ressourceId?: string;
  tilstand: Tilstand; alternativ?: Alternativ;
  oprettet: string; udloeber: string;
  /** Reminders sent, as `<person>:<24t|4t>` (each fires once per decider). */
  paamindet: string[];
  aarsag?: 'trukket';
  historik: Historik[];
  forslag?: ForespForslag;
  /** The asker dealt with an expired request ("drop" or "spørg igen"): its card is gone. */
  lukket?: string;
  /** Parties who took the agreement to their own calendar (the one-tap card is gone for them). */
  iKalender?: PersonId[];
};

export type Haendelse =
  | { slags: 'ja' | 'nej' | 'tag-imod' | 'afslaa' | 'traek'; af: PersonId }
  | { slags: 'alternativ'; af: PersonId; alternativ: Alternativ }
  | { slags: 'udloeb' };

export type Fejl = 'ikke-part' | 'ikke-din-tur' | 'afgjort' | 'ikke-endnu' | 'intet';
export type Udfald = { ok: true; f: Forespoergsel; aendret: boolean } | { ok: false; fejl: Fejl; hvorfor: string };

const TIME = 3600_000;
export const LEVETID_MS = 48 * TIME;
const PAAMIND: readonly [string, number][] = [['24t', 24 * TIME], ['4t', 4 * TIME]];
const ENDELIG: ReadonlySet<Tilstand> = new Set(['accepteret', 'afvist', 'udloebet']);

/** 48 h after creation, or the request's own start when that is sooner. */
export function udloeberFor(oprettet: Date, tid?: Tidsrum): string {
  const om48 = oprettet.getTime() + LEVETID_MS;
  const start = tid ? Date.parse(tid.start) : NaN;
  return new Date(Number.isNaN(start) ? om48 : Math.min(om48, start)).toISOString();
}

export function nyForespoergsel(o: { id: string; fra: PersonId; til: PersonId; titel: string; tid?: Tidsrum | undefined; ressourceId?: string | undefined }, nu: Date): Forespoergsel {
  const f: Forespoergsel = {
    id: o.id, fra: o.fra, til: o.til, titel: o.titel, tilstand: 'spurgt',
    oprettet: nu.toISOString(), udloeber: udloeberFor(nu, o.tid), paamindet: [],
    historik: [{ tid: nu.toISOString(), tilstand: 'spurgt', af: o.fra }],
  };
  if (o.tid) f.tid = { ...o.tid };
  if (o.ressourceId) f.ressourceId = o.ressourceId;
  return f;
}

export const erPart = (f: Pick<Forespoergsel, 'fra' | 'til'>, id: PersonId): boolean => f.fra === id || f.til === id;

/** Whose decision it is now: the recipient on spurgt, the asker on an alternative; nobody once final. */
export function beslutter(f: Pick<Forespoergsel, 'fra' | 'til' | 'tilstand'>): PersonId | null {
  return f.tilstand === 'spurgt' ? f.til : f.tilstand === 'alternativ' ? f.fra : null;
}

/** The time agreed: the alternative when the asker took it, else the request's own; none unless accepted. */
export function aftaleTid(f: Pick<Forespoergsel, 'tilstand' | 'tid' | 'alternativ'>): Tidsrum | undefined {
  if (f.tilstand !== 'accepteret') return undefined;
  const t = f.alternativ ?? f.tid;
  return t ? { start: t.start, slut: t.slut } : undefined;
}

/** The decider was reminded in the current state (a reminder element on their Nu). */
export const erPaamindet = (f: Forespoergsel): boolean => {
  const b = beslutter(f);
  return b !== null && f.paamindet.some((m) => m.startsWith(`${b}:`));
};

/** An alternative at clock `kl` ("16:30" or "16.30") on the request's own Copenhagen day, keeping its duration. Null without a time. */
export function alternativFraKl(f: Pick<Forespoergsel, 'tid'>, kl: string, tekst: string): Alternativ | null {
  if (!f.tid) return null;
  const m = /^([01]?\d|2[0-3])[:.]([0-5]\d)$/.exec(kl.trim());
  if (!m) return null;
  const dag = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(f.tid.start));
  const start = koebenhavnTilIso(`${dag}T${m[1]!.padStart(2, '0')}:${m[2]}`);
  if (!start) return null;
  const varighed = Date.parse(f.tid.slut) - Date.parse(f.tid.start);
  return { start, slut: new Date(Date.parse(start) + varighed).toISOString(), tekst };
}

const nej = (fejl: Fejl, hvorfor: string): Udfald => ({ ok: false, fejl, hvorfor });

/** Where an event leads from a state, and who may cause it; null = not an event of that state. */
function maal(f: Forespoergsel, h: Haendelse): { til: Tilstand; hvem: PersonId | 'ur' } | null {
  const s = f.tilstand;
  switch (h.slags) {
    case 'ja': return s === 'spurgt' ? { til: 'accepteret', hvem: f.til } : null;
    case 'nej': return s === 'spurgt' ? { til: 'afvist', hvem: f.til } : null;
    case 'alternativ': return s === 'spurgt' ? { til: 'alternativ', hvem: f.til } : null;
    case 'tag-imod': return s === 'alternativ' ? { til: 'accepteret', hvem: f.fra } : null;
    case 'afslaa': return s === 'alternativ' ? { til: 'afvist', hvem: f.fra } : null;
    case 'traek': return s === 'spurgt' || s === 'alternativ' ? { til: 'udloebet', hvem: f.fra } : null;
    case 'udloeb': return s === 'spurgt' || s === 'alternativ' ? { til: 'udloebet', hvem: 'ur' } : null;
  }
}

/** The same answer again from its author: a double tap, so nothing changes. */
function gentagelse(f: Forespoergsel, h: Haendelse): boolean {
  if (h.slags === 'udloeb') return false;
  const sidst = f.historik.at(-1);
  if (!sidst || sidst.af !== h.af) return false;
  const til: Partial<Record<Haendelse['slags'], Tilstand>> = { ja: 'accepteret', nej: 'afvist', alternativ: 'alternativ', 'tag-imod': 'accepteret', afslaa: 'afvist', traek: 'udloebet' };
  if (til[h.slags] !== f.tilstand) return false;
  if (h.slags === 'traek') return f.aarsag === 'trukket';
  if (h.slags === 'alternativ') return f.alternativ?.start === h.alternativ.start;
  return true;
}

/** Applies one event. Never mutates `f`. */
export function anvend(f: Forespoergsel, h: Haendelse, nu: Date): Udfald {
  if (h.slags !== 'udloeb' && !erPart(f, h.af)) return nej('ikke-part', 'Forespørgslen er ikke din.');
  if (gentagelse(f, h)) return { ok: true, f, aendret: false };
  if (ENDELIG.has(f.tilstand)) return nej('afgjort', 'Forespørgslen er allerede afgjort.');
  const m = maal(f, h);
  if (!m || (h.slags !== 'udloeb' && m.hvem !== h.af)) return nej('ikke-din-tur', 'Det er ikke din beslutning lige nu.');
  if (h.slags === 'udloeb' && nu.getTime() < Date.parse(f.udloeber)) return nej('ikke-endnu', 'Forespørgslen er ikke udløbet endnu.');
  const ud: Forespoergsel = { ...f, tilstand: m.til, historik: [...f.historik, { tid: nu.toISOString(), tilstand: m.til, af: m.hvem }] };
  if (h.slags === 'alternativ') ud.alternativ = { ...h.alternativ };
  if (h.slags === 'traek') ud.aarsag = 'trukket';
  return { ok: true, f: ud, aendret: true };
}

/** The clock: reminders to the decider at 24 h and 4 h before expiry (a threshold already past at creation is skipped), then expiry. */
export function tik(f: Forespoergsel, nu: Date): { f: Forespoergsel; aendret: boolean; paamindelse: boolean; udloeb: boolean } {
  const b = beslutter(f);
  if (b === null) return { f, aendret: false, paamindelse: false, udloeb: false };
  const udloeber = Date.parse(f.udloeber);
  if (nu.getTime() >= udloeber) {
    const r = anvend(f, { slags: 'udloeb' }, nu);
    return r.ok ? { f: r.f, aendret: r.aendret, paamindelse: false, udloeb: true } : { f, aendret: false, paamindelse: false, udloeb: false };
  }
  const nye = PAAMIND
    .filter(([, ms]) => udloeber - ms > Date.parse(f.oprettet) && nu.getTime() >= udloeber - ms)
    .map(([navn]) => `${b}:${navn}`)
    .filter((m) => !f.paamindet.includes(m));
  if (!nye.length) return { f, aendret: false, paamindelse: false, udloeb: false };
  return { f: { ...f, paamindet: [...f.paamindet, ...nye] }, aendret: true, paamindelse: true, udloeb: false };
}

/** Fortryd of an answer: back to the state before it — by its author only, while it is the latest step and before expiry. */
export function fortrydSvar(f: Forespoergsel, af: PersonId, nu: Date): Udfald {
  if (!erPart(f, af)) return nej('ikke-part', 'Forespørgslen er ikke din.');
  const sidst = f.historik.at(-1);
  const foer = f.historik.at(-2);
  if (!sidst || !foer || sidst.tilstand === 'spurgt' || sidst.tilstand === 'udloebet') return nej('intet', 'Der er intet svar at fortryde.');
  if (sidst.af !== af) return nej('ikke-din-tur', 'Kun den, der svarede, kan fortryde svaret.');
  if (nu.getTime() >= Date.parse(f.udloeber)) return nej('afgjort', 'Forespørgslen er udløbet, så svaret kan ikke fortrydes.');
  const ud: Forespoergsel = { ...f, tilstand: foer.tilstand, historik: [...f.historik, { tid: nu.toISOString(), tilstand: foer.tilstand, af }] };
  if (foer.tilstand === 'spurgt') delete ud.alternativ;
  if (sidst.tilstand === 'accepteret') delete ud.iKalender;
  return { ok: true, f: ud, aendret: true };
}

/** Expired by the clock and not yet dealt with by the asker (not withdrawn, not dropped or asked again). */
export const ubesvaret = (f: Pick<Forespoergsel, 'tilstand' | 'aarsag' | 'lukket'>): boolean => f.tilstand === 'udloebet' && !f.aarsag && !f.lukket;

/**
 * Whether the step that left the history `n` entries long can still be undone by `af`: the creation (n = 1) by the
 * asker while nobody answered (a withdraw), or an answer by its author while it is the latest step, before expiry.
 */
export function kanFortrydes(f: Forespoergsel, n: number, af: PersonId, nu: Date): boolean {
  if (f.historik.length !== n || nu.getTime() >= Date.parse(f.udloeber)) return false;
  if (n === 1) return f.tilstand === 'spurgt' && f.fra === af;
  return fortrydSvar(f, af, nu).ok;
}
