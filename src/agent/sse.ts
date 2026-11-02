// Minimal Server-Sent Events parser: feed it raw text chunks (which may be
// split anywhere), get back the complete `data:` payloads as they finish.

export function parseSseChunks(): { push(chunk: string): string[] } {
  let buffer = '';
  let dataLines: string[] = [];

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
        } else if (line.startsWith(':')) {
          // comment / keepalive
        } else if (line.startsWith('data:')) {
          const value = line.slice(5);
          dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
        }
        // other fields (event:, id:, retry:) are not used by Hermes
      }
      return out;
    },
  };
}
