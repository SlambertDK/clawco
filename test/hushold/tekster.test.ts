// KC-0170 slice 2, Husstanden: the room's screens in English or Danish. One table per language (src/hushold/tekster.ts),
// Danish when no language is chosen, so Henrik's installation renders byte for byte as before (the goldens in
// test/fixtures/sprog-husstand/ were captured before the strings moved); English has no Danish word left on the screens
// of the room — except the two things that are not the screen's: the exact message that goes out on a member's channel
// (the household's, Danish for now) and the reasons kanal.ts/invitation.ts give for a refused send.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HUSSTAND_TEKSTER, husstandTekst } from '../../src/hushold/tekster.ts';
import { medSprog, sprogNu } from '../../src/shell/tekster.ts';
import { datoLinje, klokke } from '../../src/hushold/render.ts';
import { createApp } from '../../src/server.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { lavProfilLager } from '../../src/store/profil.ts';
import { skrivHusstand } from '../../src/identitet/husstand.ts';
import { konfliktTekstVis, tidSagVis } from '../../src/hushold/konflikt-render.ts';
import { konfliktResume, tidSag } from '../../src/hushold/konflikt.ts';
import { HUSSTAND, DELE } from '../fixtures/sprog-golden-husstand.ts';
import { form, tomme, ensStrenge, danskeLinjer } from '../fixtures/sprog-tjek.ts';

const rod = path.dirname(fileURLToPath(import.meta.url));
const fixtur = (navn: string): string => readFileSync(path.join(rod, '../fixtures/sprog-husstand', `${navn}.html`), 'utf8');
const tmp = await mkdtemp(path.join(tmpdir(), 'kc-husstand-sprog-'));
after(() => rm(tmp, { recursive: true, force: true }));

test('English has exactly Danish\'s keys and shapes; no string is empty', () => {
  assert.deepEqual(form(HUSSTAND_TEKSTER.en), form(HUSSTAND_TEKSTER.da));
  for (const t of [HUSSTAND_TEKSTER.da, HUSSTAND_TEKSTER.en]) assert.deepEqual(tomme(t as unknown as Record<string, unknown>), []);
});

/** The same in both languages on purpose: a name, or a word English borrows. */
const ENS = new Set(['drop', 'weekend', 'book', 'slagsNavn.person', 'ugeBogstaver.0', 'ugeBogstaver.1', 'ugeBogstaver.2', 'ugeBogstaver.4', 'ugeBogstaver.5']);

test('English is actually English: no Danish string copied over', () => {
  const ens = ensStrenge(HUSSTAND_TEKSTER.da as unknown as Record<string, unknown>, HUSSTAND_TEKSTER.en as unknown as Record<string, unknown>);
  assert.deepEqual(ens.filter((k) => !ENS.has(k)), []);
});

test('no language set is Danish; medSprog sets it for one render', () => {
  assert.equal(sprogNu(), 'da');
  assert.equal(husstandTekst(), HUSSTAND_TEKSTER.da);
  assert.equal(medSprog('en', () => husstandTekst()), HUSSTAND_TEKSTER.en);
});

test('Henrik\'s installation: with no language chosen every screen of the room renders byte for byte as before', () => {
  const filer = readdirSync(path.join(rod, '../fixtures/sprog-husstand')).sort();
  assert.deepEqual(Object.keys(HUSSTAND).map((k) => `${k}.html`).sort(), filer, 'every golden has a case');
  for (const [navn, lav] of Object.entries(HUSSTAND)) {
    assert.equal(lav(), fixtur(navn), navn);
    assert.equal(medSprog('da', lav), fixtur(navn), `${navn} (da chosen)`);
  }
});

