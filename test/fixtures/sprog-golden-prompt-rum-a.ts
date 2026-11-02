// KC-0241: fixed inputs for every prompt builder of Nu (hjem), Dagen and Mail. The files in
// test/fixtures/sprog-prompt-rum-a/ (<name>.instructions.txt, <name>.input.txt) were captured from these inputs BEFORE the
// prompt words moved into each room's prompt-tekster.ts; the room's prompt test holds the Danish prompts to them byte for
// byte. The content (titles, senders, notes) is English with no Danish letters or words, so an English prompt shows only
// the words the room itself writes. The random boundary of one run is replaced by GRAENSE so the text can be pinned.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { medSprog, type Sprog } from '../../src/shell/tekster.ts';
import { byggPrompt, elementSegment, fortrydOpgave, handlingsOpgave, peger } from '../../src/agent/prompt.ts';
import { VERBER } from '../../src/graenser/verber.ts';
import { katalogTekst } from '../../src/shell/katalog.ts';
import { visuelSkema } from '../../src/shell/visuel.ts';
import { regelforslagTekst } from '../../src/tillid/prompt.ts';
import { DANSK } from './sprog-tjek.ts';
import { buildHjemChatRun } from '../../src/rooms/hjem/prompt.ts';
import {
  buildRefreshRun, buildHentRun, buildHandlingRun, buildFortrydRun, buildChatRun,
} from '../../src/rooms/dagen/prompt.ts';
import {
  buildMailRefreshRun, buildMailRefreshForbindelseRun, buildMailHandlingRun, buildMailFortrydRun, buildMailChatRun,
  buildKladdeRun, buildBaggrundFlytRun, buildSendRun,
} from '../../src/rooms/mail/prompt.ts';
import type { DagenState } from '../../src/rooms/dagen/schema.ts';
import type { TrimmedAvis } from '../../src/rooms/dagen/source.ts';
import type { TrimmedUge } from '../../src/rooms/dagen/uge.ts';
import type { MailState } from '../../src/rooms/mail/schema.ts';
import type { TrimmedMail } from '../../src/rooms/mail/source.ts';

export type Spec = { instructions: string; input: string };

/** The run's own random boundary replaced by GRAENSE, in the instructions and the input alike. */
export function fast(s: Spec): Spec {
  const g = /⟦data (\S+) /.exec(s.input)?.[1];
  const ret = (t: string): string => (g ? t.split(g).join('GRAENSE') : t);
  return { instructions: ret(s.instructions), input: ret(s.input) };
}

/** 14:00 in Copenhagen on Tuesday 27 Oct 2026 (CET). */
export const NU = new Date('2026-10-27T13:00:00Z');

// ---- Nu ---------------------------------------------------------------------------------------------------------------

const kort = [
  { id: 'bill:cloud-7', titel: 'Cloud bill', betyder: 'A bill of 20 USD.', hvor: 'shelfatlas' as const },
  { id: 'k:b', titel: 'Rikke asks', betyder: 'Rikke wants to know if you are coming.' },
  { id: 'k:c', titel: 'Private bill', betyder: 'From the shop.', hvor: 'privat' as const },
];
const pegerKort = { type: 'regning', titel: 'Cloud bill', betyder: 'A bill of 20 USD.', anbefaling: 'Pay it.', grundlag: ['mail 12'], kilder: ['mail'] } as never;
const forslagRevideret = { titel: 'Bills to the ledger', tekst: 'Bills from the cloud firm go to the work ledger.', trin: 1, gaelder: { kilde: 'mail', slags: 'regning' } } as never;
const oversigt = 'Two things wait.\nMail: a reply to Lone.';

