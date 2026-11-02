// KC-0241: fixed inputs for every prompt builder of Nyheder, Skrive, Start, Univers, Husstanden and the import. The
// files in test/fixtures/sprog-prompt-rum-b/ were captured from these inputs BEFORE the room's own words moved into
// the prompt-tekster.ts tables; the tests (test/rooms/*-prompt.test.ts, test/hushold/prompt.test.ts,
// test/rooms/start-prompt.test.ts, test/rooms/start/import-foreslaa.test.ts) hold the Danish prompts to them byte for
// byte, with no language chosen and inside medSprog('da'). The content (titles, names, notes) is English or a bare
// name, so an English run shows only the words the room itself writes. Change a golden only when the Danish prompt
// changes on purpose. The run's random boundary is replaced by a fixed word (`fastGraense`).

import { readFileSync } from 'node:fs';
import { elementSegment, fortrydOpgave, GRAENSER, handlingsOpgave, pegerTekst, SPROG } from '../../src/agent/prompt.ts';
import { medSprog } from '../../src/store/sprog.ts';
import { udenData, udpak } from '../../src/agent/udtroet.ts';
import { DANSK } from './sprog-tjek.ts';
import { konfliktResume } from '../../src/hushold/konflikt.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNyhederChatRun, buildNyhederFortrydRun, buildNyhederHandlingRun, buildNyhederHentRun, buildNyhederRefreshRun } from '../../src/rooms/nyheder/prompt.ts';
import { beskrivType, buildForslagRun, buildNytRun, buildSkriveChatRun } from '../../src/rooms/skrive/prompt.ts';
import { buildStartChatRun } from '../../src/rooms/start/prompt.ts';
import { buildForberedRun, buildOversigtChatRun, buildUniversChatRun } from '../../src/rooms/univers/prompt.ts';
import { buildForespForslagRun, buildHusstandChatRun, buildKonfliktRun, buildSammenfaldForslagRun } from '../../src/hushold/prompt.ts';
import { byggImportRun } from '../../src/rooms/start/import/foreslaa.ts';
import type { NyhederState } from '../../src/rooms/nyheder/schema.ts';
import type { TrimmedNyheder } from '../../src/rooms/nyheder/source.ts';
import type { Dokument } from '../../src/rooms/skrive/schema.ts';
import { tomtIndeks, tomtUnivers, type Moede, type UniversInfo, type UniversState } from '../../src/rooms/univers/schema.ts';
import type { Medlem } from '../../src/hushold/schema.ts';
import type { FaellesDag } from '../../src/hushold/uge.ts';
import { nyForespoergsel } from '../../src/hushold/foresp.ts';
import { nySammenfald, type Ressource } from '../../src/hushold/ressource.ts';
import { nytKonflikt, weekendKonflikter } from '../../src/hushold/konflikt.ts';

export type Koersel = { instructions: string; input: string };

/** The run's boundary is 24 random hex characters; a fixed word stands in so a prompt can be compared byte for byte. */
export const fastGraense = (s: string): string => s.replace(/\b[0-9a-f]{24}\b/g, 'GRAENSE');
const k = (r: Koersel): Koersel => ({ instructions: fastGraense(r.instructions), input: fastGraense(r.input) });

/** The element a chat run points at (the screen's own label for it), by room. */
export const KONTEKST = {
  nyheder: 'News item: Energy firm tightens reserves', skrive: 'Paragraph 2', start: 'Step: Your sources', univers: 'Note: Idea',
  oversigt: 'Universe: My arena', husstand: 'Booking: The big car',
} as const;

export const NU = new Date('2026-10-27T07:10:00.000Z');

// ---------- Nyheder ----------

const nyheder: TrimmedNyheder = {
  dato: '2026-10-27',
  nyheder: [{ titel: 'Energy firm tightens reserves', kilde: 'Example Energy', url: 'https://example.org/a', resume: 'Short summary.' }],
  kilder: { antal: 25, medNyheder: 9, nyheder: 1, fejlede: [] },
};
const nyhederFejlede: TrimmedNyheder = { ...nyheder, kilder: { antal: 25, medNyheder: 7, nyheder: 1, fejlede: ['Alpha Feed', 'Beta Feed'] } };
const nyhederState: NyhederState = {
  dato: '2026-10-27', genereret: '2026-10-27T06:00:00.000Z',
  femLinjer: ['Reserves are tightening.', 'A new model is out.'],
  baner: [{ navn: 'Energy', nyheder: [{ id: 'n1', titel: 'Energy firm tightens reserves', hvorfor: 'Relevant.', kilde: 'Example Energy', url: 'https://example.org/a' }] }],
  forslag: [], nyhedsbreve: [], kilder: nyheder.kilder, gemt: [], hermesStatus: 'Watching the paper',
};

