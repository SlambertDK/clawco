// KC-0059: the visual layer. A decision is read from a pictogram, one headline
// and a small picture (a day line, an amount against its limit, a countdown,
// a week, faces); the explanation is one tap away (mere()). Pure: data in,
// markup out. parseVisuel() is the one validation of what Hermes (or the demo)
// sends, so rooms can store `visuel` next to their own fields.

import { html, raw, type Markup } from './html.ts';
import { IKONER, type IkonNavn } from './ikoner.ts';
import { tilstandFraTone } from './sprog.ts';
import { tekst } from './tekster.ts';

export type { IkonNavn } from './ikoner.ts';
export type Tone = 'god' | 'adv' | 'rolig';
export type Zone = { fra: string; til: string; slags: 'regn' | 'sol' | 'optaget' | 'fri' };
export type Punkt = { tid: string; ikon: IkonNavn; tekst: string; flyttetFra?: string };
export type Billede =
  | { art: 'dagslinje'; fra: number; til: number; zoner: Zone[]; punkter: Punkt[] }
  | { art: 'beloeb'; vaerdi: number; graense: number; enhed: string; tekst: string; graenseTekst: string }
  | { art: 'nedtaelling'; minutter: number; ialt: number; tekst: string }
  | { art: 'uge'; dage: { navn: string; fri: boolean; ikon?: IkonNavn; valgt?: boolean }[] }
  | { art: 'prikker'; antal: number; ialt: number; tekst: string }
  | { art: 'personer'; personer: { navn: string; rolle?: string }[] };
export type Visuel = { ikon: IkonNavn; overskrift?: string; tone?: Tone; billede?: Billede };

const MAX_LISTE = 6;
export const TONER: readonly string[] = ['god', 'adv', 'rolig'];
export const ZONER: readonly string[] = ['regn', 'sol', 'optaget', 'fri'];
/** Every picture kind (KC-0068 derives test coverage from it); the Record makes a new kind a type error until it is listed. */
export const BILLEDER: readonly Billede['art'][] = Object.keys({ dagslinje: 1, beloeb: 1, nedtaelling: 1, uge: 1, prikker: 1, personer: 1 } satisfies Record<Billede['art'], 1>) as Billede['art'][];
const TID = /^([01]\d|2[0-3]):[0-5]\d$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const str = (v: unknown, max = 80): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const tal = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const erIkon = (v: unknown): v is IkonNavn => typeof v === 'string' && Object.hasOwn(IKONER, v);
function liste<T>(v: unknown, f: (x: unknown) => T | undefined): T[] {
  return Array.isArray(v) ? v.map(f).filter((x): x is T => x !== undefined).slice(0, MAX_LISTE) : [];
}

function parseBillede(v: unknown): Billede | undefined {
  if (!isObj(v)) return undefined;
  switch (v['art']) {
    case 'dagslinje': {
      const fra = tal(v['fra']), til = tal(v['til']);
      if (fra === undefined || til === undefined || fra < 0 || til > 24 || til <= fra) return undefined;
      const zoner = liste(v['zoner'], (z) => (isObj(z) && TID.test(str(z['fra'])) && TID.test(str(z['til'])) && ZONER.includes(str(z['slags'])) ? { fra: str(z['fra']), til: str(z['til']), slags: str(z['slags']) as Zone['slags'] } : undefined));
      const punkter = liste(v['punkter'], (p): Punkt | undefined => {
        if (!isObj(p) || !TID.test(str(p['tid'])) || !erIkon(p['ikon'])) return undefined;
        const punkt: Punkt = { tid: str(p['tid']), ikon: p['ikon'], tekst: str(p['tekst'], 40) };
        if (TID.test(str(p['flyttetFra']))) punkt.flyttetFra = str(p['flyttetFra']);
        return punkt;
      });
      return { art: 'dagslinje', fra, til, zoner, punkter };
    }
    case 'beloeb': {
      const vaerdi = tal(v['vaerdi']), graense = tal(v['graense']);
      if (vaerdi === undefined || graense === undefined || vaerdi < 0 || graense <= 0) return undefined;
      return { art: 'beloeb', vaerdi, graense, enhed: str(v['enhed'], 10), tekst: str(v['tekst'], 40), graenseTekst: str(v['graenseTekst'], 40) };
    }
    case 'nedtaelling': {
      const minutter = tal(v['minutter']), ialt = tal(v['ialt']);
      if (minutter === undefined || ialt === undefined || ialt <= 0 || minutter < 0) return undefined;
      return { art: 'nedtaelling', minutter, ialt, tekst: str(v['tekst'], 40) };
    }
    case 'uge': {
      const dage = liste(v['dage'], (d) => {
        if (!isObj(d) || !str(d['navn'], 6)) return undefined;
        return { navn: str(d['navn'], 6), fri: d['fri'] === true, ...(erIkon(d['ikon']) ? { ikon: d['ikon'] } : {}), ...(d['valgt'] === true ? { valgt: true } : {}) };
      });
      return dage.length ? { art: 'uge', dage } : undefined;
    }
    case 'prikker': {
      const antal = tal(v['antal']), ialt = tal(v['ialt']);
      if (antal === undefined || ialt === undefined || ialt < 1 || ialt > 30 || antal < 0 || antal > ialt) return undefined;
      return { art: 'prikker', antal, ialt, tekst: str(v['tekst'], 40) };
    }
    case 'personer': {
      const personer = liste(v['personer'], (p) => (isObj(p) && str(p['navn']) ? { navn: str(p['navn']), ...(str(p['rolle']) ? { rolle: str(p['rolle']) } : {}) } : undefined));
      return personer.length ? { art: 'personer', personer } : undefined;
    }
    default: return undefined;
  }
}

