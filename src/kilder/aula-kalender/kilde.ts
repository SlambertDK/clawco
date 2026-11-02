// KC-0235 (findings: docs/superpowers/specs/2026-11-02-aula-undersoegelse.md): a parent's own Aula calendar, read
// through the private "Ugekalender" link Aula itself makes for parents (consent ticked in Aula, no MitID, nothing
// automated against a login). The link IS the secret: it is stored only through hemmeligheder.ts (never in kilder.json,
// a log, a card or an error), and nothing but its host is ever written anywhere.
//
// Read-only by construction: no verbs, no act(). Clawco keeps per event only title, time, place and the institution (the
// calendar's own name) plus a hash of the UID as a stable id — never organizer, attendees, description, links or any
// e-mail address (ics.ts does not read those lines at all). Titles are teacher-typed free text and may name children:
// untrusted (`uklar`), zone `husstand`, and never put in a log line or a health text.
//
// The fetch is the hardened one of nyheder-rss (hent.ts + adresse.ts: public addresses only, the host resolved once and the
// connection pinned to the address that was checked, 3 redirects, 10 s, size cap, conditional GET), narrowed further: every
// hop must be on an Aula host, so the link can never be turned into a request to anywhere else.
//
// Health (KC-0139's words): 200 → ok; 401/403/404/410, a redirect off Aula's hosts, or an answer that is not a calendar →
// log-ind-igen (the link is revoked or wrong: make a new one in Aula), sticky until a new link is given; timeout, network
// error, 5xx and other statuses → nede for ten minutes, then asked again; an answer slower than 5 s → langsomt.

import { createHash } from 'node:crypto';
import { KildeFejl, type Helbred, type Kilde, type KildeKontekst, type KildeKort } from '../types.ts';
import { tjekAdresse, AdresseFejl } from '../nyheder-rss/adresse.ts';
import { HentFejl, lavHenter, type Henter } from '../nyheder-rss/hent.ts';
import { IcsFejl, MAKS_BYTES, parseIcs, type IcsHaendelse } from './ics.ts';

export const AULA_KALENDER_ID = 'aula-kalender';
const NAVN = 'Aula';

/**
 * The hosts an Aula calendar link may be on, and the only hosts a redirect may reach: aula.dk and its subdomains.
 * ASSUMED (KC-0238 has not yet had a real parent confirm the link): the findings note names aula.dk as Aula's own site and
 * says nothing of the host a calendar link is served from, so this is the narrowest host the product's own domain allows.
 * aulainfo.dk (the information site) is deliberately not on the list. If the real link turns out to live elsewhere, change
 * THIS constant and its test; nothing else knows the host.
 */
export const AULA_VAERTER: readonly string[] = ['aula.dk'];
export const erAulaVaert = (vaert: string): boolean => {
  const v = vaert.toLowerCase().replace(/\.$/, '');
  return AULA_VAERTER.some((d) => v === d || v.endsWith(`.${d}`));
};

const UGE_DAGE = 7;
const OK_LEVETID_MS = 5 * 60_000; // Aula refreshes the Ugekalender every 5 minutes: asking more often is pointless
const NEDE_LEVETID_MS = 10 * 60_000; // as nyheder-rss: the registry never reads a source that is not working, so "nede" must expire to recover
const LANGSOM_MS = 5000;
const MAKS_LINK = 1500; // within the secret module's 2000

