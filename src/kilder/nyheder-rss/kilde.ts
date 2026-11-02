// KC-0137: the user's own news sources (spec §3 step 4). On the card "Nyhedskilder"
// the user pastes one or more feed addresses (a web page is searched for its
// feed) or uploads an OPML export from the old reader; opsaet() checks every
// pasted address by fetching it and stores the list in kilder.json as the hidden
// option `feeds` ({url, navn?, tilfoejet, lokal?}, at most 100). read() fetches
// the feeds (conditional GET; ETag, Last-Modified and the parsed items per feed
// live in <data dir>/nyheder-rss/) and answers exactly what the Nyheder room
// consumes — RaaNyhed[] newest first, capped like MAX_NYHEDER, plus the status
// with the names of the feeds that did not answer. Everything is untrusted: it
// went through parse.ts (plain text, http(s) URLs) and the registry strips it again.
//
// Health: one failing feed is ok with its name in the note; all failing is nede,
// but only for ten minutes — the registry never reads a source that is not
// working, so a source that stayed nede would never recover.

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { KildeFejl, type Felt, type Helbred, type Kilde, type KildeKontekst, type KildeKort, type Nyhed } from '../types.ts';
import { laesKonfig } from '../register.ts';
import { AdresseFejl, normaliserAdresse, tjekAdresse } from './adresse.ts';
import { HentFejl, lavHenter, type Henter } from './hent.ts';
import { erHtml, findFeedLinks, ParseFejl, parseFeed, parseOpml } from './parse.ts';
import { rssTekst } from './tekster.ts';

export const NYHEDER_RSS_ID = 'nyheder-rss';
export const MAKS_FEEDS = 100;
/** The room's cap (MAX_NYHEDER in src/rooms/nyheder/source.ts); test/kilder/nyheder-rss/kilde.test.ts holds them equal through trimNyheder. */
const MAKS_NYHEDER = 80;
const MAKS_PER_FEED = 30;
const MAKS_PASTE = 20;
const MAKS_URL = 400;
const MAKS_OPML = 1_000_000;
const NEDE_LEVETID_MS = 10 * 60_000;
const MAPPE = 'nyheder-rss';

type Feed = { url: string; navn?: string; tilfoejet: string; lokal?: true };
/** KC-0222: a feed on the list as the Kø panel shows it. */
export type FeedVisning = { id: string; navn: string };
/** The connector with the functions that change its list after the connection (KC-0222); the registry writes what they answer (aendreValg). */
export interface NyhederRssKilde extends Kilde {
  feeds(valg: Readonly<Record<string, string>>): FeedVisning[];
  tilfoejFeed(raa: string, ctx: KildeKontekst): Promise<{ tekst: string; valg: Record<string, string>; feed: FeedVisning }>;
  fjernFeed(id: string, ctx: KildeKontekst): Promise<{ tekst: string; valg: Record<string, string>; feed: FeedVisning }>;
}
type Tilstand = { ok?: { tid: number }; fejl?: { tid: number; tekst: string } };
type Gemt = { etag?: string; sidstRettet?: string; titel: string; nyheder: Nyhed[] };

/** The card's fields; their labels are read in the language of the request each time the card is made (KC-0170). */
function felter(): Felt[] {
  const t = rssTekst().felt;
  return [
    { navn: 'adresser', etiket: t.adresser, type: 'tekst', flere: true, paakraevet: false, maks: MAKS_PASTE * (MAKS_URL + 2) },
    { navn: 'opml', etiket: t.opml, type: 'fil', paakraevet: false, maks: MAKS_OPML },
    { navn: 'feeds', etiket: t.feeds, type: 'tekst', skjult: true, paakraevet: false, maks: 60_000 },
  ];
}

const erObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Names are shown in card text: never < or >. */
const vis = (v: string): string => v.replace(/[<>]/g, '');
const antalTekst = (n: number): string => rssTekst().antal(n);