test('the date and clock words: Danish as before (the default), English when asked; the clock is Copenhagen\'s in both', () => {
  const nu = new Date('2026-11-03T08:00:00Z');
  assert.equal(datoLinje('2026-11-03', nu), 'I dag');
  assert.equal(datoLinje('2026-11-07', nu), 'Lørdag 7. nov');
  assert.equal(datoLinje('2026-11-03', nu, 'en'), 'Today');
  assert.equal(datoLinje('2026-11-04', nu, 'en'), 'Tomorrow');
  assert.equal(datoLinje('2026-11-07', nu, 'en'), 'Saturday 7 Nov');
  assert.equal(klokke('2026-11-05T15:30:00.000Z'), '16.30');
  assert.equal(klokke('2026-11-05T15:30:00.000Z', 'en'), '16:30');
  assert.equal(medSprog('en', () => datoLinje('2026-11-07', nu, sprogNu())), 'Saturday 7 Nov');
});

// ---- English: no Danish on the screens -----------------------------------------------------------------------------

/** What the owner reads is the screen's; the exact message to a member's channel and kanal.ts' reasons are not (see the head). */
const udenBeskeder = (doc: string): string => doc
  .replace(/<p class="row-note kanal-tekst"[^>]*>[\s\S]*?<\/p>/g, '')
  .replace(/<p class="row-note" data-(?:kanal|invitation)-ikke>[\s\S]*?<\/p>/g, '');

for (const [navn, lav] of Object.entries(HUSSTAND)) {
  test(`English: ${navn} has no Danish word`, () => {
    const doc = medSprog('en', lav);
    assert.deepEqual(danskeLinjer(udenBeskeder(doc)), []);
    // The attributes the screen reader and the dialogs show are not text nodes: check them directly.
    for (const m of doc.matchAll(/\s(?:data-confirm|data-prompt|data-gruppe|data-status)="([^"]*)"/g)) assert.doesNotMatch(m[1]!, /[æøåÆØÅ]|\b(?:og|ikke|hun|hvad)\b/, m[0]);
  });
}

test('the detector works: the Danish owner\'s room is full of Danish lines', () => {
  assert.ok(danskeLinjer(udenBeskeder(HUSSTAND['ejer-hele-rummet']!())).length > 40);
});

