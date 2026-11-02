// The pricing page of clawco.work (KC-0199). Rendered at build time from config/priser.json, the one price source
// (KC-0190, AGENTS §0 r6): plan names, member limits, amounts in both currencies and both intervals, the trial, the
// add-on status. No amount is typed into the template or into the language table; this file is the only reader.
// Plain string work, no framework: site/priser.template.html holds the page, the generator fills the plan cards, and
// every visible text comes from the one key table (site/strings.js), so the English HTML equals the English table
// by construction. Run by scripts/site-byg.mjs; the draft/approved rule (gate G5) is `tjekUdgivelse`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export type Sprog = 'en' | 'da';
export type Valuta = 'dkk' | 'eur';
export type Tabel = Record<Sprog, Record<string, string>>;
/** `preview` builds the page whatever the status; `live` is the publish step and refuses a draft price. */
export type Maal = 'preview' | 'live';

/** The sign-up app (KC-0198): the plan step reads `plan` and `interval` from here. */
export const TILMELD = 'https://konto.clawco.work/tilmeld';
const HOST = 'https://clawco.work';
const VALUTAER: readonly Valuta[] = ['eur', 'dkk'];
const INTERVALLER = [
  { id: 'maaned', felt: 'maanedlig', per: 'pr.per.month' },
  { id: 'aar', felt: 'aarlig', per: 'pr.per.year' },
] as const;

export class PriserNaegtet extends Error {}

// The price file, as far as the page reads it. Sky has its own strict reader (sky/src/abonnement/priser.ts); nothing
// outside sky/ may import from it (sky/test/aftryk.test.ts), so this is the site's reader of the same file: it
// validates only what the page shows and names the JSON path that is wrong. The file stays the one source of the numbers.
export type Beloeb = { dkk: number; eur: number };
export type Plan = { navn: string; medlemmer: number; maanedlig: Beloeb; aarlig: Beloeb };
export type Tilvalg = { navn: string; status: 'senere' | 'aktiv'; fraMaanedlig: Beloeb };
export type Priser = {
  status: 'udkast' | 'godkendt';
  moms: { aktiv: boolean };
  proeve: { dage: number; kort: boolean };
  planer: Record<string, Plan>;
  tilvalg: Record<string, Tilvalg>;
};

const fejl = (sti: string, hvad: string): Error => new Error(`config/priser.json: ${sti} ${hvad}`);
const obj = (v: unknown, sti: string): Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw fejl(sti, 'must be an object');
  return v as Record<string, unknown>;
};
const heltal = (v: unknown, sti: string, min: number): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min) throw fejl(sti, `must be an integer >= ${min}`);
  return v;
};
const tekst = (v: unknown, sti: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw fejl(sti, 'must be a text');
  return v;
};
const beloebAf = (v: unknown, sti: string): Beloeb => { const o = obj(v, sti); return { dkk: heltal(o['dkk'], `${sti}.dkk`, 1), eur: heltal(o['eur'], `${sti}.eur`, 1) }; };
const ordbog = <T,>(v: unknown, sti: string, del: (x: unknown, s: string) => T): Record<string, T> =>
  Object.fromEntries(Object.entries(obj(v, sti)).filter(([k]) => !k.startsWith('_')).map(([k, x]) => [k, del(x, `${sti}.${k}`)]));

