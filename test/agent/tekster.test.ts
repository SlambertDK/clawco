// KC-0170 slice 3: the words of a failed Hermes connection and of the direct model's timer, in English or Danish.
// Danish (no language chosen, or da chosen) is byte for byte what the code said before (the literals below were captured
// from the code before the strings moved); English has no Danish word left; the shell command for the operator stays.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_TEKSTER } from '../../src/agent/tekster.ts';
import { createHermesHttp, noegleKommando } from '../../src/agent/hermes-http.ts';
import { createDirekte } from '../../src/agent/direkte.ts';
import { AgentError } from '../../src/agent/types.ts';
import { medSprog } from '../../src/store/sprog.ts';
import { DANSK, ensStrenge, form, tomme } from '../fixtures/sprog-tjek.ts';

const tabel = (t: unknown): Record<string, unknown> => t as Record<string, unknown>;
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sse = (chunks: string[]): Response => {
  const enc = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.close(); } }), { status: 200 });
};
const ev = (o: Record<string, unknown>): string => `data: ${JSON.stringify({ run_id: 'run_1', timestamp: 1, ...o })}\n\n`;
const REQ = { input: 'hej', instructions: 'vær kort' };

type Routes = { post?: () => Response; events?: () => Response; status?: () => Response };
const hermes = (r: Routes, o: { apiKey?: string; timeoutMs?: number } = {}) => {
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if ((init?.method ?? 'GET') === 'POST' && url.endsWith('/v1/runs')) return (r.post ?? (() => json({ run_id: 'run_1' }, 202)))();
    if (url.endsWith('/events')) return r.events ? r.events() : new Response(new ReadableStream<Uint8Array>({ start(c) { init?.signal?.addEventListener('abort', () => c.error(new Error('aborted'))); } }), { status: 200 });
    if (/\/v1\/runs\/[^/]+$/.test(url)) return r.status!();
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  return createHermesHttp({ baseUrl: 'http://h', apiKey: o.apiKey ?? 'k', fetchImpl, ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}) });
};
const fejlTekst = async (p: Promise<unknown>): Promise<string> => {
  const e = await p.then(() => undefined, (x: unknown) => x);
  assert.ok(e instanceof AgentError, 'the run rejects with an AgentError');
  return e.message;
};

/** One scenario per sentence the client can fail with: [name, how to provoke it]. */
const SCENARIER: [string, () => Promise<string>][] = [
  ['manglerNoegle', () => fejlTekst(hermes({}, { apiKey: '' }).run(REQ))],
  ['hermesTid', () => fejlTekst(hermes({}, { timeoutMs: 30 }).run(REQ))],
  ['udenRunId', () => fejlTekst(hermes({ post: () => json({}, 202) }).run(REQ))],
  ['afvisteKoerslen', () => fejlTekst(hermes({ post: () => json({ error: 'nej' }, 401) }).run(REQ))],
  ['eventStreamFejlede', () => fejlTekst(hermes({ events: () => json({}, 500) }).run(REQ))],
  ['eventStreamTom', () => fejlTekst(hermes({ events: () => new Response(null, { status: 200 }) }).run(REQ))],
  ['statusFejlede', () => fejlTekst(hermes({ events: () => sse([]), status: () => json({}, 500) }).run(REQ))],
  ['koerslenFejlede', () => fejlTekst(hermes({ events: () => sse([ev({ event: 'run.failed' })]) }).run(REQ))],
  ['annulleret', () => fejlTekst(hermes({ events: () => sse([ev({ event: 'run.cancelled' })]) }).run(REQ))],
  ['sluttedeUdenSvar', () => fejlTekst(hermes({ events: () => sse([]), status: () => json({ status: 'weird' }) }).run(REQ))],
  ['ukendtStatus', () => fejlTekst(hermes({ events: () => sse([]), status: () => json({}) }).run(REQ))],
];

const DA: Record<string, string> = {
  manglerNoegle: 'Clawco har ingen nøgle til Hermes endnu',
  hermesTid: 'Hermes svarede ikke i tide',
  udenRunId: 'Hermes svarede uden run_id',
  afvisteKoerslen: 'Hermes afviste kørslen: HTTP 401 nej',
  eventStreamFejlede: 'Hermes event-stream fejlede: HTTP 500 {}',
  eventStreamTom: 'Hermes event-stream uden indhold',
  statusFejlede: 'Hermes status fejlede: HTTP 500 {}',
  koerslenFejlede: 'Hermes-kørslen fejlede',
  annulleret: 'Hermes-kørslen blev annulleret',
  sluttedeUdenSvar: 'Hermes-kørslen sluttede uden svar (status: weird)',
  ukendtStatus: 'Hermes-kørslen sluttede uden svar (status: ukendt)',
};

