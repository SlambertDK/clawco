// KC-0170 slice 3 (part C): fixed inputs for Start's sub-cards (steps 3–6, the Tailscale card, the Danmark-pakke, the
// previews, the import) rendered without a chosen language. The files in test/fixtures/sprog-start/ were captured from
// these inputs BEFORE the strings moved into src/rooms/start/tekster.ts; test/rooms/start-tekster.test.ts holds the
// renders to them byte for byte. The content a connector or a person supplies (titles, names) is English with no Danish
// letters or words, so an English render shows only the chrome Start owns. Change a golden only when the Danish copy
// changes on purpose.

import { forbindKort, kildeIndhold, type KildeVisning } from '../../src/rooms/start/kilderender.ts';
import { renderTailscaleKort } from '../../src/rooms/start/tailscalekort.ts';
import { renderTillidskort } from '../../src/rooms/start/tillidskort.ts';
import { renderDanmarkPakke } from '../../src/rooms/start/danmarkpakke.ts';
import { renderDigitalPostStart, type PostStartVisning } from '../../src/rooms/start/digitalpost.ts';
import { byggForhaandsvisning, renderForhaandsvisning, type Forhaandsvisning } from '../../src/rooms/start/forhaandsvisning.ts';
import { importBunke, importIndhold, type ImportVisning } from '../../src/rooms/start/import/render.ts';
import { forskelTekst } from '../../src/rooms/start/import/foreslaa.ts';
import { slagsNavn } from '../../src/rooms/start/import/typer.ts';
import { renderStart } from '../../src/rooms/start/render.ts';
import { alleTrin } from '../../src/rooms/start/trin.ts';
import { TS_TILSTANDE, type TsSyn } from '../../src/shell/tailscale.ts';
import type { KildeKortSyn } from '../../src/rooms/module.ts';
import type { ImportBunke, ImportForslag } from '../../src/rooms/start/schema.ts';

export const START_NU = new Date('2026-10-31T09:00:00.000Z');
const HENTET = '2026-10-31T08:55:00.000Z';

type Felt = KildeKortSyn['kort']['felter'][number];
const felt = (o: Partial<Felt> & { navn: string; etiket: string }): Felt => ({ type: 'tekst', paakraevet: false, ...o });

/** A calendar card with every kind of field and a two-step setup. */
const KAL: KildeKortSyn = {
  id: 'falsk-kalender', navn: 'Calendar', slags: 'kalender', zone: 'privat', forbundet: false, helbred: null,
  kort: {
    titel: 'Calendar', tekst: 'Connect your calendar.', handling: 'Connect the calendar',
    felter: [
      felt({ navn: 'adresse', etiket: 'Address', paakraevet: true, maks: 200, forslag: ['https://a.example.com/cal'] }),
      felt({ navn: 'noegle', etiket: 'Secret', type: 'hemmelig', paakraevet: true, maks: 100 }),
      felt({ navn: 'slags', etiket: 'Kind', muligheder: [{ vaerdi: 'a', etiket: 'Work' }, { vaerdi: 'b', etiket: 'Home' }] }),
      felt({ navn: 'liste', etiket: 'Feeds', flere: true, maks: 500 }),
      felt({ navn: 'opml', etiket: 'File', type: 'fil', maks: 1000 }),
      felt({ navn: 'skjult', etiket: 'Hidden', skjult: true }),
    ],
    trin: [{ tekst: 'Open the console.' }, { tekst: 'Paste this address.', kopier: 'https://x.example.com/callback' }],
  },
};
const MAIL: KildeKortSyn = { id: 'falsk-mail', navn: 'Mail', slags: 'mail', zone: 'arbejde', forbundet: false, helbred: null, kort: { titel: 'Inbox', tekst: 'Connect your inbox.', handling: 'Connect the inbox', felter: [felt({ navn: 'konto', etiket: 'Account', paakraevet: true })] } };
const NYH: KildeKortSyn = { id: 'falsk-nyheder', navn: 'News', slags: 'nyheder', zone: 'husstand', forbundet: false, helbred: null, kort: { titel: 'News feeds', tekst: 'Connect a feed.', handling: 'Connect the feed', felter: [] } };
const AULA: KildeKortSyn = { id: 'aula-kalender', navn: 'School calendar', slags: 'kalender', zone: 'husstand', forbundet: false, helbred: null, kort: { titel: 'School calendar', tekst: 'Paste the link.', handling: 'Connect the school', felter: [felt({ navn: 'link', etiket: 'Link', type: 'hemmelig', paakraevet: true })] } };
const forbundet = (k: KildeKortSyn, helbred: KildeKortSyn['helbred'] = { status: 'ok' }): KildeKortSyn => ({ ...k, forbundet: true, helbred });

const forhaand = (id: string, slags: string, navn: string, titel: string, linje = ''): Forhaandsvisning => ({ kildeId: id, navn, slags, titel, linje, hentet: HENTET, zone: 'privat', ejer: 'henrik' });

const kilder = (o: Partial<KildeVisning>): KildeVisning => ({ kort: [KAL, MAIL], forhaandsvisninger: [], flere: [], kanForbinde: true, ...o });

// ---- Tailscale ---------------------------------------------------------------------------------------------------------

const ts = (tilstand: TsSyn['tilstand'], o: Partial<TsSyn> = {}): TsSyn => ({ tilstand, port: 8750, laptop: tilstand === 'laptop', ...o });
const tsKort = (s: TsSyn, kanDele = true): string => String(renderTailscaleKort({ syn: s, kanDele }));
const TS_CASER: Record<string, () => string> = Object.fromEntries([
  ...TS_TILSTANDE.map((t) => [`tailscale-${t}`, () => tsKort(ts(t, t === 'delt' ? { adresse: 'https://laptop.example.ts.net' } : {}))]),
  ['tailscale-klarLaptop', () => tsKort(ts('klar', { laptop: true }))],
  ['tailscale-klarIkkeEjer', () => tsKort(ts('klar'), false)],
  ['tailscale-ikkeLoggetIndLaptop', () => tsKort(ts('ikke-logget-ind', { laptop: true }))],
  ['tailscale-deltLaptop', () => tsKort(ts('delt', { laptop: true, adresse: 'https://laptop.example.ts.net' }))],
  ['tailscale-deltUdenAdresse', () => tsKort(ts('delt'))],
  ['tailscale-deltOffentlig', () => tsKort(ts('delt', { offentlig: true, adresse: 'https://laptop.example.ts.net' }))],
]);