export const HJEM: Record<string, () => Spec> = {
  'hjem-enkel': () => buildHjemChatRun('What is most urgent?', oversigt, NU),
  'hjem-kort': () => buildHjemChatRun('That bill is private', 'Nothing waits.', NU, kort),
  'hjem-tomt-kort': () => buildHjemChatRun('hi', 'x', NU, []),
  'hjem-peger': () => buildHjemChatRun('Why this one?', oversigt, NU, undefined, undefined, { kontekst: 'Card: Cloud bill' }),
  'hjem-peger-kort': () => buildHjemChatRun('Fix this', oversigt, NU, kort, undefined, { kontekst: 'Card: Cloud bill', kort: pegerKort }),
  'hjem-forslag': () => buildHjemChatRun('Always do this', oversigt, NU, kort, undefined, { kontekst: 'Card: Cloud bill', kort: pegerKort, forslag: true }),
  'hjem-revideret': () => buildHjemChatRun('Make it narrower', oversigt, NU, undefined, undefined, { kontekst: 'Proposal: Bills to the ledger', forslag: true, revideret: forslagRevideret }),
  'hjem-regler-mangler': () => buildHjemChatRun('hi', 'x', NU, kort, { tilstand: 'mangler' }),
};

// ---- Dagen ------------------------------------------------------------------------------------------------------------

const avis: TrimmedAvis = {
  dato: '2026-10-26', hentet: '2026-10-26T05:01:12+00:00', helbred: 'stable',
  kalender: [{ titel: 'Operations', start: '10.00', slut: '11.00', kalender: 'Work' }],
  nyheder: [{ titel: 'N1', kilde: 'Example Energy', url: 'https://example.org/1', resume: 'r' }],
  forpligtelser: [], mail: { venter: 0, emner: [] },
};
const dagState: DagenState = {
  dato: '2026-10-26', genereret: '2026-10-26T06:00:00.000Z', treLinjer: ['a'], anbefaling: { tekst: 'b' },
  kalender: [{ tid: '10.00', titel: 'Operations' }], morgenavis: [], hermesStatus: 'Ready',
};
const NU_DAGEN = new Date('2026-10-26T06:12:00Z');
const uge = { dage: [{ dato: '2026-10-27', aftaler: [{ tid: '09.00', slut: '10.00', titel: 'Standup', kalender: 'Work' }] }], fejl: [] } as unknown as TrimmedUge;
const ugeFejl = { dage: [], fejl: ['Family: timeout', 'Work: denied'] } as unknown as TrimmedUge;

export const DAGEN: Record<string, () => Spec> = {
  'dagen-refresh': () => buildRefreshRun(avis, NU_DAGEN),
  'dagen-refresh-uge': () => buildRefreshRun(avis, NU_DAGEN, uge),
  'dagen-refresh-uge-fejl': () => buildRefreshRun(avis, NU_DAGEN, ugeFejl),
  'dagen-refresh-uge-null': () => buildRefreshRun(avis, NU_DAGEN, null),
  'dagen-hent': () => buildHentRun(NU_DAGEN),
  'dagen-handling': () => buildHandlingRun({ id: 'x', label: 'Block', instruktion: 'Create a block 13-14.' }, dagState),
  'dagen-handling-send': () => buildHandlingRun({ id: 'y', label: 'Draft', instruktion: 'Draft an agenda.', verb: 'send-til-andre', tilAndre: true }, dagState),
  'dagen-handling-betal': () => buildHandlingRun({ id: 'z', label: 'Pay', instruktion: 'Pay the bill.', verb: 'betal' }, dagState),
  'dagen-fortryd': () => buildFortrydRun('Delete the block again.', dagState),
  'dagen-chat': () => buildChatRun('What should I prepare?', 'Meeting at 10.00', dagState),
  'dagen-chat-uden-kontekst': () => buildChatRun('Hi', undefined, null),
};

// ---- Mail -------------------------------------------------------------------------------------------------------------

