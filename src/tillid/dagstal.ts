// KC-0147 "Ugens tal": how many things required the owner each day, and the one
// weekly number built from it ("I denne uge krævede i snit 6 ting dig om dagen
// (sidste uge 9). Fortryd: 1."). Definition (stated in the UI's help text): an
// element counts for a day when it stood in Nu's "Kræver dig" band at any time
// that day, once per element id; "Fortryd" = log lines undone that day, across
// rooms. This file: pure week math and counters, the pure render, and the
// append-only store ($KC_DATA_DIR/tillid/dagstal.jsonl, never rewritten, §4 r5).
//
// Weeks run Monday 00:00 to Sunday 24:00 Europe/Copenhagen. Dates here are
// Copenhagen YYYY-MM-DD (idagKbh); the clock is always injected.
// "Skjulte" (things hidden by a rule or sample) comes with KC-0145; until it is
// built the figure is left out rather than shown as 0.

import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { html, type Markup } from '../shell/html.ts';
import { idagKbh } from '../shell/tid.ts';

export type Dagstal = { dato: string; kraevede: number; fortryd: number; regler?: number };
/** One week: `dage` = days with a snapshot, `snit` = things per such day (not rounded), `fortryd` = Fortryd over the week. */
export type Ugetal = { uge: string; nr: number; dage: number; snit: number; fortryd: number };

