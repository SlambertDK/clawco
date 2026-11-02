// KC-0015: the stemme routes — fail-closed without a client, working with the fake,
// and the samtale hand-shake with a stub client that records what it was asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { createFakeStemme } from '../src/stemme/fake.ts';
import { AGENT_CONFIG, DEFAULT_VOICE_ID } from '../src/stemme/agent.ts';
import { parseDagenState } from '../src/rooms/dagen/schema.ts';
import { StemmeError, type AgentConfig, type StemmeClient, type StemmeIds } from '../src/stemme/types.ts';

const NOW = new Date('2026-10-27T07:30:00Z');
const noMail = { mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent' };
const dagenJson = {
  dato: '2026-10-27', treLinjer: ['Mødet kl. 10 er det vigtigste.', 'Kl. 13 er ledig.', 'Regn fra 11.'],
  anbefaling: { tekst: 'Brug kl. 13 på udkastet.', handling: { id: 'blok-13', label: 'Blokér kl. 13', instruktion: 'Opret kalenderblok 13-14 "Udkast".', fortryd: 'Slet blokken.' } },
  kalender: [], morgenavis: [], hermesStatus: 'Klar',
};

async function withApp(stemme: StemmeClient | undefined, fn: (sut: ReturnType<typeof createApp>, dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-stemme-'));
  try {
    const store = createFileStore(path.join(dir, 'data'));
    await store.writeState('dagen', parseDagenState(dagenJson, NOW));
    const hermes = createFakeAgent({ answer: () => 'Gjort.' });
    const opts = { store, hermes, sourceGlob: '/nonexistent/{date}.json', dataDir: dir, now: () => NOW, ...noMail };
    await fn(createApp(stemme ? { ...opts, stemme } : opts), dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const json = (url: string, body: unknown, app: ReturnType<typeof createApp>['app']) => app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('without a stemme client every /api/stemme route is 503 and the shell has no voice', async () => {
  await withApp(undefined, async (sut) => {
    for (const [m, u, b] of [['POST', '/api/stemme/lyt', undefined], ['POST', '/api/stemme/sig', { tekst: 'hej' }], ['GET', '/api/stemme/oversigt', undefined], ['POST', '/api/stemme/samtale', { rum: 'hjem' }], ['POST', '/api/stemme/udfoer', { id: 'dagen:blok-13' }]] as const) {
      const res = m === 'GET' ? await sut.app.request(u) : await json(u, b ?? {}, sut.app);
      assert.equal(res.status, 503, `${m} ${u}`);
    }
    const page = await (await sut.app.request('/rum/hjem')).text();
    assert.doesNotMatch(page, /data-stemme/);
    assert.doesNotMatch(page, /elevenlabs\/client/);
  });
});

test('with the fake client: lyt, sig, oversigt and udfoer work; samtale is off; shell says lyt', async () => {
  await withApp(createFakeStemme(), async (sut) => {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(2000)], { type: 'audio/webm' }), 'speech.webm');
    fd.append('rum', 'dagen');
    let res = await sut.app.request('/api/stemme/lyt', { method: 'POST', body: fd });
    let txt = await res.text();
    assert.equal(res.status, 200, txt);
    assert.deepEqual(JSON.parse(txt), { tekst: 'Hvad venter på mig i dag?' });

    res = await json('/api/stemme/sig', { tekst: 'Mødet kl. 10 er det vigtigste.' }, sut.app);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'audio/wav');
    assert.ok((await res.arrayBuffer()).byteLength > 44);
    res = await json('/api/stemme/sig', { tekst: '' }, sut.app);
    assert.equal(res.status, 400);
    res = await json('/api/stemme/sig', { tekst: 'x'.repeat(2001) }, sut.app);
    assert.equal(res.status, 400);

    res = await sut.app.request('/api/stemme/oversigt');
    assert.equal(res.status, 200);
    const o = (await res.json()) as { tekst: string; punkter: { rum: string; id: string; valg: { id: string }[] }[] };
    assert.match(o.tekst, /Der venter én ting\./);
    assert.match(o.tekst, /id dagen:blok-13/);

    res = await json('/api/stemme/samtale', { rum: 'dagen' }, sut.app);
    assert.equal(res.status, 503);

    res = await json('/api/stemme/udfoer', { id: 'dagen:blok-13' }, sut.app);
    txt = await res.text();
    assert.equal(res.status, 202, txt);
    const { runId, label } = JSON.parse(txt) as { runId: string; label: string };
    assert.equal(label, 'Blokér kl. 13');
    const rec = sut.runs.get(runId);
    assert.ok(rec);
    await rec.finished;
    assert.equal(rec.status, 'done');
    for (const id of ['mail:aktion:send:abc', 'dagen:findes-ikke', 'nope', '']) {
      res = await json('/api/stemme/udfoer', { id }, sut.app);
      assert.ok(res.status === 400 || res.status === 404, `${id} → ${res.status}`);
    }

    const page = await (await sut.app.request('/rum/dagen')).text();
    assert.match(page, /data-stemme="lyt"/);
    assert.doesNotMatch(page, /elevenlabs\/client/);
    // KC-0022: Samtale works without the agent (Hermes loop), so the button is there
    assert.match(page, /id="samtale-toggle"/);
    assert.match(page, /<script src="\/lyt\.js"/);
  });
});

test('samtale: the agent is synced once from code, ids are stored, the token and dynamic variables come back', async () => {
  const calls: { config: AgentConfig; voiceId: string; known: Partial<StemmeIds> | undefined }[] = [];
  const stub: StemmeClient = {
    ...createFakeStemme(),
    mode: 'elevenlabs',
    samtaleToken: async (agentId) => `tok-for-${agentId}`,
    ensureVoice: async (v) => v || 'voice-da',
    ensureAgent: async (config, voiceId, known) => { calls.push({ config, voiceId, known }); return { agentId: 'ag_42', toolIds: { udfoer: 't1', hent_oversigt: 't2', spoerg_hermes: 't3' } }; },
  };
  await withApp(stub, async (sut, dir) => {
    let res = await json('/api/stemme/samtale', { rum: 'dagen' }, sut.app);
    const txt = await res.text();
    assert.equal(res.status, 200, txt);
    const b = JSON.parse(txt) as { token: string; agentId: string; dynamiskeVariabler: Record<string, string> };
    assert.equal(b.token, 'tok-for-ag_42');
    assert.equal(b.agentId, 'ag_42');
    assert.equal(b.dynamiskeVariabler['rum'], 'Dagen');
    assert.equal(b.dynamiskeVariabler['antal_tekst'], 'Der venter én ting på dig.');
    assert.match(b.dynamiskeVariabler['oversigt'] ?? '', /id dagen:blok-13/);
    assert.doesNotMatch(b.dynamiskeVariabler['oversigt'] ?? '', /Kuratoren/, 'no cards → no lead line');
    await createFileStore(path.join(dir, 'data')).writeState('hjem', { kort: [{ id: 'k:a', type: 'familie', titel: 'Rikke spørger', betyder: 'x', grundlag: [], kilder: [], anbefaling: 'Svar i dag.', prioritet: 2 }], intet: [], afvist: [], sete: [] });
    res = await json('/api/stemme/samtale', { rum: 'hjem' }, sut.app);
    assert.equal(res.status, 200);
    const med = (await res.json()) as { dynamiskeVariabler: Record<string, string> };
    assert.match(med.dynamiskeVariabler['oversigt'] ?? '', /^Kuratoren har ét kort til dig\.\nRikke spørger: Svar i dag\.\n/);
    assert.equal(med.dynamiskeVariabler['antal_tekst'], 'Der venter én ting på dig.', 'cards do not change the voice-executable count');
    assert.equal(calls.length, 1, 'agent synced once per process');
    assert.equal(calls[0]?.config.name, AGENT_CONFIG.name);
    assert.equal(calls[0]?.voiceId, 'voice-da');
    const ind = (await (await sut.app.request('/api/indstillinger')).json()) as { stemme: { agentId?: string; voiceId?: string; toolIds?: Record<string, string> } };
    assert.equal(ind.stemme.agentId, 'ag_42');
    assert.equal(ind.stemme.voiceId, 'voice-da');
    assert.equal(ind.stemme.toolIds?.['udfoer'], 't1');
    const page = await (await sut.app.request('/rum/hjem')).text();
    assert.match(page, /data-stemme="samtale"/);
    assert.match(page, /@elevenlabs\/client@1\.32\.0\/dist\/lib\.iife\.js/);
    // Henrik picks another voice in the Kø panel
    res = await json('/api/indstillinger', { stemme: { voiceId: 'abc123' } }, sut.app);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { stemme: { voiceId?: string } }).stemme.voiceId, 'abc123');
  });
});

