// KC-0273 (D4): the Messages body Sky forwards, rebuilt from an allowlist. The tenant's object is never passed on as
// it came: an unknown top-level key is refused by name (400), so a new provider feature (MCP servers, containers, a
// priority tier, a server tool that bills per use) is never switched on by a tenant before Sky meters it. What the
// tenant's own Clawco sends (src/agent/direkte.ts: model, max_tokens 8192, system, messages, stream) always passes.
// Kept: model (checked by the route against the plan), messages, system, max_tokens (1..MAKS_TOKENS: the reservation
// in afregning.ts is priced from it), stream, temperature, top_p, stop_sequences, metadata.user_id (the rest of
// metadata is dropped), tools (plain custom tools only: input_schema, never a typed server tool), tool_choice, and
// thinking (disabled, or enabled with budget_tokens ≤ MAKS_TAENKE; thinking counts inside max_tokens).
// `messages` and `system` are checked for shape only: their blocks are the provider's to judge (without a server tool
// in `tools`, a server tool's result block is refused upstream).

export const MAKS_TOKENS = 8192;
export const MAKS_TAENKE = 8192;
/** The `anthropic-beta` values a tenant may send. Empty: no beta feature is metered or needed by the tenant app. */
export const TILLADTE_BETA: readonly string[] = [];

export type ByggetKrop = { krop: Record<string, unknown>; maxTokens: number } | { fejl: string };

const TOP = new Set(['model', 'messages', 'system', 'max_tokens', 'stream', 'temperature', 'top_p', 'stop_sequences', 'metadata', 'tools', 'tool_choice', 'thinking']);
const VAERKTOEJ = new Set(['name', 'description', 'input_schema', 'cache_control', 'type']);

const objekt = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const tal = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
const heltal = (v: unknown, min: number, maks: number): boolean => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= maks;
const navn = (k: string): string => JSON.stringify(k.slice(0, 60));

function vaerktoejer(v: unknown): string | null {
  if (!Array.isArray(v)) return 'tools skal være en liste.';
  for (const t of v) {
    if (!objekt(t)) return 'Hvert værktøj i tools skal være et objekt.';
    if (t['type'] !== undefined && t['type'] !== 'custom') return `Værktøjet ${navn(String(t['type']))} er ikke tilladt: kun egne værktøjer med input_schema.`;
    for (const k of Object.keys(t)) if (!VAERKTOEJ.has(k)) return `Feltet ${navn(k)} i et værktøj er ikke tilladt.`;
    if (typeof t['name'] !== 'string' || !objekt(t['input_schema'])) return 'Et værktøj skal have name og input_schema (kun egne værktøjer er tilladt).';
  }
  return null;
}

function taenkning(v: unknown): string | null {
  if (!objekt(v)) return 'thinking skal være et objekt.';
  if (v['type'] === 'disabled' && Object.keys(v).length === 1) return null;
  if (v['type'] !== 'enabled' || Object.keys(v).some((k) => k !== 'type' && k !== 'budget_tokens')) return 'thinking må kun være {type: "enabled", budget_tokens} eller {type: "disabled"}.';
  if (!heltal(v['budget_tokens'], 1, MAKS_TAENKE)) return `thinking.budget_tokens skal være et heltal fra 1 til ${MAKS_TAENKE}.`;
  return null;
}

/** The body to forward, or a short Danish reason (the route answers 400 invalid_request_error with it). */
export function bygKrop(raa: Record<string, unknown>): ByggetKrop {
  for (const k of Object.keys(raa)) if (!TOP.has(k)) return { fejl: `Feltet ${navn(k)} er ikke tilladt.` };
  const r = raa;
  if (!heltal(r['max_tokens'], 1, MAKS_TOKENS)) return { fejl: `max_tokens skal være et heltal fra 1 til ${MAKS_TOKENS}.` };
  if (!Array.isArray(r['messages']) || r['messages'].length === 0) return { fejl: 'messages skal være en liste med mindst én besked.' };
  if (r['system'] !== undefined && typeof r['system'] !== 'string' && !Array.isArray(r['system'])) return { fejl: 'system skal være en tekst eller en liste.' };
  if (r['stream'] !== undefined && typeof r['stream'] !== 'boolean') return { fejl: 'stream skal være true eller false.' };
  for (const k of ['temperature', 'top_p']) if (r[k] !== undefined && !tal(r[k])) return { fejl: `${k} skal være et tal.` };
  if (r['stop_sequences'] !== undefined && (!Array.isArray(r['stop_sequences']) || r['stop_sequences'].some((s) => typeof s !== 'string'))) return { fejl: 'stop_sequences skal være en liste af tekster.' };
  if (r['metadata'] !== undefined && !objekt(r['metadata'])) return { fejl: 'metadata skal være et objekt.' };
  if (r['tool_choice'] !== undefined && !objekt(r['tool_choice'])) return { fejl: 'tool_choice skal være et objekt.' };
  if (r['tools'] !== undefined) { const f = vaerktoejer(r['tools']); if (f) return { fejl: f }; }
  if (r['thinking'] !== undefined) { const f = taenkning(r['thinking']); if (f) return { fejl: f }; }

  const krop: Record<string, unknown> = {};
  for (const k of TOP) {
    if (r[k] === undefined) continue;
    if (k === 'metadata') {
      const m = r[k] as Record<string, unknown>;
      if (typeof m['user_id'] === 'string') krop[k] = { user_id: m['user_id'] };
      continue;
    }
    krop[k] = r[k];
  }
  return { krop, maxTokens: r['max_tokens'] as number };
}

/** The `anthropic-beta` header against TILLADTE_BETA: null = fine (absent, or every value listed), else the reason. */
export function tjekBeta(v: string | undefined): string | null {
  if (v === undefined || v.trim() === '') return null;
  for (const x of v.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!TILLADTE_BETA.includes(x)) return `anthropic-beta ${navn(x)} er ikke tilladt.`;
  }
  return null;
}