// ---- Danmark-pakke -----------------------------------------------------------------------------------------------------

const POST: PostStartVisning = {
  kandidater: ['noreply@digitalpost.example.com', 'info@post.example.com'], laeser: 'ok', viser: 'mitdk',
  visere: [{ id: 'mitdk', navn: 'mit.dk' }, { id: 'eboks', navn: 'e-Boks' }], domaener: ['digitalpost.example.com', 'post.example.com'], kanGemme: true,
};

// ---- The import --------------------------------------------------------------------------------------------------------

const person = (o: Partial<ImportForslag> & { id: string; navn: string }): ImportForslag => ({ art: 'person', status: 'nyt', ...o });
const BUNKE: ImportBunke = {
  tid: HENTET, slags: 'chatgpt', uaendret: 2,
  forslag: [
    person({ id: 'p1', navn: 'Alma Test', relation: 'friend', org: 'Acme Inc', foedselsdag: '1984-03-12', zone: 'privat', tekst: 'Runs in the morning' }),
    person({ id: 'p2', navn: 'Bo Test', relation: 'colleague', zone: 'arbejde' }),
    person({ id: 'p3', navn: 'Cleo Test', status: 'findes', zone: 'privat', diff: [{ felt: 'relation', nu: 'friend', ny: 'sister' }, { felt: 'org', nu: '', ny: 'Acme Inc' }] }),
    { id: 'p4', art: 'profil', status: 'nyt', navn: 'Din profil', tekst: 'x'.repeat(300) },
    { id: 'p5', art: 'profil', status: 'findes', navn: 'Din profil', diff: [{ felt: 'tekst', nu: 'old', ny: 'new' }] },
  ],
};
const imp = (o: Partial<ImportVisning>): ImportVisning => ({ klar: true, kanLavMappe: false, udbyder: null, gemt: [], laeser: false, kanGemme: true, ...o });

const IMPORT_CASER: Record<string, () => string> = {
  'import-ikkeEjer': () => String(importIndhold('ikke-startet', imp({ kanGemme: false }))),
  'import-udenMappe': () => String(importIndhold('ikke-startet', imp({ klar: false }))),
  'import-udenMappeKanLave': () => String(importIndhold('i-gang', imp({ klar: false, kanLavMappe: true }))),
  'import-udenMappeKlaret': () => String(importIndhold('klaret', imp({ klar: false, kanLavMappe: true, gemt: [{ logId: 'l1', tid: HENTET, slags: 'noter', antal: 1 }] }))),
  'import-formularModel': () => String(importIndhold('ikke-startet', imp({}))),
  'import-formularUdbyder': () => String(importIndhold('i-gang', imp({ udbyder: { navn: 'Anthropic', lokal: false } }))),
  'import-formularLokal': () => String(importIndhold('ikke-startet', imp({ udbyder: { navn: 'Ollama', lokal: true } }))),
  'import-laeser': () => String(importIndhold('ikke-startet', imp({ laeser: true }))),
  'import-gemt': () => String(importIndhold('klaret', imp({ gemt: [{ logId: 'l1', tid: HENTET, slags: 'chatgpt', antal: 1 }, { logId: 'l2', tid: HENTET, slags: 'noter', antal: 2 }] }))),
  'import-gemtEn': () => String(importIndhold('klaret', imp({ gemt: [{ logId: 'l1', tid: HENTET, slags: 'noter', antal: 1 }] }))),
  'import-bunke': () => String(importIndhold('i-gang', imp({ bunke: BUNKE }))),
  'import-bunkeEnNy': () => String(importBunke({ ...BUNKE, uaendret: 0, forslag: [BUNKE.forslag[0]!] }, true)),
  'import-bunkeIkkeEjer': () => String(importBunke(BUNKE, false)),
  'import-bunkeFlere': () => String(importBunke({ ...BUNKE, slags: 'flere', forslag: [BUNKE.forslag[1]!] }, true)),
};

// ---- Previews ----------------------------------------------------------------------------------------------------------

const LAES: Record<string, { k: { id: string; navn: string; slags: string }; data: unknown }> = {
  kalenderTom: { k: { id: 'k1', navn: 'Calendar', slags: 'kalender' }, data: { days: [{ date: '2026-10-31', events: [] }] } },
  kalenderTidsat: { k: { id: 'k1', navn: 'Calendar', slags: 'kalender' }, data: { days: [{ date: '2026-10-31', events: [{ title: 'Board meeting', start: '2026-10-31T11:30:00.000Z', all_day: false }, { title: 'Lunch', start: '2026-10-31T14:00:00.000Z' }] }] } },
  kalenderHelDag: { k: { id: 'k1', navn: 'Calendar', slags: 'kalender' }, data: { days: [{ date: '2026-10-31', events: [{ title: 'Holiday', all_day: true }] }] } },
  kalenderUdenTitel: { k: { id: 'k1', navn: 'Calendar', slags: 'kalender' }, data: { days: [{ date: '2026-10-31', events: [{ start: '2026-10-31T11:30:00.000Z' }] }] } },
  mailIngenUlaeste: { k: { id: 'm1', navn: 'Mail', slags: 'mail' }, data: [{ laest: true, fra: 'A', modtaget: HENTET }] },
  mailUlaeste: { k: { id: 'm1', navn: 'Mail', slags: 'mail' }, data: [{ fra: 'Alma', modtaget: '2026-10-31T08:00:00Z' }, { fra: 'Bo', modtaget: '2026-10-31T08:30:00Z' }, { fra: 'Cleo', modtaget: '2026-10-31T07:00:00Z' }, { fra: 'Dan', modtaget: '2026-10-30T07:00:00Z' }] },
  mailEnUlaest: { k: { id: 'm1', navn: 'Mail', slags: 'mail' }, data: [{ fra: 'Alma', modtaget: HENTET }] },
  mailUdenAfsender: { k: { id: 'm1', navn: 'Mail', slags: 'mail' }, data: [{ modtaget: HENTET }, { modtaget: HENTET }] },
  noter: { k: { id: 'n1', navn: 'Notes', slags: 'noter' }, data: { noter: [{ titel: 'Garden plan' }, { titel: 'Other' }], personer: [{}, {}, {}] } },
  noterEn: { k: { id: 'n1', navn: 'Notes', slags: 'noter' }, data: { noter: [{ titel: 'Garden plan' }], personer: [{}] } },
  noterTom: { k: { id: 'n1', navn: 'Notes', slags: 'noter' }, data: { noter: [], personer: [] } },
  nyheder: { k: { id: 'f1', navn: 'News', slags: 'nyheder' }, data: { nyheder: [{ titel: 'Power prices fall' }, { titel: 'Other' }] } },
  nyhederTom: { k: { id: 'f1', navn: 'News', slags: 'nyheder' }, data: { nyheder: [] } },
  beskeder: { k: { id: 'b1', navn: 'Messages', slags: 'beskeder' }, data: [{ afsender: { navn: 'Alma' } }, { afsender: { navn: 'Bo' } }, { laest: true }] },
  beskederEn: { k: { id: 'b1', navn: 'Messages', slags: 'beskeder' }, data: [{ afsender: { navn: 'Alma' } }] },
  beskederIngen: { k: { id: 'b1', navn: 'Messages', slags: 'beskeder' }, data: [] },
  ugyldig: { k: { id: 'k1', navn: 'Calendar', slags: 'kalender' }, data: 42 },
};
const bygg = (n: string): Forhaandsvisning => { const l = LAES[n]!; return { ...byggForhaandsvisning(l.k, { slags: l.k.slags, hentet: HENTET, data: l.data }, START_NU), zone: 'privat', ejer: 'henrik' }; };

