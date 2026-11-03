// KC-0264: the token counts of one model call, read from the provider's answer as its bytes stream past to the tenant.
// The bytes are never changed and never kept: in a stream (Anthropic's SSE; for Bedrock as udbyder.ts re-encodes it) only
// the `message_start` and `message_delta` events are parsed, and only their `usage` numbers leave this file. Content
// events (the answer's text, tool calls, thinking) are skipped unparsed. A non-streamed JSON answer is parsed in memory
// for its `usage` object only. No usage seen (an error, a stream that broke before message_start) = null.
// KC-0273: `komplet()` says whether the answer's final count arrived (a message_delta, or the JSON's usage); without it
// the route bills the reservation (afregning.ts). `tilLejer` is the one rewrite of the bytes the tenant gets: the usage
// numbers in message_start/message_delta (or the JSON's usage) carry no cache split, so a tenant cannot read another
// tenant's prompt out of cache hits; every other byte passes unchanged.
import type { Forbrug } from './priser.ts';

export type ForbrugsLaeser = { laes(stykke: Uint8Array): void; resultat(): Forbrug | null; komplet(): boolean };

/** At most this much of a non-streamed answer is held to find its usage (a 128K-token answer is well under it). */
const JSON_LOFT = 16 * 1024 * 1024;
const TAELLER = /^\{\s*"type"\s*:\s*"(message_start|message_delta)"/;

type Usage = Record<string, unknown>;
const tal = (v: unknown): number | undefined => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined);

export function forbrugsLaeser(indholdstype: string | null): ForbrugsLaeser {
  const sse = /^text\/event-stream\b/i.test(indholdstype ?? '');
  const dekoder = new TextDecoder();
  let rest = '';
  let haendelse = '';
  let data = '';
  let set = false;
  let delta = false;
  let jsonUsage = false;
  const f: Forbrug = { input: 0, output: 0, cacheLaes: 0, cacheSkriv5m: 0, cacheSkriv1t: 0 };

  /** Counts are cumulative in the provider's events: a later number replaces an earlier one. */
  function noter(u: Usage): void {
    const ind = tal(u['input_tokens']);
    const ud = tal(u['output_tokens']);
    const laes = tal(u['cache_read_input_tokens']);
    const skriv = tal(u['cache_creation_input_tokens']);
    const opdelt = typeof u['cache_creation'] === 'object' && u['cache_creation'] !== null ? u['cache_creation'] as Usage : null;
    if (ind !== undefined) f.input = ind;
    if (ud !== undefined) f.output = ud;
    if (laes !== undefined) f.cacheLaes = laes;
    const t1 = opdelt ? tal(opdelt['ephemeral_1h_input_tokens']) : undefined;
    const t5 = opdelt ? tal(opdelt['ephemeral_5m_input_tokens']) : undefined;
    if (t1 !== undefined || t5 !== undefined) {
      f.cacheSkriv1t = t1 ?? 0;
      f.cacheSkriv5m = t5 ?? Math.max(0, (skriv ?? 0) - f.cacheSkriv1t);
    } else if (skriv !== undefined) {
      f.cacheSkriv5m = skriv;
      f.cacheSkriv1t = 0;
    }
  }

  function afslut(): void {
    const navn = haendelse;
    const d = data;
    haendelse = '';
    data = '';
    if (!d || (navn && navn !== 'message_start' && navn !== 'message_delta') || (!navn && !TAELLER.test(d))) return;
    let o: Record<string, unknown>;
    try { o = JSON.parse(d) as Record<string, unknown>; } catch { return; }
    if (o['type'] === 'message_start') {
      const m = o['message'] as Usage | undefined;
      const u = m && typeof m === 'object' ? m['usage'] : undefined;
      if (u && typeof u === 'object') { noter(u as Usage); set = true; }
    } else if (o['type'] === 'message_delta' && set) {
      const u = o['usage'];
      if (u && typeof u === 'object') { noter(u as Usage); delta = true; }
    }
  }

  function linje(l: string): void {
    if (l.endsWith('\r')) l = l.slice(0, -1);
    if (l === '') { afslut(); return; }
    if (l.startsWith('event:')) { haendelse = l.slice(6).trim(); return; }
    if (l.startsWith('data:')) {
      // A content event's data is never held: only the two counting events' data is collected.
      if (haendelse && haendelse !== 'message_start' && haendelse !== 'message_delta') return;
      const v = l.slice(5).replace(/^ /, '');
      data = data ? `${data}\n${v}` : v;
    }
  }

  let json = '';
  let forStor = false;
  return {
    laes(stykke) {
      const t = dekoder.decode(stykke, { stream: true });
      if (!sse) {
        if (!forStor) { json += t; if (json.length > JSON_LOFT) { forStor = true; json = ''; } }
        return;
      }
      const dele = (rest + t).split('\n');
      rest = dele.pop() ?? '';
      for (const l of dele) linje(l);
    },
    resultat() {
      const t = dekoder.decode();
      if (!sse) {
        if (forStor) return null;
        try {
          const o = JSON.parse(json + t) as Record<string, unknown>;
          if (!o || typeof o['usage'] !== 'object' || o['usage'] === null) return null;
          noter(o['usage'] as Usage);
          jsonUsage = true;
          return { ...f };
        } catch { return null; }
      }
      if (rest || t) { linje(rest + t); rest = ''; }
      afslut();
      return set ? { ...f } : null;
    },
    /** After resultat(): true when the final count arrived (SSE: a message_delta with usage; JSON: its usage object). */
    komplet: () => (sse ? delta : jsonUsage),
  };
}

