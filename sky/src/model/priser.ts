// KC-0264: what one model call costs Clawco. config/modelpriser.json in the repo root is the one source (AGENTS §0 r6),
// read by path like config/priser.json. Prices are USD per million tokens, which is micro-USD per token, so a call's
// cost is a sum of tokens × price. Sums are kept in thousandths of a micro-USD (integers) and rounded UP to a whole
// micro-USD once per call, so the ledger never undercounts. Validation is strict and names the JSON path that is wrong.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The token counts of one call, as the provider reports them in `usage`. */
export type Forbrug = { input: number; output: number; cacheLaes: number; cacheSkriv5m: number; cacheSkriv1t: number };
export type Trin = { opTilPromptTokens: number | null; input: number; cacheSkriv5m: number; cacheSkriv1t: number; cacheLaes: number; output: number };
export type ModelPris = { navn: string; trin: Trin[] };
export type Udbyder = { url: string; tillaegProcent: number; region: string | null; modelId: Record<string, string> };
export type Modelpriser = { kilde: string; laest: string; modeller: Record<string, ModelPris>; udbydere: Record<string, Udbyder> };

export const MODELPRISFIL = fileURLToPath(new URL('../../../config/modelpriser.json', import.meta.url));

const ID = /^[a-z0-9]+([.-][a-z0-9]+)*$/;
const PRISFELTER = ['input', 'cacheSkriv5m', 'cacheSkriv1t', 'cacheLaes', 'output'] as const;

const fejl = (sti: string, hvad: string): Error => new Error(`config/modelpriser.json: ${sti} ${hvad}`);

function objekt(v: unknown, sti: string, tilladte: readonly string[] | null, kraevede: readonly string[] = tilladte ?? []): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw fejl(sti || '(roden)', 'skal være et objekt');
  const o = v as Record<string, unknown>;
  if (tilladte) for (const k of Object.keys(o)) if (!k.startsWith('_') && !tilladte.includes(k)) throw fejl(sti ? `${sti}.${k}` : k, 'er ukendt (stavefejl?)');
  for (const k of kraevede) if (!(k in o)) throw fejl(sti ? `${sti}.${k}` : k, 'mangler');
  return o;
}

function tekst(v: unknown, sti: string): string {
  if (typeof v !== 'string' || !v.trim()) throw fejl(sti, 'skal være en tekst');
  return v;
}

function pris(v: unknown, sti: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw fejl(sti, 'skal være et tal ≥ 0 (USD pr. million tokens)');
  // Thousandths of a micro-USD per token must be whole, or the integer sum below would round silently.
  if (Math.abs(v * 1000 - Math.round(v * 1000)) > 1e-9) throw fejl(sti, 'må højst have tre decimaler');
  return v;
}

function ids(v: unknown, sti: string): Record<string, unknown> {
  const o = objekt(v, sti, null);
  for (const k of Object.keys(o)) if (!k.startsWith('_') && !ID.test(k)) throw fejl(`${sti}.${k}`, 'skal være et model-id med små bogstaver, tal, punktum og bindestreg');
  return Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')));
}

