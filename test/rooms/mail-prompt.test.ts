import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMailRefreshRun, buildKladdeRun, buildBaggrundFlytRun, buildSendRun } from '../../src/rooms/mail/prompt.ts';
import { GRAENSER } from '../../src/agent/prompt.ts';
import type { TrimmedMail } from '../../src/rooms/mail/source.ts';
import { MAIL, holdTilGuld, danskeEgneLinjer, egneTekst } from '../fixtures/sprog-golden-prompt-rum-a.ts';
import { MAIL_PROMPT_TEKSTER } from '../../src/rooms/mail/prompt-tekster.ts';
import { medSprog, TEKSTER } from '../../src/shell/tekster.ts';
import { form, tomme, ensStrenge } from '../fixtures/sprog-tjek.ts';

const trimmed: TrimmedMail = {
  dato: '2026-10-27', hentet: '2026-10-27T08:40:00Z',
  handling: [{ id: '242', emne: 'Tilbud på ny eltavle', fra: 'Elektrikeren ApS', modtaget: '2026-10-26T18:57:39Z', laest: true, flag: false, vedhaeftning: true }],
  tal: { handling: 1, afventer: 1, regninger: 12, indbakke: 0, sorteretIDag: 3 },
  ordnet: [],
};

test('refresh run asks for the analysis schema: type, betydning, udkast, arkivmappe, and the hard rules', () => {
  const r = buildMailRefreshRun(trimmed, new Date('2026-10-27T08:40:00Z'));
  for (const k of ['"type"', '"betydning"', '"udkast"', '"arkivmappe"', '"muligheder"', '"hermesStatus"']) assert.ok(r.instructions.includes(k), k);
  assert.match(r.instructions, /himalaya message read -m Folders\/Handling/);
  assert.match(r.instructions, /List-Unsubscribe/);
  assert.match(r.instructions, /aldrig.*send/i);
  assert.ok(r.input.includes('"242"'));
});

test('KC-0118: the refresh run is built by the shared prompt builder: limits once, zone line, catalog', () => {
  const r = buildMailRefreshRun(trimmed, new Date('2026-10-27T08:40:00Z'));
  assert.equal(r.instructions.split(GRAENSER).length - 1, 1);
  assert.match(r.instructions, /Zone: privat/);
  assert.match(r.instructions, /Byggeklodserne/);
});

test('kladde run passes Henriks text and asks for a Drafts entry as a reply', () => {
  const r = buildKladdeRun('242', 'Tilbud på ny eltavle', 'Hej, tak.');
  assert.match(r.instructions, /Drafts/);
  assert.match(r.instructions, /In-Reply-To/);
  assert.match(r.instructions, /aldrig.*send/i);
  assert.ok(r.input.includes('Hej, tak.'));
  assert.ok(r.input.includes('242'));
});

test('background move run names folder and mail', () => {
  const r = buildBaggrundFlytRun('242', 'Folders/Afventer');
  assert.match(r.input, /--from Folders\/Handling --to Folders\/Afventer 242/);
});

test('send run says Henrik approved, uses himalaya reply --send and forbids anything but this one reply', () => {
  const r = buildSendRun('242', 'Tilbud på ny eltavle', 'Hej, tak.');
  assert.match(r.instructions, /Henrik har godkendt/);
  assert.match(r.instructions, /himalaya message reply -m Folders\/Handling 242/);
  assert.match(r.instructions, /--send/);
  assert.match(r.instructions, /kun denne ene mail/i);
  assert.ok(r.input.includes('Hej, tak.'));
});

