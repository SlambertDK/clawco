// KC-0273 (D5): the one way Sky reads an HTTP answer from a tenant's Clawco. A tenant is untrusted code on the other
// end of the bridge network, and Sky is one process that is also every tenant's gateway: an answer read with r.json()
// or r.text() is held whole in memory, however long the tenant keeps sending. This reads the body as a stream and
// stops (cancelling it) the moment it passes `maks` bytes; a Content-Length over `maks` is refused before reading.
// The time bound stays the caller's (its AbortSignal.timeout on the fetch).

/** What a tenant's answer to Sky may be: health, a control call's {ok, aendret}, the beta measures. */
export const LEJERSVAR_MAKS = 64 * 1024;

export class ForStortSvar extends Error {
  constructor(maks: number) { super(`svaret er for stort (over ${maks} byte)`); this.name = 'ForStortSvar'; }
}

/** The body as UTF-8 text, at most `maks` bytes; throws ForStortSvar past it. */
export async function laesBegraenset(r: Response, maks: number): Promise<string> {
  return new TextDecoder().decode(await laesBegraensetBytes(r, maks));
}

/** The body's bytes, at most `maks`; throws ForStortSvar past it. */
export async function laesBegraensetBytes(r: Response, maks: number): Promise<Buffer> {
  const laengde = Number(r.headers.get('content-length') ?? NaN);
  if (Number.isFinite(laengde) && laengde > maks) {
    await r.body?.cancel().catch(() => {});
    throw new ForStortSvar(maks);
  }
  if (!r.body) return Buffer.alloc(0);
  const laeser = r.body.getReader();
  const dele: Uint8Array[] = [];
  let i = 0;
  for (;;) {
    const { done, value } = await laeser.read();
    if (done) break;
    i += value.byteLength;
    if (i > maks) {
      await laeser.cancel().catch(() => {});
      throw new ForStortSvar(maks);
    }
    dele.push(value);
  }
  return Buffer.concat(dele);
}