/** Link refused by the card: a Danish sentence that never repeats what was pasted. */
function afvisLink(raa: string): URL {
  const t = raa.trim();
  const ligner = new KildeFejl(400, 'Det ligner ikke et Aula-kalenderlink. Kopiér linket "Ugekalender" i Aula, og indsæt det her.');
  if (!t) throw new KildeFejl(400, 'Indsæt linket fra Aula.');
  if (t.length > MAKS_LINK || /[\u0000- \u007f]/.test(t)) throw ligner;
  if (!/^https:\/\//i.test(t)) throw new KildeFejl(400, 'Linket skal begynde med https://. Kopiér linket "Ugekalender" fra Aula.');
  let u: URL;
  try { u = tjekAdresse(t, { oprindelse: 'ekstern' }); } catch (err) {
    if (err instanceof AdresseFejl) throw ligner;
    throw err;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) throw ligner;
  if (!erAulaVaert(u.hostname)) throw new KildeFejl(400, 'Det er ikke et link fra Aula. Linket skal ligge på aula.dk.');
  return u;
}

const hash = (tekst: string): string => createHash('sha256').update(tekst).digest('hex');
const vaertAf = (link: string): string => { try { return new URL(link).hostname.slice(0, 80); } catch { return ''; } };

type Husk = { art: 'ok'; tid: number; varighedMs: number } | { art: 'tilbagekaldt'; tid: number } | { art: 'nede'; tid: number };
type Gemt = { etag?: string; sidstRettet?: string; tekst: string };

const ICS_ACCEPT = 'text/calendar, text/plain;q=0.5, */*;q=0.1';
const REVOKERET = new Set([401, 403, 404, 410]);

const TEKST_TILBAGEKALDT = 'Aula-linket virker ikke mere: lav et nyt kalenderlink i Aula (samtykket kan være trukket tilbage, eller kommunen har slået synkronisering fra).';

const TRIN: { tekst: string }[] = [
  { tekst: 'Åbn Aula i browseren eller i appen, og gå til Kalender. Vælg Kalendersynkronisering (Synkronisér kalender).' },
  { tekst: 'Sæt fluebenet ved samtykket til, at Aula må overføre dine kalenderbegivenheder til en ekstern kalender. Fjerner du fluebenet senere, stopper deling ved kilden.' },
  { tekst: 'Vælg den institution og de begivenhedstyper, du vil se, og tryk Opret kalenderlink.' },
  { tekst: 'Kopiér linket "Ugekalender" (det der opdateres hvert femte minut), og indsæt det herunder. Linket virker som en adgangskode: del det ikke med andre.' },
];

export function aulaKalender(o: { hent?: Henter; ur?: () => number; langsomMs?: number; version?: string } = {}): Kilde {
  const hent = o.hent ?? lavHenter({ agent: `Clawco/${o.version ?? '0.1'}`, accept: ICS_ACCEPT, maksBytes: MAKS_BYTES, tilladtVaert: erAulaVaert, perVaert: 1, samtidige: 2 });
  const ur = o.ur ?? ((): number => Date.now());
  const langsomMs = o.langsomMs ?? LANGSOM_MS;
  /** What was last learned of a link, by the hash of the link (the link itself is never a key anywhere). */
  const husk = new Map<string, Husk>();
  const gemt = new Map<string, Gemt>();

  /** The link of this connection, trimmed; null when none is stored. */
  async function linkAf(ctx: KildeKontekst): Promise<string | null> {
    const l = ((await ctx.hemmelighed())?.['link'] ?? '').trim();
    return l || null;
  }

  /**
   * One fetch of the link with the validators of the last answer; remembers how it went. Returns the calendar text.
   * Throws KildeFejl(502) with a fixed sentence — never the link, never the file.
   */
  async function hentTekst(link: string, nu: Date): Promise<string> {
    const noegle = hash(link);
    const g = gemt.get(noegle);
    const start = ur();
    const tid = nu.getTime();
    try {
      const svar = await hent(link, { oprindelse: 'ekstern', ...(g?.etag ? { etag: g.etag } : {}), ...(g?.sidstRettet ? { sidstRettet: g.sidstRettet } : {}) });
      let tekst: string;
      if (svar.status === 'uaendret') {
        if (!g) throw new HentFejl('net', 'Kilden kunne ikke læses.');
        tekst = g.tekst;
      } else {
        tekst = svar.tekst;
        if (!/^\s*BEGIN:VCALENDAR/i.test(tekst.replace(/^﻿/, ''))) {
          husk.set(noegle, { art: 'tilbagekaldt', tid });
          throw new KildeFejl(502, 'Aula-linket virker ikke mere: svaret er ikke en kalender. Lav et nyt kalenderlink i Aula.');
        }
        gemt.set(noegle, { tekst, ...(svar.etag ? { etag: svar.etag } : {}), ...(svar.sidstRettet ? { sidstRettet: svar.sidstRettet } : {}) });
      }
      husk.set(noegle, { art: 'ok', tid, varighedMs: Math.max(0, ur() - start) });
      return tekst;
    } catch (err) {
      if (err instanceof KildeFejl) throw err;
      if (err instanceof HentFejl) {
        if ((err.kode === 'status' && err.httpStatus !== undefined && REVOKERET.has(err.httpStatus)) || err.kode === 'afvist') {
          husk.set(noegle, { art: 'tilbagekaldt', tid });
          throw new KildeFejl(502, 'Aula-linket virker ikke mere. Lav et nyt kalenderlink i Aula.');
        }
        husk.set(noegle, { art: 'nede', tid });
        const ord = err.kode === 'tid' ? 'Aula svarede ikke i tide.' : err.kode === 'stor' ? 'Aula-kalenderen er for stor.' : 'Aula svarer ikke lige nu.';
        throw new KildeFejl(502, ord);
      }
      husk.set(noegle, { art: 'nede', tid });
      throw new KildeFejl(502, 'Aula svarer ikke lige nu.');
    }
  }

  return {
    id: AULA_KALENDER_ID, navn: NAVN, slags: 'kalender', zone: 'husstand', auth: 'apikey', tillid: 'uklar',

    async read(ctx) {
      const link = await linkAf(ctx);
      if (!link) throw new KildeFejl(409, 'Aula er ikke forbundet med et kalenderlink.');
      const tekst = await hentTekst(link, ctx.nu);
      return { slags: 'kalender', hentet: ctx.nu.toISOString(), uklar: true, data: ugen(tekst, ctx.nu) };
    },

    async kort(ctx): Promise<KildeKort> {
      const link = await linkAf(ctx);
      const vaert = link ? vaertAf(link) : '';
      return {
        titel: 'Aula', handling: link ? 'Skift link' : 'Forbind Aula', trin: TRIN,
        tekst: `Clawco kan læse din kalender i Aula gennem det private kalenderlink, Aula selv laver til forældre: uden MitID. Clawco læser kun tid, titel, sted og institution, aldrig hvem der er inviteret eller beskrivelser, og kan aldrig ændre noget i Aula.${vaert ? ` Forbundet til ${vaert}.` : ''}`,
        felter: [{ navn: 'link', etiket: 'Linket "Ugekalender" fra Aula', type: 'hemmelig', paakraevet: true, maks: MAKS_LINK }],
      };
    },

    async helbred(ctx): Promise<Helbred> {
      const link = await linkAf(ctx);
      if (!link) return { status: 'log-ind-igen', tekst: 'Der er intet kalenderlink gemt. Indsæt linket fra Aula igen.' };
      const noegle = hash(link);
      const vaert = vaertAf(link);
      const nu = ctx.nu.getTime();
      let h = husk.get(noegle);
      const frisk = h && (h.art === 'tilbagekaldt' || nu - h.tid < (h.art === 'nede' ? NEDE_LEVETID_MS : OK_LEVETID_MS));
      if (!frisk) {
        try { await hentTekst(link, ctx.nu); } catch { /* the outcome is remembered; the answer below is made from it */ }
        h = husk.get(noegle);
      }
      if (!h) return { status: 'nede', tekst: 'Aula svarer ikke lige nu.' };
      if (h.art === 'tilbagekaldt') return { status: 'log-ind-igen', tekst: TEKST_TILBAGEKALDT };
      if (h.art === 'nede') return { status: 'nede', tekst: `${vaert || 'Aula'} svarer ikke lige nu.` };
      if (h.varighedMs > langsomMs) return { status: 'langsomt', tekst: `${vaert || 'Aula'} svarer langsomt.` };
      return { status: 'ok' };
    },

    /** The card's check: the link must be an https link on an Aula host that answers with a calendar. Nothing is stored but the secret. */
    async opsaet(ctx) {
      const raa = (await ctx.hemmelighed())?.['link'] ?? '';
      afvisLink(raa);
      const link = raa.trim();
      let tekst: string;
      try { tekst = await hentTekst(link, ctx.nu); } catch (err) {
        const hk = husk.get(hash(link));
        if (hk?.art === 'tilbagekaldt') {
          const ikkeKalender = err instanceof KildeFejl && /svaret er ikke en kalender/.test(err.message);
          throw new KildeFejl(400, ikkeKalender ? 'Det ligner ikke et Aula-kalenderlink: svaret er ikke en kalender.' : 'Aula afviser linket. Lav et nyt kalenderlink i Aula (Ugekalender), og indsæt det her.');
        }
        throw new KildeFejl(502, 'Aula svarer ikke lige nu. Prøv igen om lidt.');
      }
      let antal: number;
      try { antal = ugen(tekst, ctx.nu).days.reduce((n, d) => n + d.events.length, 0); } catch (err) {
        if (err instanceof IcsFejl) throw new KildeFejl(400, 'Det ligner ikke et Aula-kalenderlink: svaret er ikke en kalender.');
        throw err;
      }
      return { tekst: `Aula-kalenderen svarede: ${antal} ${antal === 1 ? 'aftale' : 'aftaler'} de næste syv dage.`, valg: {} };
    },

    async frakobl(ctx): Promise<void> {
      const link = await linkAf(ctx);
      if (link) { husk.delete(hash(link)); gemt.delete(hash(link)); }
    },
  };
}

// ---------- the week ----------

const DATO = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' });
const plusDage = (dato: string, n: number): string => {
  const [y, m, d] = dato.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** The calendar text as the week from `nu`: only id, title, start, end, all_day, calendar (the institution) and location. */
function ugen(tekst: string, nu: Date): { generated: string; days: { date: string; events: Record<string, unknown>[] }[]; errors: string[] } {
  const foerste = DATO.format(nu);
  const til = plusDage(foerste, UGE_DAGE);
  const r = parseIcs(tekst, { fra: foerste, til });
  if (r.ustoettet > 0) console.warn(`aula-kalender: ${r.ustoettet} gentagelsesregel(er) understøttes ikke (kun første forekomst vises)`);
  const dage = new Map<string, { ms: number; heldag: boolean; e: Record<string, unknown> }[]>(Array.from({ length: UGE_DAGE }, (_, i) => [plusDage(foerste, i), []]));
  const set = new Set<string>();
  for (const h of r.haendelser) {
    const e = begivenhed(h, r.kalenderNavn ?? NAVN);
    const id = String(e['id']);
    if (set.has(id)) continue;
    set.add(id);
    const dag = h.start.slice(0, 10) < foerste ? foerste : h.start.slice(0, 10);
    dage.get(dag)?.push({ ms: h.heldag ? 0 : Date.parse(h.start), heldag: h.heldag, e });
  }
  return {
    generated: nu.toISOString(),
    days: [...dage].map(([date, liste]) => ({ date, events: liste.sort((a, b) => Number(b.heldag) - Number(a.heldag) || a.ms - b.ms).map((x) => x.e) })),
    errors: [],
  };
}

function begivenhed(h: IcsHaendelse, institution: string): Record<string, unknown> {
  const id = `aula-${hash(`${h.uid || h.titel}|${h.start}`).slice(0, 16)}`;
  return { id, title: h.titel, start: h.start, end: h.slut, all_day: h.heldag, calendar: institution, location: h.sted };
}