test("English has exactly Danish's keys and shapes; no string is empty; none copied over", () => {
  const { da, en } = AGENT_TEKSTER;
  assert.deepEqual(form(en), form(da));
  assert.deepEqual(tomme(tabel(da)), []);
  assert.deepEqual(tomme(tabel(en)), []);
  assert.deepEqual(ensStrenge(tabel(da), tabel(en)), []);
  assert.equal(typeof en.sluttedeUdenSvar('x'), 'string');
});

test('Danish, with no language chosen and with da chosen, is byte for byte what the client said before', async () => {
  for (const [navn, kor] of SCENARIER) {
    assert.equal(await kor(), DA[navn], `${navn}, no language`);
    assert.equal(await medSprog('da', kor), DA[navn], `${navn}, da`);
  }
});

test('English: every failure sentence reads as English; the status and the HTTP code stay', async () => {
  for (const [navn, kor] of SCENARIER) {
    const t = await medSprog('en', kor);
    assert.ok(!DANSK.test(t), `${navn}: ${t}`);
    assert.notEqual(t, DA[navn], navn);
  }
  assert.equal(await medSprog('en', SCENARIER[3]![1]), 'Hermes rejected the run: HTTP 401 nej', "Hermes' own detail is its own words");
  assert.equal(await medSprog('en', SCENARIER[9]![1]), 'The Hermes run ended without an answer (status: weird)');
  assert.equal(await medSprog('en', SCENARIER[0]![1]), 'Clawco has no key to Hermes yet', 'the name stays');
});

test('the status of a keyless install is the same in both languages (an id, not a sentence)', async () => {
  const h = hermes({}, { apiKey: '' });
  assert.equal(await h.status(), 'mangler-noegle');
  assert.equal(await medSprog('en', () => h.status()), 'mangler-noegle');
});

test('what Hermes itself says in run.failed is passed on untranslated', async () => {
  const kor = () => fejlTekst(hermes({ events: () => sse([ev({ event: 'run.failed', error: 'tool blew up' })]) }).run(REQ));
  assert.equal(await medSprog('en', kor), 'tool blew up');
  assert.equal(await medSprog('da', kor), 'tool blew up');
});

test('the operator command Start shows stays the same in both languages', () => {
  const da = noegleKommando('FOO_KEY');
  assert.equal(medSprog('en', () => noegleKommando('FOO_KEY')), da);
  assert.match(da, /Indsæt værdien/);
});

test("the direct agent's own timer: Danish as before, English in en", async () => {
  const kor = (): Promise<string> => {
    const agent = createDirekte({
      udbydere: [{ id: 'anthropic', envNavn: 'ANTHROPIC_API_KEY', hermesProvider: 'anthropic', kraeverNoegle: true, direkte: { api: 'anthropic-messages', url: 'http://m.example/v1/messages' } }],
      lager: { hent: async () => 'k', gem: async () => {}, laengde: async () => 1 } as never,
      fejl: { 'model-noegle': 'a', 'kun-hermes': 'b', noegle: 'c', kredit: 'd', model: 'e', forbindelse: 'f', ukendt: 'g', kvote: 'h', 'inkluderet-ikke-klar': 'i', 'inkluderet-utilgaengelig': 'j' },
      fetchImpl: (async (_u: unknown, init?: RequestInit) => new Response(new ReadableStream<Uint8Array>({ start(c) { init?.signal?.addEventListener('abort', () => c.error(new Error('x'))); } }), { status: 200 })) as typeof fetch,
      timeoutMs: 30,
    });
    return fejlTekst(agent.run({ instructions: 'S', input: 'I', model: 'm', provider: 'anthropic' }));
  };
  assert.equal(await kor(), 'Modellen svarede ikke i tide.');
  assert.equal(await medSprog('da', kor), 'Modellen svarede ikke i tide.');
  const en = await medSprog('en', kor);
  assert.equal(en, 'The model timed out.');
  assert.ok(!DANSK.test(en));
});
