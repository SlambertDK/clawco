// KC-0264: the model providers behind the proxy, one seam (`ModelUdbyder.send`), both through the official SDKs:
// `anthropic` = Anthropic's own API (@anthropic-ai/sdk; its 1.x client sends the key as a bearer token), whose Messages
// wire and SSE the proxy passes on unchanged (`.asResponse()`). `bedrock` = Claude in Amazon Bedrock's bedrock-runtime
// endpoint (@anthropic-ai/bedrock-sdk AnthropicBedrock, SigV4) with the EU cross-region inference profile: in eu-central-1
// Haiku 5.5 is served only there, not on the bedrock-mantle Messages endpoint. bedrock-runtime streams AWS's binary
// event-stream, so its raw bytes cannot be passed on: the SDK decodes the stream into Anthropic's events and `sseStroem`
// writes them out again as Anthropic SSE, so the proxy's usage reader and the tenant see exactly the Anthropic wire.
// Base URLs, regions and model ids come from config/modelpriser.json; keys from env (removed from it at once).
//
// Fail closed (AGENTS §0 r7): no provider named, a key missing, or the provider's host not listed as a subprocessor in
// docs/legal/behandlinger.json (KC-0266, Henrik's choice) = no provider, and the proxy answers 503. No retries (a retry
// is a second charge); a refused key or an outage upstream is 503 to the tenant, never the provider's words about our key.
// A break after the first event is one generic SSE `error` event, never AWS's own text.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Anthropic, { APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';
import type { Modelpriser } from './priser.ts';

export type UdbyderNavn = 'anthropic' | 'bedrock';

export type ModelUdbyder = {
  navn: UdbyderNavn;
  /** One Messages request. Resolves with the provider's raw 2xx response (its body unread), else rejects with UdbyderFejl. */
  send(a: { krop: Record<string, unknown>; model: string; headers: Record<string, string>; signal: AbortSignal }): Promise<Response>;
};

/** What the tenant is told when the provider did not answer 2xx: a status and a type from the contract, or the provider's own 400/429. */
export class UdbyderFejl extends Error {
  readonly status: number;
  readonly type: string;
  readonly besked: string;
  readonly retryAfter: string | null;
  constructor(status: number, type: string, besked: string, retryAfter: string | null = null) {
    super(`udbyder: ${status} ${type}`);
    this.status = status;
    this.type = type;
    this.besked = besked;
    this.retryAfter = retryAfter;
  }
}

/** The tenant may set these two (the wire version and its beta features); every other header is Sky's. */
export const VIDERE_HEADERS = ['anthropic-version', 'anthropic-beta'] as const;

/** Upstream answers that are the tenant's own doing pass through; everything else is our side, and the tenant gets 503. */
const VIDERE_STATUS = new Set([400, 413, 422, 429]);
const IKKE = 'ikke_tilgaengelig';

function oversaet(e: unknown, navn: string, log: (l: string) => void): UdbyderFejl {
  if (e instanceof UdbyderFejl) return e;
  if (e instanceof APIUserAbortError || (e instanceof Error && e.name === 'AbortError')) return new UdbyderFejl(499, 'afbrudt', 'Kaldet blev afbrudt.');
  if (e instanceof APIError && typeof e.status === 'number') {
    if (VIDERE_STATUS.has(e.status)) {
      const b = (e.error as { error?: { type?: unknown; message?: unknown } } | undefined)?.error;
      const type = typeof b?.type === 'string' ? b.type.slice(0, 60) : e.status === 429 ? 'rate_limit_error' : 'invalid_request_error';
      const besked = typeof b?.message === 'string' ? b.message.slice(0, 500) : 'Udbyderen afviste kaldet.';
      return new UdbyderFejl(e.status, type, besked, e.headers?.get('retry-after') ?? null);
    }
    log(`sky model: ${navn} svarede ${e.status}${e.status === 401 || e.status === 403 ? ' (Clawcos nøgle blev afvist)' : ''}`);
    return new UdbyderFejl(503, IKKE, 'Modellen er ikke tilgængelig lige nu.');
  }
  log(`sky model: ${navn} kunne ikke nås (${e instanceof Error ? e.name : 'ukendt fejl'})`);
  return new UdbyderFejl(503, IKKE, 'Modellen er ikke tilgængelig lige nu.');
}

type Klient = { messages: { create(body: never, opts: { headers: Record<string, string>; signal: AbortSignal }): { asResponse(): Promise<Response> } } };

/** What sdkUdbyder needs of AnthropicBedrock: messages.create resolves to the SDK's Stream of decoded events when
 *  `stream` is true (and offers asResponse() for a non-streamed call). The seam tests fill with a fake. */
export type BedrockStroem = AsyncIterable<{ type: string }> & { controller: AbortController };
export type BedrockKlient = { messages: { create(body: never, opts: { headers: Record<string, string>; signal: AbortSignal }): Promise<unknown> & { asResponse(): Promise<Response> } } };
export type BedrockValg = { url: string; aws: { id: string; hemmelighed: string; region: string }; timeoutMs: number };

