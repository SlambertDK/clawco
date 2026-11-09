// KC-0170 slice 3 (part C): Start's sub-cards (steps 3–6, the Tailscale card, the Danmark-pakke, the previews, the import),
// its actions and its log lines in English or Danish. Danish (no language chosen, or da chosen) is byte for byte what it was
// (test/fixtures/sprog-start/, captured before the strings moved); English has no Danish word left in what Start itself says.
// The connector cards' own words come from src/kilder (another slice): the fixtures give them in English.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { START_TEKSTER, startTekst } from '../../src/rooms/start/tekster.ts';
import { medSprog } from '../../src/shell/tekster.ts';
import { renderStart } from '../../src/rooms/start/render.ts';
import { START_DELE, START_NU, FORHAANDSTEKSTER, FORSKEL_TEKSTER, SCENARIER, optag, type Optagelse } from '../fixtures/sprog-golden-start.ts';
import { form, tomme, ensStrenge, danskeLinjer, DANSK } from '../fixtures/sprog-tjek.ts';

const rod = path.dirname(fileURLToPath(import.meta.url));
const mappe = path.join(rod, '../fixtures/sprog-start');
const fixtur = (navn: string): string => readFileSync(path.join(mappe, navn), 'utf8');
const json = <T>(navn: string): T => JSON.parse(fixtur(navn)) as T;
const tabel = (t: unknown): Record<string, unknown> => t as Record<string, unknown>;
// An apostrophe that was literal markup now comes through the escaper as &#39;, which the browser shows as the same character.
const samme = (s: string): string => s.replaceAll('&#39;', "'");

test('English has exactly Danish\'s keys and shapes; no string is empty; no Danish string copied over', () => {
  assert.deepEqual(form(START_TEKSTER.en), form(START_TEKSTER.da));
  for (const t of [START_TEKSTER.da, START_TEKSTER.en]) assert.deepEqual(tomme(tabel(t)), []);
  // (test/shell/tekster.test.ts holds the same table to its own list of sentences that are the same on purpose.)
  assert.deepEqual(ensStrenge(tabel(START_TEKSTER.da), tabel(START_TEKSTER.en)).filter((k) => k !== 'sprogValg.da'), []);
});

test('tables are read at call time, in the language being rendered', () => {
  assert.equal(startTekst(), START_TEKSTER.da);
  assert.equal(medSprog('en', () => startTekst()), START_TEKSTER.en);
});

// ---- Henrik's installation: byte for byte -----------------------------------------------------------------------------------

test('Henrik\'s installation: with no language chosen every sub-card renders byte for byte as before', () => {
  const filer = readdirSync(mappe).filter((f) => f.endsWith('.html')).sort();
  assert.deepEqual(Object.keys(START_DELE).map((k) => `${k}.html`).sort(), filer, 'every golden has a case');
  for (const [k, lav] of Object.entries(START_DELE)) {
    assert.equal(samme(lav()), samme(fixtur(`${k}.html`)), k);
    assert.equal(samme(medSprog('da', lav)), samme(fixtur(`${k}.html`)), `${k} (da chosen)`);
  }
});

test('Henrik\'s installation: the previews, the import\'s sentences and the diff lines are the same words as before', () => {
  assert.deepEqual(FORHAANDSTEKSTER(), json('forhaandstekster.json'));
  assert.deepEqual(medSprog('da', FORHAANDSTEKSTER), json('forhaandstekster.json'));
  assert.deepEqual(FORSKEL_TEKSTER(), json('forskel.json'));
  assert.deepEqual(medSprog('da', FORSKEL_TEKSTER), json('forskel.json'));
});

test('Henrik\'s installation: every refusal, answer, run label and log line of the room is the same sentence as before', async () => {
  const foer = json<Optagelse>('handlinger.json');
  assert.deepEqual(Object.keys(SCENARIER).sort(), Object.keys(foer).sort(), 'every golden has a scenario');
  assert.deepEqual(await optag(), foer);
  assert.deepEqual(await medSprog('da', optag), foer, 'da chosen');
});

// ---- English: nothing Danish in what Start says ----------------------------------------------------------------------------

/** The sentences from a module Start does not own pass through (a profile error, Tailscale's own sentence): left out of the check. */
const dansk = (doc: string): string[] => danskeLinjer(doc);

test('the Danish detector works: the Danish sub-cards are full of Danish lines', () => {
  const alle = Object.values(START_DELE).map((f) => dansk(f()).length);
  assert.ok(alle.reduce((a, b) => a + b, 0) > 150, String(alle.reduce((a, b) => a + b, 0)));
  for (const k of ['tailscale-mangler', 'tillid', 'pakke-fuld', 'import-bunke', 'kilde-valg', 'forhaand-kalenderTidsat']) assert.ok(dansk(START_DELE[k]!()).length > 0, k);
});

