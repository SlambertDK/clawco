// KC-0170 slice 3, Husstanden (part E): one run through every action of the room that writes a line to the log, answers
// with a text or refuses with a message, in a given language of the install. `kor(sprog)` returns what the person
// would read, one line per text, in a fixed order. test/fixtures/sprog-husstand-handlinger/da.json was captured from
// this run BEFORE the strings moved into src/hushold/tekster.ts (so it is Danish byte for byte as it was);
// en.json is the English run, reviewed by hand. The clock (a.tikNu, the Saturday check) runs inside `medSprog`, as
// the composition root should run it. Names, titles and calendar words are English on purpose in both languages.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/server.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { skrivHusstand, type Person } from '../../src/identitet/husstand.ts';
import { lavProfilLager } from '../../src/store/profil.ts';
import { lavFakeKanal } from '../../src/hushold/kanal.ts';
import { medSprog, type Sprog } from '../../src/store/sprog.ts';
import { parseKonfliktPlan } from '../../src/scheduler.ts';
import type { HusstandState } from '../../src/hushold/schema.ts';
import { TOM_HUSSTAND } from '../../src/hushold/schema.ts';
import type { Kilde, Laesning } from '../../src/kilder/types.ts';
import type { KilderKonfig } from '../../src/kilder/register.ts';
import type { AgentRunRequest } from '../../src/agent/types.ts';
import type { RoomDeps } from '../../src/rooms/module.ts';
import { internMedlem } from '../../src/hushold/room.ts';

const START = new Date('2026-11-02T08:00:00Z'); // Monday 09.00 in Copenhagen
const TIRSDAG = new Date('2026-11-03T06:30:00Z'); // Tuesday 07.30
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const person = <R extends Person['rolle']>(id: string, navn: string, rolle: R): Person => ({ id, login: `${id}@example.com`, navn, rolle });
const HENRIK = person('henrik', 'Henrik', 'ejer');
const RIKKE = person('rikke', 'Rikke', 'medlem');
const MAJA = person('maja', 'Maja', 'medlem');
const ELLA = person('ella', 'Ella', 'barn');
const NORA = person('nora', 'Nora', 'barn');
type Hvem = Person;
const MAJA_TG = '100000001';

/** The things in the house: Danish names in a Danish install, English in an English one. */
const NAVNE = { da: { stor: 'Den store bil', lille: 'Den lille bil' }, en: { stor: 'The big car', lille: 'The little car' } } as const;
const seed = (sprog: Sprog): HusstandState => ({
  ...TOM_HUSSTAND,
  ressourcer: [
    { id: 'stor-bil', navn: NAVNE[sprog].stor, slags: 'bil', ejere: ['henrik', 'rikke', 'maja'], kalender: [] },
    { id: 'lille-bil', navn: NAVNE[sprog].lille, slags: 'bil', ejere: ['henrik', 'rikke'], kalender: [] },
  ],
  medlemmer: [{ id: 'maja', navn: 'Maja', rolle: 'medlem', kanal: { kanal: 'telegram', handle: MAJA_TG, status: 'aktiv' } }],
});

type Verden = Awaited<ReturnType<typeof lavVerden>>;

