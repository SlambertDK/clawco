// What we ask Hermes in the Univers rooms. Pure functions: data in, { input,
// instructions } out. Hermes' answers are validated by schema.ts.
// The MARKOER strings are what the dev fake (agent/devAnswers.ts) matches on.

import type { RunSpec } from '../dagen/prompt.ts';
import { byggPrompt, elementSegment, pegerTekst } from '../../agent/prompt.ts';
import type { DataSegment } from '../../agent/udtroet.ts';
import { KORSEL, htmlTilTekst, type Deltager, type Moede, type UniversIndeks, type UniversInfo, type UniversState } from './schema.ts';
import { ikonListe } from '../../shell/visuel.ts';
import { UNIVERS_PROMPT, universPrompt } from './prompt-tekster.ts';

// KC-0241: the words are in prompt-tekster.ts, Danish and English, read at call time. The Danish markers stay
// MARKOER (the dev fake and the test world match on them); the English ones are MARKOER_EN.
export const MARKOER = UNIVERS_PROMPT.da.markoer;
export const MARKOER_EN = UNIVERS_PROMPT.en.markoer;

const TZ = 'Europe/Copenhagen';
const MAX_DOKUMENTER = 12;
const MAX_NOTER = 20;
const MAX_OPGAVER = 40;
const MAX_MOEDER = 15;
const DOK_TEKST = 2500;
const NOTE_TEKST = 1000;

// ---------- Context ----------

