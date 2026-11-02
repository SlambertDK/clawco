import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElevenLabs } from '../../src/stemme/elevenlabs.ts';
import { StemmeError } from '../../src/stemme/types.ts';
import type { AgentConfig } from '../../src/stemme/types.ts';
import { PRODUKT } from '../../src/shell/navn.ts';

type Call = { url: string; method: string; headers: Headers; body: BodyInit | null | undefined };
type Handler = (call: Call) => Response | undefined;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Records every call; the first handler returning a Response wins. */
function fakeFetch(...handlers: Handler[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body,
    };
    calls.push(call);
    for (const h of handlers) {
      const r = h(call);
      if (r) return r;
    }
    throw new Error(`unexpected ${call.method} ${call.url}`);
  }) as typeof fetch;
  return { fetch: f, calls };
}

const on = (method: string, url: string, res: () => Response): Handler => (c) =>
  c.method === method && c.url === url ? res() : undefined;

const BASE = 'https://api.elevenlabs.io';

function client(f: typeof fetch) {
  return createElevenLabs({ apiKey: 'k-123', fetch: f });
}

function bodyJson(c: Call): unknown {
  return JSON.parse(String(c.body));
}

const CONFIG: AgentConfig = {
  name: 'Kontrolcenter',
  language: 'da',
  llm: 'claude-sonnet-4-5',
  prompt: 'Du er Hermes’ stemme.',
  firstMessage: 'Hej Henrik',
  ttsModelId: 'eleven_flash_v2_5',
  turnTimeout: 8,
  turnEagerness: 'patient',
  maxDurationSeconds: 900,
  dynamicVariablePlaceholders: { oversigt: 'test' },
  tools: [
    {
      name: 'vaelg',
      description: 'Vælg et punkt',
      parameters: { type: 'object', properties: { id: { type: 'string', description: 'id' } }, required: ['id'] },
      expectsResponse: true,
    },
    {
      name: 'luk',
      description: 'Luk samtalen',
      parameters: { type: 'object', properties: {}, required: [] },
      expectsResponse: false,
      responseTimeoutSecs: 5,
      preToolSpeech: 'off',
    },
  ],
};

test('empty api key fails closed with a 503', () => {
  for (const apiKey of ['', '   ']) {
    assert.throws(
      () => createElevenLabs({ apiKey }),
      (e: unknown) => e instanceof StemmeError && e.status === 503 && e.message === 'ElevenLabs-nøglen mangler',
    );
  }
});

test('lyt posts multipart to scribe_v2 and returns the trimmed text', async () => {
  const { fetch: f, calls } = fakeFetch(on('POST', `${BASE}/v1/speech-to-text`, () => json({ text: '  Hej Kira \n' })));
  const terms = ['Hermes', ' Kira ', 'Hermes', '', 'x'.repeat(51), ...Array.from({ length: 60 }, (_, i) => `t${i}`)];
  const text = await client(f).lyt(new Uint8Array([1, 2, 3]), 'audio/webm;codecs=opus', terms);
  assert.equal(text, 'Hej Kira');
  const c = calls[0]!;
  assert.equal(c.headers.get('xi-api-key'), 'k-123');
  assert.ok(c.body instanceof FormData);
  const form = await new Request('http://x', { method: 'POST', body: c.body }).formData();
  assert.equal(form.get('model_id'), 'scribe_v2');
  assert.equal(form.get('language_code'), 'da');
  assert.equal(form.get('tag_audio_events'), 'false');
  assert.equal(form.get('diarize'), 'false');
  const keyterms = form.getAll('keyterms') as string[];
  assert.equal(keyterms.length, 50);
  assert.deepEqual(keyterms.slice(0, 3), ['Hermes', 'Kira', 't0']);
  assert.ok(!keyterms.includes(''));
  assert.ok(keyterms.every((k) => k.length <= 50));
  assert.equal(new Set(keyterms).size, keyterms.length);
  const file = form.get('file') as File;
  assert.equal(file.name, 'speech.webm');
  assert.equal(file.type, 'audio/webm');
  assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [1, 2, 3]);
});

test('KC-0241: lyt sends the language it was asked for (Danish by default)', async () => {
  const { fetch: f, calls } = fakeFetch(on('POST', `${BASE}/v1/speech-to-text`, () => json({ text: 'x' })));
  await client(f).lyt(new Uint8Array([1]), 'audio/webm', []);
  await client(f).lyt(new Uint8Array([1]), 'audio/webm', [], 'en');
  const langs = await Promise.all(calls.map(async (c) => (await new Request('http://x', { method: 'POST', body: c.body ?? null }).formData()).get('language_code')));
  assert.deepEqual(langs, ['da', 'en']);
});