const post: TrimmedMail = {
  dato: '2026-10-27', hentet: '2026-10-27T08:40:00Z',
  handling: [{ id: '242', emne: 'Offer for a new fuse box', fra: 'Electrician Inc', modtaget: '2026-10-26T18:57:39Z', laest: true, flag: false, vedhaeftning: true }],
  tal: { handling: 1, afventer: 1, regninger: 12, indbakke: 4, sorteretIDag: 3 },
  ordnet: [],
};
const mailState: MailState = {
  dato: '2026-10-27', genereret: '2026-10-27T08:40:00Z', tal: { handling: 2, afventer: 0, regninger: 0, sorteretIDag: 0 }, ordnet: [], hermesStatus: 'x',
  beslutninger: [
    { mailId: '242', emne: 'Offer for a new fuse box', fra: 'Electrician Inc', modtaget: '2026-10-26T18:57:39Z', type: 'svar', resume: 'An offer', betydning: 'b', arkivmappe: 'Archive', muligheder: [] },
    { mailId: '243', emne: 'Your invoice', fra: 'Energy Ltd', modtaget: '2026-10-27T06:01:00Z', type: 'regning', resume: 'An invoice', betydning: 'b', arkivmappe: 'Archive', muligheder: [], afgjort: { mulighedId: 'faerdig', tid: '2026-10-27T07:00:00Z' } },
  ],
};
const NU_MAIL = new Date('2026-10-27T08:40:00Z');

export const MAIL: Record<string, () => Spec> = {
  'mail-refresh': () => buildMailRefreshRun(post, NU_MAIL),
  'mail-forbindelse': () => buildMailRefreshForbindelseRun(post, NU_MAIL, 'Mail'),
  'mail-forbindelse-laeseKun': () => buildMailRefreshForbindelseRun(post, NU_MAIL, 'Gmail', { laeseKun: true }),
  'mail-handling': () => buildMailHandlingRun('Unsubscribe', 'Find the unsubscribe link in mail 243.', mailState, 'udfoer-med-fortryd'),
  'mail-handling-send': () => buildMailHandlingRun('Reply', 'Draft a reply.', mailState, 'send-til-andre'),
  'mail-fortryd': () => buildMailFortrydRun('Move the mail back.', mailState),
  'mail-chat': () => buildMailChatRun('What is urgent?', 'Offer for a new fuse box', mailState),
  'mail-chat-tom': () => buildMailChatRun('What is urgent?', undefined, null),
  'mail-chat-forbindelse-handle': () => buildMailChatRun('Who wrote today?', undefined, mailState, { navn: 'Mail', kanHandle: true, nu: NU_MAIL }),
  'mail-chat-forbindelse-laes': () => buildMailChatRun('Who wrote today?', 'Offer for a new fuse box', mailState, { navn: 'Gmail', kanHandle: false, nu: NU_MAIL }),
  'mail-chat-forbindelse-tom': () => buildMailChatRun('What is there?', undefined, null, { navn: 'Mail', kanHandle: true, nu: NU_MAIL }),
  'mail-kladde': () => buildKladdeRun('242', 'Offer for a new fuse box', 'Hello, thanks.'),
  'mail-kladde-urent-id': () => buildKladdeRun('24<2>;rm', 'Subject', 'Hello.'),
  'mail-baggrund': () => buildBaggrundFlytRun('242', 'Folders/Afventer'),
  'mail-send': () => buildSendRun('242', 'Offer for a new fuse box', 'Hello, thanks.'),
};

export const ALLE: Record<string, () => Spec> = { ...HJEM, ...DAGEN, ...MAIL };

// ---- The check the rooms' prompt tests share --------------------------------------------------------------------------

const rod = path.dirname(fileURLToPath(import.meta.url));
const mappe = path.join(rod, 'sprog-prompt-rum-a');
const guld = (navn: string): Spec => ({ instructions: readFileSync(path.join(mappe, `${navn}.instructions.txt`), 'utf8'), input: readFileSync(path.join(mappe, `${navn}.input.txt`), 'utf8') });

