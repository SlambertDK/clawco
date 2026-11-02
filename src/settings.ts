// Settings Henrik can change in the UI, persisted in $KC_DATA_DIR/indstillinger.json.
// v1: which model each tier uses (lille = small/fast, taenker = analysis).
// KC-0015: the voice (ElevenLabs voice id) and the synced agent/tool ids.
// KC-0127: the provider chosen in Start's step 2 and the last live test per
// tier; a test counts only for the revision (provider + model) it ran with.

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type Modeller = { lille?: string; taenker?: string };
/** The ids of one synced agent (KC-0241: the English agent's live under `Stemme.en`; the top level is the Danish one). */
export type AgentIds = { agentId?: string; toolIds?: Record<string, string> };
export type Stemme = { voiceId?: string; agentId?: string; toolIds?: Record<string, string>; en?: AgentIds & { voiceId?: string } };
/** One tier's last live test (KC-0127): passed or not, when, how fast, for which revision, and the kind of failure. */
export type ModelTest = { ok: boolean; tid: string; ms: number; rev: string; fejl?: string };
export type ModelTests = Partial<Record<keyof Modeller, ModelTest>>;
/** `soendagstjek` (KC-0145): the Sunday sample; absent = on, false = Henrik said stop. */
export type Settings = { modeller: Modeller; stemme: Stemme; udbyder?: string; modelTest?: ModelTests; soendagstjek?: boolean };

const NAME = /^[A-Za-z0-9._:/-]{1,80}$/;
const UDBYDER = /^[a-z0-9][a-z0-9-]{0,39}$/;
const FEJL = /^[a-z-]{1,20}$/;
const TIERS = ['lille', 'taenker'] as const;

/** The revision a tier's test belongs to: derived from the provider and the tier's model, so changing either reopens it. */
export function modelRevision(udbyder: string | undefined, model: string | undefined): string {
  return createHash('sha256').update(`${udbyder ?? ''}|${model ?? ''}`).digest('hex').slice(0, 12);
}

function cleanTest(v: unknown): ModelTest | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const r = v as Record<string, unknown>;
  if (typeof r['ok'] !== 'boolean' || typeof r['tid'] !== 'string' || r['tid'].length > 40 || Number.isNaN(Date.parse(r['tid']))) return undefined;
  if (typeof r['ms'] !== 'number' || !Number.isFinite(r['ms']) || r['ms'] < 0 || typeof r['rev'] !== 'string' || !/^[0-9a-f]{1,64}$/.test(r['rev'])) return undefined;
  if (r['fejl'] !== undefined && (typeof r['fejl'] !== 'string' || !FEJL.test(r['fejl']))) return undefined;
  return { ok: r['ok'], tid: r['tid'], ms: Math.round(r['ms']), rev: r['rev'], ...(typeof r['fejl'] === 'string' ? { fejl: r['fejl'] } : {}) };
}

function cleanTests(v: unknown): ModelTests | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const out: ModelTests = {};
  for (const k of TIERS) { const t = cleanTest((v as Record<string, unknown>)[k]); if (t) out[k] = t; }
  return Object.keys(out).length ? out : undefined;
}

