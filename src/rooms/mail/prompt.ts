// What we ask Hermes in the room Mail. Pure functions.

import type { RunSpec } from '../dagen/prompt.ts';
import type { MailState } from './schema.ts';
import type { TrimmedMail } from './source.ts';
import { copenhagenDate, copenhagenTime } from '../dagen/source.ts';
import { visuelSkema } from '../../shell/visuel.ts';
import { byggPrompt, elementSegment, fortrydOpgave, handlingsOpgave, peger } from '../../agent/prompt.ts';
import { KORSEL } from './schema.ts';
import { mailPromptTekst } from './prompt-tekster.ts';

/** A mail id from Hermes' JSON as it may stand in the app's own text (commands, task sentences): safe characters only. */
const rentId = (id: string): string => id.replace(/[^\w.-]/g, '').slice(0, 40);

function tidslinje(now: Date): string {
  return mailPromptTekst().tidslinje(copenhagenDate(now), copenhagenTime(now.toISOString()));
}

/** The answer schema in the language being rendered, with the shell's example picture. */
const skema = (): string => mailPromptTekst().skema(visuelSkema());

/** The rules of the acting refresh (a Clawco with Hermes' tools): one entry per line, so the variants below can list their own. */
function regler(): string {
  const T = mailPromptTekst();
  return [T.reglerOverskrift, T.regelLaes, T.regelSkriv, T.regelType, T.regelMuligheder, T.regelAldrig, T.regelVisuel, T.regelMedtag].join('\n');
}

export function buildMailRefreshRun(data: TrimmedMail, now: Date): RunSpec {
  const T = mailPromptTekst();
  const list = data.handling.map((e) => ({ id: e.id, emne: e.emne, fra: e.fra, modtaget: e.modtaget, laest: e.laest, flag: e.flag, vedhaeftning: e.vedhaeftning }));
  return {
    ...byggPrompt({
      rum: 'mail',
      zone: KORSEL,
      katalog: true,
      opgave: `${T.rolle}\n\n${T.refreshOpgave}\n\n${skema()}\n\n${regler()}`,
      data: [{ kilde: 'mail', zone: KORSEL, tillid: 'utroet', tekst: `${tidslinje(now)}\n\n${T.refreshListe(JSON.stringify(data.tal), list.length, JSON.stringify(list, null, 1))}` }],
    }),
  };
}

// KC-0214: the refresh in a Clawco without agent tools (a Sky tenant), from the mail connector's envelopes. The agent
// cannot read a body and has no tools, so it proposes no muligheder and no folder: Færdig moves the mail to the
// account's archive through the connector. The shared rules are the same entries as the acting refresh's, so the variants
// never drift apart; the schema is the acting one minus the lines the variant does not ask for (json field names, the
// same in both languages).
// KC-0223: the same for a connection Clawco may only read (Gmail): the card is a reading aid, so no draft, folder
// or button is asked for — the user moves and answers mails in their own mail app.
const skemaFraLinjer = (fjern: RegExp): string => skema().split('\n').filter((l) => !fjern.test(l)).join('\n');
const reglerForbindelse = (laeseKun: boolean): string => {
  const T = mailPromptTekst();
  return [T.reglerOverskrift, T.forbindelseIkkeLaese, T.forbindelseSkriv, laeseKun ? T.regelTypeLaeseKun : T.regelType, laeseKun ? T.laeseKunKunLaese : T.forbindelseFaerdig, T.forbindelseAldrig, T.regelVisuel, T.regelMedtag].join('\n');
};

/**
 * KC-0214: the refresh from the mail connector's inbox (`navn`: the connector), for an agent without tools.
 * KC-0223 `laeseKun`: the connection can only read, so the ask has no draft, folder or button.
 */
export function buildMailRefreshForbindelseRun(data: TrimmedMail, now: Date, navn: string, o: { laeseKun?: boolean } = {}): RunSpec {
  const list = data.handling.map((e) => ({ id: e.id, emne: e.emne, fra: e.fra, modtaget: e.modtaget, laest: e.laest, flag: e.flag, vedhaeftning: e.vedhaeftning }));
  const laeseKun = o.laeseKun === true;
  const T = mailPromptTekst();
  return {
    ...byggPrompt({
      rum: 'mail',
      zone: KORSEL,
      katalog: true,
      opgave: `${laeseKun ? T.rolleLaeseKun : T.rolleForbindelse}\n\n${T.forbindelseOpgave(laeseKun)}\n\n${skemaFraLinjer(laeseKun ? /^\s*"(arkivmappe|muligheder|udkast)"/ : /^\s*"(arkivmappe|muligheder)"/)}\n\n${reglerForbindelse(laeseKun)}`,
      data: [{ kilde: 'mail', zone: KORSEL, tillid: 'utroet', tekst: `${tidslinje(now)}\n\n${T.forbindelseListe(laeseKun, navn, list.length, data.tal.indbakke, JSON.stringify(list, null, 1))}` }],
    }),
  };
}

/**
 * KC-0123: subjects, senders and summaries came from mail (via Hermes) — an afledt segment, never task text.
 * KC-0218 `medDato`: the connector chat has only envelopes, so the date each mail came in is part of what it knows.
 */