test('lyt picks the filename from the mime type', async () => {
  const seen: string[] = [];
  const { fetch: f, calls } = fakeFetch(() => json({ text: 'x' }));
  const c = client(f);
  for (const [mime, name] of [
    ['audio/mp4', 'speech.m4a'],
    ['audio/ogg;codecs=opus', 'speech.ogg'],
    ['audio/webm', 'speech.webm'],
  ] as const) {
    await c.lyt(new Uint8Array([0]), mime, []);
    const form = await new Request('http://x', { method: 'POST', body: calls.at(-1)!.body ?? null }).formData();
    seen.push((form.get('file') as File).name);
    assert.equal(name, seen.at(-1));
  }
  assert.equal(seen.length, 3);
});

test('lyt maps an HTTP error to a 502 StemmeError with the first 200 chars of the body', async () => {
  const { fetch: f } = fakeFetch(() => new Response('x'.repeat(500), { status: 401 }));
  await assert.rejects(client(f).lyt(new Uint8Array([1]), 'audio/webm', []), (e: unknown) => {
    assert.ok(e instanceof StemmeError);
    assert.equal(e.status, 502);
    assert.ok(e.message.startsWith('ElevenLabs '));
    assert.ok(e.message.includes(' 401: '));
    assert.ok(e.message.endsWith('x'.repeat(200)));
    assert.ok(!e.message.includes('x'.repeat(201)));
    return true;
  });
});

test('sig posts the TTS request and returns the mp3 stream', async () => {
  const url = `${BASE}/v1/text-to-speech/voice%201/stream?output_format=mp3_44100_64`;
  const { fetch: f, calls } = fakeFetch(on('POST', url, () => new Response(new Uint8Array([9, 8, 7]))));
  const r = await client(f).sig('Hej', 'voice 1');
  assert.equal(r.contentType, 'audio/mpeg');
  assert.deepEqual([...new Uint8Array(await new Response(r.body).arrayBuffer())], [9, 8, 7]);
  const c = calls[0]!;
  assert.equal(c.headers.get('xi-api-key'), 'k-123');
  assert.equal(c.headers.get('content-type'), 'application/json');
  assert.deepEqual(bodyJson(c), {
    text: 'Hej',
    model_id: 'eleven_flash_v2_5',
    language_code: 'da',
    voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1 },
  });
});

test('KC-0241: sig sends the language it was asked for (Danish by default)', async () => {
  const { fetch: f, calls } = fakeFetch(on('POST', `${BASE}/v1/text-to-speech/v/stream?output_format=mp3_44100_64`, () => new Response(new Uint8Array([1]))));
  await client(f).sig('Hej', 'v');
  await client(f).sig('Hello', 'v', 'en');
  assert.deepEqual(calls.map((c) => (bodyJson(c) as Record<string, unknown>)['language_code']), ['da', 'en']);
});

test('sig without a body and sig on HTTP error both throw StemmeError', async () => {
  const empty = fakeFetch(() => ({ ok: true, status: 200, body: null, text: async () => '' }) as unknown as Response);
  await assert.rejects(client(empty.fetch).sig('Hej', 'v'), StemmeError);
  const bad = fakeFetch(() => new Response('nej', { status: 429 }));
  await assert.rejects(client(bad.fetch).sig('Hej', 'v'), (e: unknown) => {
    assert.ok(e instanceof StemmeError);
    assert.equal(e.status, 502);
    assert.ok(e.message.includes(' 429: nej'));
    return true;
  });
});

test('samtaleToken GETs the conversation token', async () => {
  const { fetch: f, calls } = fakeFetch(
    on('GET', `${BASE}/v1/convai/conversation/token?agent_id=agent%2F1`, () => json({ token: 'tok' })),
  );
  assert.equal(await client(f).samtaleToken('agent/1'), 'tok');
  assert.equal(calls[0]!.headers.get('xi-api-key'), 'k-123');
});

test('ensureVoice returns a given id without any request', async () => {
  const { fetch: f, calls } = fakeFetch();
  assert.equal(await client(f).ensureVoice('abc'), 'abc');
  assert.equal(calls.length, 0);
});

test('ensureVoice adds the top Danish library voice to the account', async () => {
  const { fetch: f, calls } = fakeFetch(
    on('GET', `${BASE}/v1/shared-voices?language=da&page_size=5&sort=usage_character_count_1y`, () =>
      json({ voices: [{ voice_id: 'v1', public_owner_id: 'o1', name: 'Mette' }, { voice_id: 'v2', public_owner_id: 'o2', name: 'Jens' }] }),
    ),
    on('POST', `${BASE}/v1/voices/add/o1/v1`, () => json({ voice_id: 'mine' })),
  );
  assert.equal(await client(f).ensureVoice(), 'mine');
  assert.deepEqual(bodyJson(calls[1]!), { new_name: `${PRODUKT} – Mette` });
  assert.equal(calls[1]!.headers.get('xi-api-key'), 'k-123');
});

