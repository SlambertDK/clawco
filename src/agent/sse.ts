// Minimal Server-Sent Events parser: feed it raw text chunks (which may be
// split anywhere), get back the complete `data:` payloads as they finish.

/** KC-0275 (B7): what a stream may hold unfinished (a partial line plus the data lines of an event not yet closed). */
export const SSE_MAKS_BYTES = 4 * 1024 * 1024;

/** The stream grew past its buffer maximum without finishing an event: the caller treats it as a failed stream. */
export class SseForStor extends Error {
  constructor() { super('sse buffer over the maximum'); this.name = 'SseForStor'; }
}

export function parseSseChunks(o: { maxBytes?: number } = {}): { push(chunk: string): string[] } {
  const maks = o.maxBytes ?? SSE_MAKS_BYTES;
  let buffer = '';
  let dataLines: string[] = [];
  let dataBytes = 0;

  return {
    push(chunk: string): string[] {
      buffer += chunk;
      const out: string[] = [];
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line === '') {
          if (dataLines.length > 0) out.push(dataLines.join('\n'));
          dataLines = [];
          dataBytes = 0;
        } else if (line.startsWith(':')) {
          // comment / keepalive
        } else if (line.startsWith('data:')) {
          const value = line.slice(5);
          dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
          dataBytes += value.length;
          if (dataBytes > maks) throw new SseForStor();
        }
        // other fields (event:, id:, retry:) are not used by Hermes
      }
      if (buffer.length + dataBytes > maks) throw new SseForStor();
      return out;
    },
  };
}