export function validerPriser(raa: unknown): Priser {
  const r = obj(raa, '');
  const status = r['status'];
  if (status !== 'udkast' && status !== 'godkendt') throw fejl('status', 'must be "udkast" or "godkendt"');
  const m = obj(r['moms'], 'moms');
  if (typeof m['aktiv'] !== 'boolean') throw fejl('moms.aktiv', 'must be true or false');
  const pr = obj(r['proeve'], 'proeve');
  if (typeof pr['kort'] !== 'boolean') throw fejl('proeve.kort', 'must be true or false');
  const planer = ordbog(r['planer'], 'planer', (x, sti) => {
    const o = obj(x, sti);
    return { navn: tekst(o['navn'], `${sti}.navn`), medlemmer: heltal(o['medlemmer'], `${sti}.medlemmer`, 1), maanedlig: beloebAf(o['maanedlig'], `${sti}.maanedlig`), aarlig: beloebAf(o['aarlig'], `${sti}.aarlig`) };
  });
  if (Object.keys(planer).length === 0) throw fejl('planer', 'needs at least one plan');
  const tilvalg = ordbog(r['tilvalg'], 'tilvalg', (x, sti): Tilvalg => {
    const o = obj(x, sti);
    if (o['status'] !== 'senere' && o['status'] !== 'aktiv') throw fejl(`${sti}.status`, 'must be "senere" or "aktiv"');
    return { navn: tekst(o['navn'], `${sti}.navn`), status: o['status'], fraMaanedlig: beloebAf(o['fraMaanedlig'], `${sti}.fraMaanedlig`) };
  });
  return { status, moms: { aktiv: m['aktiv'] }, proeve: { dage: heltal(pr['dage'], 'proeve.dage', 0), kort: pr['kort'] }, planer, tilvalg };
}

export function laesPriser(sti: string): Priser {
  let raa: unknown;
  try { raa = JSON.parse(readFileSync(sti, 'utf8')); } catch (e) { throw new Error(`cannot read the price file ${sti}: ${e instanceof Error ? e.message : String(e)}`); }
  return validerPriser(raa);
}

export function laesTabel(siteDir: string): Tabel {
  const ctx: { globalThis?: unknown; CLAWCO_TEXT?: Tabel } = {};
  ctx.globalThis = ctx;
  vm.runInNewContext(readFileSync(path.join(siteDir, 'strings.js'), 'utf8'), ctx);
  if (!ctx.CLAWCO_TEXT) throw new Error('strings.js defines no CLAWCO_TEXT');
  return ctx.CLAWCO_TEXT;
}

/** 7900 -> "79 kr", 1060 -> "€10.60" (Danish: "€10,60"). site.js formats the same way when the language changes. */
export function formatBeloeb(minor: number, valuta: Valuta, sprog: Sprog): string {
  const hele = Math.trunc(minor / 100);
  const rest = minor % 100;
  const tusind = sprog === 'da' ? '.' : ',';
  let tal = String(hele).replace(/\B(?=(\d{3})+(?!\d))/g, tusind);
  if (rest) tal += (sprog === 'da' ? ',' : '.') + String(rest).padStart(2, '0');
  return valuta === 'eur' ? `€${tal}` : `${tal} kr`;
}