// ---------- Skrive ----------

export const dok: Dokument = {
  id: 'dok-1', titel: 'Winter plan', brief: 'A short mail to operations about the winter plan',
  afsnit: [{ id: 'a1', tekst: 'Hello Tom.' }, { id: 'a2', tekst: 'We tighten the reserves.' }], kilder: [], oprettet: 'x', aendret: 'x',
};
export const SKRIVE_TYPER = ['stram', 'konkret', 'kortere', 'varmere', 'something-else'] as const;

// ---------- Univers ----------

const univInfo: UniversInfo = { id: 'my-arena', navn: 'My arena', om: 'My new leadership role', oprettet: NU.toISOString() };
const univInfoUdenOm: UniversInfo = { ...univInfo, om: '' };
const moede: Moede = {
  id: 'meeting-1', kilde: 'manuel', titel: 'Pitch to Tom', start: '2026-10-28T08:00:00.000Z', slut: '2026-10-28T09:00:00.000Z', sted: 'Room 4',
  deltagere: [{ navn: 'Jonas Holm', email: 'jonas@example.org' }, { navn: 'Line Berg' }],
};
const moedeUden: Moede = { id: 'meeting-2', kilde: 'manuel', titel: 'Catch-up', start: '2026-10-29T09:00:00.000Z', slut: '2026-10-29T09:30:00.000Z', deltagere: [] };
const moedeForberedt: Moede = {
  ...moede,
  forberedelse: {
    maal: 'Agree the plan', tid: NU.toISOString(), talepunkter: ['Status', 'Plan'],
    deltagere: [{ navn: 'Jonas Holm', hvem: 'The supplier', baggrund: 'Ten years in the trade.', vil: 'A longer contract.' }],
  },
};
const moedeForberedtUdenDeltagere: Moede = { ...moedeUden, forberedelse: { maal: 'Say hello', tid: NU.toISOString(), talepunkter: ['Hello'], deltagere: [] } };
const univFuld: UniversState = {
  ...tomtUnivers(),
  dokumenter: [
    { id: 'doc-aaaa1111', titel: 'Pitch', html: '<h1>Pitch</h1>', tekst: 'Pitch\nWe build something.', versioner: [], oprettet: NU.toISOString(), aendret: NU.toISOString(), moedeId: 'meeting-1' },
    { id: 'doc-bbbb2222', titel: 'Plan', html: '<h1>Plan</h1><p>Step one.</p>', tekst: '', versioner: [{ html: 'x', tekst: 'x', tid: NU.toISOString() }], oprettet: NU.toISOString(), aendret: '2026-10-26T10:00:00.000Z' },
    { id: 'doc-cccc3333', titel: 'Long', html: '', tekst: 'x'.repeat(2600), versioner: [], oprettet: NU.toISOString(), aendret: '2026-10-25T10:00:00.000Z' },
  ],
  noter: [{ id: 'note-bbbb2222', titel: 'Idea', tekst: 'Start with the customers', oprettet: NU.toISOString() }],
  opgaver: [
    { id: 'task-1', titel: 'Find the numbers', note: 'from operations', status: 'igang', moedeId: 'meeting-1' },
    { id: 'task-2', titel: 'Book the room', status: 'aaben' },
    { id: 'task-3', titel: 'Send the invite', status: 'faerdig' },
  ],
  moeder: [moede, moedeUden],
};

// ---------- Husstanden ----------