test('KC-0060: the refresh run asks for a visuel on every decision', () => {
  const t = buildMailRefreshRun(trimmed, new Date('2026-10-27T08:40:00Z')).instructions;
  assert.match(t, /"visuel": \{ "ikon": "cloud-rain"/);
  assert.match(t, /"ikon" \(skal\): ét af [^\n]*receipt/);
  assert.match(t, /Giv hver beslutning et "visuel"/);
});

test('KC-0066: the refresh run asks Hermes to mark muligheder that go to others with tilAndre and keeps the no-send rule', () => {
  const r = buildMailRefreshRun(trimmed, new Date('2026-10-27T08:40:00Z'));
  assert.match(r.instructions, /"tilAndre": true/);
  assert.match(r.instructions, /tilAndre[^\n]*andre mennesker/);
  assert.match(r.instructions, /aldrig sende/i);
});

// KC-0223: the refresh for a connection Clawco may only read.
test('the read-only refresh asks for no draft, folder or muligheder, says Henrik moves and answers mails himself, and never mentions himalaya', async () => {
  const { buildMailRefreshForbindelseRun } = await import('../../src/rooms/mail/prompt.ts');
  const spec = buildMailRefreshForbindelseRun(trimmed, new Date('2026-10-27T08:40:00Z'), 'Gmail', { laeseKun: true });
  assert.doesNotMatch(spec.instructions, /"udkast"|"arkivmappe"|"muligheder"/);
  assert.doesNotMatch(spec.instructions, /himalaya/);
  assert.match(spec.instructions, /kan ikke læse selve mailene/);
  assert.match(spec.instructions, /flytter og besvarer .* selv/);
  assert.match(spec.input, /Gmail/);
  const med = buildMailRefreshForbindelseRun(trimmed, new Date('2026-10-27T08:40:00Z'), 'Mail');
  assert.match(med.instructions, /"udkast"/, 'the acting prompt is unchanged');
});

// KC-0241: Henrik's installation (no language chosen, or da chosen) sends the same prompts as before, byte for byte
// (test/fixtures/sprog-prompt-rum-a/, captured from the code before the words moved into prompt-tekster.ts).
test('KC-0241: Danish prompts of mail are byte for byte as before, with no language set and with da chosen', () => {
  holdTilGuld(MAIL, 'mail');
});

// ---- KC-0241: the prompts in English ----------------------------------------------------------------------------------

const tabel = (t: unknown): Record<string, unknown> => t as Record<string, unknown>;
const egne = (k: string) => ({ ...(k === 'mail-chat' || k === 'mail-chat-forbindelse-laes' ? { kontekst: 'Offer for a new fuse box' } : {}) });
const paa = (k: string) => medSprog('en', MAIL[k]!);

test('KC-0241: Mail\'s prompt table: English has exactly Danish\'s keys and shapes; no empty string; no Danish string copied over', () => {
  assert.deepEqual(form(MAIL_PROMPT_TEKSTER.en), form(MAIL_PROMPT_TEKSTER.da));
  for (const t of [MAIL_PROMPT_TEKSTER.da, MAIL_PROMPT_TEKSTER.en]) assert.deepEqual(tomme(tabel(t)), []);
  assert.deepEqual(ensStrenge(tabel(MAIL_PROMPT_TEKSTER.da), tabel(MAIL_PROMPT_TEKSTER.en)), []);
});

test('KC-0241: the Danish detector works on Mail\'s Danish prompts', () => {
  assert.ok(danskeEgneLinjer(MAIL['mail-refresh']!(), egne('mail-refresh'), 'da').length > 12);
  assert.ok(danskeEgneLinjer(MAIL['mail-chat-forbindelse-laes']!(), egne('mail-chat-forbindelse-laes'), 'da').length > 6);
});

test('KC-0241: English: no Danish line in the words Mail writes itself, in any of its prompts', () => {
  for (const k of Object.keys(MAIL)) assert.deepEqual(danskeEgneLinjer(paa(k), egne(k)), [], k);
});

test('KC-0241: English: the room is "Mail" as the shell names it, the user is "the user", and the English prompts name no Henrik', () => {
  assert.ok(MAIL_PROMPT_TEKSTER.en.rolle.includes(`"${TEKSTER.en.rum['mail']}"`));
  assert.ok(MAIL_PROMPT_TEKSTER.da.rolle.includes(`"${TEKSTER.da.rum['mail']}"`));
  for (const k of Object.keys(MAIL)) assert.doesNotMatch(egneTekst(paa(k), egne(k)), /Henrik/, k);
});

test('KC-0241: English: the refresh keeps the schema\'s field names, enums and folder names, with English explanations', () => {
  const r = paa('mail-refresh');
  assert.match(r.instructions, /You are Hermes, the user's agent, and you work inside the room "Mail"/);
  assert.match(r.instructions, /answer with exactly this schema:/);
  for (const k of ['"type": "svar | aktion | info | nyhedsbrev | regning | kvittering"', '"arkivmappe"', 'Archive | Folders/Afventer | Folders/Måske | Folders/Regninger | Folders/køb | Folders/vigtige docs', '"tilAndre": true', 'himalaya message read -m Folders/Handling <id>', 'List-Unsubscribe']) assert.ok(r.instructions.includes(k), k);
  assert.match(r.instructions, /You must never send, answer or forward mail/);
  assert.match(r.instructions, /tilAndre[^\n]*other people/);
  assert.match(r.input, /It is now 2026-10-27 at 09\.40 \(Europe\/Copenhagen\)\./);
  assert.match(r.input, /Counts: \{/);
  assert.match(r.input, /Mails in Folders\/Handling \(1\):/);
});

test('KC-0241: English: the connection refresh (acting and read-only) and the chat in connector mode', () => {
  const f = paa('mail-forbindelse');
  assert.match(f.instructions, /You cannot read the mails themselves, and you have no tools/);
  assert.match(f.instructions, /"udkast"/);
  assert.match(f.input, /Mails in the inbox \(Mail, 1 of 4\):/);
  const l = paa('mail-forbindelse-laeseKun');
  assert.doesNotMatch(l.instructions, /"udkast"|"arkivmappe"|"muligheder"|himalaya/);
  assert.match(l.instructions, /Clawco can only read this mail account/);
  assert.match(l.instructions, /moves and answers mails themselves/);
  assert.match(l.input, /Unread and flagged mails in the inbox \(Gmail, 1 of 4\):/);
  const c = paa('mail-chat-forbindelse-laes');
  assert.doesNotMatch(c.instructions, /himalaya|terminal|Proton/i);
  assert.match(c.instructions, /the mail account Gmail/);
  assert.match(c.instructions, /You cannot read the mails themselves, and you cannot move, write drafts or send\./);
  assert.match(c.instructions, /Clawco can only read this mail account, so the user moves and answers mails in their own mail app\./);
  assert.match(paa('mail-chat-forbindelse-handle').instructions, /with Done in the room\./);
  assert.match(paa('mail-chat-forbindelse-handle').input, /It is now 2026-10-27 at 09\.40/);
  assert.match(paa('mail-chat-forbindelse-tom').input, /The room has no data yet\./);
});

test('KC-0241: English: handling, fortryd, chat, draft, background move and send', () => {
  assert.match(paa('mail-handling').instructions, /Rules for actions:/);
  assert.match(paa('mail-handling').instructions, /The room's content in short form is also in the message\./);
  assert.match(paa('mail-handling').input, /The button: "Unsubscribe"/);
  assert.match(paa('mail-fortryd').instructions, /Counts in the room: \{/);
  assert.match(paa('mail-chat').instructions, /Read the mail with himalaya, if it helps\./);
  assert.match(paa('mail-chat').instructions, /Rules for the chat:/);
  assert.match(paa('mail-chat').input, /The room's content:/);
  const k = paa('mail-kladde');
  assert.match(k.instructions, /The user has written \(or approved\) a reply to mail 242/);
  assert.match(k.instructions, /save it as a draft/);
  assert.match(k.instructions, /In-Reply-To and References/);
  assert.match(k.input, /Mail 242 has the subject: Offer for a new fuse box/);
  assert.match(k.input, /Reply to mail 242:\n\nHello, thanks\./);
  assert.match(paa('mail-baggrund').instructions, /This is a background task without the user\./);
  const s = paa('mail-send');
  assert.match(s.instructions, /The user has approved the reply below in the control centre and pressed Send\./);
  assert.match(s.instructions, /himalaya message reply -m Folders\/Handling 242/);
  assert.match(s.instructions, /send only this one mail/);
  assert.match(s.input, /Reply to mail 242:/);
  assert.match(paa('mail-kladde-urent-id').input, /Reply to mail 242rm:/, 'the id still goes through rentId');
});