async function lavVerden(rod: string, navn: string, sprog: Sprog, o: { personer?: Person[]; svar?: (req: AgentRunRequest) => string; kalendere?: Kilde[] } = {}) {
  const dataDir = path.join(rod, navn);
  await mkdir(dataDir, { recursive: true });
  await skrivHusstand(dataDir, { personer: o.personer ?? [HENRIK, RIKKE, MAJA, ELLA] });
  await lavProfilLager(dataDir).skriv({ navn: 'Henrik', sprog, husstand: 'husstand' });
  await writeFile(path.join(dataDir, 'indstillinger.json'), JSON.stringify({ modeller: { lille: 'model-lille', taenker: 'model-taenker' } }));
  if (o.kalendere) {
    const konfig: KilderKonfig = { kilder: o.kalendere.map((k, i) => ({ id: k.id, status: 'forbundet', zone: k.zone, valg: {}, tid: TIRSDAG.toISOString(), af: i === 1 ? 'rikke' : 'henrik' })) };
    await writeFile(path.join(dataDir, 'kilder.json'), JSON.stringify(konfig));
  }
  const store = createFileStore(dataDir);
  await store.writeState('husstand', seed(sprog));
  let ur = START;
  const kanal = lavFakeKanal();
  const a = createApp({
    store, sourceGlob: '/nonexistent/{date}.json', dataDir, sha: 'abc', now: () => ur, kanal, ...(o.kalendere ? { kilder: o.kalendere } : {}),
    hermes: createFakeAgent({
      answer: (req) => {
        if (o.svar) return o.svar(req);
        if (req.instructions.includes('har booket den samme ting')) return '```json\n{"foerste":"v1","anbefaling":"Rikke has a course; the little car is free."}\n```';
        return '```json\n{"alternativer":[]}\n```';
      },
    }),
    mailRunner: async () => ({ code: 1, stdout: '', stderr: 'none' }), mailStateDir: '/nonexistent',
  });
  const req = (p: Hvem, sti: string, init: RequestInit = {}) =>
    a.app.request(sti, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), 'Tailscale-User-Login': p.login!, 'content-type': 'application/json' } }, LOOPBACK);
  const post = async (p: Hvem, sti: string, body: Record<string, unknown>) => {
    const res = await req(p, sti, { method: 'POST', body: JSON.stringify(body) });
    const j = (await res.json()) as { runId?: string; error?: string; ja?: string };
    let tekst: string | undefined;
    if (j.runId) { const r = await a.runs.get(j.runId)?.finished; tekst = r?.result?.text; }
    await stille();
    return { status: res.status, error: j.error, tekst, ja: j.ja };
  };
  const stille = async (): Promise<void> => {
    for (let i = 0; i < 200 && a.runs.list().some((r) => r.status === 'queued' || r.status === 'running'); i++) await new Promise((r) => setTimeout(r, 10));
  };
  const ja = async (p: Hvem, rum: string, slags: string, id: string, body?: Record<string, unknown>): Promise<string | undefined> =>
    (await post(p, '/api/graense/ja', { rum, slags, id, ...(body ? { body } : {}) })).ja;
  const aktion = async (p: Hvem, navn: string, body: Record<string, unknown>, medJa = false) =>
    post(p, `/api/rum/husstand/aktion/${navn}`, medJa ? { ...body, ja: await ja(p, 'husstand', 'aktion', navn, body) } : body);
  const sig = async (p: Hvem, besked: string) => post(p, '/api/rum/husstand/chat', { besked });
  const state = async () => (await store.readState<HusstandState>('husstand')) ?? TOM_HUSSTAND;
  const side = async (p: Hvem, sti = '/rum/husstand') => (await req(p, sti)).text();
  /** The id the Send button asks a yes for, as the asker's page carries it. */
  const sendJaId = async (p: Hvem, id: string, slags: string): Promise<string> =>
    new RegExp(`data-kanal-send="${id}" data-kanal-slags="${slags}" data-kanal-ja="([^"]+)"`).exec(await side(p))?.[1] ?? `${id}:${slags}:-`;
  const send = async (p: Hvem, id: string, slags: 'foresp' | 'paamindelse' = 'foresp') =>
    post(p, `/api/hushold/foresp/${id}/send`, { ...(slags === 'paamindelse' ? { slags } : {}), ja: await ja(p, 'husstand', 'send', await sendJaId(p, id, slags)) });
  const inviterJaId = async (p: Hvem, id: string): Promise<string> =>
    new RegExp(`data-invitation-send="${id}" data-invitation-ja="([^"]+)"`).exec(await side(p))?.[1] ?? `${id}:invitation:-`;
  const sendInvitation = async (p: Hvem, id: string) => post(p, `/api/hushold/medlem/${id}/inviter`, { ja: await ja(p, 'husstand', 'invitation', await inviterJaId(p, id)) });
  const fortryd = async (p: Hvem, logId: string) => post(p, `/api/rum/husstand/log/${logId}/fortryd`, {});
  const log = async () => store.readLog('husstand', 200);
  /** The newest log line of a person that can still be undone, with a marker (and, when given, a word in its text). */
  const fortrydbar = async (ejer: string, markoer: string, ord = ''): Promise<string> =>
    (await log()).find((e) => e.ejer === ejer && e.fortryd?.startsWith(markoer) && !e.fortrudt && e.tekst.includes(ord))?.id ?? 'ingen';
  const tik = async (): Promise<void> => { await medSprog(sprog, () => a.tikNu()); await stille(); };
  const konfliktTik = async () => { const r = await medSprog(sprog, () => a.konfliktTik(parseKonfliktPlan('07:30')!)); for (const x of r?.runs ?? []) await x.finished; await stille(); return r; };
  return { ...a, store, req, post, ja, aktion, sig, state, side, send, sendInvitation, fortryd, log, fortrydbar, kanal, saetUr: (d: Date) => { ur = d; }, ur: () => ur, tik, konfliktTik, sprog };
}

const LOERDAG = '2026-11-07';
const KL = (fra: string, til: string, dag = LOERDAG) => ({ dag, start: fra, slut: til });

/** One line per text the person read. `hvad` says which step; every line is `<hvad> | <who or kind>: <text>`. */
type Rapport = string[];
const fejlEllerTekst = (r: { status: number; error?: string | undefined; tekst?: string | undefined }): string => (r.error ? `${r.status} ${r.error}` : `${r.status} ${r.tekst ?? '(no text)'}`);

/** The log lines of a world, one per line: who they are for, whether Fortryd is on them, the text. */
async function logLinjer(a: Verden, hvad: string): Promise<Rapport> {
  const l = await a.log();
  return [...l].sort((x, y) => (x.ejer ?? '').localeCompare(y.ejer ?? '') || x.tekst.localeCompare(y.tekst)).map((e) => `${hvad} | log ${e.ejer}${e.fortryd ? ' (fortryd)' : ''}${e.fortrudt ? ' (fortrudt)' : ''}: ${e.tekst}`);
}
/** The text of the runs Hermes was asked for (suggestions), by kind and counted: what the Kø panel shows. */
const runTekster = (a: Verden, hvad: string, arter: string[]): Rapport => {
  const n = new Map<string, number>();
  for (const r of a.runs.list().filter((x) => arter.includes(x.kind))) { const k = `${hvad} | run ${r.kind}: ${r.result?.text ?? '(no text)'}`; n.set(k, (n.get(k) ?? 0) + 1); }
  return [...n].map(([k, c]) => `${k} (x${c})`).sort();
};