/** What paying for a year saves against twelve months, per currency, computed from the config and never typed. */
export function besparelse(plan: Plan): Beloeb {
  return { dkk: 12 * plan.maanedlig.dkk - plan.aarlig.dkk, eur: 12 * plan.maanedlig.eur - plan.aarlig.eur };
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** `<tag data-i="key"></tag>`: the English text is filled in afterwards from the table. */
const i = (key: string, tag = 'span', klasse = ''): string => `<${tag}${klasse ? ` class="${klasse}"` : ''} data-i="${key}"></${tag}>`;
const amt = (minor: number, valuta: Valuta, klasse = 'amt'): string =>
  `<span class="${klasse}" data-valuta="${valuta}" data-minor="${minor}">${esc(formatBeloeb(minor, valuta, 'en'))}</span>`;

function kraev(tabel: Tabel, key: string, hvad: string): void {
  if (!(key in tabel.en) || !(key in tabel.da)) throw new Error(`pricing page: no text "${key}" in site/strings.js (${hvad})`);
}

function planKort(id: string, plan: Plan, p: Priser, tabel: Tabel): string {
  kraev(tabel, `pr.plan.${id}.blurb`, `plan ${id} is in config/priser.json but the page has no words for it`);
  const prisblok = (v: Valuta, felt: 'maanedlig' | 'aarlig', per: string): string =>
    `<div class="price" data-cur="${v}">${amt(plan[felt][v], v)} ${i(per)}`
    + (felt === 'aarlig' && besparelse(plan)[v] > 0
      ? `<p class="save small">${i('pr.save')} ${amt(besparelse(plan)[v], v, 'amt sparet')} ${i('pr.save.vs')}</p>` : '')
    + '</div>';
  const intervaller = INTERVALLER.map((n) => `<div class="intv" data-int="${n.id}">${VALUTAER.map((v) => prisblok(v, n.felt, n.per)).join('')}</div>`).join('\n');
  const proeve = p.proeve.dage > 0
    ? `<p class="trial"><span class="num">${p.proeve.dage}</span> ${i(p.proeve.kort ? 'pr.trial.card' : 'pr.trial.nocard')}</p>` : '';
  const cta = INTERVALLER.map((n) =>
    `<a class="btn primary" data-plan-cta data-int="${n.id}" href="${TILMELD}?plan=${encodeURIComponent(id)}&amp;interval=${n.id}" data-i="${p.proeve.dage > 0 ? 'pr.cta.trial' : 'pr.cta.start'}"></a>`).join('\n');
  const medlemmer = plan.medlemmer === 1
    ? `<li data-members="1" data-i="pr.members.one"></li>`
    : `<li data-members="${plan.medlemmer}">${i('pr.members.upto')} <span class="num">${plan.medlemmer}</span> ${i('pr.members.people')}</li>`;
  const ekstra: string[] = [];
  for (let k = 1; `pr.plan.${id}.f${k}` in tabel.en; k++) { kraev(tabel, `pr.plan.${id}.f${k}`, 'feature'); ekstra.push(`<li data-i="pr.plan.${id}.f${k}"></li>`); }
  const faelles = ['pr.sky.f1', 'pr.sky.f2', 'pr.sky.f3', 'pr.sky.f4'].map((k) => `<li data-i="${k}"></li>`);
  return `<section class="card plan" data-plan="${esc(id)}">
<h2 class="plan-name">${esc(plan.navn)}</h2>
<p class="blurb" data-i="pr.plan.${id}.blurb"></p>
${intervaller}
${proeve}
<div class="actions">
${cta}
</div>
<ul class="feat">
${[medlemmer, ...faelles, ...ekstra].join('\n')}
</ul>
</section>`;
}

function hjemmeKort(): string {
  return `<section class="card plan" data-tier="home">
<h2 class="plan-name" data-i="pr.home.name"></h2>
<p class="blurb" data-i="pr.home.blurb"></p>
<p class="pricefree" data-i="pr.home.price"></p>
<div class="actions"><a class="btn" href="/install" data-i="pr.home.cta"></a></div>
<ul class="feat">
${[1, 2, 3, 4].map((k) => `<li data-i="pr.home.f${k}"></li>`).join('\n')}
</ul>
</section>`;
}

function tilvalgRaekke(id: string, t: Tilvalg, tabel: Tabel): string {
  kraev(tabel, `pr.addon.${id}.name`, `add-on ${id}`);
  kraev(tabel, `pr.addon.${id}.text`, `add-on ${id}`);
  const senere = t.status === 'senere';
  return `<div class="addon${senere ? ' senere' : ''}" data-addon="${esc(id)}">
<h3 data-i="pr.addon.${id}.name"></h3>
<p data-i="pr.addon.${id}.text"></p>
<p class="small">${i(senere ? 'pr.addon.later' : 'pr.addon.live', 'strong')} ${i('pr.addon.from')} ${VALUTAER.map((v) => `<span class="price" data-cur="${v}">${amt(t.fraMaanedlig[v], v)} ${i('pr.per.month')}</span>`).join('')}</p>
</div>`;
}

/** Fills every `data-i` element and every `data-i-attr` attribute with the English text of its key. */
function fyld(html: string, tabel: Tabel): string {
  const hent = (k: string): string => { if (!(k in tabel.en) || !(k in tabel.da)) throw new Error(`pricing page: key "${k}" is missing in site/strings.js (English and Danish)`); return esc(tabel.en[k]!); };
  const tekst = html.replace(/(<([a-z0-9]+)\b[^>]*\sdata-i="([^"]+)"[^>]*>)[^<]*(<\/\2>)/g, (_m, aab: string, _t: string, k: string, luk: string) => `${aab}${hent(k)}${luk}`);
  return tekst.replace(/<[a-z0-9]+\b[^>]*\sdata-i-attr="([^"]+)"[^>]*>/g, (tag: string, par: string) => {
    let ud = tag;
    for (const p of par.split(';')) {
      const [attr, k] = p.split(':') as [string, string];
      const v = hent(k);
      const re = new RegExp(`(\\s${attr}=")[^"]*(")`);
      if (!re.test(ud)) throw new Error(`pricing page: <${tag.slice(1, 20)}…> names ${attr} in data-i-attr but has no such attribute`);
      ud = ud.replace(re, (_x, a: string, b: string) => `${a}${v}${b}`);
    }
    return ud;
  });
}