/** A lone pictogram (a calendar post, a talepunkt): undefined unless it is one we have. */
export function parseIkon(v: unknown): IkonNavn | undefined {
  return erIkon(v) ? v : undefined;
}

/** Undefined unless the pictogram is one we have; a bad tone or picture is dropped, not the whole thing. */
export function parseVisuel(v: unknown): Visuel | undefined {
  if (!isObj(v) || !erIkon(v['ikon'])) return undefined;
  const out: Visuel = { ikon: v['ikon'] };
  const overskrift = str(v['overskrift'], 60);
  if (overskrift) out.overskrift = overskrift;
  if (TONER.includes(str(v['tone']))) out.tone = str(v['tone']) as Tone;
  const b = parseBillede(v['billede']);
  if (b) out.billede = b;
  return out;
}

export function ikon(navn: IkonNavn, cls = 'ikon'): Markup {
  const indre = erIkon(navn) ? IKONER[navn] : IKONER['info'];
  return html`<svg class="${cls}" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${raw(indre)}</svg>`;
}

const kr = (n: number): string => new Intl.NumberFormat(tekst().lokale, { maximumFractionDigits: 0 }).format(n);
const pct = (n: number): string => `${Math.round(n * 10000) / 100}%`;
const timer = (t: string): number => Number(t.slice(0, 2)) + Number(t.slice(3, 5)) / 60;

/** Initials on a hue taken from the name, so the same person always has the same colour. */
export function avatar(navn: string): Markup {
  const initialer = navn.split(/\s+/).filter(Boolean).slice(0, 2).map((d) => d[0]?.toUpperCase() ?? '').join('');
  let h = 0;
  for (const c of navn) h = (h * 31 + c.charCodeAt(0)) % 360;
  return html`<span class="avatar" style="--hue:${h}" aria-hidden="true">${initialer}</span>`;
}

/** KC-0084: the clock a day line marks "nu" with: the render moment and the day (YYYY-MM-DD) the picture is for. */
export type NuKontekst = { nu: Date; dag: string };
const KBH = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** The Copenhagen day and hour (with minutes as a fraction) of a moment, whatever the process time zone. */
function kbhNu(d: Date): { dag: string; t: number } {
  const p: Record<string, string> = {};
  for (const x of KBH.formatToParts(d)) p[x.type] = x.value;
  return { dag: `${p['year']}-${p['month']}-${p['day']}`, t: Number(p['hour']) + Number(p['minute']) / 60 };
}

