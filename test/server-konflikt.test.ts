// KC-0152 end to end: the Saturday conflict through createApp. Tuesday 07.30 Clawco reads the coming weekend: when
// both adults are busy at the same time and a child is at home, ONE card with the same content goes to both and to
// nobody else; a pick becomes a request to the other (KC-0149) and decides nothing; a no re-opens the card, a yes
// settles it. Calendars are read busy-only unless the owner shares titles (KC-0142's rule) — a private title and an
// event body never reach the card, the prompt or the state. Nothing is sent outside the app.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { skrivHusstand } from '../src/identitet/husstand.ts';
import type { AgentRunRequest } from '../src/agent/types.ts';
import type { HusstandState } from '../src/hushold/schema.ts';
import { TOM_HUSSTAND } from '../src/hushold/schema.ts';
import type { Kilde, Laesning } from '../src/kilder/types.ts';
import type { KilderKonfig } from '../src/kilder/register.ts';
import { parseKonfliktPlan } from '../src/scheduler.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-srv-konflikt-'));
after(() => rm(rod, { recursive: true, force: true }));

const TIRSDAG = new Date('2026-11-03T06:30:00Z'); // Tuesday 07.30 in Copenhagen
const MANDAG = new Date('2026-11-02T06:30:00Z');
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const HENRIK = { id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' as const };
const RIKKE = { id: 'rikke', login: 'rikke@example.com', navn: 'Rikke', rolle: 'medlem' as const };
const NORA = { id: 'nora', login: 'nora@example.com', navn: 'Nora', rolle: 'barn' as const };
const FARMOR = { id: 'farmor', login: 'farmor@example.com', navn: 'Farmor', rolle: 'gaest' as const };
type Hvem = typeof HENRIK | typeof RIKKE | typeof NORA | typeof FARMOR;
const PLAN = parseKonfliktPlan('07:30')!;

const kalender = (id: string, zone: Kilde['zone'], events: Record<string, unknown>[]): Kilde => {
  const l: Laesning = { slags: 'kalender', hentet: TIRSDAG.toISOString(), uklar: true, data: { generated: TIRSDAG.toISOString(), days: [{ date: '2026-11-07', events }], errors: [] } };
  return { id, navn: id, slags: 'kalender', zone, auth: 'local', read: async () => l, kort: async () => ({ titel: id, tekst: '', felter: [], handling: 'Forbind' }), helbred: async () => ({ status: 'ok' }) };
};
const hændelse = (id: string, title: string, fra: string, til: string) =>
  ({ id, title, start: `2026-11-07T${fra}:00+01:00`, end: `2026-11-07T${til}:00+01:00`, all_day: false, description: 'HEMMELIG BRØDTEKST' });
const REGEL = '# Regler\n\nnaeste-id: R-0002\n\n## R-0001 · Del titler i husstanden\n- trin: 1\n- gaelder: kalender / del titel i husstanden\n- oprindelse: haand 2026-11-01\n- status: aktiv\n\nDel kun titlen, aldrig brødteksten.\n';

const GOD = '```json\n{"resume":"Lørdag er Henrik væk 9 til 14, og Rikke 11 til 13.","spoergsmaal":"Hvem er hos Nora?"}\n```';
const DAARLIG = '```json\n{"resume":"Du er væk, Henrik og Rikke.","spoergsmaal":"Hvem har du Nora?"}\n```';

async function lav(navn: string, o: { svar?: string; delTitler?: boolean; personer?: Hvem[]; kalendere?: Kilde[]; now?: Date } = {}) {
  const dataDir = path.join(rod, navn);
  await skrivHusstand(dataDir, { personer: o.personer ?? [HENRIK, RIKKE, NORA, FARMOR] });
  const kalendere = o.kalendere ?? [
    kalender('henrik-kal', 'privat', [hændelse('e1', 'Cykeltur', '09:00', '14:00')]),
    kalender('rikke-kal', 'arbejde', [hændelse('e2', 'Kaffe med Signe', '11:00', '13:00')]),
  ];
  const konfig: KilderKonfig = { kilder: kalendere.map((k, i) => ({ id: k.id, status: 'forbundet', zone: k.zone, valg: {}, tid: TIRSDAG.toISOString(), af: i === 1 ? 'rikke' : 'henrik' })) };
  await writeFile(path.join(dataDir, 'kilder.json'), JSON.stringify(konfig));
  await writeFile(path.join(dataDir, 'indstillinger.json'), JSON.stringify({ modeller: { lille: 'model-lille', taenker: 'model-taenker' } }));
  const vault = path.join(rod, `${navn}-vault`);
  if (o.delTitler) { await mkdir(path.join(vault, 'Clawco'), { recursive: true }); await writeFile(path.join(vault, 'Clawco', 'regler.md'), REGEL); }
  const store = createFileStore(dataDir);
  const kald: AgentRunRequest[] = [];
  let nu = o.now ?? TIRSDAG;
  const mailKald: string[] = [];
  const a = createApp({
    store, hermes: createFakeAgent({ answer: (req) => { kald.push(req); return req.instructions.includes('weekendkort') ? (o.svar ?? 'Intet at tilføje.') : '```json\n{"anbefaling":"Ok","alternativer":[]}\n```'; } }),
    sourceGlob: '/nonexistent/{date}.json', dataDir, sha: 'abc', now: () => nu, kilder: kalendere, ...(o.delTitler ? { vaultDir: vault } : {}),
    mailRunner: async (...x: unknown[]) => { mailKald.push(String(x)); return { code: 1, stdout: '', stderr: 'ingen' }; }, mailStateDir: '/nonexistent',
  });
  const req = (p: Hvem, sti: string, init: RequestInit = {}) =>
    a.app.request(sti, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), 'Tailscale-User-Login': p.login, 'content-type': 'application/json' } }, LOOPBACK);
  const side = async (p: Hvem, sti = '/rum/husstand') => (await req(p, sti)).text();
  const aktion = async (p: Hvem, navn: string, body: Record<string, unknown>) => {
    const ja = (await (await req(p, '/api/graense/ja', { method: 'POST', body: JSON.stringify({ rum: 'husstand', slags: 'aktion', id: navn, body }) })).json()) as { ja: string };
    const res = await req(p, `/api/rum/husstand/aktion/${navn}`, { method: 'POST', body: JSON.stringify({ ...body, ja: ja.ja }) });
    const j = (await res.json()) as { runId?: string; error?: string };
    if (j.runId) await a.runs.get(j.runId)?.finished;
    return { status: res.status, ...j };
  };
  const tjek = async () => { const r = await a.konfliktTik(PLAN); for (const x of r?.runs ?? []) await x.finished; return r; };
  const state = async () => (await store.readState<HusstandState>('husstand')) ?? TOM_HUSSTAND;
  return { ...a, req, side, aktion, tjek, state, kald, mailKald, saetNu: (d: Date) => { nu = d; }, store };
}
type App = Awaited<ReturnType<typeof lav>>;

