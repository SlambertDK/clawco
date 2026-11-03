// KC-0264: the token counts of one model call, read from the provider's answer as its bytes stream past to the tenant.
// The bytes are never changed and never kept: in a stream (Anthropic's SSE; for Bedrock as udbyder.ts re-encodes it) only
// the `message_start` and `message_delta` events are parsed, and only their `usage` numbers leave this file. Content
// events (the answer's text, tool calls, thinking) are skipped unparsed. A non-streamed JSON answer is parsed in memory
// for its `usage` object only. No usage seen (an error, a stream that broke before message_start) = null.
import type { Forbrug } from './priser.ts';

export type ForbrugsLaeser = { laes(stykke: Uint8Array): void; resultat(): Forbrug | null };

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
      if (u && typeof u === 'object') noter(u as Usage);
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
          return { ...f };
        } catch { return null; }
      }
      if (rest || t) { linje(rest + t); rest = ''; }
      afslut();
      return set ? { ...f } : null;
    },
  };
}
