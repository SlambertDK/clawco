// KC-0137: what a fetched feed becomes. RSS 2.0, RSS 1.0 and Atom turn into the
// `Nyhed` shape the Nyheder room reads; OPML into a flat list of feed
// addresses; an HTML page into the feed links it advertises. Everything that
// comes out is plain text with a length cap (renTekst) or an http(s) URL
// (renUrl) — fetched content never reaches a model or HTML in any other form
// (invariant, AGENTS §0 r2/r7). `fast-xml-parser` does the XML; documents that
// declare entities are refused before it sees them (a feed never needs them,
// and that is what billion-laughs documents are made of).

import { XMLParser } from 'fast-xml-parser';
import { rssTekst } from './tekster.ts';
import type { Nyhed } from '../types.ts';
import { normaliserAdresse } from './adresse.ts';

export class ParseFejl extends Error {
  constructor(besked: string) { super(besked); this.name = 'ParseFejl'; }
}

const MAKS_TITEL = 200;
const MAKS_RESUME = 300;
const MAKS_KILDE = 80;
const MAKS_PER_FEED = 100;
const MAKS_OPML = 1000;
const MAKS_DYBDE = 12;
const MAKS_LINKS = 10;

// ---------- cleaning ----------

const NAVNGIVNE: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', aelig: 'æ', oslash: 'ø', aring: 'å', AElig: 'Æ', Oslash: 'Ø', Aring: 'Å', eacute: 'é', euro: '€' };

function afkod(t: string): string {
  return t.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,9});/gi, (m, e: string) => {
    if (e[0] === '#') {
      const kode = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return kode > 0 && kode <= 0x10ffff && !(kode >= 0xd800 && kode <= 0xdfff) ? String.fromCodePoint(kode) : ' ';
    }
    return NAVNGIVNE[e] ?? m;
  });
}

// C0/C1 control characters and the Unicode line/paragraph separators.
// eslint-disable-next-line no-control-regex
const STYREKODER = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f\\u2028\\u2029]', 'g');

/** Tags with their content (script, style, comments, CDATA wrappers) and then every other tag. */
function fjernMarkup(t: string): string {
  return t
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<(script|style|iframe|object|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(script|style|iframe|object|template)\b[\s\S]*$/gi, ' ')
    .replace(/<\/?[a-z!?][^>]*>/gi, ' ');
}

/**
 * Plain text, at most `max` characters: markup, scripts and styles removed, entities decoded, markup removed
 * once more (double-escaped HTML decodes into tags), control characters dropped, whitespace collapsed.
 */
export function renTekst(tekst: string, max: number): string {
  let t = fjernMarkup(tekst);
  t = fjernMarkup(afkod(t));
  t = t.replace(STYREKODER, '').replace(/\s+/g, ' ').trim();
  return t.slice(0, max).trim();
}

/** An http(s) URL without credentials as its normalised text (≤ 2000), else undefined. */
export function renUrl(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t || t.length > 2000) return undefined;
  let u: URL;
  try { u = new URL(t); } catch { return undefined; }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return undefined;
  return u.href.length <= 2000 ? u.href : undefined;
}

// ---------- XML ----------

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: { enabled: true, maxEntityCount: 0, maxEntitySize: 0, maxTotalExpansions: 1000, maxExpandedLength: 200_000 },
  isArray: (navn) => navn === 'item' || navn === 'entry' || navn === 'link' || navn === 'outline',
});

const erObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const egen = (o: Record<string, unknown>, n: string): unknown => (Object.hasOwn(o, n) ? o[n] : undefined);

function laesXml(xml: string): Record<string, unknown> {
  if (typeof xml !== 'string' || !xml.trim()) throw new ParseFejl(rssTekst().svarTomt);
  if (/<!ENTITY/i.test(xml)) throw new ParseFejl(rssTekst().xmlEntiteter);
  let rod: unknown;
  try { rod = parser.parse(xml, true); } catch { throw new ParseFejl(rssTekst().ikkeGyldigXml); }
  if (!erObj(rod)) throw new ParseFejl(rssTekst().ikkeGyldigXml);
  return rod;
}

/** The text of an element, whether it came as a string or with attributes ({ '#text': … }). */
function txt(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return txt(v[0]);
  if (erObj(v)) return txt(egen(v, '#text'));
  return '';
}
const liste = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);