/** The real Bedrock client. Region, base URL and both keys are explicit and the bearer key is null, so nothing is read
 *  from the process environment (AWS_REGION, AWS_BEARER_TOKEN_BEDROCK, ANTHROPIC_BEDROCK_BASE_URL, the credential chain). */
export function bedrockKlient(o: BedrockValg): AnthropicBedrock {
  return new AnthropicBedrock({ baseURL: o.url, awsRegion: o.aws.region, awsAccessKey: o.aws.id, awsSecretKey: o.aws.hemmelighed, awsSessionToken: null, apiKey: null, maxRetries: 0, timeout: o.timeoutMs, logLevel: 'off' });
}

const kode = new TextEncoder();
/** One event in Anthropic's SSE framing, `type` first (the proxy's usage reader matches on it). */
const sseRamme = (e: { type: string }): Uint8Array => kode.encode(`event: ${e.type}\ndata: ${JSON.stringify(Object.assign({ type: e.type }, e))}\n\n`);
const FEJLRAMME = sseRamme({ type: 'error', error: { type: 'api_error', message: 'Modellen er ikke tilgængelig lige nu.' } } as { type: string });

/** The SDK's decoded events as Anthropic SSE. The first event is read before this resolves, so an error before it keeps
 *  the status mapping; a break after it is one generic `error` event and the end. Cancelling aborts the upstream. */
async function sseStroem(s: BedrockStroem, signal: AbortSignal, navn: string, log: (l: string) => void): Promise<Response> {
  const it = s[Symbol.asyncIterator]();
  let naeste: IteratorResult<{ type: string }> | null;
  try { naeste = await it.next(); } catch (e) { s.controller.abort(); throw e; }
  let slut = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (slut) return;
      try {
        const r = naeste ?? await it.next();
        naeste = null;
        if (slut) return;
        if (r.done) { slut = true; ctrl.close(); return; }
        ctrl.enqueue(sseRamme(r.value));
      } catch (e) {
        if (slut) return;
        slut = true;
        if (!signal.aborted) {
          log(`sky model: ${navn} afbrød svaret (${e instanceof Error ? e.name : 'ukendt fejl'})`);
          ctrl.enqueue(FEJLRAMME);
        }
        ctrl.close();
      }
    },
    cancel() {
      slut = true;
      s.controller.abort();
      // Not awaited: a generator mid-read finishes once the abort lands; the tenant's hang-up never waits on it.
      void it.return?.(undefined).catch(() => {});
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}

/** The provider, over its official SDK client. `url` = the base URL with {region} filled in (tests point it at a fake);
 *  `lagBedrock` builds the Bedrock client (default bedrockKlient; tests inject a fake). */
export function sdkUdbyder(o: { priser: Modelpriser; url: string; timeoutMs?: number; log?: (l: string) => void } & ({ art: 'anthropic'; noegle: string } | { art: 'bedrock'; aws: { id: string; hemmelighed: string; region: string }; lagBedrock?: (v: BedrockValg) => BedrockKlient })): ModelUdbyder {
  const log = o.log ?? ((l: string) => console.error(l));
  const timeout = o.timeoutMs ?? 10 * 60_000;
  // Every credential is passed explicitly, so nothing is ever picked up from the process environment.
  const anthropic = o.art === 'anthropic' ? new Anthropic({ baseURL: o.url, maxRetries: 0, timeout, logLevel: 'off', apiKey: o.noegle, authToken: null }) as unknown as Klient : null;
  const bedrock = o.art === 'bedrock' ? (o.lagBedrock ?? bedrockKlient)({ url: o.url, aws: o.aws, timeoutMs: timeout }) as unknown as BedrockKlient : null;
  const modelId = o.priser.udbydere[o.art]!.modelId;
  return {
    navn: o.art,
    async send(a) {
      const id = Object.hasOwn(modelId, a.model) ? modelId[a.model] : undefined;
      if (!id) throw new UdbyderFejl(503, IKKE, 'Modellen er ikke sat op hos udbyderen.');
      const headers: Record<string, string> = {};
      for (const h of VIDERE_HEADERS) if (a.headers[h]) headers[h] = a.headers[h]!;
      const opts = { headers, signal: a.signal };
      try {
        if (anthropic) return await anthropic.messages.create({ ...a.krop, model: id } as never, opts).asResponse();
        const kald = bedrock!.messages.create({ ...a.krop, model: id } as never, opts);
        if (a.krop['stream'] !== true) return await kald.asResponse();
        return await sseStroem(await kald as BedrockStroem, a.signal, o.art, log);
      } catch (e) {
        throw oversaet(e, o.art, log);
      }
    },
  };
}

/** The host a provider's base URL points at, {region} filled in. */
export function udbyderVaert(url: string, region: string | null): string {
  return new URL(url.replace('{region}', region ?? '')).hostname;
}

type Behandlingsdata = { underdatabehandlere: { id: string; vaerter: string[]; ibrugtagning?: string | null }[] };
export const BEHANDLINGSFIL = fileURLToPath(new URL('../../../docs/legal/behandlinger.json', import.meta.url));

