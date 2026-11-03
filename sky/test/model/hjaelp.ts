// KC-0264: shared test data for the model proxy: a provider's Messages stream, and the sentinel that must never reach the ledger.
export const SENTINEL = 'SENTINEL-HEMMELIG-PROMPT-7f3a';

/** A Messages stream as the provider sends it (Anthropic's SSE shape; Bedrock's after udbyder.ts re-encodes it). */
export function sseSvar(o: { input?: number; output?: number; cacheLaes?: number; cacheSkriv?: number; cache1t?: number; tekst?: string } = {}): string {
  const usage = { input_tokens: o.input ?? 25, cache_creation_input_tokens: (o.cacheSkriv ?? 0) + (o.cache1t ?? 0), cache_read_input_tokens: o.cacheLaes ?? 0,
    cache_creation: { ephemeral_5m_input_tokens: o.cacheSkriv ?? 0, ephemeral_1h_input_tokens: o.cache1t ?? 0 }, output_tokens: 1 };
  const ev = (navn: string, data: unknown) => `event: ${navn}\ndata: ${JSON.stringify(data)}\n\n`;
  return [
    ev('message_start', { type: 'message_start', message: { id: 'msg_01', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], stop_reason: null, usage } }),
    ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    ev('ping', { type: 'ping' }),
    ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: o.tekst ?? `Svar med ${SENTINEL}` } }),
    ev('content_block_stop', { type: 'content_block_stop', index: 0 }),
    ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: o.output ?? 15 } }),
    ev('message_stop', { type: 'message_stop' }),
  ].join('');
}


/** KC-0273: the same stream as the tenant gets it from the proxy: message_start's usage without the cache split
 *  (input_tokens = every prompt token, the cache fields 0); every other byte as the provider sent it. */
export function sseSvarTilLejer(o: Parameters<typeof sseSvar>[0] = {}): string {
  const u = JSON.parse(/"usage":(\{"input_tokens".*?\}\}?,"output_tokens":1\})/.exec(sseSvar(o))![1]!) as Record<string, number>;
  const lejer = { input_tokens: u['input_tokens']! + u['cache_read_input_tokens']! + u['cache_creation_input_tokens']!, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 };
  return sseSvar(o).replace(JSON.stringify(u), JSON.stringify(lejer));
}
