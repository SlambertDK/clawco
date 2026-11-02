// The Saturday conflict (KC-0152, scenario 25): on a Tuesday Clawco looks at the coming weekend; when the two adults
// of the household are busy at the same time and something has to be covered then (a child at home, a household
// resource booked), ONE neutral card goes to both of them with exactly the same content. It takes no side: the
// parties are in alphabetical order, the options are "A tager", "B tager" and "Find en tredje", and a pick only
// becomes a request (KC-0149) to the other person — nothing is decided for them and nothing leaves the app.
//
// Privacy (E1 zones, E7 policy): each member contributes busy blocks only. A title is kept only when the event is in
// zone husstand or its calendar's owner shares titles (the KC-0142 rule "kalender / del titel i husstanden"); a body
// is never read. Pure: no I/O, the clock passed in.

import { koebenhavnTilIso } from '../shell/tid.ts';
import { klokke } from './render.ts';
import { beslutter, type Forespoergsel } from './foresp.ts';
import { iSaetning, overlapper, type PersonId, type Ressource, type Tidsrum } from './ressource.ts';
import type { Medlem } from './schema.ts';
import { medlemmerI, type KalenderLaesning } from './uge.ts';

/** One calendar as read, and whether its owner lets the household see event titles (never true by default). */
export type OptagetKalender = KalenderLaesning & { delerTitel: boolean };

/** A stretch of time one member is busy. `med`: every member on the same event (a child at the event is not at home). */
export type Blok = { hvem: PersonId; start: string; slut: string; med: PersonId[]; titel?: string };

export type Behov = { slags: 'barn' | 'ressource'; id: string; navn: string };
/** What the pure check finds: who clashes, when (the overlap), and what needs covering. */
export type Kandidat = { noegle: string; dag: string; parter: [PersonId, PersonId]; tid: Tidsrum; blokke: [Blok, Blok]; behov: Behov };

export type KonfliktValg = { id: string; slags: 'tager'; hvem: PersonId } | { id: string; slags: 'tredje' };
/** Hermes' phrasing of the card (validated by parseKonfliktTekst); the fixed words show without it. */
export type KonfliktTekst = { resume: string; spoergsmaal: string };

export type Konflikt = {
  id: string;
  /** `<dag>|<behov slags>:<id>` — one card per weekend day and need, whatever the order the check runs in. */
  noegle: string;
  dag: string;
  /** The two adults in alphabetical order of name; it never changes after the card is made. */
  parter: [PersonId, PersonId];
  behov: Behov;
  /** The overlap of the two blocks (and of the booking, for a resource): the time the request is about. */
  tid: Tidsrum;
  blokke: [Blok, Blok];
  valg: KonfliktValg[];
  oprettet: string;
  tekst?: KonfliktTekst;
  /** The request a pick created, and which option it asked for. */
  forespId?: string; forespValg?: string;
};

const TZ = 'Europe/Copenhagen';
const TITEL_MAX = 120;
const DAGE = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
const ENTIME = 3600_000;
export const ukendt = 'en i husstanden';

const erObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const tekstAf = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max) : '');
const erVoksen = (m: Medlem): boolean => m.rolle === 'ejer' || m.rolle === 'medlem';
const navnSort = (a: Medlem, b: Medlem): number => a.navn.localeCompare(b.navn, 'da') || a.id.localeCompare(b.id);

// ---------- busy blocks ----------

/**
 * Busy blocks of the calendars that were read: timed events only (an all-day entry takes nobody away), the members it
 * belongs to (a husstand-zone event: its attendees and creator; any other zone: the calendar's owner), and the title
 * only when it may be shown. An event with no end is an hour. Untrusted input: every field is checked and capped.
 */
export function blokkeFraKalendere(kalendere: readonly OptagetKalender[], medlemmer: readonly Medlem[]): Blok[] {
  const ud: Blok[] = [];
  for (const k of kalendere) {
    const ejer = k.ejer && medlemmer.some((m) => m.id === k.ejer) ? k.ejer : null;
    const dage = erObj(k.data) && Array.isArray(k.data['days']) ? k.data['days'] : [];
    for (const d of dage) {
      for (const e of erObj(d) && Array.isArray(d['events']) ? d['events'] : []) {
        if (!erObj(e) || e['all_day'] === true) continue;
        const start = Date.parse(tekstAf(e['start'], 40));
        if (Number.isNaN(start)) continue;
        const slutRaa = Date.parse(tekstAf(e['end'], 40));
        const slut = Number.isNaN(slutRaa) || slutRaa <= start ? start + ENTIME : slutRaa;
        const hvem = k.zone === 'husstand' ? medlemmerI(e, medlemmer) : [];
        const med = hvem.length ? hvem : ejer ? [ejer] : [];
        if (!med.length) continue;
        const titel = (k.zone === 'husstand' || k.delerTitel) ? tekstAf(e['title'], TITEL_MAX) : '';
        for (const m of med) ud.push({ hvem: m, start: new Date(start).toISOString(), slut: new Date(slut).toISOString(), med, ...(titel ? { titel } : {}) });
      }
    }
  }
  return ud;
}

