// KC-0170: Univers' refusals, log lines, status and element contexts in English or Danish. The Danish is what the
// room wrote before the strings moved (captured first); in English nothing Danish reaches the toast, the log, the chat,
// the status line or the context chip, and the meeting an element names is found again from either language's context.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { universOversigt, universRoom, beskrivAendring } from '../../src/rooms/univers/room.ts';
import { renderMoedeVisning, renderUnivers } from '../../src/rooms/univers/render.ts';
import { laesIndeks, laesUnivers, opretUnivers, endreIndeks, endreUnivers, findUnivers } from '../../src/rooms/univers/lager.ts';
import type { UniversState } from '../../src/rooms/univers/schema.ts';
import { aktion, iSprog, laes, lavVerden, type Verden } from '../fixtures/sprog-handling.ts';
import { DANSK } from '../fixtures/sprog-tjek.ts';
import type { Sprog } from '../../src/store/profil.ts';

const fenced = (o: unknown): string => '```json\n' + JSON.stringify(o) + '\n```';
const FORBEREDELSE = fenced({ forberedelse: { maal: 'Get it settled', talepunkter: ['Point one', 'Point two'], opgaver: [{ titel: 'Prepare the numbers' }], praesentation: { html: '<h1>Deck</h1><p>Body</p>' } } });
const ELEMENTER = 'Done.\n' + fenced({ elementer: [{ type: 'note', titel: 'A note', tekst: 'Text', zone: 'privat' }, { type: 'opgave', titel: 'A task' }, { type: 'dokument', titel: 'A doc', html: '<p>x</p>', zone: 'privat' }] });
const NYT_UNIVERS = 'Made it.\n' + fenced({ nytUnivers: { navn: 'Hermes universe', om: 'About it' } });
const KANDIDAT = (id: string, titel: string) => ({ eventId: id, titel, start: '2026-10-27T11:00:00Z', slut: '2026-10-27T12:00:00Z', deltagere: [{ navn: 'Tom' }] });

async function bygVerden(svar: string[]): Promise<Verden> {
  const v = await lavVerden({ svar, now: new Date('2026-10-27T08:00:00Z') });
  await endreIndeks(v.store, (i) => ({ ...i, nyeMoeder: [KANDIDAT('e1', 'Kickoff'), KANDIDAT('e2', 'Noise'), KANDIDAT('e3', 'Other')] }));
  return v;
}

