import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRefreshRun, buildHentRun, buildHandlingRun, buildFortrydRun, buildChatRun } from '../../src/rooms/dagen/prompt.ts';
import { GRAENSER, handlingsOpgave } from '../../src/agent/prompt.ts';
import { udenData, udpak } from '../../src/agent/udtroet.ts';
import type { DagenState } from '../../src/rooms/dagen/schema.ts';
import type { TrimmedAvis } from '../../src/rooms/dagen/source.ts';
import { DAGEN, holdTilGuld, danskeEgneLinjer, egneTekst } from '../fixtures/sprog-golden-prompt-rum-a.ts';
import { DAGEN_PROMPT_TEKSTER } from '../../src/rooms/dagen/prompt-tekster.ts';
import { medSprog, TEKSTER } from '../../src/shell/tekster.ts';
import { form, tomme, ensStrenge } from '../fixtures/sprog-tjek.ts';

const trimmed: TrimmedAvis = {
  dato: '2026-10-26', hentet: '2026-10-26T05:01:12+00:00', helbred: 'stabil',
  kalender: [{ titel: 'Driften', start: '10.00', slut: '11.00', kalender: 'Arbejde' }],
  nyheder: [{ titel: 'N1', kilde: 'Eksempel Energi', url: 'https://example.org/1', resume: 'r' }],
  forpligtelser: [], mail: { venter: 0, emner: [] },
};
const state: DagenState = {
  dato: '2026-10-26', genereret: '2026-10-26T06:00:00.000Z', treLinjer: ['a'], anbefaling: { tekst: 'b' },
  kalender: [{ tid: '10.00', titel: 'Driften' }], morgenavis: [], hermesStatus: 'Klar',
};

test('refresh run asks for the Dagen JSON schema in Danish and passes the trimmed data as input', () => {
  const r = buildRefreshRun(trimmed, new Date('2026-10-26T06:12:00Z'));
  assert.match(r.instructions, /```json/);
  for (const key of ['treLinjer', 'anbefaling', 'kalender', 'morgenavis', 'hermesStatus', 'instruktion', 'fortryd']) {
    assert.ok(r.instructions.includes(key), `instructions mention ${key}`);
  }
  assert.match(r.instructions, /dansk/i);
  assert.ok(r.input.includes('"Driften"'));
  assert.ok(r.input.includes('2026-10-26'));
});

test('KC-0118: the refresh run is built by the shared prompt builder: limits once, zone line, catalog', () => {
  const r = buildRefreshRun(trimmed, new Date('2026-10-26T06:12:00Z'));
  assert.equal(r.instructions.split(GRAENSER).length - 1, 1);
  assert.match(r.instructions, /Zone: privat/);
  assert.match(r.instructions, /Byggeklodserne/);
});

test('hent run tells Hermes to run Kiras morning-paper pipeline with its terminal tool', () => {
  const r = buildHentRun(new Date('2026-10-26T06:12:00Z'));
  assert.match(r.input, /morgenavis_cron\.py|morgenavis_fetch\.py/);
  assert.match(r.instructions, /```json/);
});

// KC-0123: the stored instruktion, the label and the room's state are afledt data; the task is the verb's sentence.
test('handling run carries the stored instruktion and the room context as afledt data, under the verb\'s own sentence', () => {
  const r = buildHandlingRun({ id: 'x', label: 'Blokér', instruktion: 'Opret blok 13-14.' }, state);
  assert.deepEqual(udpak(r.input).map((d) => [d.kilde, d.tillid]), [['handling', 'afledt'], ['rum-state', 'afledt']]);
  assert.equal(udpak(r.input)[0]!.tekst, 'Opret blok 13-14.');
  assert.ok(udpak(r.input)[1]!.tekst.includes('"treLinjer"'));
  assert.ok(!r.instructions.includes('"treLinjer"') && !r.instructions.includes('Blokér'));
  assert.ok(r.instructions.includes(handlingsOpgave('udfoer-med-fortryd')));
  assert.match(r.instructions, /Dagen/);
  assert.match(r.instructions, /aldrig.*(betal|send)/i);
});

test('fortryd run sends the stored undo instruction as afledt data', () => {
  const r = buildFortrydRun('Slet blokken igen.', state);
  assert.equal(udpak(r.input)[0]!.tekst, 'Slet blokken igen.');
  assert.equal(udpak(r.input)[0]!.tillid, 'afledt');
  assert.match(r.instructions, /fortryd/i);
});

test('chat run includes the context element when given, as afledt data; Henrik\'s message stays his', () => {
  const r = buildChatRun('Hvad skal jeg forberede?', 'Mødet kl. 10', state);
  assert.equal(udenData(r.input), 'Hvad skal jeg forberede?');
  assert.ok(udpak(r.input).some((d) => d.kilde === 'element' && /Om: Mødet kl\. 10/.test(d.tekst)));
  assert.ok(!r.instructions.includes('Mødet kl. 10'));
  assert.match(r.instructions, /"opdater"/);
});

