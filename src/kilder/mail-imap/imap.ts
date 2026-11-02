// KC-0134: the one module that talks IMAP (through imapflow). Read-only by
// construction: every command passes a wire-level allowlist before it reaches
// the socket — SELECT, STORE, APPEND, EXPUNGE, COPY, MOVE, CLOSE and every
// mailbox-changing command are refused, so even a bug cannot flag, move or
// delete a mail. INBOX is opened with EXAMINE. Only envelopes, flags and the
// body structure (to tell an attachment) are fetched — never a body.
//
// KC-0135: Gmail logs in with an OAuth access token instead of a password
// (AUTHENTICATE XOAUTH2, `Adgang`); nothing else changes — the same guard, the
// same EXAMINE, the same allowlist.
//
// KC-0214: the connector's two verbs each open their own client whose
// allowlist is the read set plus exactly that verb's commands (VERBUM_KOMMANDOER):
// flyt may SELECT and UID MOVE, kladde may APPEND. STORE, EXPUNGE, COPY, CLOSE
// (which expunges a read-write mailbox), CREATE and DELETE stay refused for
// every client, so no verb can flag, delete or make a folder; and IMAP has no
// command that sends mail.

import { randomUUID, X509Certificate } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { ImapFlow } from 'imapflow';
import { KildeFejl, type Kuvert } from '../types.ts';
import { kladdeBesked } from './kladde.ts';
import { imapTekst } from './tekster.ts';
import { kuverter, MAX_KUVERTER, type ImapBesked } from './parse.ts';
import { erLoopback, normalFingeraftryk, PinFejl, tlsValg, type Forbindelse, type Pin } from './presets.ts';

/** The only commands that may reach the wire. */
export const TILLADTE_KOMMANDOER: ReadonlySet<string> = new Set([
  'CAPABILITY', 'ID', 'STARTTLS', 'AUTHENTICATE', 'LOGIN', 'ENABLE', 'NAMESPACE', 'COMPRESS',
  'LIST', 'XLIST', 'LSUB', 'STATUS', 'EXAMINE', 'FETCH', 'UID FETCH', 'NOOP', 'LOGOUT',
]);

/** KC-0214: what each verb adds to the read allowlist — exactly the commands it needs, nothing else. */
export const VERBUM_KOMMANDOER = { flyt: ['SELECT', 'UID MOVE'], kladde: ['APPEND'] } as const satisfies Record<string, readonly string[]>;
export type Verbum = keyof typeof VERBUM_KOMMANDOER;

export type Mappe = 'sendt' | 'arkiv' | 'spam' | 'papirkurv';
export type Tal = { indbakke: number; ulaeste: number; mapper: Partial<Record<Mappe, number>> };
export type Konto = { kuverter: Kuvert[]; tal: Tal };

/**
 * KC-0135: what the connector logs in with — an app password (LOGIN), or an OAuth access token (imapflow then sends
 * AUTHENTICATE XOAUTH2, which Gmail needs). Both go through the same guarded client, so the allowlist is one and the same.
 */
export type Adgang = string | { accessToken: string };
/**
 * How the account's folders are read. `gmail` (KC-0135): labels show up as folders and "All Mail" (\All) holds every mail,
 * the INBOX ones too, so it is never counted — INBOX membership is the inbox — and there is no archive folder to count;
 * \Trash is counted. Everything is found by special-use flag, never by name.
 */
export type Profil = 'standard' | 'gmail';

const SPECIAL_USE: Readonly<Record<Profil, Readonly<Record<string, Mappe>>>> = {
  standard: { '\\Sent': 'sendt', '\\Archive': 'arkiv', '\\Junk': 'spam' },
  gmail: { '\\Sent': 'sendt', '\\Junk': 'spam', '\\Trash': 'papirkurv' },
};

/** The paths of the folders worth a count, by special-use flag (the first folder with a flag wins). */
export function mapperFra(liste: readonly { path: string; specialUse?: string | undefined }[], profil: Profil): Partial<Record<Mappe, string>> {
  const mapper: Partial<Record<Mappe, string>> = {};
  for (const m of liste) {
    const slags = m.specialUse ? SPECIAL_USE[profil][m.specialUse] : undefined;
    if (slags && !mapper[slags]) mapper[slags] = m.path;
  }
  return mapper;
}
const STANDARD_TIDSGRAENSE_MS = 15_000;

