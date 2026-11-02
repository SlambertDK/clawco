// KC-0151 test world for the car flow: a household of four (Henrik and Rikke own both cars, Maja the big one, Ella is a
// child), a fake Hermes whose chat answer the test scripts, and helpers that wait until every run is done.

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/server.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { skrivHusstand } from '../../src/identitet/husstand.ts';
import type { AgentRunRequest } from '../../src/agent/types.ts';
import { TOM_HUSSTAND, type HusstandState } from '../../src/hushold/schema.ts';
import { FAMILIE } from '../../src/testtilstand/familie.ts';

export const START = new Date('2026-11-02T08:00:00Z'); // Monday 09.00 in Copenhagen
export const LOERDAG = '2026-11-07';
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const person = <R extends string>(p: { id: string; navn: string }, rolle: R) => ({ id: p.id, login: `${p.id}@example.com`, navn: p.navn, rolle });
export const HENRIK = person(FAMILIE.ejer, 'ejer' as const);
export const RIKKE = person(FAMILIE.partner, 'medlem' as const);
export const MAJA = person(FAMILIE.medlem, 'medlem' as const);
export const ELLA = person(FAMILIE.yngste, 'barn' as const);
export type Hvem = typeof HENRIK | typeof RIKKE | typeof MAJA | typeof ELLA;

/** Hermes' suggestion for a clash: the app's own order stays (the small car first). */
export const FORSLAG_V1 = '```json\n{"foerste":"v1","anbefaling":"Rikke har kursus; den lille bil er fri."}\n```';
export const booking = (o: { ressource?: string; start: string; slut: string; titel?: string; [k: string]: unknown }, tekst = 'Her er et kort.'): string =>
  `${tekst}\n\`\`\`json\n${JSON.stringify({ booking: { ressource: 'stor-bil', titel: 'Indkøb', ...o } })}\n\`\`\``;
/** Saturday in Copenhagen wall time. */
export const lordag = (fra: string, til: string, ressource = 'stor-bil', titel = 'Indkøb') => ({ ressource, start: `${LOERDAG}T${fra}`, slut: `${LOERDAG}T${til}`, titel });

export const SEED: HusstandState = {
  ...TOM_HUSSTAND,
  ressourcer: [
    { id: 'stor-bil', navn: 'Den store bil', slags: 'bil', ejere: ['henrik', 'rikke', 'maja'], kalender: [] },
    { id: 'lille-bil', navn: 'Den lille bil', slags: 'bil', ejere: ['henrik', 'rikke'], kalender: [] },
  ],
};

export async function lavBil(rod: string, navn: string, o: { chat?: string | ((req: AgentRunRequest) => string); seed?: HusstandState } = {}) {
  const dataDir = path.join(rod, navn);
  await skrivHusstand(dataDir, { personer: [HENRIK, RIKKE, MAJA, ELLA] });
  const store = createFileStore(dataDir);
  await store.writeState('husstand', o.seed ?? SEED);
  await writeFile(path.join(dataDir, 'indstillinger.json'), JSON.stringify({ modeller: { lille: 'model-lille', taenker: 'model-taenker' } }));
  const kald: AgentRunRequest[] = [];
  let chatSvar = o.chat ?? 'Okay.';
  const a = createApp({
    store, sourceGlob: '/nonexistent/{date}.json', dataDir, sha: 'abc', now: () => START,
    hermes: createFakeAgent({
      answer: (req) => {
        kald.push(req);
        if (req.instructions.includes('har booket den samme ting')) return FORSLAG_V1;
        if (req.instructions.includes('med en forespørgsel')) return '```json\n{"alternativer":[]}\n```';
        return typeof chatSvar === 'function' ? chatSvar(req) : chatSvar;
      },
    }),
    mailRunner: async () => ({ code: 1, stdout: '', stderr: 'ingen' }), mailStateDir: '/nonexistent',
  });
  const req = (p: Hvem, sti: string, init: RequestInit = {}) =>
    a.app.request(sti, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), 'Tailscale-User-Login': p.login, 'content-type': 'application/json' } }, LOOPBACK);
  const stille = async (): Promise<void> => {
    for (let i = 0; i < 200 && a.runs.list().some((r) => r.status === 'queued' || r.status === 'running'); i++) await new Promise((r) => setTimeout(r, 10));
  };
  const side = async (p: Hvem, sti = '/rum/husstand') => (await req(p, sti)).text();
  const aktion = async (p: Hvem, navn: string, body: Record<string, unknown>, medJa = false) => {
    let b = body;
    if (medJa) {
      const ja = (await (await req(p, '/api/graense/ja', { method: 'POST', body: JSON.stringify({ rum: 'husstand', slags: 'aktion', id: navn, body }) })).json()) as { ja: string };
      b = { ...body, ja: ja.ja };
    }
    const res = await req(p, `/api/rum/husstand/aktion/${navn}`, { method: 'POST', body: JSON.stringify(b) });
    const j = (await res.json()) as { runId?: string; error?: string };
    if (j.runId) await a.runs.get(j.runId)?.finished;
    await stille();
    return { status: res.status, ...j };
  };
  /** A sentence in the Husstand chat, answered by the scripted Hermes; resolves when every run it started is done. */
  const sig = async (p: Hvem, besked: string, svar?: string | ((req: AgentRunRequest) => string)) => {
    if (svar !== undefined) chatSvar = svar;
    const res = await req(p, '/api/rum/husstand/chat', { method: 'POST', body: JSON.stringify({ besked }) });
    const j = (await res.json()) as { runId?: string };
    if (j.runId) await a.runs.get(j.runId)?.finished;
    await stille();
    return res.status;
  };
  const fortryd = async (p: Hvem, logId: string) => {
    const res = await req(p, `/api/rum/husstand/log/${logId}/fortryd`, { method: 'POST', body: '{}' });
    if (res.status === 202) await a.runs.get(((await res.json()) as { runId: string }).runId)?.finished;
    await stille();
    return res.status;
  };
  const state = async () => (await store.readState<HusstandState>('husstand'))!;
  const log = async () => store.readLog('husstand', 200);
  const kalender = async (id = 'stor-bil') => (await state()).ressourcer.find((r) => r.id === id)!.kalender;
  return { ...a, store, req, side, aktion, sig, fortryd, state, log, kald, kalender, stille };
}

export type BilApp = Awaited<ReturnType<typeof lavBil>>;
export const nyRod = (): Promise<string> => mkdtemp(path.join(tmpdir(), 'kc-bil-'));
