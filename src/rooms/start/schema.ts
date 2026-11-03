// KC-0126: the Start room's state (spec §3): one status per step of the
// journey, when the journey was found Done (latched, so Start does not flap
// back when Nu happens to be empty), dismissed suggestions, and the cached
// suggestions (so connected mail is not read on every page). The profile
// itself lives in the store (src/store/profil.ts); its names are re-exported
// here so the room has one place to import its shapes from.

import type { Forhaandsvisning } from './forhaandsvisning.ts';

export { HUSSTAND, lavProfilLager, NAVN_MAKS, ProfilFejl, SPROG, validerProfil, type Profil, type ProfilLager } from '../../store/profil.ts';

export const TRIN_STATUS = ['ikke-startet', 'i-gang', 'klaret', 'sprunget-over'] as const;
export type TrinStatus = (typeof TRIN_STATUS)[number];

/** A source worth adding now (KC-0126 "returns when worth it"): which connector, and why in one Danish sentence. */
export type Forslag = { kildeId: string; navn: string; slags: string; grund: string };

export type StartState = {
  /** When Start first saw this install (ISO). */
  startet: string;
  trin: Record<string, { status: TrinStatus; tid?: string }>;
  /** When the journey was found Done (spec §3); absent = not yet. */
  faerdig?: string;
  /** Dismissed suggestions: connector id → when (ISO). They stay away for 30 days. */
  afvist: Record<string, string>;
  /** The suggestions last worked out, and when. */
  forslag?: { tid: string; liste: Forslag[] };
  /** KC-0127: step 2 — what became of the key for this provider (its length, or the command to run by hand), a local address, the discovered model names. Never the key. */
  model?: StartModel;
  /** KC-0128: each source's first value (preview and timing), by connector id. */
  kilder?: Record<string, KildeVaerdi>;
  /** KC-0128: sources skipped in step 4 (connector id → when); they leave the pile. */
  sprunget?: Record<string, string>;
  /** KC-0130: the first Ret / Ikke relevant heard after Start began (the step Klaret is derived from this); only the first is kept. */
  ret?: StartRet;
  /** KC-0130: what became of the rule proposal under the explanation card (one proposal per install's first Ret). */
  regel?: StartRegel;
  /** KC-0129: step 5 — the import's pile of proposals on offer, and the imports saved (what makes the step Klaret). */
  import?: StartImport;
};

/** The first Ret / Ikke relevant: which kind, when, the element's title, its card id when known, Henrik's own words (shortened). */
export type StartRet = { art: 'ret' | 'ikke-relevant'; tid: string; titel: string; kortId?: string; tekst?: string };
export type StartRegel = { forslag: string; svar: 'ja' | 'nej'; tid: string; regelId?: string };

// ---------- KC-0129: step 5 (import) ----------

export const IMPORT_MAPPER = ['familie', 'venner', 'arbejde', 'andre'] as const;
export type ImportMappe = (typeof IMPORT_MAPPER)[number];
export type ImportDiff = { felt: string; nu: string; ny: string };
/** One line of the pile. `findes`: the name is in the register already — shown with the diff, never written (no silent merge). */
export type ImportForslag = {
  id: string;
  art: 'person' | 'profil';
  status: 'nyt' | 'findes';
  navn: string;
  relation?: string;
  mappe?: ImportMappe;
  zone?: 'privat' | 'arbejde';
  org?: string;
  foedselsdag?: string;
  /** A person's body text, or the profile text. */
  tekst?: string;
  diff?: ImportDiff[];
};
/** `slags` = what the notes' `kilde` says without the prefix (`chatgpt`, `kontakter`, `noter`, `flere`); `uaendret` = how many were already there, identical. */
export type ImportBunke = { tid: string; slags: string; forslag: ImportForslag[]; uaendret: number };
/** A saved import: the log line that carries its Fortryd, when, from what, how many files. */
export type ImportGemt = { logId: string; tid: string; slags: string; antal: number };
export type StartImport = { bunke?: ImportBunke; gemt?: ImportGemt[] };

/** KC-0263: `github` = the login name "Sign in with GitHub" read once (shown; nothing else of GitHub is kept). */
export type StartModel = { udbyder: string; noegle?: { laengde: number; tid: string }; kommando?: string; url?: string; navne?: string[]; github?: { login: string } };

const MODEL_NAVN = /^[A-Za-z0-9._:/-]{1,80}$/;
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

function parseModel(v: unknown): StartModel | undefined {
  if (!erObj(v) || typeof v['udbyder'] !== 'string' || !/^[a-z0-9-]{1,40}$/.test(v['udbyder'])) return undefined;
  const n = v['noegle'];
  const noegle = erObj(n) && typeof n['laengde'] === 'number' && Number.isInteger(n['laengde']) && n['laengde'] >= 0 && erIso(n['tid']) ? { laengde: n['laengde'], tid: n['tid'] } : undefined;
  const navne = Array.isArray(v['navne']) ? v['navne'].filter((x): x is string => typeof x === 'string' && MODEL_NAVN.test(x)).slice(0, 200) : undefined;
  const g = v['github'];
  const login = erObj(g) && typeof g['login'] === 'string' && GITHUB_LOGIN.test(g['login']) ? g['login'] : undefined;
  return {
    udbyder: v['udbyder'], ...(noegle ? { noegle } : {}),
    ...(typeof v['kommando'] === 'string' && v['kommando'].length <= 400 ? { kommando: v['kommando'] } : {}),
    ...(typeof v['url'] === 'string' && v['url'].length <= 200 ? { url: v['url'] } : {}),
    ...(navne ? { navne } : {}),
    ...(login ? { github: { login } } : {}),
  };
}

const erObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const erIso = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
const str = (v: unknown, maks: number): string => (typeof v === 'string' ? v.slice(0, maks) : '');

/** The stored state, cleaned; null when there is none (or it has no start time). */
export function parseStartState(raw: unknown): StartState | null {
  if (!erObj(raw) || !erIso(raw['startet'])) return null;
  const trin: StartState['trin'] = {};
  for (const [id, v] of Object.entries(erObj(raw['trin']) ? raw['trin'] : {})) {
    if (!erObj(v) || !(TRIN_STATUS as readonly unknown[]).includes(v['status'])) continue;
    trin[id.slice(0, 40)] = { status: v['status'] as TrinStatus, ...(erIso(v['tid']) ? { tid: v['tid'] } : {}) };
  }
  const afvist: Record<string, string> = {};
  for (const [id, tid] of Object.entries(erObj(raw['afvist']) ? raw['afvist'] : {})) if (erIso(tid)) afvist[id.slice(0, 40)] = tid;
  const f = raw['forslag'];
  const forslag = erObj(f) && erIso(f['tid']) && Array.isArray(f['liste'])
    ? { tid: f['tid'], liste: f['liste'].filter(erObj).map((x) => ({ kildeId: str(x['kildeId'], 40), navn: str(x['navn'], 80), slags: str(x['slags'], 20), grund: str(x['grund'], 300) })).filter((x) => x.kildeId && x.grund) }
    : undefined;
  const model = parseModel(raw['model']);
  const ret = parseRet(raw['ret']);
  const regel = parseRegel(raw['regel']);
  const imp = parseImport(raw['import']);
  return { startet: raw['startet'], trin, afvist, ...(erIso(raw['faerdig']) ? { faerdig: raw['faerdig'] } : {}), ...(forslag ? { forslag } : {}), ...(model ? { model } : {}), ...parseKildeFelter(raw), ...(ret ? { ret } : {}), ...(regel ? { regel } : {}), ...(imp ? { import: imp } : {}) };
}

// ---------- KC-0129: step 5 (import) ----------

const FORSLAG_ID = /^p\d{1,4}$/;
const SLAGS = /^[a-z0-9-]{1,30}$/;
const LOG_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,119}$/;

function parseDiff(v: unknown): ImportDiff[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const ud = v.filter(erObj).map((x) => ({ felt: str(x['felt'], 40), nu: str(x['nu'], 600), ny: str(x['ny'], 600) })).filter((x) => x.felt).slice(0, 10);
  return ud.length ? ud : undefined;
}

function parseForslag(v: unknown): ImportForslag | null {
  if (!erObj(v) || typeof v['id'] !== 'string' || !FORSLAG_ID.test(v['id']) || (v['art'] !== 'person' && v['art'] !== 'profil') || (v['status'] !== 'nyt' && v['status'] !== 'findes')) return null;
  const navn = str(v['navn'], 120);
  if (!navn) return null;
  const mappe = (IMPORT_MAPPER as readonly unknown[]).includes(v['mappe']) ? (v['mappe'] as ImportMappe) : undefined;
  const diff = parseDiff(v['diff']);
  return {
    id: v['id'], art: v['art'], status: v['status'], navn,
    ...(str(v['relation'], 80) ? { relation: str(v['relation'], 80) } : {}), ...(mappe ? { mappe } : {}),
    ...(v['zone'] === 'privat' || v['zone'] === 'arbejde' ? { zone: v['zone'] } : {}),
    ...(str(v['org'], 200) ? { org: str(v['org'], 200) } : {}), ...(str(v['foedselsdag'], 40) ? { foedselsdag: str(v['foedselsdag'], 40) } : {}),
    ...(str(v['tekst'], 20_000) ? { tekst: str(v['tekst'], 20_000) } : {}), ...(diff ? { diff } : {}),
  };
}