const tidsfejl = (): Error => Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });

/**
 * The certificate a loopback server presents (Proton Bridge's self-signed one), for pinning: connects, upgrades with
 * STARTTLS when chosen, reads the certificate and hangs up. Nothing but STARTTLS is sent — never a login. Verification
 * is off only for this read, which trusts nothing: the caller compares the fingerprint with the pin. Any other host is
 * refused.
 */
export async function hentCertifikat(f: Forbindelse, o: { tidsgraenseMs?: number } = {}): Promise<Pin> {
  if (!erLoopback(f.vaert)) throw new Error('certifikatet hentes kun fra en loopback-adresse');
  const ms = o.tidsgraenseMs ?? STANDARD_TIDSGRAENSE_MS;
  const sockets: net.Socket[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tid = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(tidsfejl()), ms); });
  const laes = async (): Promise<Pin> => {
    let raa: net.Socket | undefined;
    if (f.sikkerhed === 'starttls') {
      raa = net.connect({ host: f.vaert, port: f.port });
      sockets.push(raa);
      await opgrader(raa);
    }
    const t = tls.connect({ ...(raa ? { socket: raa } : { host: f.vaert, port: f.port }), rejectUnauthorized: false });
    sockets.push(t);
    await new Promise<void>((res, rej) => { t.once('secureConnect', res); t.once('error', rej); });
    const x = new X509Certificate(t.getPeerCertificate().raw);
    return { fingeraftryk: x.fingerprint256, pem: x.toString() };
  };
  try { return await Promise.race([laes(), tid]); } finally {
    clearTimeout(timer);
    // Outermost first: destroying the plain socket under a live TLS socket crashed Node 24 (SIGSEGV) in tests.
    for (const s of sockets.reverse()) s.destroy();
  }
}

/** Reads the greeting, sends STARTTLS and waits for its OK on a plain socket. */
function opgrader(s: net.Socket): Promise<void> {
  return new Promise((res, rej) => {
    let buf = '';
    let sendt = false;
    s.once('error', rej);
    s.on('data', function data(d: Buffer) {
      buf += d.toString('latin1');
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const l = buf.slice(0, i); buf = buf.slice(i + 2);
        if (!sendt) {
          if (!l.startsWith('* OK')) return rej(new Error('Server does not support STARTTLS'));
          sendt = true; s.write('A STARTTLS\r\n');
        } else if (l.startsWith('A ')) {
          s.off('data', data);
          return /^A OK/i.test(l) ? res() : rej(new Error('Server does not support STARTTLS'));
        }
      }
    });
  });
}

/** Refuses every command outside the allowlist (the read set, plus a verb's own) before imapflow writes it. */
function beskyt(k: ImapFlow, verbum?: Verbum): void {
  const tilladt = new Set<string>([...TILLADTE_KOMMANDOER, ...(verbum ? VERBUM_KOMMANDOER[verbum] : [])]);
  const intern = k as unknown as { exec(c: string, ...rest: unknown[]): Promise<unknown> };
  const exec = intern.exec.bind(k);
  intern.exec = (c, ...rest) => (tilladt.has(String(c).toUpperCase())
    ? exec(c, ...rest)
    : Promise.reject(new Error(`IMAP-kommandoen ${String(c).slice(0, 20)} er ikke tilladt`)));
}

/**
 * A connected, logged-in, guarded client (`adgang`: a password or, KC-0135, an access token). `pin` (loopback only) must already match the certificate's pem. `verbum`
 * (KC-0214): the verb this client serves, whose commands join the read allowlist; absent = read only.
 */
export async function aabnKlient(f: Forbindelse, adgang: Adgang, o: { pin?: Pin; tidsgraenseMs?: number; verbum?: Verbum } = {}): Promise<ImapFlow> {
  const ms = o.tidsgraenseMs ?? STANDARD_TIDSGRAENSE_MS;
  const k = new ImapFlow({
    host: f.vaert, port: f.port,
    ...(f.sikkerhed === 'tls' ? { secure: true } : { secure: false, doSTARTTLS: true }),
    auth: typeof adgang === 'string' ? { user: f.bruger, pass: adgang } : { user: f.bruger, accessToken: adgang.accessToken },
    tls: tlsValg(f, o.pin),
    logger: false, disableAutoIdle: true, disableCompression: true,
    connectionTimeout: ms, greetingTimeout: ms, socketTimeout: ms * 4,
  });
  beskyt(k, o.verbum);
  k.on('error', () => { /* surfaced through the awaited call */ });
  try { await k.connect(); } catch (err) { k.close(); throw err; }
  return k;
}