/** "A", "A og B", "A, B og C", "A, B, C og 2 andre". */
function opremsning(navne: string[]): string {
  const t = rssTekst();
  const n = navne.map(vis);
  if (n.length <= 3) return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} ${t.og} ${n.at(-1)}`;
  const rest = n.length - 3;
  return `${n.slice(0, 3).join(', ')} ${t.og} ${rest} ${rest === 1 ? t.anden : t.andre}`;
}

function vaert(url: string): string {
  try { return new URL(url).hostname.slice(0, 80); } catch { return url.slice(0, 80); }
}
const navnFor = (f: Feed): string => f.navn || vaert(f.url);
/** The id of a feed in routes and markup: a hash of its normalised address, so two spellings are one and no address travels in a path. */
export function feedId(url: string): string {
  let n = url;
  try { n = normaliserAdresse(new URL(url)); } catch { /* a stored record that is no address keeps its own text */ }
  return `f-${createHash('sha256').update(n).digest('hex').slice(0, 12)}`;
}
const feedNoegle = (url: string): string => { try { return normaliserAdresse(new URL(url)); } catch { return url; } };

/** The stored list, defensively: whatever kilder.json holds that is not a feed record is left out. */
function laesFeeds(valg: Readonly<Record<string, string>>): Feed[] {
  let raa: unknown;
  try { raa = JSON.parse(valg['feeds'] ?? '[]'); } catch { return []; }
  if (!Array.isArray(raa)) return [];
  const ud: Feed[] = [];
  for (const p of raa) {
    if (!erObj(p) || typeof p['url'] !== 'string' || typeof p['tilfoejet'] !== 'string') continue;
    ud.push({ url: p['url'], ...(typeof p['navn'] === 'string' && p['navn'] ? { navn: p['navn'] } : {}), tilfoejet: p['tilfoejet'], ...(p['lokal'] === true ? { lokal: true as const } : {}) });
  }
  return ud.slice(0, MAKS_FEEDS);
}

function version(): string {
  try { return String((JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version?: unknown }).version ?? '0.1'); } catch { return '0.1'; }
}

/** Splits what was pasted: whitespace, commas and semicolons; and two addresses run together (a browser drops line breaks). */
function adresserFra(tekst: string): string[] {
  return tekst.split(/(?<=\w)(?=https?:\/\/)|[\s,;]+/i).map((x) => x.trim()).filter(Boolean);
}

export function nyhederRss(o: { dataDir?: string; hent?: Henter; version?: string } = {}): NyhederRssKilde {
  const hent = o.hent ?? lavHenter({ agent: `Clawco/${o.version ?? version()}` });
  const tilstand = new Map<string, Tilstand>();
  const hukommelse = new Map<string, Gemt>();
  const cacheMappe = o.dataDir ? path.join(o.dataDir, MAPPE) : null;
  const cacheFil = (url: string): string | null => (cacheMappe ? path.join(cacheMappe, `${createHash('sha256').update(url).digest('hex').slice(0, 32)}.json`) : null);

  async function laesCache(url: string): Promise<Gemt | null> {
    const m = hukommelse.get(url);
    if (m) return m;
    const fil = cacheFil(url);
    if (!fil) return null;
    try {
      const raa = JSON.parse(await readFile(fil, 'utf8')) as unknown;
      if (!erObj(raa) || !Array.isArray(raa['nyheder']) || typeof raa['titel'] !== 'string') return null;
      const g: Gemt = { titel: raa['titel'], nyheder: raa['nyheder'] as Nyhed[], ...(typeof raa['etag'] === 'string' ? { etag: raa['etag'] } : {}), ...(typeof raa['sidstRettet'] === 'string' ? { sidstRettet: raa['sidstRettet'] } : {}) };
      hukommelse.set(url, g);
      return g;
    } catch { return null; }
  }
  async function gemCache(url: string, g: Gemt): Promise<void> {
    hukommelse.set(url, g);
    const fil = cacheFil(url);
    if (!fil || !cacheMappe) return;
    try {
      await mkdir(cacheMappe, { recursive: true });
      const tmp = `${fil}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(tmp, JSON.stringify(g), 'utf8');
      await rename(tmp, fil);
    } catch { /* the cache is an optimisation; the next read fetches in full */ }
  }

  /** A removed feed leaves nothing behind: its cached items, in memory and on disk, and what was remembered of its last answer. */
  async function glemFeed(url: string): Promise<void> {
    hukommelse.delete(url);
    tilstand.delete(url);
    const fil = cacheFil(url);
    if (fil) await rm(fil, { force: true });
  }

  /** One feed, remembering the outcome. Never throws. */
  async function hentFeed(f: Feed, nu: number): Promise<Nyhed[] | null> {
    try {
      const c = await laesCache(f.url);
      const svar = await hent(f.url, { oprindelse: f.lokal ? 'bruger' : 'ekstern', ...(c?.etag ? { etag: c.etag } : {}), ...(c?.sidstRettet ? { sidstRettet: c.sidstRettet } : {}) });
      let nyheder: Nyhed[];
      if (svar.status === 'uaendret') {
        if (!c) throw new HentFejl('net', rssTekst().kildenIkkeLaest);
        nyheder = c.nyheder;
      } else {
        const feed = parseFeed(svar.tekst, { adresse: svar.endeligAdresse, ...(f.navn ? { navn: f.navn } : {}) });
        nyheder = feed.nyheder;
        await gemCache(f.url, { titel: feed.titel, nyheder, ...(svar.etag ? { etag: svar.etag } : {}), ...(svar.sidstRettet ? { sidstRettet: svar.sidstRettet } : {}) });
      }
      tilstand.set(f.url, { ...tilstand.get(f.url), ok: { tid: nu } });
      return nyheder;
    } catch (err) {
      const tekst = err instanceof HentFejl ? err.message : err instanceof ParseFejl ? rssTekst().svarIkkeNyhedskilde : rssTekst().kildenIkkeLaest;
      tilstand.set(f.url, { ...tilstand.get(f.url), fejl: { tid: nu, tekst } });
      return null;
    }
  }

  const fejler = (f: Feed): Tilstand['fejl'] | undefined => {
    const t = tilstand.get(f.url);
    return t?.fejl && (!t.ok || t.fejl.tid >= t.ok.tid) ? t.fejl : undefined;
  };

  /** A pasted address: fetched to prove it is a feed (or to find one), named by its title. */
  async function tilfoej(raa: string, nu: Date): Promise<Feed> {
    let u: URL;
    try { u = tjekAdresse(raa, { oprindelse: 'bruger' }); } catch (err) {
      throw new KildeFejl(400, rssTekst().adresseFejl(vis(raa.slice(0, 80)), err instanceof AdresseFejl ? err.message : rssTekst().adresseIkkeBrugbar));
    }
    if (u.href.length > MAKS_URL) throw new KildeFejl(400, rssTekst().adresseForLang(vis(raa.slice(0, 80))));
    const fejl = (err: unknown): KildeFejl => new KildeFejl(400, rssTekst().ikkeBrugbarSomKilde(vis(u.host), err instanceof HentFejl || err instanceof ParseFejl ? err.message : rssTekst().denKunneIkkeLaeses));
    // Tried as a public address first; only an address the guard refuses as local is retried (and marked) as the user's own.
    let lokal = false;
    let svar;
    try { svar = await hent(u.href, { oprindelse: 'ekstern' }); } catch (err) {
      if (!(err instanceof HentFejl && err.kode === 'afvist')) throw fejl(err);
      try { svar = await hent(u.href, { oprindelse: 'bruger' }); lokal = true; } catch (err2) { throw fejl(err2); }
    }
    if (svar.status !== 'ny') throw fejl(new HentFejl('net', rssTekst().kildenUdenIndhold));
    const gem = async (url: string, tekst: string, adresse: string, v: { etag?: string; sidstRettet?: string }, erLokal: boolean): Promise<Feed> => {
      const f = parseFeed(tekst, { adresse });
      await gemCache(url, { titel: f.titel, nyheder: f.nyheder, ...(v.etag ? { etag: v.etag } : {}), ...(v.sidstRettet ? { sidstRettet: v.sidstRettet } : {}) });
      return { url, navn: f.titel, tilfoejet: nu.toISOString(), ...(erLokal ? { lokal: true as const } : {}) };
    };
    if (!erHtml(svar.tekst)) {
      try { return await gem(u.href, svar.tekst, svar.endeligAdresse, svar, lokal); } catch (err) { throw fejl(err); }
    }
    // A web page: its advertised feeds are content, so they are fetched as public addresses.
    for (const l of findFeedLinks(svar.tekst, svar.endeligAdresse).slice(0, 3)) {
      if (l.length > MAKS_URL) continue;
      try {
        const s = await hent(l, { oprindelse: 'ekstern' });
        if (s.status === 'ny') return await gem(l, s.tekst, s.endeligAdresse, s, false);
      } catch { /* the next link */ }
    }
    throw new KildeFejl(400, rssTekst().ingenKildeFundet(vis(u.host)));
  }

  return {
    id: NYHEDER_RSS_ID, get navn() { return rssTekst().navn; }, slags: 'nyheder', zone: 'privat', auth: 'local', tillid: 'uklar',

    async read(ctx) {
      const feeds = laesFeeds(ctx.valg);
      const nu = ctx.nu.getTime();
      const svar = await Promise.all(feeds.map(async (f) => ({ f, nyheder: await hentFeed(f, nu) })));
      if (feeds.length && svar.every((s) => s.nyheder === null)) throw new KildeFejl(502, rssTekst().ingenSvarede);
      const alle: Nyhed[] = [];
      const set = new Set<string>();
      let medNyheder = 0;
      for (const { nyheder } of svar) {
        if (!nyheder?.length) continue;
        medNyheder += 1;
        const nyeste = [...nyheder].sort((a, b) => (b.udgivet ?? '').localeCompare(a.udgivet ?? '')).slice(0, MAKS_PER_FEED);
        for (const n of nyeste) {
          if (n.url) { if (set.has(n.url)) continue; set.add(n.url); }
          alle.push(n);
        }
      }
      alle.sort((a, b) => (b.udgivet ?? '').localeCompare(a.udgivet ?? ''));
      return {
        slags: 'nyheder', hentet: ctx.nu.toISOString(), uklar: true,
        data: { nyheder: alle.slice(0, MAKS_NYHEDER), status: { antal: feeds.length, medNyheder, nyheder: alle.length, fejlede: svar.filter((s) => s.nyheder === null).map((s) => navnFor(s.f)) } },
      };
    },

    async helbred(ctx): Promise<Helbred> {
      const feeds = laesFeeds(ctx.valg);
      if (!feeds.length) return { status: 'nede', tekst: rssTekst().ingenKilder };
      const fejlede = feeds.filter((f) => fejler(f));
      if (!fejlede.length) return { status: 'ok' };
      if (fejlede.length === feeds.length) {
        const sidst = Math.max(...fejlede.map((f) => fejler(f)?.tid ?? 0));
        if (ctx.nu.getTime() - sidst < NEDE_LEVETID_MS) return { status: 'nede', tekst: rssTekst().ingenSvarer(opremsning(fejlede.map(navnFor))) };
        return { status: 'ok', tekst: rssTekst().proverIgen };
      }
      return { status: 'ok', tekst: rssTekst().svarerIkkeNu(opremsning(fejlede.map(navnFor))) };
    },

    async kort(ctx): Promise<KildeKort> {
      const feeds = laesFeeds(ctx.valg);
      const t = rssTekst();
      if (!feeds.length) return { titel: t.navn, tekst: t.intro, felter: felter(), handling: t.handling.tilfoej };
      const fejlede = feeds.filter((f) => fejler(f));
      const dele = [t.kortListe(antalTekst(feeds.length), opremsning(feeds.map(navnFor)))];
      if (fejlede.length) dele.push(t.svarerIkkeNu(opremsning(fejlede.map(navnFor))));
      dele.push(t.tilfoejFlereTekst);
      return { titel: t.navn, tekst: dele.join(' '), felter: felter(), handling: t.handling.tilfoejFlere };
    },

    async opsaet(ctx: KildeKontekst) {
      let gamle: Feed[] = [];
      if (o.dataDir) {
        const p = (await laesKonfig(o.dataDir)).kilder.find((k) => k.id === NYHEDER_RSS_ID);
        gamle = p ? laesFeeds(p.valg) : [];
      }
      const adresser = adresserFra(ctx.valg['adresser'] ?? '');
      if (adresser.length > MAKS_PASTE) throw new KildeFejl(400, rssTekst().forMangeAdresser(MAKS_PASTE));
      const nye: Feed[] = [];
      for (const a of adresser) nye.push(await tilfoej(a, ctx.nu));
      const fraOpml: Feed[] = [];
      let sprunget = 0;
      const opml = ctx.valg['opml'] ?? '';
      if (opml.trim()) {
        let poster;
        try { poster = parseOpml(opml); } catch { throw new KildeFejl(400, rssTekst().opmlIkkeLaest); }
        for (const p of poster) {
          try { tjekAdresse(p.url, { oprindelse: 'ekstern' }); } catch { sprunget += 1; continue; }
          if (p.url.length > MAKS_URL) { sprunget += 1; continue; }
          fraOpml.push({ url: p.url, ...(p.navn ? { navn: p.navn } : {}), tilfoejet: ctx.nu.toISOString() });
        }
      }
      // What the user typed comes first, then the file, then what was stored: the cap cuts the end of the file, not the user's own.
      const liste: Feed[] = [...gamle];
      const noegler = new Set(gamle.map((f) => normaliserAdresse(new URL(f.url))));
      let tilfoejet = 0; let fandtes = 0; let forMange = 0;
      for (const f of [...nye, ...fraOpml]) {
        const n = normaliserAdresse(new URL(f.url));
        if (noegler.has(n)) { fandtes += 1; continue; }
        if (liste.length >= MAKS_FEEDS) { forMange += 1; continue; }
        noegler.add(n); liste.push(f); tilfoejet += 1;
      }
      if (!liste.length) throw new KildeFejl(400, rssTekst().indsaetAdresseEllerFil);
      const t = rssTekst();
      const dele = [t.tilfoejede(antalTekst(tilfoejet))];
      if (fandtes) dele.push(t.fandtesAllerede(fandtes));
      if (sprunget) dele.push(t.sprangOver(sprunget));
      if (forMange) dele.push(t.forMange(MAKS_FEEDS, forMange));
      dele.push(t.ialt(antalTekst(liste.length)));
      return { tekst: dele.join(' '), valg: { feeds: JSON.stringify(liste) } };
    },

    feeds: (valg) => laesFeeds(valg).map((f) => ({ id: feedId(f.url), navn: vis(navnFor(f)) })),

    /** KC-0222: one more source, checked as the card checks a pasted address (tilfoej()); the list's cap and duplicates are judged here. */
    async tilfoejFeed(raa, ctx) {
      const adresser = adresserFra(raa);
      if (!adresser.length) throw new KildeFejl(400, rssTekst().indsaetAdresse);
      if (adresser.length > 1) throw new KildeFejl(400, rssTekst().enAdresseAdGangen);
      const gamle = laesFeeds(ctx.valg);
      if (gamle.length >= MAKS_FEEDS) throw new KildeFejl(400, rssTekst().hoejstKilder(MAKS_FEEDS));
      const fandtes = (url: string): Feed | undefined => gamle.find((f) => feedNoegle(f.url) === feedNoegle(url));
      const dublet = (f: Feed): KildeFejl => new KildeFejl(409, rssTekst().harDuAllerede(vis(navnFor(f))));
      // The address as typed is compared before anything is fetched, so a repeat costs no request.
      try { const u = tjekAdresse(adresser[0] ?? '', { oprindelse: 'bruger' }); const f = fandtes(u.href); if (f) throw dublet(f); } catch (err) { if (err instanceof KildeFejl) throw err; /* tilfoej() says why the address is refused */ }
      const ny = await tilfoej(adresser[0] ?? '', ctx.nu);
      const f = fandtes(ny.url);
      if (f) throw dublet(f);
      return { tekst: rssTekst().tilfoejedeEn(vis(navnFor(ny)), antalTekst(gamle.length + 1)), valg: { feeds: JSON.stringify([...gamle, ny]) }, feed: { id: feedId(ny.url), navn: vis(navnFor(ny)) } };
    },

    /** KC-0222: one source off the list, by id; its cached items go too. The last one stays: with none the connection has nothing to read (Frakobl is for that). */
    async fjernFeed(id, ctx) {
      const gamle = laesFeeds(ctx.valg);
      const f = gamle.find((x) => feedId(x.url) === id);
      if (!f) throw new KildeFejl(404, rssTekst().kildenFindesIkke);
      if (gamle.length === 1) throw new KildeFejl(409, rssTekst().sidsteKilde);
      await glemFeed(f.url);
      const rest = gamle.filter((x) => x !== f);
      return { tekst: rssTekst().fjernede(vis(navnFor(f)), f.url.slice(0, 200), antalTekst(rest.length)), valg: { feeds: JSON.stringify(rest) }, feed: { id, navn: vis(navnFor(f)) } };
    },

    async frakobl(): Promise<void> {
      tilstand.clear();
      hukommelse.clear();
      if (cacheMappe) await rm(cacheMappe, { recursive: true, force: true });
    },
  };
}