/** What a preview says, by case: the stored title and line (these are the texts that reach the screen). */
export const FORHAANDSTEKSTER = (): Record<string, { titel: string; linje: string }> => Object.fromEntries(Object.keys(LAES).map((n) => [n, { titel: bygg(n).titel, linje: bygg(n).linje }]));
export const FORSKEL_TEKSTER = (): string[] => [
  ...forskelTekst([{ felt: 'relation', nu: 'friend', ny: 'sister' }, { felt: 'org', nu: '', ny: 'Acme Inc' }, { felt: 'tekst', nu: 'a', ny: 'b' }]),
  ...['chatgpt', 'claude', 'gemini', 'andet', 'kontakter', 'noter', 'flere', 'something'].map((s) => slagsNavn(s)),
];

const FORHAAND_CASER: Record<string, () => string> = Object.fromEntries(Object.keys(LAES).map((n) => [`forhaand-${n}`, () => String(renderForhaandsvisning(bygg(n), START_NU))]));

// ---- The cases ---------------------------------------------------------------------------------------------------------

// KC-0248: the goldens predate step 0 (the situation pick); they keep the journey from step 1 on (step 0 has its own cases below).
const journey = alleTrin().filter((t) => t.id !== 'situation');
const trin = journey.map((t, i) => ({ trin: t, status: (i === 0 ? 'klaret' : 'ikke-startet') as 'klaret' | 'ikke-startet' }));
const start = (o: Partial<Parameters<typeof renderStart>[0]>): string => String(renderStart({ trin, profil: { navn: 'Alma', sprog: 'da', husstand: 'alene' }, standardNavn: '', forslag: [], kanGemme: true, now: START_NU, ...o }));
/** The whole journey, step 0 included, with step 0 in `status` and the rest not started. */
const hele = (status: 'ikke-startet' | 'i-gang'): { trin: ReturnType<typeof alleTrin>[number]; status: 'klaret' | 'ikke-startet' | 'i-gang' }[] => alleTrin().map((t) => ({ trin: t, status: t.id === 'situation' ? status : 'ikke-startet' }));
const trinFoerst = (id: string, status: 'klaret' | 'ikke-startet' | 'sprunget-over' | 'i-gang') => journey.map((t) => ({ trin: t, status: t.id === id ? status : ('klaret' as const) }));

export const START_DELE: Record<string, () => string> = {
  'kilde-forbind': () => String(forbindKort(KAL, { spring: false })),
  'kilde-forbindSpring': () => String(forbindKort(KAL, { spring: true, laptop: true })),
  'kilde-forbindIgenIkkeNu': () => String(forbindKort(MAIL, { spring: false, igen: true, ikkeNu: 'aula-ikke-nu', efter: '/rum/hjem' })),
  'kilde-valg': () => String(kildeIndhold('foerste-kilde', 'ikke-startet', kilder({ kort: [KAL, forbundet(MAIL)] }), START_NU)),
  'kilde-valgIkkeEjer': () => String(kildeIndhold('foerste-kilde', 'ikke-startet', kilder({ kanForbinde: false }), START_NU)),
  'kilde-klaret': () => String(kildeIndhold('foerste-kilde', 'klaret', kilder({ kort: [forbundet(KAL), MAIL], forhaandsvisninger: [forhaand('falsk-kalender', 'kalender', 'Calendar', '2 appointments today', 'First at 12.30: Board meeting')] }), START_NU)),
  'kilde-forbundetUdenSyn': () => String(kildeIndhold('foerste-kilde', 'klaret', kilder({ kort: [forbundet(KAL)] }), START_NU)),
  'kilde-fejl': () => String(kildeIndhold('foerste-kilde', 'i-gang', kilder({ kort: [forbundet(KAL, { status: 'log-ind-igen', tekst: 'Sign in again.' }), forbundet(MAIL, { status: 'fejl' })] }), START_NU)),
  'kilde-fejlIkkeEjer': () => String(kildeIndhold('foerste-kilde', 'i-gang', kilder({ kanForbinde: false, laptop: true, kort: [forbundet(KAL, { status: 'fejl', tekst: 'Broken.' })] }), START_NU)),
  'kilde-flere': () => String(kildeIndhold('flere-kilder', 'i-gang', kilder({ kort: [forbundet(KAL), forbundet(MAIL), NYH], flere: ['falsk-nyheder'], forhaandsvisninger: [forhaand('falsk-noter', 'noter', 'Notes', '1 note and 1 person')] }), START_NU)),
  'kilde-flereIkkeEjer': () => String(kildeIndhold('flere-kilder', 'i-gang', kilder({ kanForbinde: false, kort: [NYH], flere: ['falsk-nyheder'] }), START_NU)),
  'kilde-flereLaptop': () => String(kildeIndhold('flere-kilder', 'i-gang', kilder({ laptop: true, kort: [NYH], flere: ['falsk-nyheder'] }), START_NU)),
  ...TS_CASER,
  tillid: () => String(renderTillidskort()),
  'pakke-ingen': () => String(renderDanmarkPakke({})),
  'pakke-aula': () => String(renderDanmarkPakke({ aula: { kort: AULA } })),
  'pakke-aulaLaptop': () => String(renderDanmarkPakke({ aula: { kort: AULA, laptop: true } })),
  'pakke-fuld': () => String(renderDanmarkPakke({ aula: { kort: AULA }, post: POST })),
  'pakke-post': () => String(renderDanmarkPakke({ post: POST })),
  'pakke-postIkkeEjer': () => String(renderDigitalPostStart({ ...POST, kanGemme: false })),
  'pakke-postIngenKandidater': () => String(renderDigitalPostStart({ ...POST, kandidater: [] })),
  'pakke-postKanIkkeSe': () => String(renderDigitalPostStart({ ...POST, kandidater: [], laeser: 'kan-ikke-se' })),
  ...IMPORT_CASER,
  ...FORHAAND_CASER,
  // KC-0248: step 0 — nothing picked (the first pick's example under the picks), a pick not yet gone on with, gone on with, and read-only.
  'situation-aaben': () => start({ trin: hele('ikke-startet'), profil: null }),
  'situation-valgt': () => start({ trin: hele('i-gang'), profil: null, situation: { valg: 'familie', tid: HENTET } }),
  'situation-klaret': () => start({ trin: alleTrin().map((t) => ({ trin: t, status: (t.id === 'situation' ? 'klaret' : 'ikke-startet') as 'klaret' | 'ikke-startet' })), situation: { valg: 'mail', tid: HENTET, bekraeftet: HENTET } }),
  'situation-ikkeEjer': () => start({ trin: hele('ikke-startet'), profil: null, kanGemme: false }),
  // Whole room: the steps 3–6 inside the pile, with the cards under them.
  'rum-kilder': () => start({ trin: trinFoerst('foerste-kilde', 'i-gang'), kilder: kilder({ kort: [KAL, MAIL] }) }),
  'rum-importOgRet': () => start({
    trin: journey.map((t) => ({ trin: t, status: (t.id === 'import' || t.id === 'foerste-ret' ? 'ikke-startet' : 'klaret') as 'klaret' | 'ikke-startet' })),
    import: imp({ bunke: BUNKE }), foersteRet: { punkt: { titel: 'The electricity bill' }, kanSpringeOver: true },
  }),
  'rum-efterRet': () => start({
    trin: journey.map((t) => ({ trin: t, status: 'klaret' as const })),
    foersteRet: { punkt: null, ret: { art: 'ret', tid: HENTET, titel: 'The electricity bill' }, kanSpringeOver: false },
    tailscale: { syn: ts('klar'), kanDele: true }, digitalPost: POST, aula: { kort: AULA },
  }),
};

