// KC-0268: is this request from somewhere other than the app itself? Pure rules over one Request; the server and the
// test-world dispatcher ask it before any handler. The person's identity is ambient on the tailnet (Tailscale Serve
// stamps it on every request, cookie or not), so a page on another site could otherwise write "as the owner".

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const LAESER = new Set(['GET', 'HEAD', 'OPTIONS']);

export type FremmedGrund = 'side' | 'oprindelse' | 'vaert';

/**
 * Why this request must not reach a handler, or null. Writes (anything but GET/HEAD/OPTIONS) are refused when the
 * browser says they come from another site (`Sec-Fetch-Site`) or when their `Origin` is not the host they reached; a
 * caller that sends neither (curl, the worker, the timers) is left to the identity layer. The host is checked on every
 * method when an address is configured or in laptop mode (loopback only): a name that is neither is DNS rebinding.
 * `/health` is exempt from the host rule: the deploy script and Docker's healthcheck call it by whatever name they have.
 */
export function fremmedGrund(req: Request, o: { laptop?: boolean; adresse?: string; udenVaert?: boolean }): FremmedGrund | null {
  const url = new URL(req.url);
  if (url.pathname !== '/health' && !o.udenVaert && (o.laptop || o.adresse)) {
    const egen = o.adresse ? vaertAf(o.adresse) : null;
    if (!LOOPBACK.has(url.hostname) && url.host !== egen && url.hostname !== egen) return 'vaert';
  }
  if (LAESER.has(req.method.toUpperCase())) return null;
  const site = (req.headers.get('sec-fetch-site') ?? '').trim().toLowerCase();
  if (site && site !== 'same-origin' && site !== 'none') return 'side';
  const origin = (req.headers.get('origin') ?? '').trim();
  if (origin && origin !== 'null') {
    let o2: URL;
    try { o2 = new URL(origin); } catch { return 'oprindelse'; }
    if (o2.host !== url.host) return 'oprindelse';
  } else if (origin === 'null') return 'oprindelse';
  return null;
}

/** A JSON route's body: declared as JSON, or not declared at all (a script). `text/plain` is what a no-cors form post says. */
export function erJsonKrop(req: Request): boolean {
  const t = (req.headers.get('content-type') ?? '').trim().toLowerCase();
  return !t || t.startsWith('application/json');
}

function vaertAf(adresse: string): string | null {
  try { return new URL(adresse).host; } catch { return null; }
}
