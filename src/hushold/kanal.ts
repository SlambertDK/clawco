// The go-between's channel (KC-0153, decision D8): a request reaches a household
// member who installs nothing as a message on the channel she uses (Telegram,
// WhatsApp, Signal), and her reply comes back. Two clients behind one seam, as
// src/agent/ does: `hermes` (the host's Hermes gateway) and `fake` (scripted, tests
// and dev — it never reaches anyone).
//
// Outbound (spike, docs/superpowers/specs/2026-11-01-beskeder-gateway-fund.md §5):
// `hermes send --to <kanal>:<id> --file -` delivers given text to a given chat with
// no model. The text is built here from the request, never written by Hermes, and
// only an explicit id is passed (a name would be looked up in Hermes' channel
// directory). Inbound is Path B: the gateway hook's inbound log, injected by the
// composition root (rooms import nothing from src/kilder).
//
// Invariant: nothing here decides to send. `send` runs only from the human-tap
// route in server.ts; the clock's deps never hold it.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Forespoergsel } from './foresp.ts';
import type { Medlem } from './schema.ts';
import { husstandTekst } from './tekster.ts';

export const KANALER = ['telegram', 'whatsapp', 'signal'] as const;
export type Kanal = (typeof KANALER)[number];
export const erKanal = (v: unknown): v is Kanal => typeof v === 'string' && (KANALER as readonly string[]).includes(v);
export const KANAL_NAVN: Record<Kanal, string> = { telegram: 'Telegram', whatsapp: 'WhatsApp', signal: 'Signal' };

/** Opt-in (KC-0153/KC-0154): before her first "ja" only the invitation may go; "stop" ends it. */
export const KANAL_STATUSSER = ['afventer-ja', 'aktiv', 'stoppet'] as const;
export type KanalStatus = (typeof KANAL_STATUSSER)[number];

/** What is stored on a member (schema.ts Medlem.kanal): her channel, her handle there, and where the opt-in stands. */
export type Kanalforbindelse = { kanal: Kanal; handle: string; status: KanalStatus; inviteret?: string };
/** The recipient of one send. */
export type Kanalmedlem = { medlemId: string; kanal: Kanal; handle: string };
/** One inbound message as the channel reports it: the platform's own sender id, never a name. */
export type IndkommendeBesked = { kanal: Kanal; afsender: string; gruppe: boolean; tid: string; tekst: string };

export interface KanalClient {
  readonly mode: 'hermes' | 'fake';
  send(til: Kanalmedlem, tekst: string): Promise<void>;
  /** Messages that arrived after `siden` (ISO), oldest first. */
  hentSvar(siden: string): Promise<IndkommendeBesked[]>;
}

export class KanalFejl extends Error {}

const TELEGRAM = /^-?\d{1,20}$/;
const E164 = /^\+\d{7,15}$/;

/** The handle as stored and sent: Telegram a numeric chat id, Signal and WhatsApp an E.164 number (spaces dropped). Null = not one. */
export function gyldigHandle(kanal: Kanal, handle: string): string | null {
  if (typeof handle !== 'string') return null;
  if (kanal === 'telegram') { const h = handle.trim(); return TELEGRAM.test(h) ? h : null; }
  const h = handle.replace(/[\s-]/g, '');
  return E164.test(h) ? h : null;
}

/** Whether an inbound sender id is this handle: the same id on Telegram; the same number on Signal and WhatsApp (a WhatsApp JID of that number too, never a privacy @lid id). */
export function sammeAfsender(kanal: Kanal, handle: string, afsender: string): boolean {
  const a = afsender.trim();
  if (kanal === 'telegram') return a === handle;
  const cifre = handle.replace(/^\+/, '');
  if (kanal === 'whatsapp') { const m = /^\+?(\d{7,15})(?:@s\.whatsapp\.net)?$/.exec(a); return m?.[1] === cifre; }
  return /^\+\d{7,15}$/.test(a) && a.slice(1) === cifre;
}

/** The opt-in rule. `invitation`: the one first message (KC-0154), only while she has not answered; `besked`: anything else, only once she said ja. */
export function maaSende(f: Kanalforbindelse | undefined, slags: 'invitation' | 'besked'): boolean {
  if (!f) return false;
  if (slags === 'invitation') return f.status === 'afventer-ja' && !f.inviteret;
  return f.status === 'aktiv';
}