/** The usage the tenant is shown: input_tokens = every prompt token (uncached, read from and written to the cache),
 *  the cache fields 0 when present, output_tokens; nothing else (no cache_creation split, no server_tool_use). */
function lejerUsage(u: Usage): Record<string, number> {
  const n = (k: string): number => tal(u[k]) ?? 0;
  const ud: Record<string, number> = {};
  if ('input_tokens' in u) ud['input_tokens'] = n('input_tokens') + n('cache_read_input_tokens') + n('cache_creation_input_tokens');
  if ('cache_creation_input_tokens' in u) ud['cache_creation_input_tokens'] = 0;
  if ('cache_read_input_tokens' in u) ud['cache_read_input_tokens'] = 0;
  if ('output_tokens' in u) ud['output_tokens'] = n('output_tokens');
  return ud;
}

const TAELLER_DATA = /^data: ?(\{\s*"type"\s*:\s*"(message_start|message_delta)".*)$/;

/** One SSE line as the tenant gets it: a counting event's data line with its usage rewritten, any other line as it was. */
function lejerLinje(l: string): string {
  const cr = l.endsWith('\r');
  const m = TAELLER_DATA.exec(cr ? l.slice(0, -1) : l);
  if (!m) return l;
  let o: Record<string, unknown>;
  try { o = JSON.parse(m[1]!) as Record<string, unknown>; } catch { return l; }
  const boks = o['type'] === 'message_start' ? o['message'] as Usage | undefined : o;
  const u = boks && typeof boks === 'object' ? boks['usage'] : undefined;
  if (!boks || !u || typeof u !== 'object') return l;
  boks['usage'] = lejerUsage(u as Usage);
  return `data: ${JSON.stringify(o)}${cr ? '\r' : ''}`;
}

const TOM = new Uint8Array(0);

/** The provider's bytes as the tenant gets them (see the header). SSE goes out line by line as each line completes; a
 *  non-streamed JSON answer (at most max_tokens, so small) is held to its end, rewritten once, then sent. */
export function tilLejer(indholdstype: string | null): { stykke(b: Uint8Array): Uint8Array; slut(): Uint8Array } {
  const sse = /^text\/event-stream\b/i.test(indholdstype ?? '');
  const dek = new TextDecoder();
  const enk = new TextEncoder();
  if (sse) {
    let rest = '';
    return {
      stykke(b) {
        const t = rest + dek.decode(b, { stream: true });
        const i = t.lastIndexOf('\n');
        if (i < 0) { rest = t; return TOM; }
        rest = t.slice(i + 1);
        return enk.encode(t.slice(0, i + 1).split('\n').map(lejerLinje).join('\n'));
      },
      slut() { const t = rest + dek.decode(); rest = ''; return t ? enk.encode(lejerLinje(t)) : TOM; },
    };
  }
  let json = '';
  let gennem = false;
  return {
    stykke(b) {
      const t = dek.decode(b, { stream: true });
      if (gennem) return enk.encode(t);
      json += t;
      // Past the bound (not reachable under max_tokens ≤ 8192) the rest passes through as it is.
      if (json.length > JSON_LOFT) { gennem = true; const ud = json; json = ''; return enk.encode(ud); }
      return TOM;
    },
    slut() {
      const t = json + dek.decode();
      json = '';
      if (gennem) return t ? enk.encode(t) : TOM;
      try {
        const o = JSON.parse(t) as Record<string, unknown>;
        if (o && typeof o === 'object' && o['usage'] && typeof o['usage'] === 'object') {
          o['usage'] = lejerUsage(o['usage'] as Usage);
          return enk.encode(JSON.stringify(o));
        }
      } catch { /* not JSON: passed on as it came */ }
      return t ? enk.encode(t) : TOM;
    },
  };
}