const medlemmer: Medlem[] = [
  { id: 'henrik', navn: 'Henrik', rolle: 'ejer' }, { id: 'maja', navn: 'Maja', rolle: 'medlem', relation: 'the partner' },
  { id: 'ella', navn: 'Ella', rolle: 'barn' }, { id: 'gus', navn: 'Gus', rolle: 'gaest' },
];
const uge: FaellesDag[] = [
  { dato: '2026-11-06', poster: [
    { id: 'p1', titel: 'Pickup at school', start: '2026-11-06T15:00:00+01:00', heldag: false, hvem: ['maja'], kilde: 'kalender' },
    { id: 'p2', titel: 'Family dinner', start: '2026-11-06T18:00:00+01:00', heldag: false, hvem: [], kilde: 'kalender' },
  ] },
  { dato: '2026-11-07', poster: [{ id: 'p3', titel: 'Birthday', start: '2026-11-07', heldag: true, hvem: ['henrik', 'maja'], kilde: 'kalender' }] },
];
const stor: Ressource = { id: 'big-car', navn: 'The big car', slags: 'bil', ejere: ['henrik', 'maja'], kalender: [
  { id: 'b1', ressourceId: 'big-car', af: 'maja', start: '2026-11-07T07:00:00.000Z', slut: '2026-11-07T15:00:00.000Z', titel: 'Shopping trip' },
  { id: 'b2', ressourceId: 'big-car', af: 'henrik', start: '2026-11-09T07:00:00.000Z', slut: '2026-11-09T08:00:00.000Z', titel: 'Workshop' },
] };
/** A booking by someone who is neither party of the clash: the prompt must name them as "someone else". */
const storMedTredje: Ressource = { ...stor, kalender: [...stor.kalender, { id: 'b3', ressourceId: 'big-car', af: 'ella', start: '2026-11-08T07:00:00.000Z', slut: '2026-11-08T08:00:00.000Z', titel: 'Swimming lesson' }] };
const lille: Ressource = { id: 'small-car', navn: 'The small car', slags: 'bil', ejere: ['henrik'], kalender: [] };
const ejerloes: Ressource = { id: 'guest-room', navn: 'Guest room', slags: 'rum', ejere: [], kalender: [] };
export const HUS_NU = new Date('2026-11-02T08:00:00.000Z');
const foresp = nyForespoergsel({ id: 'f1', fra: 'henrik', til: 'maja', titel: 'Can you take the 16.00 pickup', tid: { start: '2026-11-05T15:00:00.000Z', slut: '2026-11-05T16:00:00.000Z' } }, HUS_NU);
const forespUdenTid = nyForespoergsel({ id: 'f2', fra: 'maja', til: 'henrik', titel: 'Can you call the plumber' }, HUS_NU);
const sf = nySammenfald({ id: 's1', ny: { id: 'w1', ressourceId: 'big-car', af: 'henrik', start: '2026-11-07T09:00:00.000Z', slut: '2026-11-07T13:00:00.000Z', titel: 'Groceries' }, mod: stor.kalender[0]!, ressourcer: [stor, lille], nu: new Date('2026-11-05T07:00:00.000Z') });
const blok = (hvem: string, fra: string, til: string, titel?: string) => ({ hvem, start: `2026-11-07T${fra}:00+01:00`, slut: `2026-11-07T${til}:00+01:00`, med: [hvem], ...(titel ? { titel } : {}) });
const konflikt = nytKonflikt({
  id: 'k1', nu: new Date('2026-11-03T06:30:00Z'),
  kandidat: weekendKonflikter([blok('henrik', '09:00', '14:00', 'Football match'), blok('maja', '11:00', '13:00')], { medlemmer: medlemmer.slice(0, 3), ressourcer: [] }, ['2026-11-07'])[0]!,
});

// ---------- the import ----------

const kontakter = [{ navn: 'Iris Bakke', org: 'Fyrtaarn', foedselsdag: '1984-03-12', noter: 'Runs on Tuesdays\nand Thursdays' }, { navn: 'Plain Person' }];