function indholdSegment(state: MailState | null, medResume: boolean, foer = '', medDato = false) {
  const T = mailPromptTekst();
  const kort = state && { tal: state.tal, beslutninger: state.beslutninger.map((b) => ({ mailId: b.mailId, emne: b.emne, fra: b.fra, ...(medDato ? { modtaget: b.modtaget } : {}), ...(medResume ? { resume: b.resume } : {}), afgjort: Boolean(b.afgjort) })) };
  return { kilde: 'rum-state', zone: KORSEL, tillid: 'afledt' as const, tekst: `${foer}${kort ? T.indhold(JSON.stringify(kort, null, 1)) : T.ingenData}` };
}

/** `verb`: the handling's verb as the policy layer ran it (KC-0122); the run's task sentence is the app's text for it. */
export function buildMailHandlingRun(label: string, instruktion: string, state: MailState, verb: string): RunSpec {
  const T = mailPromptTekst();
  return {
    ...byggPrompt({
      rum: 'mail',
      zone: KORSEL,
      opgave: `${T.rolle}\n\n${handlingsOpgave(verb)} ${T.indholdOgsaa}\n\n${T.handlingRegler}`,
      data: [{ kilde: 'handling', zone: KORSEL, tillid: 'afledt', tekst: instruktion }, indholdSegment(state, false, `${T.knappen(label)}\n\n`)],
    }),
  };
}

export function buildMailFortrydRun(fortryd: string, state: MailState): RunSpec {
  const T = mailPromptTekst();
  return {
    ...byggPrompt({
      rum: 'mail',
      zone: KORSEL,
      opgave: `${T.rolle}\n\n${fortrydOpgave()} ${T.talIRummet(JSON.stringify(state.tal))}\n\n${T.handlingRegler}`,
      data: [{ kilde: 'fortryd', zone: KORSEL, tillid: 'afledt', tekst: fortryd }],
    }),
  };
}

/**
 * KC-0218 `forbindelse`: the room runs on a mail connector (a Clawco without Hermes' tools), so the chat answers from
 * what the connector reads — sender, subject and date — and names no tool. Absent = Henrik's installation: unchanged.
 */
export type MailChatForbindelse = { navn: string; kanHandle: boolean; nu?: Date };

function chatForbindelseOpgave(f: MailChatForbindelse): string {
  const T = mailPromptTekst();
  return T.chatForbindelse(f.navn, peger(), f.kanHandle ? T.graenseHandle : T.graenseLaes);
}

export function buildMailChatRun(besked: string, kontekst: string | undefined, state: MailState | null, forbindelse?: MailChatForbindelse): RunSpec {
  const T = mailPromptTekst();
  if (forbindelse) {
    return {
      ...byggPrompt({
        rum: 'mail',
        zone: KORSEL,
        opgave: chatForbindelseOpgave(forbindelse),
        data: [indholdSegment(state, true, `${tidslinje(forbindelse.nu ?? new Date())}\n\n`, true), ...elementSegment(kontekst, KORSEL), { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: besked }],
      }),
    };
  }
  return {
    ...byggPrompt({
      rum: 'mail',
      zone: KORSEL,
      opgave: `${T.rolle}\n\n${T.indholdStaar} ${peger()} ${T.laesMailen}\n\n${T.chatRegler}`,
      data: [indholdSegment(state, true), ...elementSegment(kontekst, KORSEL), { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: besked }],
    }),
  };
}

/** The mail's subject as it stands in the beskeden: it came from the sender, so it is utroet. */
const emneSegment = (mailId: string, emne: string) => ({ kilde: 'mail', zone: KORSEL, tillid: 'utroet' as const, tekst: mailPromptTekst().mailHarEmnet(rentId(mailId), emne) });

export function buildKladdeRun(mailId: string, emne: string, tekst: string): RunSpec {
  const T = mailPromptTekst();
  const id = rentId(mailId);
  return {
    ...byggPrompt({
      rum: 'mail',
      zone: KORSEL,
      opgave: `${T.rolle}\n\n${T.kladde(id)}`,
      data: [emneSegment(mailId, emne), { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: T.svarPaa(id, tekst) }],
    }),
  };
}

export function buildBaggrundFlytRun(mailId: string, mappe: string): RunSpec {
  const T = mailPromptTekst();
  return {
    ...byggPrompt({
      rum: 'mail',
      zone: KORSEL,
      opgave: `${T.rolle}\n\n${T.baggrund(mappe)}`,
      data: [{ kilde: 'baggrund', zone: KORSEL, tillid: 'betroet', tekst: `himalaya message move --from Folders/Handling --to ${mappe} ${rentId(mailId)}` }],
    }),
  };
}

/** Henrik pressed Send after approving the draft: that click is his explicit ok. */
export function buildSendRun(mailId: string, emne: string, tekst: string): RunSpec {
  const T = mailPromptTekst();
  const id = rentId(mailId);
  return {
    ...byggPrompt({
      rum: 'mail',
      zone: KORSEL,
      opgave: `${T.rolle}\n\n${T.send(id)}`,
      data: [emneSegment(mailId, emne), { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: T.svarPaa(id, tekst) }],
    }),
  };
}