/** The card as the page draws it (one article), or null. */
const kortHtml = (h: string): string | null => /<article class="card kort konflikt"[\s\S]*?<\/article>/.exec(h)?.[0] ?? null;

test('Tuesday 07.30: ONE card, the same markup for both adults, nothing for the child or a guest; private titles stay private', async () => {
  const a = await lav('et-kort');
  const r = await a.tjek();
  assert.equal(r?.nye.length, 1);
  const s = await a.state();
  assert.equal(s.konflikter.length, 1);
  assert.deepEqual(s.konflikter[0]!.parter, ['henrik', 'rikke']);
  const henrik = kortHtml(await a.side(HENRIK)), rikke = kortHtml(await a.side(RIKKE));
  assert.ok(henrik && rikke);
  assert.equal(henrik, rikke, 'same content for both');
  assert.match(henrik, /Lørdag: Henrik er optaget 9 til 14, Rikke er optaget 11 til 13\./);
  assert.match(henrik, /Hvem har Nora\?/);
  assert.equal(kortHtml(await a.side(NORA)), null, 'a third member sees nothing');
  assert.equal((await a.req(FARMOR, '/rum/husstand')).status, 404, 'a guest has no Husstanden');
  const alt = JSON.stringify(s) + henrik + a.kald.map((k) => k.input + k.instructions).join('');
  assert.doesNotMatch(alt, /Cykeltur|Kaffe med Signe|HEMMELIG/, 'neither a private title nor a body leaves the calendars');
});

test('the owner who shares titles (KC-0142) shows hers; the other stays busy-only', async () => {
  const a = await lav('del-titel', { delTitler: true });
  await a.tjek();
  const h = kortHtml(await a.side(RIKKE))!;
  assert.match(h, /Henrik har Cykeltur 9 til 14, Rikke er optaget 11 til 13\./);
  assert.doesNotMatch(await a.side(RIKKE), /Kaffe med Signe|HEMMELIG/);
});