// ---- The room's actions, its log lines and its answers ------------------------------------------------------------------
// Each scenario runs one action (or listener) of the room against a stub of its surroundings and records every sentence it
// produces: the refusal (ActionError), the answer text, the failure of the run, and the room's log lines. Without a chosen
// language the record is test/fixtures/sprog-start/handlinger.json byte for byte; in English no sentence of Start's own is
// Danish (`andres` marks the scenarios that also pass on a sentence from a module Start does not own).

import { medStart, NU as STATE_NU, STARTET, type Sut } from '../helpers/start-deps.ts';
import { rejsen, startRoom } from '../../src/rooms/start/room.ts';
import { modtagRet } from '../../src/rooms/start/ret.ts';
import { modtagFoersteLaesning, springOver } from '../../src/rooms/start/vaerdi.ts';
import { foreslaaTilfoejelse } from '../../src/rooms/start/forslag.ts';
import { TsFejl } from '../../src/shell/tailscale.ts';
import type { ImportSkriver } from '../../src/rooms/start/import/skriver.ts';
import type { ModelSyn } from '../../src/rooms/start/trin.ts';
import type { StartState } from '../../src/rooms/start/schema.ts';
import type { Profil } from '../../src/store/profil.ts';

export type Utfald = { fejl?: string; tekst?: string; fejlede?: string; label?: string; log: string[] };
type Resultat = Omit<Utfald, 'log'>;

const MEDLEM = { id: 'ella', login: null, navn: 'Ella', rolle: 'barn' } as never;
const TOM_TILSTAND: StartState = { startet: STARTET, trin: {}, afvist: {} };
const KILDE_ID = 'falsk-kalender';
const LAESTE: StartState['kilder'] = { [KILDE_ID]: { foersteVaerdiMs: 1, tid: STARTET, forhaandsvisning: { kildeId: KILDE_ID, navn: 'Calendar', slags: 'kalender', titel: 'x', linje: '', hentet: STARTET, zone: 'privat', ejer: 'henrik' } } };

async function aktion(s: Sut, name: string, body: Record<string, unknown> = {}): Promise<Resultat> {
  const u: Resultat = {};
  try {
    const run = await startRoom.startAction!(s.d, name, body);
    await run?.finished;
    if (run?.label) u.label = run.label;
    if (run?.status === 'failed') u.fejlede = run.error ?? '';
    else if (run?.result) u.tekst = run.result.text ?? '';
  } catch (err) { u.fejl = err instanceof Error ? err.message : String(err); }
  return u;
}

async function fortryd(s: Sut): Promise<Resultat> {
  const run = await startRoom.startFortryd!(s.d, await logId(s));
  await run?.finished;
  return { tekst: run?.result?.text ?? '', ...(run?.label ? { label: run.label } : {}) };
}

const profilLager = (start: Profil | null = null): NonNullable<Sut['d']['profil']> => {
  let p = start;
  return { laes: async () => p, laesNu: () => p, skriv: async (x) => { p = x; }, fjern: async () => { p = null; } };
};

const tsVindue = (laes: TsSyn, del: () => Promise<TsSyn>): NonNullable<Sut['d']['tailscale']> => ({ port: 8750, laptop: () => false, laes: async () => laes, del });
const danmark = (): NonNullable<Sut['d']['danmark']> => ({ start: async () => null, gem: async () => undefined, ikkeNu: async () => undefined, aulaUdsat: async () => false, aulaIkkeNu: async () => undefined });

