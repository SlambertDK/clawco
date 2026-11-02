// The legal pages of clawco.work (KC-0204). Reads docs/legal/*.md (frontmatter: version, dato, status, sprog),
// renders the markdown subset those texts use into static pages in the site's layout, and refuses to build when
// a published text still has a placeholder or the word UDKAST. Pure of the network; run by scripts/site-byg.mjs.
// The texts themselves are never changed here: the file is the truth and every page carries the file's sha-256.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export type Sprog = 'da' | 'en';
export type Status = 'udkast' | 'laest' | 'udgivet';
export type Meta = { version: string; dato: string; status: Status; sprog: Sprog };

/** The six documents: `fil` is the file stem in docs/legal, `sti` the public path on the site. */
export const DOKUMENTER = [
  { id: 'vilkaar', fil: 'vilkaar', sti: 'vilkaar' },
  { id: 'privatliv', fil: 'privatlivspolitik', sti: 'privatliv' },
  { id: 'databehandler', fil: 'databehandleraftale', sti: 'databehandler' },
  { id: 'cookies', fil: 'cookies', sti: 'cookies' },
  { id: 'underdatabehandlere', fil: 'underdatabehandlere', sti: 'underdatabehandlere' },
  { id: 'sletning-og-eksport', fil: 'sletning-og-eksport', sti: 'sletning-og-eksport' },
] as const;
export type DokId = (typeof DOKUMENTER)[number]['id'];

export type Dokument = {
  id: DokId; fil: string; sti: string; sprog: Sprog; meta: Meta;
  /** The path of the source relative to the repo root, as written in the page's source meta. */
  kilde: string; sha: string; raa: string; titel: string; body: string;
  tidligere: Dokument[];
};

const HOST = 'https://clawco.work';
const FELTER = ['version', 'dato', 'status', 'sprog'] as const;

export function parseDokument(tekst: string): { meta: Meta; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(tekst.replace(/\r\n/g, '\n'));
  if (!m) throw new Error('missing frontmatter (--- … ---) with version, dato, status, sprog');
  const rå: Record<string, string> = {};
  for (const linje of m[1]!.split('\n')) {
    const k = /^([^:\s]+):\s*(.*)$/.exec(linje);
    if (!k) throw new Error(`frontmatter: cannot read the line "${linje}"`);
    if (!(FELTER as readonly string[]).includes(k[1]!)) throw new Error(`frontmatter: unknown field ${k[1]}`);
    rå[k[1]!] = k[2]!.trim();
  }
  if (!rå['version'] || !/^\d+(\.\d+){1,2}(-udkast)?$/.test(rå['version'])) throw new Error('frontmatter: version must look like 1.0 (or 0.1-udkast for a draft)');
  if (!rå['dato'] || !/^\d{4}-\d{2}-\d{2}$/.test(rå['dato'])) throw new Error('frontmatter: dato must be YYYY-MM-DD');
  if (rå['status'] !== 'udkast' && rå['status'] !== 'laest' && rå['status'] !== 'udgivet') throw new Error('frontmatter: status must be udkast, laest or udgivet');
  if (rå['sprog'] !== 'da' && rå['sprog'] !== 'en') throw new Error('frontmatter: sprog must be da or en');
  if (rå['status'] === 'udgivet' && rå['version'].endsWith('-udkast')) throw new Error('frontmatter: a published text needs a real version, not a -udkast one');
  return { meta: { version: rå['version'], dato: rå['dato'], status: rå['status'], sprog: rå['sprog'] }, body: tekst.replace(/\r\n/g, '\n').slice(m[0].length) };
}

/** A published text may not carry the entity placeholders or the word UDKAST (KC-0204; the entity gate is KC-0210). */
export function tjekUdgivelse(status: Status, raa: string): string[] {
  if (status !== 'udgivet') return [];
  const fejl: string[] = [];
  if (raa.includes('[Selskab]')) fejl.push('contains the placeholder [Selskab]');
  if (raa.includes('[CVR]')) fejl.push('contains the placeholder [CVR]');
  if (/UDKAST/.test(raa)) fejl.push('still contains the word UDKAST');
  return fejl;
}

// --- the markdown subset ---------------------------------------------------------------------------------------

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const emph = (s: string): string => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/(?<![*\w])\*(?!\s)([^*]+?)(?<!\s)\*(?![*\w])/g, '<em>$1</em>');