test('KC-0060: the refresh run asks for the picture of the day, a short anbefaling headline and a pictogram per calendar post', () => {
  const t = buildRefreshRun(trimmed, new Date('2026-10-26T06:12:00Z')).instructions;
  assert.match(t, /"visuel": \{ "ikon": "sunrise", "billede": \{ "art": "dagslinje"/);
  assert.match(t, /"overskrift": "højst 30 tegn/);
  assert.match(t, /"ikon" \(skal\): ét af [^\n]*train-front/);
  assert.match(t, /"tid": "HH\.MM", "slut": "HH\.MM", "titel": "\.\.\.", "ikon": "<ikon>"/);
});

test('KC-0066: the refresh run asks Hermes to mark handlinger that go to others with tilAndre and keeps the no-send rule', () => {
  const r = buildRefreshRun(trimmed, new Date('2026-10-26T06:12:00Z'));
  assert.match(r.instructions, /"tilAndre": true/);
  assert.match(r.instructions, /tilAndre[^\n]*andre mennesker/);
  assert.match(r.instructions, /aldrig[^\n]*sende mail til andre/i);
});

// KC-0241: Henrik's installation (no language chosen, or da chosen) sends the same prompts as before, byte for byte
// (test/fixtures/sprog-prompt-rum-a/, captured from the code before the words moved into prompt-tekster.ts).
test('KC-0241: Danish prompts of dagen are byte for byte as before, with no language set and with da chosen', () => {
  holdTilGuld(DAGEN, 'dagen');
});

// ---- KC-0241: the prompts in English ----------------------------------------------------------------------------------

const tabel = (t: unknown): Record<string, unknown> => t as Record<string, unknown>;
const egne = (k: string) => ({ ...(k === 'dagen-chat' ? { kontekst: 'Meeting at 10.00' } : {}) });
const paa = (k: string) => medSprog('en', DAGEN[k]!);

test('KC-0241: Dagen\'s prompt table: English has exactly Danish\'s keys and shapes; no empty string; no Danish string copied over', () => {
  assert.deepEqual(form(DAGEN_PROMPT_TEKSTER.en), form(DAGEN_PROMPT_TEKSTER.da));
  for (const t of [DAGEN_PROMPT_TEKSTER.da, DAGEN_PROMPT_TEKSTER.en]) assert.deepEqual(tomme(tabel(t)), []);
  assert.deepEqual(ensStrenge(tabel(DAGEN_PROMPT_TEKSTER.da), tabel(DAGEN_PROMPT_TEKSTER.en)), []);
});

test('KC-0241: the Danish detector works on Dagen\'s Danish prompt', () => {
  assert.ok(danskeEgneLinjer(DAGEN['dagen-refresh-uge']!(), egne('dagen-refresh-uge'), 'da').length > 15);
});

test('KC-0241: English: no Danish line in the words Dagen writes itself, in any of its prompts', () => {
  for (const k of Object.keys(DAGEN)) assert.deepEqual(danskeEgneLinjer(paa(k), egne(k)), [], k);
});

test('KC-0241: English: the room is "Today" as the shell names it, and the user is "the user", not Henrik', () => {
  assert.ok(DAGEN_PROMPT_TEKSTER.en.rolle.includes(`"${TEKSTER.en.rum['dagen']}"`));
  assert.ok(DAGEN_PROMPT_TEKSTER.da.rolle.includes(`"${TEKSTER.da.rum['dagen']}"`));
  for (const k of Object.keys(DAGEN)) assert.doesNotMatch(egneTekst(paa(k), egne(k)), /Henrik/, k);
});

test('KC-0241: English: the refresh asks for the same schema (field names and enums unchanged), with English explanations', () => {
  const r = paa('dagen-refresh-uge');
  assert.match(r.instructions, /You are Hermes, the user's agent, and you work inside the room "Today"/);
  assert.match(r.instructions, /Answer with exactly this schema:/);
  assert.match(r.instructions, /Rules:\n- Write in English, short and concrete\./);
  for (const key of ['treLinjer', 'anbefaling', 'kalender', 'morgenavis', 'hermesStatus', 'instruktion', 'fortryd', '"tilAndre": true', '"status": "klar | flyttet | aflyst"', '"art": "dagslinje"']) assert.ok(r.instructions.includes(key), key);
  assert.match(r.instructions, /Answer ONLY with one JSON object in a ```json block\./);
  assert.match(r.input, /It is now 2026-10-26 at 07\.12 \(Europe\/Copenhagen\)\./);
  assert.match(r.input, /Today's raw data:/);
  assert.match(r.input, /The week ahead \(Google Calendar, all calendars incl\. the family's\):/);
  assert.match(paa('dagen-refresh-uge-fejl').input, /\(calendars that failed: Family: timeout; Work: denied\)/);
  assert.match(paa('dagen-refresh-uge-null').input, /\(The week ahead could not be fetched today; omit "ugen"\.\)/);
});

test('KC-0241: English: hent, handling, fortryd and chat', () => {
  assert.match(paa('dagen-hent').instructions, /There is no data for today yet\. Fetch it yourself: run `python3 ~\/\.agent\/scripts\/morgenavis_cron\.py`/);
  assert.match(paa('dagen-hent').input, /Fetch today's data with morgenavis_cron\.py and build the room "Today"\./);
  const h = paa('dagen-handling');
  assert.match(h.instructions, /Rules for actions:/);
  assert.match(h.instructions, /The room's current content is also in the message\./);
  assert.match(h.input, /The button: "Block"/);
  assert.match(h.input, /The room's current content:/);
  assert.match(paa('dagen-fortryd').instructions, /Rules for actions:/);
  assert.match(paa('dagen-chat').instructions, /Rules for the chat:/);
  assert.match(paa('dagen-chat').instructions, /\{"opdater": \{\.\.\.\}\}/);
  assert.match(paa('dagen-chat-uden-kontekst').input, /The room has no data yet\./);
});