/** `ctx` is only given where the picture is of a known day; without it a day line shows no "nu" (what Hermes stored is never used). */
export function billede(b: Billede, ctx?: NuKontekst): Markup {
  const T = tekst().billede;
  switch (b.art) {
    case 'dagslinje': {
      const span = b.til - b.fra;
      const pos = (t: string): string => pct(Math.min(Math.max((timer(t) - b.fra) / span, 0), 1));
      const marks = [];
      for (let t = Math.ceil(b.fra / 3) * 3; t <= b.til; t += 3) marks.push(t);
      // KC-0074: lanes come from the positions. In time order a point goes in the lower lane unless it is
      // closer than MIN_AFSTAND (a fraction of the span, ~one icon plus its label on a ~300 px phone track)
      // to the previous point there; then it goes above the track, and if both lanes are crowded, in the
      // roomier one. Points far apart never get lifted, so a wide screen stays calm.
      const MIN_AFSTAND = 0.15;
      const sidste: [number, number] = [-Infinity, -Infinity];
      const oppe = new Set<number>();
      b.punkter.map((p, i) => ({ i, x: (timer(p.tid) - b.fra) / span })).sort((a, c) => a.x - c.x || a.i - c.i).forEach(({ i, x }) => {
        const lane = x - sidste[0] >= MIN_AFSTAND ? 0 : x - sidste[1] >= MIN_AFSTAND ? 1 : sidste[0] <= sidste[1] ? 0 : 1;
        sidste[lane] = x;
        if (lane === 1) oppe.add(i);
      });
      const taet = oppe.size > 0;
      // KC-0084: "nu" is the real clock. Always in the markup for today's line (hidden outside it) so public/nu.js can
      // show and move it as time passes; another day's line has none.
      const nuK = ctx ? kbhNu(ctx.nu) : null;
      const iDag = ctx !== undefined && nuK !== null && nuK.dag === ctx.dag;
      const nuT = nuK ? nuK.t : 0;
      const nuMark = iDag ? html`<span class="dl-nu"${nuT < b.fra || nuT > b.til ? raw(' hidden') : raw('')} style="left:${pct(Math.min(Math.max((nuT - b.fra) / span, 0), 1))}"><span>${T.nu}</span></span>` : '';
      const nuAttr = iDag && ctx ? html` data-fra="${b.fra}" data-til="${b.til}" data-dag="${ctx.dag}" data-nu-ms="${ctx.nu.getTime()}"` : '';
      return html`<div class="dagslinje${taet ? ' taet' : ''}"${nuAttr} role="img" aria-label="${b.punkter.map((p) => `${p.tekst} ${p.tid}`).join(', ')}">
        <div class="dl-spor">
          ${b.zoner.map((z) => html`<span class="zone zone-${z.slags}" style="left:${pos(z.fra)};width:${pct((timer(z.til) - timer(z.fra)) / span)}">${z.slags === 'regn' ? ikon('cloud-rain') : z.slags === 'sol' ? ikon('sun') : ''}</span>`)}
          ${nuMark}
          ${b.punkter.map((p, i) => html`${p.flyttetFra ? html`<span class="punkt-spoegelse" style="left:${pos(p.flyttetFra)}">${ikon(p.ikon)}</span>` : ''}<span class="punkt${oppe.has(i) ? ' punkt-op' : ''}" style="left:${pos(p.tid)}">${ikon(p.ikon)}<span class="punkt-tekst">${p.tekst}</span></span>`)}
        </div>
        <div class="dl-skala">${marks.map((t) => html`<span style="left:${pct((t - b.fra) / span)}">${String(t).padStart(2, '0')}</span>`)}</div>
      </div>`;
    }
    case 'beloeb': {
      const over = b.vaerdi > b.graense;
      const lige = b.vaerdi === b.graense;
      const max = Math.max(b.vaerdi, b.graense);
      return html`<div class="beloeb tilstand-${over ? 'kraever' : 'ordnet'}">
        <div class="bl-tal"><span class="bl-vaerdi">${kr(b.vaerdi)} ${b.enhed}</span><span class="bl-dom">${over ? `+${kr(b.vaerdi - b.graense)} ${b.enhed}` : lige ? html`${ikon('check')} ${T.passer}` : `${kr(b.graense - b.vaerdi)} ${b.enhed} ${T.under}`}</span></div>
        <div class="bl-spor"><span class="bl-fyld" style="width:${pct(b.vaerdi / max)}"></span>${over ? html`<span class="bl-over" style="left:${pct(b.graense / max)};width:${pct((b.vaerdi - b.graense) / max)}"></span>` : ''}<span class="bl-graense" style="left:${pct(b.graense / max)}"></span></div>
        <div class="bl-noter"><span>${b.tekst}</span><span>${b.graenseTekst} ${kr(b.graense)}</span></div>
      </div>`;
    }
    case 'nedtaelling': {
      const r = 26, omkreds = 2 * Math.PI * r;
      const andel = Math.min(Math.max(b.minutter / b.ialt, 0), 1);
      return html`<div class="nedtaelling"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="${r}" class="nt-spor"/><circle cx="32" cy="32" r="${r}" class="nt-fyld" stroke-dasharray="${(andel * omkreds).toFixed(1)} ${omkreds.toFixed(1)}" transform="rotate(-90 32 32)"/><text x="32" y="37" text-anchor="middle">${b.minutter}</text></svg><span class="nt-tekst"><span class="nt-enhed">${T.min}</span>${b.tekst}</span></div>`;
    }
    case 'uge':
      return html`<div class="uge">${b.dage.map((d) => html`<span class="uge-dag ${d.fri ? 'fri' : 'optaget'}${d.valgt ? ' valgt' : ''}"><span class="uge-navn">${d.navn}</span>${d.ikon ? ikon(d.ikon) : d.fri ? ikon('check') : html`<span class="uge-streg"></span>`}</span>`)}</div>`;
    case 'prikker':
      return html`<div class="prikker"><span class="pk-raekke">${Array.from({ length: b.ialt }, (_, i) => html`<span class="prik${i < b.antal ? ' fyldt' : ''}"></span>`)}</span><span class="pk-tekst">${b.antal} ${T.af} ${b.ialt} ${b.tekst}</span></div>`;
    case 'personer':
      return html`<div class="personer">${b.personer.map((p) => html`<span class="person">${avatar(p.navn)}<span class="person-navn">${p.navn}</span>${p.rolle ? html`<span class="person-rolle">${p.rolle}</span>` : ''}</span>`)}</div>`;
  }
}