test('a key without voices_read: Lyt still works with the default voice, and the library is not retried per call', async () => {
  let libraryCalls = 0;
  let usedVoice = '';
  const stub: StemmeClient = {
    ...createFakeStemme(),
    ensureVoice: async (v) => { if (v) return v; libraryCalls++; throw new StemmeError('ElevenLabs stemmebibliotek 401: missing voices_read', 502); },
    sig: async (tekst, voiceId) => { usedVoice = voiceId; return createFakeStemme().sig(tekst, voiceId); },
  };
  await withApp(stub, async (sut) => {
    for (let i = 0; i < 2; i++) {
      const res = await json('/api/stemme/sig', { tekst: 'Hej Henrik.' }, sut.app);
      assert.equal(res.status, 200, await res.text());
    }
    assert.equal(usedVoice, DEFAULT_VOICE_ID);
    assert.equal(libraryCalls, 1, 'the failed library lookup is remembered for the process');
    const ind = (await (await sut.app.request('/api/indstillinger')).json()) as { stemme: { voiceId?: string } };
    assert.equal(ind.stemme.voiceId, undefined, 'the fallback is not persisted, so a later permission grant retries the library');
  });
});

test('oversigt begins with the top card\'s titel (up to three, by prioritet) and leaves punkter unchanged', async () => {
  await withApp(createFakeStemme(), async (sut, dir) => {
    const store = createFileStore(path.join(dir, 'data'));
    const kort = (id: string, titel: string, prioritet: number) => ({ id, type: 'familie', titel, betyder: 'x', grundlag: [], kilder: [], anbefaling: `Gør ${titel}.`, prioritet });
    const foer = (await (await sut.app.request('/api/stemme/oversigt')).json()) as { tekst: string; punkter: unknown[] };
    assert.doesNotMatch(foer.tekst, /Kuratoren/, 'no cards → text unchanged');
    await store.writeState('hjem', { kort: [kort('a', 'Fjerde', 6), kort('b', 'Første', 1), kort('c', 'Tredje', 3), kort('d', 'Anden', 2)], intet: [], afvist: [], sete: [] });
    const o = (await (await sut.app.request('/api/stemme/oversigt')).json()) as { tekst: string; punkter: unknown[] };
    const linjer = o.tekst.split('\n');
    assert.equal(linjer[0], 'Kuratoren har 4 kort til dig.');
    assert.deepEqual(linjer.slice(1, 4), ['Første: Gør Første.', 'Anden: Gør Anden.', 'Tredje: Gør Tredje.']);
    assert.doesNotMatch(o.tekst, /Fjerde/);
    assert.equal(linjer[4], foer.tekst.split('\n')[0], 'the rooms text follows');
    assert.deepEqual(o.punkter, foer.punkter);
    await store.writeState('hjem', { kort: [kort('a', 'Eneste', 2)], intet: [], afvist: [], sete: [] });
    assert.match((await (await sut.app.request('/api/stemme/oversigt')).json() as { tekst: string }).tekst, /^Kuratoren har ét kort til dig\.\nEneste: Gør Eneste\./);
  });
});