export function validerModelpriser(raw: unknown): Modelpriser {
  const r = objekt(raw, '', ['kilde', 'laest', 'modeller', 'udbydere']);
  const laest = tekst(r['laest'], 'laest');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(laest) || Number.isNaN(Date.parse(laest))) throw fejl('laest', 'skal være en dato som 2026-11-03');
  const modeller: Record<string, ModelPris> = {};
  for (const [id, v] of Object.entries(ids(r['modeller'], 'modeller'))) {
    const sti = `modeller.${id}`;
    const m = objekt(v, sti, ['navn', 'trin']);
    if (!Array.isArray(m['trin']) || m['trin'].length === 0) throw fejl(`${sti}.trin`, 'skal være en liste med mindst ét trin');
    const trin = (m['trin'] as unknown[]).map((t, i, alle): Trin => {
      const ts = `${sti}.trin[${i}]`;
      const o = objekt(t, ts, ['opTilPromptTokens', ...PRISFELTER]);
      const op = o['opTilPromptTokens'];
      const sidste = i === alle.length - 1;
      if (sidste && op !== null) throw fejl(`${ts}.opTilPromptTokens`, 'skal være null på det sidste trin (ingen øvre grænse)');
      if (!sidste && (typeof op !== 'number' || !Number.isInteger(op) || op < 1)) throw fejl(`${ts}.opTilPromptTokens`, 'skal være et heltal ≥ 1 (kun det sidste trin er null)');
      const ud = { opTilPromptTokens: op as number | null } as Trin;
      for (const f of PRISFELTER) ud[f] = pris(o[f], `${ts}.${f}`);
      return ud;
    });
    for (let i = 1; i < trin.length - 1; i++) if (trin[i]!.opTilPromptTokens! <= trin[i - 1]!.opTilPromptTokens!) throw fejl(`${sti}.trin[${i}].opTilPromptTokens`, 'skal være større end trinnet før');
    modeller[id] = { navn: tekst(m['navn'], `${sti}.navn`), trin };
  }
  if (Object.keys(modeller).length === 0) throw fejl('modeller', 'skal have mindst én model');
  const udbydere: Record<string, Udbyder> = {};
  for (const [id, v] of Object.entries(ids(r['udbydere'], 'udbydere'))) {
    const sti = `udbydere.${id}`;
    const u = objekt(v, sti, ['url', 'tillaegProcent', 'modelId', 'region'], ['url', 'tillaegProcent', 'modelId']);
    const url = tekst(u['url'], `${sti}.url`);
    let ok = false;
    try { const x = new URL(url.replace('{region}', 'eu-central-1')); ok = x.protocol === 'https:' && !x.search && !x.hash && !x.username; } catch { /* below */ }
    if (!ok) throw fejl(`${sti}.url`, 'skal være en https-adresse uden forespørgsel ({region} må stå i værtsnavnet)');
    const t = u['tillaegProcent'];
    if (typeof t !== 'number' || !Number.isInteger(t) || t < 0 || t > 100) throw fejl(`${sti}.tillaegProcent`, 'skal være et heltal fra 0 til 100');
    const region = u['region'] === undefined ? null : tekst(u['region'], `${sti}.region`);
    if (region !== null && !/^[a-z]{2}(-[a-z]+)+-\d$/.test(region)) throw fejl(`${sti}.region`, 'skal være en AWS-region som eu-central-1');
    const modelId: Record<string, string> = {};
    for (const [m, x] of Object.entries(ids(u['modelId'], `${sti}.modelId`))) {
      if (!modeller[m]) throw fejl(`${sti}.modelId.${m}`, 'er ikke en model under modeller');
      const vx = tekst(x, `${sti}.modelId.${m}`);
      if (!ID.test(vx)) throw fejl(`${sti}.modelId.${m}`, 'skal være udbyderens model-id');
      modelId[m] = vx;
    }
    for (const m of Object.keys(modeller)) if (!modelId[m]) throw fejl(`${sti}.modelId`, `mangler ${m} (hver udbyder skal kunne hver model)`);
    if (url.includes('{region}') && region === null) throw fejl(`${sti}.region`, 'mangler: url indeholder {region}');
    udbydere[id] = { url, tillaegProcent: t, region, modelId };
  }
  if (Object.keys(udbydere).length === 0) throw fejl('udbydere', 'skal have mindst én udbyder');
  return { kilde: tekst(r['kilde'], 'kilde'), laest, modeller, udbydere };
}

export function laesModelpriser(sti: string = MODELPRISFIL): Modelpriser {
  let indhold: string;
  try { indhold = fs.readFileSync(sti, 'utf8'); } catch { throw new Error(`kan ikke læse modelprisfilen ${sti}`); }
  let raw: unknown;
  try { raw = JSON.parse(indhold); } catch (e) { throw new Error(`modelprisfilen ${sti} er ikke gyldig JSON: ${e instanceof Error ? e.message : String(e)}`); }
  return validerModelpriser(raw);
}

/** The provider's own prompt length: every input token, cached or not (Haiku 5.5's tier rule). */
export const promptTokens = (f: Forbrug): number => f.input + f.cacheLaes + f.cacheSkriv5m + f.cacheSkriv1t;

/** One call's cost in whole micro-USD, rounded up. An unknown model or provider throws: never a free call. */
export function prisMikroUsd(p: Modelpriser, model: string, udbyder: string, f: Forbrug): number {
  const m = Object.hasOwn(p.modeller, model) ? p.modeller[model] : undefined;
  if (!m) throw new Error(`ingen pris for modellen ${model.slice(0, 60)}`);
  const u = Object.hasOwn(p.udbydere, udbyder) ? p.udbydere[udbyder] : undefined;
  if (!u) throw new Error(`ukendt udbyder ${udbyder.slice(0, 30)}`);
  const n = promptTokens(f);
  const t = m.trin.find((x) => x.opTilPromptTokens === null || n <= x.opTilPromptTokens)!;
  const tusindedele = PRISFELTER.reduce((s, k) => {
    const tokens = k === 'input' ? f.input : k === 'output' ? f.output : k === 'cacheLaes' ? f.cacheLaes : k === 'cacheSkriv5m' ? f.cacheSkriv5m : f.cacheSkriv1t;
    return s + tokens * Math.round(t[k] * 1000);
  }, 0);
  return Math.ceil((tusindedele * (100 + u.tillaegProcent)) / 100 / 1000);
}