/**
 * Reads the account: the newest INBOX envelopes (newest first, capped) and the counts — INBOX messages and unread, and
 * the special-use folders (sent, archive, junk) found by their flag, never by name. `pin` = the stored fingerprint;
 * on a loopback host the certificate is fetched first and must match it, or nothing (no password) is sent.
 */
export async function laesKonto(f: Forbindelse, adgang: Adgang, o: { pin?: string; tidsgraenseMs?: number; profil?: Profil } = {}): Promise<Konto> {
  const k = await aabnPinnet(f, adgang, o);
  try {
    const mapper = mapperFra(await k.list(), o.profil ?? 'standard');
    // imapflow answers a refused STATUS with false: INBOX must answer, a special-use folder that does not is left out.
    const ind = await k.status('INBOX', { messages: true, unseen: true });
    if (!ind) throw new Error('STATUS INBOX failed');
    const tal: Tal = { indbakke: ind.messages ?? 0, ulaeste: ind.unseen ?? 0, mapper: {} };
    for (const [slags, sti] of Object.entries(mapper) as [Mappe, string][]) {
      const st = await k.status(sti, { messages: true });
      if (st) tal.mapper[slags] = st.messages ?? 0;
    }
    const kasse = await k.mailboxOpen('INBOX', { readOnly: true });
    const n = kasse.exists;
    const beskeder = n > 0
      ? await k.fetchAll(`${Math.max(1, n - MAX_KUVERTER + 1)}:*`, { uid: true, flags: true, envelope: true, bodyStructure: true })
      : [];
    return { kuverter: kuverter(beskeder as ImapBesked[]), tal };
  } finally {
    await k.logout().catch(() => { k.close(); });
  }
}

/** A client after the pin check: on a loopback host the certificate must match the stored fingerprint, or no password is sent. */
async function aabnPinnet(f: Forbindelse, adgang: Adgang, o: { pin?: string; tidsgraenseMs?: number; verbum?: Verbum }): Promise<ImapFlow> {
  let pin: Pin | undefined;
  if (o.pin && erLoopback(f.vaert)) {
    const c = await hentCertifikat(f, o);
    if (c.fingeraftryk !== normalFingeraftryk(o.pin)) throw new PinFejl();
    pin = { fingeraftryk: o.pin, pem: c.pem };
  }
  return aabnKlient(f, adgang, { ...(pin ? { pin } : {}), ...(o.tidsgraenseMs ? { tidsgraenseMs: o.tidsgraenseMs } : {}), ...(o.verbum ? { verbum: o.verbum } : {}) });
}

type MappeInfo = { path: string; specialUse?: string | undefined; flags?: Set<string> | undefined };

/** Special-use folders a mail is never moved into: deleting, spam, drafts, sent, and the virtual ones. */
const ALDRIG_TIL = new Set(['\\Trash', '\\Junk', '\\Drafts', '\\Sent', '\\All', '\\Flagged']);
/** Folder names that mean deleting or spam, for servers that do not flag them (the last path segment). */
const ALDRIG_NAVN = /^(trash|spam|junk|bin|deleted|deleted items|deleted messages|papirkurv|slettet|slettede elementer|uønsket|uønsket post)$/i;

/** `Archive` = the account's \Archive folder (else one named Archive); `INBOX` in any case; any other name as named. */
function findMappe(liste: MappeInfo[], navn: string): MappeInfo | undefined {
  if (navn === 'Archive') return liste.find((m) => m.specialUse === '\\Archive') ?? liste.find((m) => m.path.toLowerCase() === 'archive');
  if (navn.toUpperCase() === 'INBOX') return liste.find((m) => m.path.toUpperCase() === 'INBOX');
  return liste.find((m) => m.path === navn);
}