async function scenarie(sprog: Sprog | undefined): Promise<string[]> {
  const ud: string[] = [];
  const v = await bygVerden([FORBEREDELSE, ELEMENTER, FORBEREDELSE, '', FORBEREDELSE, NYT_UNIVERS]);
  try {
    const oversigt = (navn: string, body: Record<string, unknown>) => laes(sprog, aktion(universOversigt, v, navn, body));
    ud.push(`new-no-name: ${await oversigt('nytUnivers', {})}`);
    ud.push(`new-long-name: ${await oversigt('nytUnivers', { navn: 'x'.repeat(61) })}`);
    ud.push(`new-long-about: ${await oversigt('nytUnivers', { navn: 'Arena', om: 'x'.repeat(301) })}`);
    ud.push(`new: ${await oversigt('nytUnivers', { navn: 'Arena', om: 'My arena' })}`);
    ud.push(`place-unknown: ${await oversigt('placerMoede', { eventId: 'nope', slug: 'arena' })}`);
    ud.push(`place-no-universe: ${await oversigt('placerMoede', { eventId: 'e1', slug: 'nope' })}`);
    ud.push(`place: ${await oversigt('placerMoede', { eventId: 'e1', slug: 'arena' })}`);
    ud.push(`hide-unknown: ${await oversigt('skjulMoede', { eventId: 'nope' })}`);
    ud.push(`hide: ${await oversigt('skjulMoede', { eventId: 'e2' })}`);
    const rum = universRoom('arena');
    const arena = (navn: string, body: Record<string, unknown>) => laes(sprog, aktion(rum, v, navn, body));
    const state0 = await laesUnivers(v.store, 'arena');
    const moedeId = state0.moeder[0]!.id;
    ud.push(`prepare-unknown: ${await arena('forbered', { moedeId: 'nope' })}`);
    ud.push(`prepare: ${await arena('forbered', { moedeId })}`);
    const efter = await laesUnivers(v.store, 'arena');
    ud.push(`status: ${(await iSprog(sprog, () => rum.view(v.deps))).hermesStatus} | stored=${efter.hermesStatus}`);
    ud.push(`doc-title: ${efter.dokumenter.map((d) => d.titel).join(', ')}`);
    ud.push(`task-bad-status: ${await arena('opgaveStatus', { opgaveId: 'x', status: 'nope' })}`);
    ud.push(`task-unknown: ${await arena('opgaveStatus', { opgaveId: 'nope', status: 'igang' })}`);
    ud.push(`task: ${await arena('opgaveStatus', { opgaveId: efter.opgaver[0]!.id, status: 'igang' })}`);
    ud.push(`meeting-no-title: ${await arena('nytMoede', {})}`);
    ud.push(`meeting-bad-start: ${await arena('nytMoede', { titel: 'Sync', start: 'soon' })}`);
    ud.push(`meeting: ${await arena('nytMoede', { titel: 'Sync', start: '2026-10-28T09:30', varighed: 30 })}`);
    // The chat: elements made, an empty answer, a preparation for the meeting the element names, one that names none
    const chat = async (besked: string, kontekst?: string): Promise<string> => {
      const r = await (await iSprog(sprog, () => rum.startChat(v.deps, besked, kontekst))).finished;
      return `${r.status} ${r.result?.text ?? r.error ?? ''}`;
    };
    ud.push(`chat-elements: ${await chat('Make things')}`);
    const meetingContext = sprog === 'en' ? `The meeting: Kickoff` : 'Mødet: Kickoff';
    ud.push(`chat-prepare: ${await chat('Sharpen the goal', meetingContext)}`);
    ud.push(`chat-empty: ${await chat('Hello?')}`);
    ud.push(`chat-prepare-unclear: ${await chat('Sharpen the goal')}`);
    // The overview chat creates a universe
    const oc = await (await iSprog(sprog, () => universOversigt.startChat(v.deps, 'Make one', undefined))).finished;
    ud.push(`overview-chat: ${oc.status} ${oc.result?.text ?? oc.error ?? ''}`);
    // Undo the preparation, and archive
    const logg = await v.store.readLog('univers-arena', 50);
    const forb = logg.find((e) => e.handlingId?.startsWith('forbered-') && !e.fortrudt);
    const f = await (await iSprog(sprog, () => rum.startFortryd!(v.deps, forb!.id)))!.finished;
    ud.push(`undo: ${f.result?.text ?? f.error}`);
    ud.push(`archive: ${await arena('arkiver', {})}`);
    ud.push(`archive-gone: ${await laes(sprog, () => universRoom('nope').startAction!(v.deps, 'arkiver', {}))}`);
    ud.push(`log: ${logg.map((e) => e.tekst).reverse().join(' | ')}`);
    ud.push(`log-after: ${(await v.store.readLog('univers-arena', 50)).slice(0, 1).map((e) => e.tekst).join('')}`);
    ud.push(`overview-log: ${(await v.store.readLog('univers', 50)).map((e) => e.tekst).reverse().join(' | ')}`);
  } finally { await v.ryd(); }
  return ud;
}

/** Nu's line for a meeting prepared for today. */
async function nuLinje(sprog: Sprog | undefined): Promise<string[]> {
  const v = await bygVerden([]);
  try {
    await opretUnivers(v.store, { navn: 'Arena', om: '' }, v.deps.now());
    await endreUnivers(v.store, 'univers-arena', (s) => ({ ...s, moeder: [{ id: 'moede-1', kilde: 'manuel', titel: 'Kickoff', start: '2026-10-27T11:00:00Z', slut: '2026-10-27T12:00:00Z', deltagere: [], forberedelse: { maal: 'x', deltagere: [], talepunkter: ['a'], tid: '2026-10-27T07:00:00Z' } }] }));
    return (await iSprog(sprog, () => universRoom('arena').hjemVenter(v.deps))).map((l) => l.tekst);
  } finally { await v.ryd(); }
}

test('Univers: beskrivAendring words new and updated elements in the language of the request', () => {
  const b = (type: 'dokument' | 'note' | 'opgave', titel: string, ny: boolean) => ({ type, id: 'x', titel, ny });
  const liste = [b('note', 'A', true), b('opgave', 'B', true), b('opgave', 'C', true), b('dokument', 'D', false), b('note', 'E', false)];
  assert.equal(beskrivAendring(liste), 'Hermes lavede 1 note og 2 opgaver og opdaterede 1 dokument og 1 note: "A", "B", "C" og 2 til.');
  assert.equal(iSprog('da', () => beskrivAendring(liste)), beskrivAendring(liste));
  assert.equal(iSprog('en', () => beskrivAendring(liste)), 'Hermes made 1 note and 2 tasks and updated 1 document and 1 note: "A", "B", "C" and 2 more.');
});