const REV = { lille: 'anthropic:claude-haiku-5-5', taenker: 'anthropic:claude-sonnet-5-5' };
const modelVindue = (o: { tom?: boolean } = {}): NonNullable<Sut['d']['model']> => {
  let syn: ModelSyn = o.tom ? { modeller: {}, test: {}, rev: REV } : { udbyder: 'anthropic', modeller: { lille: 'claude-haiku-5-5', taenker: 'claude-sonnet-5-5' }, test: {}, rev: REV };
  return {
    laes: async () => syn,
    vaelg: async (v) => { syn = { ...syn, udbyder: v.udbyder, modeller: { lille: v.lille, taenker: v.taenker }, rev: { lille: `${v.udbyder}:${v.lille}`, taenker: `${v.udbyder}:${v.taenker}` } }; },
    saetTest: async (n, t) => { syn = { ...syn, test: { ...syn.test, [n]: t } }; },
    saetAgentNoegle: async (v) => ({ noegle: 'X', laengde: v.length }),
    fetchImpl: (async () => new Response('{}', { status: 404 })) as typeof fetch,
    testMs: 5000,
  };
};

/** An import writer that keeps nothing: every write "succeeds" with a receipt. */
const skriver = (o: { klar?: boolean; lavMappe?: boolean } = {}): ImportSkriver => ({
  klar: async () => o.klar ?? true,
  ...(o.lavMappe ? { lavMappe: async () => undefined } : {}),
  personer: async () => [], profil: async () => null,
  skrivPerson: async (p) => ({ udfald: 'oprettet', sti: `People/${p.navn}.md`, kvittering: { sti: `People/${p.navn}.md`, sha256: 'a'.repeat(64) } }),
  skrivProfil: async () => ({ udfald: 'oprettet', sti: 'Profile.md', kvittering: { sti: 'Profile.md', sha256: 'b'.repeat(64), forrige: 'template' } }),
  opdaterPerson: async (p) => ({ udfald: 'opdateret', sti: `People/${p.navn}.md`, kvittering: { sti: `People/${p.navn}.md`, sha256: 'c'.repeat(64), forrige: 'old' }, felter: p.diff.map((d) => d.felt), sprunget: [] }),
  fjernPerson: async () => true, fjernProfil: async () => true, gendanPerson: async () => true,
});

const BUNKE_TILSTAND: StartState = {
  ...TOM_TILSTAND, kilder: LAESTE,
  import: { bunke: { tid: STARTET, slags: 'chatgpt', uaendret: 0, forslag: [
    { id: 'p1', art: 'person', status: 'nyt', navn: 'Alma', relation: 'friend', zone: 'privat', mappe: 'venner' },
    { id: 'p2', art: 'person', status: 'findes', navn: 'Bo', relation: 'colleague', zone: 'arbejde', diff: [{ felt: 'relation', nu: 'a', ny: 'b' }] },
    { id: 'p3', art: 'profil', status: 'nyt', navn: 'Din profil', tekst: 'Runs a lot.' },
  ] } },
};
const medSkriver = { state: BUNKE_TILSTAND, importSkriver: skriver() };
const fenced = (o: unknown): string => `Here.\n\`\`\`json\n${JSON.stringify(o)}\n\`\`\``;

type Scenarie = { opsaet?: Parameters<typeof medStart>[0]; kor: (s: Sut) => Promise<Resultat>; andres?: true };
const A = (name: string, body: Record<string, unknown> = {}) => (s: Sut): Promise<Resultat> => aktion(s, name, body);
const MED_KILDER = (s: Sut): void => { s.d.rejse!.kilder = async () => [{ id: KILDE_ID, navn: 'Calendar', slags: 'kalender', forbundet: true }, { id: 'falsk-nyheder', navn: 'News', slags: 'nyheder', forbundet: false }]; };
const logId = async (s: Sut): Promise<string> => (await s.d.store.readLog('start', 5))[0]!.id;