test('an event in the husstand zone shows its title', async () => {
  const a = await lav('husstand-zone', { kalendere: [
    kalender('familie', 'husstand', [{ ...hændelse('e1', 'Ellas klassefest', '09:00', '14:00'), attendees: [{ email: 'henrik@example.com' }] }, { ...hændelse('e3', 'Kirkekaffe', '11:00', '13:00'), attendees: [{ email: 'rikke@example.com' }] }]),
  ] });
  await a.tjek();
  assert.match(kortHtml(await a.side(HENRIK))!, /Henrik har Ellas klassefest 9 til 14, Rikke har Kirkekaffe 11 til 13\./);
});

test('no child (or nothing to cover): no card at all', async () => {
  const a = await lav('ingen-barn', { personer: [HENRIK, RIKKE] });
  const r = await a.tjek();
  assert.equal(r?.nye.length, 0);
  assert.equal((await a.state()).konflikter.length, 0);
  assert.equal(kortHtml(await a.side(HENRIK)), null);
});

test('the check runs once per weekend, also after a restart, and only on a Tuesday', async () => {
  const a = await lav('en-gang');
  a.saetNu(MANDAG);
  assert.equal(await a.tjek(), null, 'Monday: not due');
  assert.equal((await a.state()).konflikter.length, 0);
  a.saetNu(TIRSDAG);
  assert.equal((await a.tjek())?.nye.length, 1);
  assert.equal((await a.tjek())?.nye.length ?? 0, 0, 'again the same Tuesday: nothing new');
  assert.equal((await a.state()).konfliktTjek, '2026-11-07');
  assert.equal((await a.state()).konflikter.length, 1);
  const b = await lav('en-gang'); // a fresh process over the same data dir
  assert.equal((await b.tjek())?.nye.length ?? 0, 0);
  assert.equal((await b.state()).konflikter.length, 1);
});

test('no calendar read at all: nothing is marked as checked, so a later tick still looks', async () => {
  const a = await lav('ingen-kalender', { kalendere: [] });
  assert.equal((await a.tjek())?.nye.length ?? 0, 0);
  assert.equal((await a.state()).konfliktTjek, undefined);
});

test('Hermes phrases the card (taenker tier); a good block is shown to both, a bad one writes nothing', async () => {
  const god = await lav('hermes-god', { svar: GOD });
  await god.tjek();
  assert.ok(god.kald.some((k) => k.model === 'model-taenker' && k.instructions.includes('weekendkort')), 'taenker tier');
  const h = kortHtml(await god.side(RIKKE))!;
  assert.equal(h, kortHtml(await god.side(HENRIK)));
  assert.match(h, /Lørdag er Henrik væk 9 til 14, og Rikke 11 til 13\./);
  assert.match(h, /Hvem er hos Nora\?/);
  const daarlig = await lav('hermes-daarlig', { svar: DAARLIG });
  await daarlig.tjek();
  assert.equal((await daarlig.state()).konflikter[0]!.tekst, undefined, 'a bad block writes nothing');
  assert.match(kortHtml(await daarlig.side(HENRIK))!, /Hvem har Nora\?/, 'the fixed words stay');
});

async function medKort(navn: string): Promise<App> { const a = await lav(navn); await a.tjek(); return a; }
const kortId = async (a: App) => (await a.state()).konflikter[0]!.id;

test('a pick is a request to the other person: one request, a red tap that decides nothing', async () => {
  const a = await medKort('valg');
  const id = await kortId(a);
  const r = await a.aktion(HENRIK, 'konflikt-valg', { id, valg: 'v2' }); // "Rikke tager Nora"
  assert.equal(r.status, 202, r.error);
  const s = await a.state();
  assert.equal(s.forespoergsler.length, 1);
  const f = s.forespoergsler[0]!;
  assert.deepEqual([f.fra, f.til, f.tilstand], ['henrik', 'rikke', 'spurgt']);
  assert.equal(f.titel, 'Kan du tage Nora lørdag kl. 11.00–13.00?');
  assert.equal(f.ressourceId, undefined, 'it never books anything');
  assert.equal(s.konflikter[0]!.forespId, f.id);
  assert.equal(s.ressourcer.length, 0);
  // Waiting: both see the card without options and their own line; Rikke's Nu holds the request.
  const henrik = kortHtml(await a.side(HENRIK))!, rikke = kortHtml(await a.side(RIKKE))!;
  assert.doesNotMatch(henrik, /data-konflikt-valg/);
  assert.match(henrik, /Du har spurgt Rikke/);
  assert.match(rikke, /Henrik har spurgt dig/);
  assert.match(await a.side(RIKKE, '/rum/hjem'), /Henrik spørger: Kan du tage Nora/);
  assert.equal((await a.aktion(HENRIK, 'konflikt-valg', { id, valg: 'v1' })).status, 409, 'already asked');
  assert.equal((await a.aktion(RIKKE, 'konflikt-valg', { id, valg: 'v1' })).status, 409, 'the other cannot pick while it waits');
  assert.equal((await a.state()).forespoergsler.length, 1, 'still exactly one request');
});