function dato(v: unknown): string | undefined {
  const t = txt(v).trim();
  if (!t) return undefined;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** An Atom item's page: the alternate link, else the first without a rel. RSS: the link text, else a permalink guid. */
function itemUrl(it: Record<string, unknown>): string | undefined {
  let url: string | undefined;
  for (const l of liste(egen(it, 'link'))) {
    if (erObj(l)) {
      const rel = txt(egen(l, '@_rel')) || 'alternate';
      if (rel === 'alternate' && !url) url = renUrl(txt(egen(l, '@_href')));
    } else if (!url) url = renUrl(txt(l));
  }
  if (!url) {
    const g = egen(it, 'guid');
    if (!erObj(g) || txt(egen(g, '@_isPermaLink')) !== 'false') url = renUrl(txt(g));
  }
  return url;
}

function tilNyhed(it: unknown, kilde: string): Nyhed | null {
  if (!erObj(it)) return null;
  const titel = renTekst(txt(egen(it, 'title')), MAKS_TITEL);
  if (!titel) return null;
  const n: Nyhed = { titel, kilde };
  const url = itemUrl(it); if (url) n.url = url;
  const resume = renTekst(txt(egen(it, 'description')) || txt(egen(it, 'summary')) || txt(egen(it, 'content:encoded')) || txt(egen(it, 'content')), MAKS_RESUME);
  if (resume) n.resume = resume;
  const udgivet = dato(egen(it, 'pubDate')) ?? dato(egen(it, 'dc:date')) ?? dato(egen(it, 'updated')) ?? dato(egen(it, 'published'));
  if (udgivet) n.udgivet = udgivet;
  return n;
}

/**
 * A feed (RSS 2.0, RSS 1.0 or Atom) as the feed's title and its items (≤ 100, in feed order). `o.navn`, the name
 * the user gave the source, wins over the feed's own title as the items' `kilde`; the address host is the last resort.
 */
export function parseFeed(xml: string, o: { navn?: string; adresse: string }): { titel: string; nyheder: Nyhed[] } {
  const rod = laesXml(xml);
  let kanal: Record<string, unknown> | undefined;
  let poster: unknown[] = [];
  const rss = egen(rod, 'rss');
  const atom = egen(rod, 'feed');
  const rdf = egen(rod, 'rdf:RDF') ?? egen(rod, 'RDF');
  if (erObj(rss) && erObj(egen(rss, 'channel'))) { kanal = egen(rss, 'channel') as Record<string, unknown>; poster = liste(egen(kanal, 'item')); }
  else if (erObj(atom)) { kanal = atom; poster = liste(egen(atom, 'entry')); }
  else if (erObj(rdf)) { kanal = erObj(egen(rdf, 'channel')) ? (egen(rdf, 'channel') as Record<string, unknown>) : {}; poster = liste(egen(rdf, 'item')); }
  else throw new ParseFejl(rssTekst().ikkeEnKilde);
  const titel = renTekst(txt(egen(kanal, 'title')), MAKS_KILDE);
  let vaert = '';
  try { vaert = new URL(o.adresse).hostname; } catch { /* no host: the title or a placeholder below */ }
  const kilde = renTekst(o.navn ?? '', MAKS_KILDE) || titel || vaert.slice(0, MAKS_KILDE) || rssTekst().ukendtKilde;
  const nyheder: Nyhed[] = [];
  for (const p of poster) {
    const n = tilNyhed(p, kilde);
    if (n) nyheder.push(n);
    if (nyheder.length >= MAKS_PER_FEED) break;
  }
  return { titel: titel || kilde, nyheder };
}

/** An OPML export as feed addresses: folders ignored (flattened), duplicates merged, only http(s) addresses. */
export function parseOpml(xml: string): { url: string; navn?: string }[] {
  const rod = laesXml(xml);
  const opml = egen(rod, 'opml');
  if (!erObj(opml)) throw new ParseFejl(rssTekst().ikkeOpml);
  const ud: { url: string; navn?: string }[] = [];
  const set = new Set<string>();
  const gaa = (noder: unknown[], dybde: number): void => {
    for (const n of noder) {
      if (!erObj(n) || ud.length >= MAKS_OPML) continue;
      const adr = renUrl(txt(egen(n, '@_xmlUrl')));
      if (adr) {
        const noegle = normaliserAdresse(new URL(adr));
        if (!set.has(noegle)) {
          set.add(noegle);
          const navn = renTekst(txt(egen(n, '@_text')) || txt(egen(n, '@_title')), MAKS_KILDE);
          ud.push(navn ? { url: adr, navn } : { url: adr });
        }
      }
      if (dybde < MAKS_DYBDE) gaa(liste(egen(n, 'outline')), dybde + 1);
    }
  };
  const krop = egen(opml, 'body');
  if (erObj(krop)) gaa(liste(egen(krop, 'outline')), 0);
  return ud;
}

// ---------- HTML ----------

/** Whether a response is a web page rather than a feed. */
export function erHtml(tekst: string): boolean {
  const hoved = tekst.slice(0, 1500).trimStart().toLowerCase();
  if (/^<\?xml/.test(hoved) || /<(rss|feed|rdf:rdf|opml)[\s>]/.test(hoved)) return false;
  return hoved.startsWith('<!doctype html') || /<html[\s>]/.test(hoved);
}

const MIME_FEED = /^application\/(rss|atom)\+xml$/i;

/** The feed addresses a page advertises with <link rel="alternate" type="application/rss+xml">, resolved against `base`. */
export function findFeedLinks(html: string, base: string): string[] {
  const ud: string[] = [];
  for (const m of html.matchAll(/<link\b([^>]*)>/gi)) {
    const attr = new Map<string, string>();
    for (const a of (m[1] ?? '').matchAll(/([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) attr.set((a[1] ?? '').toLowerCase(), afkod(a[2] ?? a[3] ?? a[4] ?? ''));
    const rel = (attr.get('rel') ?? '').toLowerCase().split(/\s+/);
    if (!rel.includes('alternate') || !MIME_FEED.test((attr.get('type') ?? '').trim())) continue;
    let adr: string | undefined;
    try { adr = renUrl(new URL(attr.get('href') ?? '', base).href); } catch { adr = undefined; }
    if (adr && !ud.includes(adr)) ud.push(adr);
    if (ud.length >= MAKS_LINKS) break;
  }
  return ud;
}