test('English: no sub-card of Start has a Danish word left', () => {
  for (const [k, lav] of Object.entries(START_DELE)) assert.deepEqual(dansk(medSprog('en', lav)), [], k);
});

test('English: the previews and the import\'s sentences carry no Danish word', () => {
  const f = medSprog('en', FORHAANDSTEKSTER);
  for (const [k, v] of Object.entries(f)) for (const t of [v.titel, v.linje]) assert.ok(!DANSK.test(t), `${k}: ${t}`);
  for (const t of medSprog('en', FORSKEL_TEKSTER)) assert.ok(!DANSK.test(t), t);
});

test('English: every refusal, answer, run label and log line of the room is English', async () => {
  const en = await medSprog('en', optag);
  assert.deepEqual(Object.keys(en).sort(), Object.keys(SCENARIER).sort());
  let antal = 0;
  for (const [k, u] of Object.entries(en)) {
    if (SCENARIER[k]!.andres) continue;
    for (const t of [u.fejl, u.tekst, u.fejlede, u.label, ...u.log]) {
      if (t === undefined) continue;
      antal += 1;
      assert.ok(!DANSK.test(t), `${k}: ${t}`);
    }
  }
  assert.ok(antal > 150, String(antal));
});

test('English: the same scenarios say the same things in English, one for one', async () => {
  const da = json<Optagelse>('handlinger.json');
  const en = await medSprog('en', optag);
  for (const [k, u] of Object.entries(da)) {
    const e = en[k]!;
    assert.equal(e.log.length, u.log.length, `${k}: log lines`);
    for (const felt of ['fejl', 'tekst', 'fejlede', 'label'] as const) assert.equal(e[felt] === undefined, u[felt] === undefined, `${k}: ${felt}`);
    // Something changed: a sentence is not carried over untouched (names and figures aside).
    for (const felt of ['fejl', 'label'] as const) if (u[felt] && !SCENARIER[k]!.andres) assert.notEqual(e[felt], u[felt], `${k}: ${felt}`);
  }
});

test('English: spot checks of the wording', async () => {
  const en = await medSprog('en', optag);
  assert.equal(en['velkommen-ikkeEjer']!.fejl, 'Only the owner can save the profile.');
  assert.deepEqual(en['velkommen-gemHusstand']!.log, ['Saved the profile: Alma, Hermes answers in English, a household.']);
  assert.deepEqual(en['velkommen-gemLaptop']!.log, ['Saved the profile: Alma, Hermes answers in Danish.']);
  assert.deepEqual(en['ret-springOver']!.log, ['Skipped »Correct one thing«. The journey is only done once you have corrected something.']);
  assert.deepEqual(en['ret-hoert']!.log, ['You corrected »The electricity bill«. Thanks.']);
  assert.deepEqual(en['ts-delt']!.log, ['Shared Clawco on the tailnet (tailscale serve --bg 8750): https://laptop.example.ts.net.']);
  assert.equal(en['model-gemOk']!.tekst, 'Works: the quick one answered in N s, the thorough one in N s.');
  assert.deepEqual(en['model-gemLokal']!.log, ['Chose Ollama on your own machine, the address http://127.0.0.1:11434/v1: qwen3:8b and qwen3:14b.']);
  assert.equal(en['model-testFejl']!.tekst, 'The key was refused. Check that you copied the whole key and that it still exists at the provider.');
  assert.deepEqual(en['imp-gemAlle']!.log, ['Saved 2 files from ChatGPT (source: import-chatgpt): People/Alma.md, Profile.md.']);
  assert.deepEqual(en['imp-gem']!.log, ['Saved 1 file from ChatGPT (source: import-chatgpt): People/Alma.md.']);
  assert.equal(en['imp-laes']!.log[0], 'Read Claude and made 1 suggestion. Nothing is saved until you press Save.');
  assert.ok(en['imp-fortryd']!.log.includes('Undid the import: removed 1 file.'));
  assert.ok(en['imp-fortrydBeholdt']!.log.includes('Undid the import: removed 0 files; kept People/Alma.md, because you have edited it.'));
  assert.ok(en['imp-fortrydOpdater']!.log.includes('Undid the import: put 1 file back.'));
  assert.deepEqual(en['rejse-gennemfoert']!.log, ['The journey is complete.']);
  assert.deepEqual(en['nu-linjer']!.tekst, JSON.stringify([{ roomId: 'start', tekst: 'Start: What should Clawco take off your plate?' }, { roomId: 'start', tekst: 'Start: Welcome' }, { roomId: 'start', tekst: 'Start: Choose your model' }, { roomId: 'start', tekst: 'Start: First source' }, { roomId: 'start', tekst: 'Start: Correct one thing' }]));
  assert.equal(en['chat-tomtSvar']!.tekst, 'hi | (no answer)');
  assert.equal(en['forslag-grund']!.tekst, 'You have received 3 invitations in your mail in the last 14 days. With the calendar, Hermes can see when you are busy.');
  assert.equal(en['kilde-foersteLaesning']!.log[0], 'First look at Calendar after N ms: 1 appointment today.');
  assert.equal(en['kilde-foersteLaesningLang']!.log[0], 'First look at Mail after N s: No unread.');
});

