// KC-0180: an in-process fake model provider for the direct-model agent's
// tests. It answers what the test scripts per request: a status with a body,
// or an SSE stream (Anthropic Messages or OpenAI chat-completions shape) that
// may stay open (for abort and timeout). It records every request it got.

import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Modtaget = { metode: string; sti: string; headers: IncomingHttpHeaders; body: Record<string, unknown> };
export type FalskSvar = { status: number; body?: string } | { stream: string[]; aaben?: boolean };

/** Anthropic Messages stream (platform.claude.com streaming docs, read 2026-10-31): start, text deltas, stop. */
export function anthropicStream(tekster: string[], o: { stop?: boolean } = {}): string[] {
  const ev = (type: string, data: object): string => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  return [
    ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], model: 'm' } }),
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    ev('ping', {}),
    ...tekster.map((t) => ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: t } })),
    ev('content_block_stop', { index: 0 }),
    ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }),
    ...(o.stop === false ? [] : [ev('message_stop', {})]),
  ];
}

/** OpenAI chat-completions stream (developers.openai.com, read 2026-10-31): chunks with choices[].delta.content, then [DONE]. */
export function openaiStream(tekster: string[], o: { done?: boolean } = {}): string[] {
  const chunk = (delta: object, finish: string | null): string => `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  return [
    ': OPENROUTER PROCESSING\n\n',
    chunk({ role: 'assistant', content: '' }, null),
    ...tekster.map((t) => chunk({ content: t }, null)),
    chunk({}, 'stop'),
    ...(o.done === false ? [] : ['data: [DONE]\n\n']),
  ];
}

export async function startFalskUdbyder(svar: (m: Modtaget) => FalskSvar): Promise<{ url: string; modtaget: Modtaget[]; luk(): Promise<void> }> {
  const modtaget: Modtaget[] = [];
  const server = createServer((req, res) => {
    let raa = '';
    req.on('data', (c: Buffer) => { raa += c.toString('utf8'); });
    req.on('end', () => {
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(raa) as Record<string, unknown>; } catch { /* not JSON */ }
      const m: Modtaget = { metode: req.method ?? '', sti: req.url ?? '', headers: req.headers, body };
      modtaget.push(m);
      const s = svar(m);
      if ('status' in s) {
        res.writeHead(s.status, { 'content-type': 'application/json' });
        res.end(s.body ?? '{}');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      for (const del of s.stream) res.write(del);
      if (!s.aaben) res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    modtaget,
    luk: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}