// ---- the scenarios --------------------------------------------------------------------------------------------------

type Svar = { status: number; error?: string | undefined; tekst?: string | undefined };
const bogfoer = (r: Rapport) => (hvad: string, x: Svar): Svar => { r.push(`${hvad} | ${fejlEllerTekst(x)}`); return x; };

/** Requests: asking, answering, withdrawing, undoing, refusals and the clock's expiry. */
async function foresporgsler(rod: string, sprog: Sprog): Promise<Rapport> {
  const a = await lavVerden(rod, `foresp-${sprog}`, sprog, { personer: [HENRIK, RIKKE, MAJA, ELLA] });
  const r: Rapport = [];
  const bog = bogfoer(r);
  const sp = (hvad: string, p: Hvem, navn: string, body: Record<string, unknown>, medJa = false) => a.aktion(p, navn, body, medJa).then((x) => bog(hvad, x));
  const id = async (n: number): Promise<string> => (await a.state()).forespoergsler[n]!.id;

  await sp('opret med tid', HENRIK, 'opret', { til: 'rikke', titel: 'Can you pick up Ella?', ...KL('16:00', '17:00', '2026-11-05') }, true);
  await sp('svar: andet tidspunkt', RIKKE, 'svar', { id: await id(0), svar: 'alternativ', kl: '17:30' });
  r.push(`alternativ i state: ${(await a.state()).forespoergsler[0]!.alternativ?.tekst}`);
  await sp('svar: tag imod', HENRIK, 'svar', { id: await id(0), svar: 'tag-imod' });
  bog('fortryd tag imod', await a.fortryd(HENRIK, await a.fortrydbar('henrik', 'foresp:', 'pick up Ella')) );
  await sp('opret uden tid', HENRIK, 'opret', { til: 'rikke', titel: 'Can you take out the bins?' }, true);
  await sp('svar: nej', RIKKE, 'svar', { id: await id(1), svar: 'nej' });
  await sp('opret og traek', HENRIK, 'opret', { til: 'rikke', titel: 'Can you water the plants?' }, true);
  await sp('traek', HENRIK, 'traek', { id: await id(2) });
  await sp('opret og fortryd oprettelsen', HENRIK, 'opret', { til: 'rikke', titel: 'Can you call the plumber?' }, true);
  bog('fortryd oprettelsen', await a.fortryd(HENRIK, await a.fortrydbar('henrik', 'foresp:', 'plumber')));
  await sp('opret til svar paa', HENRIK, 'opret', { til: 'rikke', titel: 'Can you feed the cat?', ...KL('10:00', '11:00', '2026-11-06') }, true);
  await sp('opret uden tid 2', HENRIK, 'opret', { til: 'rikke', titel: 'Can you lock up?' }, true);
  const tid = await id(4), uden = await id(5);

  // refusals
  await sp('fejl: ingen modtager', HENRIK, 'opret', { til: 'henrik', titel: 'x' }, true);
  await sp('fejl: tom titel', HENRIK, 'opret', { til: 'rikke', titel: ' ' }, true);
  await sp('fejl: halv tid', HENRIK, 'opret', { til: 'rikke', titel: 'x', dag: '2026-11-05' }, true);
  await sp('fejl: tid foer nu', HENRIK, 'opret', { til: 'rikke', titel: 'x', ...KL('10:00', '11:00', '2026-11-01') }, true);
  await sp('fejl: til foer fra', HENRIK, 'opret', { til: 'rikke', titel: 'x', ...KL('11:00', '10:00', '2026-11-05') }, true);
  await sp('fejl: ukendt svar', RIKKE, 'svar', { id: tid, svar: 'maaske' });
  await sp('fejl: findes ikke', RIKKE, 'svar', { id: 'f-findes-ikke', svar: 'ja' });
  await sp('fejl: ikke part', MAJA, 'svar', { id: tid, svar: 'ja' });
  await sp('fejl: ikke din tur', HENRIK, 'svar', { id: tid, svar: 'ja' });
  await sp('fejl: klokkeslaet', RIKKE, 'svar', { id: tid, svar: 'alternativ', kl: 'abc' });
  await sp('fejl: intet tidspunkt at flytte', RIKKE, 'svar', { id: uden, svar: 'alternativ', kl: '17:00' });
  await sp('fejl: drop uden udloeb', HENRIK, 'drop', { id: tid });
  await sp('fejl: svar paa afgjort', RIKKE, 'svar', { id: await id(1), svar: 'ja' });

  // the clock: everything open runs out (five days later), then the asker deals with it
  a.saetUr(new Date(START.getTime() + 5 * 24 * 3600_000));
  await a.tik();
  await sp('drop efter udloeb', HENRIK, 'drop', { id: tid });
  await sp('drop igen', HENRIK, 'drop', { id: tid });
  await sp('spoerg igen: tiden er gaaet', HENRIK, 'spoerg-igen', { id: await id(0) }, true);
  await sp('spoerg igen efter udloeb', HENRIK, 'spoerg-igen', { id: uden }, true);
  r.push(...(await logLinjer(a, 'foresp')), ...runTekster(a, 'foresp', ['forslag']));
  return r;
}