test('English: the log rows of the room show the time in 24 hours with a colon', () => {
  const log = [{ id: 'l1', tid: '2026-10-31T08:05:00.000Z', kilde: 'henrik' as const, tekst: 'Saved the profile.', fortryd: 'x', fortrudt: '2026-10-31T08:30:00.000Z' }];
  const vis = (): string => String(renderStart({ trin: [], profil: null, standardNavn: '', forslag: [], kanGemme: true, now: START_NU, log }));
  assert.match(medSprog('en', vis), /<span class="mono time">09:05<\/span>/);
  assert.match(medSprog('en', vis), /Undone at 09:30/);
  assert.match(vis(), /<span class="mono time">09\.05<\/span>/);
  assert.match(vis(), /Fortrudt kl\. 09\.30/);
});

test('English: the full screens read as English chrome', () => {
  const kilder = medSprog('en', START_DELE['kilde-valg']!);
  for (const re of [/This is/, /data-element="Source: Calendar"/, />Connect the calendar</, /Step 1 of 2/, />Copy the address</, /data-status="connecting"/, /Inbox is connected\./]) assert.match(kilder, re);
  assert.match(medSprog('en', START_DELE['kilde-flere']!), />Skip</);
  assert.match(medSprog('en', START_DELE['kilde-forbindIgenIkkeNu']!), />Try again</);
  assert.match(medSprog('en', START_DELE['kilde-klaret']!), /See it in Now/);
  assert.match(medSprog('en', START_DELE['kilde-fejl']!), />Does not work</);
  assert.match(medSprog('en', START_DELE['kilde-valgIkkeEjer']!), /The owner connects the first source\./);
  const ts = medSprog('en', START_DELE['tailscale-klar']!);
  for (const re of [/Reach Clawco from the phone/, />Share Clawco on your tailnet</, /tailscale serve --bg 8750/, /data-kraever-ja/]) assert.match(ts, re);
  assert.match(medSprog('en', START_DELE['tailscale-delt']!), /up to six people/);
  assert.match(medSprog('en', START_DELE['tailscale-delt']!), /Invite the family/);
  const tillid = medSprog('en', START_DELE['tillid']!);
  for (const re of [/Hermes only gets more freedom when you say yes/, />Look</, />Never</, /data-niveau="graense"/]) assert.match(tillid, re);
  const pakke = medSprog('en', START_DELE['pakke-fuld']!);
  for (const re of [/data-gruppe="Denmark pack"/, /<h3 class="eyebrow">Denmark pack<\/h3>/, /Get notified when there is new Digital Post/, /aria-label="Sender address"/, /aria-label="Mailbox"/, /data-element="Denmark pack: School calendar"/]) assert.match(pakke, re);
  const imp = medSprog('en', START_DELE['import-bunke']!);
  for (const re of [/From ChatGPT: nothing is saved yet/, /works at Acme Inc/, /born 1984-03-12/, />Update Cleo Test\?</, />Keep my file</, />Save all</, /data-element="Import suggestion: Alma Test"/, /relation: now »friend«, the import says »sister«/, /Your profile/]) assert.match(imp, re);
  assert.match(medSprog('en', START_DELE['forhaand-kalenderTidsat']!), /First at 12:30: Board meeting/);
  assert.match(medSprog('en', START_DELE['forhaand-kalenderTidsat']!), /A first look, before Hermes has thought it over/);
});

test('English: plurals and lists read as English', () => {
  const f = medSprog('en', FORHAANDSTEKSTER);
  assert.deepEqual(f['kalenderTidsat'], { titel: '2 appointments today', linje: 'First at 12:30: Board meeting' });
  assert.equal(f['kalenderHelDag']!.titel, '1 appointment today');
  assert.equal(f['mailUlaeste']!.linje, 'The newest from Bo, Alma and Cleo');
  assert.equal(f['noter']!.titel, '2 notes and 3 people');
  assert.equal(f['noterEn']!.titel, '1 note and 1 person');
  assert.equal(f['nyheder']!.titel, '2 news items');
  assert.equal(f['beskeder']!.titel, '2 unread messages');
  assert.equal(f['beskederEn']!.titel, '1 unread message');
});