test('"Henrik tager Nora" asks Rikke to agree, and "Find en tredje" asks to find someone', async () => {
  const a = await medKort('valg-andre');
  const id = await kortId(a);
  assert.equal((await a.aktion(HENRIK, 'konflikt-valg', { id, valg: 'v1' })).status, 202);
  assert.equal((await a.state()).forespoergsler[0]!.titel, 'Jeg tager Nora lørdag kl. 11.00–13.00. Passer det?');
  const b = await medKort('valg-tredje');
  assert.equal((await b.aktion(RIKKE, 'konflikt-valg', { id: await kortId(b), valg: 'v3' })).status, 202);
  const f = (await b.state()).forespoergsler[0]!;
  assert.deepEqual([f.fra, f.til], ['rikke', 'henrik']);
  assert.equal(f.titel, 'Kan vi finde en tredje til Nora lørdag kl. 11.00–13.00?');
});

test('a no re-opens the card; a yes settles it for both', async () => {
  const a = await medKort('nej-ja');
  const id = await kortId(a);
  await a.aktion(HENRIK, 'konflikt-valg', { id, valg: 'v2' });
  const fid = (await a.state()).forespoergsler[0]!.id;
  assert.equal((await a.aktion(RIKKE, 'svar', { id: fid, svar: 'nej' })).status, 202);
  for (const p of [HENRIK, RIKKE]) assert.match(kortHtml(await a.side(p))!, /data-konflikt-valg="v1"/, 'the options are back');
  assert.equal((await a.aktion(RIKKE, 'konflikt-valg', { id, valg: 'v1' })).status, 202, 'and a new pick is possible');
  const fid2 = (await a.state()).forespoergsler.find((f) => f.id !== fid)!.id;
  assert.equal((await a.aktion(HENRIK, 'svar', { id: fid2, svar: 'ja' })).status, 202);
  for (const p of [HENRIK, RIKKE]) assert.equal(kortHtml(await a.side(p)), null, 'settled: the card is gone');
});

test('a person who is not a party cannot pick (403), nor a guest (403); an unknown card or option is refused', async () => {
  const a = await medKort('ikke-part');
  const id = await kortId(a);
  assert.equal((await a.aktion(NORA, 'konflikt-valg', { id, valg: 'v1' })).status, 403);
  assert.equal((await a.aktion(FARMOR, 'konflikt-valg', { id, valg: 'v1' })).status, 403, 'a guest may only read');
  assert.equal((await a.aktion(HENRIK, 'konflikt-valg', { id: 'k-findes-ikke', valg: 'v1' })).status, 404);
  assert.equal((await a.aktion(HENRIK, 'konflikt-valg', { id, valg: 'v9' })).status, 400);
  assert.equal((await a.state()).forespoergsler.length, 0);
});

test('Nu: both adults get the card in Kræver dig; nobody else does', async () => {
  const a = await medKort('nu');
  assert.match(await a.side(HENRIK, '/rum/hjem'), /Weekend: Hvem har Nora\?/);
  assert.match(await a.side(RIKKE, '/rum/hjem'), /Weekend: Hvem har Nora\?/);
  assert.doesNotMatch(await a.side(NORA, '/rum/hjem'), /Weekend: Hvem har Nora/);
});

test('nothing leaves the app: no mail, and Hermes only phrased the card and suggested answers', async () => {
  const a = await medKort('intet-ud');
  await a.aktion(HENRIK, 'konflikt-valg', { id: await kortId(a), valg: 'v2' });
  assert.deepEqual(a.mailKald, []);
  assert.ok(a.kald.every((k) => k.instructions.includes('weekendkort') || k.instructions.includes('forespørgsel')), 'only those two kinds of run');
});