test('English: the room, the week and who is in it', () => {
  const doc = medSprog('en', HUSSTAND['ejer-hele-rummet']!);
  assert.match(doc, /<h1>Household<\/h1>/);
  assert.match(doc, /Shared week/);
  assert.match(doc, /Who is in/);
  assert.match(doc, /Tomorrow/);
  assert.match(doc, /Saturday 7 Nov/);
  assert.match(doc, /all day/);
  assert.match(doc, /Everyone/);
  assert.match(doc, /Maja and you/);
  assert.match(doc, /Football/);
  assert.match(doc, /data-medlem-rolle="barn"[\s\S]*?child/);
  assert.match(doc, /<summary class="row-note">Edit<\/summary>/);
  assert.match(doc, /Remove from the household/);
  assert.match(doc, /data-confirm="Remove [A-Za-z]+ from the household\? She loses her access/);
  assert.match(doc, /data-element="Household: Rikke"/);
  assert.match(doc, /data-element="Shared: Tomorrow"/);
  assert.match(medSprog('en', HUSSTAND['medlem-tomt']!), /Nothing shared in the coming week\./);
  assert.match(medSprog('en', HUSSTAND['gaest']!), /What someone in the household has asked you\./);
  const ikkeHer = medSprog('en', HUSSTAND['ikke-her']!);
  assert.match(ikkeHer, /Back to Now/);
  assert.match(ikkeHer, /The household is not here/);
});

test('English: the requests, from both sides', () => {
  const m = medSprog('en', HUSSTAND['foresp-modtager']!);
  for (const t of ['Needs you', 'Waiting for an answer', 'Agreed and settled', 'Waiting for you', 'New proposal', 'Agreed', 'Declined', 'No answer', 'Withdrawn']) assert.ok(m.includes(t), t);
  assert.match(m, /Henrik is asking you/);
  assert.match(m, /Today at 16:00–17:00|Thursday 5 Nov at 16:00–17:00/);
  assert.match(m, /Reminder: Henrik is waiting for your answer\. Expires /);
  assert.match(m, /You are free on Thursday\./, 'Hermes\' own words pass through');
  assert.match(m, />Yes</);
  assert.match(m, />No</);
  assert.match(m, />Another time</);
  assert.match(m, /data-prompt="kl=What time suits you\? \(e\.g\. 16:30\)"/);
  assert.match(m, />Withdraw</);
  assert.match(m, />Accept</);
  assert.match(m, />No thanks</);
  assert.match(m, />Ask again</);
  assert.match(m, />Add to your calendar</);
  assert.match(m, /Agreed\. It is in the shared calendar\. Add it to your own calendar too\./);
  assert.match(m, /Henrik said no\./);
  assert.match(m, /No answer from Ella: ask again or drop it\./);
  assert.match(m, /Henrik withdrew the request\./);
  assert.match(m, /Henrik suggests Thursday 5 Nov at 17:30–18:30 \(Can 17:30\)\. Accept, or say no thanks\.|suggests .* Accept, or say no thanks\./);
  assert.match(m, /Ask someone in the household/);
  assert.match(m, /placeholder="Can you pick up Ella on Thursday\?"/);
  assert.match(m, /Day \(optional\)/);
  assert.match(m, /data-status="asking"/);
  const a = medSprog('en', HUSSTAND['foresp-asker']!);
  assert.match(a, /You asked Maja/);
  assert.match(a, /Maja has not answered yet\./);
  assert.match(a, /Asked/);
  assert.match(a, /Maja gets this on Signal:/);
  assert.match(a, /Send to Maja on Signal/);
  assert.match(a, /data-status="sending"/);
  assert.match(m, /Grandma wrote: maybe, call me/);
  assert.match(a, /The answer came as a message on Telegram\./);
  assert.match(a, /data-element="Request: Can you pick up Ella on Thursday\?"/);
  const log = medSprog('en', HUSSTAND['foresp-log']!);
  assert.match(log, /Latest/);
  assert.match(log, /Undone at 08:10/);
  assert.match(log, />Undo</);
  const k = medSprog('en', HUSSTAND['foresp-asker-kanal']!);
  assert.match(k, /Sent to Grandma on Telegram at 09:05\./);
  assert.match(k, /Send a reminder/);
  assert.match(k, /The reminder reads:/);
});

test('English: the things, the clash and the booking card', () => {
  const e = medSprog('en', HUSSTAND['ressourcer-ejer']!);
  for (const t of ['Confirm booking', 'Double-booked', 'Things in the house']) assert.ok(e.includes(t), t);
  assert.match(e, /Owners: /);
  assert.match(e, /aria-label="The next seven days"/);
  assert.match(e, /title="Saturday 7 Nov: booked"/);
  assert.match(e, />Book</);
  assert.match(e, />Car</);
  assert.match(e, /Saturday 7 Nov at 08:00–16:00 · Rikke · To Odense/);
  assert.match(e, /The big car is booked twice/);
  assert.match(e, /Rikke has the big car on Saturday 7 Nov at 08:00–16:00 \(To Odense\)\. You would like it at 10:00–14:00 \(Shopping\)\./);
  assert.match(e, />Book the small car Saturday 7 Nov at 10:00–15:00</);
  assert.match(e, /Remove the big car/);
  assert.match(e, /This cannot be undone\. Past bookings and your own go with it\./);
  assert.match(e, /Yes, remove the big car/);
  assert.match(e, /Who owns it/);
  assert.match(e, /aria-label="What is it"/);
  assert.match(e, /No bookings\./);
  assert.match(e, /Add a thing/);
  assert.match(e, /placeholder="The big car"/);
  assert.match(e, /Trip to Odense/);
  assert.match(e, /Let Rikke have it|Drop it, Rikke keeps it/);
  assert.match(e, /Ask Rikke to swap|Ask Rikke to drop it/);
  assert.match(e, /From the household/);
  const a = medSprog('en', HUSSTAND['ressourcer-andre']!);
  assert.match(a, /Ask an owner/);
  assert.match(a, />Ask Henrik</);
  assert.match(a, /Ask Henrik to borrow the small car/);
  assert.match(a, /You do not own the small car, so Henrik has to say yes first\./);
  const v = medSprog('en', HUSSTAND['ressourcer-venter']!);
  assert.match(v, /You asked Rikke\. Waiting for an answer\./);
});

test('English: the weekend card and the invitations', () => {
  const k = medSprog('en', HUSSTAND['konflikt-aaben']!);
  assert.match(k, /Saturday: Henrik has Cycling 9 to 14, Rikke has Coffee with Anne 11 to 13\./);
  assert.match(k, /Who takes Nora\?|Who has Nora\?/);
  assert.match(k, />Henrik takes Nora</);
  assert.match(k, />Find a third</);
  assert.match(k, /is busy 9 to 14/);
  assert.match(k, /From the household/);
  const venter = medSprog('en', HUSSTAND['konflikt-venter']!);
  assert.match(venter, /You asked Rikke\. Waiting for an answer\./);
  assert.match(venter, /Henrik has asked you\. Answer the request\./);
  const i = medSprog('en', HUSSTAND['invitationer']!);
  for (const t of ['Invitations', 'Invite someone to the household', 'Own entry · member', 'is invited', 'Step 1 of 4', 'Share', 'Phone number only', 'gets requests as messages']) assert.ok(i.includes(t), t);
  assert.match(i, /Open Tailscale's admin page|Open Tailscale&#39;s admin page/);
  assert.match(i, /Sent on Telegram at 08:30\. Clawco sends no more until she answers yes\./);
  assert.match(i, /Send to Maja on Signal/);
  assert.match(i, /data-status="sending"/);
  assert.match(medSprog('en', HUSSTAND['invitationer-uden-kanal']!), /Clawco cannot send messages from here yet\./);
  const f = medSprog('en', HUSSTAND['inviter-enebruger']!);
  for (const t of ['Invite someone to the household', 'Own entry', 'Phone number only', 'Your name (it appears in the invitation)', 'Her email in Tailscale', 'Channel', 'Role', '>Invite<']) assert.ok(f.includes(t), t);
  assert.match(f, /<option value="medlem" selected>member<\/option>/);
  assert.match(medSprog('en', HUSSTAND['inviter-fuldt']!), /The household can have at most 6 people\./);
});

test('the weekend card\'s words: in Danish exactly konflikt.ts\' (the log line and Hermes\' prompt keep using it); in English composed from the table; Hermes\' own phrasing passes through', () => {
  const k = DELE.KONFLIKT;
  assert.deepEqual(konfliktTekstVis(k, DELE.MEDLEMMER), konfliktResume(k, DELE.MEDLEMMER));
  assert.equal(tidSagVis(k), tidSag(k));
  assert.equal(medSprog('en', () => konfliktTekstVis(k, DELE.MEDLEMMER).spoergsmaal), 'Who has Nora?');
  assert.equal(medSprog('en', () => tidSagVis(k)), 'Saturday at 11:00–13:00');
  const hermes = { ...k, tekst: { resume: 'Henrik and Rikke both have plans.', spoergsmaal: 'Who takes Nora?' } };
  assert.deepEqual(medSprog('en', () => konfliktTekstVis(hermes, DELE.MEDLEMMER)), hermes.tekst);
});

test('the Nu lines of the room, from the table', () => {
  const da = HUSSTAND_TEKSTER.da, en = HUSSTAND_TEKSTER.en;
  assert.equal(da.nuDobbeltbooket('Den store bil', 'lørdag kl. 09.00–13.00', 'Rikke'), 'Dobbeltbooket: Den store bil lørdag kl. 09.00–13.00 (dig og Rikke)');
  assert.equal(en.nuDobbeltbooket('The big car', 'today at 09:00–13:00', 'Rikke'), 'Double-booked: The big car today at 09:00–13:00 (you and Rikke)');
  assert.equal(en.nuBekraeft('The big car', 'today at 09:00–13:00'), 'Confirm booking: The big car today at 09:00–13:00');
  assert.equal(en.nuWeekend('Who has Nora?', 'Saturday at 11:00–13:00', 'Rikke'), 'Weekend: Who has Nora? Saturday at 11:00–13:00 (you and Rikke)');
  assert.equal(en.nuSpoerger(en.nuPaamindelse, 'Maja', 'Can you help?'), 'Reminder: Maja asks: Can you help?');
  assert.equal(en.nuForeslaar('', 'Maja', 'Can you help?'), 'Maja suggests another time: Can you help?');
  assert.equal(en.nuIngenSvar('Maja', 'Can you help?'), 'No answer from Maja: Can you help?');
});

// ---- Nu: the lines the room reports, through the app ----------------------------------------------------------------

const START = new Date('2026-11-02T08:00:00Z'); // Monday 09.00 in Copenhagen
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const HENRIK = { id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' as const };
const MAJA = { id: 'maja', login: 'maja@example.com', navn: 'Maja', rolle: 'medlem' as const };
type Hvem = typeof HENRIK | typeof MAJA;

async function lav(navn: string, sprog: 'da' | 'en') {
  const dataDir = path.join(tmp, navn);
  await skrivHusstand(dataDir, { personer: [HENRIK, MAJA] });
  await lavProfilLager(dataDir).skriv({ navn: 'Henrik', sprog, husstand: 'husstand' });
  const a = createApp({
    store: createFileStore(dataDir), hermes: createFakeAgent({ answer: () => 'ok' }), sourceGlob: '/nonexistent/{date}.json', dataDir, sha: 'abc', now: () => START,
    mailRunner: async () => ({ code: 1, stdout: '', stderr: 'none' }), mailStateDir: '/nonexistent',
  });
  const req = (p: Hvem, sti: string, init: RequestInit = {}) =>
    a.app.request(sti, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), 'Tailscale-User-Login': p.login, 'content-type': 'application/json' } }, LOOPBACK);
  const side = async (p: Hvem, sti: string) => (await req(p, sti)).text();
  const spoerg = async () => {
    const body = { til: 'maja', titel: 'Can you take Nora on Thursday?', dag: '2026-11-05', start: '16:00', slut: '17:00' };
    const ja = (await (await req(HENRIK, '/api/graense/ja', { method: 'POST', body: JSON.stringify({ rum: 'husstand', slags: 'aktion', id: 'opret', body }) })).json()) as { ja: string };
    const res = await req(HENRIK, '/api/rum/husstand/aktion/opret', { method: 'POST', body: JSON.stringify({ ...body, ja: ja.ja }) });
    const j = (await res.json()) as { runId?: string };
    if (j.runId) await a.runs.get(j.runId)?.finished;
    assert.equal(res.status, 202);
  };
  return { side, spoerg };
}