/** docs/legal/behandlinger.json as far as the gate reads it (KC-0205's data file); null when unreadable. */
export function laesBehandlingsdata(sti: string = BEHANDLINGSFIL): Behandlingsdata | null {
  try {
    const d = JSON.parse(fs.readFileSync(sti, 'utf8')) as Behandlingsdata;
    return Array.isArray(d.underdatabehandlere) ? d : null;
  } catch { return null; }
}

/** True when a listed subprocessor's hosts cover `vaert` (`*.x.y` covers x.y and everything under it, as in the legal test). */
export function juridiskGodkendt(vaert: string, d: Behandlingsdata | null): boolean {
  if (!d) return false;
  return d.underdatabehandlere.some((u) => Array.isArray(u.vaerter) && u.vaerter.some((v) => (v.startsWith('*.') ? vaert === v.slice(2) || vaert.endsWith(v.slice(1)) : v === vaert)));
}

const daekker = (v: string, vaert: string): boolean => (v.startsWith('*.') ? vaert === v.slice(2) || vaert.endsWith(v.slice(1)) : v === vaert);

/** KC-0266: the start date (ibrugtagning) of the listed subprocessor whose hosts cover `vaert`; null = none or no date. */
export function ibrugtagningFor(vaert: string, d: Behandlingsdata | null): string | null {
  const u = d?.underdatabehandlere.find((x) => Array.isArray(x.vaerter) && x.vaerter.some((v) => daekker(v, vaert)));
  return typeof u?.ibrugtagning === 'string' ? u.ibrugtagning : null;
}

/** KC-0266: the list promises 30 days' e-mail notice before a new subprocessor processes an existing customer's data. A
 *  subprocessor with a start date `ibrugtagning` was added 30 days before it: an account created before the addition may
 *  be processed from the start date (00:00 UTC) on; an account created on or after it accepted the list with the
 *  subprocessor and may be processed at once. No start date = no waiting. */
export function maaBehandle(ibrugtagning: string | null, kontoOprettet: Date, nu: Date): boolean {
  if (!ibrugtagning) return true;
  const start = Date.parse(`${ibrugtagning}T00:00:00Z`);
  if (Number.isNaN(start)) return false;
  const tilfoejet = start - 30 * 24 * 60 * 60_000;
  return kontoOprettet.getTime() >= tilfoejet || nu.getTime() >= start;
}

export const MODEL_NOEGLER = ['SKY_ANTHROPIC_API_KEY', 'SKY_AWS_ACCESS_KEY_ID', 'SKY_AWS_SECRET_ACCESS_KEY'] as const;

/** The provider from env: SKY_MODEL_UDBYDER (anthropic | bedrock) and its keys; SKY_AWS_REGION overrides the configured
 *  Bedrock region. Reading removes the keys from `env` (child processes never inherit them). The reason names keys only. */
export function laesUdbyder(env: Record<string, string | undefined>, priser: Modelpriser, log?: (l: string) => void): { udbyder: ModelUdbyder | null; grund: string | null; vaert?: string } {
  const v = (k: string) => (env[k] ?? '').trim();
  const noegle = v('SKY_ANTHROPIC_API_KEY');
  const awsId = v('SKY_AWS_ACCESS_KEY_ID');
  const awsHemmelig = v('SKY_AWS_SECRET_ACCESS_KEY');
  for (const k of MODEL_NOEGLER) delete env[k];
  const navn = v('SKY_MODEL_UDBYDER');
  if (!navn) return { udbyder: null, grund: 'SKY_MODEL_UDBYDER er ikke sat' };
  if (navn !== 'anthropic' && navn !== 'bedrock') return { udbyder: null, grund: 'SKY_MODEL_UDBYDER er ugyldig (anthropic eller bedrock)' };
  const u = priser.udbydere[navn];
  if (!u) return { udbyder: null, grund: `config/modelpriser.json har ingen udbyder ${navn}` };
  const region = navn === 'bedrock' ? v('SKY_AWS_REGION') || u.region : u.region;
  if (region !== null && !/^[a-z]{2}(-[a-z]+)+-\d$/.test(region)) return { udbyder: null, grund: 'SKY_AWS_REGION er ugyldig (fx eu-central-1)' };
  const url = u.url.replace('{region}', region ?? '');
  const vaert = udbyderVaert(u.url, region);
  const extra = log ? { log } : {};
  if (navn === 'anthropic') {
    if (!noegle) return { udbyder: null, grund: 'SKY_ANTHROPIC_API_KEY mangler' };
    return { udbyder: sdkUdbyder({ art: 'anthropic', noegle, priser, url, ...extra }), grund: null, vaert };
  }
  const mangler = [['SKY_AWS_ACCESS_KEY_ID', awsId], ['SKY_AWS_SECRET_ACCESS_KEY', awsHemmelig]].filter(([, x]) => !x).map(([k]) => k);
  if (mangler.length) return { udbyder: null, grund: `${mangler.join(' og ')} mangler` };
  return { udbyder: sdkUdbyder({ art: 'bedrock', aws: { id: awsId, hemmelighed: awsHemmelig, region: region! }, priser, url, ...extra }), grund: null, vaert };
}