/** Things and clashes: booking, the clash card, swapping, the loan request, Fortryd. */
async function ressourcer(rod: string, sprog: Sprog): Promise<Rapport> {
  const r: Rapport = [];
  const bog = bogfoer(r);
  const kursus = (a: Verden, p: Hvem = RIKKE) => a.aktion(p, 'book', { ressourceId: 'stor-bil', ...KL('09:00', '13:00'), titel: 'Course' });
  const indkoeb = (a: Verden, p: Hvem = HENRIK) => a.aktion(p, 'book', { ressourceId: 'stor-bil', ...KL('10:00', '15:00'), titel: 'Shopping' });
  const f0 = async (a: Verden): Promise<string> => (await a.state()).forespoergsler[0]!.id;

  // 1. a clash, settled by the wisher taking the other car
  const a = await lavVerden(rod, `ress-a-${sprog}`, sprog);
  bog('rikke booker', await kursus(a));
  bog('henrik booker: sammenfald', await indkoeb(a));
  const sf = (await a.state()).sammenfald[0]!.id;
  bog('henrik booker igen: der er allerede et kort', await indkoeb(a));
  bog('henrik: tag den lille', await a.aktion(HENRIK, 'sammenfald-valg', { id: sf, valg: 'v1' }));
  bog('henrik: igen', await a.aktion(HENRIK, 'sammenfald-valg', { id: sf, valg: 'v1' }));
  r.push(...(await logLinjer(a, 'ress-a')), ...runTekster(a, 'ress-a', ['sammenfald']));

  // 2. the holder withdraws her booking while the clash is open
  const b = await lavVerden(rod, `ress-b-${sprog}`, sprog);
  await kursus(b);
  await indkoeb(b);
  bog('rikke fortryder sin booking', await b.fortryd(RIKKE, await b.fortrydbar('rikke', 'lokal:')));
  r.push(...(await logLinjer(b, 'ress-b')));

  // 3. the wisher asks the holder to take the other car; her yes moves her booking; she undoes the move
  const c = await lavVerden(rod, `ress-c-${sprog}`, sprog);
  await kursus(c);
  await indkoeb(c);
  const sfc = (await c.state()).sammenfald[0]!.id;
  bog('henrik: spoerg Rikke om at tage den lille', await c.aktion(HENRIK, 'sammenfald-spoerg', { id: sfc, valg: 'v3' }, true));
  bog('henrik: spoerg igen', await c.aktion(HENRIK, 'sammenfald-spoerg', { id: sfc, valg: 'v3' }, true));
  bog('henrik: sit eget valg som spoergsmaal', await c.aktion(HENRIK, 'sammenfald-spoerg', { id: sfc, valg: 'v1' }, true));
  bog('henrik: andens valg som direkte', await c.aktion(HENRIK, 'sammenfald-valg', { id: sfc, valg: 'v3' }));
  bog('henrik: ukendt valg', await c.aktion(HENRIK, 'sammenfald-valg', { id: sfc, valg: 'v9' }));
  bog('maja: ikke part', await c.aktion(MAJA, 'sammenfald-valg', { id: sfc, valg: 'v1' }));
  r.push(`titlen paa forespoergslen: ${(await c.state()).forespoergsler[0]!.titel}`);
  bog('rikke: ja', await c.aktion(RIKKE, 'svar', { id: await f0(c), svar: 'ja' }));
  r.push(...(await logLinjer(c, 'ress-c')));

  // 3b. the wisher asks the holder to let go; she says yes
  const c2 = await lavVerden(rod, `ress-c2-${sprog}`, sprog);
  await kursus(c2);
  await indkoeb(c2);
  const sfc2 = (await c2.state()).sammenfald[0]!.id;
  bog('henrik: spoerg Rikke om at bytte', await c2.aktion(HENRIK, 'sammenfald-spoerg', { id: sfc2, valg: 'v2' }, true));
  r.push(`titlen paa bytte: ${(await c2.state()).forespoergsler[0]!.titel}`);
  bog('rikke: ja til at give slip', await c2.aktion(RIKKE, 'svar', { id: await f0(c2), svar: 'ja' }));
  r.push(...(await logLinjer(c2, 'ress-c2')));

  // 3c. the same the other way round: Rikke wishes the slot Henrik holds and asks him to drop it; he says no
  const c3 = await lavVerden(rod, `ress-c3-${sprog}`, sprog);
  await kursus(c3, HENRIK);
  await indkoeb(c3, RIKKE);
  const sfc3 = (await c3.state()).sammenfald[0]!.id;
  bog('rikke: spoerg Henrik om at droppe', await c3.aktion(RIKKE, 'sammenfald-spoerg', { id: sfc3, valg: 'v2' }, true));
  r.push(`titlen paa drop: ${(await c3.state()).forespoergsler[0]!.titel}`);
  bog('henrik: nej', await c3.aktion(HENRIK, 'svar', { id: await f0(c3), svar: 'nej' }));
  r.push(...(await logLinjer(c3, 'ress-c3')));

  // 4. the loan request of a non-owner, and the booking refusals
  const d = await lavVerden(rod, `ress-d-${sprog}`, sprog);
  bog('henrik blokerer den lille bil', await d.aktion(HENRIK, 'book', { ressourceId: 'lille-bil', ...KL('11:00', '12:00'), titel: 'Block' }));
  bog('maja booker en ting hun ikke ejer', await d.aktion(MAJA, 'book', { ressourceId: 'lille-bil', ...KL('09:00', '10:00'), titel: 'Scouts' }));
  bog('maja spoerger om en optaget ting', await d.aktion(MAJA, 'book-spoerg', { ressourceId: 'lille-bil', ...KL('11:00', '12:00'), titel: 'Scouts' }, true));
  bog('maja spoerger om at laane', await d.aktion(MAJA, 'book-spoerg', { ressourceId: 'lille-bil', ...KL('09:00', '10:00'), titel: 'Scouts' }, true));
  r.push(`titlen paa laan: ${(await d.state()).forespoergsler[0]!.titel}`);
  bog('henrik: ja til at laane', await d.aktion(HENRIK, 'svar', { id: await f0(d), svar: 'ja' }));
  r.push(`bookingens titel: ${(await d.state()).ressourcer.find((x) => x.id === 'lille-bil')!.kalender.find((b) => b.af === 'maja')?.titel}`);
  bog('fejl: ukendt ting', await d.aktion(HENRIK, 'book', { ressourceId: 'findes-ikke', ...KL('09:00', '10:00'), titel: 'x' }));
  bog('fejl: ingen dag', await d.aktion(HENRIK, 'book', { ressourceId: 'stor-bil', titel: 'x' }));
  bog('fejl: ingen titel', await d.aktion(HENRIK, 'book', { ressourceId: 'stor-bil', ...KL('09:00', '10:00'), titel: '' }));
  bog('henrik booker', await d.aktion(HENRIK, 'book', { ressourceId: 'stor-bil', ...KL('09:00', '10:00'), titel: 'First' }));
  bog('fejl: har allerede', await d.aktion(HENRIK, 'book', { ressourceId: 'stor-bil', ...KL('09:30', '10:30'), titel: 'Second' }));
  bog('fejl: ejer spoerger', await d.aktion(HENRIK, 'book-spoerg', { ressourceId: 'stor-bil', ...KL('11:00', '12:00'), titel: 'x' }, true));
  await d.aktion(RIKKE, 'book', { ressourceId: 'stor-bil', ...KL('09:00', '11:00', '2026-11-08'), titel: 'A' });
  await d.aktion(MAJA, 'book', { ressourceId: 'stor-bil', ...KL('11:00', '13:00', '2026-11-08'), titel: 'B' });
  bog('fejl: flere bookinger i vejen', await d.aktion(HENRIK, 'book', { ressourceId: 'stor-bil', ...KL('10:00', '12:00', '2026-11-08'), titel: 'C' }));
  bog('fejl: kortet findes ikke', await d.aktion(MAJA, 'udkast-book', { id: 'u-findes-ikke' }));
  bog('fejl: kortet findes ikke (spoerg)', await d.aktion(MAJA, 'udkast-spoerg', { id: 'u-findes-ikke' }, true));
  bog('fejl: kortet findes ikke (drop)', await d.aktion(MAJA, 'udkast-drop', { id: 'u-findes-ikke' }));
  bog('fejl: sammenfald findes ikke', await d.aktion(HENRIK, 'sammenfald-valg', { id: 's-findes-ikke', valg: 'v1' }));
  bog('fejl: sammenfald-spoerg findes ikke', await d.aktion(HENRIK, 'sammenfald-spoerg', { id: 's-findes-ikke', valg: 'v1' }, true));
  r.push(...(await logLinjer(d, 'ress-d')));

  // 5. the things from the screen: add, edit, remove
  const e = await lavVerden(rod, `ress-e-${sprog}`, sprog);
  const cargo = { navn: 'Cargo bike', slags: 'bil', 'ejer-henrik': 'on' };
  bog('henrik tilfoejer', await e.aktion(HENRIK, 'tilfoej-ressource', cargo));
  bog('fejl: navnet findes', await e.aktion(HENRIK, 'tilfoej-ressource', cargo));
  bog('fejl: ingen ejer', await e.aktion(HENRIK, 'tilfoej-ressource', { navn: 'Tent', slags: 'ting' }));
  bog('fejl: intet navn', await e.aktion(HENRIK, 'tilfoej-ressource', { navn: ' ', slags: 'ting', 'ejer-henrik': 'on' }));
  bog('fejl: ukendt slags', await e.aktion(HENRIK, 'tilfoej-ressource', { navn: 'Tent', slags: 'baad', 'ejer-henrik': 'on' }));
  bog('fejl: rolle (barn)', await e.aktion(ELLA, 'tilfoej-ressource', { navn: 'Tent', slags: 'ting', 'ejer-henrik': 'on' }));
  const ret = { ressourceId: 'cargo-bike', navn: 'Cargo bike XL', slags: 'ting', 'ejer-henrik': 'on', 'ejer-rikke': 'on' };
  bog('henrik retter', await e.aktion(HENRIK, 'ret-ressource', ret));
  bog('henrik retter uden aendring', await e.aktion(HENRIK, 'ret-ressource', ret));
  bog('fejl: ret: navnet findes', await e.aktion(HENRIK, 'ret-ressource', { ...ret, navn: NAVNE[sprog].stor }));
  bog('fejl: ret: ikke ejer', await e.aktion(MAJA, 'ret-ressource', ret));
  bog('fejl: ret: findes ikke', await e.aktion(HENRIK, 'ret-ressource', { ...ret, ressourceId: 'findes-ikke' }));
  bog('rikke booker cykel', await e.aktion(RIKKE, 'book', { ressourceId: 'cargo-bike', ...KL('09:00', '10:00'), titel: 'Ride' }));
  bog('fejl: fjern: andres bookinger', await e.aktion(HENRIK, 'fjern-ressource', { ressourceId: 'cargo-bike' }, true));
  bog('fejl: fjern: ikke ejer', await e.aktion(MAJA, 'fjern-ressource', { ressourceId: 'cargo-bike' }, true));
  bog('rikke fjerner', await e.aktion(RIKKE, 'fjern-ressource', { ressourceId: 'cargo-bike' }, true));
  bog('fejl: fjern: findes ikke', await e.aktion(RIKKE, 'fjern-ressource', { ressourceId: 'cargo-bike' }, true));
  bog('henrik tilfoejer igen', await e.aktion(HENRIK, 'tilfoej-ressource', cargo));
  bog('henrik fortryder tilfoejelsen', await e.fortryd(HENRIK, await e.fortrydbar('henrik', 'lokal:{"ressource"')));
  r.push(...(await logLinjer(e, 'ress-e')));
  return r;
}