// ---------- the candidate ----------

const klip = (a: Tidsrum, b: Tidsrum): Tidsrum | null => {
  const start = Math.max(Date.parse(a.start), Date.parse(b.start)), slut = Math.min(Date.parse(a.slut), Date.parse(b.slut));
  return start < slut ? { start: new Date(start).toISOString(), slut: new Date(slut).toISOString() } : null;
};

function dagsrum(dag: string): Tidsrum | null {
  const fra = koebenhavnTilIso(`${dag}T00:00`);
  const d = new Date(`${dag}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1);
  const til = koebenhavnTilIso(`${d.toISOString().slice(0, 10)}T00:00`);
  return fra && til ? { start: fra, slut: til } : null;
}

/**
 * The conflicts of the given weekend days. Exactly two adults (a guest is not one) — with three, someone else may be
 * free, and that is out of scope. A need is a child member (not at the same event as the adults) or a household
 * resource booked in the window; no need, no candidate (KC-0052). Same answer whatever order the input is in.
 */
export function weekendKonflikter(blokke: readonly Blok[], h: { medlemmer: readonly Medlem[]; ressourcer: readonly Ressource[] }, dage: readonly string[]): Kandidat[] {
  const voksne = h.medlemmer.filter(erVoksen).sort(navnSort);
  if (voksne.length !== 2) return [];
  const [a, b] = voksne as [Medlem, Medlem];
  const born = h.medlemmer.filter((m) => m.rolle === 'barn').sort(navnSort);
  const ud: Kandidat[] = [];
  for (const dag of [...dage].sort()) {
    const rum = dagsrum(dag);
    if (!rum) continue;
    const afPerson = (id: PersonId, uden?: PersonId): Blok[] => blokke.filter((x) => x.hvem === id && overlapper(x, rum) && !(uden && x.med.includes(uden)))
      .sort((x, y) => Date.parse(x.start) - Date.parse(y.start) || Date.parse(x.slut) - Date.parse(y.slut) || (x.titel ?? '').localeCompare(y.titel ?? ''));
    /** The earliest pair of blocks (one each) that overlap inside the day, and where. */
    const foerstePar = (uden?: PersonId, inden?: Tidsrum): { par: [Blok, Blok]; tid: Tidsrum } | null => {
      let bedst: { par: [Blok, Blok]; tid: Tidsrum } | null = null;
      for (const x of afPerson(a.id, uden)) for (const y of afPerson(b.id, uden)) {
        const t0 = klip(x, y); const t = t0 && klip(t0, rum);
        const t1 = t && inden ? klip(t, inden) : t;
        if (t1 && (!bedst || Date.parse(t1.start) < Date.parse(bedst.tid.start))) bedst = { par: [x, y], tid: t1 };
      }
      return bedst;
    };
    for (const barn of born) {
      const p = foerstePar(barn.id);
      if (p) ud.push({ noegle: `${dag}|barn:${barn.id}`, dag, parter: [a.id, b.id], tid: p.tid, blokke: p.par, behov: { slags: 'barn', id: barn.id, navn: barn.navn } });
    }
    for (const r of h.ressourcer) {
      // A resource that stands for a child who is a member is already that child's need.
      if (r.slags === 'person' && born.some((m) => m.navn.toLowerCase() === r.navn.toLowerCase())) continue;
      let funden: Kandidat | null = null;
      for (const bk of [...r.kalender].sort((x, y) => Date.parse(x.start) - Date.parse(y.start))) {
        const p = foerstePar(undefined, bk);
        if (p) { funden = { noegle: `${dag}|ressource:${r.id}`, dag, parter: [a.id, b.id], tid: p.tid, blokke: p.par, behov: { slags: 'ressource', id: r.id, navn: r.navn } }; break; }
      }
      if (funden) ud.push(funden);
    }
  }
  return ud;
}

// ---------- the card ----------

/** The card from a candidate: the three options in a fixed order, the parties as the check found them. */
export function nytKonflikt(o: { id: string; kandidat: Kandidat; nu: Date }): Konflikt {
  const k = o.kandidat;
  const [a, b] = k.parter;
  const blok = (x: Blok): Blok => ({ hvem: x.hvem, start: x.start, slut: x.slut, med: [...x.med], ...(x.titel ? { titel: x.titel } : {}) });
  return {
    id: o.id, noegle: k.noegle, dag: k.dag, parter: [a, b], behov: { ...k.behov }, tid: { ...k.tid }, blokke: [blok(k.blokke[0]), blok(k.blokke[1])],
    valg: [{ id: 'v1', slags: 'tager', hvem: a }, { id: 'v2', slags: 'tager', hvem: b }, { id: 'v3', slags: 'tredje' }],
    oprettet: o.nu.toISOString(),
  };
}

export const erPartIKonflikt = (k: Pick<Konflikt, 'parter'>, person: PersonId): boolean => k.parter.includes(person);
/** The other adult, seen from `person`. */
export const andenIKonflikt = (k: Pick<Konflikt, 'parter'>, person: PersonId): PersonId => (k.parter[0] === person ? k.parter[1] : k.parter[0]);

const navnAf = (medlemmer: readonly Medlem[], id: string): string => medlemmer.find((m) => m.id === id)?.navn ?? ukendt;

/** "9", "9.30", "14": the clock the way a person says it. */
export const hel = (iso: string): string => klokke(iso).replace(/^0/, '').replace(/\.00$/, '');
const dagNavn = (dag: string): string => DAGE[new Date(`${dag}T12:00:00Z`).getUTCDay()] ?? dag;
const stort = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The words of the card: what each has (with the titles that may be shown) and the question. Identical for both. */
export function konfliktResume(k: Konflikt, medlemmer: readonly Medlem[]): KonfliktTekst {
  if (k.tekst) return k.tekst;
  const del = k.blokke.map((b) => `${navnAf(medlemmer, b.hvem)} ${b.titel ? `har ${b.titel}` : 'er optaget'} ${hel(b.start)} til ${hel(b.slut)}`);
  const behov = k.behov.slags === 'barn' ? `Hvem har ${k.behov.navn}?` : `Hvem tager ${iSaetning(k.behov.navn)}?`;
  return { resume: `${stort(dagNavn(k.dag))}: ${del.join(', ')}.`, spoergsmaal: behov };
}

const FRA_SIDE = /(?<![\p{L}\p{N}])(du|dig|din|dit|dine|jeg|mig|min|mit|mine)(?![\p{L}\p{N}])/iu;

/**
 * Hermes' answer → the card's phrasing, or null (nothing is written). One fenced block {"resume","spoergsmaal"}:
 * plain text, no control characters, short, naming both adults and neither "du" nor "jeg" — the same words are shown
 * to both, so it cannot be spoken to one of them.
 */
export function parseKonfliktTekst(svar: string, k: Pick<Konflikt, 'parter'>, medlemmer: readonly Medlem[]): KonfliktTekst | null {
  const blok = /```(?:json)?\s*([\s\S]*?)```/i.exec(svar)?.[1];
  if (!blok) return null;
  let raw: unknown;
  try { raw = JSON.parse(blok); } catch { return null; }
  if (!erObj(raw) || typeof raw['resume'] !== 'string' || typeof raw['spoergsmaal'] !== 'string') return null;
  const resume = raw['resume'].trim(), spoergsmaal = raw['spoergsmaal'].trim();
  if (!resume || !spoergsmaal || resume.length > 300 || spoergsmaal.length > 100) return null;
  if (/[\u0000-\u001f\u007f]/.test(resume + spoergsmaal) || /[<>]/.test(resume + spoergsmaal)) return null;
  if (FRA_SIDE.test(`${resume} ${spoergsmaal}`)) return null;
  if (!k.parter.every((id) => resume.toLowerCase().includes(navnAf(medlemmer, id).toLowerCase()))) return null;
  return { resume, spoergsmaal };
}

/** `lørdag kl. 11.00–13.00` — the time of the request, the day in words. */
export const tidSag = (k: Pick<Konflikt, 'tid' | 'dag'>): string => `${dagNavn(k.dag)} kl. ${klokke(k.tid.start)}–${klokke(k.tid.slut)}`;

/** What the request from a pick says, from the asker's side (the asker is the one who tapped). */
export function valgTitel(k: Konflikt, v: KonfliktValg, asker: PersonId): string {
  const hvad = k.behov.slags === 'barn' ? k.behov.navn : iSaetning(k.behov.navn);
  const nar = tidSag(k);
  if (v.slags === 'tredje') return `Kan vi finde en tredje til ${hvad} ${nar}?`.slice(0, 200);
  return (v.hvem === asker ? `Jeg tager ${hvad} ${nar}. Passer det?` : `Kan du tage ${hvad} ${nar}?`).slice(0, 200);
}

/**
 * aaben: options show · venter: a request from a pick waits for the other · afgjort: that request was accepted ·
 * forbi: the time has come. A request that was refused or ran out leaves the card open again (nothing was decided).
 */
export function konfliktStatus(k: Konflikt, forespoergsler: readonly Pick<Forespoergsel, 'id' | 'tilstand' | 'fra' | 'til'>[], nu: Date): 'aaben' | 'venter' | 'afgjort' | 'forbi' {
  const f = k.forespId ? forespoergsler.find((x) => x.id === k.forespId) : undefined;
  if (f?.tilstand === 'accepteret') return 'afgjort';
  if (nu.getTime() >= Date.parse(k.tid.slut)) return 'forbi';
  if (f && beslutter(f) !== null) return 'venter';
  return 'aaben';
}

/** KC-0142: the rule that lets a calendar's event titles be seen by the household (written as `gaelder: kalender / del titel i husstanden`). */
export const DEL_TITEL = { kilde: 'kalender', slags: 'del titel i husstanden' } as const;

/** Whether the rules hold an active rule that shares calendar titles in the household. A paused or misspelled rule shares nothing. */
export const delerTitelRegel = (regler: readonly { gaelder: { kilde: string; slags?: string }; status: string }[]): boolean =>
  regler.some((r) => r.status === 'aktiv' && r.gaelder.kilde === DEL_TITEL.kilde && r.gaelder.slags === DEL_TITEL.slags);