/** Hermes turns `MEDIA:<path>` into an attachment and `[[...]]` into delivery flags (spike §5): neither may reach it. */
const FORBUDT = /MEDIA:|\[\[/i;
export const neutral = (t: string): string => t.replace(/MEDIA:/gi, 'MEDIA ').replace(/\[\[/g, '[ [');

// The day and the clock of a message, in the locale of the language being served (the table's `lokale`): "torsdag 5.
// november" and "16.30" in Danish, "Thursday 5 November" and "16:30" in English. Built once per locale.
const formater = new Map<string, { dag: Intl.DateTimeFormat; kl: Intl.DateTimeFormat }>();
function formaterFor(lokale: string): { dag: Intl.DateTimeFormat; kl: Intl.DateTimeFormat } {
  let f = formater.get(lokale);
  if (!f) {
    f = {
      dag: new Intl.DateTimeFormat(lokale, { timeZone: 'Europe/Copenhagen', weekday: 'long', day: 'numeric', month: 'long' }),
      kl: new Intl.DateTimeFormat(lokale, { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hour12: false }),
    };
    formater.set(lokale, f);
  }
  return f;
}

/**
 * The message she receives, built by the app from the request alone (KC-0153): who asks, what, when (an absolute day,
 * so the text cannot change between the screen and the tap) and the reply words. Never free text from Hermes.
 *
 * KC-0170: it goes out in the language of the request that builds it, which is the asker's (the owner's, who sees this
 * very text on the Send card and taps it): the household's words follow the install, not the recipient. Her reply is
 * read in either language whatever it is (svar.ts), since a member may answer in hers.
 */
export function beskedTekst(f: Pick<Forespoergsel, 'titel' | 'tid'>, fraNavn: string, slags: 'foresp' | 'paamindelse' = 'foresp'): string {
  const T = husstandTekst();
  const fm = formaterFor(T.lokale);
  const kl = (iso: string): string => fm.kl.format(new Date(iso)).replace(':', T.klTegn);
  const hoved = T.besked.hoved(slags, fraNavn, f.titel);
  const naar = f.tid ? T.besked.naar(fm.dag.format(new Date(f.tid.start)), kl(f.tid.start), kl(f.tid.slut)) : null;
  return neutral([hoved, ...(naar ? [naar] : []), T.besked.stop(T.besked.svar(Boolean(f.tid)))].join('\n'));
}

/**
 * The id a Send button asks a yes for: the request (or, for KC-0154's invitation, the member), the kind and a hash of
 * the exact text shown. A changed text is another id.
 */
export function sendJaId(id: string, slags: SendSlags | 'invitation', tekst: string): string {
  return `${id}:${slags}:${createHash('sha256').update(tekst).digest('hex').slice(0, 16)}`;
}

export type SendSlags = 'foresp' | 'paamindelse';
export type SendVurdering =
  | { ok: true; f: Forespoergsel; til: Kanalmedlem; tekst: string; jaId: string; kanalNavn: string }
  | { ok: false; hvorfor: string; status: 403 | 404 | 409 };

/**
 * Whether `person` may send `slags` for request `id` on the recipient's channel now, and the exact text. Pure: the
 * route checks it before the policy layer and again inside the store's queue, and the card shows a Send button only
 * when it says ok — so what is on screen and what the route allows are one rule.
 */
export function vurderSend(s: { forespoergsler: readonly Forespoergsel[]; medlemmer: readonly Medlem[] }, id: string, slags: SendSlags, person: string): SendVurdering {
  const T = husstandTekst();
  const f = s.forespoergsler.find((x) => x.id === id);
  if (!f) return { ok: false, hvorfor: T.fejl.foresp404, status: 404 };
  if (f.fra !== person) return { ok: false, hvorfor: T.fejl.kunAskerSender, status: 403 };
  const m = s.medlemmer.find((x) => x.id === f.til);
  const navn = m?.navn ?? T.fejl.personen;
  if (f.tilstand !== 'spurgt') return { ok: false, hvorfor: T.fejl.besvaretAfsluttet, status: 409 };
  if (!m?.kanal) return { ok: false, hvorfor: T.fejl.ikkeNaaes(navn), status: 409 };
  if (m.kanal.status === 'stoppet') return { ok: false, hvorfor: T.fejl.stoppetBeskeder(navn), status: 409 };
  if (!maaSende(m.kanal, 'besked')) return { ok: false, hvorfor: T.fejl.ikkeSagtJa(navn), status: 409 };
  const sendt = f.kanal?.sendt ?? [];
  const kanalNavn = KANAL_NAVN[m.kanal.kanal];
  if (slags === 'foresp') {
    if (sendt.some((x) => x.slags === 'foresp')) return { ok: false, hvorfor: T.fejl.alleredeSendt(navn), status: 409 };
    // One open request on her channel at a time, so a reply of hers has exactly one meaning.
    if (s.forespoergsler.some((x) => x.id !== f.id && x.til === f.til && x.tilstand === 'spurgt' && (x.kanal?.sendt.length ?? 0) > 0)) {
      return { ok: false, hvorfor: T.fejl.aabenPaaKanal(navn, kanalNavn), status: 409 };
    }
  } else {
    if (!sendt.some((x) => x.slags === 'foresp')) return { ok: false, hvorfor: T.fejl.sendFoerst, status: 409 };
    if (sendt.some((x) => x.slags === 'paamindelse')) return { ok: false, hvorfor: T.fejl.paamindelseSendt(navn), status: 409 };
  }
  const fraNavn = s.medlemmer.find((x) => x.id === f.fra)?.navn ?? T.besked.enIHusstanden;
  const tekst = beskedTekst(f, fraNavn, slags);
  return { ok: true, f, til: { medlemId: m.id, kanal: m.kanal.kanal, handle: m.kanal.handle }, tekst, jaId: sendJaId(f.id, slags, tekst), kanalNavn };
}

/** The fake: records every send, serves scripted replies. It never reaches anyone. */
export function lavFakeKanal(o: { indgaaende?: IndkommendeBesked[] } = {}): KanalClient & { sendt: { til: Kanalmedlem; tekst: string }[]; modtag(b: IndkommendeBesked): void } {
  const indgaaende = [...(o.indgaaende ?? [])];
  const sendt: { til: Kanalmedlem; tekst: string }[] = [];
  return {
    mode: 'fake',
    sendt,
    async send(til, tekst) { sendt.push({ til: { ...til }, tekst }); },
    async hentSvar(siden) { return indgaaende.filter((b) => b.tid > siden).sort((a, b) => a.tid.localeCompare(b.tid)); },
    modtag(b) { indgaaende.push({ ...b }); },
  };
}

export type KanalKoer = (cmd: string, args: string[], stdin: string) => Promise<{ code: number; stdout: string; stderr: string }>;
/** A line of the gateway hook's inbound log (src/kilder/beskeder/jsonl.ts RaaBesked, restated: rooms import nothing from src/kilder). */
export type LogLinje = { kanal: string; samtale: string; gruppe: boolean; afsender: string; tid: string; tekst: string };

const koerFil: KanalKoer = (cmd, args, stdin) => new Promise((resolve) => {
  const p = execFile(cmd, args, { timeout: 60_000, maxBuffer: 256 * 1024 }, (err, stdout, stderr) => {
    const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
    resolve({ code, stdout: String(stdout), stderr: String(stderr) });
  });
  p.stdin?.end(stdin);
});

/**
 * Hermes: `<cli> send --to <kanal>:<id> --file - --json --quiet`, argv only (no shell), the text on stdin. `cli` empty =
 * this host cannot send yet (a clear refusal, never a guess). Replies come from `laesLog` (Path B, null = no hook yet).
 */
export function lavHermesKanal(o: { cli: string; koer?: KanalKoer; laesLog: () => Promise<LogLinje[] | null> }): KanalClient {
  const koer = o.koer ?? koerFil;
  return {
    mode: 'hermes',
    async send(til, tekst) {
      if (!o.cli) throw new KanalFejl(husstandTekst().fejl.hermesKanIkke);
      const handle = gyldigHandle(til.kanal, til.handle);
      if (!handle || handle !== til.handle) throw new KanalFejl(husstandTekst().fejl.ugyldigModtager);
      if (!tekst.trim() || FORBUDT.test(tekst)) throw new KanalFejl(husstandTekst().fejl.kanIkkeSendes);
      const r = await koer(o.cli, ['send', '--to', `${til.kanal}:${handle}`, '--file', '-', '--json', '--quiet'], tekst);
      if (r.code !== 0) throw new KanalFejl(husstandTekst().fejl.hermesFejlede(KANAL_NAVN[til.kanal]));
    },
    async hentSvar(siden) {
      const log = (await o.laesLog()) ?? [];
      return log.filter((l) => erKanal(l.kanal) && l.tid > siden)
        .map((l) => ({ kanal: l.kanal as Kanal, afsender: l.afsender, gruppe: l.gruppe, tid: l.tid, tekst: l.tekst }))
        .sort((a, b) => a.tid.localeCompare(b.tid));
    },
  };
}