function erForbudtMaal(m: MappeInfo): boolean {
  const sidste = m.path.split(/[/.]/).pop() ?? m.path;
  return (m.specialUse !== undefined && ALDRIG_TIL.has(m.specialUse)) || ALDRIG_NAVN.test(sidste) || Boolean(m.flags?.has('\\Noselect'));
}

/**
 * KC-0214, verb `flyt`: moves one mail (by UID) from `fra` to `til` within the account and answers the resolved folder
 * paths and the mail's new UID (from COPYUID, when the server says it) — what Fortryd moves back. Refused before any
 * mailbox is selected: a destination that is Trash, Junk or another special folder, one that does not exist (no
 * CREATE), the folder it is already in, and a server without MOVE (imapflow would fall back to COPY + STORE + EXPUNGE).
 */
export async function flytMail(f: Forbindelse, adgangskode: string, o: { pin?: string; tidsgraenseMs?: number; uid: number; fra: string; til: string }): Promise<{ fra: string; til: string; nyUid?: number }> {
  const k = await aabnPinnet(f, adgangskode, { ...o, verbum: 'flyt' });
  try {
    if (!k.capabilities.has('MOVE')) throw new KildeFejl(409, imapTekst().ingenMove);
    const liste = await k.list();
    const fra = findMappe(liste, o.fra);
    const til = findMappe(liste, o.til);
    if (!fra) throw new KildeFejl(404, imapTekst().mappeFindesIkke(o.fra.slice(0, 60)));
    if (!til) throw new KildeFejl(404, imapTekst().maalFindesIkke(o.til.slice(0, 60)));
    if (erForbudtMaal(til)) throw new KildeFejl(400, imapTekst().forbudtMaal);
    if (til.path === fra.path) throw new KildeFejl(400, imapTekst().ligger(til.path.slice(0, 60)));
    await k.mailboxOpen(fra.path);
    const findes = await k.fetchOne(String(o.uid), { uid: true }, { uid: true });
    if (!findes) throw new KildeFejl(404, imapTekst().liggerIkkeI(fra.path.slice(0, 60)));
    const r = await k.messageMove(String(o.uid), til.path, { uid: true });
    if (!r) throw new Error('MOVE failed');
    const nyUid = r.uidMap?.get(o.uid);
    return { fra: fra.path, til: til.path, ...(nyUid ? { nyUid } : {}) };
  } finally {
    // LOGOUT, never CLOSE: CLOSE would expunge the read-write mailbox.
    await k.logout().catch(() => { k.close(); });
  }
}

/**
 * KC-0214, verb `kladde`: saves a reply to the INBOX mail `uid` as a draft — the original's sender, subject and
 * Message-ID are read with EXAMINE, the message is APPENDed to the account's \Drafts folder (else one named Drafts or
 * Kladder) with \Draft. Nothing is sent: IMAP has no command for it, and SMTP is never used.
 */
export async function gemKladde(f: Forbindelse, adgangskode: string, o: { pin?: string; tidsgraenseMs?: number; uid: number; tekst: string; nu: Date }): Promise<{ mappe: string }> {
  const k = await aabnPinnet(f, adgangskode, { ...o, verbum: 'kladde' });
  try {
    const liste = await k.list();
    const kladder = liste.find((m) => m.specialUse === '\\Drafts') ?? liste.find((m) => /^(drafts|kladder)$/i.test(m.path));
    if (!kladder) throw new KildeFejl(409, imapTekst().ingenKladdemappe);
    await k.mailboxOpen('INBOX', { readOnly: true });
    const m = await k.fetchOne(String(o.uid), { uid: true, envelope: true }, { uid: true });
    if (!m || !m.envelope) throw new KildeFejl(404, imapTekst().liggerIkkeIndbakke);
    const e = m.envelope;
    const besked = kladdeBesked({
      fra: f.bruger, til: (e.replyTo?.[0]?.address ?? e.from?.[0]?.address ?? '').trim(), emne: e.subject ?? '',
      ...(e.messageId ? { messageId: e.messageId } : {}), tekst: o.tekst, nu: o.nu, id: randomUUID(),
    });
    await k.append(kladder.path, besked, ['\\Draft', '\\Seen']);
    return { mappe: kladder.path };
  } finally {
    await k.logout().catch(() => { k.close(); });
  }
}