/** Pictogram + one headline (+ a small label above it). */
export function visHoved(v: Pick<Visuel, 'ikon' | 'tone'>, overskrift: string, etiket?: string): Markup {
  return html`<div class="vis-hoved"><span class="vis-ikon tilstand-${tilstandFraTone(v.tone)}"${v.tone ? html` data-tone="${v.tone}"` : ''}>${ikon(v.ikon)}</span><div class="vis-titel">${etiket ? html`<span class="vis-etiket">${etiket}</span>` : ''}<h3 class="vis-overskrift">${overskrift}</h3></div></div>`;
}

/** The explanation behind one tap, on every device. */
export function mere(indhold: Markup, navn = tekst().billede.hvorfor): Markup {
  return html`<details class="vis-mere"><summary>${ikon('info')}<span>${navn}</span></summary><div class="vis-mere-indhold">${indhold}</div></details>`;
}

/** KC-0060: one example of `visuel` for a prompt's JSON schema (it parses; a test holds it to that). */
export const VISUEL_SKEMA = '{ "ikon": "cloud-rain", "overskrift": "Løb kl. 12 – regn fra 16", "tone": "adv", "billede": { "art": "dagslinje", "fra": 6, "til": 22, "zoner": [{ "fra": "16:00", "til": "19:00", "slags": "regn" }], "punkter": [{ "tid": "12:00", "ikon": "footprints", "tekst": "Løb", "flyttetFra": "17:00" }] } }';

/** KC-0060: the pictogram names a prompt may use, derived from IKONER. */
export function ikonListe(): string {
  return Object.keys(IKONER).join(', ');
}

/** KC-0060: the rules every prompt that asks for `visuel` shares. */
export function visuelRegler(): string {
  return `- "visuel" er det, Henrik træffer beslutningen ud fra på et øjeblik: et piktogram, én kort overskrift og helst et lille billede. Teksten ligger bag et tryk.
  - "ikon" (skal): ét af ${ikonListe()}.
  - "overskrift": højst 30 tegn, selve beslutningen eller svaret ("2.600 kr. over budget", "Gå om 10 min"), ikke emnet.
  - "tone": "adv" når Henrik skal se på det, "god" når det er i orden, ellers udelad.
  - "billede" (valgfri, men brug det, når et billede siger det hurtigere end ord), præcis én af:
    "dagslinje": { "art": "dagslinje", "fra": 6, "til": 22, "zoner": [{ "fra": "HH:MM", "til": "HH:MM", "slags": "regn | sol | optaget | fri" }], "punkter": [{ "tid": "HH:MM", "ikon": "<ikon>", "tekst": "1 ord", "flyttetFra": "HH:MM hvis flyttet" }] } — tider på dagen, højst 6 punkter;
    "beloeb": { "art": "beloeb", "vaerdi": 18400, "graense": 15800, "enhed": "kr.", "tekst": "Tilbud", "graenseTekst": "Budget" } — et beløb mod budget, tilbud eller sidste gang;
    "nedtaelling": { "art": "nedtaelling", "minutter": 10, "ialt": 60, "tekst": "Gå 15.35" } — tid til noget skal ske;
    "uge": { "art": "uge", "dage": [{ "navn": "lør", "fri": true, "ikon": "gift", "valgt": true }] } — hvilke dage er fri;
    "prikker": { "art": "prikker", "antal": 0, "ialt": 12, "tekst": "åbnet" } — hvor mange af noget;
    "personer": { "art": "personer", "personer": [{ "navn": "Fornavn Efternavn", "rolle": "kort" }] } — hvem det handler om, højst 6.
  - Brug kun tal, tider og navne, du har belæg for; er du i tvivl, så udelad "billede".`;
}