/** Danish prompts (no language set, and da chosen) equal the captured files byte for byte; every file has a case. */
export function holdTilGuld(sager: Record<string, () => Spec>, forled: string): void {
  const filer = readdirSync(mappe).filter((f) => f.startsWith(`${forled}-`)).map((f) => f.replace(/\.(instructions|input)\.txt$/, ''));
  assert.deepEqual([...new Set(filer)].sort(), Object.keys(sager).sort(), 'every golden has a case and every case a golden');
  for (const [k, lav] of Object.entries(sager)) {
    for (const [hvordan, spec] of [['no language', fast(lav())], ['da chosen', fast(medSprog('da', lav))]] as const) {
      assert.equal(spec.instructions, guld(k).instructions, `${k} instructions (${hvordan})`);
      assert.equal(spec.input, guld(k).input, `${k} input (${hvordan})`);
    }
  }
}

// ---- The English check: only the room's own words are judged ---------------------------------------------------------

/** A shared text that is a string today and may become a function of the language later. */
const v = (x: unknown): string => (typeof x === 'function' ? String((x as () => unknown)()) : String(x));

export type Egne = {
  /** The rules section the room passed to byggPrompt (hjem: reglerTilPrompt(...)); it is the shared module's text. */
  regler?: string | (() => string);
  /** The element the person pointed at: elementSegment's own sentence is the shared module's text. */
  kontekst?: string;
  /** hjem: REGELFORSLAG_TEKST is the shared module's text. */
  forslag?: boolean;
};

/**
 * The text of a prompt that the room itself wrote. Everything the shared modules write (limits,
 * block catalog, language, zone and data lines, PEGER, the verb sentences, the rule proposal text, the rules section, the
 * element sentence, the data wrappers) is cut out first: those are converted by their own slice. What stays Danish on
 * purpose is also cut: the shell's example picture (VISUEL_SKEMA).
 */
export function egneTekst(s: Spec, o: Egne = {}, sprog: Sprog = 'en'): string {
  return medSprog(sprog, () => egneTekstI(s, o));
}

/** The shared parts are rebuilt in the language the prompt was built in (KC-0241: they follow the language too). */
function egneTekstI(s: Spec, o: Egne): string {
  const g = /⟦data (\S+) /.exec(s.input)?.[1];
  const zone = /^Zone: (\w+)\./m.exec(s.instructions)?.[1] as never;
  const referens = byggPrompt({ rum: 'x', zone, opgave: '', katalog: s.instructions.includes(katalogTekst()), ...(o.regler ? { regler: typeof o.regler === 'function' ? o.regler() : o.regler } : {}), data: g ? [{ kilde: 'x', zone, tillid: 'afledt', tekst: '' }] : [], ...(g ? { graense: g } : {}) });
  assert.ok(s.instructions.startsWith(referens.instructions), 'the shared sections come first, as byggPrompt writes them');
  const delt = [peger(), ...[...VERBER, 'ukendt'].map((x) => v(handlingsOpgave(x))), v(fortrydOpgave()), ...(o.forslag ? [regelforslagTekst()] : []), visuelSkema()];
  const egen = delt.reduce((t, d) => t.split(d).join(''), s.instructions.slice(referens.instructions.length));
  const sentence = o.kontekst ? v(elementSegment(o.kontekst, zone)[0]?.tekst) : '';
  const input = s.input.split('\n').filter((l) => !l.startsWith('⟦') && !l.startsWith('Data fra ') && !l.startsWith('Data from ')).join('\n').split(sentence || '\u0000').join('');
  return `${egen}\n${input}`;
}

/** The Danish-looking lines among the room's own words (see egneTekst); json field names stay Danish, quoted or as `"til":`. */
export function danskeEgneLinjer(s: Spec, o: Egne = {}, sprog: Sprog = 'en'): string[] {
  return egneTekst(s, o, sprog).split('\n')
    .map((l) => l.replace(/"[A-Za-zæøåÆØÅ]+":/g, '').replace(/"(?:til|fra|med|og|på|kan|skal)"/g, '').replace(/Folders\/[^\s|"]+/g, ''))
    .filter((l) => l.trim() && DANSK.test(l));
}