/** Every prompt the six files build, by name: the Danish goldens are test/fixtures/sprog-prompt-rum-b/<name>.txt. */
export const PROMPTER: Record<string, () => Koersel> = {
  'nyheder-refresh': () => k(buildNyhederRefreshRun(nyheder, NU)),
  'nyheder-refresh-fejlede': () => k(buildNyhederRefreshRun(nyhederFejlede, NU)),
  'nyheder-hent': () => k(buildNyhederHentRun(NU)),
  'nyheder-handling': () => k(buildNyhederHandlingRun('Save for later', 'Save the article to the vault', nyhederState, 'bogfoer')),
  'nyheder-handling-forbudt': () => k(buildNyhederHandlingRun('Pay', 'Pay the bill', nyhederState, 'betal')),
  'nyheder-fortryd': () => k(buildNyhederFortrydRun('Remove the saved article')),
  'nyheder-chat': () => k(buildNyhederChatRun('What is in the paper?', undefined, nyhederState)),
  'nyheder-chat-kontekst': () => k(buildNyhederChatRun('Tell me more', KONTEKST.nyheder, nyhederState)),
  'nyheder-chat-tom': () => k(buildNyhederChatRun('Hello', undefined, null)),

  'skrive-nyt': () => k(buildNytRun('Thank-you mail', 'A short mail to operations')),
  'skrive-nyt-uden-titel': () => k(buildNytRun('', 'A short mail to operations')),
  'skrive-forslag-stram': () => k(buildForslagRun(dok, 'a2', 'stram')),
  'skrive-forslag-konkret': () => k(buildForslagRun(dok, 'a2', 'konkret')),
  'skrive-forslag-kortere-hele': () => k(buildForslagRun(dok, null, 'kortere')),
  'skrive-forslag-varmere-hele': () => k(buildForslagRun(dok, null, 'varmere')),
  'skrive-forslag-ukendt': () => k(buildForslagRun(dok, 'a1', 'something-else')),
  'skrive-typer': () => ({ instructions: SKRIVE_TYPER.map((t) => beskrivType(t)).join('\n'), input: '' }),
  'skrive-chat': () => k(buildSkriveChatRun('Make the end warmer', undefined, dok)),
  'skrive-chat-kontekst': () => k(buildSkriveChatRun('Make this warmer', KONTEKST.skrive, dok)),
  'skrive-chat-uden-udkast': () => k(buildSkriveChatRun('Hello', undefined, null)),

  'start-chat': () => k(buildStartChatRun('How do I start?', undefined, [{ titel: 'Your name', status: 'klaret' }, { titel: 'Your sources', status: 'i-gang' }, { titel: 'Your people', status: 'ikke-startet' }, { titel: 'Your voice', status: 'sprunget-over' }])),
  'start-chat-kontekst': () => k(buildStartChatRun('Tell me more', KONTEKST.start, [{ titel: 'Your sources', status: 'i-gang' }])),
  'start-chat-ingen-trin': () => k(buildStartChatRun('Hello', undefined, [])),

  'univers-chat': () => k(buildUniversChatRun(univInfo, univFuld, 'Make the pitch shorter', undefined, NU)),
  'univers-chat-kontekst-tomt': () => k(buildUniversChatRun(univInfoUdenOm, tomtUnivers(), 'Hello', KONTEKST.univers, NU)),
  'univers-forbered': () => k(buildForberedRun(univInfo, univFuld, moede, 'A decision on the budget', NU)),
  'univers-forbered-forberedt': () => k(buildForberedRun(univInfo, univFuld, moedeForberedt, '   ', NU)),
  'univers-forbered-bar': () => k(buildForberedRun(univInfoUdenOm, tomtUnivers(), moedeUden, '', NU)),
  'univers-forbered-forberedt-uden-deltagere': () => k(buildForberedRun(univInfo, tomtUnivers(), moedeForberedtUdenDeltagere, 'Hello', NU)),
  'univers-oversigt': () => k(buildOversigtChatRun({ ...tomtIndeks(), univers: [univInfo, univInfoUdenOm, { ...univInfo, id: 'old', navn: 'Old one', arkiveret: NU.toISOString() }] }, 'Make a universe about my garden', undefined, NU)),
  'univers-oversigt-tom-kontekst': () => k(buildOversigtChatRun(tomtIndeks(), 'Hello', KONTEKST.oversigt, NU)),

  'husstand-chat': () => k(buildHusstandChatRun('Who picks up on Friday?', undefined, medlemmer, uge)),
  'husstand-chat-ting': () => k(buildHusstandChatRun('I need the big car on Saturday', KONTEKST.husstand, medlemmer, uge, [stor, lille, ejerloes], HUS_NU)),
  'husstand-chat-tom': () => k(buildHusstandChatRun('Hello', undefined, [], [], [], HUS_NU)),
  'husstand-chat-tom-uge': () => k(buildHusstandChatRun('Hello', undefined, medlemmer, [{ dato: '2026-11-06', poster: [] }], [], HUS_NU)),
  'husstand-foresp': () => k(buildForespForslagRun(foresp, medlemmer, uge)),
  'husstand-foresp-uden-tid': () => k(buildForespForslagRun(forespUdenTid, medlemmer, [])),
  'husstand-sammenfald': () => k(buildSammenfaldForslagRun(sf, stor, medlemmer, [stor, lille])),
  'husstand-sammenfald-tredje': () => k(buildSammenfaldForslagRun(sf, storMedTredje, medlemmer, [storMedTredje, lille])),
  'husstand-konflikt': () => k(buildKonfliktRun(konflikt, medlemmer)),
  'husstand-konflikt-ukendt': () => k(buildKonfliktRun(konflikt, [medlemmer[0]!, medlemmer[2]!])),

  'import-tekst': () => k(byggImportRun({ slags: 'chatgpt', tekst: 'Ingrid is my wife.' })),
  'import-alt': () => k(byggImportRun({ slags: 'flere', tekst: 'Ingrid is my wife.', kontakter, noter: [{ titel: 'Running', tekst: 'Tuesday and Thursday' }, { titel: 'Food', tekst: 'No nuts' }] })),
  'import-tom': () => k(byggImportRun({ slags: 'ingen' })),
};