/** The page as one HTML string. Pure: the config, the key table and the template in, the page out. */
export function renderPriser(o: { priser: Priser; tabel: Tabel; skabelon: string }): string {
  const p = o.priser;
  // The "no VAT charged" line is the only VAT wording there is (G6). When KC-0194 turns VAT on, the words are written then.
  if (p.moms.aktiv) throw new Error('pricing page: config/priser.json has VAT on, but the page only has the "no VAT charged" wording (KC-0194)');
  const kort = [hjemmeKort(), ...Object.entries(p.planer).map(([id, pl]) => planKort(id, pl, p, o.tabel))].join('\n');
  const tilvalg = Object.entries(p.tilvalg).map(([id, t]) => tilvalgRaekke(id, t, o.tabel)).join('\n');
  const banner = p.status === 'udkast' ? `<p class="udkast" role="note"><strong data-i="pr.draft"></strong></p>` : '';
  const noindex = p.status === 'udkast' ? '<meta name="robots" content="noindex">' : '';
  const slots: Record<string, string> = { BANNER: banner, NOINDEX: noindex, PLANS: kort, ADDON: tilvalg };
  let html = o.skabelon;
  for (const [navn, v] of Object.entries(slots)) {
    if (!html.includes(`{{${navn}}}`)) throw new Error(`site/priser.template.html has no {{${navn}}} slot`);
    html = html.replace(`{{${navn}}}`, () => v);
  }
  html = fyld(html, o.tabel);
  const rest = html.match(/\{\{[A-Z]+\}\}/);
  if (rest) throw new Error(`site/priser.template.html: unfilled slot ${rest[0]}`);
  return html;
}

/** Gate G5 as code: a draft price may be seen on a preview address, never published. */
export function tjekUdgivelse(p: Priser, maal: Maal): void {
  if (maal === 'live' && p.status !== 'godkendt') {
    throw new PriserNaegtet('refusing to include priser.html in a live build: config/priser.json has status "udkast", so the prices are not decided (KC-0169, gate G5). Build with --preview to look at it.');
  }
}

/** Writes `priser.html` into the build output (and, live, the sitemap entry). The template itself is never copied. */
export function byggPriser(o: { siteDir: string; ud: string; priser: Priser; maal: Maal }): string {
  tjekUdgivelse(o.priser, o.maal);
  const skabelon = path.join(o.siteDir, 'priser.template.html');
  if (!existsSync(skabelon)) throw new Error('site/priser.template.html is missing');
  const html = renderPriser({ priser: o.priser, tabel: laesTabel(o.siteDir), skabelon: readFileSync(skabelon, 'utf8') });
  writeFileSync(path.join(o.ud, 'priser.html'), html);
  if (o.maal === 'live') {
    const sm = path.join(o.ud, 'sitemap.xml');
    writeFileSync(sm, readFileSync(sm, 'utf8').replace('</urlset>', `  <url><loc>${HOST}/priser</loc></url>\n</urlset>`));
  }
  return path.join(o.ud, 'priser.html');
}