test('KC-0242: ensureVoice looks in the library for the language it was asked for', async () => {
  const { fetch: f, calls } = fakeFetch(
    on('GET', `${BASE}/v1/shared-voices?language=en&page_size=5&sort=usage_character_count_1y`, () =>
      json({ voices: [{ voice_id: 'e1', public_owner_id: 'eo', name: 'Sarah' }] }),
    ),
    on('POST', `${BASE}/v1/voices/add/eo/e1`, () => json({ voice_id: 'mine-en' })),
  );
  assert.equal(await client(f).ensureVoice(undefined, 'en'), 'mine-en');
  assert.match(calls[0]!.url, /language=en&/);
  assert.deepEqual(bodyJson(calls[1]!), { new_name: `${PRODUKT} – Sarah` });
});

test('KC-0242: ensureVoice returns a given id for English too, without any request', async () => {
  const { fetch: f, calls } = fakeFetch(() => json({}));
  assert.equal(await client(f).ensureVoice('abc', 'en'), 'abc');
  assert.equal(calls.length, 0);
});

test('KC-0242: ensureVoice with an empty English library names the language in the 502', async () => {
  const { fetch: f } = fakeFetch(() => json({ voices: [] }));
  await assert.rejects(client(f).ensureVoice(undefined, 'en'), (e: unknown) => {
    assert.ok(e instanceof StemmeError);
    assert.equal(e.status, 502);
    assert.equal(e.message, "Ingen engelsk stemme fundet i ElevenLabs' bibliotek");
    return true;
  });
});

test('ensureVoice with an empty library throws a 502', async () => {
  const { fetch: f } = fakeFetch(() => json({ voices: [] }));
  await assert.rejects(client(f).ensureVoice(''), (e: unknown) => {
    assert.ok(e instanceof StemmeError);
    assert.equal(e.status, 502);
    assert.equal(e.message, "Ingen dansk stemme fundet i ElevenLabs' bibliotek");
    return true;
  });
});

function toolConfig(name: string, expectsResponse: boolean, timeout: number, speech: string) {
  const t = CONFIG.tools.find((x) => x.name === name)!;
  return {
    type: 'client',
    name,
    description: t.description,
    parameters: t.parameters,
    expects_response: expectsResponse,
    response_timeout_secs: timeout,
    pre_tool_speech: speech,
  };
}

function expectedAgentBody(toolIds: string[]) {
  return {
    name: 'Kontrolcenter',
    conversation_config: {
      agent: {
        first_message: 'Hej Henrik',
        language: 'da',
        prompt: { prompt: 'Du er Hermes’ stemme.', llm: 'claude-sonnet-4-5', temperature: 0.3, tool_ids: toolIds },
        dynamic_variables: { dynamic_variable_placeholders: { oversigt: 'test' } },
      },
      tts: { voice_id: 'voice', model_id: 'eleven_flash_v2_5' },
      turn: { turn_timeout: 8, turn_eagerness: 'patient' },
      conversation: {
        max_duration_seconds: 900,
        client_events: [
          'audio',
          'interruption',
          'user_transcript',
          'agent_response',
          'agent_response_correction',
          'client_tool_call',
          'ping',
        ],
      },
    },
    platform_settings: { auth: { enable_auth: true } },
  };
}

test('ensureAgent creates tools and the agent when nothing exists', async () => {
  let n = 0;
  const { fetch: f, calls } = fakeFetch(
    on('GET', `${BASE}/v1/convai/tools`, () => json({ tools: [] })),
    on('POST', `${BASE}/v1/convai/tools`, () => json({ id: `tool_${++n}` })),
    on('GET', `${BASE}/v1/convai/agents?search=Kontrolcenter&page_size=20`, () => json({ agents: [{ agent_id: 'other', name: 'Kontrolcenter 2' }] })),
    on('POST', `${BASE}/v1/convai/agents/create`, () => json({ agent_id: 'agent_1' })),
  );
  const ids = await client(f).ensureAgent(CONFIG, 'voice');
  assert.deepEqual(ids, { agentId: 'agent_1', toolIds: { vaelg: 'tool_1', luk: 'tool_2' } });
  for (const c of calls) assert.equal(c.headers.get('xi-api-key'), 'k-123');
  const toolPosts = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/v1/convai/tools'));
  assert.deepEqual(bodyJson(toolPosts[0]!), { tool_config: toolConfig('vaelg', true, 20, 'auto') });
  assert.deepEqual(bodyJson(toolPosts[1]!), { tool_config: toolConfig('luk', false, 5, 'off') });
  assert.deepEqual(bodyJson(calls.at(-1)!), expectedAgentBody(['tool_1', 'tool_2']));
});