export const SCENARIER: Record<string, Scenarie> = {
  // Step 1
  'velkommen-ikkeEjer': { opsaet: { person: MEDLEM }, kor: A('velkommen-gem', { navn: 'Alma', sprog: 'da', husstand: 'alene' }) },
  'velkommen-udenLager': { kor: A('velkommen-gem', { navn: 'Alma', sprog: 'da', husstand: 'alene' }) },
  'velkommen-ugyldig': { andres: true, kor: async (s) => { s.d.profil = profilLager(); return aktion(s, 'velkommen-gem', { navn: '', sprog: 'da', husstand: 'alene' }); } },
  'velkommen-gem': { kor: async (s) => { s.d.profil = profilLager(); return aktion(s, 'velkommen-gem', { navn: 'Alma', sprog: 'da', husstand: 'alene' }); } },
  'velkommen-gemHusstand': { kor: async (s) => { s.d.profil = profilLager(); return aktion(s, 'velkommen-gem', { navn: 'Alma', sprog: 'en', husstand: 'husstand' }); } },
  'velkommen-gemLaptop': { kor: async (s) => { s.d.profil = profilLager(); s.d.laptop = () => true; return aktion(s, 'velkommen-gem', { navn: 'Alma', sprog: 'da', husstand: 'alene' }); } },
  'velkommen-fortryd': { kor: async (s) => { s.d.profil = profilLager(); await aktion(s, 'velkommen-gem', { navn: 'Alma', sprog: 'da', husstand: 'alene' }); return fortryd(s); } },
  'velkommen-fortrydTilbage': { kor: async (s) => { s.d.profil = profilLager({ navn: 'Bo', sprog: 'da', husstand: 'alene' }); await aktion(s, 'velkommen-gem', { navn: 'Alma', sprog: 'da', husstand: 'alene' }); return fortryd(s); } },
  // Suggestions
  'forslag-ukendt': { kor: A('forslag-afvis', { kildeId: 'nope' }) },
  'forslag-afvis': {
    opsaet: { state: { ...TOM_TILSTAND, forslag: { tid: STATE_NU.toISOString(), liste: [{ kildeId: KILDE_ID, navn: 'Calendar', slags: 'kalender', grund: 'Because.' }] } } },
    kor: async (s) => { s.d.rejse!.kilder = async () => [{ id: KILDE_ID, navn: 'Calendar', slags: 'kalender', forbundet: false }]; return aktion(s, 'forslag-afvis', { kildeId: KILDE_ID }); },
  },
  // Step 6
  'ret-ikkeEjer': { opsaet: { person: MEDLEM }, kor: A('ret-spring-over') },
  'ret-klaret': { opsaet: { state: { ...TOM_TILSTAND, ret: { art: 'ret', tid: STARTET, titel: 'x' } } }, kor: A('ret-spring-over') },
  'ret-alleredeSprunget': { opsaet: { state: { ...TOM_TILSTAND, trin: { 'foerste-ret': { status: 'sprunget-over' } } } }, kor: A('ret-spring-over') },
  'ret-springOver': { kor: A('ret-spring-over') },
  'ret-hoert': { kor: async (s) => ({ tekst: String(await modtagRet(s.d, { art: 'ret', tid: '2026-10-31T08:30:00.000Z', titel: 'The electricity bill', tekst: 'Too high' })) }) },
  'ret-hoertIkkeRelevant': { kor: async (s) => ({ tekst: String(await modtagRet(s.d, { art: 'ikke-relevant', tid: '2026-10-31T08:30:00.000Z', titel: 'The electricity bill' })) }) },
  // Steps 3-4
  'kilde-ikkeEjer': { opsaet: { person: MEDLEM }, kor: A('kilde-spring-over', { kildeId: 'falsk-nyheder' }) },
  'kilde-ukendt': { kor: A('kilde-spring-over', { kildeId: 'falsk-nyheder' }) },
  'kilde-springOver': { opsaet: { state: { ...TOM_TILSTAND, kilder: LAESTE } }, kor: async (s) => { MED_KILDER(s); return aktion(s, 'kilde-spring-over', { kildeId: 'falsk-nyheder' }); } },
  'kilde-foersteLaesning': { kor: async (s) => { await modtagFoersteLaesning(s.d, { kilde: { id: KILDE_ID, navn: 'Calendar', slags: 'kalender' }, laesning: { slags: 'kalender', hentet: STARTET, data: { days: [{ date: '2026-10-31', events: [{ title: 'Board meeting', start: '2026-10-31T11:30:00.000Z' }] }] } }, zone: 'privat', ejer: 'henrik', forbundet: '2026-10-31T08:59:59.200Z' }); return {}; } },
  'kilde-foersteLaesningLang': { kor: async (s) => { await modtagFoersteLaesning(s.d, { kilde: { id: 'falsk-mail', navn: 'Mail', slags: 'mail' }, laesning: { slags: 'mail', hentet: STARTET, data: [] }, zone: 'privat', ejer: 'henrik', forbundet: '2026-10-31T08:59:57.300Z' }); return {}; } },
  'kilde-springOverDirekte': { opsaet: { state: { ...TOM_TILSTAND, kilder: LAESTE } }, kor: async (s) => { MED_KILDER(s); const { ctx } = { ctx: { profil: null, kilder: [{ id: KILDE_ID, navn: 'Calendar', slags: 'kalender', forbundet: true }, { id: 'falsk-nyheder', navn: 'News', slags: 'nyheder', forbundet: false }] } }; return { tekst: `${await springOver(s.d, 'falsk-nyheder', ctx)}` }; } },
  'kilde-springOverUkendt': { kor: async (s) => { try { await springOver(s.d, 'nope', { profil: null, kilder: [] }); return {}; } catch (err) { return { fejl: (err as Error).message }; } } },
  // Digital Post and Aula
  'post-ikkeEjer': { opsaet: { person: MEDLEM }, kor: A('post-afsender-gem', { egen: 'a@b.example.com' }) },
  'post-udenDanmark': { kor: A('post-afsender-gem', { egen: 'a@b.example.com' }) },
  'post-ikkeNu': { kor: async (s) => { s.d.danmark = danmark(); return aktion(s, 'post-ikke-nu'); } },
  'post-gem': { kor: async (s) => { s.d.danmark = danmark(); return aktion(s, 'post-afsender-gem', { afsender: 'NoReply@Digitalpost.Example.com', viser: 'mitdk' }); } },
  'aula-ikkeEjer': { opsaet: { person: MEDLEM }, kor: A('aula-ikke-nu') },
  'aula-udenDanmark': { kor: A('aula-ikke-nu') },
  'aula-ikkeNu': { kor: async (s) => { s.d.danmark = danmark(); return aktion(s, 'aula-ikke-nu'); } },
  // Tailscale
  'ts-udenVindue': { kor: A('tailscale-del', { port: 8750 }) },
  'ts-ikkeEjer': { opsaet: { person: MEDLEM }, kor: async (s) => { s.d.tailscale = tsVindue(ts('klar'), async () => ts('delt')); return aktion(s, 'tailscale-del', { port: 8750 }); } },
  'ts-forkertPort': { kor: async (s) => { s.d.tailscale = tsVindue(ts('klar'), async () => ts('delt')); return aktion(s, 'tailscale-del', { port: 1 }); } },
  'ts-ikkeKlar': { kor: async (s) => { s.d.tailscale = tsVindue(ts('delt'), async () => ts('delt')); return aktion(s, 'tailscale-del', { port: 8750 }); } },
  'ts-delt': { kor: async (s) => { s.d.tailscale = tsVindue(ts('klar'), async () => ts('delt', { adresse: 'https://laptop.example.ts.net' })); return aktion(s, 'tailscale-del', { port: 8750 }); } },
  'ts-deltUdenAdresse': { kor: async (s) => { s.d.tailscale = tsVindue(ts('klar'), async () => ts('delt')); return aktion(s, 'tailscale-del', { port: 8750 }); } },
  'ts-kommandoKoert': { kor: async (s) => { s.d.tailscale = tsVindue(ts('klar'), async () => ts('ukendt')); return aktion(s, 'tailscale-del', { port: 8750 }); } },
  'ts-fejl': { andres: true, kor: async (s) => { s.d.tailscale = tsVindue(ts('klar'), async () => { throw new TsFejl('Tailscale did not answer.'); }); return aktion(s, 'tailscale-del', { port: 8750 }); } },
  // Step 2
  'model-ikkeEjer': { opsaet: { person: MEDLEM }, kor: A('model-test', { tier: 'lille' }) },
  'model-udenVindue': { kor: A('model-test', { tier: 'lille' }) },
  'model-agentNoegleTom': { opsaet: { model: modelVindue() }, kor: A('model-agent-noegle', { noegle: '' }) },
  'model-agentNoegle': { opsaet: { model: modelVindue() }, kor: A('model-agent-noegle', { noegle: 'secret-key' }) },
  'model-manglerNoegle': { opsaet: { model: modelVindue() }, kor: async (s) => { s.d.hermes.status = async () => 'mangler-noegle'; return aktion(s, 'model-test', { tier: 'lille' }); } },
  'model-ukendtNiveau': { opsaet: { model: modelVindue() }, kor: A('model-test', { tier: 'x' }) },
  'model-vaelgFoerst': { opsaet: { model: modelVindue({ tom: true }) }, kor: A('model-test', { tier: 'lille' }) },
  'model-testOk': { opsaet: { model: modelVindue() }, kor: A('model-test', { tier: 'lille' }) },
  'model-testFejl': { opsaet: { model: modelVindue() }, kor: async (s) => { s.d.hermes.run = async () => { throw new Error('401 unauthorized'); }; return aktion(s, 'model-test', { tier: 'taenker' }); } },
  'model-ukendtUdbyder': { opsaet: { model: modelVindue() }, kor: A('model-gem', { udbyder: 'nope' }) },
  'model-forkertAdresse': { opsaet: { model: modelVindue() }, kor: A('model-gem', { udbyder: 'ollama', url: 'ftp://x.example.com' }) },
  'model-noegleForLang': { opsaet: { model: modelVindue() }, kor: A('model-gem', { udbyder: 'anthropic', noegle: 'k'.repeat(2001) }) },
  'model-gemOk': { opsaet: { model: modelVindue({ tom: true }) }, kor: A('model-gem', { udbyder: 'anthropic', noegle: 'sk-test-123', lille: 'claude-haiku-5-5', taenker: 'claude-sonnet-5-5' }) },
  'model-gemLokal': { opsaet: { model: modelVindue({ tom: true }) }, kor: A('model-gem', { udbyder: 'ollama', url: 'http://127.0.0.1:11434' }) },
  'model-gemKommando': { opsaet: { model: modelVindue({ tom: true }) }, kor: async (s) => { s.d.hermes.saetModelNoegle = async () => ({ slags: 'kommando', kommando: 'hermes config set ANTHROPIC_API_KEY' }); return aktion(s, 'model-gem', { udbyder: 'anthropic', noegle: 'sk-test-123' }); } },
  'model-gemFejl': { opsaet: { model: modelVindue({ tom: true }) }, kor: async (s) => { s.d.hermes.run = async () => { throw new Error('ECONNREFUSED'); }; return aktion(s, 'model-gem', { udbyder: 'anthropic', noegle: 'sk-test-123' }); } },
  // Step 5
  'imp-ikkeEjer': { opsaet: { person: MEDLEM, importSkriver: skriver() }, kor: A('import-laes', { tekst: 'Hello' }) },
  'imp-udenSkriver': { kor: A('import-laes', { tekst: 'Hello' }) },
  'imp-mappeTom': { opsaet: { importSkriver: skriver({ klar: false }) }, kor: A('import-laes', { tekst: 'Hello' }) },
  'imp-intetValgt': { opsaet: { importSkriver: skriver() }, kor: A('import-laes', {}) },
  'imp-filerUlaesbar': { opsaet: { importSkriver: skriver() }, kor: A('import-laes', { filer: 'not json' }) },
  'imp-forkertType': { opsaet: { importSkriver: skriver() }, kor: A('import-laes', { filer: JSON.stringify([{ navn: 'a.exe', tekst: 'x' }]) }) },
  'imp-forMange': { opsaet: { importSkriver: skriver() }, kor: A('import-laes', { filer: JSON.stringify(Array.from({ length: 201 }, (_, i) => ({ navn: `${i}.txt`, tekst: 'x' }))) }) },
  'imp-filnavn': { opsaet: { importSkriver: skriver() }, kor: A('import-laes', { filer: JSON.stringify([{ navn: '../a.txt', tekst: 'x' }]) }) },
  'imp-filUlaeselig': { opsaet: { importSkriver: skriver() }, kor: A('import-laes', { filer: JSON.stringify([{ navn: 'a.txt' }]) }) },
  'imp-ingenIndhold': { opsaet: { importSkriver: skriver() }, kor: A('import-laes', { filer: JSON.stringify([{ navn: 'a.vcf', tekst: 'garbage' }]) }) },
  'imp-laes': { opsaet: { state: { ...TOM_TILSTAND, kilder: LAESTE }, importSkriver: skriver(), svar: () => fenced({ personer: [{ navn: 'Alma', relation: 'friend' }] }) }, kor: A('import-laes', { tekst: 'Alma is my friend', assistent: 'claude' }) },
  'imp-laesFiler': { opsaet: { state: { ...TOM_TILSTAND, kilder: LAESTE }, importSkriver: skriver(), svar: () => fenced({ personer: [{ navn: 'Alma' }] }) }, kor: A('import-laes', { filer: JSON.stringify([{ navn: 'a.vcf', tekst: 'BEGIN:VCARD\nFN:Alma Test\nEND:VCARD' }]) }) },
  'imp-gem': { opsaet: medSkriver, kor: A('import-gem', { forslagId: 'p1' }) },
  'imp-gemProfil': { opsaet: medSkriver, kor: A('import-gem', { forslagId: 'p3' }) },
  'imp-gemAlle': { opsaet: medSkriver, kor: A('import-gem-alle') },
  'imp-gemFindes': { opsaet: medSkriver, kor: A('import-gem', { forslagId: 'p2' }) },
  'imp-gemUkendt': { opsaet: medSkriver, kor: A('import-gem', { forslagId: 'p9' }) },
  'imp-gemAlleIntet': { opsaet: { state: { ...TOM_TILSTAND, import: { bunke: { tid: STARTET, slags: 'noter', uaendret: 0, forslag: [] } } }, importSkriver: skriver() }, kor: A('import-gem-alle') },
  'imp-gemFejl': { opsaet: { ...medSkriver, importSkriver: { ...skriver(), skrivPerson: async () => { throw new Error('Disk full'); } } }, kor: A('import-gem', { forslagId: 'p1' }) },
  'imp-gemKollision': { opsaet: { ...medSkriver, importSkriver: { ...skriver(), skrivPerson: async () => ({ udfald: 'kollision', sti: 'People/Alma.md', diff: [{ felt: 'relation', nu: 'a', ny: 'b' }] }) } }, kor: A('import-gem', { forslagId: 'p1' }) },
  'imp-opdater': { opsaet: medSkriver, kor: A('import-opdater', { forslagId: 'p2' }) },
  'imp-opdaterSprunget': { opsaet: { ...medSkriver, importSkriver: { ...skriver(), opdaterPerson: async (p) => ({ udfald: 'opdateret', sti: 'People/Bo.md', kvittering: { sti: 'People/Bo.md', sha256: 'c'.repeat(64), forrige: 'old' }, felter: p.diff.map((d) => d.felt), sprunget: ['org', 'relation'] }) } }, kor: A('import-opdater', { forslagId: 'p2' }) },
  'imp-opdaterForandret': { opsaet: { ...medSkriver, importSkriver: { ...skriver(), opdaterPerson: async () => ({ udfald: 'forandret', sti: 'People/Bo.md', sprunget: [] }) } }, kor: A('import-opdater', { forslagId: 'p2' }) },
  'imp-opdaterUaendret': { opsaet: { ...medSkriver, importSkriver: { ...skriver(), opdaterPerson: async () => ({ udfald: 'uaendret', sti: 'People/Bo.md' }) } }, kor: A('import-opdater', { forslagId: 'p2' }) },
  'imp-opdaterFejl': { opsaet: { ...medSkriver, importSkriver: { ...skriver(), opdaterPerson: async () => { throw new Error('Disk full'); } } }, kor: A('import-opdater', { forslagId: 'p2' }) },
  'imp-opdaterUkendt': { opsaet: medSkriver, kor: A('import-opdater', { forslagId: 'p9' }) },
  'imp-opdaterNy': { opsaet: medSkriver, kor: A('import-opdater', { forslagId: 'p1' }) },
  'imp-spring': { opsaet: medSkriver, kor: A('import-spring', { forslagId: 'p1' }) },
  'imp-springFindes': { opsaet: medSkriver, kor: A('import-spring', { forslagId: 'p2' }) },
  'imp-springUkendt': { opsaet: medSkriver, kor: A('import-spring', { forslagId: 'p9' }) },
  'imp-springIkkeEjer': { opsaet: { ...medSkriver, person: MEDLEM }, kor: A('import-spring', { forslagId: 'p1' }) },
  'imp-annuller': { opsaet: medSkriver, kor: A('import-annuller') },
  'imp-annullerTom': { opsaet: { state: TOM_TILSTAND, importSkriver: skriver() }, kor: A('import-annuller') },
  'imp-annullerIkkeEjer': { opsaet: { ...medSkriver, person: MEDLEM }, kor: A('import-annuller') },
  'imp-springTrinOver': { opsaet: { state: { ...TOM_TILSTAND, kilder: LAESTE }, importSkriver: skriver() }, kor: A('import-spring-over') },
  'imp-springTrinIkkeEjer': { opsaet: { state: { ...TOM_TILSTAND, kilder: LAESTE }, importSkriver: skriver(), person: MEDLEM }, kor: A('import-spring-over') },
  'imp-springTrinKlaret': { opsaet: { state: { ...TOM_TILSTAND, kilder: LAESTE, import: { gemt: [{ logId: 'l', tid: STARTET, slags: 'noter', antal: 1 }] } }, importSkriver: skriver() }, kor: A('import-spring-over') },
  'imp-springTrinAlleredeSprunget': { opsaet: { state: { ...TOM_TILSTAND, kilder: LAESTE, trin: { import: { status: 'sprunget-over' } } }, importSkriver: skriver() }, kor: A('import-spring-over') },
  'imp-lavMappe': { opsaet: { state: TOM_TILSTAND, importSkriver: skriver({ klar: false, lavMappe: true }) }, kor: A('import-lav-mappe') },
  'imp-lavMappeFindes': { opsaet: { state: TOM_TILSTAND, importSkriver: skriver({ klar: true, lavMappe: true }) }, kor: A('import-lav-mappe') },
  'imp-lavMappeKanIkke': { opsaet: { state: TOM_TILSTAND, importSkriver: skriver({ klar: false }) }, kor: A('import-lav-mappe') },
  'imp-fortryd': { opsaet: medSkriver, kor: async (s) => { await aktion(s, 'import-gem', { forslagId: 'p1' }); return fortryd(s); } },
  'imp-fortrydOpdater': { opsaet: medSkriver, kor: async (s) => { await aktion(s, 'import-opdater', { forslagId: 'p2' }); return fortryd(s); } },
  'imp-fortrydBeholdt': { opsaet: { ...medSkriver, importSkriver: { ...skriver(), fjernPerson: async () => false } }, kor: async (s) => { await aktion(s, 'import-gem', { forslagId: 'p1' }); return fortryd(s); } },
  'rejse-gennemfoert': { kor: async (s) => { s.nu.rettet = true; await rejsen(s.d); return {}; } },
  // Nu's lines, the chat's empty answer, the suggestion's reason
  'nu-linjer': { kor: async (s) => ({ tekst: JSON.stringify(await startRoom.hjemVenter!(s.d)) }) },
  'chat-tomtSvar': { opsaet: { svar: () => '' }, kor: async (s) => { const run = await startRoom.startChat!(s.d, 'hi', undefined); await run.finished; return { tekst: (await s.d.store.readChat('start', 5)).map((c) => c.tekst).join(' | ') }; } },
  'forslag-grund': {
    kor: async (s) => {
      const tre = Array.from({ length: 3 }, (_, i) => ({ emne: `Invitation: meeting ${i}`, modtaget: '2026-10-30T10:00:00.000Z' }));
      const liste = await foreslaaTilfoejelse({ kilder: [{ id: 'k', navn: 'Calendar', slags: 'kalender', forbundet: false }], mail: async () => tre, nu: STATE_NU, afvist: {} });
      return { tekst: liste.map((f) => f.grund).join(' | ') };
    },
  },
};

export type Optagelse = Record<string, Utfald>;

/** Digits of a measured time vary from run to run; the record keeps the shape only. */
const roligt = (t: string): string => t.replace(/\d+[.,]\d s\b/g, 'N s').replace(/\b\d+ ms\b/g, 'N ms');

export async function optag(): Promise<Optagelse> {
  const ud: Optagelse = {};
  for (const [navn, sc] of Object.entries(SCENARIER)) {
    let u: Resultat = {};
    let log: string[] = [];
    await medStart(sc.opsaet ?? {}, async (s) => {
      u = await sc.kor(s);
      log = (await s.log()).slice().sort();
    });
    const r: Utfald = { ...Object.fromEntries(Object.entries(u).map(([k, v]) => [k, roligt(String(v))])), log: log.map(roligt) };
    ud[navn] = r;
  }
  return ud;
}