/** A sentence in the chat becomes a card, or a note that says why not. */
async function chat(rod: string, sprog: Sprog): Promise<Rapport> {
  const r: Rapport = [];
  const bog = bogfoer(r);
  let svar = '';
  const blok = (o: Record<string, string>) => `Here is a card.\n\`\`\`json\n${JSON.stringify({ booking: { ressource: 'stor-bil', titel: 'Shopping', ...o } })}\n\`\`\``;
  const a = await lavVerden(rod, `chat-${sprog}`, sprog, {
    svar: (req) => {
      if (req.instructions.includes('har booket den samme ting')) return '```json\n{"foerste":"v1"}\n```';
      if (req.instructions.includes('med en forespørgsel')) return '```json\n{"alternativer":[]}\n```';
      return svar;
    },
  });
  const sig = async (hvad: string, p: Hvem, besked: string, hermes: string) => { svar = hermes; bog(hvad, await a.sig(p, besked)); };
  await sig('kort til en ejer', MAJA, 'I need the big car on Saturday', blok({ start: `${LOERDAG}T10:00`, slut: `${LOERDAG}T15:00` }));
  await sig('kort til en der ikke ejer', MAJA, 'I need the little car on Saturday', blok({ ressource: 'lille-bil', start: `${LOERDAG}T16:00`, slut: `${LOERDAG}T17:00` }));
  const udkast = (await a.state()).udkast;
  bog('maja: boek kortet', await a.aktion(MAJA, 'udkast-book', { id: udkast.find((u) => u.ressourceId === 'stor-bil')!.id }));
  bog('maja: spoerg paa kortet', await a.aktion(MAJA, 'udkast-spoerg', { id: udkast.find((u) => u.ressourceId === 'lille-bil')!.id }, true));
  await sig('kort der droppes', MAJA, 'And on Sunday', blok({ start: '2026-11-08T10:00', slut: '2026-11-08T12:00' }));
  bog('maja: drop kortet', await a.aktion(MAJA, 'udkast-drop', { id: (await a.state()).udkast.at(-1)!.id }));
  bog('henrik blokerer den lille bil', await a.aktion(HENRIK, 'book', { ressourceId: 'lille-bil', ...KL('10:00', '12:00', '2026-11-09'), titel: 'Block' }));
  await sig('note: optaget', MAJA, 'Little car on Monday', blok({ ressource: 'lille-bil', start: '2026-11-09T10:00', slut: '2026-11-09T12:00' }));
  await sig('note: ukendt ting', MAJA, 'The bus', blok({ ressource: 'bussen', start: `${LOERDAG}T10:00`, slut: `${LOERDAG}T12:00` }));
  await sig('note: tiden er gaaet', MAJA, 'Yesterday', blok({ start: '2026-11-01T10:00', slut: '2026-11-01T12:00' }));
  await sig('note: ulaeselig tid', MAJA, 'Whenever', blok({ start: 'sometime', slut: `${LOERDAG}T12:00` }));
  await sig('note: for langt frem', MAJA, 'Next month', blok({ start: '2026-12-10T10:00', slut: '2026-12-10T12:00' }));
  await sig('intet svar', MAJA, 'Hello', '');
  r.push(...(await a.store.readChat('husstand', 50)).filter((c) => c.fra === 'hermes').map((c) => `chat | hermes: ${c.tekst.replace(/\n/g, ' / ')}`));
  r.push(...(await logLinjer(a, 'chat')));
  return r;
}