const rod = path.dirname(fileURLToPath(import.meta.url));
/** A run as the golden files hold it. */
export const samlet = (r: Koersel): string => `=== instructions ===\n${r.instructions}\n=== input ===\n${r.input}\n`;
/** The golden of one case, captured from the Danish code before the words moved. */
export const golden = (navn: string): string => readFileSync(path.join(rod, 'sprog-prompt-rum-b', `${navn}.txt`), 'utf8');
/** The names of the cases whose name starts with `foran`. */
export const navneMed = (foran: string): string[] => Object.keys(PROMPTER).filter((n) => n.startsWith(foran));

// ---------- what the English tests judge ----------

/** What each case's English run must not be judged on: the weekend card's fixed sentences (konflikt.ts, still Danish). */
const ekstraFaelles = (navn: string): string[] => {
  if (!navn.startsWith('husstand-konflikt')) return [];
  const { tekst: _t, ...uden } = konflikt;
  return [medlemmer, [medlemmer[0]!, medlemmer[2]!]].map((m) => { const f = konfliktResume(uden, m); return `${f.resume} ${f.spoergsmaal}`; });
};

/** The words the shared prompt builder writes (src/agent/prompt.ts, src/agent/udtroet.ts): another surface, judged by its own test. */
const faelles = (): string[] => {
  const hvemer = ['Henrik', 'Brugeren', 'The user'];
  const verber = ['laes', 'sorter', 'bogfoer', 'forbered', 'udfoer-med-fortryd', 'send-til-andre', 'slet', 'betal', 'ukendt'];
  return [
    GRAENSER, SPROG, fortrydOpgave(), pegerTekst(), ...hvemer.map((h) => pegerTekst(h)), ...verber.map((v) => handlingsOpgave(v)),
    ...Object.values(KONTEKST).flatMap((k) => hvemer.map((h) => elementSegment(k, 'privat', h)[0]!.tekst)),
  ];
};

/** An English run without the shared paragraphs and the data wrappers: what the room itself wrote. */
export function egenTekst(navn: string): string {
  return medSprog('en', () => {
    const r = PROMPTER[navn]!();
    let t = `${r.instructions}\n${r.input}`;
    for (const f of [...faelles(), ...ekstraFaelles(navn)]) t = t.split(f).join('');
    return t.split('\n').filter((l) => !/^\s*(?:Zone: |Data: |Data fra |Data from |⟦)/.test(l)).join('\n');
  });
}

/** The lines of an English run that the room wrote itself and that read as Danish: [] when the room's words are English. */
export const egneDanskeLinjer = (navn: string): string[] => egenTekst(navn).split('\n').map((l) => l.trim()).filter((l) => l && DANSK.test(l));

/** The JSON field names inside the ```json fences of a prompt: what the app parses an answer by. */
export const jsonNoegler = (instructions: string): string[] =>
  [...new Set([...instructions.matchAll(/```json\n([\s\S]*?)```/g)].flatMap((m) => [...m[1]!.matchAll(/"([A-Za-z]+)"\s*:/g)].map((x) => x[1]!)))].sort();

/** The shape of a prompt that must not change with the language: fences, bullets and paragraphs of the instructions. */
export const struktur = (instructions: string): { fences: number; punkter: number; afsnit: number } => ({
  fences: (instructions.match(/```/g) ?? []).length,
  punkter: (instructions.match(/^- /gm) ?? []).length,
  afsnit: instructions.split('\n\n').length,
});

/** udpak / udenData on a prompt whose boundary was fixed by fastGraense (udpak wants a hex boundary). */
const hexGraense = (input: string): string => input.replaceAll('GRAENSE', '0123456789abcdef01234567');
export const pak = (input: string): ReturnType<typeof udpak> => udpak(hexGraense(input));
export const utenData = (input: string): string => udenData(hexGraense(input));