function parseImport(v: unknown): StartImport | undefined {
  if (!erObj(v)) return undefined;
  const b = v['bunke'];
  const bunke = erObj(b) && erIso(b['tid']) && typeof b['slags'] === 'string' && SLAGS.test(b['slags']) && Array.isArray(b['forslag'])
    ? { tid: b['tid'], slags: b['slags'], forslag: b['forslag'].map(parseForslag).filter((x): x is ImportForslag => x !== null).slice(0, 500), uaendret: typeof b['uaendret'] === 'number' && b['uaendret'] >= 0 ? Math.min(Math.round(b['uaendret']), 100_000) : 0 }
    : undefined;
  const gemt = Array.isArray(v['gemt'])
    ? v['gemt'].filter(erObj).filter((g) => typeof g['logId'] === 'string' && LOG_ID.test(g['logId']) && erIso(g['tid']) && typeof g['slags'] === 'string' && SLAGS.test(g['slags']) && typeof g['antal'] === 'number' && g['antal'] >= 0)
      .map((g): ImportGemt => ({ logId: g['logId'] as string, tid: g['tid'] as string, slags: g['slags'] as string, antal: Math.round(g['antal'] as number) }))
    : [];
  const ud: StartImport = { ...(bunke && bunke.forslag.length ? { bunke } : {}), ...(gemt.length ? { gemt } : {}) };
  return ud.bunke || ud.gemt ? ud : undefined;
}

// ---------- KC-0130: step 6 (first Ret) ----------

const RET_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,119}$/;

function parseRet(v: unknown): StartRet | undefined {
  if (!erObj(v) || (v['art'] !== 'ret' && v['art'] !== 'ikke-relevant') || !erIso(v['tid'])) return undefined;
  return {
    art: v['art'], tid: v['tid'], titel: str(v['titel'], 200),
    ...(typeof v['kortId'] === 'string' && RET_ID.test(v['kortId']) ? { kortId: v['kortId'] } : {}),
    ...(typeof v['tekst'] === 'string' && v['tekst'] ? { tekst: v['tekst'].slice(0, 300) } : {}),
  };
}

function parseRegel(v: unknown): StartRegel | undefined {
  if (!erObj(v) || typeof v['forslag'] !== 'string' || !/^[0-9a-f]{12}$/.test(v['forslag']) || (v['svar'] !== 'ja' && v['svar'] !== 'nej') || !erIso(v['tid'])) return undefined;
  return { forslag: v['forslag'], svar: v['svar'], tid: v['tid'], ...(typeof v['regelId'] === 'string' && /^R-\d{4,}$/.test(v['regelId']) ? { regelId: v['regelId'] } : {}) };
}

// ---------- KC-0128: steps 3–4 (first and further sources) ----------

/** A source's first value: how long from connect confirmed to the preview stored, when, and the preview itself. */
export type KildeVaerdi = {
  /** Milliseconds from the connection being recorded to the first element being ready to render (spec §3 budget: 120 s). */
  foersteVaerdiMs: number;
  /** When the preview was stored (ISO). */
  tid: string;
  forhaandsvisning: Forhaandsvisning;
  /** The room whose finished rebuild replaces the preview (calendar → dagen, mail → mail); absent = Kuratoren. */
  rum?: string;
  /** When the curated view replaced the preview (ISO); absent = still shown. */
  erstattet?: string;
};

const KILDE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const erZone = (v: unknown): v is 'privat' | 'arbejde' | 'husstand' => v === 'privat' || v === 'arbejde' || v === 'husstand';

function parseVaerdi(v: unknown): KildeVaerdi | null {
  if (!erObj(v) || typeof v['foersteVaerdiMs'] !== 'number' || !Number.isFinite(v['foersteVaerdiMs']) || v['foersteVaerdiMs'] < 0 || !erIso(v['tid'])) return null;
  const f = v['forhaandsvisning'];
  if (!erObj(f) || typeof f['kildeId'] !== 'string' || !KILDE_ID.test(f['kildeId'])) return null;
  const forhaandsvisning: Forhaandsvisning = {
    kildeId: f['kildeId'], navn: str(f['navn'], 80), slags: str(f['slags'], 20), titel: str(f['titel'], 200), linje: str(f['linje'], 300), hentet: str(f['hentet'], 40),
    ...(erZone(f['zone']) ? { zone: f['zone'] } : {}), ...(typeof f['ejer'] === 'string' ? { ejer: f['ejer'].slice(0, 80) } : {}),
  };
  return {
    foersteVaerdiMs: Math.round(v['foersteVaerdiMs']), tid: v['tid'], forhaandsvisning,
    ...(typeof v['rum'] === 'string' && KILDE_ID.test(v['rum']) ? { rum: v['rum'] } : {}), ...(erIso(v['erstattet']) ? { erstattet: v['erstattet'] } : {}),
  };
}

/** The KC-0128 fields of a stored state, cleaned: first values per source id, and skipped sources (id → when). */
export function parseKildeFelter(raw: Record<string, unknown>): Pick<StartState, 'kilder' | 'sprunget'> {
  const kilder: Record<string, KildeVaerdi> = {};
  for (const [id, v] of Object.entries(erObj(raw['kilder']) ? raw['kilder'] : {})) { const p = parseVaerdi(v); if (KILDE_ID.test(id) && p) kilder[id] = p; }
  const sprunget: Record<string, string> = {};
  for (const [id, tid] of Object.entries(erObj(raw['sprunget']) ? raw['sprunget'] : {})) if (KILDE_ID.test(id) && erIso(tid)) sprunget[id] = tid;
  return { ...(Object.keys(kilder).length ? { kilder } : {}), ...(Object.keys(sprunget).length ? { sprunget } : {}) };
}