test('English profile, end to end: Nu says what the room reports in English, and the room page has no Danish word', async () => {
  const a = await lav('en', 'en');
  await a.spoerg();
  assert.match(await a.side(MAJA, '/rum/hjem'), /Henrik asks: Can you take Nora on Thursday\?/);
  assert.match(await a.side(HENRIK, '/rum/hjem'), /Maja has not answered yet: Can you take Nora on Thursday\?/);
  const maja = await a.side(MAJA, '/rum/husstand');
  assert.match(maja, /Henrik is asking you/);
  assert.match(maja, />Yes</);
  // "Klar" is the header's status, which room.ts still writes in Danish (follow-up: not part of this slice's room.ts scope).
  const udenKlar = (doc: string): string[] => danskeLinjer(doc).filter((l) => l !== 'Klar');
  assert.deepEqual(udenKlar(maja), []);
  const henrik = await a.side(HENRIK, '/rum/husstand');
  assert.match(henrik, /You asked Maja/);
  assert.deepEqual(udenKlar(henrik), []);
});

test('Danish profile, end to end: the Nu lines and the room are the Danish ones, as before', async () => {
  const a = await lav('da', 'da');
  await a.spoerg();
  assert.match(await a.side(MAJA, '/rum/hjem'), /Henrik spørger: Can you take Nora on Thursday\?/);
  assert.match(await a.side(HENRIK, '/rum/hjem'), /Maja har ikke svaret endnu: Can you take Nora on Thursday\?/);
  assert.match(await a.side(MAJA, '/rum/husstand'), /Henrik spørger dig/);
});