const hændelse = (id: string, title: string, fra: string, til: string) =>
  ({ id, title, start: `2026-11-07T${fra}:00+01:00`, end: `2026-11-07T${til}:00+01:00`, all_day: false });
const kalender = (id: string, zone: Kilde['zone'], events: Record<string, unknown>[]): Kilde => {
  const l: Laesning = { slags: 'kalender', hentet: TIRSDAG.toISOString(), uklar: true, data: { generated: TIRSDAG.toISOString(), days: [{ date: '2026-11-07', events }], errors: [] } };
  return { id, navn: id, slags: 'kalender', zone, auth: 'local', read: async () => l, kort: async () => ({ titel: id, tekst: '', felter: [], handling: 'Forbind' }), helbred: async () => ({ status: 'ok' }) };
};

/** The Saturday check: the card's words in the log, a pick, a refusal. Hermes' own phrasing is not given, so the card is composed. */
async function weekend(rod: string, sprog: Sprog): Promise<Rapport> {
  const r: Rapport = [];
  const bog = bogfoer(r);
  const kalendere = [kalender('henrik-kal', 'privat', [hændelse('e1', 'Cycling', '09:00', '14:00')]), kalender('rikke-kal', 'arbejde', [hændelse('e2', 'Coffee', '11:00', '13:00')])];
  const a = await lavVerden(rod, `weekend-${sprog}`, sprog, { personer: [HENRIK, RIKKE, NORA], kalendere, svar: () => 'Nothing to add.' });
  a.saetUr(TIRSDAG);
  await a.konfliktTik();
  const k = (await a.state()).konflikter[0]!;
  r.push(`kortet: ${k.behov.navn} ${k.dag} ${k.blokke.map((x) => x.hvem).join('+')}`);
  bog('henrik: ukendt valg', await a.aktion(HENRIK, 'konflikt-valg', { id: k.id, valg: 'v9' }, true));
  bog('henrik: vaelger', await a.aktion(HENRIK, 'konflikt-valg', { id: k.id, valg: k.valg[0]!.id }, true));
  bog('henrik: vaelger igen', await a.aktion(HENRIK, 'konflikt-valg', { id: k.id, valg: k.valg[1]!.id }, true));
  r.push(`titlen paa forespoergslen: ${(await a.state()).forespoergsler[0]!.titel}`);
  bog('rikke: nej', await a.aktion(RIKKE, 'svar', { id: (await a.state()).forespoergsler[0]!.id, svar: 'nej' }));
  bog('rikke: vaelger en tredje', await a.aktion(RIKKE, 'konflikt-valg', { id: k.id, valg: k.valg.find((v) => v.slags === 'tredje')!.id }, true));
  r.push(`titlen paa den tredje: ${(await a.state()).forespoergsler.at(-1)!.titel}`);
  r.push(...(await logLinjer(a, 'weekend')), ...runTekster(a, 'weekend', ['konflikt']));
  return r;
}