function tidspunkt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(universPrompt().locale, { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
function klokkeSlut(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat(universPrompt().locale, { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
const klip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max).trimEnd()}${universPrompt().klippet}` : s);
const hvem = (ds: Deltager[]): string => ds.map((d) => d.navn).join(', ') || universPrompt().ingenNoteret;
/** The date and time of "now" as the run's prompt says it (Copenhagen). */
const nuTekst = (now: Date): string => new Intl.DateTimeFormat(universPrompt().locale, { timeZone: TZ, dateStyle: 'full', timeStyle: 'short' }).format(now);

function moedeLinje(m: Moede): string {
  const f = m.forberedelse;
  return universPrompt().moedeLinje(m.id, m.titel, tidspunkt(m.start), klokkeSlut(m.slut), m.sted, hvem(m.deltagere), f ? { maal: f.maal, talepunkter: f.talepunkter.join(' | ') } : null);
}

/** The universe as text for a prompt: documents as plain text (never the raw HTML), the rest as lists with ids. */
function universTekst(info: UniversInfo, state: UniversState): string {
  const T = universPrompt();
  const dok = [...state.dokumenter].sort((a, b) => b.aendret.localeCompare(a.aendret)).slice(0, MAX_DOKUMENTER);
  const noter = state.noter.slice(-MAX_NOTER);
  const opgaver = state.opgaver.slice(0, MAX_OPGAVER);
  const moeder = [...state.moeder].sort((a, b) => a.start.localeCompare(b.start)).slice(0, MAX_MOEDER);
  const tom = dok.length + noter.length + opgaver.length + moeder.length === 0;
  const dele = [
    T.universLinje(info.navn, info.om),
    tom ? T.tomt : '',
    dok.length ? `${T.dokumenterOverskrift}\n${dok.map((d) => T.dokLinje(d.id, d.titel, d.moedeId, d.versioner.length + 1, klip(d.tekst || htmlTilTekst(d.html), DOK_TEKST))).join('\n\n')}` : '',
    noter.length ? `${T.noterOverskrift}\n${noter.map((n) => `- [${n.id}] ${n.titel}: ${klip(n.tekst, NOTE_TEKST)}`).join('\n')}` : '',
    opgaver.length ? `${T.opgaverOverskrift}\n${opgaver.map((o) => T.opgaveLinje(o.id, T.status[o.status], o.titel, o.note, o.moedeId)).join('\n')}` : '',
    moeder.length ? `${T.moederOverskrift}\n${moeder.map(moedeLinje).join('\n')}` : '',
  ];
  return dele.filter(Boolean).join('\n\n');
}

/** KC-0123: the element Henrik points at is an afledt segment; this is the app's fixed explanation of it. */
const omElement = (): string => universPrompt().omElement(pegerTekst(universPrompt().hvem));

/** KC-0123: the universe (names, documents, notes, meetings from the calendar) is text from outside or Hermes' own — afledt. */
const universSegment = (info: UniversInfo, state: UniversState): DataSegment => ({ kilde: 'univers', zone: KORSEL, tillid: 'afledt', tekst: universTekst(info, state) });

// ---------- Runs ----------

/** Chat in one universe (kind `univers`). */
export function buildUniversChatRun(info: UniversInfo, state: UniversState, besked: string, kontekst: string | undefined, now: Date): RunSpec {
  const T = universPrompt();
  const opgave = `${T.rolle} ${T.chatIntro(T.markoer.univers, nuTekst(now))}
${omElement()}

${T.chatRegler1}

${T.elementerSkema}

${T.chatRegler2}

${T.forberedelseSkema(ikonListe())}

- ${T.htmlRegler}
- ${T.personer}
- ${T.sikkerhed}`;
  return byggPrompt({ rum: 'univers', zone: KORSEL, opgave, data: [universSegment(info, state), ...elementSegment(kontekst, KORSEL, T.hvem), { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: besked }] });
}

/** Prepare one meeting (kind `forbered`, taenker tier). */
export function buildForberedRun(info: UniversInfo, state: UniversState, moede: Moede, onske: string, now: Date): RunSpec {
  const T = universPrompt();
  const f = moede.forberedelse;
  const tidligere = f ? T.tidligere(f.maal, f.talepunkter.join(' | '), f.deltagere.map((d) => `${d.navn} (${d.hvem})`).join('; ') || T.ingen) : '';
  const deltagere = moede.deltagere.map((d) => (d.email ? `${d.navn} <${d.email}>` : d.navn)).join(', ') || T.ingenNoteret;
  const opgave = `${T.rolle} ${T.forberedIntro(T.markoer.forbered, nuTekst(now), !!f)}

${T.forberedRegler(T.htmlRegler, T.personer, T.sikkerhed)}

${T.forberedelseSkema(ikonListe())}`;
  const tekst = T.moedeData(moede.titel, tidspunkt(moede.start), klokkeSlut(moede.slut), moede.sted, deltagere);
  return byggPrompt({ rum: 'univers', zone: KORSEL, opgave, data: [
    { kilde: 'kalender', zone: KORSEL, tillid: 'utroet', tekst },
    ...(tidligere ? [{ kilde: 'forberedelse', zone: KORSEL, tillid: 'afledt' as const, tekst: tidligere }] : []),
    universSegment(info, state),
    { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: T.onskeLinje(onske) },
  ] });
}

/** Chat in the Univers overview: Hermes may create a universe. */
export function buildOversigtChatRun(indeks: UniversIndeks, besked: string, kontekst: string | undefined, now: Date): RunSpec {
  const T = universPrompt();
  const aktive = indeks.univers.filter((u) => !u.arkiveret);
  const liste = aktive.length ? aktive.map((u) => `- ${u.navn}${u.om ? ` — ${u.om}` : ''}`).join('\n') : T.ingenEndnu;
  const opgave = `${T.rolle} ${T.oversigtIntro(T.markoer.oversigt, nuTekst(now))}
${omElement()}
${T.oversigtEfter}

${T.oversigtRegler}
- ${T.sikkerhed}`;
  return byggPrompt({ rum: 'univers', zone: KORSEL, opgave, data: [
    { kilde: 'univers', zone: KORSEL, tillid: 'afledt', tekst: T.universerNu(liste) },
    ...elementSegment(kontekst, KORSEL, T.hvem),
    { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: besked },
  ] });
}