test('ensureAgent PATCHes known ids and never lists or creates', async () => {
  const { fetch: f, calls } = fakeFetch(
    on('PATCH', `${BASE}/v1/convai/tools/t-a`, () => json({ id: 't-a' })),
    on('PATCH', `${BASE}/v1/convai/tools/t-b`, () => json({ id: 't-b' })),
    on('PATCH', `${BASE}/v1/convai/agents/ag`, () => json({ agent_id: 'ag' })),
  );
  const ids = await client(f).ensureAgent(CONFIG, 'voice', { agentId: 'ag', toolIds: { vaelg: 't-a', luk: 't-b' } });
  assert.deepEqual(ids, { agentId: 'ag', toolIds: { vaelg: 't-a', luk: 't-b' } });
  assert.deepEqual(calls.map((c) => c.method), ['PATCH', 'PATCH', 'PATCH']);
  assert.deepEqual(bodyJson(calls[0]!), { tool_config: toolConfig('vaelg', true, 20, 'auto') });
  assert.deepEqual(bodyJson(calls[2]!), expectedAgentBody(['t-a', 't-b']));
});

test('ensureAgent falls through to create when a known id answers 404', async () => {
  const { fetch: f, calls } = fakeFetch(
    on('PATCH', `${BASE}/v1/convai/tools/gone`, () => new Response('nope', { status: 404 })),
    on('PATCH', `${BASE}/v1/convai/agents/gone-agent`, () => new Response('nope', { status: 404 })),
    on('GET', `${BASE}/v1/convai/tools`, () => json({ tools: [] })),
    on('POST', `${BASE}/v1/convai/tools`, () => json({ id: 'new-tool' })),
    on('GET', `${BASE}/v1/convai/agents?search=Kontrolcenter&page_size=20`, () => json({ agents: [] })),
    on('POST', `${BASE}/v1/convai/agents/create`, () => json({ agent_id: 'new-agent' })),
  );
  const cfg = { ...CONFIG, tools: [CONFIG.tools[0]!] };
  const ids = await client(f).ensureAgent(cfg, 'voice', { agentId: 'gone-agent', toolIds: { vaelg: 'gone' } });
  assert.deepEqual(ids, { agentId: 'new-agent', toolIds: { vaelg: 'new-tool' } });
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 2);
});

test('ensureAgent reuses an existing tool and agent found by name', async () => {
  const { fetch: f, calls } = fakeFetch(
    on('GET', `${BASE}/v1/convai/tools`, () =>
      json({ tools: [{ id: 'old-vaelg', tool_config: { name: 'vaelg' } }, { tool_id: 'old-luk', tool_config: { name: 'luk' } }] }),
    ),
    on('PATCH', `${BASE}/v1/convai/tools/old-vaelg`, () => json({ id: 'old-vaelg' })),
    on('PATCH', `${BASE}/v1/convai/tools/old-luk`, () => json({ id: 'old-luk' })),
    on('GET', `${BASE}/v1/convai/agents?search=Kontrolcenter&page_size=20`, () =>
      json({ agents: [{ agent_id: 'x', name: 'Kontrolcenter Test' }, { agent_id: 'found', name: 'Kontrolcenter' }] }),
    ),
    on('PATCH', `${BASE}/v1/convai/agents/found`, () => json({ agent_id: 'found' })),
  );
  const ids = await client(f).ensureAgent(CONFIG, 'voice');
  assert.deepEqual(ids, { agentId: 'found', toolIds: { vaelg: 'old-vaelg', luk: 'old-luk' } });
  assert.ok(!calls.some((c) => c.method === 'POST'));
  assert.deepEqual(bodyJson(calls.at(-1)!), expectedAgentBody(['old-vaelg', 'old-luk']));
});

test('ensureAgent surfaces a non-404 error as a 502 StemmeError', async () => {
  const { fetch: f } = fakeFetch(() => new Response('kaput', { status: 500 }));
  await assert.rejects(client(f).ensureAgent(CONFIG, 'voice'), (e: unknown) => {
    assert.ok(e instanceof StemmeError);
    assert.equal(e.status, 502);
    assert.ok(e.message.includes(' 500: kaput'));
    return true;
  });
});

test('a custom baseUrl is honoured and trailing slashes trimmed', async () => {
  const { fetch: f, calls } = fakeFetch(() => json({ token: 't' }));
  await createElevenLabs({ apiKey: 'k', fetch: f, baseUrl: 'http://local:1/' }).samtaleToken('a');
  assert.equal(calls[0]!.url, 'http://local:1/v1/convai/conversation/token?agent_id=a');
});