function inline(s: string): string {
  let ud = '';
  let sidst = 0;
  for (const m of s.matchAll(/`([^`]+)`|\[([^\]]+)\]\(([^)\s]*)\)/g)) {
    ud += emph(s.slice(sidst, m.index));
    if (m[1] !== undefined) ud += `<code>${esc(m[1])}</code>`;
    else {
      const url = m[3]!;
      if (!/^(https?:\/\/|mailto:|\/(?!\/)|#)/.test(url)) throw new Error(`markdown: link to ${url} is not allowed (https, mailto, a local path or #)`);
      ud += `<a href="${esc(url)}">${emph(m[2]!)}</a>`;
    }
    sidst = m.index + m[0].length;
  }
  return ud + emph(s.slice(sidst));
}

const BLOK = /^(#{1,4} |[-] |\d+\. |>|\||---+\s*$)/;
const celler = (l: string): string[] => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function renderMarkdown(md: string): string {
  const linjer = md.replace(/\r\n/g, '\n').split('\n');
  const ud: string[] = [];
  let i = 0;
  while (i < linjer.length) {
    const l = linjer[i]!;
    if (!l.trim()) { i++; continue; }
    if (/^\s*```/.test(l)) throw new Error('markdown: a code fence is not supported');
    if (/!\[[^\]]*\]\(/.test(l)) throw new Error('markdown: an image is not supported');
    let m: RegExpExecArray | null;
    if ((m = /^(#{1,4}) +(.+?)\s*$/.exec(l))) { ud.push(`<h${m[1]!.length}>${inline(m[2]!)}</h${m[1]!.length}>`); i++; continue; }
    if (/^---+\s*$/.test(l)) { ud.push('<hr>'); i++; continue; }
    if (l.startsWith('>')) {
      const afsnit: string[][] = [[]];
      while (i < linjer.length && linjer[i]!.startsWith('>')) {
        const t = linjer[i]!.replace(/^> ?/, '');
        if (!t.trim()) afsnit.push([]); else afsnit[afsnit.length - 1]!.push(t);
        i++;
      }
      ud.push(`<blockquote>\n${afsnit.filter((a) => a.length).map((a) => `<p>${inline(a.join(' '))}</p>`).join('\n')}\n</blockquote>`);
      continue;
    }
    if (l.startsWith('|')) {
      const rk: string[] = [];
      while (i < linjer.length && linjer[i]!.startsWith('|')) rk.push(linjer[i++]!);
      if (rk.length < 2 || !/^\|[\s:|-]+\|\s*$/.test(rk[1]!)) throw new Error('markdown: a table needs a header row and a |---| row');
      const hoved = celler(rk[0]!);
      const rækker = rk.slice(2).map((r) => {
        const c = celler(r);
        if (c.length !== hoved.length) throw new Error(`markdown: a table row has ${c.length} cells, the header ${hoved.length}`);
        return `<tr>${c.map((x) => `<td>${inline(x)}</td>`).join('')}</tr>`;
      });
      ud.push(`<div class="tabel"><table>\n<thead><tr>${hoved.map((x) => `<th>${inline(x)}</th>`).join('')}</tr></thead>\n<tbody>${rækker.join('\n')}</tbody>\n</table></div>`);
      continue;
    }
    const liste = /^- /.test(l) ? 'ul' : /^\d+\. /.test(l) ? 'ol' : null;
    if (liste) {
      const mærke = liste === 'ul' ? /^- / : /^\d+\. /;
      const punkter: string[] = [];
      while (i < linjer.length && linjer[i]!.trim()) {
        const x = linjer[i]!;
        if (mærke.test(x)) punkter.push(x.replace(mærke, ''));
        else if (/^\s+([-] |\d+\. )/.test(x)) throw new Error(`markdown: a nested list is not supported ("${x.trim().slice(0, 30)}")`);
        else if (/^\s+\S/.test(x) && punkter.length) punkter[punkter.length - 1] += ` ${x.trim()}`;
        else break;
        i++;
      }
      ud.push(`<${liste}>\n${punkter.map((p) => `<li>${inline(p)}</li>`).join('\n')}\n</${liste}>`);
      continue;
    }
    const afsnit: string[] = [];
    while (i < linjer.length && linjer[i]!.trim() && (afsnit.length === 0 || !BLOK.test(linjer[i]!))) afsnit.push(linjer[i++]!.trim());
    ud.push(`<p>${inline(afsnit.join(' '))}</p>`);
  }
  return ud.join('\n');
}

// --- reading the documents ------------------------------------------------------------------------------------

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const TOP_BLOKKE = /^> *UDKAST \/ DRAFT[^\n]*\n(> *[^\n]*\n)*/;
const VERSIONSLINJE = /^Version \S+ · \d{4}-\d{2}-\d{2} *$/m;

/** The text shown on the page: the file without its own draft notice and "Version …" line, which the banner and
 *  the header replace. The publish rule runs on the raw file, so a published text must have dropped them. */
function visning(body: string): { titel: string; html: string } {
  let b = body.replace(/^\s+/, '').replace(TOP_BLOKKE, '').replace(VERSIONSLINJE, '').replace(/^\s+/, '');
  const h = /^# +(.+?) *$/m.exec(b);
  if (!h) throw new Error('the text has no # heading');
  b = b.replace(h[0], '');
  if (/^# /m.test(b)) throw new Error('the text has more than one # heading');
  return { titel: h[1]!.trim(), html: renderMarkdown(b) };
}

function laes(dir: string, rel: string, d: (typeof DOKUMENTER)[number], sprog: Sprog, kilde: string): Dokument {
  const fil = path.join(dir, rel);
  if (!existsSync(fil)) throw new Error(`missing ${path.basename(fil)} in ${dir}`);
  const buf = readFileSync(fil);
  const raa = buf.toString('utf8');
  let p: { meta: Meta; body: string };
  try { p = parseDokument(raa); } catch (e) { throw new Error(`${rel}: ${(e as Error).message}`); }
  if (p.meta.sprog !== sprog) throw new Error(`${rel}: sprog is ${p.meta.sprog}, the file name says ${sprog}`);
  let titel: string;
  try { titel = visning(p.body).titel; } catch (e) { throw new Error(`${rel}: ${(e as Error).message}`); }
  return { id: d.id, fil: d.fil, sti: d.sti, sprog, meta: p.meta, kilde, sha: sha(buf), raa, titel, body: p.body, tidligere: [] };
}

const nyereEnd = (a: string, b: string): number => {
  const x = a.split('.').map(Number); const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return 0;
};

/** All twelve current documents, each with its archived earlier versions (docs/legal/arkiv/<fil>.<sprog>.<version>.md). */
export function laesDokumenter(dir: string): Dokument[] {
  const ud: Dokument[] = [];
  const arkiv = path.join(dir, 'arkiv');
  const arkivFiler = existsSync(arkiv) ? readdirSync(arkiv) : [];
  for (const d of DOKUMENTER) {
    const par: Dokument[] = [];
    for (const sprog of ['da', 'en'] as const) {
      const dok = laes(dir, `${d.fil}.${sprog}.md`, d, sprog, `docs/legal/${d.fil}.${sprog}.md`);
      for (const f of arkivFiler) {
        const m = new RegExp(`^${d.fil}\\.${sprog}\\.(\\d+(?:\\.\\d+)+)\\.md$`).exec(f);
        if (!m) continue;
        const gammel = laes(dir, `arkiv/${f}`, d, sprog, `docs/legal/arkiv/${f}`);
        if (gammel.meta.version !== m[1]) throw new Error(`arkiv/${f}: the file name says ${m[1]}, the frontmatter ${gammel.meta.version}`);
        if (gammel.meta.version === dok.meta.version) throw new Error(`arkiv/${f}: version ${gammel.meta.version} is the current version of ${d.id}; the archive holds earlier ones only`);
        dok.tidligere.push(gammel);
      }
      dok.tidligere.sort((a, b) => nyereEnd(a.meta.version, b.meta.version));
      par.push(dok);
    }
    for (const felt of ['version', 'dato', 'status'] as const) {
      if (par[0]!.meta[felt] !== par[1]!.meta[felt]) throw new Error(`${d.id}: the Danish and the English text differ in ${felt} (${par[0]!.meta[felt]} vs ${par[1]!.meta[felt]})`);
    }
    ud.push(...par);
  }
  return ud;
}

// --- the pages ------------------------------------------------------------------------------------------------

const T = {
  da: {
    udkast: 'UDKAST, ikke juridisk gennemgået', udkastTekst: 'Teksten er endnu ikke udgivet og er ikke juridisk rådgivning.',
    laest: 'Læst, endnu ikke udgivet', laestTekst: 'Teksten er læst, men venter på en juridisk gennemgang og udgivelse.',
    version: 'Version', status: { udkast: 'Udkast', laest: 'Læst', udgivet: 'Udgivet' }, tidligere: 'Tidligere versioner', ingen: 'Ingen tidligere versioner endnu.',
    erstattet: (v: string) => `Denne version er erstattet af version ${v}.`, gaelder: 'Se den gældende version', andetSprog: 'English', andetSprogLabel: 'Switch language to English',
    indexH1: 'Juridiske dokumenter', indexIntro: 'Vilkår, privatliv, databehandleraftale, cookies, underdatabehandlere og sletning og eksport for Clawco Sky. Hver tekst har et versionsnummer og en dato.',
    indexDesc: 'De juridiske tekster for Clawco Sky, hver med versionsnummer, dato og status: vilkår, privatliv, databehandleraftale, cookies, underdatabehandlere, sletning og eksport.',
    beskrivelse: { udkast: 'Udkast, endnu ikke udgivet eller juridisk gennemgået.', laest: 'Læst, venter på juridisk gennemgang.', udgivet: 'Gældende tekst for Clawco Sky.' },
    dato: 'dato', legalNav: 'Juridisk', legalHref: '/juridisk', q: '?lang=da', nav: 'Hovedmenu', foot: 'Sidefod',
  },
  en: {
    udkast: 'DRAFT, not legally reviewed', udkastTekst: 'This text has not been published yet and is not legal advice.',
    laest: 'Read, not yet published', laestTekst: 'This text has been read but is waiting for legal review and publication.',
    version: 'Version', status: { udkast: 'Draft', laest: 'Read', udgivet: 'Published' }, tidligere: 'Earlier versions', ingen: 'No earlier versions yet.',
    erstattet: (v: string) => `This version has been replaced by version ${v}.`, gaelder: 'See the current version', andetSprog: 'Dansk', andetSprogLabel: 'Skift sprog til dansk',
    indexH1: 'Legal documents', indexIntro: 'Terms, privacy, data processing agreement, cookies, subprocessors, and deletion and export for Clawco Sky. Every text has a version number and a date.',
    indexDesc: 'The legal texts for Clawco Sky, each with version number, date and status: terms, privacy, data processing agreement, cookies, subprocessors, deletion and export.',
    beskrivelse: { udkast: 'Draft, not yet published or legally reviewed.', laest: 'Read, waiting for legal review.', udgivet: 'The current text for Clawco Sky.' },
    dato: 'date', legalNav: 'Legal', legalHref: '/legal', q: '', nav: 'Main', foot: 'Footer',
  },
} as const;

type Chrome = { skip: string; install: string; docs: string; security: string; promise: string };
function laesChrome(siteDir: string): Record<Sprog, Chrome> {
  const ctx: { globalThis?: unknown; CLAWCO_TEXT?: Record<Sprog, Record<string, string>> } = {};
  ctx.globalThis = ctx;
  vm.runInNewContext(readFileSync(path.join(siteDir, 'strings.js'), 'utf8'), ctx);
  const t = ctx.CLAWCO_TEXT;
  if (!t) throw new Error('strings.js defines no CLAWCO_TEXT');
  const hent = (s: Sprog): Chrome => ({ skip: t[s]['c.skip']!, install: t[s]['c.nav.install']!, docs: t[s]['c.nav.docs']!, security: t[s]['c.nav.security']!, promise: t[s]['c.foot.promise']! });
  return { da: hent('da'), en: hent('en') };
}

const offentlig = (sprog: Sprog, sti: string): string => `/${sprog === 'en' ? 'en/' : ''}${sti}`;
const filFor = (sprog: Sprog, sti: string): string => `${sprog === 'en' ? 'en/' : ''}${sti}.html`;

type Side = {
  sprog: Sprog; titel: string; beskrivelse: string; sti: string; alt: string; noindex: boolean; kilde: string | null; krop: string;
};

function sideHtml(c: Record<Sprog, Chrome>, s: Side): string {
  const t = T[s.sprog];
  const ch = c[s.sprog];
  const q = t.q;
  const andet: Sprog = s.sprog === 'da' ? 'en' : 'da';
  const kanon = `${HOST}${s.sti}`;
  return `<!doctype html>
<html lang="${s.sprog}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(s.titel)} | Clawco</title>
<meta name="description" content="${esc(s.beskrivelse)}">
<link rel="canonical" href="${esc(kanon)}">
<link rel="alternate" hreflang="${s.sprog}" href="${esc(kanon)}">
<link rel="alternate" hreflang="${andet}" href="${esc(HOST + s.alt)}">
${s.noindex ? '<meta name="robots" content="noindex">\n' : ''}${s.kilde ? `<meta name="clawco-kilde" content="${esc(s.kilde)}">\n` : ''}<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#121614">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/site.css">
</head>
<body>
<a class="skip" href="#main">${esc(ch.skip)}</a>
<header class="top">
<div class="wrap bar">
<a class="brand" href="/${q}"><span class="dot" aria-hidden="true"></span>Clawco</a>
<nav aria-label="${t.nav}">
<a href="/install${q}">${esc(ch.install)}</a>
<a href="/docs/${q}">${esc(ch.docs)}</a>
<a class="hide-sm" href="/docs/security${q}">${esc(ch.security)}</a>
</nav>
<a class="lang" href="${esc(s.alt)}" hreflang="${andet}" lang="${andet}" aria-label="${t.andetSprogLabel}">${t.andetSprog}</a>
</div>
</header>
<main id="main">
<article class="page">
<div class="wrap narrow">
${s.krop}
</div>
</article>
</main>
<footer class="foot">
<div class="wrap">
<nav aria-label="${t.foot}">
<a href="/install${q}">${esc(ch.install)}</a>
<a href="/docs/${q}">${esc(ch.docs)}</a>
<a href="/docs/security${q}">${esc(ch.security)}</a>
<a href="${t.legalHref}">${t.legalNav}</a>
</nav>
<p class="muted">${esc(ch.promise)}</p>
</div>
</footer>
</body>
</html>
`;
}

function banner(sprog: Sprog, status: Status): string {
  const t = T[sprog];
  if (status === 'udkast') return `<div class="udkast" role="note"><strong>${t.udkast}</strong> <span>${t.udkastTekst}</span></div>`;
  if (status === 'laest') return `<div class="udkast laest" role="note"><strong>${t.laest}</strong> <span>${t.laestTekst}</span></div>`;
  return '';
}

const metaLinje = (sprog: Sprog, m: Meta): string => `<p class="dokmeta muted small">${T[sprog].version} ${esc(m.version)} · ${esc(m.dato)} · ${T[sprog].status[m.status]}</p>`;

function dokumentSide(c: Record<Sprog, Chrome>, d: Dokument, arkiv: { gaeldende: Dokument } | null): { rel: string; html: string } {
  const t = T[d.sprog];
  const v = visning(d.body);
  const aktuel = arkiv ? arkiv.gaeldende : d;
  const sti = arkiv ? `${d.sti}/v${d.meta.version}` : d.sti;
  const tid = !arkiv
    ? `<section class="tidligere"><h2>${t.tidligere}</h2>\n${d.tidligere.length
      ? `<ul>\n${d.tidligere.map((g) => `<li><a href="${offentlig(d.sprog, `${d.sti}/v${g.meta.version}`)}">${t.version} ${esc(g.meta.version)}</a> <span class="muted">· ${esc(g.meta.dato)}</span></li>`).join('\n')}\n</ul>`
      : `<p class="muted">${t.ingen}</p>`}</section>`
    : '';
  const erstattet = arkiv ? `<p class="erstattet">${t.erstattet(aktuel.meta.version)} <a href="${offentlig(d.sprog, d.sti)}">${t.gaelder}</a>.</p>` : '';
  const krop = [banner(d.sprog, d.meta.status), erstattet, `<h1>${esc(v.titel)}</h1>`, metaLinje(d.sprog, d.meta), v.html, tid].filter(Boolean).join('\n');
  const beskr = `${v.titel}. ${t.version} ${d.meta.version}, ${d.meta.dato}. ${t.beskrivelse[d.meta.status]}`;
  const html = sideHtml(c, {
    sprog: d.sprog, titel: v.titel, beskrivelse: beskr, sti: offentlig(d.sprog, sti), alt: offentlig(d.sprog === 'da' ? 'en' : 'da', sti),
    noindex: d.meta.status !== 'udgivet' || !!arkiv, kilde: `${d.kilde} sha256:${d.sha}`, krop,
  });
  return { rel: filFor(d.sprog, sti), html };
}

function indexSide(c: Record<Sprog, Chrome>, sprog: Sprog, alle: Dokument[]): { rel: string; html: string; noindex: boolean } {
  const t = T[sprog];
  const dok = alle.filter((d) => d.sprog === sprog);
  const noindex = !dok.some((d) => d.meta.status === 'udgivet');
  const liste = dok.map((d) => `<li><a href="${offentlig(sprog, d.sti)}"><span class="t">${esc(d.titel)}</span><span class="muted small">${t.version} ${esc(d.meta.version)} · ${esc(d.meta.dato)} · ${t.status[d.meta.status]}</span></a></li>`).join('\n');
  const krop = `<h1>${t.indexH1}</h1>\n<p class="intro">${t.indexIntro}</p>\n<ul class="doclist">\n${liste}\n</ul>`;
  const sti = sprog === 'da' ? '/juridisk' : '/legal';
  const alt = sprog === 'da' ? '/legal' : '/juridisk';
  return { rel: sprog === 'da' ? 'juridisk.html' : 'legal.html', noindex, html: sideHtml(c, { sprog, titel: t.indexH1, beskrivelse: t.indexDesc, sti, alt, noindex, kilde: null, krop }) };
}

/** Writes the legal pages into `ud` and adds the published ones to its sitemap.xml. Everything is checked and
 *  rendered before the first file is written, so a failing text leaves the output untouched. Returns the paths. */
export function byggJuridisk(o: { docsDir: string; ud: string; siteDir: string }): string[] {
  const alle = laesDokumenter(o.docsDir);
  const fejl: string[] = [];
  for (const d of [...alle, ...alle.flatMap((x) => x.tidligere)]) for (const f of tjekUdgivelse(d.meta.status, d.raa)) fejl.push(`${d.kilde}: ${f}`);
  if (fejl.length) throw new Error(`a text with status udgivet is not ready:\n  ${fejl.join('\n  ')}`);
  const c = laesChrome(o.siteDir);
  const sider: { rel: string; html: string }[] = [];
  const sitemap: string[] = [];
  for (const d of alle) {
    sider.push(dokumentSide(c, d, null));
    for (const g of d.tidligere) sider.push(dokumentSide(c, g, { gaeldende: d }));
    if (d.meta.status === 'udgivet') sitemap.push(`${HOST}${offentlig(d.sprog, d.sti)}`);
  }
  for (const sprog of ['da', 'en'] as const) {
    const i = indexSide(c, sprog, alle);
    sider.push(i);
    if (!i.noindex) sitemap.push(`${HOST}${sprog === 'da' ? '/juridisk' : '/legal'}`);
  }
  for (const s of sider) {
    const fil = path.join(o.ud, s.rel);
    mkdirSync(path.dirname(fil), { recursive: true });
    writeFileSync(fil, s.html);
  }
  if (sitemap.length) {
    const sm = path.join(o.ud, 'sitemap.xml');
    const tekst = readFileSync(sm, 'utf8');
    writeFileSync(sm, tekst.replace('</urlset>', `${sitemap.map((u) => `  <url><loc>${u}</loc></url>\n`).join('')}</urlset>`));
  }
  // The hash check: each page names the sha-256 of the file it was made from; read both again now.
  for (const d of [...alle, ...alle.flatMap((x) => x.tidligere)]) {
    const nu = sha(readFileSync(path.join(o.docsDir, d.kilde.replace(/^docs\/legal\//, ''))));
    const side = readFileSync(path.join(o.ud, filFor(d.sprog, d.kilde.includes('/arkiv/') ? `${d.sti}/v${d.meta.version}` : d.sti)), 'utf8');
    if (nu !== d.sha || !side.includes(`sha256:${nu}`)) throw new Error(`${d.kilde} changed while the site was built, or the page does not match it`);
  }
  return sider.map((s) => s.rel);
}