const DAG_MS = 86_400_000;
const ms = (dato: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dato);
  if (!m) throw new Error(`ugyldig dato: ${dato}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};
const iso = (t: number): string => new Date(t).toISOString().slice(0, 10);

/** The Monday (YYYY-MM-DD) of the week `dato` falls in. */
export function mandagFor(dato: string): string {
  const t = ms(dato);
  return iso(t - ((new Date(t).getUTCDay() + 6) % 7) * DAG_MS);
}

/** ISO week number of the week that starts on `mandag`. */
export function ugeNr(mandag: string): number {
  const torsdag = new Date(ms(mandag) + 3 * DAG_MS);
  const aarStart = Date.UTC(torsdag.getUTCFullYear(), 0, 1);
  return Math.floor((torsdag.getTime() - aarStart) / DAG_MS / 7) + 1;
}

/** The Monday of the week `nu` falls in, by Copenhagen's calendar. */
export const ugeAf = (nu: Date): string => mandagFor(idagKbh(nu));

/** From Monday 00:00 until Tuesday 00:00 in Copenhagen: when Nu shows the week's number (KC-0052). */
export const erMandag = (nu: Date): boolean => new Date(ms(idagKbh(nu))).getUTCDay() === 1;

/** Log lines undone on `dato` (the Copenhagen day of the undo), across whatever rooms' lines are given. */
export function fortrudtPaaDag(log: readonly { fortrudt?: string | undefined }[], dato: string): number {
  return log.filter((e) => {
    const t = e.fortrudt ? Date.parse(e.fortrudt) : NaN;
    return !Number.isNaN(t) && idagKbh(new Date(t)) === dato;
  }).length;
}

/** The week starting `mandag`, from per-day snapshots (one per date). */
export function ugetal(dage: readonly Dagstal[], mandag: string): Ugetal {
  const slut = iso(ms(mandag) + 7 * DAG_MS);
  const uge = dage.filter((d) => d.dato >= mandag && d.dato < slut);
  const sum = uge.reduce((n, d) => n + d.kraevede, 0);
  return { uge: mandag, nr: ugeNr(mandag), dage: uge.length, snit: uge.length ? sum / uge.length : 0, fortryd: uge.reduce((n, d) => n + d.fortryd, 0) };
}

/** The days that are over: today's count is still growing, so it is left out of every figure shown. */
export const faerdigeDage = (dage: readonly Dagstal[], idag: string): Dagstal[] => dage.filter((d) => d.dato < idag);

/** The last `antal` weeks (default eight), oldest first, ending with the week that starts on `nuMandag`. */
export function raekke(dage: readonly Dagstal[], nuMandag: string, antal = 8): Ugetal[] {
  return Array.from({ length: antal }, (_, i) => ugetal(dage, iso(ms(nuMandag) - (antal - 1 - i) * 7 * DAG_MS)));
}

// ---- the store ----------------------------------------------------------------
// One JSON line per change to a day, appended and never rewritten:
//   { dato, nye: [ids first seen now], kraevede: running total for the day, fortryd, regler? }
// The last line of a day is its snapshot; the ids of all its lines are what a restart needs to keep counting
// each id once. Seeded history (the test world) may omit `nye`.

export type DagstalLager = {
  /**
   * `ids` = the element ids in the Kræver dig band right now; `o.fortryd` = Fortryd so far that day,
   * `o.regler` = the number of active rules. Appends only when something changed (or the day is new).
   */
  noter(dato: string, ids: readonly string[], o?: { fortryd?: number; regler?: number }): Promise<void>;
  /** One snapshot per day, oldest first. Never throws on a missing or damaged file. */
  dage(): Promise<Dagstal[]>;
};

type Dag = { ids: Set<string>; kraevede: number; fortryd: number; regler?: number };
const DATO = /^\d{4}-\d{2}-\d{2}$/;
const tal = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function laes(tekst: string): Map<string, Dag> {
  const dage = new Map<string, Dag>();
  for (const linje of tekst.split('\n')) {
    if (!linje.trim()) continue;
    let j: Record<string, unknown>;
    try { j = JSON.parse(linje) as Record<string, unknown>; } catch { continue; }
    if (typeof j['dato'] !== 'string' || !DATO.test(j['dato']) || !tal(j['kraevede'])) continue;
    const dag = dage.get(j['dato']) ?? { ids: new Set<string>(), kraevede: 0, fortryd: 0 };
    for (const id of Array.isArray(j['nye']) ? j['nye'] : []) if (typeof id === 'string') dag.ids.add(id);
    dag.kraevede = j['kraevede'];
    dag.fortryd = tal(j['fortryd']) ? j['fortryd'] : 0;
    if (tal(j['regler'])) dag.regler = j['regler']; else delete dag.regler;
    dage.set(j['dato'], dag);
  }
  return dage;
}

export function lavDagstal(o: { dir: string }): DagstalLager {
  const fil = path.join(o.dir, 'tillid', 'dagstal.jsonl');
  let cache: { sig: string; dage: Map<string, Dag> } | undefined;
  let kaede: Promise<unknown> = Promise.resolve();
  const enkeltvis = <T>(fn: () => Promise<T>): Promise<T> => {
    const r = kaede.then(fn);
    kaede = r.catch(() => undefined);
    return r;
  };
  const signatur = async (): Promise<string> => { try { const s = await stat(fil); return `${s.size}:${s.mtimeMs}`; } catch { return ''; } };
  /** The file's days; the cache is trusted only while the file is exactly as this lager left it (a deleted or replaced file is read afresh). */
  async function indlaes(): Promise<Map<string, Dag>> {
    const sig = await signatur();
    if (cache && cache.sig === sig) return cache.dage;
    let tekst = '';
    if (sig) { try { tekst = await readFile(fil, 'utf8'); } catch { tekst = ''; } }
    cache = { sig, dage: laes(tekst) };
    return cache.dage;
  }
  return {
    noter: (dato, ids, v = {}) => enkeltvis(async () => {
      if (!DATO.test(dato)) throw new Error(`ugyldig dato: ${dato}`);
      const dage = await indlaes();
      const dag = dage.get(dato);
      const nye = [...new Set(ids)].filter((id) => !dag?.ids.has(id));
      const fortryd = v.fortryd ?? dag?.fortryd ?? 0;
      const regler = v.regler ?? dag?.regler;
      if (dag && !nye.length && fortryd === dag.fortryd && regler === dag.regler) return;
      const kraevede = (dag?.kraevede ?? 0) + nye.length;
      await mkdir(path.dirname(fil), { recursive: true });
      await appendFile(fil, `${JSON.stringify({ dato, nye, kraevede, fortryd, ...(regler !== undefined ? { regler } : {}) })}\n`, 'utf8');
      const ny = dag ?? { ids: new Set<string>(), kraevede: 0, fortryd: 0 };
      for (const id of nye) ny.ids.add(id);
      ny.kraevede = kraevede;
      ny.fortryd = fortryd;
      if (regler !== undefined) ny.regler = regler;
      dage.set(dato, ny);
      cache = { sig: await signatur(), dage };
    }),
    dage: () => enkeltvis(async () => [...(await indlaes())].sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([dato, x]) => ({ dato, kraevede: x.kraevede, fortryd: x.fortryd, ...(x.regler !== undefined ? { regler: x.regler } : {}) }))),
  };
}

// ---- the line and the bars (pure) ---------------------------------------------

/** What the line is about: `valgt` against `forrige` (the last earlier week that has data), and the words for both. */
export type Ugevisning = { valgt: Ugetal; forrige?: Ugetal; start: string; forrigeNavn?: string };

const afrund = (n: number): number => Math.round(n);

/**
 * The week the line is about, from `raekke` (oldest first): the latest week with data. `sidsteEr` says what the last element
 * is: 'denne' (this week, still running — the page) or 'sidste' (the week that just ended — Nu on a Monday, when this week
 * has barely begun). Undefined when no week has data.
 */
export function ugeVisning(raekke: readonly Ugetal[], sidsteEr: 'denne' | 'sidste'): Ugevisning | undefined {
  const i = raekke.map((u) => u.dage > 0).lastIndexOf(true);
  const valgt = raekke[i];
  if (!valgt) return undefined;
  const siden = (k: number): number => raekke.length - 1 - k + (sidsteEr === 'denne' ? 0 : 1); // weeks ago
  const gammel = siden(i);
  const start = gammel === 0 ? 'I denne uge' : gammel === 1 ? 'Sidste uge' : `I uge ${valgt.nr}`;
  const j = raekke.slice(0, i).map((u) => u.dage > 0).lastIndexOf(true);
  const forrige = raekke[j];
  if (!forrige) return { valgt, start };
  const forrigeNavn = siden(j) === gammel + 1 ? (gammel === 0 ? 'sidste uge' : 'ugen før') : `uge ${forrige.nr}:`;
  return { valgt, forrige, start, forrigeNavn };
}

/**
 * The one line. Two weeks or more: "I denne uge krævede i snit 6 ting dig om dagen (sidste uge 9). Fortryd: 1."; when the
 * number fell and Fortryd did not rise it adds "Det er faldet, uden at Fortryd steg." — only when that is literally true on
 * the numbers shown, and never for a week with fewer days than the one it is compared with (an unfinished week has had less
 * chance to be undone). Under two weeks of data: "Første uge: 6 om dagen. Sammenligning kommer næste uge."
 * `hjaelp`: the definition, for the page that explains the number.
 */
export function ugeLinje(v: Ugevisning, o: { hjaelp?: boolean } = {}): Markup {
  const a = afrund(v.valgt.snit);
  let linje: string;
  if (!v.forrige) linje = `Første uge: ${a} om dagen. Sammenligning kommer næste uge.`;
  else {
    const b = afrund(v.forrige.snit);
    const f = v.valgt.fortryd;
    const steg = f > v.forrige.fortryd;
    const sidste = `(${v.forrigeNavn} ${b})`;
    const faldt = a < b && !steg && v.valgt.dage >= v.forrige.dage;
    linje = `${v.start} krævede i snit ${a} ting dig om dagen ${sidste}. Fortryd: ${f}${steg ? ` (${v.forrigeNavn} ${v.forrige.fortryd})` : ''}.${faldt ? ' Det er faldet, uden at Fortryd steg.' : ''}`;
  }
  const hjaelp = o.hjaelp
    ? html`<p class="row-note" data-ugetal="hjaelp">Sådan tæller vi: en ting tæller for en dag, hvis den stod under Kræver dig på noget tidspunkt den dag, og kun én gang den dag. Fortryd er de handlinger, du fortrød i ugen. Tallet skal falde, uden at Fortryd stiger.</p>`
    : '';
  return html`<div class="ugetal"><p class="ugetal-linje" data-ugetal="linje">${linje}</p>${hjaelp}</div>`;
}

/** The text alternative of the bars: "uge 43: 9, uge 44: 6 …" ("–" for a week with no data). */
export const ugeTekst = (raekke: readonly Ugetal[]): string => raekke.map((u) => `uge ${u.nr}: ${u.dage ? afrund(u.snit) : '–'}`).join(', ');

/** The eight-week row of bars (the last bar is the current week). On a phone the figure is hidden: there it is just the line. */
export function ugeSoejler(raekke: readonly Ugetal[]): Markup {
  const maks = Math.max(1, ...raekke.map((u) => u.snit));
  const alt = `Ting der krævede dig om dagen, uge for uge: ${ugeTekst(raekke)}`;
  const BREDDE = 16, AFSTAND = 6, HOJDE = 40;
  const soejler = raekke.map((u, i) => {
    const h = u.dage ? Math.max(2, (u.snit / maks) * HOJDE) : 1;
    const klasse = `${u.dage ? 'ugetal-soejle' : 'ugetal-soejle ugetal-tom'}${i === raekke.length - 1 ? ' ugetal-nu' : ''}`;
    const x = i * (BREDDE + AFSTAND);
    return html`<rect class="${klasse}" x="${x}" y="${HOJDE - h}" width="${BREDDE}" height="${h}" rx="2"></rect><text class="ugetal-nr" x="${x + BREDDE / 2}" y="${HOJDE + 11}" text-anchor="middle">${String(u.nr)}</text>`;
  });
  const bredde = raekke.length * (BREDDE + AFSTAND) - AFSTAND;
  return html`<figure class="ugetal-soejler" data-ugetal="soejler" role="img" aria-label="${alt}"><svg viewBox="0 0 ${bredde} ${HOJDE + 14}" aria-hidden="true" focusable="false">${soejler}</svg><figcaption class="row-note">${ugeTekst(raekke)}</figcaption></figure>`;
}