test('Univers: the meeting an element names is found again from either language\'s context (the chat chip), in either language of the request', async () => {
  const { erMoedeKontekst } = await import('../../src/rooms/univers/tekster.ts');
  const v = await bygVerden([]);
  try {
    await opretUnivers(v.store, { navn: 'Arena', om: '' }, v.deps.now());
    await endreUnivers(v.store, 'univers-arena', (s) => ({ ...s, moeder: [{ id: 'moede-1', kilde: 'manuel', titel: 'Kickoff', start: '2026-10-27T11:00:00Z', slut: '2026-10-27T12:00:00Z', deltagere: [] }] }));
    const info = findUnivers(await laesIndeks(v.store), 'arena')!;
    const state = await laesUnivers(v.store, 'arena');
    // What the pages hand over: the meeting card, and the meeting page's header
    const kontekster = (sprog: Sprog): string[] => {
      const kort = String(iSprog(sprog, () => renderUnivers(info, state, v.deps.now(), {})));
      const side = String(iSprog(sprog, () => renderMoedeVisning(info, state.moeder[0]!, state, v.deps.now())));
      return [...kort.matchAll(/uv-moede-kort" data-element="([^"]*)"/g), ...side.matchAll(/uv-moedehoved" data-element="([^"]*)"/g)].map((m) => m[1]!);
    };
    assert.deepEqual(kontekster('da'), ['Møde: Kickoff', 'Mødet: Kickoff']);
    assert.deepEqual(kontekster('en'), ['Meeting: Kickoff', 'The meeting: Kickoff']);
    for (const k of [...kontekster('da'), ...kontekster('en'), 'Møde: Kickoff', 'Mødet: Kickoff']) assert.ok(erMoedeKontekst(k, 'Kickoff'), k);
    assert.ok(!erMoedeKontekst('Meeting: Other', 'Kickoff'));
    assert.ok(!erMoedeKontekst('Note: Kickoff', 'Kickoff'));
    // Round trip through the room: a preparation pointed at the meeting by either language's context lands on it
    for (const sprog of ['da', 'en'] as const) {
      for (const k of [...kontekster('da'), ...kontekster('en')]) {
        const w = await bygVerden([FORBEREDELSE]);
        try {
          await opretUnivers(w.store, { navn: 'Arena', om: '' }, w.deps.now());
          await endreUnivers(w.store, 'univers-arena', (s) => ({ ...s, moeder: [{ id: 'moede-1', kilde: 'manuel', titel: 'Kickoff', start: '2026-10-27T11:00:00Z', slut: '2026-10-27T12:00:00Z', deltagere: [] }] }));
          const r = await (await iSprog(sprog, () => universRoom('arena').startChat(w.deps, 'Sharpen it', k))).finished;
          assert.equal(r.status, 'done', `${sprog} request, context "${k}": ${r.error ?? ''}`);
          assert.ok((await laesUnivers(w.store, 'arena')).moeder[0]!.forberedelse, `${sprog} request, context "${k}"`);
        } finally { await w.ryd(); }
      }
    }
  } finally { await v.ryd(); }
});

test('Univers: a stored Danish status still reads in English; Hermes\' own words are shown as they are', async () => {
  const v = await bygVerden([]);
  try {
    await opretUnivers(v.store, { navn: 'Arena', om: '' }, v.deps.now());
    const sæt = async (hermesStatus: string): Promise<void> => { await endreUnivers(v.store, 'univers-arena', (s: UniversState) => ({ ...s, hermesStatus })); };
    await sæt('Forberedte "Kickoff"');
    assert.equal((await iSprog('en', () => universRoom('arena').view(v.deps))).hermesStatus, 'Prepared "Kickoff"');
    assert.equal((await iSprog('da', () => universRoom('arena').view(v.deps))).hermesStatus, 'Forberedte "Kickoff"');
    await sæt('Sorterer noterne');
    assert.equal((await iSprog('en', () => universRoom('arena').view(v.deps))).hermesStatus, 'Sorterer noterne');
  } finally { await v.ryd(); }
});

test('Univers: Nu\'s line for a prepared meeting is in the language of the request', async () => {
  assert.deepEqual(await nuLinje(undefined), ['Mødet "Kickoff" kl. 12.00 er forberedt (Arena)']);
  assert.deepEqual(await nuLinje('da'), ['Mødet "Kickoff" kl. 12.00 er forberedt (Arena)']);
  assert.deepEqual(await nuLinje('en'), ['The meeting "Kickoff" at 12:00 is prepared (Arena)']);
});

test('Univers: Danish (no language, and da) is what the room said before', async () => {
  const a = await scenarie(undefined);
  assert.deepEqual(await scenarie('da'), a);
  assert.deepEqual(a, DANSK_FORVENTET);
});

test('Univers: English says everything in English, and no Danish line is left', async () => {
  const en = await scenarie('en');
  assert.deepEqual(en.filter((l) => DANSK.test(l)), []);
  assert.deepEqual(en, ENGELSK_FORVENTET);
});

const DANSK_FORVENTET: string[] = [
  "new-no-name: afvist 400: Giv universet et navn",
  "new-long-name: afvist 400: Navnet må højst være 60 tegn",
  "new-long-about: afvist 400: Beskrivelsen må højst være 300 tegn",
  "new: ok: Universet \"Arena\" er oprettet.",
  "place-unknown: afvist 400: Mødet er ikke blandt de nye møder (længere)",
  "place-no-universe: afvist 400: Universet findes ikke",
  "place: ok: Mødet ligger nu i \"Arena\".",
  "hide-unknown: afvist 400: Mødet er ikke blandt de nye møder (længere)",
  "hide: ok: ",
  "prepare-unknown: afvist 400: Mødet findes ikke",
  "prepare: ok: Mødet \"Kickoff\" er forberedt.",
  "status: Forberedte \"Kickoff\" | stored=Forberedte \"Kickoff\"",
  "doc-title: Præsentation",
  "task-bad-status: afvist 400: Ukendt status",
  "task-unknown: afvist 400: Opgaven findes ikke",
  "task: ok: ",
  "meeting-no-title: afvist 400: Giv mødet en titel",
  "meeting-bad-start: afvist 400: Starttidspunktet kan ikke læses",
  "meeting: ok: Mødet \"Sync\" er tilføjet.",
  "chat-elements: done Done.",
  "chat-prepare: done (intet svar)",
  "chat-empty: done (intet svar)",
  "chat-prepare-unclear: failed Hermes svarede med en forberedelse, men det er ikke klart, hvilket møde den gælder (peg på et møde først)",
  "overview-chat: done Made it.",
  "undo: Fortrudt.",
  "archive: ok: Universet \"Arena\" er arkiveret.",
  "archive-gone: afvist 400: Universet findes ikke",
  "log: Hermes forberedte mødet \"Kickoff\": 2 talepunkter, 1 opgaver, en præsentation. | Tilføjede mødet \"Sync\" (09.30). | Hermes lavede 1 dokument og 1 note og 1 opgave: \"A note\", \"A task\", \"A doc\". | Hermes forberedte mødet \"Kickoff\": 2 talepunkter, 1 opgaver, en præsentation.",
  "log-after: Fortrudt: Hermes forberedte mødet \"Kickoff\": 2 talepunkter, 1 opgaver, en præsentation.",
  "overview-log: Oprettede universet \"Arena\". | Lagde mødet \"Kickoff\" i universet \"Arena\". | Skjulte mødet \"Noise\" (ikke et møde for Henrik). | Oprettede universet \"Hermes universe\". | Arkiverede universet \"Arena\".",
];
const ENGELSK_FORVENTET: string[] = [
  "new-no-name: afvist 400: Give the universe a name",
  "new-long-name: afvist 400: The name can be 60 characters at most",
  "new-long-about: afvist 400: The description can be 300 characters at most",
  "new: ok: The universe \"Arena\" has been created.",
  "place-unknown: afvist 400: The meeting is not among the new meetings (any more)",
  "place-no-universe: afvist 400: The universe does not exist",
  "place: ok: The meeting is now in \"Arena\".",
  "hide-unknown: afvist 400: The meeting is not among the new meetings (any more)",
  "hide: ok: ",
  "prepare-unknown: afvist 400: The meeting does not exist",
  "prepare: ok: The meeting \"Kickoff\" is prepared.",
  "status: Prepared \"Kickoff\" | stored=Prepared \"Kickoff\"",
  "doc-title: Presentation",
  "task-bad-status: afvist 400: Unknown status",
  "task-unknown: afvist 400: The task does not exist",
  "task: ok: ",
  "meeting-no-title: afvist 400: Give the meeting a title",
  "meeting-bad-start: afvist 400: The start time cannot be read",
  "meeting: ok: The meeting \"Sync\" has been added.",
  "chat-elements: done Done.",
  "chat-prepare: done (no answer)",
  "chat-empty: done (no answer)",
  "chat-prepare-unclear: failed Hermes answered with a preparation, but it is not clear which meeting it is for (point at a meeting first)",
  "overview-chat: done Made it.",
  "undo: Undone.",
  "archive: ok: The universe \"Arena\" has been archived.",
  "archive-gone: afvist 400: The universe does not exist",
  "log: Hermes prepared the meeting \"Kickoff\": 2 talking points, 1 task, a presentation. | Added the meeting \"Sync\" (09:30). | Hermes made 1 document and 1 note and 1 task: \"A note\", \"A task\", \"A doc\". | Hermes prepared the meeting \"Kickoff\": 2 talking points, 1 task, a presentation.",
  "log-after: Undone: Hermes prepared the meeting \"Kickoff\": 2 talking points, 1 task, a presentation.",
  "overview-log: Created the universe \"Arena\". | Put the meeting \"Kickoff\" in the universe \"Arena\". | Hid the meeting \"Noise\" (not a meeting for you). | Created the universe \"Hermes universe\". | Archived the universe \"Arena\".",
];