export function createSettings(dataDir: string) {
  const file = path.join(dataDir, 'indstillinger.json');
  async function read(): Promise<Settings> {
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as Partial<Settings>;
      const m = raw.modeller ?? {};
      const out: Modeller = {};
      if (typeof m.lille === 'string' && NAME.test(m.lille)) out.lille = m.lille;
      if (typeof m.taenker === 'string' && NAME.test(m.taenker)) out.taenker = m.taenker;
      const udbyder = typeof raw.udbyder === 'string' && UDBYDER.test(raw.udbyder) ? raw.udbyder : undefined;
      const modelTest = cleanTests(raw.modelTest);
      return { modeller: out, stemme: cleanStemme(raw.stemme), ...(udbyder ? { udbyder } : {}), ...(modelTest ? { modelTest } : {}), ...(typeof raw.soendagstjek === 'boolean' ? { soendagstjek: raw.soendagstjek } : {}) };
    } catch { return { modeller: {}, stemme: {} }; }
  }
  function cleanAgent(r: Record<string, unknown>): AgentIds {
    const out: AgentIds = {};
    if (typeof r['agentId'] === 'string' && NAME.test(r['agentId'])) out.agentId = r['agentId'];
    if (typeof r['toolIds'] === 'object' && r['toolIds'] !== null) {
      const ids: Record<string, string> = {};
      for (const [k, x] of Object.entries(r['toolIds'] as Record<string, unknown>)) if (typeof x === 'string' && NAME.test(x) && NAME.test(k)) ids[k] = x;
      out.toolIds = ids;
    }
    return out;
  }
  function cleanStemme(v: unknown): Stemme {
    if (typeof v !== 'object' || v === null) return {};
    const r = v as Record<string, unknown>;
    const out: Stemme = {};
    if (typeof r['voiceId'] === 'string' && NAME.test(r['voiceId'])) out.voiceId = r['voiceId'];
    Object.assign(out, cleanAgent(r));
    if (typeof r['en'] === 'object' && r['en'] !== null) {
      const en = r['en'] as Record<string, unknown>;
      // KC-0242: the English voice sits beside the English agent's ids.
      out.en = { ...(typeof en['voiceId'] === 'string' && NAME.test(en['voiceId']) ? { voiceId: en['voiceId'] } : {}), ...cleanAgent(en) };
    }
    return out;
  }
  async function write(s: Settings): Promise<void> {
    await mkdir(dataDir, { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    await writeFile(tmp, JSON.stringify(s, null, 2), 'utf8');
    await rename(tmp, file);
  }
  /** The tiers' models (the Kø panel and Start's step 2); `udbyder` also sets the provider (KC-0127). Tests stay, keyed to their revision. */
  async function setModels(m: Record<string, string>, o: { udbyder?: string } = {}): Promise<Settings> {
    const out: Modeller = {};
    for (const k of TIERS) {
      const v = (m[k] ?? '').trim();
      if (v && NAME.test(v)) out[k] = v;
    }
    const s: Settings = { ...(await read()), modeller: out };
    if (o.udbyder !== undefined && UDBYDER.test(o.udbyder)) s.udbyder = o.udbyder;
    await write(s);
    return s;
  }
  /** KC-0127: sets (or with null clears) a tier's last live test. */
  async function setModelTest(patch: Partial<Record<keyof Modeller, ModelTest | null>>): Promise<Settings> {
    const cur = await read();
    const tests: Record<string, unknown> = { ...cur.modelTest };
    for (const k of TIERS) if (patch[k] !== undefined) tests[k] = patch[k] ?? undefined;
    const modelTest = cleanTests(tests);
    const { modelTest: _gammel, ...rest } = cur;
    const s: Settings = { ...rest, ...(modelTest ? { modelTest } : {}) };
    await write(s);
    return s;
  }
  /** Merges into the stored stemme block (voice chosen by Henrik, ids from the agent sync); a patch's `en` merges into the stored `en`. */
  async function setStemme(patch: Partial<Stemme>): Promise<Settings> {
    const cur = await read();
    const en = patch.en ? { ...cur.stemme.en, ...patch.en } : cur.stemme.en;
    const s: Settings = { ...cur, stemme: cleanStemme({ ...cur.stemme, ...patch, ...(en ? { en } : {}) }) };
    await write(s);
    return s;
  }
  /** KC-0145: the Sunday sample on (true) or off (false). */
  async function setSoendagstjek(til: boolean): Promise<Settings> {
    const s: Settings = { ...(await read()), soendagstjek: til };
    await write(s);
    return s;
  }
  return { read, setModels, setStemme, setModelTest, setSoendagstjek };
}
export type SettingsStore = ReturnType<typeof createSettings>;