/** Roles, invitations and the go-between on a member's channel. */
async function husstanden(rod: string, sprog: Sprog): Promise<Rapport> {
  const r: Rapport = [];
  const bog = bogfoer(r);
  const a = await lavVerden(rod, `hushold-${sprog}`, sprog, { personer: [HENRIK, RIKKE, MAJA] });
  const bes = (hvad: string, p: Hvem, navn: string, body: Record<string, unknown>, medJa = false) => a.aktion(p, navn, body, medJa).then((x) => bog(hvad, x));
  const gaa = (min: number) => a.saetUr(new Date(a.ur().getTime() + min * 60_000));
  const modtag = (tekst: string, afsender: string, k: 'telegram' | 'signal' = 'signal') => { gaa(1); a.kanal.modtag({ kanal: k, afsender, gruppe: false, tid: a.ur().toISOString(), tekst }); };
  const GRANDMA = '+4500000009';
  // A member's reply is read in either language; each run uses its own words so the Danish run stays what it was.
  const ORD = sprog === 'da' ? { ja: 'ja', kl: 'kl 17.30' } : { ja: 'yes', kl: 'at 17:30' };

  await bes('inviter egen indgang', HENRIK, 'inviter', { slags: 'egen', navn: 'Nora', login: 'nora@example.com', rolle: 'barn' });
  await bes('inviter telefon', HENRIK, 'inviter', { slags: 'telefon', navn: 'Grandma', kanal: 'signal', handle: GRANDMA, rolle: 'gaest' });
  await bes('fejl: inviter uden navn', HENRIK, 'inviter', { slags: 'egen', navn: '', login: 'x@example.com', rolle: 'barn' });
  await bes('fejl: inviter samme mail', HENRIK, 'inviter', { slags: 'egen', navn: 'Nora 2', login: 'nora@example.com', rolle: 'barn' });
  await bes('fejl: inviter som medlem', RIKKE, 'inviter', { slags: 'egen', navn: 'Anna', login: 'anna@example.com', rolle: 'barn' });
  bog('send invitationen', await a.sendInvitation(HENRIK, 'grandma'));
  r.push(`beskeden der gik: ${a.kanal.sendt.map((s) => s.tekst.replace(/\n/g, ' / ')).join(' || ')}`);
  bog('fejl: send invitationen igen', await a.sendInvitation(HENRIK, 'grandma'));
  bog('fejl: send til en uden kanal', await a.sendInvitation(HENRIK, 'nora'));
  modtag(ORD.ja, GRANDMA);
  await a.tik();
  bog('fejl: send til en der har sagt ja', await a.sendInvitation(HENRIK, 'grandma'));
  await a.req(NORA, '/rum/hjem');
  await bes('rolle', HENRIK, 'rolle', { id: 'rikke', rolle: 'barn' });
  await bes('fejl: rolle ukendt', HENRIK, 'rolle', { id: 'rikke', rolle: 'chef' });
  await bes('fejl: rolle selv', HENRIK, 'rolle', { id: 'henrik', rolle: 'barn' });
  await bes('fejl: rolle findes ikke', HENRIK, 'rolle', { id: 'ingen', rolle: 'barn' });
  await bes('fejl: rolle ikke ejer', MAJA, 'rolle', { id: 'rikke', rolle: 'medlem' });
  await bes('fjern medlem', HENRIK, 'fjern-medlem', { id: 'rikke' }, true);
  await bes('fejl: fjern selv', HENRIK, 'fjern-medlem', { id: 'henrik' }, true);

  // a request to Maja on Telegram
  const sp = (titel: string, tid?: boolean) => a.aktion(HENRIK, 'opret', { til: 'maja', titel, ...(tid ? KL('16:00', '17:00', '2026-11-05') : {}) }, true);
  await sp('Can you pick up Nora?', true);
  const f1 = (await a.state()).forespoergsler[0]!.id;
  bog('send til Maja', await a.send(HENRIK, f1));
  bog('fejl: send igen', await a.send(HENRIK, f1));
  bog('fejl: paamindelse for en anden', await a.send(MAJA, f1, 'paamindelse'));
  bog('send en paamindelse', await a.send(HENRIK, f1, 'paamindelse'));
  bog('fejl: paamindelse igen', await a.send(HENRIK, f1, 'paamindelse'));
  r.push(`beskeder paa Maja's kanal: ${a.kanal.sendt.filter((s) => s.til.medlemId === 'maja').map((s) => s.tekst.replace(/\n/g, ' / ')).join(' || ')}`);
  modtag(ORD.kl, MAJA_TG, 'telegram');
  modtag('maybe tomorrow', MAJA_TG, 'telegram');
  await a.tik();
  r.push(`alternativ i state: ${(await a.state()).forespoergsler[0]!.alternativ?.tekst}`);
  await sp('Can you lock up?');
  const f2 = (await a.state()).forespoergsler[1]!.id;
  bog('send den anden', await a.send(HENRIK, f2));
  await sp('Can you call the plumber?');
  const f3 = (await a.state()).forespoergsler[2]!.id;
  bog('fejl: send paa en kanal med en aaben', await a.send(HENRIK, f3));
  modtag(ORD.ja, MAJA_TG, 'telegram');
  await a.tik();
  bog('send den tredje', await a.send(HENRIK, f3));
  modtag('stop', MAJA_TG, 'telegram');
  await a.tik();
  await sp('Can you water the plants?');
  bog('fejl: send til en der har stoppet', await a.send(HENRIK, (await a.state()).forespoergsler[3]!.id));

  // Sky's control call (intern.ts): the lines to the owner
  const personer = [HENRIK, MAJA, NORA];
  const tilfoej = { op: 'tilfoej', email: 'anna@example.com', navn: 'Anna', rolle: 'medlem' } as const;
  const deps = {
    store: a.store, now: () => a.ur(), live: { notify() {} },
    husstand: { personer: async () => personer.slice(), gemPersoner: async (p: Person[]) => { personer.splice(0, personer.length, ...p); } },
  } as unknown as RoomDeps;
  for (const op of [tilfoej, { op: 'rolle', email: 'anna@example.com', rolle: 'barn' }, { op: 'fjern', email: 'anna@example.com' }] as const) await medSprog(sprog, () => internMedlem(deps, op));
  r.push(...(await logLinjer(a, 'hushold')));
  return r;
}

export type Scenario = (rod: string, sprog: Sprog) => Promise<Rapport>;
export const SCENARIER: Record<string, Scenario> = { foresporgsler, ressourcer, chat, weekend, husstanden };

/** Runs every scenario of `SCENARIER` in a fresh folder for `sprog`. */
export async function kor(sprog: Sprog): Promise<Rapport> {
  const rod = await mkdtemp(path.join(tmpdir(), 'kc-husstand-handlinger-'));
  try {
    const ud: Rapport = [];
    for (const [navn, fn] of Object.entries(SCENARIER)) ud.push(...(await fn(rod, sprog)).map((l) => `${navn} :: ${l}`));
    return ud;
  } finally { await rm(rod, { recursive: true, force: true }); }
}
